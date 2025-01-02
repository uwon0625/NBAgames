"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParameterValues = exports.TemplateParameters = exports.CloudFormationStack = void 0;
exports.waitForChangeSet = waitForChangeSet;
exports.createDiffChangeSet = createDiffChangeSet;
exports.uploadStackTemplateAssets = uploadStackTemplateAssets;
exports.cleanupOldChangeset = cleanupOldChangeset;
exports.changeSetHasNoChanges = changeSetHasNoChanges;
exports.waitForStackDelete = waitForStackDelete;
exports.waitForStackDeploy = waitForStackDeploy;
exports.stabilizeStack = stabilizeStack;
const cxapi = require("@aws-cdk/cx-api");
const cx_api_1 = require("@aws-cdk/cx-api");
const client_cloudformation_1 = require("@aws-sdk/client-cloudformation");
const cdk_assets_1 = require("cdk-assets");
const stack_status_1 = require("./cloudformation/stack-status");
const template_body_parameter_1 = require("./template-body-parameter");
const logging_1 = require("../../logging");
const serialize_1 = require("../../serialize");
const asset_manifest_builder_1 = require("../../util/asset-manifest-builder");
/**
 * Represents an (existing) Stack in CloudFormation
 *
 * Bundle and cache some information that we need during deployment (so we don't have to make
 * repeated calls to CloudFormation).
 */
class CloudFormationStack {
    static async lookup(cfn, stackName, retrieveProcessedTemplate = false) {
        try {
            const response = await cfn.describeStacks({ StackName: stackName });
            return new CloudFormationStack(cfn, stackName, response.Stacks && response.Stacks[0], retrieveProcessedTemplate);
        }
        catch (e) {
            if (e.name === 'ValidationError' && e.message === `Stack with id ${stackName} does not exist`) {
                return new CloudFormationStack(cfn, stackName, undefined);
            }
            throw e;
        }
    }
    /**
     * Return a copy of the given stack that does not exist
     *
     * It's a little silly that it needs arguments to do that, but there we go.
     */
    static doesNotExist(cfn, stackName) {
        return new CloudFormationStack(cfn, stackName);
    }
    /**
     * From static information (for testing)
     */
    static fromStaticInformation(cfn, stackName, stack) {
        return new CloudFormationStack(cfn, stackName, stack);
    }
    constructor(cfn, stackName, stack, retrieveProcessedTemplate = false) {
        this.cfn = cfn;
        this.stackName = stackName;
        this.stack = stack;
        this.retrieveProcessedTemplate = retrieveProcessedTemplate;
    }
    /**
     * Retrieve the stack's deployed template
     *
     * Cached, so will only be retrieved once. Will return an empty
     * structure if the stack does not exist.
     */
    async template() {
        if (!this.exists) {
            return {};
        }
        if (this._template === undefined) {
            const response = await this.cfn.getTemplate({
                StackName: this.stackName,
                TemplateStage: this.retrieveProcessedTemplate ? 'Processed' : 'Original',
            });
            this._template = (response.TemplateBody && (0, serialize_1.deserializeStructure)(response.TemplateBody)) || {};
        }
        return this._template;
    }
    /**
     * Whether the stack exists
     */
    get exists() {
        return this.stack !== undefined;
    }
    /**
     * The stack's ID
     *
     * Throws if the stack doesn't exist.
     */
    get stackId() {
        this.assertExists();
        return this.stack.StackId;
    }
    /**
     * The stack's current outputs
     *
     * Empty object if the stack doesn't exist
     */
    get outputs() {
        if (!this.exists) {
            return {};
        }
        const result = {};
        (this.stack.Outputs || []).forEach((output) => {
            result[output.OutputKey] = output.OutputValue;
        });
        return result;
    }
    /**
     * The stack's status
     *
     * Special status NOT_FOUND if the stack does not exist.
     */
    get stackStatus() {
        if (!this.exists) {
            return new stack_status_1.StackStatus('NOT_FOUND', 'Stack not found during lookup');
        }
        return stack_status_1.StackStatus.fromStackDescription(this.stack);
    }
    /**
     * The stack's current tags
     *
     * Empty list if the stack does not exist
     */
    get tags() {
        return this.stack?.Tags || [];
    }
    /**
     * SNS Topic ARNs that will receive stack events.
     *
     * Empty list if the stack does not exist
     */
    get notificationArns() {
        return this.stack?.NotificationARNs ?? [];
    }
    /**
     * Return the names of all current parameters to the stack
     *
     * Empty list if the stack does not exist.
     */
    get parameterNames() {
        return Object.keys(this.parameters);
    }
    /**
     * Return the names and values of all current parameters to the stack
     *
     * Empty object if the stack does not exist.
     */
    get parameters() {
        if (!this.exists) {
            return {};
        }
        const ret = {};
        for (const param of this.stack.Parameters ?? []) {
            ret[param.ParameterKey] = param.ResolvedValue ?? param.ParameterValue;
        }
        return ret;
    }
    /**
     * Return the termination protection of the stack
     */
    get terminationProtection() {
        return this.stack?.EnableTerminationProtection;
    }
    assertExists() {
        if (!this.exists) {
            throw new Error(`No stack named '${this.stackName}'`);
        }
    }
}
exports.CloudFormationStack = CloudFormationStack;
/**
 * Describe a changeset in CloudFormation, regardless of its current state.
 *
 * @param cfn           a CloudFormation client
 * @param stackName     the name of the Stack the ChangeSet belongs to
 * @param changeSetName the name of the ChangeSet
 * @param fetchAll      if true, fetches all pages of the change set description.
 *
 * @returns       CloudFormation information about the ChangeSet
 */
async function describeChangeSet(cfn, stackName, changeSetName, { fetchAll }) {
    const response = await cfn.describeChangeSet({
        StackName: stackName,
        ChangeSetName: changeSetName,
    });
    // If fetchAll is true, traverse all pages from the change set description.
    while (fetchAll && response.NextToken != null) {
        const nextPage = await cfn.describeChangeSet({
            StackName: stackName,
            ChangeSetName: response.ChangeSetId ?? changeSetName,
            NextToken: response.NextToken,
        });
        // Consolidate the changes
        if (nextPage.Changes != null) {
            response.Changes = response.Changes != null ? response.Changes.concat(nextPage.Changes) : nextPage.Changes;
        }
        // Forward the new NextToken
        response.NextToken = nextPage.NextToken;
    }
    return response;
}
/**
 * Waits for a function to return non-+undefined+ before returning.
 *
 * @param valueProvider a function that will return a value that is not +undefined+ once the wait should be over
 * @param timeout     the time to wait between two calls to +valueProvider+
 *
 * @returns       the value that was returned by +valueProvider+
 */
async function waitFor(valueProvider, timeout = 5000) {
    while (true) {
        const result = await valueProvider();
        if (result === null) {
            return undefined;
        }
        else if (result !== undefined) {
            return result;
        }
        await new Promise((cb) => setTimeout(cb, timeout));
    }
}
/**
 * Waits for a ChangeSet to be available for triggering a StackUpdate.
 *
 * Will return a changeset that is either ready to be executed or has no changes.
 * Will throw in other cases.
 *
 * @param cfn           a CloudFormation client
 * @param stackName     the name of the Stack that the ChangeSet belongs to
 * @param changeSetName the name of the ChangeSet
 * @param fetchAll      if true, fetches all pages of the ChangeSet before returning.
 *
 * @returns       the CloudFormation description of the ChangeSet
 */
async function waitForChangeSet(cfn, stackName, changeSetName, { fetchAll }) {
    (0, logging_1.debug)('Waiting for changeset %s on stack %s to finish creating...', changeSetName, stackName);
    const ret = await waitFor(async () => {
        const description = await describeChangeSet(cfn, stackName, changeSetName, {
            fetchAll,
        });
        // The following doesn't use a switch because tsc will not allow fall-through, UNLESS it is allows
        // EVERYWHERE that uses this library directly or indirectly, which is undesirable.
        if (description.Status === 'CREATE_PENDING' || description.Status === 'CREATE_IN_PROGRESS') {
            (0, logging_1.debug)('Changeset %s on stack %s is still creating', changeSetName, stackName);
            return undefined;
        }
        if (description.Status === client_cloudformation_1.ChangeSetStatus.CREATE_COMPLETE || changeSetHasNoChanges(description)) {
            return description;
        }
        // eslint-disable-next-line max-len
        throw new Error(`Failed to create ChangeSet ${changeSetName} on ${stackName}: ${description.Status || 'NO_STATUS'}, ${description.StatusReason || 'no reason provided'}`);
    });
    if (!ret) {
        throw new Error('Change set took too long to be created; aborting');
    }
    return ret;
}
/**
 * Create a changeset for a diff operation
 */
async function createDiffChangeSet(options) {
    // `options.stack` has been modified to include any nested stack templates directly inline with its own template, under a special `NestedTemplate` property.
    // Thus the parent template's Resources section contains the nested template's CDK metadata check, which uses Fn::Equals.
    // This causes CreateChangeSet to fail with `Template Error: Fn::Equals cannot be partially collapsed`.
    for (const resource of Object.values(options.stack.template.Resources ?? {})) {
        if (resource.Type === 'AWS::CloudFormation::Stack') {
            // eslint-disable-next-line no-console
            (0, logging_1.debug)('This stack contains one or more nested stacks, falling back to template-only diff...');
            return undefined;
        }
    }
    return uploadBodyParameterAndCreateChangeSet(options);
}
/**
 * Returns all file entries from an AssetManifestArtifact that look like templates.
 *
 * This is used in the `uploadBodyParameterAndCreateChangeSet` function to find
 * all template asset files to build and publish.
 *
 * Returns a tuple of [AssetManifest, FileManifestEntry[]]
 */
function templatesFromAssetManifestArtifact(artifact) {
    const assets = [];
    const fileName = artifact.file;
    const assetManifest = cdk_assets_1.AssetManifest.fromFile(fileName);
    assetManifest.entries.forEach((entry) => {
        if (entry.type === 'file') {
            const source = entry.source;
            if (source.path && source.path.endsWith('.template.json')) {
                assets.push(entry);
            }
        }
    });
    return [assetManifest, assets];
}
async function uploadBodyParameterAndCreateChangeSet(options) {
    try {
        await uploadStackTemplateAssets(options.stack, options.deployments);
        const env = await options.deployments.envs.accessStackForMutableStackOperations(options.stack);
        const bodyParameter = await (0, template_body_parameter_1.makeBodyParameter)(options.stack, env.resolvedEnvironment, new asset_manifest_builder_1.AssetManifestBuilder(), env.resources);
        const cfn = env.sdk.cloudFormation();
        const exists = (await CloudFormationStack.lookup(cfn, options.stack.stackName, false)).exists;
        const executionRoleArn = await env.replacePlaceholders(options.stack.cloudFormationExecutionRoleArn);
        options.stream.write('Hold on while we create a read-only change set to get a diff with accurate replacement information (use --no-change-set to use a less accurate but faster template-only diff)\n');
        return await createChangeSet({
            cfn,
            changeSetName: 'cdk-diff-change-set',
            stack: options.stack,
            exists,
            uuid: options.uuid,
            willExecute: options.willExecute,
            bodyParameter,
            parameters: options.parameters,
            resourcesToImport: options.resourcesToImport,
            role: executionRoleArn,
        });
    }
    catch (e) {
        (0, logging_1.debug)(e);
        options.stream.write('Could not create a change set, will base the diff on template differences (run again with -v to see the reason)\n');
        return undefined;
    }
}
/**
 * Uploads the assets that look like templates for this CloudFormation stack
 *
 * This is necessary for any CloudFormation call that needs the template, it may need
 * to be uploaded to an S3 bucket first. We have to follow the instructions in the
 * asset manifest, because technically that is the only place that knows about
 * bucket and assumed roles and such.
 */
