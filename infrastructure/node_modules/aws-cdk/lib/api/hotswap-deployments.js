"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryHotswapDeployment = tryHotswapDeployment;
const cfn_diff = require("@aws-cdk/cloudformation-diff");
const chalk = require("chalk");
const evaluate_cloudformation_template_1 = require("./evaluate-cloudformation-template");
const logging_1 = require("../logging");
const appsync_mapping_templates_1 = require("./hotswap/appsync-mapping-templates");
const code_build_projects_1 = require("./hotswap/code-build-projects");
const common_1 = require("./hotswap/common");
const ecs_services_1 = require("./hotswap/ecs-services");
const lambda_functions_1 = require("./hotswap/lambda-functions");
const s3_bucket_deployments_1 = require("./hotswap/s3-bucket-deployments");
const stepfunctions_state_machines_1 = require("./hotswap/stepfunctions-state-machines");
const nested_stack_helpers_1 = require("./nested-stack-helpers");
const plugin_1 = require("./plugin");
// Must use a require() otherwise esbuild complains about calling a namespace
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pLimit = require('p-limit');
const RESOURCE_DETECTORS = {
    // Lambda
    'AWS::Lambda::Function': lambda_functions_1.isHotswappableLambdaFunctionChange,
    'AWS::Lambda::Version': lambda_functions_1.isHotswappableLambdaFunctionChange,
    'AWS::Lambda::Alias': lambda_functions_1.isHotswappableLambdaFunctionChange,
    // AppSync
    'AWS::AppSync::Resolver': appsync_mapping_templates_1.isHotswappableAppSyncChange,
    'AWS::AppSync::FunctionConfiguration': appsync_mapping_templates_1.isHotswappableAppSyncChange,
    'AWS::AppSync::GraphQLSchema': appsync_mapping_templates_1.isHotswappableAppSyncChange,
    'AWS::AppSync::ApiKey': appsync_mapping_templates_1.isHotswappableAppSyncChange,
    'AWS::ECS::TaskDefinition': ecs_services_1.isHotswappableEcsServiceChange,
    'AWS::CodeBuild::Project': code_build_projects_1.isHotswappableCodeBuildProjectChange,
    'AWS::StepFunctions::StateMachine': stepfunctions_state_machines_1.isHotswappableStateMachineChange,
    'Custom::CDKBucketDeployment': s3_bucket_deployments_1.isHotswappableS3BucketDeploymentChange,
    'AWS::IAM::Policy': async (logicalId, change, evaluateCfnTemplate) => {
        // If the policy is for a S3BucketDeploymentChange, we can ignore the change
        if (await (0, s3_bucket_deployments_1.skipChangeForS3DeployCustomResourcePolicy)(logicalId, change, evaluateCfnTemplate)) {
            return [];
        }
        return (0, common_1.reportNonHotswappableResource)(change, 'This resource type is not supported for hotswap deployments');
    },
    'AWS::CDK::Metadata': async () => [],
};
/**
 * Perform a hotswap deployment, short-circuiting CloudFormation if possible.
 * If it's not possible to short-circuit the deployment
 * (because the CDK Stack contains changes that cannot be deployed without CloudFormation),
 * returns `undefined`.
 */
async function tryHotswapDeployment(sdkProvider, assetParams, cloudFormationStack, stackArtifact, hotswapMode, hotswapPropertyOverrides) {
    // resolve the environment, so we can substitute things like AWS::Region in CFN expressions
    const resolvedEnv = await sdkProvider.resolveEnvironment(stackArtifact.environment);
    // create a new SDK using the CLI credentials, because the default one will not work for new-style synthesis -
    // it assumes the bootstrap deploy Role, which doesn't have permissions to update Lambda functions
    const sdk = (await sdkProvider.forEnvironment(resolvedEnv, plugin_1.Mode.ForWriting)).sdk;
    const currentTemplate = await (0, nested_stack_helpers_1.loadCurrentTemplateWithNestedStacks)(stackArtifact, sdk);
    const evaluateCfnTemplate = new evaluate_cloudformation_template_1.EvaluateCloudFormationTemplate({
        stackName: stackArtifact.stackName,
        template: stackArtifact.template,
        parameters: assetParams,
        account: resolvedEnv.account,
        region: resolvedEnv.region,
        partition: (await sdk.currentAccount()).partition,
        sdk,
        nestedStacks: currentTemplate.nestedStacks,
    });
    const stackChanges = cfn_diff.fullDiff(currentTemplate.deployedRootTemplate, stackArtifact.template);
    const { hotswappableChanges, nonHotswappableChanges } = await classifyResourceChanges(stackChanges, evaluateCfnTemplate, sdk, currentTemplate.nestedStacks, hotswapPropertyOverrides);
    logNonHotswappableChanges(nonHotswappableChanges, hotswapMode);
    // preserve classic hotswap behavior
    if (hotswapMode === common_1.HotswapMode.FALL_BACK) {
        if (nonHotswappableChanges.length > 0) {
            return undefined;
        }
    }
    // apply the short-circuitable changes
    await applyAllHotswappableChanges(sdk, hotswappableChanges);
    return {
        type: 'did-deploy-stack',
        noOp: hotswappableChanges.length === 0,
        stackArn: cloudFormationStack.stackId,
        outputs: cloudFormationStack.outputs,
    };
}
/**
 * Classifies all changes to all resources as either hotswappable or not.
 * Metadata changes are excluded from the list of (non)hotswappable resources.
 */
async function classifyResourceChanges(stackChanges, evaluateCfnTemplate, sdk, nestedStackNames, hotswapPropertyOverrides) {
    const resourceDifferences = getStackResourceDifferences(stackChanges);
    const promises = [];
    const hotswappableResources = new Array();
    const nonHotswappableResources = new Array();
    for (const logicalId of Object.keys(stackChanges.outputs.changes)) {
        nonHotswappableResources.push({
            hotswappable: false,
            reason: 'output was changed',
            logicalId,
            rejectedChanges: [],
            resourceType: 'Stack Output',
        });
    }
    // gather the results of the detector functions
    for (const [logicalId, change] of Object.entries(resourceDifferences)) {
        if (change.newValue?.Type === 'AWS::CloudFormation::Stack' && change.oldValue?.Type === 'AWS::CloudFormation::Stack') {
            const nestedHotswappableResources = await findNestedHotswappableChanges(logicalId, change, nestedStackNames, evaluateCfnTemplate, sdk, hotswapPropertyOverrides);
            hotswappableResources.push(...nestedHotswappableResources.hotswappableChanges);
            nonHotswappableResources.push(...nestedHotswappableResources.nonHotswappableChanges);
            continue;
        }
        const hotswappableChangeCandidate = isCandidateForHotswapping(change, logicalId);
        // we don't need to run this through the detector functions, we can already judge this
        if ('hotswappable' in hotswappableChangeCandidate) {
            if (!hotswappableChangeCandidate.hotswappable) {
                nonHotswappableResources.push(hotswappableChangeCandidate);
            }
            continue;
        }
        const resourceType = hotswappableChangeCandidate.newValue.Type;
        if (resourceType in RESOURCE_DETECTORS) {
            // run detector functions lazily to prevent unhandled promise rejections
            promises.push(() => RESOURCE_DETECTORS[resourceType](logicalId, hotswappableChangeCandidate, evaluateCfnTemplate, hotswapPropertyOverrides));
        }
        else {
            (0, common_1.reportNonHotswappableChange)(nonHotswappableResources, hotswappableChangeCandidate, undefined, 'This resource type is not supported for hotswap deployments');
        }
    }
    // resolve all detector results
    const changesDetectionResults = [];
    for (const detectorResultPromises of promises) {
        // Constant set of promises per resource
        // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
        const hotswapDetectionResults = await Promise.all(await detectorResultPromises());
        changesDetectionResults.push(hotswapDetectionResults);
    }
    for (const resourceDetectionResults of changesDetectionResults) {
        for (const propertyResult of resourceDetectionResults) {
            propertyResult.hotswappable
                ? hotswappableResources.push(propertyResult)
                : nonHotswappableResources.push(propertyResult);
        }
    }
    return {
        hotswappableChanges: hotswappableResources,
        nonHotswappableChanges: nonHotswappableResources,
    };
}
/**
 * Returns all changes to resources in the given Stack.
 *
 * @param stackChanges the collection of all changes to a given Stack
 */
