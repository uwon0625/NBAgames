"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHotswappableLambdaFunctionChange = isHotswappableLambdaFunctionChange;
const stream_1 = require("stream");
const common_1 = require("./common");
const util_1 = require("../../util");
const evaluate_cloudformation_template_1 = require("../evaluate-cloudformation-template");
// namespace object imports won't work in the bundle for function exports
// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver');
async function isHotswappableLambdaFunctionChange(logicalId, change, evaluateCfnTemplate) {
    // if the change is for a Lambda Version,
    // ignore it by returning an empty hotswap operation -
    // we will publish a new version when we get to hotswapping the actual Function this Version points to, below
    // (Versions can't be changed in CloudFormation anyway, they're immutable)
    if (change.newValue.Type === 'AWS::Lambda::Version') {
        return [
            {
                hotswappable: true,
                resourceType: 'AWS::Lambda::Version',
                resourceNames: [],
                propsChanged: [],
                service: 'lambda',
                apply: async (_sdk) => { },
            },
        ];
    }
    // we handle Aliases specially too
    if (change.newValue.Type === 'AWS::Lambda::Alias') {
        return classifyAliasChanges(change);
    }
    if (change.newValue.Type !== 'AWS::Lambda::Function') {
        return [];
    }
    const ret = [];
    const classifiedChanges = (0, common_1.classifyChanges)(change, ['Code', 'Environment', 'Description']);
    classifiedChanges.reportNonHotswappablePropertyChanges(ret);
    const functionName = await evaluateCfnTemplate.establishResourcePhysicalName(logicalId, change.newValue.Properties?.FunctionName);
    const namesOfHotswappableChanges = Object.keys(classifiedChanges.hotswappableProps);
    if (namesOfHotswappableChanges.length > 0) {
        ret.push({
            hotswappable: true,
            resourceType: change.newValue.Type,
            propsChanged: namesOfHotswappableChanges,
            service: 'lambda',
            resourceNames: [
                `Lambda Function '${functionName}'`,
                // add Version here if we're publishing a new one
                ...(await renderVersions(logicalId, evaluateCfnTemplate, [`Lambda Version for Function '${functionName}'`])),
                // add any Aliases that we are hotswapping here
                ...(await renderAliases(logicalId, evaluateCfnTemplate, async (alias) => `Lambda Alias '${alias}' for Function '${functionName}'`)),
            ],
            apply: async (sdk) => {
                const lambdaCodeChange = await evaluateLambdaFunctionProps(classifiedChanges.hotswappableProps, change.newValue.Properties?.Runtime, evaluateCfnTemplate);
                if (lambdaCodeChange === undefined) {
                    return;
                }
                if (!functionName) {
                    return;
                }
                const { versionsReferencingFunction, aliasesNames } = await versionsAndAliases(logicalId, evaluateCfnTemplate);
                const lambda = sdk.lambda();
                const operations = [];
                if (lambdaCodeChange.code !== undefined || lambdaCodeChange.configurations !== undefined) {
                    if (lambdaCodeChange.code !== undefined) {
                        const updateFunctionCodeResponse = await lambda.updateFunctionCode({
                            FunctionName: functionName,
                            S3Bucket: lambdaCodeChange.code.s3Bucket,
                            S3Key: lambdaCodeChange.code.s3Key,
                            ImageUri: lambdaCodeChange.code.imageUri,
                            ZipFile: lambdaCodeChange.code.functionCodeZip,
                            S3ObjectVersion: lambdaCodeChange.code.s3ObjectVersion,
                        });
                        await waitForLambdasPropertiesUpdateToFinish(updateFunctionCodeResponse, lambda, functionName);
                    }
                    if (lambdaCodeChange.configurations !== undefined) {
                        const updateRequest = {
                            FunctionName: functionName,
                        };
                        if (lambdaCodeChange.configurations.description !== undefined) {
                            updateRequest.Description = lambdaCodeChange.configurations.description;
                        }
                        if (lambdaCodeChange.configurations.environment !== undefined) {
                            updateRequest.Environment = lambdaCodeChange.configurations.environment;
                        }
                        const updateFunctionCodeResponse = await lambda.updateFunctionConfiguration(updateRequest);
                        await waitForLambdasPropertiesUpdateToFinish(updateFunctionCodeResponse, lambda, functionName);
                    }
                    // only if the code changed is there any point in publishing a new Version
                    if (versionsReferencingFunction.length > 0) {
                        const publishVersionPromise = lambda.publishVersion({
                            FunctionName: functionName,
                        });
                        if (aliasesNames.length > 0) {
                            // we need to wait for the Version to finish publishing
                            const versionUpdate = await publishVersionPromise;
                            for (const alias of aliasesNames) {
                                operations.push(lambda.updateAlias({
                                    FunctionName: functionName,
                                    Name: alias,
                                    FunctionVersion: versionUpdate.Version,
                                }));
                            }
                        }
                        else {
                            operations.push(publishVersionPromise);
                        }
                    }
                }
                // run all of our updates in parallel
                // Limited set of updates per function
                // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
                await Promise.all(operations);
            },
        });
    }
    return ret;
}
/**
 * Determines which changes to this Alias are hotswappable or not
 */
function classifyAliasChanges(change) {
    const ret = [];
    const classifiedChanges = (0, common_1.classifyChanges)(change, ['FunctionVersion']);
    classifiedChanges.reportNonHotswappablePropertyChanges(ret);
    const namesOfHotswappableChanges = Object.keys(classifiedChanges.hotswappableProps);
    if (namesOfHotswappableChanges.length > 0) {
        ret.push({
            hotswappable: true,
            resourceType: change.newValue.Type,
            propsChanged: [],
            service: 'lambda',
            resourceNames: [],
            apply: async (_sdk) => { },
        });
    }
    return ret;
}
/**
 * Evaluates the hotswappable properties of an AWS::Lambda::Function and
 * Returns a `LambdaFunctionChange` if the change is hotswappable.
 * Returns `undefined` if the change is not hotswappable.
 */
async function evaluateLambdaFunctionProps(hotswappablePropChanges, runtime, evaluateCfnTemplate) {
    /*
     * At first glance, we would want to initialize these using the "previous" values (change.oldValue),
     * in case only one of them changed, like the key, and the Bucket stayed the same.
     * However, that actually fails for old-style synthesis, which uses CFN Parameters!
     * Because the names of the Parameters depend on the hash of the Asset,
     * the Parameters used for the "old" values no longer exist in `assetParams` at this point,
     * which means we don't have the correct values available to evaluate the CFN expression with.
     * Fortunately, the diff will always include both the s3Bucket and s3Key parts of the Lambda's Code property,
     * even if only one of them was actually changed,
     * which means we don't need the "old" values at all, and we can safely initialize these with just `''`.
     */
    let code = undefined;
    let description = undefined;
    let environment = undefined;
    for (const updatedPropName in hotswappablePropChanges) {
        const updatedProp = hotswappablePropChanges[updatedPropName];
        switch (updatedPropName) {
            case 'Code':
                let s3Bucket, s3Key, s3ObjectVersion, imageUri, functionCodeZip;
                for (const newPropName in updatedProp.newValue) {
                    switch (newPropName) {
                        case 'S3Bucket':
                            s3Bucket = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue[newPropName]);
                            break;
                        case 'S3Key':
                            s3Key = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue[newPropName]);
                            break;
                        case 'S3ObjectVersion':
                            s3ObjectVersion = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue[newPropName]);
                            break;
                        case 'ImageUri':
                            imageUri = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue[newPropName]);
                            break;
                        case 'ZipFile':
                            // We must create a zip package containing a file with the inline code
                            const functionCode = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue[newPropName]);
                            const functionRuntime = await evaluateCfnTemplate.evaluateCfnExpression(runtime);
                            if (!functionRuntime) {
                                return undefined;
                            }
                            // file extension must be chosen depending on the runtime
                            const codeFileExt = determineCodeFileExtFromRuntime(functionRuntime);
                            functionCodeZip = await zipString(`index.${codeFileExt}`, functionCode);
                            break;
                    }
                }
                code = {
                    s3Bucket,
                    s3Key,
                    s3ObjectVersion,
                    imageUri,
                    functionCodeZip,
                };
                break;
            case 'Description':
                description = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue);
                break;
            case 'Environment':
                environment = await evaluateCfnTemplate.evaluateCfnExpression(updatedProp.newValue);
                break;
            default:
                // we will never get here, but just in case we do throw an error
                throw new Error('while apply()ing, found a property that cannot be hotswapped. Please report this at github.com/aws/aws-cdk/issues/new/choose');
        }
    }
    const configurations = description || environment ? { description, environment } : undefined;
    return code || configurations ? { code, configurations } : undefined;
}
/**
 * Compress a string as a file, returning a promise for the zip buffer
 * https://github.com/archiverjs/node-archiver/issues/342
 */
