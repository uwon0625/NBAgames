"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHotswappableAppSyncChange = isHotswappableAppSyncChange;
const common_1 = require("./common");
async function isHotswappableAppSyncChange(logicalId, change, evaluateCfnTemplate) {
    const isResolver = change.newValue.Type === 'AWS::AppSync::Resolver';
    const isFunction = change.newValue.Type === 'AWS::AppSync::FunctionConfiguration';
    const isGraphQLSchema = change.newValue.Type === 'AWS::AppSync::GraphQLSchema';
    const isAPIKey = change.newValue.Type === 'AWS::AppSync::ApiKey';
    if (!isResolver && !isFunction && !isGraphQLSchema && !isAPIKey) {
        return [];
    }
    const ret = [];
    const classifiedChanges = (0, common_1.classifyChanges)(change, [
        'RequestMappingTemplate',
        'RequestMappingTemplateS3Location',
        'ResponseMappingTemplate',
        'ResponseMappingTemplateS3Location',
        'Code',
        'CodeS3Location',
        'Definition',
        'DefinitionS3Location',
        'Expires',
    ]);
    classifiedChanges.reportNonHotswappablePropertyChanges(ret);
    const namesOfHotswappableChanges = Object.keys(classifiedChanges.hotswappableProps);
    if (namesOfHotswappableChanges.length > 0) {
        let physicalName = undefined;
        const arn = await evaluateCfnTemplate.establishResourcePhysicalName(logicalId, isFunction ? change.newValue.Properties?.Name : undefined);
        if (isResolver) {
            const arnParts = arn?.split('/');
            physicalName = arnParts ? `${arnParts[3]}.${arnParts[5]}` : undefined;
        }
        else {
            physicalName = arn;
        }
        ret.push({
            hotswappable: true,
            resourceType: change.newValue.Type,
            propsChanged: namesOfHotswappableChanges,
            service: 'appsync',
            resourceNames: [`${change.newValue.Type} '${physicalName}'`],
            apply: async (sdk) => {
                if (!physicalName) {
                    return;
                }
                const sdkProperties = {
                    ...change.oldValue.Properties,
                    Definition: change.newValue.Properties?.Definition,
                    DefinitionS3Location: change.newValue.Properties?.DefinitionS3Location,
                    requestMappingTemplate: change.newValue.Properties?.RequestMappingTemplate,
                    requestMappingTemplateS3Location: change.newValue.Properties?.RequestMappingTemplateS3Location,
                    responseMappingTemplate: change.newValue.Properties?.ResponseMappingTemplate,
                    responseMappingTemplateS3Location: change.newValue.Properties?.ResponseMappingTemplateS3Location,
                    code: change.newValue.Properties?.Code,
                    codeS3Location: change.newValue.Properties?.CodeS3Location,
                    expires: change.newValue.Properties?.Expires,
                };
                const evaluatedResourceProperties = await evaluateCfnTemplate.evaluateCfnExpression(sdkProperties);
                const sdkRequestObject = (0, common_1.transformObjectKeys)(evaluatedResourceProperties, common_1.lowerCaseFirstCharacter);
                // resolve s3 location files as SDK doesn't take in s3 location but inline code
                if (sdkRequestObject.requestMappingTemplateS3Location) {
                    sdkRequestObject.requestMappingTemplate = await fetchFileFromS3(sdkRequestObject.requestMappingTemplateS3Location, sdk);
                    delete sdkRequestObject.requestMappingTemplateS3Location;
                }
                if (sdkRequestObject.responseMappingTemplateS3Location) {
                    sdkRequestObject.responseMappingTemplate = await fetchFileFromS3(sdkRequestObject.responseMappingTemplateS3Location, sdk);
                    delete sdkRequestObject.responseMappingTemplateS3Location;
                }
                if (sdkRequestObject.definitionS3Location) {
                    sdkRequestObject.definition = await fetchFileFromS3(sdkRequestObject.definitionS3Location, sdk);
                    delete sdkRequestObject.definitionS3Location;
                }
                if (sdkRequestObject.codeS3Location) {
                    sdkRequestObject.code = await fetchFileFromS3(sdkRequestObject.codeS3Location, sdk);
                    delete sdkRequestObject.codeS3Location;
                }
                if (isResolver) {
                    await sdk.appsync().updateResolver(sdkRequestObject);
                }
                else if (isFunction) {
                    // Function version is only applicable when using VTL and mapping templates
                    // Runtime only applicable when using code (JS mapping templates)
                    if (sdkRequestObject.code) {
                        delete sdkRequestObject.functionVersion;
                    }
                    else {
                        delete sdkRequestObject.runtime;
                    }
                    const functions = await sdk.appsync().listFunctions({ apiId: sdkRequestObject.apiId });
                    const { functionId } = functions.find((fn) => fn.name === physicalName) ?? {};
                    // Updating multiple functions at the same time or along with graphql schema results in `ConcurrentModificationException`
                    await simpleRetry(() => sdk.appsync().updateFunction({
                        ...sdkRequestObject,
                        functionId: functionId,
                    }), 5, 'ConcurrentModificationException');
                }
                else if (isGraphQLSchema) {
                    let schemaCreationResponse = await sdk
                        .appsync()
                        .startSchemaCreation(sdkRequestObject);
                    while (schemaCreationResponse.status &&
                        ['PROCESSING', 'DELETING'].some((status) => status === schemaCreationResponse.status)) {
                        await sleep(1000); // poll every second
                        const getSchemaCreationStatusRequest = {
                            apiId: sdkRequestObject.apiId,
                        };
                        schemaCreationResponse = await sdk.appsync().getSchemaCreationStatus(getSchemaCreationStatusRequest);
                    }
                    if (schemaCreationResponse.status === 'FAILED') {
                        throw new Error(schemaCreationResponse.details);
                    }
                }
                else {
                    //isApiKey
                    if (!sdkRequestObject.id) {
                        // ApiKeyId is optional in CFN but required in SDK. Grab the KeyId from physicalArn if not available as part of CFN template
                        const arnParts = physicalName?.split('/');
                        if (arnParts && arnParts.length === 4) {
                            sdkRequestObject.id = arnParts[3];
                        }
                    }
                    await sdk.appsync().updateApiKey(sdkRequestObject);
                }
            },
        });
    }
    return ret;
}
async function fetchFileFromS3(s3Url, sdk) {
    const s3PathParts = s3Url.split('/');
    const s3Bucket = s3PathParts[2]; // first two are "s3:" and "" due to s3://
    const s3Key = s3PathParts.splice(3).join('/'); // after removing first three we reconstruct the key
    return (await sdk.s3().getObject({ Bucket: s3Bucket, Key: s3Key })).Body?.transformToString();
}
async function simpleRetry(fn, numOfRetries, errorCodeToRetry) {
    try {
        await fn();
    }
    catch (error) {
        if (error && error.name === errorCodeToRetry && numOfRetries > 0) {
            await sleep(1000); // wait a whole second
            await simpleRetry(fn, numOfRetries - 1, errorCodeToRetry);
        }
        else {
            throw error;
        }
    }
}
async function sleep(ms) {
    return new Promise((ok) => setTimeout(ok, ms));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwc3luYy1tYXBwaW5nLXRlbXBsYXRlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImFwcHN5bmMtbWFwcGluZy10ZW1wbGF0ZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFlQSxrRUFtSkM7QUE5SkQscUNBTWtCO0FBS1gsS0FBSyxVQUFVLDJCQUEyQixDQUMvQyxTQUFpQixFQUNqQixNQUFtQyxFQUNuQyxtQkFBbUQ7SUFFbkQsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEtBQUssd0JBQXdCLENBQUM7SUFDckUsTUFBTSxVQUFVLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEtBQUsscUNBQXFDLENBQUM7SUFDbEYsTUFBTSxlQUFlLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEtBQUssNkJBQTZCLENBQUM7SUFDL0UsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEtBQUssc0JBQXNCLENBQUM7SUFDakUsSUFBSSxDQUFDLFVBQVUsSUFBSSxDQUFDLFVBQVUsSUFBSSxDQUFDLGVBQWUsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQ2hFLE9BQU8sRUFBRSxDQUFDO0lBQ1osQ0FBQztJQUVELE1BQU0sR0FBRyxHQUF3QixFQUFFLENBQUM7SUFFcEMsTUFBTSxpQkFBaUIsR0FBRyxJQUFBLHdCQUFlLEVBQUMsTUFBTSxFQUFFO1FBQ2hELHdCQUF3QjtRQUN4QixrQ0FBa0M7UUFDbEMseUJBQXlCO1FBQ3pCLG1DQUFtQztRQUNuQyxNQUFNO1FBQ04sZ0JBQWdCO1FBQ2hCLFlBQVk7UUFDWixzQkFBc0I7UUFDdEIsU0FBUztLQUNWLENBQUMsQ0FBQztJQUNILGlCQUFpQixDQUFDLG9DQUFvQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBRTVELE1BQU0sMEJBQTBCLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lB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QUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxzQkFBc0I7WUFDekMsTUFBTSxXQUFXLENBQUMsRUFBRSxFQUFFLFlBQVksR0FBRyxDQUFDLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztRQUM1RCxDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sS0FBSyxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUM7QUFDSCxDQUFDO0FBRUQsS0FBSyxVQUFVLEtBQUssQ0FBQyxFQUFVO0lBQzdCLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUNqRCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUge1xuICBHZXRTY2hlbWFDcmVhdGlvblN0YXR1c0NvbW1hbmRPdXRwdXQsXG4gIEdldFNjaGVtYUNyZWF0aW9uU3RhdHVzQ29tbWFuZElucHV0LFxufSBmcm9tICdAYXdzLXNkay9jbGllbnQtYXBwc3luYyc7XG5pbXBvcnQge1xuICB0eXBlIENoYW5nZUhvdHN3YXBSZXN1bHQsXG4gIGNsYXNzaWZ5Q2hhbmdlcyxcbiAgdHlwZSBIb3Rzd2FwcGFibGVDaGFuZ2VDYW5kaWRhdGUsXG4gIGxvd2VyQ2FzZUZpcnN0Q2hhcmFjdGVyLFxuICB0cmFuc2Zvcm1PYmplY3RLZXlzLFxufSBmcm9tICcuL2NvbW1vbic7XG5pbXBvcnQgdHlwZSB7IFNESyB9IGZyb20gJy4uL2F3cy1hdXRoJztcblxuaW1wb3J0IHR5cGUgeyBFdmFsdWF0ZUNsb3VkRm9ybWF0aW9uVGVtcGxhdGUgfSBmcm9tICcuLi9ldmFsdWF0ZS1jbG91ZGZvcm1hdGlvbi10ZW1wbGF0ZSc7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBpc0hvdHN3YXBwYWJsZUFwcFN5bmNDaGFuZ2UoXG4gIGxvZ2ljYWxJZDogc3RyaW5nLFxuICBjaGFuZ2U6IEhvdHN3YXBwYWJsZUNoYW5nZUNhbmRpZGF0ZSxcbiAgZXZhbHVhdGVDZm5UZW1wbGF0ZTogRXZhbHVhdGVDbG91ZEZvcm1hdGlvblRlbXBsYXRlLFxuKTogUHJvbWlzZTxDaGFuZ2VIb3Rzd2FwUmVzdWx0PiB7XG4gIGNvbnN0IGlzUmVzb2x2ZXIgPSBjaGFuZ2UubmV3VmFsdWUuVHlwZSA9PT0gJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInO1xuICBjb25zdCBpc0Z1bmN0aW9uID0gY2hhbmdlLm5ld1ZhbHVlLlR5cGUgPT09ICdBV1M6OkFwcFN5bmM6OkZ1bmN0aW9uQ29uZmlndXJhdGlvbic7XG4gIGNvbnN0IGlzR3JhcGhRTFNjaGVtYSA9IGNoYW5nZS5uZXdWYWx1ZS5UeXBlID09PSAnQVdTOjpBcHBTeW5jOjpHcmFwaFFMU2NoZW1hJztcbiAgY29uc3QgaXNBUElLZXkgPSBjaGFuZ2UubmV3VmFsdWUuVHlwZSA9PT0gJ0FXUzo6QXBwU3luYzo6QXBpS2V5JztcbiAgaWYgKCFpc1Jlc29sdmVyICYmICFpc0Z1bmN0aW9uICYmICFpc0dyYXBoUUxTY2hlbWEgJiYgIWlzQVBJS2V5KSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgY29uc3QgcmV0OiBDaGFuZ2VIb3Rzd2FwUmVzdWx0ID0gW107XG5cbiAgY29uc3QgY2xhc3NpZmllZENoYW5nZXMgPSBjbGFzc2lmeUNoYW5nZXMoY2hhbmdlLCBbXG4gICAgJ1JlcXVlc3RNYXBwaW5nVGVtcGxhdGUnLFxuICAgICdSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlUzNMb2NhdGlvbicsXG4gICAgJ1Jlc3BvbnNlTWFwcGluZ1RlbXBsYXRlJyxcbiAgICAnUmVzcG9uc2VNYXBwaW5nVGVtcGxhdGVTM0xvY2F0aW9uJyxcbiAgICAnQ29kZScsXG4gICAgJ0NvZGVTM0xvY2F0aW9uJyxcbiAgICAnRGVmaW5pdGlvbicsXG4gICAgJ0RlZmluaXRpb25TM0xvY2F0aW9uJyxcbiAgICAnRXhwaXJlcycsXG4gIF0pO1xuICBjbGFzc2lmaWVkQ2hhbmdlcy5yZXBvcnROb25Ib3Rzd2FwcGFibGVQcm9wZXJ0eUNoYW5nZXMocmV0KTtcblxuICBjb25zdCBuYW1lc09mSG90c3dhcHBhYmxlQ2hhbmdlcyA9IE9iamVjdC5rZXlzKGNsYXNzaWZpZWRDaGFuZ2VzLmhvdHN3YXBwYWJsZVByb3BzKTtcbiAgaWYgKG5hbWVzT2ZIb3Rzd2FwcGFibGVDaGFuZ2VzLmxlbmd0aCA+IDApIHtcbiAgICBsZXQgcGh5c2ljYWxOYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG4gICAgY29uc3QgYXJuID0gYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5lc3RhYmxpc2hSZXNvdXJjZVBoeXNpY2FsTmFtZShcbiAgICAgIGxvZ2ljYWxJZCxcbiAgICAgIGlzRnVuY3Rpb24gPyBjaGFuZ2UubmV3VmFsdWUuUHJvcGVydGllcz8uTmFtZSA6IHVuZGVmaW5lZCxcbiAgICApO1xuICAgIGlmIChpc1Jlc29sdmVyKSB7XG4gICAgICBjb25zdCBhcm5QYXJ0cyA9IGFybj8uc3BsaXQoJy8nKTtcbiAgICAgIHBoeXNpY2FsTmFtZSA9IGFyblBhcnRzID8gYCR7YXJuUGFydHNbM119LiR7YXJuUGFydHNbNV19YCA6IHVuZGVmaW5lZDtcbiAgICB9IGVsc2Uge1xuICAgICAgcGh5c2ljYWxOYW1lID0gYXJuO1xuICAgIH1cbiAgICByZXQucHVzaCh7XG4gICAgICBob3Rzd2FwcGFibGU6IHRydWUsXG4gICAgICByZXNvdXJjZVR5cGU6IGNoYW5nZS5uZXdWYWx1ZS5UeXBlLFxuICAgICAgcHJvcHNDaGFuZ2VkOiBuYW1lc09mSG90c3dhcHBhYmxlQ2hhbmdlcyxcbiAgICAgIHNlcnZpY2U6ICdhcHBzeW5jJyxcbiAgICAgIHJlc291cmNlTmFtZXM6IFtgJHtjaGFuZ2UubmV3VmFsdWUuVHlwZX0gJyR7cGh5c2ljYWxOYW1lfSdgXSxcbiAgICAgIGFwcGx5OiBhc3luYyAoc2RrOiBTREspID0+IHtcbiAgICAgICAgaWYgKCFwaHlzaWNhbE5hbWUpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZGtQcm9wZXJ0aWVzOiB7IFtuYW1lOiBzdHJpbmddOiBhbnkgfSA9IHtcbiAgICAgICAgICAuLi5jaGFuZ2Uub2xkVmFsdWUuUHJvcGVydGllcyxcbiAgICAgICAgICBEZWZpbml0aW9uOiBjaGFuZ2UubmV3VmFsdWUuUHJvcGVydGllcz8uRGVmaW5pdGlvbixcbiAgICAgICAgICBEZWZpbml0aW9uUzNMb2NhdGlvbjogY2hhbmdlLm5ld1ZhbHVlLlByb3BlcnRpZXM/LkRlZmluaXRpb25TM0xvY2F0aW9uLFxuICAgICAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6IGNoYW5nZS5uZXdWYWx1ZS5Qcm9wZXJ0aWVzPy5SZXF1ZXN0TWFwcGluZ1RlbXBsYXRlLFxuICAgICAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGVTM0xvY2F0aW9uOiBjaGFuZ2UubmV3VmFsdWUuUHJvcGVydGllcz8uUmVxdWVzdE1hcHBpbmdUZW1wbGF0ZVMzTG9jYXRpb24sXG4gICAgICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6IGNoYW5nZS5uZXdWYWx1ZS5Qcm9wZXJ0aWVzPy5SZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSxcbiAgICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZVMzTG9jYXRpb246IGNoYW5nZS5uZXdWYWx1ZS5Qcm9wZXJ0aWVzPy5SZXNwb25zZU1hcHBpbmdUZW1wbGF0ZVMzTG9jYXRpb24sXG4gICAgICAgICAgY29kZTogY2hhbmdlLm5ld1ZhbHVlLlByb3BlcnRpZXM/LkNvZGUsXG4gICAgICAgICAgY29kZVMzTG9jYXRpb246IGNoYW5nZS5uZXdWYWx1ZS5Qcm9wZXJ0aWVzPy5Db2RlUzNMb2NhdGlvbixcbiAgICAgICAgICBleHBpcmVzOiBjaGFuZ2UubmV3VmFsdWUuUHJvcGVydGllcz8uRXhwaXJlcyxcbiAgICAgICAgfTtcbiAgICAgICAgY29uc3QgZXZhbHVhdGVkUmVzb3VyY2VQcm9wZXJ0aWVzID0gYXdhaXQgZXZhbHVhdGVDZm5UZW1wbGF0ZS5ldmFsdWF0ZUNmbkV4cHJlc3Npb24oc2RrUHJvcGVydGllcyk7XG4gICAgICAgIGNvbnN0IHNka1JlcXVlc3RPYmplY3QgPSB0cmFuc2Zvcm1PYmplY3RLZXlzKGV2YWx1YXRlZFJlc291cmNlUHJvcGVydGllcywgbG93ZXJDYXNlRmlyc3RDaGFyYWN0ZXIpO1xuXG4gICAgICAgIC8vIHJlc29sdmUgczMgbG9jYXRpb24gZmlsZXMgYXMgU0RLIGRvZXNuJ3QgdGFrZSBpbiBzMyBsb2NhdGlvbiBidXQgaW5saW5lIGNvZGVcbiAgICAgICAgaWYgKHNka1JlcXVlc3RPYmplY3QucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZVMzTG9jYXRpb24pIHtcbiAgICAgICAgICBzZGtSZXF1ZXN0T2JqZWN0LnJlcXVlc3RNYXBwaW5nVGVtcGxhdGUgPSBhd2FpdCBmZXRjaEZpbGVGcm9tUzMoXG4gICAgICAgICAgICBzZGtSZXF1ZXN0T2JqZWN0LnJlcXVlc3RNYXBwaW5nVGVtcGxhdGVTM0xvY2F0aW9uLFxuICAgICAgICAgICAgc2RrLFxuICAgICAgICAgICk7XG4gICAgICAgICAgZGVsZXRlIHNka1JlcXVlc3RPYmplY3QucmVxdWVzdE1hcHBpbmdUZW1wbGF0ZVMzTG9jYXRpb247XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNka1JlcXVlc3RPYmplY3QucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGVTM0xvY2F0aW9uKSB7XG4gICAgICAgICAgc2RrUmVxdWVzdE9iamVjdC5yZXNwb25zZU1hcHBpbmdUZW1wbGF0ZSA9IGF3YWl0IGZldGNoRmlsZUZyb21TMyhcbiAgICAgICAgICAgIHNka1JlcXVlc3RPYmplY3QucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGVTM0xvY2F0aW9uLFxuICAgICAgICAgICAgc2RrLFxuICAgICAgICAgICk7XG4gICAgICAgICAgZGVsZXRlIHNka1JlcXVlc3RPYmplY3QucmVzcG9uc2VNYXBwaW5nVGVtcGxhdGVTM0xvY2F0aW9uO1xuICAgICAgICB9XG4gICAgICAgIGlmIChzZGtSZXF1ZXN0T2JqZWN0LmRlZmluaXRpb25TM0xvY2F0aW9uKSB7XG4gICAgICAgICAgc2RrUmVxdWVzdE9iamVjdC5kZWZpbml0aW9uID0gYXdhaXQgZmV0Y2hGaWxlRnJvbVMzKHNka1JlcXVlc3RPYmplY3QuZGVmaW5pdGlvblMzTG9jYXRpb24sIHNkayk7XG4gICAgICAgICAgZGVsZXRlIHNka1JlcXVlc3RPYmplY3QuZGVmaW5pdGlvblMzTG9jYXRpb247XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHNka1JlcXVlc3RPYmplY3QuY29kZVMzTG9jYXRpb24pIHtcbiAgICAgICAgICBzZGtSZXF1ZXN0T2JqZWN0LmNvZGUgPSBhd2FpdCBmZXRjaEZpbGVGcm9tUzMoc2RrUmVxdWVzdE9iamVjdC5jb2RlUzNMb2NhdGlvbiwgc2RrKTtcbiAgICAgICAgICBkZWxldGUgc2RrUmVxdWVzdE9iamVjdC5jb2RlUzNMb2NhdGlvbjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpc1Jlc29sdmVyKSB7XG4gICAgICAgICAgYXdhaXQgc2RrLmFwcHN5bmMoKS51cGRhdGVSZXNvbHZlcihzZGtSZXF1ZXN0T2JqZWN0KTtcbiAgICAgICAgfSBlbHNlIGlmIChpc0Z1bmN0aW9uKSB7XG4gICAgICAgICAgLy8gRnVuY3Rpb24gdmVyc2lvbiBpcyBvbmx5IGFwcGxpY2FibGUgd2hlbiB1c2luZyBWVEwgYW5kIG1hcHBpbmcgdGVtcGxhdGVzXG4gICAgICAgICAgLy8gUnVudGltZSBvbmx5IGFwcGxpY2FibGUgd2hlbiB1c2luZyBjb2RlIChKUyBtYXBwaW5nIHRlbXBsYXRlcylcbiAgICAgICAgICBpZiAoc2RrUmVxdWVzdE9iamVjdC5jb2RlKSB7XG4gICAgICAgICAgICBkZWxldGUgc2RrUmVxdWVzdE9iamVjdC5mdW5jdGlvblZlcnNpb247XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGRlbGV0ZSBzZGtSZXF1ZXN0T2JqZWN0LnJ1bnRpbWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgZnVuY3Rpb25zID0gYXdhaXQgc2RrLmFwcHN5bmMoKS5saXN0RnVuY3Rpb25zKHsgYXBpSWQ6IHNka1JlcXVlc3RPYmplY3QuYXBpSWQgfSk7XG4gICAgICAgICAgY29uc3QgeyBmdW5jdGlvbklkIH0gPSBmdW5jdGlvbnMuZmluZCgoZm4pID0+IGZuLm5hbWUgPT09IHBoeXNpY2FsTmFtZSkgPz8ge307XG4gICAgICAgICAgLy8gVXBkYXRpbmcgbXVsdGlwbGUgZnVuY3Rpb25zIGF0IHRoZSBzYW1lIHRpbWUgb3IgYWxvbmcgd2l0aCBncmFwaHFsIHNjaGVtYSByZXN1bHRzIGluIGBDb25jdXJyZW50TW9kaWZpY2F0aW9uRXhjZXB0aW9uYFxuICAgICAgICAgIGF3YWl0IHNpbXBsZVJldHJ5KFxuICAgICAgICAgICAgKCkgPT5cbiAgICAgICAgICAgICAgc2RrLmFwcHN5bmMoKS51cGRhdGVGdW5jdGlvbih7XG4gICAgICAgICAgICAgICAgLi4uc2RrUmVxdWVzdE9iamVjdCxcbiAgICAgICAgICAgICAgICBmdW5jdGlvbklkOiBmdW5jdGlvbklkLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIDUsXG4gICAgICAgICAgICAnQ29uY3VycmVudE1vZGlmaWNhdGlvbkV4Y2VwdGlvbicsXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIGlmIChpc0dyYXBoUUxTY2hlbWEpIHtcbiAgICAgICAgICBsZXQgc2NoZW1hQ3JlYXRpb25SZXNwb25zZTogR2V0U2NoZW1hQ3JlYXRpb25TdGF0dXNDb21tYW5kT3V0cHV0ID0gYXdhaXQgc2RrXG4gICAgICAgICAgICAuYXBwc3luYygpXG4gICAgICAgICAgICAuc3RhcnRTY2hlbWFDcmVhdGlvbihzZGtSZXF1ZXN0T2JqZWN0KTtcbiAgICAgICAgICB3aGlsZSAoXG4gICAgICAgICAgICBzY2hlbWFDcmVhdGlvblJlc3BvbnNlLnN0YXR1cyAmJlxuICAgICAgICAgICAgWydQUk9DRVNTSU5HJywgJ0RFTEVUSU5HJ10uc29tZSgoc3RhdHVzKSA9PiBzdGF0dXMgPT09IHNjaGVtYUNyZWF0aW9uUmVzcG9uc2Uuc3RhdHVzKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgYXdhaXQgc2xlZXAoMTAwMCk7IC8vIHBvbGwgZXZlcnkgc2Vjb25kXG4gICAgICAgICAgICBjb25zdCBnZXRTY2hlbWFDcmVhdGlvblN0YXR1c1JlcXVlc3Q6IEdldFNjaGVtYUNyZWF0aW9uU3RhdHVzQ29tbWFuZElucHV0ID0ge1xuICAgICAgICAgICAgICBhcGlJZDogc2RrUmVxdWVzdE9iamVjdC5hcGlJZCxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBzY2hlbWFDcmVhdGlvblJlc3BvbnNlID0gYXdhaXQgc2RrLmFwcHN5bmMoKS5nZXRTY2hlbWFDcmVhdGlvblN0YXR1cyhnZXRTY2hlbWFDcmVhdGlvblN0YXR1c1JlcXVlc3QpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoc2NoZW1hQ3JlYXRpb25SZXNwb25zZS5zdGF0dXMgPT09ICdGQUlMRUQnKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3Ioc2NoZW1hQ3JlYXRpb25SZXNwb25zZS5kZXRhaWxzKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy9pc0FwaUtleVxuICAgICAgICAgIGlmICghc2RrUmVxdWVzdE9iamVjdC5pZCkge1xuICAgICAgICAgICAgLy8gQXBpS2V5SWQgaXMgb3B0aW9uYWwgaW4gQ0ZOIGJ1dCByZXF1aXJlZCBpbiBTREsuIEdyYWIgdGhlIEtleUlkIGZyb20gcGh5c2ljYWxBcm4gaWYgbm90IGF2YWlsYWJsZSBhcyBwYXJ0IG9mIENGTiB0ZW1wbGF0ZVxuICAgICAgICAgICAgY29uc3QgYXJuUGFydHMgPSBwaHlzaWNhbE5hbWU/LnNwbGl0KCcvJyk7XG4gICAgICAgICAgICBpZiAoYXJuUGFydHMgJiYgYXJuUGFydHMubGVuZ3RoID09PSA0KSB7XG4gICAgICAgICAgICAgIHNka1JlcXVlc3RPYmplY3QuaWQgPSBhcm5QYXJ0c1szXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgc2RrLmFwcHN5bmMoKS51cGRhdGVBcGlLZXkoc2RrUmVxdWVzdE9iamVjdCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gcmV0O1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaEZpbGVGcm9tUzMoczNVcmw6IHN0cmluZywgc2RrOiBTREspIHtcbiAgY29uc3QgczNQYXRoUGFydHMgPSBzM1VybC5zcGxpdCgnLycpO1xuICBjb25zdCBzM0J1Y2tldCA9IHMzUGF0aFBhcnRzWzJdOyAvLyBmaXJzdCB0d28gYXJlIFwiczM6XCIgYW5kIFwiXCIgZHVlIHRvIHMzOi8vXG4gIGNvbnN0IHMzS2V5ID0gczNQYXRoUGFydHMuc3BsaWNlKDMpLmpvaW4oJy8nKTsgLy8gYWZ0ZXIgcmVtb3ZpbmcgZmlyc3QgdGhyZWUgd2UgcmVjb25zdHJ1Y3QgdGhlIGtleVxuICByZXR1cm4gKGF3YWl0IHNkay5zMygpLmdldE9iamVjdCh7IEJ1Y2tldDogczNCdWNrZXQsIEtleTogczNLZXkgfSkpLkJvZHk/LnRyYW5zZm9ybVRvU3RyaW5nKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNpbXBsZVJldHJ5KGZuOiAoKSA9PiBQcm9taXNlPGFueT4sIG51bU9mUmV0cmllczogbnVtYmVyLCBlcnJvckNvZGVUb1JldHJ5OiBzdHJpbmcpIHtcbiAgdHJ5IHtcbiAgICBhd2FpdCBmbigpO1xuICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgaWYgKGVycm9yICYmIGVycm9yLm5hbWUgPT09IGVycm9yQ29kZVRvUmV0cnkgJiYgbnVtT2ZSZXRyaWVzID4gMCkge1xuICAgICAgYXdhaXQgc2xlZXAoMTAwMCk7IC8vIHdhaXQgYSB3aG9sZSBzZWNvbmRcbiAgICAgIGF3YWl0IHNpbXBsZVJldHJ5KGZuLCBudW1PZlJldHJpZXMgLSAxLCBlcnJvckNvZGVUb1JldHJ5KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNsZWVwKG1zOiBudW1iZXIpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChvaykgPT4gc2V0VGltZW91dChvaywgbXMpKTtcbn1cbiJdfQ==