function getStackResourceDifferences(stackChanges) {
    // we need to collapse logical ID rename changes into one change,
    // as they are represented in stackChanges as a pair of two changes: one addition and one removal
    const allResourceChanges = stackChanges.resources.changes;
    const allRemovalChanges = filterDict(allResourceChanges, (resChange) => resChange.isRemoval);
    const allNonRemovalChanges = filterDict(allResourceChanges, (resChange) => !resChange.isRemoval);
    for (const [logId, nonRemovalChange] of Object.entries(allNonRemovalChanges)) {
        if (nonRemovalChange.isAddition) {
            const addChange = nonRemovalChange;
            // search for an identical removal change
            const identicalRemovalChange = Object.entries(allRemovalChanges).find(([_, remChange]) => {
                return changesAreForSameResource(remChange, addChange);
            });
            // if we found one, then this means this is a rename change
            if (identicalRemovalChange) {
                const [removedLogId, removedResourceChange] = identicalRemovalChange;
                allNonRemovalChanges[logId] = makeRenameDifference(removedResourceChange, addChange);
                // delete the removal change that forms the rename pair
                delete allRemovalChanges[removedLogId];
            }
        }
    }
    // the final result are all of the remaining removal changes,
    // plus all of the non-removal changes
    // (we saved the rename changes in that object already)
    return {
        ...allRemovalChanges,
        ...allNonRemovalChanges,
    };
}
/** Filters an object with string keys based on whether the callback returns 'true' for the given value in the object. */
function filterDict(dict, func) {
    return Object.entries(dict).reduce((acc, [key, t]) => {
        if (func(t)) {
            acc[key] = t;
        }
        return acc;
    }, {});
}
/** Finds any hotswappable changes in all nested stacks. */
async function findNestedHotswappableChanges(logicalId, change, nestedStackTemplates, evaluateCfnTemplate, sdk, hotswapPropertyOverrides) {
    const nestedStack = nestedStackTemplates[logicalId];
    if (!nestedStack.physicalName) {
        return {
            hotswappableChanges: [],
            nonHotswappableChanges: [
                {
                    hotswappable: false,
                    logicalId,
                    reason: `physical name for AWS::CloudFormation::Stack '${logicalId}' could not be found in CloudFormation, so this is a newly created nested stack and cannot be hotswapped`,
                    rejectedChanges: [],
                    resourceType: 'AWS::CloudFormation::Stack',
                },
            ],
        };
    }
    const evaluateNestedCfnTemplate = await evaluateCfnTemplate.createNestedEvaluateCloudFormationTemplate(nestedStack.physicalName, nestedStack.generatedTemplate, change.newValue?.Properties?.Parameters);
    const nestedDiff = cfn_diff.fullDiff(nestedStackTemplates[logicalId].deployedTemplate, nestedStackTemplates[logicalId].generatedTemplate);
    return classifyResourceChanges(nestedDiff, evaluateNestedCfnTemplate, sdk, nestedStackTemplates[logicalId].nestedStackTemplates, hotswapPropertyOverrides);
}
/** Returns 'true' if a pair of changes is for the same resource. */
function changesAreForSameResource(oldChange, newChange) {
    return (oldChange.oldResourceType === newChange.newResourceType &&
        // this isn't great, but I don't want to bring in something like underscore just for this comparison
        JSON.stringify(oldChange.oldProperties) === JSON.stringify(newChange.newProperties));
}
function makeRenameDifference(remChange, addChange) {
    return new cfn_diff.ResourceDifference(
    // we have to fill in the old value, because otherwise this will be classified as a non-hotswappable change
    remChange.oldValue, addChange.newValue, {
        resourceType: {
            oldType: remChange.oldResourceType,
            newType: addChange.newResourceType,
        },
        propertyDiffs: addChange.propertyDiffs,
        otherDiffs: addChange.otherDiffs,
    });
}
/**
 * Returns a `HotswappableChangeCandidate` if the change is hotswappable
 * Returns an empty `HotswappableChange` if the change is to CDK::Metadata
 * Returns a `NonHotswappableChange` if the change is not hotswappable
 */