function zipString(fileName, rawString) {
    return new Promise((resolve, reject) => {
        const buffers = [];
        const converter = new stream_1.Writable();
        converter._write = (chunk, _, callback) => {
            buffers.push(chunk);
            process.nextTick(callback);
        };
        converter.on('finish', () => {
            resolve(Buffer.concat(buffers));
        });
        const archive = archiver('zip');
        archive.on('error', (err) => {
            reject(err);
        });
        archive.pipe(converter);
        archive.append(rawString, {
            name: fileName,
            date: new Date('1980-01-01T00:00:00.000Z'), // Add date to make resulting zip file deterministic
        });
        void archive.finalize();
    });
}
/**
 * After a Lambda Function is updated, it cannot be updated again until the
 * `State=Active` and the `LastUpdateStatus=Successful`.
 *
 * Depending on the configuration of the Lambda Function this could happen relatively quickly
 * or very slowly. For example, Zip based functions _not_ in a VPC can take ~1 second whereas VPC
 * or Container functions can take ~25 seconds (and 'idle' VPC functions can take minutes).
 */
async function waitForLambdasPropertiesUpdateToFinish(currentFunctionConfiguration, lambda, functionName) {
    const functionIsInVpcOrUsesDockerForCode = currentFunctionConfiguration.VpcConfig?.VpcId || currentFunctionConfiguration.PackageType === 'Image';
    // if the function is deployed in a VPC or if it is a container image function
    // then the update will take much longer and we can wait longer between checks
    // otherwise, the update will be quick, so a 1-second delay is fine
    const delaySeconds = functionIsInVpcOrUsesDockerForCode ? 5 : 1;
    await lambda.waitUntilFunctionUpdated(delaySeconds, {
        FunctionName: functionName,
    });
}
/**
 * Get file extension from Lambda runtime string.
 * We use this extension to create a deployment package from Lambda inline code.
 */
function determineCodeFileExtFromRuntime(runtime) {
    if (runtime.startsWith('node')) {
        return 'js';
    }
    if (runtime.startsWith('python')) {
        return 'py';
    }
    // Currently inline code only supports Node.js and Python, ignoring other runtimes.
    // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-lambda-function-code.html#aws-properties-lambda-function-code-properties
    throw new evaluate_cloudformation_template_1.CfnEvaluationException(`runtime ${runtime} is unsupported, only node.js and python runtimes are currently supported.`);
}
/**
 * Finds all Versions that reference an AWS::Lambda::Function with logical ID `logicalId`
 * and Aliases that reference those Versions.
 */
async function versionsAndAliases(logicalId, evaluateCfnTemplate) {
    // find all Lambda Versions that reference this Function
    const versionsReferencingFunction = evaluateCfnTemplate
        .findReferencesTo(logicalId)
        .filter((r) => r.Type === 'AWS::Lambda::Version');
    // find all Lambda Aliases that reference the above Versions
    const aliasesReferencingVersions = (0, util_1.flatMap)(versionsReferencingFunction, v => evaluateCfnTemplate.findReferencesTo(v.LogicalId));
    // Limited set of updates per function
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    const aliasesNames = await Promise.all(aliasesReferencingVersions.map(a => evaluateCfnTemplate.evaluateCfnExpression(a.Properties?.Name)));
    return { versionsReferencingFunction, aliasesNames };
}
/**
 * Renders the string used in displaying Alias resource names that reference the specified Lambda Function
 */
async function renderAliases(logicalId, evaluateCfnTemplate, callbackfn) {
    const aliasesNames = (await versionsAndAliases(logicalId, evaluateCfnTemplate)).aliasesNames;
    // Limited set of updates per function
    // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
    return Promise.all(aliasesNames.map(callbackfn));
}
/**
 * Renders the string used in displaying Version resource names that reference the specified Lambda Function
 */