async function uploadStackTemplateAssets(stack, deployments) {
    for (const artifact of stack.dependencies) {
        // Skip artifact if it is not an Asset Manifest Artifact
        if (!cxapi.AssetManifestArtifact.isAssetManifestArtifact(artifact)) {
            continue;
        }
        const [assetManifest, file_entries] = templatesFromAssetManifestArtifact(artifact);
        for (const entry of file_entries) {
            await deployments.buildSingleAsset(artifact, assetManifest, entry, {
                stack,
            });
            await deployments.publishSingleAsset(assetManifest, entry, {
                stack,
            });
        }
    }
}
async function createChangeSet(options) {
    await cleanupOldChangeset(options.changeSetName, options.stack.stackName, options.cfn);
    (0, logging_1.debug)(`Attempting to create ChangeSet with name ${options.changeSetName} for stack ${options.stack.stackName}`);
    const templateParams = TemplateParameters.fromTemplate(options.stack.template);
    const stackParams = templateParams.supplyAll(options.parameters);
    const changeSet = await options.cfn.createChangeSet({
        StackName: options.stack.stackName,
        ChangeSetName: options.changeSetName,
        ChangeSetType: options.resourcesToImport ? 'IMPORT' : options.exists ? 'UPDATE' : 'CREATE',
        Description: `CDK Changeset for diff ${options.uuid}`,
        ClientToken: `diff${options.uuid}`,
        TemplateURL: options.bodyParameter.TemplateURL,
        TemplateBody: options.bodyParameter.TemplateBody,
        Parameters: stackParams.apiParameters,
        ResourcesToImport: options.resourcesToImport,
        RoleARN: options.role,
        Capabilities: ['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND'],
    });
    (0, logging_1.debug)('Initiated creation of changeset: %s; waiting for it to finish creating...', changeSet.Id);
    // Fetching all pages if we'll execute, so we can have the correct change count when monitoring.
    const createdChangeSet = await waitForChangeSet(options.cfn, options.stack.stackName, options.changeSetName, {
        fetchAll: options.willExecute,
    });
    await cleanupOldChangeset(options.changeSetName, options.stack.stackName, options.cfn);
    return createdChangeSet;
}
async function cleanupOldChangeset(changeSetName, stackName, cfn) {
    // Delete any existing change sets generated by CDK since change set names must be unique.
    // The delete request is successful as long as the stack exists (even if the change set does not exist).
    (0, logging_1.debug)(`Removing existing change set with name ${changeSetName} if it exists`);
    await cfn.deleteChangeSet({
        StackName: stackName,
        ChangeSetName: changeSetName,
    });
}
/**
 * Return true if the given change set has no changes
 *
 * This must be determined from the status, not the 'Changes' array on the
 * object; the latter can be empty because no resources were changed, but if
 * there are changes to Outputs, the change set can still be executed.
 */
function changeSetHasNoChanges(description) {
    const noChangeErrorPrefixes = [
        // Error message for a regular template
        "The submitted information didn't contain changes.",
        // Error message when a Transform is involved (see #10650)
        'No updates are to be performed.',
    ];
    return (description.Status === 'FAILED' && noChangeErrorPrefixes.some((p) => (description.StatusReason ?? '').startsWith(p)));
}
/**
 * Waits for a CloudFormation stack to stabilize in a complete/available state
 * after a delete operation is issued.
 *
 * Fails if the stack is in a FAILED state. Will not fail if the stack was
 * already deleted.
 *
 * @param cfn        a CloudFormation client
 * @param stackName      the name of the stack to wait for after a delete
 *
 * @returns     the CloudFormation description of the stabilized stack after the delete attempt
 */
async function waitForStackDelete(cfn, stackName) {
    const stack = await stabilizeStack(cfn, stackName);
    if (!stack) {
        return undefined;
    }
    const status = stack.stackStatus;
    if (status.isFailure) {
        throw new Error(`The stack named ${stackName} is in a failed state. You may need to delete it from the AWS console : ${status}`);
    }
    else if (status.isDeleted) {
        return undefined;
    }
    return stack;
}
/**
 * Waits for a CloudFormation stack to stabilize in a complete/available state
 * after an update/create operation is issued.
 *
 * Fails if the stack is in a FAILED state, ROLLBACK state, or DELETED state.
 *
 * @param cfn        a CloudFormation client
 * @param stackName      the name of the stack to wait for after an update
 *
 * @returns     the CloudFormation description of the stabilized stack after the update attempt
 */
async function waitForStackDeploy(cfn, stackName) {
    const stack = await stabilizeStack(cfn, stackName);
    if (!stack) {
        return undefined;
    }
    const status = stack.stackStatus;
    if (status.isCreationFailure) {
        throw new Error(`The stack named ${stackName} failed creation, it may need to be manually deleted from the AWS console: ${status}`);
    }
    else if (!status.isDeploySuccess) {
        throw new Error(`The stack named ${stackName} failed to deploy: ${status}`);
    }
    return stack;
}
/**
 * Wait for a stack to become stable (no longer _IN_PROGRESS), returning it
 */
async function stabilizeStack(cfn, stackName) {
    (0, logging_1.debug)('Waiting for stack %s to finish creating or updating...', stackName);
    return waitFor(async () => {
        const stack = await CloudFormationStack.lookup(cfn, stackName);
        if (!stack.exists) {
            (0, logging_1.debug)('Stack %s does not exist', stackName);
            return null;
        }
        const status = stack.stackStatus;
        if (status.isInProgress) {
            (0, logging_1.debug)('Stack %s has an ongoing operation in progress and is not stable (%s)', stackName, status);
            return undefined;
        }
        else if (status.isReviewInProgress) {
            // This may happen if a stack creation operation is interrupted before the ChangeSet execution starts. Recovering
            // from this would requiring manual intervention (deleting or executing the pending ChangeSet), and failing to do
            // so will result in an endless wait here (the ChangeSet wont delete or execute itself). Instead of blocking
            // "forever" we proceed as if the stack was existing and stable. If there is a concurrent operation that just
            // hasn't finished proceeding just yet, either this operation or the concurrent one may fail due to the other one
            // having made progress. Which is fine. I guess.
            (0, logging_1.debug)('Stack %s is in REVIEW_IN_PROGRESS state. Considering this is a stable status (%s)', stackName, status);
        }
        return stack;
    });
}
/**
 * The set of (formal) parameters that have been declared in a template
 */
class TemplateParameters {
    static fromTemplate(template) {
        return new TemplateParameters(template.Parameters || {});
    }
    constructor(params) {
        this.params = params;
    }
    /**
     * Calculate stack parameters to pass from the given desired parameter values
     *
     * Will throw if parameters without a Default value or a Previous value are not
     * supplied.
     */
    supplyAll(updates) {
        return new ParameterValues(this.params, updates);
    }
    /**
     * From the template, the given desired values and the current values, calculate the changes to the stack parameters
     *
     * Will take into account parameters already set on the template (will emit
     * 'UsePreviousValue: true' for those unless the value is changed), and will
     * throw if parameters without a Default value or a Previous value are not
     * supplied.
     */
    updateExisting(updates, previousValues) {
        return new ParameterValues(this.params, updates, previousValues);
    }
}
exports.TemplateParameters = TemplateParameters;
/**
 * The set of parameters we're going to pass to a Stack
 */