function isCandidateForHotswapping(change, logicalId) {
    // a resource has been removed OR a resource has been added; we can't short-circuit that change
    if (!change.oldValue) {
        return {
            hotswappable: false,
            resourceType: change.newValue.Type,
            logicalId,
            rejectedChanges: [],
            reason: `resource '${logicalId}' was created by this deployment`,
        };
    }
    else if (!change.newValue) {
        return {
            hotswappable: false,
            resourceType: change.oldValue.Type,
            logicalId,
            rejectedChanges: [],
            reason: `resource '${logicalId}' was destroyed by this deployment`,
        };
    }
    // a resource has had its type changed
    if (change.newValue?.Type !== change.oldValue?.Type) {
        return {
            hotswappable: false,
            resourceType: change.newValue?.Type,
            logicalId,
            rejectedChanges: [],
            reason: `resource '${logicalId}' had its type changed from '${change.oldValue?.Type}' to '${change.newValue?.Type}'`,
        };
    }
    return {
        logicalId,
        oldValue: change.oldValue,
        newValue: change.newValue,
        propertyUpdates: change.propertyUpdates,
    };
}
async function applyAllHotswappableChanges(sdk, hotswappableChanges) {
    if (hotswappableChanges.length > 0) {
        (0, logging_1.print)(`\n${common_1.ICON} hotswapping resources:`);
    }
    const limit = pLimit(10);
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    return Promise.all(hotswappableChanges.map(hotswapOperation => limit(() => {
        return applyHotswappableChange(sdk, hotswapOperation);
    })));
}
async function applyHotswappableChange(sdk, hotswapOperation) {
    // note the type of service that was successfully hotswapped in the User-Agent
    const customUserAgent = `cdk-hotswap/success-${hotswapOperation.service}`;
    sdk.appendCustomUserAgent(customUserAgent);
    for (const name of hotswapOperation.resourceNames) {
        (0, logging_1.print)(`   ${common_1.ICON} %s`, chalk.bold(name));
    }
    // if the SDK call fails, an error will be thrown by the SDK
    // and will prevent the green 'hotswapped!' text from being displayed
    try {
        await hotswapOperation.apply(sdk);
    }
    catch (e) {
        if (e.name === 'TimeoutError' || e.name === 'AbortError') {
            const result = JSON.parse(e.message);
            const error = new Error([
                `Resource is not in the expected state due to waiter status: ${result.state}`,
                result.reason ? `${result.reason}.` : '',
            ].join('. '));
            error.name = e.name;
            throw error;
        }
        throw e;
    }
    for (const name of hotswapOperation.resourceNames) {
        (0, logging_1.print)(`${common_1.ICON} %s %s`, chalk.bold(name), chalk.green('hotswapped!'));
    }
    sdk.removeCustomUserAgent(customUserAgent);
}
function logNonHotswappableChanges(nonHotswappableChanges, hotswapMode) {
    if (nonHotswappableChanges.length === 0) {
        return;
    }
    /**
     * EKS Services can have a task definition that doesn't refer to the task definition being updated.
     * We have to log this as a non-hotswappable change to the task definition, but when we do,
     * we wind up hotswapping the task definition and logging it as a non-hotswappable change.
     *
     * This logic prevents us from logging that change as non-hotswappable when we hotswap it.
     */
    if (hotswapMode === common_1.HotswapMode.HOTSWAP_ONLY) {
        nonHotswappableChanges = nonHotswappableChanges.filter((change) => change.hotswapOnlyVisible === true);
        if (nonHotswappableChanges.length === 0) {
            return;
        }
    }
    if (hotswapMode === common_1.HotswapMode.HOTSWAP_ONLY) {
        (0, logging_1.print)('\n%s %s', chalk.red('⚠️'), chalk.red('The following non-hotswappable changes were found. To reconcile these using CloudFormation, specify --hotswap-fallback'));
    }
    else {
        (0, logging_1.print)('\n%s %s', chalk.red('⚠️'), chalk.red('The following non-hotswappable changes were found:'));
    }
    for (const change of nonHotswappableChanges) {
        change.rejectedChanges.length > 0
            ? (0, logging_1.print)('    logicalID: %s, type: %s, rejected changes: %s, reason: %s', chalk.bold(change.logicalId), chalk.bold(change.resourceType), chalk.bold(change.rejectedChanges), chalk.red(change.reason))
            : (0, logging_1.print)('    logicalID: %s, type: %s, reason: %s', chalk.bold(change.logicalId), chalk.bold(change.resourceType), chalk.red(change.reason));
    }
    (0, logging_1.print)(''); // newline
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaG90c3dhcC1kZXBsb3ltZW50cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImhvdHN3YXAtZGVwbG95bWVudHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFpRkEsb0RBb0RDO0FBcklELHlEQUF5RDtBQUd6RCwrQkFBK0I7QUFHL0IseUZBQW9GO0FBQ3BGLHdDQUFtQztBQUNuQyxtRkFBa0Y7QUFDbEYsdUVBQXFGO0FBQ3JGLDZDQVUwQjtBQUMxQix5REFBd0U7QUFDeEUsaUVBQWdGO0FBQ2hGLDJFQUd5QztBQUN6Qyx5RkFBMEY7QUFDMUYsaUVBQW1HO0FBQ25HLHFDQUFnQztBQUdoQyw2RUFBNkU7QUFDN0UsaUVBQWlFO0FBQ2pFLE1BQU0sTUFBTSxHQUE2QixPQUFPLENBQUMsU0FBUyxDQUFDLENBQUM7QUFTNUQsTUFBTSxrQkFBa0IsR0FBdUM7SUFDN0QsU0FBUztJQUNULHVCQUF1QixFQUFFLHFEQUFrQztJQUMzRCxzQkFBc0IsRUFBRSxxREFBa0M7SUFDMUQsb0JBQW9CLEVBQUUscURBQWtDO0lBRXhELFVBQVU7SUFDVix3QkFBd0IsRUFBRSx1REFBMkI7SUFDckQscUNBQXFDLEVBQUUsdURBQTJCO0lBQ2xFLDZCQUE2QixFQUFFLHVEQUEyQjtJQUMxRCxzQkFBc0IsRUFBRSx1REFBMkI7SUFFbkQsMEJBQTBCLEVBQUUsNkNBQThCO0lBQzFELHlCQUF5QixFQUFFLDBEQUFvQztJQUMvRCxrQ0FBa0MsRUFBRSwrREFBZ0M7SUFDcEUsNkJBQTZCLEVBQUUsOERBQXNDO0lBQ3JFLGtCQUFrQixFQUFFLEtBQUssRUFDdkIsU0FBaUIsRUFDakIsTUFBbUMsRUFDbkMsbUJBQW1ELEVBQ3JCLEVBQUU7UUFDaEMsNEVBQTRFO1FBQzVFLElBQUksTUFBTSxJQUFBLGlFQUF5QyxFQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsbUJBQW1CLENBQUMsRUFBRSxDQUFDO1lBQzVGLE9BQU8sRUFBRSxDQUFDO1FBQ1osQ0FBQztRQUVELE9BQU8sSUFB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ZUFBSyxFQUNILFNBQVMsRUFDVCxLQUFLLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUNmLEtBQUssQ0FBQyxHQUFHLENBQ1Asd0hBQXdILENBQ3pILENBQ0YsQ0FBQztJQUNKLENBQUM7U0FBTSxDQUFDO1FBQ04sSUFBQSxlQUFLLEVBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsS0FBSyxDQUFDLEdBQUcsQ0FBQyxvREFBb0QsQ0FBQyxDQUFDLENBQUM7SUFDckcsQ0FBQztJQUVELEtBQUssTUFBTSxNQUFNLElBQUksc0JBQXNCLEVBQUUsQ0FBQztRQUM1QyxNQUFNLENBQUMsZUFBZSxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQy9CLENBQUMsQ0FBQyxJQUFBLGVBQUssRUFDTCwrREFBK0QsRUFDL0QsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLEVBQzVCLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUMvQixLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsRUFDbEMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQ3pCO1lBQ0QsQ0FBQyxDQUFDLElBQUEsZUFBSyxFQUNMLHlDQUF5QyxFQUN6QyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsRUFDNUIsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEVBQy9CLEtBQUssQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUN6QixDQUFDO0lBQ04sQ0FBQztJQUVELElBQUEsZUFBSyxFQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsVUFBVTtBQUN2QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2ZuX2RpZmYgZnJvbSAnQGF3cy1jZGsvY2xvdWRmb3JtYXRpb24tZGlmZic7XG5pbXBvcnQgKiBhcyBjeGFwaSBmcm9tICdAYXdzLWNkay9jeC1hcGknO1xuaW1wb3J0IHsgV2FpdGVyUmVzdWx0IH0gZnJvbSAnQHNtaXRoeS91dGlsLXdhaXRlcic7XG5pbXBvcnQgKiBhcyBjaGFsayBmcm9tICdjaGFsayc7XG5pbXBvcnQgdHlwZSB7IFNESywgU2RrUHJvdmlkZXIgfSBmcm9tICcuL2F3cy1hdXRoJztcbmltcG9ydCB0eXBlIHsgU3VjY2Vzc2Z1bERlcGxveVN0YWNrUmVzdWx0IH0gZnJvbSAnLi9kZXBsb3ktc3RhY2snO1xuaW1wb3J0IHsgRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlIH0gZnJvbSAnLi9ldmFsdWF0ZS1jbG91ZGZvcm1hdGlvbi10ZW1wbGF0ZSc7XG5pbXBvcnQgeyBwcmludCB9IGZyb20gJy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgaXNIb3Rzd2FwcGFibGVBcHBTeW5jQ2hhbmdlIH0gZnJvbSAnLi9ob3Rzd2FwL2FwcHN5bmMtbWFwcGluZy10ZW1wbGF0ZXMnO1xuaW1wb3J0IHsgaXNIb3Rzd2FwcGFibGVDb2RlQnVpbGRQcm9qZWN0Q2hhbmdlIH0gZnJvbSAnLi9ob3Rzd2FwL2NvZGUtYnVpbGQtcHJvamVjdHMnO1xuaW1wb3J0IHtcbiAgSUNPTixcbiAgQ2hhbmdlSG90c3dhcFJlc3VsdCxcbiAgSG90c3dhcE1vZGUsXG4gIEhvdHN3YXBwYWJsZUNoYW5nZSxcbiAgTm9uSG90c3dhcHBhYmxlQ2hhbmdlLFxuICBIb3Rzd2FwcGFibGVDaGFuZ2VDYW5kaWRhdGUsXG4gIEhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcywgQ2xhc3NpZmllZFJlc291cmNlQ2hhbmdlcyxcbiAgcmVwb3J0Tm9uSG90c3dhcHBhYmxlQ2hhbmdlLFxuICByZXBvcnROb25Ib3Rzd2FwcGFibGVSZXNvdXJjZSxcbn0gZnJvbSAnLi9ob3Rzd2FwL2NvbW1vbic7XG5pbXBvcnQgeyBpc0hvdHN3YXBwYWJsZUVjc1NlcnZpY2VDaGFuZ2UgfSBmcm9tICcuL2hvdHN3YXAvZWNzLXNlcnZpY2VzJztcbmltcG9ydCB7IGlzSG90c3dhcHBhYmxlTGFtYmRhRnVuY3Rpb25DaGFuZ2UgfSBmcm9tICcuL2hvdHN3YXAvbGFtYmRhLWZ1bmN0aW9ucyc7XG5pbXBvcnQge1xuICBza2lwQ2hhbmdlRm9yUzNEZXBsb3lDdXN0b21SZXNvdXJjZVBvbGljeSxcbiAgaXNIb3Rzd2FwcGFibGVTM0J1Y2tldERlcGxveW1lbnRDaGFuZ2UsXG59IGZyb20gJy4vaG90c3dhcC9zMy1idWNrZXQtZGVwbG95bWVudHMnO1xuaW1wb3J0IHsgaXNIb3Rzd2FwcGFibGVTdGF0ZU1hY2hpbmVDaGFuZ2UgfSBmcm9tICcuL2hvdHN3YXAvc3RlcGZ1bmN0aW9ucy1zdGF0ZS1tYWNoaW5lcyc7XG5pbXBvcnQgeyBOZXN0ZWRTdGFja1RlbXBsYXRlcywgbG9hZEN1cnJlbnRUZW1wbGF0ZVdpdGhOZXN0ZWRTdGFja3MgfSBmcm9tICcuL25lc3RlZC1zdGFjay1oZWxwZXJzJztcbmltcG9ydCB7IE1vZGUgfSBmcm9tICcuL3BsdWdpbic7XG5pbXBvcnQgeyBDbG91ZEZvcm1hdGlvblN0YWNrIH0gZnJvbSAnLi91dGlsL2Nsb3VkZm9ybWF0aW9uJztcblxuLy8gTXVzdCB1c2UgYSByZXF1aXJlKCkgb3RoZXJ3aXNlIGVzYnVpbGQgY29tcGxhaW5zIGFib3V0IGNhbGxpbmcgYSBuYW1lc3BhY2Vcbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tcmVxdWlyZS1pbXBvcnRzXG5jb25zdCBwTGltaXQ6IHR5cGVvZiBpbXBvcnQoJ3AtbGltaXQnKSA9IHJlcXVpcmUoJ3AtbGltaXQnKTtcblxudHlwZSBIb3Rzd2FwRGV0ZWN0b3IgPSAoXG4gIGxvZ2ljYWxJZDogc3RyaW5nLFxuICBjaGFuZ2U6IEhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSxcbiAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuICBob3Rzd2FwUHJvcGVydHlPdmVycmlkZXM6IEhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcyxcbikgPT4gUHJvbWlzZTxDaGFuZ2VIb3Rzd2FwUmVzdWx0PjtcblxuY29uc3QgUkVTT1VSQ0VfREVURUNUT1JTOiB7IFtrZXk6IHN0cmluZ106IEhvdHN3YXBEZXRlY3RvciB9ID0ge1xuICAvLyBMYW1iZGFcbiAgJ0FXUzo6TGFtYmRhOjpGdW5jdGlvbic6IGlzSG90c3dhcHBhYmxlTGFtYmRhRnVuY3Rpb25DaGFuZ2UsXG4gICdBV1M6OkxhbWJkYTo6VmVyc2lvbic6IGlzSG90c3dhcHBhYmxlTGFtYmRhRnVuY3Rpb25DaGFuZ2UsXG4gICdBV1M6OkxhbWJkYTo6QWxpYXMnOiBpc0hvdHN3YXBwYWJsZUxhbWJkYUZ1bmN0aW9uQ2hhbmdlLFxuXG4gIC8vIEFwcFN5bmNcbiAgJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInOiBpc0hvdHN3YXBwYWJsZUFwcFN5bmNDaGFuZ2UsXG4gICdBV1M6OkFwcFN5bmM6OkZ1bmN0aW9uQ29uZmlndXJhdGlvbic6IGlzSG90c3dhcHBhYmxlQXBwU3luY0NoYW5nZSxcbiAgJ0FXUzo6QXBwU3luYzo6R3JhcGhRTFNjaGVtYSc6IGlzSG90c3dhcHBhYmxlQXBwU3luY0NoYW5nZSxcbiAgJ0FXUzo6QXBwU3luYzo6QXBpS2V5JzogaXNIb3Rzd2FwcGFibGVBcHBTeW5jQ2hhbmdlLFxuXG4gICdBV1M6OkVDUzo6VGFza0RlZmluaXRpb24nOiBpc0hvdHN3YXBwYWJsZUVjc1NlcnZpY2VDaGFuZ2UsXG4gICdBV1M6OkNvZGVCdWlsZDo6UHJvamVjdCc6IGlzSG90c3dhcHBhYmxlQ29kZUJ1aWxkUHJvamVjdENoYW5nZSxcbiAgJ0FXUzo6U3RlcEZ1bmN0aW9uczo6U3RhdGVNYWNoaW5lJzogaXNIb3Rzd2FwcGFibGVTdGF0ZU1hY2hpbmVDaGFuZ2UsXG4gICdDdXN0b206OkNES0J1Y2tldERlcGxveW1lbnQnOiBpc0hvdHN3YXBwYWJsZVMzQnVja2V0RGVwbG95bWVudENoYW5nZSxcbiAgJ0FXUzo6SUFNOjpQb2xpY3knOiBhc3luYyAoXG4gICAgbG9naWNhbElkOiBzdHJpbmcsXG4gICAgY2hhbmdlOiBIb3Rzd2FwcGFibGVDaGFuZ2VDYW5kaWRhdGUsXG4gICAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuICApOiBQcm9taXNlPENoYW5nZUhvdHN3YXBSZXN1bHQ+ID0+IHtcbiAgICAvLyBJZiB0aGUgcG9saWN5IGlzIGZvciBhIFMzQnVja2V0RGVwbG95bWVudENoYW5nZSwgd2UgY2FuIGlnbm9yZSB0aGUgY2hhbmdlXG4gICAgaWYgKGF3YWl0IHNraXBDaGFuZ2VGb3JTM0RlcGxveUN1c3RvbVJlc291cmNlUG9saWN5KGxvZ2ljYWxJZCwgY2hhbmdlLCBldmFsdWF0ZUNmblRlbXBsYXRlKSkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIHJldHVybiByZXBvcnROb25Ib3Rzd2FwcGFibGVSZXNvdXJjZShjaGFuZ2UsICdUaGlzIHJlc291cmNlIHR5cGUgaXMgbm90IHN1cHBvcnRlZCBmb3IgaG90c3dhcCBkZXBsb3ltZW50cycpO1xuICB9LFxuXG4gICdBV1M6OkNESzo6TWV0YWRhdGEnOiBhc3luYyAoKSA9PiBbXSxcbn07XG5cbi8qKlxuICogUGVyZm9ybSBhIGhvdHN3YXAgZGVwbG95bWVudCwgc2hvcnQtY2lyY3VpdGluZyBDbG91ZEZvcm1hdGlvbiBpZiBwb3NzaWJsZS5cbiAqIElmIGl0J3Mgbm90IHBvc3NpYmxlIHRvIHNob3J0LWNpcmN1aXQgdGhlIGRlcGxveW1lbnRcbiAqIChiZWNhdXNlIHRoZSBDREsgU3RhY2sgY29udGFpbnMgY2hhbmdlcyB0aGF0IGNhbm5vdCBiZSBkZXBsb3llZCB3aXRob3V0IENsb3VkRm9ybWF0aW9uKSxcbiAqIHJldHVybnMgYHVuZGVmaW5lZGAuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB0cnlIb3Rzd2FwRGVwbG95bWVudChcbiAgc2RrUHJvdmlkZXI6IFNka1Byb3ZpZGVyLFxuICBhc3NldFBhcmFtczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSxcbiAgY2xvdWRGb3JtYXRpb25TdGFjazogQ2xvdWRGb3JtYXRpb25TdGFjayxcbiAgc3RhY2tBcnRpZmFjdDogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0LFxuICBob3Rzd2FwTW9kZTogSG90c3dhcE1vZGUsIGhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlczogSG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzLFxuKTogUHJvbWlzZTxTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQgfCB1bmRlZmluZWQ+IHtcbiAgLy8gcmVzb2x2ZSB0aGUgZW52aXJvbm1lbnQsIHNvIHdlIGNhbiBzdWJzdGl0dXRlIHRoaW5ncyBsaWtlIEFXUzo6UmVnaW9uIGluIENGTiBleHByZXNzaW9uc1xuICBjb25zdCByZXNvbHZlZEVudiA9IGF3YWl0IHNka1Byb3ZpZGVyLnJlc29sdmVFbnZpcm9ubWVudChzdGFja0FydGlmYWN0LmVudmlyb25tZW50KTtcbiAgLy8gY3JlYXRlIGEgbmV3IFNESyB1c2luZyB0aGUgQ0xJIGNyZWRlbnRpYWxzLCBiZWNhdXNlIHRoZSBkZWZhdWx0IG9uZSB3aWxsIG5vdCB3b3JrIGZvciBuZXctc3R5bGUgc3ludGhlc2lzIC1cbiAgLy8gaXQgYXNzdW1lcyB0aGUgYm9vdHN0cmFwIGRlcGxveSBSb2xlLCB3aGljaCBkb2Vzbid0IGhhdmUgcGVybWlzc2lvbnMgdG8gdXBkYXRlIExhbWJkYSBmdW5jdGlvbnNcbiAgY29uc3Qgc2RrID0gKGF3YWl0IHNka1Byb3ZpZGVyLmZvckVudmlyb25tZW50KHJlc29sdmVkRW52LCBNb2RlLkZvcldyaXRpbmcpKS5zZGs7XG5cbiAgY29uc3QgY3VycmVudFRlbXBsYXRlID0gYXdhaXQgbG9hZEN1cnJlbnRUZW1wbGF0ZVdpdGhOZXN0ZWRTdGFja3Moc3RhY2tBcnRpZmFjdCwgc2RrKTtcblxuICBjb25zdCBldmFsdWF0ZUNmblRlbXBsYXRlID0gbmV3IEV2YWx1YXRlQ2xvdWRGb3JtYXRpb25UZW1wbGF0ZSh7XG4gICAgc3RhY2tOYW1lOiBzdGFja0FydGlmYWN0LnN0YWNrTmFtZSxcbiAgICB0ZW1wbGF0ZTogc3RhY2tBcnRpZmFjdC50ZW1wbGF0ZSxcbiAgICBwYXJhbWV0ZXJzOiBhc3NldFBhcmFtcyxcbiAgICBhY2NvdW50OiByZXNvbHZlZEVudi5hY2NvdW50LFxuICAgIHJlZ2lvbjogcmVzb2x2ZWRFbnYucmVnaW9uLFxuICAgIHBhcnRpdGlvbjogKGF3YWl0IHNkay5jdXJyZW50QWNjb3VudCgpKS5wYXJ0aXRpb24sXG4gICAgc2RrLFxuICAgIG5lc3RlZFN0YWNrczogY3VycmVudFRlbXBsYXRlLm5lc3RlZFN0YWNrcyxcbiAgfSk7XG5cbiAgY29uc3Qgc3RhY2tDaGFuZ2VzID0gY2ZuX2RpZmYuZnVsbERpZmYoY3VycmVudFRlbXBsYXRlLmRlcGxveWVkUm9vdFRlbXBsYXRlLCBzdGFja0FydGlmYWN0LnRlbXBsYXRlKTtcbiAgY29uc3QgeyBob3Rzd2FwcGFibGVDaGFuZ2VzLCBub25Ib3Rzd2FwcGFibGVDaGFuZ2VzIH0gPSBhd2FpdCBjbGFzc2lmeVJlc291cmNlQ2hhbmdlcyhcbiAgICBzdGFja0NoYW5nZXMsXG4gICAgZXZhbHVhdGVDZm5UZW1wbGF0ZSxcbiAgICBzZGssXG4gICAgY3VycmVudFRlbXBsYXRlLm5lc3RlZFN0YWNrcywgaG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzLFxuICApO1xuXG4gIGxvZ05vbkhvdHN3YXBwYWJsZUNoYW5nZXMobm9uSG90c3dhcHBhYmxlQ2hhbmdlcywgaG90c3dhcE1vZGUpO1xuXG4gIC8vIHByZXNlcnZlIGNsYXNzaWMgaG90c3dhcCBiZWhhdmlvclxuICBpZiAoaG90c3dhcE1vZGUgPT09IEhvdHN3YXBNb2RlLkZBTExfQkFDSykge1xuICAgIGlmIChub25Ib3Rzd2FwcGFibGVDaGFuZ2VzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cbiAgLy8gYXBwbHkgdGhlIHNob3J0LWNpcmN1aXRhYmxlIGNoYW5nZXNcbiAgYXdhaXQgYXBwbHlBbGxIb3Rzd2FwcGFibGVDaGFuZ2VzKHNkaywgaG90c3dhcHBhYmxlQ2hhbmdlcyk7XG5cbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnZGlkLWRlcGxveS1zdGFjaycsXG4gICAgbm9PcDogaG90c3dhcHBhYmxlQ2hhbmdlcy5sZW5ndGggPT09IDAsXG4gICAgc3RhY2tBcm46IGNsb3VkRm9ybWF0aW9uU3RhY2suc3RhY2tJZCxcbiAgICBvdXRwdXRzOiBjbG91ZEZvcm1hdGlvblN0YWNrLm91dHB1dHMsXG4gIH07XG59XG5cbi8qKlxuICogQ2xhc3NpZmllcyBhbGwgY2hhbmdlcyB0byBhbGwgcmVzb3VyY2VzIGFzIGVpdGhlciBob3Rzd2FwcGFibGUgb3Igbm90LlxuICogTWV0YWRhdGEgY2hhbmdlcyBhcmUgZXhjbHVkZWQgZnJvbSB0aGUgbGlzdCBvZiAobm9uKWhvdHN3YXBwYWJsZSByZXNvdXJjZXMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNsYXNzaWZ5UmVzb3VyY2VDaGFuZ2VzKFxuICBzdGFja0NoYW5nZXM6IGNmbl9kaWZmLlRlbXBsYXRlRGlmZixcbiAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuICBzZGs6IFNESyxcbiAgbmVzdGVkU3RhY2tOYW1lczogeyBbbmVzdGVkU3RhY2tOYW1lOiBzdHJpbmddOiBOZXN0ZWRTdGFja1RlbXBsYXRlcyB9LFxuICBob3Rzd2FwUHJvcGVydHlPdmVycmlkZXM6IEhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcyxcbik6IFByb21pc2U8Q2xhc3NpZmllZFJlc291cmNlQ2hhbmdlcz4ge1xuICBjb25zdCByZXNvdXJjZURpZmZlcmVuY2VzID0gZ2V0U3RhY2tSZXNvdXJjZURpZmZlcmVuY2VzKHN0YWNrQ2hhbmdlcyk7XG5cbiAgY29uc3QgcHJvbWlzZXM6IEFycmF5PCgpID0+IFByb21pc2U8Q2hhbmdlSG90c3dhcFJlc3VsdD4+ID0gW107XG4gIGNvbnN0IGhvdHN3YXBwYWJsZVJlc291cmNlcyA9IG5ldyBBcnJheTxIb3Rzd2FwcGFibGVDaGFuZ2U+KCk7XG4gIGNvbnN0IG5vbkhvdHN3YXBwYWJsZVJlc291cmNlcyA9IG5ldyBBcnJheTxOb25Ib3Rzd2FwcGFibGVDaGFuZ2U+KCk7XG4gIGZvciAoY29uc3QgbG9naWNhbElkIG9mIE9iamVjdC5rZXlzKHN0YWNrQ2hhbmdlcy5vdXRwdXRzLmNoYW5nZXMpKSB7XG4gICAgbm9uSG90c3dhcHBhYmxlUmVzb3VyY2VzLnB1c2goe1xuICAgICAgaG90c3dhcHBhYmxlOiBmYWxzZSxcbiAgICAgIHJlYXNvbjogJ291dHB1dCB3YXMgY2hhbmdlZCcsXG4gICAgICBsb2dpY2FsSWQsXG4gICAgICByZWplY3RlZENoYW5nZXM6IFtdLFxuICAgICAgcmVzb3VyY2VUeXBlOiAnU3RhY2sgT3V0cHV0JyxcbiAgICB9KTtcbiAgfVxuICAvLyBnYXRoZXIgdGhlIHJlc3VsdHMgb2YgdGhlIGRldGVjdG9yIGZ1bmN0aW9uc1xuICBmb3IgKGNvbnN0IFtsb2dpY2FsSWQsIGNoYW5nZV0gb2YgT2JqZWN0LmVudHJpZXMocmVzb3VyY2VEaWZmZXJlbmNlcykpIHtcbiAgICBpZiAoY2hhbmdlLm5ld1ZhbHVlPy5UeXBlID09PSAnQVdTOjpDbG91ZEZvcm1hdGlvbjo6U3RhY2snICYmIGNoYW5nZS5vbGRWYWx1ZT8uVHlwZSA9PT0gJ0FXUzo6Q2xvdWRGb3JtYXRpb246OlN0YWNrJykge1xuICAgICAgY29uc3QgbmVzdGVkSG90c3dhcHBhYmxlUmVzb3VyY2VzID0gYXdhaXQgZmluZE5lc3RlZEhvdHN3YXBwYWJsZUNoYW5nZXMoXG4gICAgICAgIGxvZ2ljYWxJZCxcbiAgICAgICAgY2hhbmdlLFxuICAgICAgICBuZXN0ZWRTdGFja05hbWVzLFxuICAgICAgICBldmFsdWF0ZUNmblRlbXBsYXRlLFxuICAgICAgICBzZGssXG4gICAgICAgIGhvdHN3YXBQcm9wZXJ0eU92ZXJyaWRlcyxcbiAgICAgICk7XG4gICAgICBob3Rzd2FwcGFibGVSZXNvdXJjZXMucHVzaCguLi5uZXN0ZWRIb3Rzd2FwcGFibGVSZXNvdXJjZXMuaG90c3dhcHBhYmxlQ2hhbmdlcyk7XG4gICAgICBub25Ib3Rzd2FwcGFibGVSZXNvdXJjZXMucHVzaCguLi5uZXN0ZWRIb3Rzd2FwcGFibGVSZXNvdXJjZXMubm9uSG90c3dhcHBhYmxlQ2hhbmdlcyk7XG5cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSA9IGlzQ2FuZGlkYXRlRm9ySG90c3dhcHBpbmcoY2hhbmdlLCBsb2dpY2FsSWQpO1xuICAgIC8vIHdlIGRvbid0IG5lZWQgdG8gcnVuIHRoaXMgdGhyb3VnaCB0aGUgZGV0ZWN0b3IgZnVuY3Rpb25zLCB3ZSBjYW4gYWxyZWFkeSBqdWRnZSB0aGlzXG4gICAgaWYgKCdob3Rzd2FwcGFibGUnIGluIGhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSkge1xuICAgICAgaWYgKCFob3Rzd2FwcGFibGVDaGFuZ2VDYW5kaWRhdGUuaG90c3dhcHBhYmxlKSB7XG4gICAgICAgIG5vbkhvdHN3YXBwYWJsZVJlc291cmNlcy5wdXNoKGhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc291cmNlVHlwZTogc3RyaW5nID0gaG90c3dhcHBhYmxlQ2hhbmdlQ2FuZGlkYXRlLm5ld1ZhbHVlLlR5cGU7XG4gICAgaWYgKHJlc291cmNlVHlwZSBpbiBSRVNPVVJDRV9ERVRFQ1RPUlMpIHtcbiAgICAgIC8vIHJ1biBkZXRlY3RvciBmdW5jdGlvbnMgbGF6aWx5IHRvIHByZXZlbnQgdW5oYW5kbGVkIHByb21pc2UgcmVqZWN0aW9uc1xuICAgICAgcHJvbWlzZXMucHVzaCgoKSA9PlxuICAgICAgICBSRVNPVVJDRV9ERVRFQ1RPUlNbcmVzb3VyY2VUeXBlXShsb2dpY2FsSWQsIGhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSwgZXZhbHVhdGVDZm5UZW1wbGF0ZSwgaG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzKSxcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlcG9ydE5vbkhvdHN3YXBwYWJsZUNoYW5nZShcbiAgICAgICAgbm9uSG90c3dhcHBhYmxlUmVzb3VyY2VzLFxuICAgICAgICBob3Rzd2FwcGFibGVDaGFuZ2VDYW5kaWRhdGUsXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgJ1RoaXMgcmVzb3VyY2UgdHlwZSBpcyBub3Qgc3VwcG9ydGVkIGZvciBob3Rzd2FwIGRlcGxveW1lbnRzJyxcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgLy8gcmVzb2x2ZSBhbGwgZGV0ZWN0b3IgcmVzdWx0c1xuICBjb25zdCBjaGFuZ2VzRGV0ZWN0aW9uUmVzdWx0czogQXJyYXk8Q2hhbmdlSG90c3dhcFJlc3VsdD4gPSBbXTtcbiAgZm9yIChjb25zdCBkZXRlY3RvclJlc3VsdFByb21pc2VzIG9mIHByb21pc2VzKSB7XG4gICAgLy8gQ29uc3RhbnQgc2V0IG9mIHByb21pc2VzIHBlciByZXNvdXJjZVxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAY2RrbGFicy9wcm9taXNlYWxsLW5vLXVuYm91bmRlZC1wYXJhbGxlbGlzbVxuICAgIGNvbnN0IGhvdHN3YXBEZXRlY3Rpb25SZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGwoYXdhaXQgZGV0ZWN0b3JSZXN1bHRQcm9taXNlcygpKTtcbiAgICBjaGFuZ2VzRGV0ZWN0aW9uUmVzdWx0cy5wdXNoKGhvdHN3YXBEZXRlY3Rpb25SZXN1bHRzKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgcmVzb3VyY2VEZXRlY3Rpb25SZXN1bHRzIG9mIGNoYW5nZXNEZXRlY3Rpb25SZXN1bHRzKSB7XG4gICAgZm9yIChjb25zdCBwcm9wZXJ0eVJlc3VsdCBvZiByZXNvdXJjZURldGVjdGlvblJlc3VsdHMpIHtcbiAgICAgIHByb3BlcnR5UmVzdWx0LmhvdHN3YXBwYWJsZVxuICAgICAgICA/IGhvdHN3YXBwYWJsZVJlc291cmNlcy5wdXNoKHByb3BlcnR5UmVzdWx0KVxuICAgICAgICA6IG5vbkhvdHN3YXBwYWJsZVJlc291cmNlcy5wdXNoKHByb3BlcnR5UmVzdWx0KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGhvdHN3YXBwYWJsZUNoYW5nZXM6IGhvdHN3YXBwYWJsZVJlc291cmNlcyxcbiAgICBub25Ib3Rzd2FwcGFibGVDaGFuZ2VzOiBub25Ib3Rzd2FwcGFibGVSZXNvdXJjZXMsXG4gIH07XG59XG5cbi8qKlxuICogUmV0dXJucyBhbGwgY2hhbmdlcyB0byByZXNvdXJjZXMgaW4gdGhlIGdpdmVuIFN0YWNrLlxuICpcbiAqIEBwYXJhbSBzdGFja0NoYW5nZXMgdGhlIGNvbGxlY3Rpb24gb2YgYWxsIGNoYW5nZXMgdG8gYSBnaXZlbiBTdGFja1xuICovXG5mdW5jdGlvbiBnZXRTdGFja1Jlc291cmNlRGlmZmVyZW5jZXMoc3RhY2tDaGFuZ2VzOiBjZm5fZGlmZi5UZW1wbGF0ZURpZmYpOiB7XG4gIFtsb2dpY2FsSWQ6IHN0cmluZ106IGNmbl9kaWZmLlJlc291cmNlRGlmZmVyZW5jZTtcbn0ge1xuICAvLyB3ZSBuZWVkIHRvIGNvbGxhcHNlIGxvZ2ljYWwgSUQgcmVuYW1lIGNoYW5nZXMgaW50byBvbmUgY2hhbmdlLFxuICAvLyBhcyB0aGV5IGFyZSByZXByZXNlbnRlZCBpbiBzdGFja0NoYW5nZXMgYXMgYSBwYWlyIG9mIHR3byBjaGFuZ2VzOiBvbmUgYWRkaXRpb24gYW5kIG9uZSByZW1vdmFsXG4gIGNvbnN0IGFsbFJlc291cmNlQ2hhbmdlczogeyBbbG9nSWQ6IHN0cmluZ106IGNmbl9kaWZmLlJlc291cmNlRGlmZmVyZW5jZSB9ID0gc3RhY2tDaGFuZ2VzLnJlc291cmNlcy5jaGFuZ2VzO1xuICBjb25zdCBhbGxSZW1vdmFsQ2hhbmdlcyA9IGZpbHRlckRpY3QoYWxsUmVzb3VyY2VDaGFuZ2VzLCAocmVzQ2hhbmdlKSA9PiByZXNDaGFuZ2UuaXNSZW1vdmFsKTtcbiAgY29uc3QgYWxsTm9uUmVtb3ZhbENoYW5nZXMgPSBmaWx0ZXJEaWN0KGFsbFJlc291cmNlQ2hhbmdlcywgKHJlc0NoYW5nZSkgPT4gIXJlc0NoYW5nZS5pc1JlbW92YWwpO1xuICBmb3IgKGNvbnN0IFtsb2dJZCwgbm9uUmVtb3ZhbENoYW5nZV0gb2YgT2JqZWN0LmVudHJpZXMoYWxsTm9uUmVtb3ZhbENoYW5nZXMpKSB7XG4gICAgaWYgKG5vblJlbW92YWxDaGFuZ2UuaXNBZGRpdGlvbikge1xuICAgICAgY29uc3QgYWRkQ2hhbmdlID0gbm9uUmVtb3ZhbENoYW5nZTtcbiAgICAgIC8vIHNlYXJjaCBmb3IgYW4gaWRlbnRpY2FsIHJlbW92YWwgY2hhbmdlXG4gICAgICBjb25zdCBpZGVudGljYWxSZW1vdmFsQ2hhbmdlID0gT2JqZWN0LmVudHJpZXMoYWxsUmVtb3ZhbENoYW5nZXMpLmZpbmQoKFtfLCByZW1DaGFuZ2VdKSA9PiB7XG4gICAgICAgIHJldHVybiBjaGFuZ2VzQXJlRm9yU2FtZVJlc291cmNlKHJlbUNoYW5nZSwgYWRkQ2hhbmdlKTtcbiAgICAgIH0pO1xuICAgICAgLy8gaWYgd2UgZm91bmQgb25lLCB0aGVuIHRoaXMgbWVhbnMgdGhpcyBpcyBhIHJlbmFtZSBjaGFuZ2VcbiAgICAgIGlmIChpZGVudGljYWxSZW1vdmFsQ2hhbmdlKSB7XG4gICAgICAgIGNvbnN0IFtyZW1vdmVkTG9nSWQsIHJlbW92ZWRSZXNvdXJjZUNoYW5nZV0gPSBpZGVudGljYWxSZW1vdmFsQ2hhbmdlO1xuICAgICAgICBhbGxOb25SZW1vdmFsQ2hhbmdlc1tsb2dJZF0gPSBtYWtlUmVuYW1lRGlmZmVyZW5jZShyZW1vdmVkUmVzb3VyY2VDaGFuZ2UsIGFkZENoYW5nZSk7XG4gICAgICAgIC8vIGRlbGV0ZSB0aGUgcmVtb3ZhbCBjaGFuZ2UgdGhhdCBmb3JtcyB0aGUgcmVuYW1lIHBhaXJcbiAgICAgICAgZGVsZXRlIGFsbFJlbW92YWxDaGFuZ2VzW3JlbW92ZWRMb2dJZF07XG4gICAgICB9XG4gICAgfVxuICB9XG4gIC8vIHRoZSBmaW5hbCByZXN1bHQgYXJlIGFsbCBvZiB0aGUgcmVtYWluaW5nIHJlbW92YWwgY2hhbmdlcyxcbiAgLy8gcGx1cyBhbGwgb2YgdGhlIG5vbi1yZW1vdmFsIGNoYW5nZXNcbiAgLy8gKHdlIHNhdmVkIHRoZSByZW5hbWUgY2hhbmdlcyBpbiB0aGF0IG9iamVjdCBhbHJlYWR5KVxuICByZXR1cm4ge1xuICAgIC4uLmFsbFJlbW92YWxDaGFuZ2VzLFxuICAgIC4uLmFsbE5vblJlbW92YWxDaGFuZ2VzLFxuICB9O1xufVxuXG4vKiogRmlsdGVycyBhbiBvYmplY3Qgd2l0aCBzdHJpbmcga2V5cyBiYXNlZCBvbiB3aGV0aGVyIHRoZSBjYWxsYmFjayByZXR1cm5zICd0cnVlJyBmb3IgdGhlIGdpdmVuIHZhbHVlIGluIHRoZSBvYmplY3QuICovXG5mdW5jdGlvbiBmaWx0ZXJEaWN0PFQ+KGRpY3Q6IHsgW2tleTogc3RyaW5nXTogVCB9LCBmdW5jOiAodDogVCkgPT4gYm9vbGVhbik6IHsgW2tleTogc3RyaW5nXTogVCB9IHtcbiAgcmV0dXJuIE9iamVjdC5lbnRyaWVzKGRpY3QpLnJlZHVjZShcbiAgICAoYWNjLCBba2V5LCB0XSkgPT4ge1xuICAgICAgaWYgKGZ1bmModCkpIHtcbiAgICAgICAgYWNjW2tleV0gPSB0O1xuICAgICAgfVxuICAgICAgcmV0dXJuIGFjYztcbiAgICB9LFxuICAgIHt9IGFzIHsgW2tleTogc3RyaW5nXTogVCB9LFxuICApO1xufVxuXG4vKiogRmluZHMgYW55IGhvdHN3YXBwYWJsZSBjaGFuZ2VzIGluIGFsbCBuZXN0ZWQgc3RhY2tzLiAqL1xuYXN5bmMgZnVuY3Rpb24gZmluZE5lc3RlZEhvdHN3YXBwYWJsZUNoYW5nZXMoXG4gIGxvZ2ljYWxJZDogc3RyaW5nLFxuICBjaGFuZ2U6IGNmbl9kaWZmLlJlc291cmNlRGlmZmVyZW5jZSxcbiAgbmVzdGVkU3RhY2tUZW1wbGF0ZXM6IHsgW25lc3RlZFN0YWNrTmFtZTogc3RyaW5nXTogTmVzdGVkU3RhY2tUZW1wbGF0ZXMgfSxcbiAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuICBzZGs6IFNESyxcbiAgaG90c3dhcFByb3BlcnR5T3ZlcnJpZGVzOiBIb3Rzd2FwUHJvcGVydHlPdmVycmlkZXMsXG4pOiBQcm9taXNlPENsYXNzaWZpZWRSZXNvdXJjZUNoYW5nZXM+IHtcbiAgY29uc3QgbmVzdGVkU3RhY2sgPSBuZXN0ZWRTdGFja1RlbXBsYXRlc1tsb2dpY2FsSWRdO1xuICBpZiAoIW5lc3RlZFN0YWNrLnBoeXNpY2FsTmFtZSkge1xuICAgIHJldHVybiB7XG4gICAgICBob3Rzd2FwcGFibGVDaGFuZ2VzOiBbXSxcbiAgICAgIG5vbkhvdHN3YXBwYWJsZUNoYW5nZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGhvdHN3YXBwYWJsZTogZmFsc2UsXG4gICAgICAgICAgbG9naWNhbElkLFxuICAgICAgICAgIHJlYXNvbjogYHBoeXNpY2FsIG5hbWUgZm9yIEFXUzo6Q2xvdWRGb3JtYXRpb246OlN0YWNrICcke2xvZ2ljYWxJZH0nIGNvdWxkIG5vdCBiZSBmb3VuZCBpbiBDbG91ZEZvcm1hdGlvbiwgc28gdGhpcyBpcyBhIG5ld2x5IGNyZWF0ZWQgbmVzdGVkIHN0YWNrIGFuZCBjYW5ub3QgYmUgaG90c3dhcHBlZGAsXG4gICAgICAgICAgcmVqZWN0ZWRDaGFuZ2VzOiBbXSxcbiAgICAgICAgICByZXNvdXJjZVR5cGU6ICdBV1M6OkNsb3VkRm9ybWF0aW9uOjpTdGFjaycsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH07XG4gIH1cblxuICBjb25zdCBldmFsdWF0ZU5lc3RlZENmblRlbXBsYXRlID0gYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5jcmVhdGVOZXN0ZWRFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUoXG4gICAgbmVzdGVkU3RhY2sucGh5c2ljYWxOYW1lLFxuICAgIG5lc3RlZFN0YWNrLmdlbmVyYXRlZFRlbXBsYXRlLFxuICAgIGNoYW5nZS5uZXdWYWx1ZT8uUHJvcGVydGllcz8uUGFyYW1ldGVycyxcbiAgKTtcblxuICBjb25zdCBuZXN0ZWREaWZmID0gY2ZuX2RpZmYuZnVsbERpZmYoXG4gICAgbmVzdGVkU3RhY2tUZW1wbGF0ZXNbbG9naWNhbElkXS5kZXBsb3llZFRlbXBsYXRlLFxuICAgIG5lc3RlZFN0YWNrVGVtcGxhdGVzW2xvZ2ljYWxJZF0uZ2VuZXJhdGVkVGVtcGxhdGUsXG4gICk7XG5cbiAgcmV0dXJuIGNsYXNzaWZ5UmVzb3VyY2VDaGFuZ2VzKFxuICAgIG5lc3RlZERpZmYsXG4gICAgZXZhbHVhdGVOZXN0ZWRDZm5UZW1wbGF0ZSxcbiAgICBzZGssXG4gICAgbmVzdGVkU3RhY2tUZW1wbGF0ZXNbbG9naWNhbElkXS5uZXN0ZWRTdGFja1RlbXBsYXRlcyxcbiAgICBob3Rzd2FwUHJvcGVydHlPdmVycmlkZXMpO1xufVxuXG4vKiogUmV0dXJucyAndHJ1ZScgaWYgYSBwYWlyIG9mIGNoYW5nZXMgaXMgZm9yIHRoZSBzYW1lIHJlc291cmNlLiAqL1xuZnVuY3Rpb24gY2hhbmdlc0FyZUZvclNhbWVSZXNvdXJjZShcbiAgb2xkQ2hhbmdlOiBjZm5fZGlmZi5SZXNvdXJjZURpZmZlcmVuY2UsXG4gIG5ld0NoYW5nZTogY2ZuX2RpZmYuUmVzb3VyY2VEaWZmZXJlbmNlLFxuKTogYm9vbGVhbiB7XG4gIHJldHVybiAoXG4gICAgb2xkQ2hhbmdlLm9sZFJlc291cmNlVHlwZSA9PT0gbmV3Q2hhbmdlLm5ld1Jlc291cmNlVHlwZSAmJlxuICAgIC8vIHRoaXMgaXNuJ3QgZ3JlYXQsIGJ1dCBJIGRvbid0IHdhbnQgdG8gYnJpbmcgaW4gc29tZXRoaW5nIGxpa2UgdW5kZXJzY29yZSBqdXN0IGZvciB0aGlzIGNvbXBhcmlzb25cbiAgICBKU09OLnN0cmluZ2lmeShvbGRDaGFuZ2Uub2xkUHJvcGVydGllcykgPT09IEpTT04uc3RyaW5naWZ5KG5ld0NoYW5nZS5uZXdQcm9wZXJ0aWVzKVxuICApO1xufVxuXG5mdW5jdGlvbiBtYWtlUmVuYW1lRGlmZmVyZW5jZShcbiAgcmVtQ2hhbmdlOiBjZm5fZGlmZi5SZXNvdXJjZURpZmZlcmVuY2UsXG4gIGFkZENoYW5nZTogY2ZuX2RpZmYuUmVzb3VyY2VEaWZmZXJlbmNlLFxuKTogY2ZuX2RpZmYuUmVzb3VyY2VEaWZmZXJlbmNlIHtcbiAgcmV0dXJuIG5ldyBjZm5fZGlmZi5SZXNvdXJjZURpZmZlcmVuY2UoXG4gICAgLy8gd2UgaGF2ZSB0byBmaWxsIGluIHRoZSBvbGQgdmFsdWUsIGJlY2F1c2Ugb3RoZXJ3aXNlIHRoaXMgd2lsbCBiZSBjbGFzc2lmaWVkIGFzIGEgbm9uLWhvdHN3YXBwYWJsZSBjaGFuZ2VcbiAgICByZW1DaGFuZ2Uub2xkVmFsdWUsXG4gICAgYWRkQ2hhbmdlLm5ld1ZhbHVlLFxuICAgIHtcbiAgICAgIHJlc291cmNlVHlwZToge1xuICAgICAgICBvbGRUeXBlOiByZW1DaGFuZ2Uub2xkUmVzb3VyY2VUeXBlLFxuICAgICAgICBuZXdUeXBlOiBhZGRDaGFuZ2UubmV3UmVzb3VyY2VUeXBlLFxuICAgICAgfSxcbiAgICAgIHByb3BlcnR5RGlmZnM6IChhZGRDaGFuZ2UgYXMgYW55KS5wcm9wZXJ0eURpZmZzLFxuICAgICAgb3RoZXJEaWZmczogKGFkZENoYW5nZSBhcyBhbnkpLm90aGVyRGlmZnMsXG4gICAgfSxcbiAgKTtcbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgYEhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZWAgaWYgdGhlIGNoYW5nZSBpcyBob3Rzd2FwcGFibGVcbiAqIFJldHVybnMgYW4gZW1wdHkgYEhvdHN3YXBwYWJsZUNoYW5nZWAgaWYgdGhlIGNoYW5nZSBpcyB0byBDREs6Ok1ldGFkYXRhXG4gKiBSZXR1cm5zIGEgYE5vbkhvdHN3YXBwYWJsZUNoYW5nZWAgaWYgdGhlIGNoYW5nZSBpcyBub3QgaG90c3dhcHBhYmxlXG4gKi9cbmZ1bmN0aW9uIGlzQ2FuZGlkYXRlRm9ySG90c3dhcHBpbmcoXG4gIGNoYW5nZTogY2ZuX2RpZmYuUmVzb3VyY2VEaWZmZXJlbmNlLFxuICBsb2dpY2FsSWQ6IHN0cmluZyxcbik6IEhvdHN3YXBwYWJsZUNoYW5nZSB8IE5vbkhvdHN3YXBwYWJsZUNoYW5nZSB8IEhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSB7XG4gIC8vIGEgcmVzb3VyY2UgaGFzIGJlZW4gcmVtb3ZlZCBPUiBhIHJlc291cmNlIGhhcyBiZWVuIGFkZGVkOyB3ZSBjYW4ndCBzaG9ydC1jaXJjdWl0IHRoYXQgY2hhbmdlXG4gIGlmICghY2hhbmdlLm9sZFZhbHVlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhvdHN3YXBwYWJsZTogZmFsc2UsXG4gICAgICByZXNvdXJjZVR5cGU6IGNoYW5nZS5uZXdWYWx1ZSEuVHlwZSxcbiAgICAgIGxvZ2ljYWxJZCxcbiAgICAgIHJlamVjdGVkQ2hhbmdlczogW10sXG4gICAgICByZWFzb246IGByZXNvdXJjZSAnJHtsb2dpY2FsSWR9JyB3YXMgY3JlYXRlZCBieSB0aGlzIGRlcGxveW1lbnRgLFxuICAgIH07XG4gIH0gZWxzZSBpZiAoIWNoYW5nZS5uZXdWYWx1ZSkge1xuICAgIHJldHVybiB7XG4gICAgICBob3Rzd2FwcGFibGU6IGZhbHNlLFxuICAgICAgcmVzb3VyY2VUeXBlOiBjaGFuZ2Uub2xkVmFsdWUhLlR5cGUsXG4gICAgICBsb2dpY2FsSWQsXG4gICAgICByZWplY3RlZENoYW5nZXM6IFtdLFxuICAgICAgcmVhc29uOiBgcmVzb3VyY2UgJyR7bG9naWNhbElkfScgd2FzIGRlc3Ryb3llZCBieSB0aGlzIGRlcGxveW1lbnRgLFxuICAgIH07XG4gIH1cblxuICAvLyBhIHJlc291cmNlIGhhcyBoYWQgaXRzIHR5cGUgY2hhbmdlZFxuICBpZiAoY2hhbmdlLm5ld1ZhbHVlPy5UeXBlICE9PSBjaGFuZ2Uub2xkVmFsdWU/LlR5cGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgaG90c3dhcHBhYmxlOiBmYWxzZSxcbiAgICAgIHJlc291cmNlVHlwZTogY2hhbmdlLm5ld1ZhbHVlPy5UeXBlLFxuICAgICAgbG9naWNhbElkLFxuICAgICAgcmVqZWN0ZWRDaGFuZ2VzOiBbXSxcbiAgICAgIHJlYXNvbjogYHJlc291cmNlICcke2xvZ2ljYWxJZH0nIGhhZCBpdHMgdHlwZSBjaGFuZ2VkIGZyb20gJyR7Y2hhbmdlLm9sZFZhbHVlPy5UeXBlfScgdG8gJyR7Y2hhbmdlLm5ld1ZhbHVlPy5UeXBlfSdgLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGxvZ2ljYWxJZCxcbiAgICBvbGRWYWx1ZTogY2hhbmdlLm9sZFZhbHVlLFxuICAgIG5ld1ZhbHVlOiBjaGFuZ2UubmV3VmFsdWUsXG4gICAgcHJvcGVydHlVcGRhdGVzOiBjaGFuZ2UucHJvcGVydHlVcGRhdGVzLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBhcHBseUFsbEhvdHN3YXBwYWJsZUNoYW5nZXMoc2RrOiBTREssIGhvdHN3YXBwYWJsZUNoYW5nZXM6IEhvdHN3YXBwYWJsZUNoYW5nZVtdKTogUHJvbWlzZTx2b2lkW10+IHtcbiAgaWYgKGhvdHN3YXBwYWJsZUNoYW5nZXMubGVuZ3RoID4gMCkge1xuICAgIHByaW50KGBcXG4ke0lDT059IGhvdHN3YXBwaW5nIHJlc291cmNlczpgKTtcbiAgfVxuICBjb25zdCBsaW1pdCA9IHBMaW1pdCgxMCk7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAY2RrbGFicy9wcm9taXNlYWxsLW5vLXVuYm91bmRlZC1wYXJhbGxlbGlzbVxuICByZXR1cm4gUHJvbWlzZS5hbGwoaG90c3dhcHBhYmxlQ2hhbmdlcy5tYXAoaG90c3dhcE9wZXJhdGlvbiA9PiBsaW1pdCgoKSA9PiB7XG4gICAgcmV0dXJuIGFwcGx5SG90c3dhcHBhYmxlQ2hhbmdlKHNkaywgaG90c3dhcE9wZXJhdGlvbik7XG4gIH0pKSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFwcGx5SG90c3dhcHBhYmxlQ2hhbmdlKHNkazogU0RLLCBob3Rzd2FwT3BlcmF0aW9uOiBIb3Rzd2FwcGFibGVDaGFuZ2UpOiBQcm9taXNlPHZvaWQ+IHtcbiAgLy8gbm90ZSB0aGUgdHlwZSBvZiBzZXJ2aWNlIHRoYXQgd2FzIHN1Y2Nlc3NmdWxseSBob3Rzd2FwcGVkIGluIHRoZSBVc2VyLUFnZW50XG4gIGNvbnN0IGN1c3RvbVVzZXJBZ2VudCA9IGBjZGstaG90c3dhcC9zdWNjZXNzLSR7aG90c3dhcE9wZXJhdGlvbi5zZXJ2aWNlfWA7XG4gIHNkay5hcHBlbmRDdXN0b21Vc2VyQWdlbnQoY3VzdG9tVXNlckFnZW50KTtcblxuICBmb3IgKGNvbnN0IG5hbWUgb2YgaG90c3dhcE9wZXJhdGlvbi5yZXNvdXJjZU5hbWVzKSB7XG4gICAgcHJpbnQoYCAgICR7SUNPTn0gJXNgLCBjaGFsay5ib2xkKG5hbWUpKTtcbiAgfVxuXG4gIC8vIGlmIHRoZSBTREsgY2FsbCBmYWlscywgYW4gZXJyb3Igd2lsbCBiZSB0aHJvd24gYnkgdGhlIFNES1xuICAvLyBhbmQgd2lsbCBwcmV2ZW50IHRoZSBncmVlbiAnaG90c3dhcHBlZCEnIHRleHQgZnJvbSBiZWluZyBkaXNwbGF5ZWRcbiAgdHJ5IHtcbiAgICBhd2FpdCBob3Rzd2FwT3BlcmF0aW9uLmFwcGx5KHNkayk7XG4gIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgIGlmIChlLm5hbWUgPT09ICdUaW1lb3V0RXJyb3InIHx8IGUubmFtZSA9PT0gJ0Fib3J0RXJyb3InKSB7XG4gICAgICBjb25zdCByZXN1bHQ6IFdhaXRlclJlc3VsdCA9IEpTT04ucGFyc2UoZS5tZXNzYWdlKTtcbiAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKFtcbiAgICAgICAgYFJlc291cmNlIGlzIG5vdCBpbiB0aGUgZXhwZWN0ZWQgc3RhdGUgZHVlIHRvIHdhaXRlciBzdGF0dXM6ICR7cmVzdWx0LnN0YXRlfWAsXG4gICAgICAgIHJlc3VsdC5yZWFzb24gPyBgJHtyZXN1bHQucmVhc29ufS5gIDogJycsXG4gICAgICBdLmpvaW4oJy4gJykpO1xuICAgICAgZXJyb3IubmFtZSA9IGUubmFtZTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgICB0aHJvdyBlO1xuICB9XG5cbiAgZm9yIChjb25zdCBuYW1lIG9mIGhvdHN3YXBPcGVyYXRpb24ucmVzb3VyY2VOYW1lcykge1xuICAgIHByaW50KGAke0lDT059ICVzICVzYCwgY2hhbGsuYm9sZChuYW1lKSwgY2hhbGsuZ3JlZW4oJ2hvdHN3YXBwZWQhJykpO1xuICB9XG5cbiAgc2RrLnJlbW92ZUN1c3RvbVVzZXJBZ2VudChjdXN0b21Vc2VyQWdlbnQpO1xufVxuXG5mdW5jdGlvbiBsb2dOb25Ib3Rzd2FwcGFibGVDaGFuZ2VzKG5vbkhvdHN3YXBwYWJsZUNoYW5nZXM6IE5vbkhvdHN3YXBwYWJsZUNoYW5nZVtdLCBob3Rzd2FwTW9kZTogSG90c3dhcE1vZGUpOiB2b2lkIHtcbiAgaWYgKG5vbkhvdHN3YXBwYWJsZUNoYW5nZXMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8qKlxuICAgKiBFS1MgU2VydmljZXMgY2FuIGhhdmUgYSB0YXNrIGRlZmluaXRpb24gdGhhdCBkb2Vzbid0IHJlZmVyIHRvIHRoZSB0YXNrIGRlZmluaXRpb24gYmVpbmcgdXBkYXRlZC5cbiAgICogV2UgaGF2ZSB0byBsb2cgdGhpcyBhcyBhIG5vbi1ob3Rzd2FwcGFibGUgY2hhbmdlIHRvIHRoZSB0YXNrIGRlZmluaXRpb24sIGJ1dCB3aGVuIHdlIGRvLFxuICAgKiB3ZSB3aW5kIHVwIGhvdHN3YXBwaW5nIHRoZSB0YXNrIGRlZmluaXRpb24gYW5kIGxvZ2dpbmcgaXQgYXMgYSBub24taG90c3dhcHBhYmxlIGNoYW5nZS5cbiAgICpcbiAgICogVGhpcyBsb2dpYyBwcmV2ZW50cyB1cyBmcm9tIGxvZ2dpbmcgdGhhdCBjaGFuZ2UgYXMgbm9uLWhvdHN3YXBwYWJsZSB3aGVuIHdlIGhvdHN3YXAgaXQuXG4gICAqL1xuICBpZiAoaG90c3dhcE1vZGUgPT09IEhvdHN3YXBNb2RlLkhPVFNXQVBfT05MWSkge1xuICAgIG5vbkhvdHN3YXBwYWJsZUNoYW5nZXMgPSBub25Ib3Rzd2FwcGFibGVDaGFuZ2VzLmZpbHRlcigoY2hhbmdlKSA9PiBjaGFuZ2UuaG90c3dhcE9ubHlWaXNpYmxlID09PSB0cnVlKTtcblxuICAgIGlmIChub25Ib3Rzd2FwcGFibGVDaGFuZ2VzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfVxuICBpZiAoaG90c3dhcE1vZGUgPT09IEhvdHN3YXBNb2RlLkhPVFNXQVBfT05MWSkge1xuICAgIHByaW50KFxuICAgICAgJ1xcbiVzICVzJyxcbiAgICAgIGNoYWxrLnJlZCgn4pqg77iPJyksXG4gICAgICBjaGFsay5yZWQoXG4gICAgICAgICdUaGUgZm9sbG93aW5nIG5vbi1ob3Rzd2FwcGFibGUgY2hhbmdlcyB3ZXJlIGZvdW5kLiBUbyByZWNvbmNpbGUgdGhlc2UgdXNpbmcgQ2xvdWRGb3JtYXRpb24sIHNwZWNpZnkgLS1ob3Rzd2FwLWZhbGxiYWNrJyxcbiAgICAgICksXG4gICAgKTtcbiAgfSBlbHNlIHtcbiAgICBwcmludCgnXFxuJXMgJXMnLCBjaGFsay5yZWQoJ+KaoO+4jycpLCBjaGFsay5yZWQoJ1RoZSBmb2xsb3dpbmcgbm9uLWhvdHN3YXBwYWJsZSBjaGFuZ2VzIHdlcmUgZm91bmQ6JykpO1xuICB9XG5cbiAgZm9yIChjb25zdCBjaGFuZ2Ugb2Ygbm9uSG90c3dhcHBhYmxlQ2hhbmdlcykge1xuICAgIGNoYW5nZS5yZWplY3RlZENoYW5nZXMubGVuZ3RoID4gMFxuICAgICAgPyBwcmludChcbiAgICAgICAgJyAgICBsb2dpY2FsSUQ6ICVzLCB0eXBlOiAlcywgcmVqZWN0ZWQgY2hhbmdlczogJXMsIHJlYXNvbjogJXMnLFxuICAgICAgICBjaGFsay5ib2xkKGNoYW5nZS5sb2dpY2FsSWQpLFxuICAgICAgICBjaGFsay5ib2xkKGNoYW5nZS5yZXNvdXJjZVR5cGUpLFxuICAgICAgICBjaGFsay5ib2xkKGNoYW5nZS5yZWplY3RlZENoYW5nZXMpLFxuICAgICAgICBjaGFsay5yZWQoY2hhbmdlLnJlYXNvbiksXG4gICAgICApXG4gICAgICA6IHByaW50KFxuICAgICAgICAnICAgIGxvZ2ljYWxJRDogJXMsIHR5cGU6ICVzLCByZWFzb246ICVzJyxcbiAgICAgICAgY2hhbGsuYm9sZChjaGFuZ2UubG9naWNhbElkKSxcbiAgICAgICAgY2hhbGsuYm9sZChjaGFuZ2UucmVzb3VyY2VUeXBlKSxcbiAgICAgICAgY2hhbGsucmVkKGNoYW5nZS5yZWFzb24pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaW50KCcnKTsgLy8gbmV3bGluZVxufVxuIl19