async function renderVersions(logicalId, evaluateCfnTemplate, versionString) {
    const versions = (await versionsAndAliases(logicalId, evaluateCfnTemplate)).versionsReferencingFunction;
    return versions.length > 0 ? versionString : [];
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWZ1bmN0aW9ucy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImxhbWJkYS1mdW5jdGlvbnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFXQSxnRkF3SUM7QUFuSkQsbUNBQWtDO0FBRWxDLHFDQUFrSDtBQUNsSCxxQ0FBcUM7QUFFckMsMEZBQWtIO0FBRWxILHlFQUF5RTtBQUN6RSxpRUFBaUU7QUFDakUsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBRTlCLEtBQUssVUFBVSxrQ0FBa0MsQ0FDdEQsU0FBaUIsRUFDakIsTUFBbUMsRUFDbkMsbUJBQW1EO0lBRW5ELHlDQUF5QztJQUN6QyxzREFBc0Q7SUFDdEQsNkdBQTZHO0lBQzdHLDBFQUEwRTtJQUMxRSxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLHNCQUFzQixFQUFFLENBQUM7UUFDcEQsT0FBTztZQUNMO2dCQUNFLFlBQVksRUFBRSxJQUFJO2dCQUNsQixZQUFZLEVBQUUsc0JBQXNCO2dCQUNwQyxhQUFhLEVBQUUsRUFBRTtnQkFDakIsWUFBWSxFQUFFLEVBQUU7Z0JBQ2hCLE9BQU8sRUFBRSxRQUFRO2dCQUNqQixLQUFLLEVBQUUsS0FBSyxFQUFFLElBQVMsRUFBRSxFQUFFLEdBQUUsQ0FBQzthQUMvQjtTQUNGLENBQUM7SUFDSixDQUFDO0lBRUQsa0NBQWtDO0lBQ2xDLElBQUksTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEtBQUssb0JBQW9CLEVBQUUsQ0FBQztRQUNsRCxPQUFPLG9CQUFvQixDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ3RDLENBQUM7SUFFRCxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxLQUFLLHVCQUF1QixFQUFFLENBQUM7UUFDckQsT0FBTyxFQUFFLENBQUM7SUFDWixDQUFDO0lBRUQsTUFBTSxHQUFHLEdBQXdCLEVBQUUsQ0FBQztJQUNwQyxNQUFNLGlCQUFpQixHQUFHLElBQUEsd0JBQWUs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QUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO0lBQ3JELHNDQUFzQztJQUN0Qyx3RUFBd0U7SUFDeEUsTUFBTSxZQUFZLEdBQUcsTUFBTSxPQUFPLENBQUMsR0FBRyxDQUFDLDBCQUEwQixDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUN4RSxtQkFBbUIsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUVsRSxPQUFPLEVBQUUsMkJBQTJCLEVBQUUsWUFBWSxFQUFFLENBQUM7QUFDdkQsQ0FBQztBQUVEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLGFBQWEsQ0FDMUIsU0FBaUIsRUFDakIsbUJBQW1ELEVBQ25ELFVBQXdFO0lBRXhFLE1BQU0sWUFBWSxHQUFHLENBQUMsTUFBTSxrQkFBa0IsQ0FBQyxTQUFTLEVBQUUsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQztJQUU3RixzQ0FBc0M7SUFDdEMsd0VBQXdFO0lBQ3hFLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUM7QUFDbkQsQ0FBQztBQUVEOztHQUVHO0FBQ0gsS0FBSyxVQUFVLGNBQWMsQ0FDM0IsU0FBaUIsRUFDakIsbUJBQW1ELEVBQ25ELGFBQXVCO0lBRXZCLE1BQU0sUUFBUSxHQUFHLENBQUMsTUFBTSxrQkFBa0IsQ0FBQyxTQUFTLEVBQUUsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLDJCQUEyQixDQUFDO0lBRXhHLE9BQU8sUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0FBQ2xELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBXcml0YWJsZSB9IGZyb20gJ3N0cmVhbSc7XG5pbXBvcnQgeyB0eXBlIEZ1bmN0aW9uQ29uZmlndXJhdGlvbiwgdHlwZSBVcGRhdGVGdW5jdGlvbkNvbmZpZ3VyYXRpb25Db21tYW5kSW5wdXQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtbGFtYmRhJztcbmltcG9ydCB7IHR5cGUgQ2hhbmdlSG90c3dhcFJlc3VsdCwgY2xhc3NpZnlDaGFuZ2VzLCB0eXBlIEhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSwgUHJvcERpZmZzIH0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHsgZmxhdE1hcCB9IGZyb20gJy4uLy4uL3V0aWwnO1xuaW1wb3J0IHR5cGUgeyBJTGFtYmRhQ2xpZW50LCBTREsgfSBmcm9tICcuLi9hd3MtYXV0aCc7XG5pbXBvcnQgeyBDZm5FdmFsdWF0aW9uRXhjZXB0aW9uLCB0eXBlIEV2YWx1YXRlQ2xvdWRGb3JtYXRpb25UZW1wbGF0ZSB9IGZyb20gJy4uL2V2YWx1YXRlLWNsb3VkZm9ybWF0aW9uLXRlbXBsYXRlJztcblxuLy8gbmFtZXNwYWNlIG9iamVjdCBpbXBvcnRzIHdvbid0IHdvcmsgaW4gdGhlIGJ1bmRsZSBmb3IgZnVuY3Rpb24gZXhwb3J0c1xuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1yZXF1aXJlLWltcG9ydHNcbmNvbnN0IGFyY2hpdmVyID0gcmVxdWlyZSgnYXJjaGl2ZXInKTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGlzSG90c3dhcHBhYmxlTGFtYmRhRnVuY3Rpb25DaGFuZ2UoXG4gIGxvZ2ljYWxJZDogc3RyaW5nLFxuICBjaGFuZ2U6IEhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSxcbiAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuKTogUHJvbWlzZTxDaGFuZ2VIb3Rzd2FwUmVzdWx0PiB7XG4gIC8vIGlmIHRoZSBjaGFuZ2UgaXMgZm9yIGEgTGFtYmRhIFZlcnNpb24sXG4gIC8vIGlnbm9yZSBpdCBieSByZXR1cm5pbmcgYW4gZW1wdHkgaG90c3dhcCBvcGVyYXRpb24gLVxuICAvLyB3ZSB3aWxsIHB1Ymxpc2ggYSBuZXcgdmVyc2lvbiB3aGVuIHdlIGdldCB0byBob3Rzd2FwcGluZyB0aGUgYWN0dWFsIEZ1bmN0aW9uIHRoaXMgVmVyc2lvbiBwb2ludHMgdG8sIGJlbG93XG4gIC8vIChWZXJzaW9ucyBjYW4ndCBiZSBjaGFuZ2VkIGluIENsb3VkRm9ybWF0aW9uIGFueXdheSwgdGhleSdyZSBpbW11dGFibGUpXG4gIGlmIChjaGFuZ2UubmV3VmFsdWUuVHlwZSA9PT0gJ0FXUzo6TGFtYmRhOjpWZXJzaW9uJykge1xuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGhvdHN3YXBwYWJsZTogdHJ1ZSxcbiAgICAgICAgcmVzb3VyY2VUeXBlOiAnQVdTOjpMYW1iZGE6OlZlcnNpb24nLFxuICAgICAgICByZXNvdXJjZU5hbWVzOiBbXSxcbiAgICAgICAgcHJvcHNDaGFuZ2VkOiBbXSxcbiAgICAgICAgc2VydmljZTogJ2xhbWJkYScsXG4gICAgICAgIGFwcGx5OiBhc3luYyAoX3NkazogU0RLKSA9PiB7fSxcbiAgICAgIH0sXG4gICAgXTtcbiAgfVxuXG4gIC8vIHdlIGhhbmRsZSBBbGlhc2VzIHNwZWNpYWxseSB0b29cbiAgaWYgKGNoYW5nZS5uZXdWYWx1ZS5UeXBlID09PSAnQVdTOjpMYW1iZGE6OkFsaWFzJykge1xuICAgIHJldHVybiBjbGFzc2lmeUFsaWFzQ2hhbmdlcyhjaGFuZ2UpO1xuICB9XG5cbiAgaWYgKGNoYW5nZS5uZXdWYWx1ZS5UeXBlICE9PSAnQVdTOjpMYW1iZGE6OkZ1bmN0aW9uJykge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IHJldDogQ2hhbmdlSG90c3dhcFJlc3VsdCA9IFtdO1xuICBjb25zdCBjbGFzc2lmaWVkQ2hhbmdlcyA9IGNsYXNzaWZ5Q2hhbmdlcyhjaGFuZ2UsIFsnQ29kZScsICdFbnZpcm9ubWVudCcsICdEZXNjcmlwdGlvbiddKTtcbiAgY2xhc3NpZmllZENoYW5nZXMucmVwb3J0Tm9uSG90c3dhcHBhYmxlUHJvcGVydHlDaGFuZ2VzKHJldCk7XG5cbiAgY29uc3QgZnVuY3Rpb25OYW1lID0gYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5lc3RhYmxpc2hSZXNvdXJjZVBoeXNpY2FsTmFtZShcbiAgICBsb2dpY2FsSWQsXG4gICAgY2hhbmdlLm5ld1ZhbHVlLlByb3BlcnRpZXM/LkZ1bmN0aW9uTmFtZSxcbiAgKTtcbiAgY29uc3QgbmFtZXNPZkhvdHN3YXBwYWJsZUNoYW5nZXMgPSBPYmplY3Qua2V5cyhjbGFzc2lmaWVkQ2hhbmdlcy5ob3Rzd2FwcGFibGVQcm9wcyk7XG4gIGlmIChuYW1lc09mSG90c3dhcHBhYmxlQ2hhbmdlcy5sZW5ndGggPiAwKSB7XG4gICAgcmV0LnB1c2goe1xuICAgICAgaG90c3dhcHBhYmxlOiB0cnVlLFxuICAgICAgcmVzb3VyY2VUeXBlOiBjaGFuZ2UubmV3VmFsdWUuVHlwZSxcbiAgICAgIHByb3BzQ2hhbmdlZDogbmFtZXNPZkhvdHN3YXBwYWJsZUNoYW5nZXMsXG4gICAgICBzZXJ2aWNlOiAnbGFtYmRhJyxcbiAgICAgIHJlc291cmNlTmFtZXM6IFtcbiAgICAgICAgYExhbWJkYSBGdW5jdGlvbiAnJHtmdW5jdGlvbk5hbWV9J2AsXG4gICAgICAgIC8vIGFkZCBWZXJzaW9uIGhlcmUgaWYgd2UncmUgcHVibGlzaGluZyBhIG5ldyBvbmVcbiAgICAgICAgLi4uKGF3YWl0IHJlbmRlclZlcnNpb25zKGxvZ2ljYWxJZCwgZXZhbHVhdGVDZm5UZW1wbGF0ZSwgW2BMYW1iZGEgVmVyc2lvbiBmb3IgRnVuY3Rpb24gJyR7ZnVuY3Rpb25OYW1lfSdgXSkpLFxuICAgICAgICAvLyBhZGQgYW55IEFsaWFzZXMgdGhhdCB3ZSBhcmUgaG90c3dhcHBpbmcgaGVyZVxuICAgICAgICAuLi4oYXdhaXQgcmVuZGVyQWxpYXNlcyhcbiAgICAgICAgICBsb2dpY2FsSWQsXG4gICAgICAgICAgZXZhbHVhdGVDZm5UZW1wbGF0ZSxcbiAgICAgICAgICBhc3luYyAoYWxpYXMpID0+IGBMYW1iZGEgQWxpYXMgJyR7YWxpYXN9JyBmb3IgRnVuY3Rpb24gJyR7ZnVuY3Rpb25OYW1lfSdgLFxuICAgICAgICApKSxcbiAgICAgIF0sXG4gICAgICBhcHBseTogYXN5bmMgKHNkazogU0RLKSA9PiB7XG4gICAgICAgIGNvbnN0IGxhbWJkYUNvZGVDaGFuZ2UgPSBhd2FpdCBldmFsdWF0ZUxhbWJkYUZ1bmN0aW9uUHJvcHMoXG4gICAgICAgICAgY2xhc3NpZmllZENoYW5nZXMuaG90c3dhcHBhYmxlUHJvcHMsXG4gICAgICAgICAgY2hhbmdlLm5ld1ZhbHVlLlByb3BlcnRpZXM/LlJ1bnRpbWUsXG4gICAgICAgICAgZXZhbHVhdGVDZm5UZW1wbGF0ZSxcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKGxhbWJkYUNvZGVDaGFuZ2UgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghZnVuY3Rpb25OYW1lKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgeyB2ZXJzaW9uc1JlZmVyZW5jaW5nRnVuY3Rpb24sIGFsaWFzZXNOYW1lcyB9ID0gYXdhaXQgdmVyc2lvbnNBbmRBbGlhc2VzKGxvZ2ljYWxJZCwgZXZhbHVhdGVDZm5UZW1wbGF0ZSk7XG4gICAgICAgIGNvbnN0IGxhbWJkYSA9IHNkay5sYW1iZGEoKTtcbiAgICAgICAgY29uc3Qgb3BlcmF0aW9uczogUHJvbWlzZTxhbnk+W10gPSBbXTtcblxuICAgICAgICBpZiAobGFtYmRhQ29kZUNoYW5nZS5jb2RlICE9PSB1bmRlZmluZWQgfHwgbGFtYmRhQ29kZUNoYW5nZS5jb25maWd1cmF0aW9ucyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKGxhbWJkYUNvZGVDaGFuZ2UuY29kZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb25zdCB1cGRhdGVGdW5jdGlvbkNvZGVSZXNwb25zZSA9IGF3YWl0IGxhbWJkYS51cGRhdGVGdW5jdGlvbkNvZGUoe1xuICAgICAgICAgICAgICBGdW5jdGlvbk5hbWU6IGZ1bmN0aW9uTmFtZSxcbiAgICAgICAgICAgICAgUzNCdWNrZXQ6IGxhbWJkYUNvZGVDaGFuZ2UuY29kZS5zM0J1Y2tldCxcbiAgICAgICAgICAgICAgUzNLZXk6IGxhbWJkYUNvZGVDaGFuZ2UuY29kZS5zM0tleSxcbiAgICAgICAgICAgICAgSW1hZ2VVcmk6IGxhbWJkYUNvZGVDaGFuZ2UuY29kZS5pbWFnZVVyaSxcbiAgICAgICAgICAgICAgWmlwRmlsZTogbGFtYmRhQ29kZUNoYW5nZS5jb2RlLmZ1bmN0aW9uQ29kZVppcCxcbiAgICAgICAgICAgICAgUzNPYmplY3RWZXJzaW9uOiBsYW1iZGFDb2RlQ2hhbmdlLmNvZGUuczNPYmplY3RWZXJzaW9uLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGF3YWl0IHdhaXRGb3JMYW1iZGFzUHJvcGVydGllc1VwZGF0ZVRvRmluaXNoKHVwZGF0ZUZ1bmN0aW9uQ29kZVJlc3BvbnNlLCBsYW1iZGEsIGZ1bmN0aW9uTmFtZSk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGxhbWJkYUNvZGVDaGFuZ2UuY29uZmlndXJhdGlvbnMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29uc3QgdXBkYXRlUmVxdWVzdDogVXBkYXRlRnVuY3Rpb25Db25maWd1cmF0aW9uQ29tbWFuZElucHV0ID0ge1xuICAgICAgICAgICAgICBGdW5jdGlvbk5hbWU6IGZ1bmN0aW9uTmFtZSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBpZiAobGFtYmRhQ29kZUNoYW5nZS5jb25maWd1cmF0aW9ucy5kZXNjcmlwdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3QuRGVzY3JpcHRpb24gPSBsYW1iZGFDb2RlQ2hhbmdlLmNvbmZpZ3VyYXRpb25zLmRlc2NyaXB0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGxhbWJkYUNvZGVDaGFuZ2UuY29uZmlndXJhdGlvbnMuZW52aXJvbm1lbnQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LkVudmlyb25tZW50ID0gbGFtYmRhQ29kZUNoYW5nZS5jb25maWd1cmF0aW9ucy5lbnZpcm9ubWVudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHVwZGF0ZUZ1bmN0aW9uQ29kZVJlc3BvbnNlID0gYXdhaXQgbGFtYmRhLnVwZGF0ZUZ1bmN0aW9uQ29uZmlndXJhdGlvbih1cGRhdGVSZXF1ZXN0KTtcbiAgICAgICAgICAgIGF3YWl0IHdhaXRGb3JMYW1iZGFzUHJvcGVydGllc1VwZGF0ZVRvRmluaXNoKHVwZGF0ZUZ1bmN0aW9uQ29kZVJlc3BvbnNlLCBsYW1iZGEsIGZ1bmN0aW9uTmFtZSk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gb25seSBpZiB0aGUgY29kZSBjaGFuZ2VkIGlzIHRoZXJlIGFueSBwb2ludCBpbiBwdWJsaXNoaW5nIGEgbmV3IFZlcnNpb25cbiAgICAgICAgICBpZiAodmVyc2lvbnNSZWZlcmVuY2luZ0Z1bmN0aW9uLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IHB1Ymxpc2hWZXJzaW9uUHJvbWlzZSA9IGxhbWJkYS5wdWJsaXNoVmVyc2lvbih7XG4gICAgICAgICAgICAgIEZ1bmN0aW9uTmFtZTogZnVuY3Rpb25OYW1lLFxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmIChhbGlhc2VzTmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAvLyB3ZSBuZWVkIHRvIHdhaXQgZm9yIHRoZSBWZXJzaW9uIHRvIGZpbmlzaCBwdWJsaXNoaW5nXG4gICAgICAgICAgICAgIGNvbnN0IHZlcnNpb25VcGRhdGUgPSBhd2FpdCBwdWJsaXNoVmVyc2lvblByb21pc2U7XG4gICAgICAgICAgICAgIGZvciAoY29uc3QgYWxpYXMgb2YgYWxpYXNlc05hbWVzKSB7XG4gICAgICAgICAgICAgICAgb3BlcmF0aW9ucy5wdXNoKFxuICAgICAgICAgICAgICAgICAgbGFtYmRhLnVwZGF0ZUFsaWFzKHtcbiAgICAgICAgICAgICAgICAgICAgRnVuY3Rpb25OYW1lOiBmdW5jdGlvbk5hbWUsXG4gICAgICAgICAgICAgICAgICAgIE5hbWU6IGFsaWFzLFxuICAgICAgICAgICAgICAgICAgICBGdW5jdGlvblZlcnNpb246IHZlcnNpb25VcGRhdGUuVmVyc2lvbixcbiAgICAgICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIG9wZXJhdGlvbnMucHVzaChwdWJsaXNoVmVyc2lvblByb21pc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHJ1biBhbGwgb2Ygb3VyIHVwZGF0ZXMgaW4gcGFyYWxsZWxcbiAgICAgICAgLy8gTGltaXRlZCBzZXQgb2YgdXBkYXRlcyBwZXIgZnVuY3Rpb25cbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEBjZGtsYWJzL3Byb21pc2VhbGwtbm8tdW5ib3VuZGVkLXBhcmFsbGVsaXNtXG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKG9wZXJhdGlvbnMpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiByZXQ7XG59XG5cbi8qKlxuICogRGV0ZXJtaW5lcyB3aGljaCBjaGFuZ2VzIHRvIHRoaXMgQWxpYXMgYXJlIGhvdHN3YXBwYWJsZSBvciBub3RcbiAqL1xuZnVuY3Rpb24gY2xhc3NpZnlBbGlhc0NoYW5nZXMoY2hhbmdlOiBIb3Rzd2FwcGFibGVDaGFuZ2VDYW5kaWRhdGUpOiBDaGFuZ2VIb3Rzd2FwUmVzdWx0IHtcbiAgY29uc3QgcmV0OiBDaGFuZ2VIb3Rzd2FwUmVzdWx0ID0gW107XG4gIGNvbnN0IGNsYXNzaWZpZWRDaGFuZ2VzID0gY2xhc3NpZnlDaGFuZ2VzKGNoYW5nZSwgWydGdW5jdGlvblZlcnNpb24nXSk7XG4gIGNsYXNzaWZpZWRDaGFuZ2VzLnJlcG9ydE5vbkhvdHN3YXBwYWJsZVByb3BlcnR5Q2hhbmdlcyhyZXQpO1xuXG4gIGNvbnN0IG5hbWVzT2ZIb3Rzd2FwcGFibGVDaGFuZ2VzID0gT2JqZWN0LmtleXMoY2xhc3NpZmllZENoYW5nZXMuaG90c3dhcHBhYmxlUHJvcHMpO1xuICBpZiAobmFtZXNPZkhvdHN3YXBwYWJsZUNoYW5nZXMubGVuZ3RoID4gMCkge1xuICAgIHJldC5wdXNoKHtcbiAgICAgIGhvdHN3YXBwYWJsZTogdHJ1ZSxcbiAgICAgIHJlc291cmNlVHlwZTogY2hhbmdlLm5ld1ZhbHVlLlR5cGUsXG4gICAgICBwcm9wc0NoYW5nZWQ6IFtdLFxuICAgICAgc2VydmljZTogJ2xhbWJkYScsXG4gICAgICByZXNvdXJjZU5hbWVzOiBbXSxcbiAgICAgIGFwcGx5OiBhc3luYyAoX3NkazogU0RLKSA9PiB7fSxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiByZXQ7XG59XG5cbi8qKlxuICogRXZhbHVhdGVzIHRoZSBob3Rzd2FwcGFibGUgcHJvcGVydGllcyBvZiBhbiBBV1M6OkxhbWJkYTo6RnVuY3Rpb24gYW5kXG4gKiBSZXR1cm5zIGEgYExhbWJkYUZ1bmN0aW9uQ2hhbmdlYCBpZiB0aGUgY2hhbmdlIGlzIGhvdHN3YXBwYWJsZS5cbiAqIFJldHVybnMgYHVuZGVmaW5lZGAgaWYgdGhlIGNoYW5nZSBpcyBub3QgaG90c3dhcHBhYmxlLlxuICovXG5hc3luYyBmdW5jdGlvbiBldmFsdWF0ZUxhbWJkYUZ1bmN0aW9uUHJvcHMoXG4gIGhvdHN3YXBwYWJsZVByb3BDaGFuZ2VzOiBQcm9wRGlmZnMsXG4gIHJ1bnRpbWU6IHN0cmluZyxcbiAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuKTogUHJvbWlzZTxMYW1iZGFGdW5jdGlvbkNoYW5nZSB8IHVuZGVmaW5lZD4ge1xuICAvKlxuICAgKiBBdCBmaXJzdCBnbGFuY2UsIHdlIHdvdWxkIHdhbnQgdG8gaW5pdGlhbGl6ZSB0aGVzZSB1c2luZyB0aGUgXCJwcmV2aW91c1wiIHZhbHVlcyAoY2hhbmdlLm9sZFZhbHVlKSxcbiAgICogaW4gY2FzZSBvbmx5IG9uZSBvZiB0aGVtIGNoYW5nZWQsIGxpa2UgdGhlIGtleSwgYW5kIHRoZSBCdWNrZXQgc3RheWVkIHRoZSBzYW1lLlxuICAgKiBIb3dldmVyLCB0aGF0IGFjdHVhbGx5IGZhaWxzIGZvciBvbGQtc3R5bGUgc3ludGhlc2lzLCB3aGljaCB1c2VzIENGTiBQYXJhbWV0ZXJzIVxuICAgKiBCZWNhdXNlIHRoZSBuYW1lcyBvZiB0aGUgUGFyYW1ldGVycyBkZXBlbmQgb24gdGhlIGhhc2ggb2YgdGhlIEFzc2V0LFxuICAgKiB0aGUgUGFyYW1ldGVycyB1c2VkIGZvciB0aGUgXCJvbGRcIiB2YWx1ZXMgbm8gbG9uZ2VyIGV4aXN0IGluIGBhc3NldFBhcmFtc2AgYXQgdGhpcyBwb2ludCxcbiAgICogd2hpY2ggbWVhbnMgd2UgZG9uJ3QgaGF2ZSB0aGUgY29ycmVjdCB2YWx1ZXMgYXZhaWxhYmxlIHRvIGV2YWx1YXRlIHRoZSBDRk4gZXhwcmVzc2lvbiB3aXRoLlxuICAgKiBGb3J0dW5hdGVseSwgdGhlIGRpZmYgd2lsbCBhbHdheXMgaW5jbHVkZSBib3RoIHRoZSBzM0J1Y2tldCBhbmQgczNLZXkgcGFydHMgb2YgdGhlIExhbWJkYSdzIENvZGUgcHJvcGVydHksXG4gICAqIGV2ZW4gaWYgb25seSBvbmUgb2YgdGhlbSB3YXMgYWN0dWFsbHkgY2hhbmdlZCxcbiAgICogd2hpY2ggbWVhbnMgd2UgZG9uJ3QgbmVlZCB0aGUgXCJvbGRcIiB2YWx1ZXMgYXQgYWxsLCBhbmQgd2UgY2FuIHNhZmVseSBpbml0aWFsaXplIHRoZXNlIHdpdGgganVzdCBgJydgLlxuICAgKi9cbiAgbGV0IGNvZGU6IExhbWJkYUZ1bmN0aW9uQ29kZSB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgbGV0IGRlc2NyaXB0aW9uOiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG4gIGxldCBlbnZpcm9ubWVudDogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcblxuICBmb3IgKGNvbnN0IHVwZGF0ZWRQcm9wTmFtZSBpbiBob3Rzd2FwcGFibGVQcm9wQ2hhbmdlcykge1xuICAgIGNvbnN0IHVwZGF0ZWRQcm9wID0gaG90c3dhcHBhYmxlUHJvcENoYW5nZXNbdXBkYXRlZFByb3BOYW1lXTtcblxuICAgIHN3aXRjaCAodXBkYXRlZFByb3BOYW1lKSB7XG4gICAgICBjYXNlICdDb2RlJzpcbiAgICAgICAgbGV0IHMzQnVja2V0LCBzM0tleSwgczNPYmplY3RWZXJzaW9uLCBpbWFnZVVyaSwgZnVuY3Rpb25Db2RlWmlwO1xuXG4gICAgICAgIGZvciAoY29uc3QgbmV3UHJvcE5hbWUgaW4gdXBkYXRlZFByb3AubmV3VmFsdWUpIHtcbiAgICAgICAgICBzd2l0Y2ggKG5ld1Byb3BOYW1lKSB7XG4gICAgICAgICAgICBjYXNlICdTM0J1Y2tldCc6XG4gICAgICAgICAgICAgIHMzQnVja2V0ID0gYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5ldmFsdWF0ZUNmbkV4cHJlc3Npb24odXBkYXRlZFByb3AubmV3VmFsdWVbbmV3UHJvcE5hbWVdKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdTM0tleSc6XG4gICAgICAgICAgICAgIHMzS2V5ID0gYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5ldmFsdWF0ZUNmbkV4cHJlc3Npb24odXBkYXRlZFByb3AubmV3VmFsdWVbbmV3UHJvcE5hbWVdKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdTM09iamVjdFZlcnNpb24nOlxuICAgICAgICAgICAgICBzM09iamVjdFZlcnNpb24gPSBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbih1cGRhdGVkUHJvcC5uZXdWYWx1ZVtuZXdQcm9wTmFtZV0pO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ0ltYWdlVXJpJzpcbiAgICAgICAgICAgICAgaW1hZ2VVcmkgPSBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbih1cGRhdGVkUHJvcC5uZXdWYWx1ZVtuZXdQcm9wTmFtZV0pO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ1ppcEZpbGUnOlxuICAgICAgICAgICAgICAvLyBXZSBtdXN0IGNyZWF0ZSBhIHppcCBwYWNrYWdlIGNvbnRhaW5pbmcgYSBmaWxlIHdpdGggdGhlIGlubGluZSBjb2RlXG4gICAgICAgICAgICAgIGNvbnN0IGZ1bmN0aW9uQ29kZSA9IGF3YWl0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUuZXZhbHVhdGVDZm5FeHByZXNzaW9uKHVwZGF0ZWRQcm9wLm5ld1ZhbHVlW25ld1Byb3BOYW1lXSk7XG4gICAgICAgICAgICAgIGNvbnN0IGZ1bmN0aW9uUnVudGltZSA9IGF3YWl0IGV2YWx1YXRlQ2ZuVGVtcGxhdGUuZXZhbHVhdGVDZm5FeHByZXNzaW9uKHJ1bnRpbWUpO1xuICAgICAgICAgICAgICBpZiAoIWZ1bmN0aW9uUnVudGltZSkge1xuICAgICAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgLy8gZmlsZSBleHRlbnNpb24gbXVzdCBiZSBjaG9zZW4gZGVwZW5kaW5nIG9uIHRoZSBydW50aW1lXG4gICAgICAgICAgICAgIGNvbnN0IGNvZGVGaWxlRXh0ID0gZGV0ZXJtaW5lQ29kZUZpbGVFeHRGcm9tUnVudGltZShmdW5jdGlvblJ1bnRpbWUpO1xuICAgICAgICAgICAgICBmdW5jdGlvbkNvZGVaaXAgPSBhd2FpdCB6aXBTdHJpbmcoYGluZGV4LiR7Y29kZUZpbGVFeHR9YCwgZnVuY3Rpb25Db2RlKTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGNvZGUgPSB7XG4gICAgICAgICAgczNCdWNrZXQsXG4gICAgICAgICAgczNLZXksXG4gICAgICAgICAgczNPYmplY3RWZXJzaW9uLFxuICAgICAgICAgIGltYWdlVXJpLFxuICAgICAgICAgIGZ1bmN0aW9uQ29kZVppcCxcbiAgICAgICAgfTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdEZXNjcmlwdGlvbic6XG4gICAgICAgIGRlc2NyaXB0aW9uID0gYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5ldmFsdWF0ZUNmbkV4cHJlc3Npb24odXBkYXRlZFByb3AubmV3VmFsdWUpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ0Vudmlyb25tZW50JzpcbiAgICAgICAgZW52aXJvbm1lbnQgPSBhd2FpdCBldmFsdWF0ZUNmblRlbXBsYXRlLmV2YWx1YXRlQ2ZuRXhwcmVzc2lvbih1cGRhdGVkUHJvcC5uZXdWYWx1ZSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgLy8gd2Ugd2lsbCBuZXZlciBnZXQgaGVyZSwgYnV0IGp1c3QgaW4gY2FzZSB3ZSBkbyB0aHJvdyBhbiBlcnJvclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgJ3doaWxlIGFwcGx5KClpbmcsIGZvdW5kIGEgcHJvcGVydHkgdGhhdCBjYW5ub3QgYmUgaG90c3dhcHBlZC4gUGxlYXNlIHJlcG9ydCB0aGlzIGF0IGdpdGh1Yi5jb20vYXdzL2F3cy1jZGsvaXNzdWVzL25ldy9jaG9vc2UnLFxuICAgICAgICApO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGNvbmZpZ3VyYXRpb25zID0gZGVzY3JpcHRpb24gfHwgZW52aXJvbm1lbnQgPyB7IGRlc2NyaXB0aW9uLCBlbnZpcm9ubWVudCB9IDogdW5kZWZpbmVkO1xuICByZXR1cm4gY29kZSB8fCBjb25maWd1cmF0aW9ucyA/IHsgY29kZSwgY29uZmlndXJhdGlvbnMgfSA6IHVuZGVmaW5lZDtcbn1cblxuaW50ZXJmYWNlIExhbWJkYUZ1bmN0aW9uQ29kZSB7XG4gIHJlYWRvbmx5IHMzQnVja2V0Pzogc3RyaW5nO1xuICByZWFkb25seSBzM0tleT86IHN0cmluZztcbiAgcmVhZG9ubHkgczNPYmplY3RWZXJzaW9uPzogc3RyaW5nO1xuICByZWFkb25seSBpbWFnZVVyaT86IHN0cmluZztcbiAgcmVhZG9ubHkgZnVuY3Rpb25Db2RlWmlwPzogQnVmZmVyO1xufVxuXG5pbnRlcmZhY2UgTGFtYmRhRnVuY3Rpb25Db25maWd1cmF0aW9ucyB7XG4gIHJlYWRvbmx5IGRlc2NyaXB0aW9uPzogc3RyaW5nO1xuICByZWFkb25seSBlbnZpcm9ubWVudD86IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH07XG59XG5cbmludGVyZmFjZSBMYW1iZGFGdW5jdGlvbkNoYW5nZSB7XG4gIHJlYWRvbmx5IGNvZGU/OiBMYW1iZGFGdW5jdGlvbkNvZGU7XG4gIHJlYWRvbmx5IGNvbmZpZ3VyYXRpb25zPzogTGFtYmRhRnVuY3Rpb25Db25maWd1cmF0aW9ucztcbn1cblxuLyoqXG4gKiBDb21wcmVzcyBhIHN0cmluZyBhcyBhIGZpbGUsIHJldHVybmluZyBhIHByb21pc2UgZm9yIHRoZSB6aXAgYnVmZmVyXG4gKiBodHRwczovL2dpdGh1Yi5jb20vYXJjaGl2ZXJqcy9ub2RlLWFyY2hpdmVyL2lzc3Vlcy8zNDJcbiAqL1xuZnVuY3Rpb24gemlwU3RyaW5nKGZpbGVOYW1lOiBzdHJpbmcsIHJhd1N0cmluZzogc3RyaW5nKTogUHJvbWlzZTxCdWZmZXI+IHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICBjb25zdCBidWZmZXJzOiBCdWZmZXJbXSA9IFtdO1xuXG4gICAgY29uc3QgY29udmVydGVyID0gbmV3IFdyaXRhYmxlKCk7XG5cbiAgICBjb252ZXJ0ZXIuX3dyaXRlID0gKGNodW5rOiBCdWZmZXIsIF86IHN0cmluZywgY2FsbGJhY2s6ICgpID0+IHZvaWQpID0+IHtcbiAgICAgIGJ1ZmZlcnMucHVzaChjaHVuayk7XG4gICAgICBwcm9jZXNzLm5leHRUaWNrKGNhbGxiYWNrKTtcbiAgICB9O1xuXG4gICAgY29udmVydGVyLm9uKCdmaW5pc2gnLCAoKSA9PiB7XG4gICAgICByZXNvbHZlKEJ1ZmZlci5jb25jYXQoYnVmZmVycykpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgYXJjaGl2ZSA9IGFyY2hpdmVyKCd6aXAnKTtcblxuICAgIGFyY2hpdmUub24oJ2Vycm9yJywgKGVycjogYW55KSA9PiB7XG4gICAgICByZWplY3QoZXJyKTtcbiAgICB9KTtcblxuICAgIGFyY2hpdmUucGlwZShjb252ZXJ0ZXIpO1xuXG4gICAgYXJjaGl2ZS5hcHBlbmQocmF3U3RyaW5nLCB7XG4gICAgICBuYW1lOiBmaWxlTmFtZSxcbiAgICAgIGRhdGU6IG5ldyBEYXRlKCcxOTgwLTAxLTAxVDAwOjAwOjAwLjAwMFonKSwgLy8gQWRkIGRhdGUgdG8gbWFrZSByZXN1bHRpbmcgemlwIGZpbGUgZGV0ZXJtaW5pc3RpY1xuICAgIH0pO1xuXG4gICAgdm9pZCBhcmNoaXZlLmZpbmFsaXplKCk7XG4gIH0pO1xufVxuXG4vKipcbiAqIEFmdGVyIGEgTGFtYmRhIEZ1bmN0aW9uIGlzIHVwZGF0ZWQsIGl0IGNhbm5vdCBiZSB1cGRhdGVkIGFnYWluIHVudGlsIHRoZVxuICogYFN0YXRlPUFjdGl2ZWAgYW5kIHRoZSBgTGFzdFVwZGF0ZVN0YXR1cz1TdWNjZXNzZnVsYC5cbiAqXG4gKiBEZXBlbmRpbmcgb24gdGhlIGNvbmZpZ3VyYXRpb24gb2YgdGhlIExhbWJkYSBGdW5jdGlvbiB0aGlzIGNvdWxkIGhhcHBlbiByZWxhdGl2ZWx5IHF1aWNrbHlcbiAqIG9yIHZlcnkgc2xvd2x5LiBGb3IgZXhhbXBsZSwgWmlwIGJhc2VkIGZ1bmN0aW9ucyBfbm90XyBpbiBhIFZQQyBjYW4gdGFrZSB+MSBzZWNvbmQgd2hlcmVhcyBWUENcbiAqIG9yIENvbnRhaW5lciBmdW5jdGlvbnMgY2FuIHRha2UgfjI1IHNlY29uZHMgKGFuZCAnaWRsZScgVlBDIGZ1bmN0aW9ucyBjYW4gdGFrZSBtaW51dGVzKS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gd2FpdEZvckxhbWJkYXNQcm9wZXJ0aWVzVXBkYXRlVG9GaW5pc2goXG4gIGN1cnJlbnRGdW5jdGlvbkNvbmZpZ3VyYXRpb246IEZ1bmN0aW9uQ29uZmlndXJhdGlvbixcbiAgbGFtYmRhOiBJTGFtYmRhQ2xpZW50LFxuICBmdW5jdGlvbk5hbWU6IHN0cmluZyxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBmdW5jdGlvbklzSW5WcGNPclVzZXNEb2NrZXJGb3JDb2RlID1cbiAgICBjdXJyZW50RnVuY3Rpb25Db25maWd1cmF0aW9uLlZwY0NvbmZpZz8uVnBjSWQgfHwgY3VycmVudEZ1bmN0aW9uQ29uZmlndXJhdGlvbi5QYWNrYWdlVHlwZSA9PT0gJ0ltYWdlJztcblxuICAvLyBpZiB0aGUgZnVuY3Rpb24gaXMgZGVwbG95ZWQgaW4gYSBWUEMgb3IgaWYgaXQgaXMgYSBjb250YWluZXIgaW1hZ2UgZnVuY3Rpb25cbiAgLy8gdGhlbiB0aGUgdXBkYXRlIHdpbGwgdGFrZSBtdWNoIGxvbmdlciBhbmQgd2UgY2FuIHdhaXQgbG9uZ2VyIGJldHdlZW4gY2hlY2tzXG4gIC8vIG90aGVyd2lzZSwgdGhlIHVwZGF0ZSB3aWxsIGJlIHF1aWNrLCBzbyBhIDEtc2Vjb25kIGRlbGF5IGlzIGZpbmVcbiAgY29uc3QgZGVsYXlTZWNvbmRzID0gZnVuY3Rpb25Jc0luVnBjT3JVc2VzRG9ja2VyRm9yQ29kZSA/IDUgOiAxO1xuXG4gIGF3YWl0IGxhbWJkYS53YWl0VW50aWxGdW5jdGlvblVwZGF0ZWQoZGVsYXlTZWNvbmRzLCB7XG4gICAgRnVuY3Rpb25OYW1lOiBmdW5jdGlvbk5hbWUsXG4gIH0pO1xufVxuXG4vKipcbiAqIEdldCBmaWxlIGV4dGVuc2lvbiBmcm9tIExhbWJkYSBydW50aW1lIHN0cmluZy5cbiAqIFdlIHVzZSB0aGlzIGV4dGVuc2lvbiB0byBjcmVhdGUgYSBkZXBsb3ltZW50IHBhY2thZ2UgZnJvbSBMYW1iZGEgaW5saW5lIGNvZGUuXG4gKi9cbmZ1bmN0aW9uIGRldGVybWluZUNvZGVGaWxlRXh0RnJvbVJ1bnRpbWUocnVudGltZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKHJ1bnRpbWUuc3RhcnRzV2l0aCgnbm9kZScpKSB7XG4gICAgcmV0dXJuICdqcyc7XG4gIH1cbiAgaWYgKHJ1bnRpbWUuc3RhcnRzV2l0aCgncHl0aG9uJykpIHtcbiAgICByZXR1cm4gJ3B5JztcbiAgfVxuICAvLyBDdXJyZW50bHkgaW5saW5lIGNvZGUgb25seSBzdXBwb3J0cyBOb2RlLmpzIGFuZCBQeXRob24sIGlnbm9yaW5nIG90aGVyIHJ1bnRpbWVzLlxuICAvLyBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vQVdTQ2xvdWRGb3JtYXRpb24vbGF0ZXN0L1VzZXJHdWlkZS9hd3MtcHJvcGVydGllcy1sYW1iZGEtZnVuY3Rpb24tY29kZS5odG1sI2F3cy1wcm9wZXJ0aWVzLWxhbWJkYS1mdW5jdGlvbi1jb2RlLXByb3BlcnRpZXNcbiAgdGhyb3cgbmV3IENmbkV2YWx1YXRpb25FeGNlcHRpb24oXG4gICAgYHJ1bnRpbWUgJHtydW50aW1lfSBpcyB1bnN1cHBvcnRlZCwgb25seSBub2RlLmpzIGFuZCBweXRob24gcnVudGltZXMgYXJlIGN1cnJlbnRseSBzdXBwb3J0ZWQuYCxcbiAgKTtcbn1cblxuLyoqXG4gKiBGaW5kcyBhbGwgVmVyc2lvbnMgdGhhdCByZWZlcmVuY2UgYW4gQVdTOjpMYW1iZGE6OkZ1bmN0aW9uIHdpdGggbG9naWNhbCBJRCBgbG9naWNhbElkYFxuICogYW5kIEFsaWFzZXMgdGhhdCByZWZlcmVuY2UgdGhvc2UgVmVyc2lvbnMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHZlcnNpb25zQW5kQWxpYXNlcyhsb2dpY2FsSWQ6IHN0cmluZywgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlKSB7XG4gIC8vIGZpbmQgYWxsIExhbWJkYSBWZXJzaW9ucyB0aGF0IHJlZmVyZW5jZSB0aGlzIEZ1bmN0aW9uXG4gIGNvbnN0IHZlcnNpb25zUmVmZXJlbmNpbmdGdW5jdGlvbiA9IGV2YWx1YXRlQ2ZuVGVtcGxhdGVcbiAgICAuZmluZFJlZmVyZW5jZXNUbyhsb2dpY2FsSWQpXG4gICAgLmZpbHRlcigocikgPT4gci5UeXBlID09PSAnQVdTOjpMYW1iZGE6OlZlcnNpb24nKTtcbiAgLy8gZmluZCBhbGwgTGFtYmRhIEFsaWFzZXMgdGhhdCByZWZlcmVuY2UgdGhlIGFib3ZlIFZlcnNpb25zXG4gIGNvbnN0IGFsaWFzZXNSZWZlcmVuY2luZ1ZlcnNpb25zID0gZmxhdE1hcCh2ZXJzaW9uc1JlZmVyZW5jaW5nRnVuY3Rpb24sIHYgPT5cbiAgICBldmFsdWF0ZUNmblRlbXBsYXRlLmZpbmRSZWZlcmVuY2VzVG8odi5Mb2dpY2FsSWQpKTtcbiAgLy8gTGltaXRlZCBzZXQgb2YgdXBkYXRlcyBwZXIgZnVuY3Rpb25cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEBjZGtsYWJzL3Byb21pc2VhbGwtbm8tdW5ib3VuZGVkLXBhcmFsbGVsaXNtXG4gIGNvbnN0IGFsaWFzZXNOYW1lcyA9IGF3YWl0IFByb21pc2UuYWxsKGFsaWFzZXNSZWZlcmVuY2luZ1ZlcnNpb25zLm1hcChhID0+XG4gICAgZXZhbHVhdGVDZm5UZW1wbGF0ZS5ldmFsdWF0ZUNmbkV4cHJlc3Npb24oYS5Qcm9wZXJ0aWVzPy5OYW1lKSkpO1xuXG4gIHJldHVybiB7IHZlcnNpb25zUmVmZXJlbmNpbmdGdW5jdGlvbiwgYWxpYXNlc05hbWVzIH07XG59XG5cbi8qKlxuICogUmVuZGVycyB0aGUgc3RyaW5nIHVzZWQgaW4gZGlzcGxheWluZyBBbGlhcyByZXNvdXJjZSBuYW1lcyB0aGF0IHJlZmVyZW5jZSB0aGUgc3BlY2lmaWVkIExhbWJkYSBGdW5jdGlvblxuICovXG5hc3luYyBmdW5jdGlvbiByZW5kZXJBbGlhc2VzKFxuICBsb2dpY2FsSWQ6IHN0cmluZyxcbiAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuICBjYWxsYmFja2ZuOiAodmFsdWU6IGFueSwgaW5kZXg6IG51bWJlciwgYXJyYXk6IGFueVtdKSA9PiBQcm9taXNlPHN0cmluZz4sXG4pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGNvbnN0IGFsaWFzZXNOYW1lcyA9IChhd2FpdCB2ZXJzaW9uc0FuZEFsaWFzZXMobG9naWNhbElkLCBldmFsdWF0ZUNmblRlbXBsYXRlKSkuYWxpYXNlc05hbWVzO1xuXG4gIC8vIExpbWl0ZWQgc2V0IG9mIHVwZGF0ZXMgcGVyIGZ1bmN0aW9uXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAY2RrbGFicy9wcm9taXNlYWxsLW5vLXVuYm91bmRlZC1wYXJhbGxlbGlzbVxuICByZXR1cm4gUHJvbWlzZS5hbGwoYWxpYXNlc05hbWVzLm1hcChjYWxsYmFja2ZuKSk7XG59XG5cbi8qKlxuICogUmVuZGVycyB0aGUgc3RyaW5nIHVzZWQgaW4gZGlzcGxheWluZyBWZXJzaW9uIHJlc291cmNlIG5hbWVzIHRoYXQgcmVmZXJlbmNlIHRoZSBzcGVjaWZpZWQgTGFtYmRhIEZ1bmN0aW9uXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJlbmRlclZlcnNpb25zKFxuICBsb2dpY2FsSWQ6IHN0cmluZyxcbiAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuICB2ZXJzaW9uU3RyaW5nOiBzdHJpbmdbXSxcbik6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgY29uc3QgdmVyc2lvbnMgPSAoYXdhaXQgdmVyc2lvbnNBbmRBbGlhc2VzKGxvZ2ljYWxJZCwgZXZhbHVhdGVDZm5UZW1wbGF0ZSkpLnZlcnNpb25zUmVmZXJlbmNpbmdGdW5jdGlvbjtcblxuICByZXR1cm4gdmVyc2lvbnMubGVuZ3RoID4gMCA/IHZlcnNpb25TdHJpbmcgOiBbXTtcbn1cbiJdfQ==