class ParameterValues {
    constructor(formalParams, updates, previousValues = {}) {
        this.formalParams = formalParams;
        this.values = {};
        this.apiParameters = [];
        const missingRequired = new Array();
        for (const [key, formalParam] of Object.entries(this.formalParams)) {
            // Check updates first, then use the previous value (if available), then use
            // the default (if available).
            //
            // If we don't find a parameter value using any of these methods, then that's an error.
            const updatedValue = updates[key];
            if (updatedValue !== undefined) {
                this.values[key] = updatedValue;
                this.apiParameters.push({
                    ParameterKey: key,
                    ParameterValue: updates[key],
                });
                continue;
            }
            if (key in previousValues) {
                this.values[key] = previousValues[key];
                this.apiParameters.push({ ParameterKey: key, UsePreviousValue: true });
                continue;
            }
            if (formalParam.Default !== undefined) {
                this.values[key] = formalParam.Default;
                continue;
            }
            // Oh no
            missingRequired.push(key);
        }
        if (missingRequired.length > 0) {
            throw new Error(`The following CloudFormation Parameters are missing a value: ${missingRequired.join(', ')}`);
        }
        // Just append all supplied overrides that aren't really expected (this
        // will fail CFN but maybe people made typos that they want to be notified
        // of)
        const unknownParam = ([key, _]) => this.formalParams[key] === undefined;
        const hasValue = ([_, value]) => !!value;
        for (const [key, value] of Object.entries(updates).filter(unknownParam).filter(hasValue)) {
            this.values[key] = value;
            this.apiParameters.push({ ParameterKey: key, ParameterValue: value });
        }
    }
    /**
     * Whether this set of parameter updates will change the actual stack values
     */
    hasChanges(currentValues) {
        // If any of the parameters are SSM parameters, deploying must always happen
        // because we can't predict what the values will be. We will allow some
        // parameters to opt out of this check by having a magic string in their description.
        if (Object.values(this.formalParams).some((p) => p.Type.startsWith('AWS::SSM::Parameter::') && !p.Description?.includes(cx_api_1.SSMPARAM_NO_INVALIDATE))) {
            return 'ssm';
        }
        // Otherwise we're dirty if:
        // - any of the existing values are removed, or changed
        if (Object.entries(currentValues).some(([key, value]) => !(key in this.values) || value !== this.values[key])) {
            return true;
        }
        // - any of the values we're setting are new
        if (Object.keys(this.values).some((key) => !(key in currentValues))) {
            return true;
        }
        return false;
    }
}
exports.ParameterValues = ParameterValues;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xvdWRmb3JtYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjbG91ZGZvcm1hdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUE0UkEsNENBaUNDO0FBNkJELGtEQWdCQztBQStFRCw4REFpQkM7QUFrQ0Qsa0RBUUM7QUFTRCxzREFXQztBQWNELGdEQWtCQztBQWFELGdEQW9CQztBQUtELHdDQXdCQztBQXRtQkQseUNBQXlDO0FBQ3pDLDRDQUF5RDtBQUN6RCwwRUFRd0M7QUFDeEMsMkNBQThEO0FBQzlELGdFQUE0RDtBQUM1RCx1RUFBcUY7QUFDckYsMkNBQXNDO0FBQ3RDLCtDQUF1RDtBQUN2RCw4RUFBeUU7QUFvQnpFOzs7OztHQUtHO0FBQ0gsTUFBYSxtQkFBbUI7SUFDdkIsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQ3hCLEdBQTBCLEVBQzFCLFNBQWlCLEVBQ2pCLDRCQUFxQyxLQUFLO1FBRTFDLElBQUksQ0FBQztZQUNILE1BQU0sUUFBUSxHQUFHLE1BQU0sR0FBRyxDQUFDLGNBQWMsQ0FBQyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO1lBQ3BFLE9BQU8sSUFBSSxtQkFBbUIsQ0FBQyxHQUFHLEVBQUUsU0FBUyxFQUFFLFFBQVEsQ0FBQyxNQUFNLElBQUksUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSx5QkFBeUIsQ0FBQyxDQUFDO1FBQ25ILENBQUM7UUFBQyxPQUFPLENBQU0sRUFBRSxDQUFDO1lBQ2hCLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxpQkFBaUIsSUFBSSxDQUFDLENBQUMsT0FBTyxLQUFLLGlCQUFpQixTQUFTLGlCQUFpQixFQUFFLENBQUM7Z0JBQzlGLE9BQU8sSUFBSSxtQkFBbUIsQ0FBQyxHQUFHLEVBQUUsU0FBUyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1lBQzVELENBQUM7WUFDRCxNQUFNLENBQUMsQ0FBQztRQUNWLENBQUM7SUFDSCxDQUFDO0lBRUQ7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LWNkay9jeC1hcGknO1xuaW1wb3J0IHsgU1NNUEFSQU1fTk9fSU5WQUxJREFURSB9IGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQge1xuICBDaGFuZ2VTZXRTdGF0dXMsXG4gIHR5cGUgRGVzY3JpYmVDaGFuZ2VTZXRDb21tYW5kT3V0cHV0LFxuICB0eXBlIFBhcmFtZXRlcixcbiAgdHlwZSBSZXNvdXJjZUlkZW50aWZpZXJTdW1tYXJ5LFxuICB0eXBlIFJlc291cmNlVG9JbXBvcnQsXG4gIHR5cGUgU3RhY2ssXG4gIHR5cGUgVGFnLFxufSBmcm9tICdAYXdzLXNkay9jbGllbnQtY2xvdWRmb3JtYXRpb24nO1xuaW1wb3J0IHsgQXNzZXRNYW5pZmVzdCwgRmlsZU1hbmlmZXN0RW50cnkgfSBmcm9tICdjZGstYXNzZXRzJztcbmltcG9ydCB7IFN0YWNrU3RhdHVzIH0gZnJvbSAnLi9jbG91ZGZvcm1hdGlvbi9zdGFjay1zdGF0dXMnO1xuaW1wb3J0IHsgbWFrZUJvZHlQYXJhbWV0ZXIsIFRlbXBsYXRlQm9keVBhcmFtZXRlciB9IGZyb20gJy4vdGVtcGxhdGUtYm9keS1wYXJhbWV0ZXInO1xuaW1wb3J0IHsgZGVidWcgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IGRlc2VyaWFsaXplU3RydWN0dXJlIH0gZnJvbSAnLi4vLi4vc2VyaWFsaXplJztcbmltcG9ydCB7IEFzc2V0TWFuaWZlc3RCdWlsZGVyIH0gZnJvbSAnLi4vLi4vdXRpbC9hc3NldC1tYW5pZmVzdC1idWlsZGVyJztcbmltcG9ydCB0eXBlIHsgSUNsb3VkRm9ybWF0aW9uQ2xpZW50LCBTZGtQcm92aWRlciB9IGZyb20gJy4uL2F3cy1hdXRoJztcbmltcG9ydCB0eXBlIHsgRGVwbG95bWVudHMgfSBmcm9tICcuLi9kZXBsb3ltZW50cyc7XG5cbmV4cG9ydCB0eXBlIFJlc291cmNlc1RvSW1wb3J0ID0gUmVzb3VyY2VUb0ltcG9ydFtdO1xuZXhwb3J0IHR5cGUgUmVzb3VyY2VJZGVudGlmaWVyU3VtbWFyaWVzID0gUmVzb3VyY2VJZGVudGlmaWVyU3VtbWFyeVtdO1xuZXhwb3J0IHR5cGUgUmVzb3VyY2VJZGVudGlmaWVyUHJvcGVydGllcyA9IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG5cbmV4cG9ydCB0eXBlIFRlbXBsYXRlID0ge1xuICBQYXJhbWV0ZXJzPzogUmVjb3JkPHN0cmluZywgVGVtcGxhdGVQYXJhbWV0ZXI+O1xuICBba2V5OiBzdHJpbmddOiBhbnk7XG59O1xuXG5pbnRlcmZhY2UgVGVtcGxhdGVQYXJhbWV0ZXIge1xuICBUeXBlOiBzdHJpbmc7XG4gIERlZmF1bHQ/OiBhbnk7XG4gIERlc2NyaXB0aW9uPzogc3RyaW5nO1xuICBba2V5OiBzdHJpbmddOiBhbnk7XG59XG5cbi8qKlxuICogUmVwcmVzZW50cyBhbiAoZXhpc3RpbmcpIFN0YWNrIGluIENsb3VkRm9ybWF0aW9uXG4gKlxuICogQnVuZGxlIGFuZCBjYWNoZSBzb21lIGluZm9ybWF0aW9uIHRoYXQgd2UgbmVlZCBkdXJpbmcgZGVwbG95bWVudCAoc28gd2UgZG9uJ3QgaGF2ZSB0byBtYWtlXG4gKiByZXBlYXRlZCBjYWxscyB0byBDbG91ZEZvcm1hdGlvbikuXG4gKi9cbmV4cG9ydCBjbGFzcyBDbG91ZEZvcm1hdGlvblN0YWNrIHtcbiAgcHVibGljIHN0YXRpYyBhc3luYyBsb29rdXAoXG4gICAgY2ZuOiBJQ2xvdWRGb3JtYXRpb25DbGllbnQsXG4gICAgc3RhY2tOYW1lOiBzdHJpbmcsXG4gICAgcmV0cmlldmVQcm9jZXNzZWRUZW1wbGF0ZTogYm9vbGVhbiA9IGZhbHNlLFxuICApOiBQcm9taXNlPENsb3VkRm9ybWF0aW9uU3RhY2s+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBjZm4uZGVzY3JpYmVTdGFja3MoeyBTdGFja05hbWU6IHN0YWNrTmFtZSB9KTtcbiAgICAgIHJldHVybiBuZXcgQ2xvdWRGb3JtYXRpb25TdGFjayhjZm4sIHN0YWNrTmFtZSwgcmVzcG9uc2UuU3RhY2tzICYmIHJlc3BvbnNlLlN0YWNrc1swXSwgcmV0cmlldmVQcm9jZXNzZWRUZW1wbGF0ZSk7XG4gICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICBpZiAoZS5uYW1lID09PSAnVmFsaWRhdGlvbkVycm9yJyAmJiBlLm1lc3NhZ2UgPT09IGBTdGFjayB3aXRoIGlkICR7c3RhY2tOYW1lfSBkb2VzIG5vdCBleGlzdGApIHtcbiAgICAgICAgcmV0dXJuIG5ldyBDbG91ZEZvcm1hdGlvblN0YWNrKGNmbiwgc3RhY2tOYW1lLCB1bmRlZmluZWQpO1xuICAgICAgfVxuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIGEgY29weSBvZiB0aGUgZ2l2ZW4gc3RhY2sgdGhhdCBkb2VzIG5vdCBleGlzdFxuICAgKlxuICAgKiBJdCdzIGEgbGl0dGxlIHNpbGx5IHRoYXQgaXQgbmVlZHMgYXJndW1lbnRzIHRvIGRvIHRoYXQsIGJ1dCB0aGVyZSB3ZSBnby5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZG9lc05vdEV4aXN0KGNmbjogSUNsb3VkRm9ybWF0aW9uQ2xpZW50LCBzdGFja05hbWU6IHN0cmluZykge1xuICAgIHJldHVybiBuZXcgQ2xvdWRGb3JtYXRpb25TdGFjayhjZm4sIHN0YWNrTmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogRnJvbSBzdGF0aWMgaW5mb3JtYXRpb24gKGZvciB0ZXN0aW5nKVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tU3RhdGljSW5mb3JtYXRpb24oY2ZuOiBJQ2xvdWRGb3JtYXRpb25DbGllbnQsIHN0YWNrTmFtZTogc3RyaW5nLCBzdGFjazogU3RhY2spIHtcbiAgICByZXR1cm4gbmV3IENsb3VkRm9ybWF0aW9uU3RhY2soY2ZuLCBzdGFja05hbWUsIHN0YWNrKTtcbiAgfVxuXG4gIHByaXZhdGUgX3RlbXBsYXRlOiBhbnk7XG5cbiAgcHJvdGVjdGVkIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY2ZuOiBJQ2xvdWRGb3JtYXRpb25DbGllbnQsXG4gICAgcHVibGljIHJlYWRvbmx5IHN0YWNrTmFtZTogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgc3RhY2s/OiBTdGFjayxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJldHJpZXZlUHJvY2Vzc2VkVGVtcGxhdGU6IGJvb2xlYW4gPSBmYWxzZSxcbiAgKSB7fVxuXG4gIC8qKlxuICAgKiBSZXRyaWV2ZSB0aGUgc3RhY2sncyBkZXBsb3llZCB0ZW1wbGF0ZVxuICAgKlxuICAgKiBDYWNoZWQsIHNvIHdpbGwgb25seSBiZSByZXRyaWV2ZWQgb25jZS4gV2lsbCByZXR1cm4gYW4gZW1wdHlcbiAgICogc3RydWN0dXJlIGlmIHRoZSBzdGFjayBkb2VzIG5vdCBleGlzdC5cbiAgICovXG4gIHB1YmxpYyBhc3luYyB0ZW1wbGF0ZSgpOiBQcm9taXNlPFRlbXBsYXRlPiB7XG4gICAgaWYgKCF0aGlzLmV4aXN0cykge1xuICAgICAgcmV0dXJuIHt9O1xuICAgIH1cblxuICAgIGlmICh0aGlzLl90ZW1wbGF0ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuY2ZuLmdldFRlbXBsYXRlKHtcbiAgICAgICAgU3RhY2tOYW1lOiB0aGlzLnN0YWNrTmFtZSxcbiAgICAgICAgVGVtcGxhdGVTdGFnZTogdGhpcy5yZXRyaWV2ZVByb2Nlc3NlZFRlbXBsYXRlID8gJ1Byb2Nlc3NlZCcgOiAnT3JpZ2luYWwnLFxuICAgICAgfSk7XG4gICAgICB0aGlzLl90ZW1wbGF0ZSA9IChyZXNwb25zZS5UZW1wbGF0ZUJvZHkgJiYgZGVzZXJpYWxpemVTdHJ1Y3R1cmUocmVzcG9uc2UuVGVtcGxhdGVCb2R5KSkgfHwge307XG4gICAgfVxuICAgIHJldHVybiB0aGlzLl90ZW1wbGF0ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBzdGFjayBleGlzdHNcbiAgICovXG4gIHB1YmxpYyBnZXQgZXhpc3RzKCkge1xuICAgIHJldHVybiB0aGlzLnN0YWNrICE9PSB1bmRlZmluZWQ7XG4gIH1cblxuICAvKipcbiAgICogVGhlIHN0YWNrJ3MgSURcbiAgICpcbiAgICogVGhyb3dzIGlmIHRoZSBzdGFjayBkb2Vzbid0IGV4aXN0LlxuICAgKi9cbiAgcHVibGljIGdldCBzdGFja0lkKCkge1xuICAgIHRoaXMuYXNzZXJ0RXhpc3RzKCk7XG4gICAgcmV0dXJuIHRoaXMuc3RhY2shLlN0YWNrSWQhO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBzdGFjaydzIGN1cnJlbnQgb3V0cHV0c1xuICAgKlxuICAgKiBFbXB0eSBvYmplY3QgaWYgdGhlIHN0YWNrIGRvZXNuJ3QgZXhpc3RcbiAgICovXG4gIHB1YmxpYyBnZXQgb3V0cHV0cygpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgICBpZiAoIXRoaXMuZXhpc3RzKSB7XG4gICAgICByZXR1cm4ge307XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdDogeyBbbmFtZTogc3RyaW5nXTogc3RyaW5nIH0gPSB7fTtcbiAgICAodGhpcy5zdGFjayEuT3V0cHV0cyB8fCBbXSkuZm9yRWFjaCgob3V0cHV0KSA9PiB7XG4gICAgICByZXN1bHRbb3V0cHV0Lk91dHB1dEtleSFdID0gb3V0cHV0Lk91dHB1dFZhbHVlITtcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBzdGFjaydzIHN0YXR1c1xuICAgKlxuICAgKiBTcGVjaWFsIHN0YXR1cyBOT1RfRk9VTkQgaWYgdGhlIHN0YWNrIGRvZXMgbm90IGV4aXN0LlxuICAgKi9cbiAgcHVibGljIGdldCBzdGFja1N0YXR1cygpOiBTdGFja1N0YXR1cyB7XG4gICAgaWYgKCF0aGlzLmV4aXN0cykge1xuICAgICAgcmV0dXJuIG5ldyBTdGFja1N0YXR1cygnTk9UX0ZPVU5EJywgJ1N0YWNrIG5vdCBmb3VuZCBkdXJpbmcgbG9va3VwJyk7XG4gICAgfVxuICAgIHJldHVybiBTdGFja1N0YXR1cy5mcm9tU3RhY2tEZXNjcmlwdGlvbih0aGlzLnN0YWNrISk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIHN0YWNrJ3MgY3VycmVudCB0YWdzXG4gICAqXG4gICAqIEVtcHR5IGxpc3QgaWYgdGhlIHN0YWNrIGRvZXMgbm90IGV4aXN0XG4gICAqL1xuICBwdWJsaWMgZ2V0IHRhZ3MoKTogVGFnW10ge1xuICAgIHJldHVybiB0aGlzLnN0YWNrPy5UYWdzIHx8IFtdO1xuICB9XG5cbiAgLyoqXG4gICAqIFNOUyBUb3BpYyBBUk5zIHRoYXQgd2lsbCByZWNlaXZlIHN0YWNrIGV2ZW50cy5cbiAgICpcbiAgICogRW1wdHkgbGlzdCBpZiB0aGUgc3RhY2sgZG9lcyBub3QgZXhpc3RcbiAgICovXG4gIHB1YmxpYyBnZXQgbm90aWZpY2F0aW9uQXJucygpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIHRoaXMuc3RhY2s/Lk5vdGlmaWNhdGlvbkFSTnMgPz8gW107XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJuIHRoZSBuYW1lcyBvZiBhbGwgY3VycmVudCBwYXJhbWV0ZXJzIHRvIHRoZSBzdGFja1xuICAgKlxuICAgKiBFbXB0eSBsaXN0IGlmIHRoZSBzdGFjayBkb2VzIG5vdCBleGlzdC5cbiAgICovXG4gIHB1YmxpYyBnZXQgcGFyYW1ldGVyTmFtZXMoKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBPYmplY3Qua2V5cyh0aGlzLnBhcmFtZXRlcnMpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybiB0aGUgbmFtZXMgYW5kIHZhbHVlcyBvZiBhbGwgY3VycmVudCBwYXJhbWV0ZXJzIHRvIHRoZSBzdGFja1xuICAgKlxuICAgKiBFbXB0eSBvYmplY3QgaWYgdGhlIHN0YWNrIGRvZXMgbm90IGV4aXN0LlxuICAgKi9cbiAgcHVibGljIGdldCBwYXJhbWV0ZXJzKCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIGlmICghdGhpcy5leGlzdHMpIHtcbiAgICAgIHJldHVybiB7fTtcbiAgICB9XG4gICAgY29uc3QgcmV0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gICAgZm9yIChjb25zdCBwYXJhbSBvZiB0aGlzLnN0YWNrIS5QYXJhbWV0ZXJzID8/IFtdKSB7XG4gICAgICByZXRbcGFyYW0uUGFyYW1ldGVyS2V5IV0gPSBwYXJhbS5SZXNvbHZlZFZhbHVlID8/IHBhcmFtLlBhcmFtZXRlclZhbHVlITtcbiAgICB9XG4gICAgcmV0dXJuIHJldDtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gdGhlIHRlcm1pbmF0aW9uIHByb3RlY3Rpb24gb2YgdGhlIHN0YWNrXG4gICAqL1xuICBwdWJsaWMgZ2V0IHRlcm1pbmF0aW9uUHJvdGVjdGlvbigpOiBib29sZWFuIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5zdGFjaz8uRW5hYmxlVGVybWluYXRpb25Qcm90ZWN0aW9uO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3NlcnRFeGlzdHMoKSB7XG4gICAgaWYgKCF0aGlzLmV4aXN0cykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdGFjayBuYW1lZCAnJHt0aGlzLnN0YWNrTmFtZX0nYCk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogRGVzY3JpYmUgYSBjaGFuZ2VzZXQgaW4gQ2xvdWRGb3JtYXRpb24sIHJlZ2FyZGxlc3Mgb2YgaXRzIGN1cnJlbnQgc3RhdGUuXG4gKlxuICogQHBhcmFtIGNmbiAgICAgICAgICAgYSBDbG91ZEZvcm1hdGlvbiBjbGllbnRcbiAqIEBwYXJhbSBzdGFja05hbWUgICAgIHRoZSBuYW1lIG9mIHRoZSBTdGFjayB0aGUgQ2hhbmdlU2V0IGJlbG9uZ3MgdG9cbiAqIEBwYXJhbSBjaGFuZ2VTZXROYW1lIHRoZSBuYW1lIG9mIHRoZSBDaGFuZ2VTZXRcbiAqIEBwYXJhbSBmZXRjaEFsbCAgICAgIGlmIHRydWUsIGZldGNoZXMgYWxsIHBhZ2VzIG9mIHRoZSBjaGFuZ2Ugc2V0IGRlc2NyaXB0aW9uLlxuICpcbiAqIEByZXR1cm5zICAgICAgIENsb3VkRm9ybWF0aW9uIGluZm9ybWF0aW9uIGFib3V0IHRoZSBDaGFuZ2VTZXRcbiAqL1xuYXN5bmMgZnVuY3Rpb24gZGVzY3JpYmVDaGFuZ2VTZXQoXG4gIGNmbjogSUNsb3VkRm9ybWF0aW9uQ2xpZW50LFxuICBzdGFja05hbWU6IHN0cmluZyxcbiAgY2hhbmdlU2V0TmFtZTogc3RyaW5nLFxuICB7IGZldGNoQWxsIH06IHsgZmV0Y2hBbGw6IGJvb2xlYW4gfSxcbik6IFByb21pc2U8RGVzY3JpYmVDaGFuZ2VTZXRDb21tYW5kT3V0cHV0PiB7XG4gIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgY2ZuLmRlc2NyaWJlQ2hhbmdlU2V0KHtcbiAgICBTdGFja05hbWU6IHN0YWNrTmFtZSxcbiAgICBDaGFuZ2VTZXROYW1lOiBjaGFuZ2VTZXROYW1lLFxuICB9KTtcblxuICAvLyBJZiBmZXRjaEFsbCBpcyB0cnVlLCB0cmF2ZXJzZSBhbGwgcGFnZXMgZnJvbSB0aGUgY2hhbmdlIHNldCBkZXNjcmlwdGlvbi5cbiAgd2hpbGUgKGZldGNoQWxsICYmIHJlc3BvbnNlLk5leHRUb2tlbiAhPSBudWxsKSB7XG4gICAgY29uc3QgbmV4dFBhZ2UgPSBhd2FpdCBjZm4uZGVzY3JpYmVDaGFuZ2VTZXQoe1xuICAgICAgU3RhY2tOYW1lOiBzdGFja05hbWUsXG4gICAgICBDaGFuZ2VTZXROYW1lOiByZXNwb25zZS5DaGFuZ2VTZXRJZCA/PyBjaGFuZ2VTZXROYW1lLFxuICAgICAgTmV4dFRva2VuOiByZXNwb25zZS5OZXh0VG9rZW4sXG4gICAgfSk7XG5cbiAgICAvLyBDb25zb2xpZGF0ZSB0aGUgY2hhbmdlc1xuICAgIGlmIChuZXh0UGFnZS5DaGFuZ2VzICE9IG51bGwpIHtcbiAgICAgIHJlc3BvbnNlLkNoYW5nZXMgPSByZXNwb25zZS5DaGFuZ2VzICE9IG51bGwgPyByZXNwb25zZS5DaGFuZ2VzLmNvbmNhdChuZXh0UGFnZS5DaGFuZ2VzKSA6IG5leHRQYWdlLkNoYW5nZXM7XG4gICAgfVxuXG4gICAgLy8gRm9yd2FyZCB0aGUgbmV3IE5leHRUb2tlblxuICAgIHJlc3BvbnNlLk5leHRUb2tlbiA9IG5leHRQYWdlLk5leHRUb2tlbjtcbiAgfVxuXG4gIHJldHVybiByZXNwb25zZTtcbn1cblxuLyoqXG4gKiBXYWl0cyBmb3IgYSBmdW5jdGlvbiB0byByZXR1cm4gbm9uLSt1bmRlZmluZWQrIGJlZm9yZSByZXR1cm5pbmcuXG4gKlxuICogQHBhcmFtIHZhbHVlUHJvdmlkZXIgYSBmdW5jdGlvbiB0aGF0IHdpbGwgcmV0dXJuIGEgdmFsdWUgdGhhdCBpcyBub3QgK3VuZGVmaW5lZCsgb25jZSB0aGUgd2FpdCBzaG91bGQgYmUgb3ZlclxuICogQHBhcmFtIHRpbWVvdXQgICAgIHRoZSB0aW1lIHRvIHdhaXQgYmV0d2VlbiB0d28gY2FsbHMgdG8gK3ZhbHVlUHJvdmlkZXIrXG4gKlxuICogQHJldHVybnMgICAgICAgdGhlIHZhbHVlIHRoYXQgd2FzIHJldHVybmVkIGJ5ICt2YWx1ZVByb3ZpZGVyK1xuICovXG5hc3luYyBmdW5jdGlvbiB3YWl0Rm9yPFQ+KFxuICB2YWx1ZVByb3ZpZGVyOiAoKSA9PiBQcm9taXNlPFQgfCBudWxsIHwgdW5kZWZpbmVkPixcbiAgdGltZW91dDogbnVtYmVyID0gNTAwMCxcbik6IFByb21pc2U8VCB8IHVuZGVmaW5lZD4ge1xuICB3aGlsZSAodHJ1ZSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZhbHVlUHJvdmlkZXIoKTtcbiAgICBpZiAocmVzdWx0ID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH0gZWxzZSBpZiAocmVzdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuICAgIGF3YWl0IG5ldyBQcm9taXNlKChjYikgPT4gc2V0VGltZW91dChjYiwgdGltZW91dCkpO1xuICB9XG59XG5cbi8qKlxuICogV2FpdHMgZm9yIGEgQ2hhbmdlU2V0IHRvIGJlIGF2YWlsYWJsZSBmb3IgdHJpZ2dlcmluZyBhIFN0YWNrVXBkYXRlLlxuICpcbiAqIFdpbGwgcmV0dXJuIGEgY2hhbmdlc2V0IHRoYXQgaXMgZWl0aGVyIHJlYWR5IHRvIGJlIGV4ZWN1dGVkIG9yIGhhcyBubyBjaGFuZ2VzLlxuICogV2lsbCB0aHJvdyBpbiBvdGhlciBjYXNlcy5cbiAqXG4gKiBAcGFyYW0gY2ZuICAgICAgICAgICBhIENsb3VkRm9ybWF0aW9uIGNsaWVudFxuICogQHBhcmFtIHN0YWNrTmFtZSAgICAgdGhlIG5hbWUgb2YgdGhlIFN0YWNrIHRoYXQgdGhlIENoYW5nZVNldCBiZWxvbmdzIHRvXG4gKiBAcGFyYW0gY2hhbmdlU2V0TmFtZSB0aGUgbmFtZSBvZiB0aGUgQ2hhbmdlU2V0XG4gKiBAcGFyYW0gZmV0Y2hBbGwgICAgICBpZiB0cnVlLCBmZXRjaGVzIGFsbCBwYWdlcyBvZiB0aGUgQ2hhbmdlU2V0IGJlZm9yZSByZXR1cm5pbmcuXG4gKlxuICogQHJldHVybnMgICAgICAgdGhlIENsb3VkRm9ybWF0aW9uIGRlc2NyaXB0aW9uIG9mIHRoZSBDaGFuZ2VTZXRcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JDaGFuZ2VTZXQoXG4gIGNmbjogSUNsb3VkRm9ybWF0aW9uQ2xpZW50LFxuICBzdGFja05hbWU6IHN0cmluZyxcbiAgY2hhbmdlU2V0TmFtZTogc3RyaW5nLFxuICB7IGZldGNoQWxsIH06IHsgZmV0Y2hBbGw6IGJvb2xlYW4gfSxcbik6IFByb21pc2U8RGVzY3JpYmVDaGFuZ2VTZXRDb21tYW5kT3V0cHV0PiB7XG4gIGRlYnVnKCdXYWl0aW5nIGZvciBjaGFuZ2VzZXQgJXMgb24gc3RhY2sgJXMgdG8gZmluaXNoIGNyZWF0aW5nLi4uJywgY2hhbmdlU2V0TmFtZSwgc3RhY2tOYW1lKTtcbiAgY29uc3QgcmV0ID0gYXdhaXQgd2FpdEZvcihhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgZGVzY3JpcHRpb24gPSBhd2FpdCBkZXNjcmliZUNoYW5nZVNldChjZm4sIHN0YWNrTmFtZSwgY2hhbmdlU2V0TmFtZSwge1xuICAgICAgZmV0Y2hBbGwsXG4gICAgfSk7XG4gICAgLy8gVGhlIGZvbGxvd2luZyBkb2Vzbid0IHVzZSBhIHN3aXRjaCBiZWNhdXNlIHRzYyB3aWxsIG5vdCBhbGxvdyBmYWxsLXRocm91Z2gsIFVOTEVTUyBpdCBpcyBhbGxvd3NcbiAgICAvLyBFVkVSWVdIRVJFIHRoYXQgdXNlcyB0aGlzIGxpYnJhcnkgZGlyZWN0bHkgb3IgaW5kaXJlY3RseSwgd2hpY2ggaXMgdW5kZXNpcmFibGUuXG4gICAgaWYgKGRlc2NyaXB0aW9uLlN0YXR1cyA9PT0gJ0NSRUFURV9QRU5ESU5HJyB8fCBkZXNjcmlwdGlvbi5TdGF0dXMgPT09ICdDUkVBVEVfSU5fUFJPR1JFU1MnKSB7XG4gICAgICBkZWJ1ZygnQ2hhbmdlc2V0ICVzIG9uIHN0YWNrICVzIGlzIHN0aWxsIGNyZWF0aW5nJywgY2hhbmdlU2V0TmFtZSwgc3RhY2tOYW1lKTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgaWYgKGRlc2NyaXB0aW9uLlN0YXR1cyA9PT0gQ2hhbmdlU2V0U3RhdHVzLkNSRUFURV9DT01QTEVURSB8fCBjaGFuZ2VTZXRIYXNOb0NoYW5nZXMoZGVzY3JpcHRpb24pKSB7XG4gICAgICByZXR1cm4gZGVzY3JpcHRpb247XG4gICAgfVxuXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG1heC1sZW5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgRmFpbGVkIHRvIGNyZWF0ZSBDaGFuZ2VTZXQgJHtjaGFuZ2VTZXROYW1lfSBvbiAke3N0YWNrTmFtZX06ICR7ZGVzY3JpcHRpb24uU3RhdHVzIHx8ICdOT19TVEFUVVMnfSwgJHtkZXNjcmlwdGlvbi5TdGF0dXNSZWFzb24gfHwgJ25vIHJlYXNvbiBwcm92aWRlZCd9YCxcbiAgICApO1xuICB9KTtcblxuICBpZiAoIXJldCkge1xuICAgIHRocm93IG5ldyBFcnJvcignQ2hhbmdlIHNldCB0b29rIHRvbyBsb25nIHRvIGJlIGNyZWF0ZWQ7IGFib3J0aW5nJyk7XG4gIH1cblxuICByZXR1cm4gcmV0O1xufVxuXG5leHBvcnQgdHlwZSBQcmVwYXJlQ2hhbmdlU2V0T3B0aW9ucyA9IHtcbiAgc3RhY2s6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdDtcbiAgZGVwbG95bWVudHM6IERlcGxveW1lbnRzO1xuICB1dWlkOiBzdHJpbmc7XG4gIHdpbGxFeGVjdXRlOiBib29sZWFuO1xuICBzZGtQcm92aWRlcjogU2RrUHJvdmlkZXI7XG4gIHN0cmVhbTogTm9kZUpTLldyaXRhYmxlU3RyZWFtO1xuICBwYXJhbWV0ZXJzOiB7IFtuYW1lOiBzdHJpbmddOiBzdHJpbmcgfCB1bmRlZmluZWQgfTtcbiAgcmVzb3VyY2VzVG9JbXBvcnQ/OiBSZXNvdXJjZXNUb0ltcG9ydDtcbn1cblxuZXhwb3J0IHR5cGUgQ3JlYXRlQ2hhbmdlU2V0T3B0aW9ucyA9IHtcbiAgY2ZuOiBJQ2xvdWRGb3JtYXRpb25DbGllbnQ7XG4gIGNoYW5nZVNldE5hbWU6IHN0cmluZztcbiAgd2lsbEV4ZWN1dGU6IGJvb2xlYW47XG4gIGV4aXN0czogYm9vbGVhbjtcbiAgdXVpZDogc3RyaW5nO1xuICBzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0O1xuICBib2R5UGFyYW1ldGVyOiBUZW1wbGF0ZUJvZHlQYXJhbWV0ZXI7XG4gIHBhcmFtZXRlcnM6IHsgW25hbWU6IHN0cmluZ106IHN0cmluZyB8IHVuZGVmaW5lZCB9O1xuICByZXNvdXJjZXNUb0ltcG9ydD86IFJlc291cmNlVG9JbXBvcnRbXTtcbiAgcm9sZT86IHN0cmluZztcbn07XG5cbi8qKlxuICogQ3JlYXRlIGEgY2hhbmdlc2V0IGZvciBhIGRpZmYgb3BlcmF0aW9uXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVEaWZmQ2hhbmdlU2V0KFxuICBvcHRpb25zOiBQcmVwYXJlQ2hhbmdlU2V0T3B0aW9ucyxcbik6IFByb21pc2U8RGVzY3JpYmVDaGFuZ2VTZXRDb21tYW5kT3V0cHV0IHwgdW5kZWZpbmVkPiB7XG4gIC8vIGBvcHRpb25zLnN0YWNrYCBoYXMgYmVlbiBtb2RpZmllZCB0byBpbmNsdWRlIGFueSBuZXN0ZWQgc3RhY2sgdGVtcGxhdGVzIGRpcmVjdGx5IGlubGluZSB3aXRoIGl0cyBvd24gdGVtcGxhdGUsIHVuZGVyIGEgc3BlY2lhbCBgTmVzdGVkVGVtcGxhdGVgIHByb3BlcnR5LlxuICAvLyBUaHVzIHRoZSBwYXJlbnQgdGVtcGxhdGUncyBSZXNvdXJjZXMgc2VjdGlvbiBjb250YWlucyB0aGUgbmVzdGVkIHRlbXBsYXRlJ3MgQ0RLIG1ldGFkYXRhIGNoZWNrLCB3aGljaCB1c2VzIEZuOjpFcXVhbHMuXG4gIC8vIFRoaXMgY2F1c2VzIENyZWF0ZUNoYW5nZVNldCB0byBmYWlsIHdpdGggYFRlbXBsYXRlIEVycm9yOiBGbjo6RXF1YWxzIGNhbm5vdCBiZSBwYXJ0aWFsbHkgY29sbGFwc2VkYC5cbiAgZm9yIChjb25zdCByZXNvdXJjZSBvZiBPYmplY3QudmFsdWVzKG9wdGlvbnMuc3RhY2sudGVtcGxhdGUuUmVzb3VyY2VzID8/IHt9KSkge1xuICAgIGlmICgocmVzb3VyY2UgYXMgYW55KS5UeXBlID09PSAnQVdTOjpDbG91ZEZvcm1hdGlvbjo6U3RhY2snKSB7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgZGVidWcoJ1RoaXMgc3RhY2sgY29udGFpbnMgb25lIG9yIG1vcmUgbmVzdGVkIHN0YWNrcywgZmFsbGluZyBiYWNrIHRvIHRlbXBsYXRlLW9ubHkgZGlmZi4uLicpO1xuXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB1cGxvYWRCb2R5UGFyYW1ldGVyQW5kQ3JlYXRlQ2hhbmdlU2V0KG9wdGlvbnMpO1xufVxuXG4vKipcbiAqIFJldHVybnMgYWxsIGZpbGUgZW50cmllcyBmcm9tIGFuIEFzc2V0TWFuaWZlc3RBcnRpZmFjdCB0aGF0IGxvb2sgbGlrZSB0ZW1wbGF0ZXMuXG4gKlxuICogVGhpcyBpcyB1c2VkIGluIHRoZSBgdXBsb2FkQm9keVBhcmFtZXRlckFuZENyZWF0ZUNoYW5nZVNldGAgZnVuY3Rpb24gdG8gZmluZFxuICogYWxsIHRlbXBsYXRlIGFzc2V0IGZpbGVzIHRvIGJ1aWxkIGFuZCBwdWJsaXNoLlxuICpcbiAqIFJldHVybnMgYSB0dXBsZSBvZiBbQXNzZXRNYW5pZmVzdCwgRmlsZU1hbmlmZXN0RW50cnlbXV1cbiAqL1xuZnVuY3Rpb24gdGVtcGxhdGVzRnJvbUFzc2V0TWFuaWZlc3RBcnRpZmFjdChcbiAgYXJ0aWZhY3Q6IGN4YXBpLkFzc2V0TWFuaWZlc3RBcnRpZmFjdCxcbik6IFtBc3NldE1hbmlmZXN0LCBGaWxlTWFuaWZlc3RFbnRyeVtdXSB7XG4gIGNvbnN0IGFzc2V0czogRmlsZU1hbmlmZXN0RW50cnlbXSA9IFtdO1xuICBjb25zdCBmaWxlTmFtZSA9IGFydGlmYWN0LmZpbGU7XG4gIGNvbnN0IGFzc2V0TWFuaWZlc3QgPSBBc3NldE1hbmlmZXN0LmZyb21GaWxlKGZpbGVOYW1lKTtcblxuICBhc3NldE1hbmlmZXN0LmVudHJpZXMuZm9yRWFjaCgoZW50cnkpID0+IHtcbiAgICBpZiAoZW50cnkudHlwZSA9PT0gJ2ZpbGUnKSB7XG4gICAgICBjb25zdCBzb3VyY2UgPSAoZW50cnkgYXMgRmlsZU1hbmlmZXN0RW50cnkpLnNvdXJjZTtcbiAgICAgIGlmIChzb3VyY2UucGF0aCAmJiBzb3VyY2UucGF0aC5lbmRzV2l0aCgnLnRlbXBsYXRlLmpzb24nKSkge1xuICAgICAgICBhc3NldHMucHVzaChlbnRyeSBhcyBGaWxlTWFuaWZlc3RFbnRyeSk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIFthc3NldE1hbmlmZXN0LCBhc3NldHNdO1xufVxuXG5hc3luYyBmdW5jdGlvbiB1cGxvYWRCb2R5UGFyYW1ldGVyQW5kQ3JlYXRlQ2hhbmdlU2V0KFxuICBvcHRpb25zOiBQcmVwYXJlQ2hhbmdlU2V0T3B0aW9ucyxcbik6IFByb21pc2U8RGVzY3JpYmVDaGFuZ2VTZXRDb21tYW5kT3V0cHV0IHwgdW5kZWZpbmVkPiB7XG4gIHRyeSB7XG4gICAgYXdhaXQgdXBsb2FkU3RhY2tUZW1wbGF0ZUFzc2V0cyhvcHRpb25zLnN0YWNrLCBvcHRpb25zLmRlcGxveW1lbnRzKTtcbiAgICBjb25zdCBlbnYgPSBhd2FpdCBvcHRpb25zLmRlcGxveW1lbnRzLmVudnMuYWNjZXNzU3RhY2tGb3JNdXRhYmxlU3RhY2tPcGVyYXRpb25zKG9wdGlvbnMuc3RhY2spO1xuXG4gICAgY29uc3QgYm9keVBhcmFtZXRlciA9IGF3YWl0IG1ha2VCb2R5UGFyYW1ldGVyKFxuICAgICAgb3B0aW9ucy5zdGFjayxcbiAgICAgIGVudi5yZXNvbHZlZEVudmlyb25tZW50LFxuICAgICAgbmV3IEFzc2V0TWFuaWZlc3RCdWlsZGVyKCksXG4gICAgICBlbnYucmVzb3VyY2VzLFxuICAgICk7XG4gICAgY29uc3QgY2ZuID0gZW52LnNkay5jbG91ZEZvcm1hdGlvbigpO1xuICAgIGNvbnN0IGV4aXN0cyA9IChhd2FpdCBDbG91ZEZvcm1hdGlvblN0YWNrLmxvb2t1cChjZm4sIG9wdGlvbnMuc3RhY2suc3RhY2tOYW1lLCBmYWxzZSkpLmV4aXN0cztcblxuICAgIGNvbnN0IGV4ZWN1dGlvblJvbGVBcm4gPSBhd2FpdCBlbnYucmVwbGFjZVBsYWNlaG9sZGVycyhvcHRpb25zLnN0YWNrLmNsb3VkRm9ybWF0aW9uRXhlY3V0aW9uUm9sZUFybik7XG4gICAgb3B0aW9ucy5zdHJlYW0ud3JpdGUoXG4gICAgICAnSG9sZCBvbiB3aGlsZSB3ZSBjcmVhdGUgYSByZWFkLW9ubHkgY2hhbmdlIHNldCB0byBnZXQgYSBkaWZmIHdpdGggYWNjdXJhdGUgcmVwbGFjZW1lbnQgaW5mb3JtYXRpb24gKHVzZSAtLW5vLWNoYW5nZS1zZXQgdG8gdXNlIGEgbGVzcyBhY2N1cmF0ZSBidXQgZmFzdGVyIHRlbXBsYXRlLW9ubHkgZGlmZilcXG4nLFxuICAgICk7XG5cbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlQ2hhbmdlU2V0KHtcbiAgICAgIGNmbixcbiAgICAgIGNoYW5nZVNldE5hbWU6ICdjZGstZGlmZi1jaGFuZ2Utc2V0JyxcbiAgICAgIHN0YWNrOiBvcHRpb25zLnN0YWNrLFxuICAgICAgZXhpc3RzLFxuICAgICAgdXVpZDogb3B0aW9ucy51dWlkLFxuICAgICAgd2lsbEV4ZWN1dGU6IG9wdGlvbnMud2lsbEV4ZWN1dGUsXG4gICAgICBib2R5UGFyYW1ldGVyLFxuICAgICAgcGFyYW1ldGVyczogb3B0aW9ucy5wYXJhbWV0ZXJzLFxuICAgICAgcmVzb3VyY2VzVG9JbXBvcnQ6IG9wdGlvbnMucmVzb3VyY2VzVG9JbXBvcnQsXG4gICAgICByb2xlOiBleGVjdXRpb25Sb2xlQXJuLFxuICAgIH0pO1xuICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICBkZWJ1ZyhlKTtcbiAgICBvcHRpb25zLnN0cmVhbS53cml0ZShcbiAgICAgICdDb3VsZCBub3QgY3JlYXRlIGEgY2hhbmdlIHNldCwgd2lsbCBiYXNlIHRoZSBkaWZmIG9uIHRlbXBsYXRlIGRpZmZlcmVuY2VzIChydW4gYWdhaW4gd2l0aCAtdiB0byBzZWUgdGhlIHJlYXNvbilcXG4nLFxuICAgICk7XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbi8qKlxuICogVXBsb2FkcyB0aGUgYXNzZXRzIHRoYXQgbG9vayBsaWtlIHRlbXBsYXRlcyBmb3IgdGhpcyBDbG91ZEZvcm1hdGlvbiBzdGFja1xuICpcbiAqIFRoaXMgaXMgbmVjZXNzYXJ5IGZvciBhbnkgQ2xvdWRGb3JtYXRpb24gY2FsbCB0aGF0IG5lZWRzIHRoZSB0ZW1wbGF0ZSwgaXQgbWF5IG5lZWRcbiAqIHRvIGJlIHVwbG9hZGVkIHRvIGFuIFMzIGJ1Y2tldCBmaXJzdC4gV2UgaGF2ZSB0byBmb2xsb3cgdGhlIGluc3RydWN0aW9ucyBpbiB0aGVcbiAqIGFzc2V0IG1hbmlmZXN0LCBiZWNhdXNlIHRlY2huaWNhbGx5IHRoYXQgaXMgdGhlIG9ubHkgcGxhY2UgdGhhdCBrbm93cyBhYm91dFxuICogYnVja2V0IGFuZCBhc3N1bWVkIHJvbGVzIGFuZCBzdWNoLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBsb2FkU3RhY2tUZW1wbGF0ZUFzc2V0cyhzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0LCBkZXBsb3ltZW50czogRGVwbG95bWVudHMpIHtcbiAgZm9yIChjb25zdCBhcnRpZmFjdCBvZiBzdGFjay5kZXBlbmRlbmNpZXMpIHtcbiAgICAvLyBTa2lwIGFydGlmYWN0IGlmIGl0IGlzIG5vdCBhbiBBc3NldCBNYW5pZmVzdCBBcnRpZmFjdFxuICAgIGlmICghY3hhcGkuQXNzZXRNYW5pZmVzdEFydGlmYWN0LmlzQXNzZXRNYW5pZmVzdEFydGlmYWN0KGFydGlmYWN0KSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgW2Fzc2V0TWFuaWZlc3QsIGZpbGVfZW50cmllc10gPSB0ZW1wbGF0ZXNGcm9tQXNzZXRNYW5pZmVzdEFydGlmYWN0KGFydGlmYWN0KTtcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGZpbGVfZW50cmllcykge1xuICAgICAgYXdhaXQgZGVwbG95bWVudHMuYnVpbGRTaW5nbGVBc3NldChhcnRpZmFjdCwgYXNzZXRNYW5pZmVzdCwgZW50cnksIHtcbiAgICAgICAgc3RhY2ssXG4gICAgICB9KTtcbiAgICAgIGF3YWl0IGRlcGxveW1lbnRzLnB1Ymxpc2hTaW5nbGVBc3NldChhc3NldE1hbmlmZXN0LCBlbnRyeSwge1xuICAgICAgICBzdGFjayxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVDaGFuZ2VTZXQob3B0aW9uczogQ3JlYXRlQ2hhbmdlU2V0T3B0aW9ucyk6IFByb21pc2U8RGVzY3JpYmVDaGFuZ2VTZXRDb21tYW5kT3V0cHV0PiB7XG4gIGF3YWl0IGNsZWFudXBPbGRDaGFuZ2VzZXQob3B0aW9ucy5jaGFuZ2VTZXROYW1lLCBvcHRpb25zLnN0YWNrLnN0YWNrTmFtZSwgb3B0aW9ucy5jZm4pO1xuXG4gIGRlYnVnKGBBdHRlbXB0aW5nIHRvIGNyZWF0ZSBDaGFuZ2VTZXQgd2l0aCBuYW1lICR7b3B0aW9ucy5jaGFuZ2VTZXROYW1lfSBmb3Igc3RhY2sgJHtvcHRpb25zLnN0YWNrLnN0YWNrTmFtZX1gKTtcblxuICBjb25zdCB0ZW1wbGF0ZVBhcmFtcyA9IFRlbXBsYXRlUGFyYW1ldGVycy5mcm9tVGVtcGxhdGUob3B0aW9ucy5zdGFjay50ZW1wbGF0ZSk7XG4gIGNvbnN0IHN0YWNrUGFyYW1zID0gdGVtcGxhdGVQYXJhbXMuc3VwcGx5QWxsKG9wdGlvbnMucGFyYW1ldGVycyk7XG5cbiAgY29uc3QgY2hhbmdlU2V0ID0gYXdhaXQgb3B0aW9ucy5jZm4uY3JlYXRlQ2hhbmdlU2V0KHtcbiAgICBTdGFja05hbWU6IG9wdGlvbnMuc3RhY2suc3RhY2tOYW1lLFxuICAgIENoYW5nZVNldE5hbWU6IG9wdGlvbnMuY2hhbmdlU2V0TmFtZSxcbiAgICBDaGFuZ2VTZXRUeXBlOiBvcHRpb25zLnJlc291cmNlc1RvSW1wb3J0ID8gJ0lNUE9SVCcgOiBvcHRpb25zLmV4aXN0cyA/ICdVUERBVEUnIDogJ0NSRUFURScsXG4gICAgRGVzY3JpcHRpb246IGBDREsgQ2hhbmdlc2V0IGZvciBkaWZmICR7b3B0aW9ucy51dWlkfWAsXG4gICAgQ2xpZW50VG9rZW46IGBkaWZmJHtvcHRpb25zLnV1aWR9YCxcbiAgICBUZW1wbGF0ZVVSTDogb3B0aW9ucy5ib2R5UGFyYW1ldGVyLlRlbXBsYXRlVVJMLFxuICAgIFRlbXBsYXRlQm9keTogb3B0aW9ucy5ib2R5UGFyYW1ldGVyLlRlbXBsYXRlQm9keSxcbiAgICBQYXJhbWV0ZXJzOiBzdGFja1BhcmFtcy5hcGlQYXJhbWV0ZXJzLFxuICAgIFJlc291cmNlc1RvSW1wb3J0OiBvcHRpb25zLnJlc291cmNlc1RvSW1wb3J0LFxuICAgIFJvbGVBUk46IG9wdGlvbnMucm9sZSxcbiAgICBDYXBhYmlsaXRpZXM6IFsnQ0FQQUJJTElUWV9JQU0nLCAnQ0FQQUJJTElUWV9OQU1FRF9JQU0nLCAnQ0FQQUJJTElUWV9BVVRPX0VYUEFORCddLFxuICB9KTtcblxuICBkZWJ1ZygnSW5pdGlhdGVkIGNyZWF0aW9uIG9mIGNoYW5nZXNldDogJXM7IHdhaXRpbmcgZm9yIGl0IHRvIGZpbmlzaCBjcmVhdGluZy4uLicsIGNoYW5nZVNldC5JZCk7XG4gIC8vIEZldGNoaW5nIGFsbCBwYWdlcyBpZiB3ZSdsbCBleGVjdXRlLCBzbyB3ZSBjYW4gaGF2ZSB0aGUgY29ycmVjdCBjaGFuZ2UgY291bnQgd2hlbiBtb25pdG9yaW5nLlxuICBjb25zdCBjcmVhdGVkQ2hhbmdlU2V0ID0gYXdhaXQgd2FpdEZvckNoYW5nZVNldChvcHRpb25zLmNmbiwgb3B0aW9ucy5zdGFjay5zdGFja05hbWUsIG9wdGlvbnMuY2hhbmdlU2V0TmFtZSwge1xuICAgIGZldGNoQWxsOiBvcHRpb25zLndpbGxFeGVjdXRlLFxuICB9KTtcbiAgYXdhaXQgY2xlYW51cE9sZENoYW5nZXNldChvcHRpb25zLmNoYW5nZVNldE5hbWUsIG9wdGlvbnMuc3RhY2suc3RhY2tOYW1lLCBvcHRpb25zLmNmbik7XG5cbiAgcmV0dXJuIGNyZWF0ZWRDaGFuZ2VTZXQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjbGVhbnVwT2xkQ2hhbmdlc2V0KGNoYW5nZVNldE5hbWU6IHN0cmluZywgc3RhY2tOYW1lOiBzdHJpbmcsIGNmbjogSUNsb3VkRm9ybWF0aW9uQ2xpZW50KSB7XG4gIC8vIERlbGV0ZSBhbnkgZXhpc3RpbmcgY2hhbmdlIHNldHMgZ2VuZXJhdGVkIGJ5IENESyBzaW5jZSBjaGFuZ2Ugc2V0IG5hbWVzIG11c3QgYmUgdW5pcXVlLlxuICAvLyBUaGUgZGVsZXRlIHJlcXVlc3QgaXMgc3VjY2Vzc2Z1bCBhcyBsb25nIGFzIHRoZSBzdGFjayBleGlzdHMgKGV2ZW4gaWYgdGhlIGNoYW5nZSBzZXQgZG9lcyBub3QgZXhpc3QpLlxuICBkZWJ1ZyhgUmVtb3ZpbmcgZXhpc3RpbmcgY2hhbmdlIHNldCB3aXRoIG5hbWUgJHtjaGFuZ2VTZXROYW1lfSBpZiBpdCBleGlzdHNgKTtcbiAgYXdhaXQgY2ZuLmRlbGV0ZUNoYW5nZVNldCh7XG4gICAgU3RhY2tOYW1lOiBzdGFja05hbWUsXG4gICAgQ2hhbmdlU2V0TmFtZTogY2hhbmdlU2V0TmFtZSxcbiAgfSk7XG59XG5cbi8qKlxuICogUmV0dXJuIHRydWUgaWYgdGhlIGdpdmVuIGNoYW5nZSBzZXQgaGFzIG5vIGNoYW5nZXNcbiAqXG4gKiBUaGlzIG11c3QgYmUgZGV0ZXJtaW5lZCBmcm9tIHRoZSBzdGF0dXMsIG5vdCB0aGUgJ0NoYW5nZXMnIGFycmF5IG9uIHRoZVxuICogb2JqZWN0OyB0aGUgbGF0dGVyIGNhbiBiZSBlbXB0eSBiZWNhdXNlIG5vIHJlc291cmNlcyB3ZXJlIGNoYW5nZWQsIGJ1dCBpZlxuICogdGhlcmUgYXJlIGNoYW5nZXMgdG8gT3V0cHV0cywgdGhlIGNoYW5nZSBzZXQgY2FuIHN0aWxsIGJlIGV4ZWN1dGVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2hhbmdlU2V0SGFzTm9DaGFuZ2VzKGRlc2NyaXB0aW9uOiBEZXNjcmliZUNoYW5nZVNldENvbW1hbmRPdXRwdXQpIHtcbiAgY29uc3Qgbm9DaGFuZ2VFcnJvclByZWZpeGVzID0gW1xuICAgIC8vIEVycm9yIG1lc3NhZ2UgZm9yIGEgcmVndWxhciB0ZW1wbGF0ZVxuICAgIFwiVGhlIHN1Ym1pdHRlZCBpbmZvcm1hdGlvbiBkaWRuJ3QgY29udGFpbiBjaGFuZ2VzLlwiLFxuICAgIC8vIEVycm9yIG1lc3NhZ2Ugd2hlbiBhIFRyYW5zZm9ybSBpcyBpbnZvbHZlZCAoc2VlICMxMDY1MClcbiAgICAnTm8gdXBkYXRlcyBhcmUgdG8gYmUgcGVyZm9ybWVkLicsXG4gIF07XG5cbiAgcmV0dXJuIChcbiAgICBkZXNjcmlwdGlvbi5TdGF0dXMgPT09ICdGQUlMRUQnICYmIG5vQ2hhbmdlRXJyb3JQcmVmaXhlcy5zb21lKChwKSA9PiAoZGVzY3JpcHRpb24uU3RhdHVzUmVhc29uID8/ICcnKS5zdGFydHNXaXRoKHApKVxuICApO1xufVxuXG4vKipcbiAqIFdhaXRzIGZvciBhIENsb3VkRm9ybWF0aW9uIHN0YWNrIHRvIHN0YWJpbGl6ZSBpbiBhIGNvbXBsZXRlL2F2YWlsYWJsZSBzdGF0ZVxuICogYWZ0ZXIgYSBkZWxldGUgb3BlcmF0aW9uIGlzIGlzc3VlZC5cbiAqXG4gKiBGYWlscyBpZiB0aGUgc3RhY2sgaXMgaW4gYSBGQUlMRUQgc3RhdGUuIFdpbGwgbm90IGZhaWwgaWYgdGhlIHN0YWNrIHdhc1xuICogYWxyZWFkeSBkZWxldGVkLlxuICpcbiAqIEBwYXJhbSBjZm4gICAgICAgIGEgQ2xvdWRGb3JtYXRpb24gY2xpZW50XG4gKiBAcGFyYW0gc3RhY2tOYW1lICAgICAgdGhlIG5hbWUgb2YgdGhlIHN0YWNrIHRvIHdhaXQgZm9yIGFmdGVyIGEgZGVsZXRlXG4gKlxuICogQHJldHVybnMgICAgIHRoZSBDbG91ZEZvcm1hdGlvbiBkZXNjcmlwdGlvbiBvZiB0aGUgc3RhYmlsaXplZCBzdGFjayBhZnRlciB0aGUgZGVsZXRlIGF0dGVtcHRcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdhaXRGb3JTdGFja0RlbGV0ZShcbiAgY2ZuOiBJQ2xvdWRGb3JtYXRpb25DbGllbnQsXG4gIHN0YWNrTmFtZTogc3RyaW5nLFxuKTogUHJvbWlzZTxDbG91ZEZvcm1hdGlvblN0YWNrIHwgdW5kZWZpbmVkPiB7XG4gIGNvbnN0IHN0YWNrID0gYXdhaXQgc3RhYmlsaXplU3RhY2soY2ZuLCBzdGFja05hbWUpO1xuICBpZiAoIXN0YWNrKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNvbnN0IHN0YXR1cyA9IHN0YWNrLnN0YWNrU3RhdHVzO1xuICBpZiAoc3RhdHVzLmlzRmFpbHVyZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBUaGUgc3RhY2sgbmFtZWQgJHtzdGFja05hbWV9IGlzIGluIGEgZmFpbGVkIHN0YXRlLiBZb3UgbWF5IG5lZWQgdG8gZGVsZXRlIGl0IGZyb20gdGhlIEFXUyBjb25zb2xlIDogJHtzdGF0dXN9YCxcbiAgICApO1xuICB9IGVsc2UgaWYgKHN0YXR1cy5pc0RlbGV0ZWQpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG4gIHJldHVybiBzdGFjaztcbn1cblxuLyoqXG4gKiBXYWl0cyBmb3IgYSBDbG91ZEZvcm1hdGlvbiBzdGFjayB0byBzdGFiaWxpemUgaW4gYSBjb21wbGV0ZS9hdmFpbGFibGUgc3RhdGVcbiAqIGFmdGVyIGFuIHVwZGF0ZS9jcmVhdGUgb3BlcmF0aW9uIGlzIGlzc3VlZC5cbiAqXG4gKiBGYWlscyBpZiB0aGUgc3RhY2sgaXMgaW4gYSBGQUlMRUQgc3RhdGUsIFJPTExCQUNLIHN0YXRlLCBvciBERUxFVEVEIHN0YXRlLlxuICpcbiAqIEBwYXJhbSBjZm4gICAgICAgIGEgQ2xvdWRGb3JtYXRpb24gY2xpZW50XG4gKiBAcGFyYW0gc3RhY2tOYW1lICAgICAgdGhlIG5hbWUgb2YgdGhlIHN0YWNrIHRvIHdhaXQgZm9yIGFmdGVyIGFuIHVwZGF0ZVxuICpcbiAqIEByZXR1cm5zICAgICB0aGUgQ2xvdWRGb3JtYXRpb24gZGVzY3JpcHRpb24gb2YgdGhlIHN0YWJpbGl6ZWQgc3RhY2sgYWZ0ZXIgdGhlIHVwZGF0ZSBhdHRlbXB0XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3YWl0Rm9yU3RhY2tEZXBsb3koXG4gIGNmbjogSUNsb3VkRm9ybWF0aW9uQ2xpZW50LFxuICBzdGFja05hbWU6IHN0cmluZyxcbik6IFByb21pc2U8Q2xvdWRGb3JtYXRpb25TdGFjayB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCBzdGFjayA9IGF3YWl0IHN0YWJpbGl6ZVN0YWNrKGNmbiwgc3RhY2tOYW1lKTtcbiAgaWYgKCFzdGFjaykge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBjb25zdCBzdGF0dXMgPSBzdGFjay5zdGFja1N0YXR1cztcblxuICBpZiAoc3RhdHVzLmlzQ3JlYXRpb25GYWlsdXJlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYFRoZSBzdGFjayBuYW1lZCAke3N0YWNrTmFtZX0gZmFpbGVkIGNyZWF0aW9uLCBpdCBtYXkgbmVlZCB0byBiZSBtYW51YWxseSBkZWxldGVkIGZyb20gdGhlIEFXUyBjb25zb2xlOiAke3N0YXR1c31gLFxuICAgICk7XG4gIH0gZWxzZSBpZiAoIXN0YXR1cy5pc0RlcGxveVN1Y2Nlc3MpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZSBzdGFjayBuYW1lZCAke3N0YWNrTmFtZX0gZmFpbGVkIHRvIGRlcGxveTogJHtzdGF0dXN9YCk7XG4gIH1cblxuICByZXR1cm4gc3RhY2s7XG59XG5cbi8qKlxuICogV2FpdCBmb3IgYSBzdGFjayB0byBiZWNvbWUgc3RhYmxlIChubyBsb25nZXIgX0lOX1BST0dSRVNTKSwgcmV0dXJuaW5nIGl0XG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzdGFiaWxpemVTdGFjayhjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudCwgc3RhY2tOYW1lOiBzdHJpbmcpIHtcbiAgZGVidWcoJ1dhaXRpbmcgZm9yIHN0YWNrICVzIHRvIGZpbmlzaCBjcmVhdGluZyBvciB1cGRhdGluZy4uLicsIHN0YWNrTmFtZSk7XG4gIHJldHVybiB3YWl0Rm9yKGFzeW5jICgpID0+IHtcbiAgICBjb25zdCBzdGFjayA9IGF3YWl0IENsb3VkRm9ybWF0aW9uU3RhY2subG9va3VwKGNmbiwgc3RhY2tOYW1lKTtcbiAgICBpZiAoIXN0YWNrLmV4aXN0cykge1xuICAgICAgZGVidWcoJ1N0YWNrICVzIGRvZXMgbm90IGV4aXN0Jywgc3RhY2tOYW1lKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBjb25zdCBzdGF0dXMgPSBzdGFjay5zdGFja1N0YXR1cztcbiAgICBpZiAoc3RhdHVzLmlzSW5Qcm9ncmVzcykge1xuICAgICAgZGVidWcoJ1N0YWNrICVzIGhhcyBhbiBvbmdvaW5nIG9wZXJhdGlvbiBpbiBwcm9ncmVzcyBhbmQgaXMgbm90IHN0YWJsZSAoJXMpJywgc3RhY2tOYW1lLCBzdGF0dXMpO1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9IGVsc2UgaWYgKHN0YXR1cy5pc1Jldmlld0luUHJvZ3Jlc3MpIHtcbiAgICAgIC8vIFRoaXMgbWF5IGhhcHBlbiBpZiBhIHN0YWNrIGNyZWF0aW9uIG9wZXJhdGlvbiBpcyBpbnRlcnJ1cHRlZCBiZWZvcmUgdGhlIENoYW5nZVNldCBleGVjdXRpb24gc3RhcnRzLiBSZWNvdmVyaW5nXG4gICAgICAvLyBmcm9tIHRoaXMgd291bGQgcmVxdWlyaW5nIG1hbnVhbCBpbnRlcnZlbnRpb24gKGRlbGV0aW5nIG9yIGV4ZWN1dGluZyB0aGUgcGVuZGluZyBDaGFuZ2VTZXQpLCBhbmQgZmFpbGluZyB0byBkb1xuICAgICAgLy8gc28gd2lsbCByZXN1bHQgaW4gYW4gZW5kbGVzcyB3YWl0IGhlcmUgKHRoZSBDaGFuZ2VTZXQgd29udCBkZWxldGUgb3IgZXhlY3V0ZSBpdHNlbGYpLiBJbnN0ZWFkIG9mIGJsb2NraW5nXG4gICAgICAvLyBcImZvcmV2ZXJcIiB3ZSBwcm9jZWVkIGFzIGlmIHRoZSBzdGFjayB3YXMgZXhpc3RpbmcgYW5kIHN0YWJsZS4gSWYgdGhlcmUgaXMgYSBjb25jdXJyZW50IG9wZXJhdGlvbiB0aGF0IGp1c3RcbiAgICAgIC8vIGhhc24ndCBmaW5pc2hlZCBwcm9jZWVkaW5nIGp1c3QgeWV0LCBlaXRoZXIgdGhpcyBvcGVyYXRpb24gb3IgdGhlIGNvbmN1cnJlbnQgb25lIG1heSBmYWlsIGR1ZSB0byB0aGUgb3RoZXIgb25lXG4gICAgICAvLyBoYXZpbmcgbWFkZSBwcm9ncmVzcy4gV2hpY2ggaXMgZmluZS4gSSBndWVzcy5cbiAgICAgIGRlYnVnKCdTdGFjayAlcyBpcyBpbiBSRVZJRVdfSU5fUFJPR1JFU1Mgc3RhdGUuIENvbnNpZGVyaW5nIHRoaXMgaXMgYSBzdGFibGUgc3RhdHVzICglcyknLCBzdGFja05hbWUsIHN0YXR1cyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHN0YWNrO1xuICB9KTtcbn1cblxuLyoqXG4gKiBUaGUgc2V0IG9mIChmb3JtYWwpIHBhcmFtZXRlcnMgdGhhdCBoYXZlIGJlZW4gZGVjbGFyZWQgaW4gYSB0ZW1wbGF0ZVxuICovXG5leHBvcnQgY2xhc3MgVGVtcGxhdGVQYXJhbWV0ZXJzIHtcbiAgcHVibGljIHN0YXRpYyBmcm9tVGVtcGxhdGUodGVtcGxhdGU6IFRlbXBsYXRlKSB7XG4gICAgcmV0dXJuIG5ldyBUZW1wbGF0ZVBhcmFtZXRlcnModGVtcGxhdGUuUGFyYW1ldGVycyB8fCB7fSk7XG4gIH1cblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHBhcmFtczogUmVjb3JkPHN0cmluZywgVGVtcGxhdGVQYXJhbWV0ZXI+KSB7fVxuXG4gIC8qKlxuICAgKiBDYWxjdWxhdGUgc3RhY2sgcGFyYW1ldGVycyB0byBwYXNzIGZyb20gdGhlIGdpdmVuIGRlc2lyZWQgcGFyYW1ldGVyIHZhbHVlc1xuICAgKlxuICAgKiBXaWxsIHRocm93IGlmIHBhcmFtZXRlcnMgd2l0aG91dCBhIERlZmF1bHQgdmFsdWUgb3IgYSBQcmV2aW91cyB2YWx1ZSBhcmUgbm90XG4gICAqIHN1cHBsaWVkLlxuICAgKi9cbiAgcHVibGljIHN1cHBseUFsbCh1cGRhdGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+KTogUGFyYW1ldGVyVmFsdWVzIHtcbiAgICByZXR1cm4gbmV3IFBhcmFtZXRlclZhbHVlcyh0aGlzLnBhcmFtcywgdXBkYXRlcyk7XG4gIH1cblxuICAvKipcbiAgICogRnJvbSB0aGUgdGVtcGxhdGUsIHRoZSBnaXZlbiBkZXNpcmVkIHZhbHVlcyBhbmQgdGhlIGN1cnJlbnQgdmFsdWVzLCBjYWxjdWxhdGUgdGhlIGNoYW5nZXMgdG8gdGhlIHN0YWNrIHBhcmFtZXRlcnNcbiAgICpcbiAgICogV2lsbCB0YWtlIGludG8gYWNjb3VudCBwYXJhbWV0ZXJzIGFscmVhZHkgc2V0IG9uIHRoZSB0ZW1wbGF0ZSAod2lsbCBlbWl0XG4gICAqICdVc2VQcmV2aW91c1ZhbHVlOiB0cnVlJyBmb3IgdGhvc2UgdW5sZXNzIHRoZSB2YWx1ZSBpcyBjaGFuZ2VkKSwgYW5kIHdpbGxcbiAgICogdGhyb3cgaWYgcGFyYW1ldGVycyB3aXRob3V0IGEgRGVmYXVsdCB2YWx1ZSBvciBhIFByZXZpb3VzIHZhbHVlIGFyZSBub3RcbiAgICogc3VwcGxpZWQuXG4gICAqL1xuICBwdWJsaWMgdXBkYXRlRXhpc3RpbmcoXG4gICAgdXBkYXRlczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPixcbiAgICBwcmV2aW91c1ZhbHVlczogUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbiAgKTogUGFyYW1ldGVyVmFsdWVzIHtcbiAgICByZXR1cm4gbmV3IFBhcmFtZXRlclZhbHVlcyh0aGlzLnBhcmFtcywgdXBkYXRlcywgcHJldmlvdXNWYWx1ZXMpO1xuICB9XG59XG5cbi8qKlxuICogVGhlIHNldCBvZiBwYXJhbWV0ZXJzIHdlJ3JlIGdvaW5nIHRvIHBhc3MgdG8gYSBTdGFja1xuICovXG5leHBvcnQgY2xhc3MgUGFyYW1ldGVyVmFsdWVzIHtcbiAgcHVibGljIHJlYWRvbmx5IHZhbHVlczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpUGFyYW1ldGVyczogUGFyYW1ldGVyW10gPSBbXTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGZvcm1hbFBhcmFtczogUmVjb3JkPHN0cmluZywgVGVtcGxhdGVQYXJhbWV0ZXI+LFxuICAgIHVwZGF0ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IHVuZGVmaW5lZD4sXG4gICAgcHJldmlvdXNWYWx1ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fSxcbiAgKSB7XG4gICAgY29uc3QgbWlzc2luZ1JlcXVpcmVkID0gbmV3IEFycmF5PHN0cmluZz4oKTtcblxuICAgIGZvciAoY29uc3QgW2tleSwgZm9ybWFsUGFyYW1dIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuZm9ybWFsUGFyYW1zKSkge1xuICAgICAgLy8gQ2hlY2sgdXBkYXRlcyBmaXJzdCwgdGhlbiB1c2UgdGhlIHByZXZpb3VzIHZhbHVlIChpZiBhdmFpbGFibGUpLCB0aGVuIHVzZVxuICAgICAgLy8gdGhlIGRlZmF1bHQgKGlmIGF2YWlsYWJsZSkuXG4gICAgICAvL1xuICAgICAgLy8gSWYgd2UgZG9uJ3QgZmluZCBhIHBhcmFtZXRlciB2YWx1ZSB1c2luZyBhbnkgb2YgdGhlc2UgbWV0aG9kcywgdGhlbiB0aGF0J3MgYW4gZXJyb3IuXG4gICAgICBjb25zdCB1cGRhdGVkVmFsdWUgPSB1cGRhdGVzW2tleV07XG4gICAgICBpZiAodXBkYXRlZFZhbHVlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy52YWx1ZXNba2V5XSA9IHVwZGF0ZWRWYWx1ZTtcbiAgICAgICAgdGhpcy5hcGlQYXJhbWV0ZXJzLnB1c2goe1xuICAgICAgICAgIFBhcmFtZXRlcktleToga2V5LFxuICAgICAgICAgIFBhcmFtZXRlclZhbHVlOiB1cGRhdGVzW2tleV0sXG4gICAgICAgIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKGtleSBpbiBwcmV2aW91c1ZhbHVlcykge1xuICAgICAgICB0aGlzLnZhbHVlc1trZXldID0gcHJldmlvdXNWYWx1ZXNba2V5XTtcbiAgICAgICAgdGhpcy5hcGlQYXJhbWV0ZXJzLnB1c2goeyBQYXJhbWV0ZXJLZXk6IGtleSwgVXNlUHJldmlvdXNWYWx1ZTogdHJ1ZSB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChmb3JtYWxQYXJhbS5EZWZhdWx0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy52YWx1ZXNba2V5XSA9IGZvcm1hbFBhcmFtLkRlZmF1bHQ7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBPaCBub1xuICAgICAgbWlzc2luZ1JlcXVpcmVkLnB1c2goa2V5KTtcbiAgICB9XG5cbiAgICBpZiAobWlzc2luZ1JlcXVpcmVkLmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGhlIGZvbGxvd2luZyBDbG91ZEZvcm1hdGlvbiBQYXJhbWV0ZXJzIGFyZSBtaXNzaW5nIGEgdmFsdWU6ICR7bWlzc2luZ1JlcXVpcmVkLmpvaW4oJywgJyl9YCk7XG4gICAgfVxuXG4gICAgLy8gSnVzdCBhcHBlbmQgYWxsIHN1cHBsaWVkIG92ZXJyaWRlcyB0aGF0IGFyZW4ndCByZWFsbHkgZXhwZWN0ZWQgKHRoaXNcbiAgICAvLyB3aWxsIGZhaWwgQ0ZOIGJ1dCBtYXliZSBwZW9wbGUgbWFkZSB0eXBvcyB0aGF0IHRoZXkgd2FudCB0byBiZSBub3RpZmllZFxuICAgIC8vIG9mKVxuICAgIGNvbnN0IHVua25vd25QYXJhbSA9IChba2V5LCBfXTogW3N0cmluZywgYW55XSkgPT4gdGhpcy5mb3JtYWxQYXJhbXNba2V5XSA9PT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhhc1ZhbHVlID0gKFtfLCB2YWx1ZV06IFtzdHJpbmcsIGFueV0pID0+ICEhdmFsdWU7XG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModXBkYXRlcykuZmlsdGVyKHVua25vd25QYXJhbSkuZmlsdGVyKGhhc1ZhbHVlKSkge1xuICAgICAgdGhpcy52YWx1ZXNba2V5XSA9IHZhbHVlITtcbiAgICAgIHRoaXMuYXBpUGFyYW1ldGVycy5wdXNoKHsgUGFyYW1ldGVyS2V5OiBrZXksIFBhcmFtZXRlclZhbHVlOiB2YWx1ZSB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciB0aGlzIHNldCBvZiBwYXJhbWV0ZXIgdXBkYXRlcyB3aWxsIGNoYW5nZSB0aGUgYWN0dWFsIHN0YWNrIHZhbHVlc1xuICAgKi9cbiAgcHVibGljIGhhc0NoYW5nZXMoY3VycmVudFZhbHVlczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IFBhcmFtZXRlckNoYW5nZXMge1xuICAgIC8vIElmIGFueSBvZiB0aGUgcGFyYW1ldGVycyBhcmUgU1NNIHBhcmFtZXRlcnMsIGRlcGxveWluZyBtdXN0IGFsd2F5cyBoYXBwZW5cbiAgICAvLyBiZWNhdXNlIHdlIGNhbid0IHByZWRpY3Qgd2hhdCB0aGUgdmFsdWVzIHdpbGwgYmUuIFdlIHdpbGwgYWxsb3cgc29tZVxuICAgIC8vIHBhcmFtZXRlcnMgdG8gb3B0IG91dCBvZiB0aGlzIGNoZWNrIGJ5IGhhdmluZyBhIG1hZ2ljIHN0cmluZyBpbiB0aGVpciBkZXNjcmlwdGlvbi5cbiAgICBpZiAoXG4gICAgICBPYmplY3QudmFsdWVzKHRoaXMuZm9ybWFsUGFyYW1zKS5zb21lKFxuICAgICAgICAocCkgPT4gcC5UeXBlLnN0YXJ0c1dpdGgoJ0FXUzo6U1NNOjpQYXJhbWV0ZXI6OicpICYmICFwLkRlc2NyaXB0aW9uPy5pbmNsdWRlcyhTU01QQVJBTV9OT19JTlZBTElEQVRFKSxcbiAgICAgIClcbiAgICApIHtcbiAgICAgIHJldHVybiAnc3NtJztcbiAgICB9XG5cbiAgICAvLyBPdGhlcndpc2Ugd2UncmUgZGlydHkgaWY6XG4gICAgLy8gLSBhbnkgb2YgdGhlIGV4aXN0aW5nIHZhbHVlcyBhcmUgcmVtb3ZlZCwgb3IgY2hhbmdlZFxuICAgIGlmIChPYmplY3QuZW50cmllcyhjdXJyZW50VmFsdWVzKS5zb21lKChba2V5LCB2YWx1ZV0pID0+ICEoa2V5IGluIHRoaXMudmFsdWVzKSB8fCB2YWx1ZSAhPT0gdGhpcy52YWx1ZXNba2V5XSkpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIC8vIC0gYW55IG9mIHRoZSB2YWx1ZXMgd2UncmUgc2V0dGluZyBhcmUgbmV3XG4gICAgaWYgKE9iamVjdC5rZXlzKHRoaXMudmFsdWVzKS5zb21lKChrZXkpID0+ICEoa2V5IGluIGN1cnJlbnRWYWx1ZXMpKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmV4cG9ydCB0eXBlIFBhcmFtZXRlckNoYW5nZXMgPSBib29sZWFuIHwgJ3NzbSc7XG4iXX0=