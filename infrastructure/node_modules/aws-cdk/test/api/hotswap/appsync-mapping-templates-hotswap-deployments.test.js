"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stream_1 = require("stream");
const client_appsync_1 = require("@aws-sdk/client-appsync");
const client_s3_1 = require("@aws-sdk/client-s3");
const util_stream_1 = require("@smithy/util-stream");
const setup = require("./hotswap-test-setup");
const common_1 = require("../../../lib/api/hotswap/common");
const mock_sdk_1 = require("../../util/mock-sdk");
const silent_1 = require("../../util/silent");
let hotswapMockSdkProvider;
beforeEach(() => {
    hotswapMockSdkProvider = setup.setupHotswapTests();
});
const getBodyStream = (input) => {
    const stream = new stream_1.Readable();
    stream._read = () => { };
    stream.push(input);
    stream.push(null); // close the stream
    return (0, util_stream_1.sdkStreamMixin)(stream);
};
describe.each([common_1.HotswapMode.FALL_BACK, common_1.HotswapMode.HOTSWAP_ONLY])('%p mode', (hotswapMode) => {
    (0, silent_1.silentTest)(`A new Resolver being added to the Stack returns undefined in CLASSIC mode and
        returns a noOp in HOTSWAP_ONLY mode`, async () => {
        // GIVEN
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncResolver: {
                        Type: 'AWS::AppSync::Resolver',
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        if (hotswapMode === common_1.HotswapMode.FALL_BACK) {
            expect(deployStackResult).toBeUndefined();
        }
        else if (hotswapMode === common_1.HotswapMode.HOTSWAP_ONLY) {
            expect(deployStackResult).not.toBeUndefined();
            expect(deployStackResult?.noOp).toEqual(true);
        }
        expect(mock_sdk_1.mockAppSyncClient).not.toHaveReceivedCommand(client_appsync_1.UpdateFunctionCommand);
        expect(mock_sdk_1.mockAppSyncClient).not.toHaveReceivedCommand(client_appsync_1.UpdateResolverCommand);
    });
    (0, silent_1.silentTest)('calls the updateResolver() API when it receives only a mapping template difference in a Unit Resolver', async () => {
        // GIVEN
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncResolver: {
                    Type: 'AWS::AppSync::Resolver',
                    Properties: {
                        ApiId: 'apiId',
                        FieldName: 'myField',
                        TypeName: 'Query',
                        DataSourceName: 'my-datasource',
                        Kind: 'UNIT',
                        RequestMappingTemplate: '## original request template',
                        ResponseMappingTemplate: '## original response template',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncResolver', 'AWS::AppSync::Resolver', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/types/Query/resolvers/myField'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncResolver: {
                        Type: 'AWS::AppSync::Resolver',
                        Properties: {
                            ApiId: 'apiId',
                            FieldName: 'myField',
                            TypeName: 'Query',
                            DataSourceName: 'my-datasource',
                            Kind: 'UNIT',
                            RequestMappingTemplate: '## new request template',
                            ResponseMappingTemplate: '## original response template',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateResolverCommand, {
            apiId: 'apiId',
            dataSourceName: 'my-datasource',
            typeName: 'Query',
            fieldName: 'myField',
            kind: 'UNIT',
            requestMappingTemplate: '## new request template',
            responseMappingTemplate: '## original response template',
        });
    });
    (0, silent_1.silentTest)('calls the updateResolver() API when it receives only a mapping template difference s3 location in a Unit Resolver', async () => {
        // GIVEN
        const body = getBodyStream('template defined in s3');
        mock_sdk_1.mockS3Client.on(client_s3_1.GetObjectCommand).resolves({
            Body: body,
        });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncResolver: {
                    Type: 'AWS::AppSync::Resolver',
                    Properties: {
                        ApiId: 'apiId',
                        FieldName: 'myField',
                        TypeName: 'Query',
                        DataSourceName: 'my-datasource',
                        Kind: 'UNIT',
                        RequestMappingTemplateS3Location: 's3://test-bucket/old_location',
                        ResponseMappingTemplate: '## original response template',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncResolver', 'AWS::AppSync::Resolver', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/types/Query/resolvers/myField'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncResolver: {
                        Type: 'AWS::AppSync::Resolver',
                        Properties: {
                            ApiId: 'apiId',
                            FieldName: 'myField',
                            TypeName: 'Query',
                            DataSourceName: 'my-datasource',
                            Kind: 'UNIT',
                            RequestMappingTemplateS3Location: 's3://test-bucket/path/to/key',
                            ResponseMappingTemplate: '## original response template',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateResolverCommand, {
            apiId: 'apiId',
            dataSourceName: 'my-datasource',
            typeName: 'Query',
            fieldName: 'myField',
            kind: 'UNIT',
            requestMappingTemplate: 'template defined in s3',
            responseMappingTemplate: '## original response template',
        });
        expect(mock_sdk_1.mockS3Client).toHaveReceivedCommandWith(client_s3_1.GetObjectCommand, {
            Bucket: 'test-bucket',
            Key: 'path/to/key',
        });
    });
    (0, silent_1.silentTest)('calls the updateResolver() API when it receives only a code s3 location in a Pipeline Resolver', async () => {
        // GIVEN
        const body = getBodyStream('code defined in s3');
        mock_sdk_1.mockS3Client.on(client_s3_1.GetObjectCommand).resolves({
            Body: body,
        });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncResolver: {
                    Type: 'AWS::AppSync::Resolver',
                    Properties: {
                        ApiId: 'apiId',
                        FieldName: 'myField',
                        TypeName: 'Query',
                        DataSourceName: 'my-datasource',
                        PipelineConfig: ['function1'],
                        CodeS3Location: 's3://test-bucket/old_location',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncResolver', 'AWS::AppSync::Resolver', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/types/Query/resolvers/myField'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncResolver: {
                        Type: 'AWS::AppSync::Resolver',
                        Properties: {
                            ApiId: 'apiId',
                            FieldName: 'myField',
                            TypeName: 'Query',
                            DataSourceName: 'my-datasource',
                            PipelineConfig: ['function1'],
                            CodeS3Location: 's3://test-bucket/path/to/key',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateResolverCommand, {
            apiId: 'apiId',
            dataSourceName: 'my-datasource',
            typeName: 'Query',
            fieldName: 'myField',
            pipelineConfig: ['function1'],
            code: 'code defined in s3',
        });
        expect(mock_sdk_1.mockS3Client).toHaveReceivedCommandWith(client_s3_1.GetObjectCommand, {
            Bucket: 'test-bucket',
            Key: 'path/to/key',
        });
    });
    (0, silent_1.silentTest)('calls the updateResolver() API when it receives only a code difference in a Pipeline Resolver', async () => {
        // GIVEN
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncResolver: {
                    Type: 'AWS::AppSync::Resolver',
                    Properties: {
                        ApiId: 'apiId',
                        FieldName: 'myField',
                        TypeName: 'Query',
                        DataSourceName: 'my-datasource',
                        PipelineConfig: ['function1'],
                        Code: 'old code',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncResolver', 'AWS::AppSync::Resolver', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/types/Query/resolvers/myField'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncResolver: {
                        Type: 'AWS::AppSync::Resolver',
                        Properties: {
                            ApiId: 'apiId',
                            FieldName: 'myField',
                            TypeName: 'Query',
                            DataSourceName: 'my-datasource',
                            PipelineConfig: ['function1'],
                            Code: 'new code',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateResolverCommand, {
            apiId: 'apiId',
            dataSourceName: 'my-datasource',
            typeName: 'Query',
            fieldName: 'myField',
            pipelineConfig: ['function1'],
            code: 'new code',
        });
    });
    (0, silent_1.silentTest)('calls the updateResolver() API when it receives only a mapping template difference in a Pipeline Resolver', async () => {
        // GIVEN
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncResolver: {
                    Type: 'AWS::AppSync::Resolver',
                    Properties: {
                        ApiId: 'apiId',
                        FieldName: 'myField',
                        TypeName: 'Query',
                        DataSourceName: 'my-datasource',
                        Kind: 'PIPELINE',
                        PipelineConfig: ['function1'],
                        RequestMappingTemplate: '## original request template',
                        ResponseMappingTemplate: '## original response template',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncResolver', 'AWS::AppSync::Resolver', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/types/Query/resolvers/myField'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncResolver: {
                        Type: 'AWS::AppSync::Resolver',
                        Properties: {
                            ApiId: 'apiId',
                            FieldName: 'myField',
                            TypeName: 'Query',
                            DataSourceName: 'my-datasource',
                            Kind: 'PIPELINE',
                            PipelineConfig: ['function1'],
                            RequestMappingTemplate: '## new request template',
                            ResponseMappingTemplate: '## original response template',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateResolverCommand, {
            apiId: 'apiId',
            dataSourceName: 'my-datasource',
            typeName: 'Query',
            fieldName: 'myField',
            kind: 'PIPELINE',
            pipelineConfig: ['function1'],
            requestMappingTemplate: '## new request template',
            responseMappingTemplate: '## original response template',
        });
    });
    (0, silent_1.silentTest)(`when it receives a change that is not a mapping template difference in a Resolver, it does not call the updateResolver() API in CLASSIC mode
        but does call the updateResolver() API in HOTSWAP_ONLY mode`, async () => {
        // GIVEN
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncResolver: {
                    Type: 'AWS::AppSync::Resolver',
                    Properties: {
                        ResponseMappingTemplate: '## original response template',
                        RequestMappingTemplate: '## original request template',
                        FieldName: 'oldField',
                        ApiId: 'apiId',
                        TypeName: 'Query',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncResolver', 'AWS::AppSync::Resolver', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/types/Query/resolvers/myField'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncResolver: {
                        Type: 'AWS::AppSync::Resolver',
                        Properties: {
                            ResponseMappingTemplate: '## original response template',
                            RequestMappingTemplate: '## new request template',
                            FieldName: 'newField',
                            ApiId: 'apiId',
                            TypeName: 'Query',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        if (hotswapMode === common_1.HotswapMode.FALL_BACK) {
            expect(deployStackResult).toBeUndefined();
            expect(mock_sdk_1.mockAppSyncClient).not.toHaveReceivedCommand(client_appsync_1.UpdateResolverCommand);
        }
        else if (hotswapMode === common_1.HotswapMode.HOTSWAP_ONLY) {
            expect(deployStackResult).not.toBeUndefined();
            expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateResolverCommand, {
                apiId: 'apiId',
                typeName: 'Query',
                fieldName: 'oldField',
                requestMappingTemplate: '## new request template',
                responseMappingTemplate: '## original response template',
            });
        }
        expect(mock_sdk_1.mockAppSyncClient).not.toHaveReceivedCommand(client_appsync_1.UpdateFunctionCommand);
    });
    (0, silent_1.silentTest)('does not call the updateResolver() API when a resource with type that is not AWS::AppSync::Resolver but has the same properties is changed', async () => {
        // GIVEN
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncResolver: {
                    Type: 'AWS::AppSync::NotAResolver',
                    Properties: {
                        RequestMappingTemplate: '## original template',
                        FieldName: 'oldField',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncResolver: {
                        Type: 'AWS::AppSync::NotAResolver',
                        Properties: {
                            RequestMappingTemplate: '## new template',
                            FieldName: 'newField',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        if (hotswapMode === common_1.HotswapMode.FALL_BACK) {
            expect(deployStackResult).toBeUndefined();
        }
        else if (hotswapMode === common_1.HotswapMode.HOTSWAP_ONLY) {
            expect(deployStackResult).not.toBeUndefined();
            expect(deployStackResult?.noOp).toEqual(true);
        }
        expect(mock_sdk_1.mockAppSyncClient).not.toHaveReceivedCommand(client_appsync_1.UpdateFunctionCommand);
        expect(mock_sdk_1.mockAppSyncClient).not.toHaveReceivedCommand(client_appsync_1.UpdateResolverCommand);
    });
    (0, silent_1.silentTest)('calls the updateFunction() API when it receives only a mapping template difference in a Function', async () => {
        // GIVEN
        mock_sdk_1.mockAppSyncClient
            .on(client_appsync_1.ListFunctionsCommand)
            .resolves({ functions: [{ name: 'my-function', functionId: 'functionId' }] });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncFunction: {
                    Type: 'AWS::AppSync::FunctionConfiguration',
                    Properties: {
                        Name: 'my-function',
                        ApiId: 'apiId',
                        DataSourceName: 'my-datasource',
                        FunctionVersion: '2018-05-29',
                        RequestMappingTemplate: '## original request template',
                        ResponseMappingTemplate: '## original response template',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncFunction: {
                        Type: 'AWS::AppSync::FunctionConfiguration',
                        Properties: {
                            Name: 'my-function',
                            ApiId: 'apiId',
                            DataSourceName: 'my-datasource',
                            FunctionVersion: '2018-05-29',
                            RequestMappingTemplate: '## original request template',
                            ResponseMappingTemplate: '## new response template',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateFunctionCommand, {
            apiId: 'apiId',
            dataSourceName: 'my-datasource',
            functionId: 'functionId',
            functionVersion: '2018-05-29',
            name: 'my-function',
            requestMappingTemplate: '## original request template',
            responseMappingTemplate: '## new response template',
        });
    });
    (0, silent_1.silentTest)('calls the updateFunction() API with function version when it receives both function version and runtime with a mapping template in a Function', async () => {
        // GIVEN
        mock_sdk_1.mockAppSyncClient
            .on(client_appsync_1.ListFunctionsCommand)
            .resolves({ functions: [{ name: 'my-function', functionId: 'functionId' }] });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncFunction: {
                    Type: 'AWS::AppSync::FunctionConfiguration',
                    Properties: {
                        Name: 'my-function',
                        ApiId: 'apiId',
                        DataSourceName: 'my-datasource',
                        FunctionVersion: '2018-05-29',
                        Runtime: 'APPSYNC_JS',
                        RequestMappingTemplate: '## original request template',
                        ResponseMappingTemplate: '## original response template',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncFunction: {
                        Type: 'AWS::AppSync::FunctionConfiguration',
                        Properties: {
                            Name: 'my-function',
                            ApiId: 'apiId',
                            DataSourceName: 'my-datasource',
                            FunctionVersion: '2018-05-29',
                            Runtime: 'APPSYNC_JS',
                            RequestMappingTemplate: '## original request template',
                            ResponseMappingTemplate: '## new response template',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateFunctionCommand, {
            apiId: 'apiId',
            dataSourceName: 'my-datasource',
            functionId: 'functionId',
            functionVersion: '2018-05-29',
            name: 'my-function',
            requestMappingTemplate: '## original request template',
            responseMappingTemplate: '## new response template',
        });
    });
    (0, silent_1.silentTest)('calls the updateFunction() API with runtime when it receives both function version and runtime with code in a Function', async () => {
        // GIVEN
        mock_sdk_1.mockAppSyncClient
            .on(client_appsync_1.ListFunctionsCommand)
            .resolves({ functions: [{ name: 'my-function', functionId: 'functionId' }] });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncFunction: {
                    Type: 'AWS::AppSync::FunctionConfiguration',
                    Properties: {
                        Name: 'my-function',
                        ApiId: 'apiId',
                        DataSourceName: 'my-datasource',
                        FunctionVersion: '2018-05-29',
                        Runtime: 'APPSYNC_JS',
                        Code: 'old test code',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncFunction: {
                        Type: 'AWS::AppSync::FunctionConfiguration',
                        Properties: {
                            Name: 'my-function',
                            ApiId: 'apiId',
                            DataSourceName: 'my-datasource',
                            FunctionVersion: '2018-05-29',
                            Runtime: 'APPSYNC_JS',
                            Code: 'new test code',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateFunctionCommand, {
            apiId: 'apiId',
            dataSourceName: 'my-datasource',
            functionId: 'functionId',
            runtime: 'APPSYNC_JS',
            name: 'my-function',
            code: 'new test code',
        });
    });
    (0, silent_1.silentTest)('calls the updateFunction() API when it receives only a mapping template s3 location difference in a Function', async () => {
        // GIVEN
        mock_sdk_1.mockS3Client.on(client_s3_1.GetObjectCommand).resolves({
            Body: getBodyStream('template defined in s3'),
        });
        mock_sdk_1.mockAppSyncClient
            .on(client_appsync_1.ListFunctionsCommand)
            .resolves({ functions: [{ name: 'my-function', functionId: 'functionId' }] });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncFunction: {
                    Type: 'AWS::AppSync::FunctionConfiguration',
                    Properties: {
                        Name: 'my-function',
                        ApiId: 'apiId',
                        DataSourceName: 'my-datasource',
                        FunctionVersion: '2018-05-29',
                        RequestMappingTemplate: '## original request template',
                        ResponseMappingTemplateS3Location: 's3://test-bucket/old_location',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncFunction: {
                        Type: 'AWS::AppSync::FunctionConfiguration',
                        Properties: {
                            Name: 'my-function',
                            ApiId: 'apiId',
                            DataSourceName: 'my-datasource',
                            FunctionVersion: '2018-05-29',
                            RequestMappingTemplate: '## original request template',
                            ResponseMappingTemplateS3Location: 's3://test-bucket/path/to/key',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateFunctionCommand, {
            apiId: 'apiId',
            dataSourceName: 'my-datasource',
            functionId: 'functionId',
            functionVersion: '2018-05-29',
            name: 'my-function',
            requestMappingTemplate: '## original request template',
            responseMappingTemplate: 'template defined in s3',
        });
        expect(mock_sdk_1.mockS3Client).toHaveReceivedCommandWith(client_s3_1.GetObjectCommand, {
            Bucket: 'test-bucket',
            Key: 'path/to/key',
        });
    });
    (0, silent_1.silentTest)(`when it receives a change that is not a mapping template difference in a Function, it does not call the updateFunction() API in CLASSIC mode
        but does in HOTSWAP_ONLY mode`, async () => {
        // GIVEN
        mock_sdk_1.mockAppSyncClient
            .on(client_appsync_1.ListFunctionsCommand)
            .resolves({ functions: [{ name: 'my-function', functionId: 'functionId' }] });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncFunction: {
                    Type: 'AWS::AppSync::FunctionConfiguration',
                    Properties: {
                        RequestMappingTemplate: '## original request template',
                        ResponseMappingTemplate: '## original response template',
                        Name: 'my-function',
                        ApiId: 'apiId',
                        DataSourceName: 'my-datasource',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncFunction: {
                        Type: 'AWS::AppSync::FunctionConfiguration',
                        Properties: {
                            RequestMappingTemplate: '## new request template',
                            ResponseMappingTemplate: '## original response template',
                            ApiId: 'apiId',
                            Name: 'my-function',
                            DataSourceName: 'new-datasource',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        if (hotswapMode === common_1.HotswapMode.FALL_BACK) {
            expect(deployStackResult).toBeUndefined();
        }
        else if (hotswapMode === common_1.HotswapMode.HOTSWAP_ONLY) {
            expect(deployStackResult).not.toBeUndefined();
            expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateFunctionCommand, {
                apiId: 'apiId',
                dataSourceName: 'my-datasource',
                functionId: 'functionId',
                name: 'my-function',
                requestMappingTemplate: '## new request template',
                responseMappingTemplate: '## original response template',
            });
            expect(mock_sdk_1.mockAppSyncClient).not.toHaveReceivedCommand(client_appsync_1.UpdateResolverCommand);
        }
    });
    (0, silent_1.silentTest)('does not call the updateFunction() API when a resource with type that is not AWS::AppSync::FunctionConfiguration but has the same properties is changed', async () => {
        // GIVEN
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncFunction: {
                    Type: 'AWS::AppSync::NotAFunctionConfiguration',
                    Properties: {
                        RequestMappingTemplate: '## original template',
                        Name: 'my-function',
                        DataSourceName: 'my-datasource',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncFunction: {
                        Type: 'AWS::AppSync::NotAFunctionConfiguration',
                        Properties: {
                            RequestMappingTemplate: '## new template',
                            Name: 'my-resolver',
                            DataSourceName: 'my-datasource',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        if (hotswapMode === common_1.HotswapMode.FALL_BACK) {
            expect(deployStackResult).toBeUndefined();
        }
        else if (hotswapMode === common_1.HotswapMode.HOTSWAP_ONLY) {
            expect(deployStackResult).not.toBeUndefined();
            expect(deployStackResult?.noOp).toEqual(true);
        }
        expect(mock_sdk_1.mockAppSyncClient).not.toHaveReceivedCommand(client_appsync_1.UpdateFunctionCommand);
        expect(mock_sdk_1.mockAppSyncClient).not.toHaveReceivedCommand(client_appsync_1.UpdateResolverCommand);
    });
    (0, silent_1.silentTest)('calls the startSchemaCreation() API when it receives only a definition difference in a graphql schema', async () => {
        // GIVEN
        mock_sdk_1.mockAppSyncClient.on(client_appsync_1.StartSchemaCreationCommand).resolvesOnce({
            status: 'SUCCESS',
        });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncGraphQLSchema: {
                    Type: 'AWS::AppSync::GraphQLSchema',
                    Properties: {
                        ApiId: 'apiId',
                        Definition: 'original graphqlSchema',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncGraphQLSchema', 'AWS::AppSync::GraphQLSchema', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/schema/my-schema'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncGraphQLSchema: {
                        Type: 'AWS::AppSync::GraphQLSchema',
                        Properties: {
                            ApiId: 'apiId',
                            Definition: 'new graphqlSchema',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.StartSchemaCreationCommand, {
            apiId: 'apiId',
            definition: 'new graphqlSchema',
        });
    });
    (0, silent_1.silentTest)('calls the updateFunction() API with functionId when function is listed on second page', async () => {
        // GIVEN
        mock_sdk_1.mockAppSyncClient
            .on(client_appsync_1.ListFunctionsCommand)
            .resolvesOnce({
            functions: [{ name: 'other-function', functionId: 'other-functionId' }],
            nextToken: 'nextToken',
        })
            .resolvesOnce({
            functions: [{ name: 'my-function', functionId: 'functionId' }],
        });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncFunction: {
                    Type: 'AWS::AppSync::FunctionConfiguration',
                    Properties: {
                        Name: 'my-function',
                        ApiId: 'apiId',
                        DataSourceName: 'my-datasource',
                        FunctionVersion: '2018-05-29',
                        Runtime: 'APPSYNC_JS',
                        Code: 'old test code',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncFunction: {
                        Type: 'AWS::AppSync::FunctionConfiguration',
                        Properties: {
                            Name: 'my-function',
                            ApiId: 'apiId',
                            DataSourceName: 'my-datasource',
                            FunctionVersion: '2018-05-29',
                            Runtime: 'APPSYNC_JS',
                            Code: 'new test code',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandTimes(client_appsync_1.ListFunctionsCommand, 2);
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedNthCommandWith(1, client_appsync_1.ListFunctionsCommand, {
            apiId: 'apiId',
            nextToken: 'nextToken',
        });
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedNthCommandWith(2, client_appsync_1.ListFunctionsCommand, {
            apiId: 'apiId',
        });
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateFunctionCommand, {
            apiId: 'apiId',
            dataSourceName: 'my-datasource',
            functionId: 'functionId',
            runtime: 'APPSYNC_JS',
            name: 'my-function',
            code: 'new test code',
        });
    });
    (0, silent_1.silentTest)('calls the startSchemaCreation() API when it receives only a definition difference in a graphql schema', async () => {
        // GIVEN
        mock_sdk_1.mockAppSyncClient.on(client_appsync_1.StartSchemaCreationCommand).resolves({ status: 'SUCCESS' });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncGraphQLSchema: {
                    Type: 'AWS::AppSync::GraphQLSchema',
                    Properties: {
                        ApiId: 'apiId',
                        Definition: 'original graphqlSchema',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncGraphQLSchema', 'AWS::AppSync::GraphQLSchema', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/schema/my-schema'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncGraphQLSchema: {
                        Type: 'AWS::AppSync::GraphQLSchema',
                        Properties: {
                            ApiId: 'apiId',
                            Definition: 'new graphqlSchema',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.StartSchemaCreationCommand, {
            apiId: 'apiId',
            definition: 'new graphqlSchema',
        });
    });
    (0, silent_1.silentTest)('calls the startSchemaCreation() API when it receives only a definition s3 location difference in a graphql schema', async () => {
        // GIVEN
        mock_sdk_1.mockS3Client.on(client_s3_1.GetObjectCommand).resolves({
            Body: getBodyStream('schema defined in s3'),
        });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncGraphQLSchema: {
                    Type: 'AWS::AppSync::GraphQLSchema',
                    Properties: {
                        ApiId: 'apiId',
                        DefinitionS3Location: 's3://test-bucket/old_location',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncGraphQLSchema', 'AWS::AppSync::GraphQLSchema', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/schema/my-schema'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncGraphQLSchema: {
                        Type: 'AWS::AppSync::GraphQLSchema',
                        Properties: {
                            ApiId: 'apiId',
                            DefinitionS3Location: 's3://test-bucket/path/to/key',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.StartSchemaCreationCommand, {
            apiId: 'apiId',
            definition: 'schema defined in s3',
        });
        expect(mock_sdk_1.mockS3Client).toHaveReceivedCommandWith(client_s3_1.GetObjectCommand, {
            Bucket: 'test-bucket',
            Key: 'path/to/key',
        });
    });
    (0, silent_1.silentTest)('does not call startSchemaCreation() API when a resource with type that is not AWS::AppSync::GraphQLSchema but has the same properties is change', async () => {
        // GIVEN
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncGraphQLSchema: {
                    Type: 'AWS::AppSync::NotGraphQLSchema',
                    Properties: {
                        ApiId: 'apiId',
                        Definition: 'original graphqlSchema',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncGraphQLSchema', 'AWS::AppSync::GraphQLSchema', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/schema/my-schema'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncGraphQLSchema: {
                        Type: 'AWS::AppSync::NotGraphQLSchema',
                        Properties: {
                            ApiId: 'apiId',
                            Definition: 'new graphqlSchema',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        if (hotswapMode === common_1.HotswapMode.FALL_BACK) {
            expect(deployStackResult).toBeUndefined();
        }
        else if (hotswapMode === common_1.HotswapMode.HOTSWAP_ONLY) {
            expect(deployStackResult).not.toBeUndefined();
            expect(deployStackResult?.noOp).toEqual(true);
        }
        expect(mock_sdk_1.mockAppSyncClient).not.toHaveReceivedCommand(client_appsync_1.StartSchemaCreationCommand);
    });
    (0, silent_1.silentTest)('calls the startSchemaCreation() and waits for schema creation to stabilize before finishing', async () => {
        // GIVEN
        mock_sdk_1.mockAppSyncClient.on(client_appsync_1.StartSchemaCreationCommand).resolvesOnce({ status: 'PROCESSING' });
        mock_sdk_1.mockAppSyncClient.on(client_appsync_1.GetSchemaCreationStatusCommand).resolvesOnce({ status: 'SUCCESS' });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncGraphQLSchema: {
                    Type: 'AWS::AppSync::GraphQLSchema',
                    Properties: {
                        ApiId: 'apiId',
                        Definition: 'original graphqlSchema',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncGraphQLSchema', 'AWS::AppSync::GraphQLSchema', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/schema/my-schema'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncGraphQLSchema: {
                        Type: 'AWS::AppSync::GraphQLSchema',
                        Properties: {
                            ApiId: 'apiId',
                            Definition: 'new graphqlSchema',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.StartSchemaCreationCommand, {
            apiId: 'apiId',
            definition: 'new graphqlSchema',
        });
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.GetSchemaCreationStatusCommand, {
            apiId: 'apiId',
        });
    });
    (0, silent_1.silentTest)('calls the startSchemaCreation() and throws if schema creation fails', async () => {
        // GIVEN
        mock_sdk_1.mockAppSyncClient.on(client_appsync_1.StartSchemaCreationCommand).resolvesOnce({ status: 'PROCESSING' });
        mock_sdk_1.mockAppSyncClient.on(client_appsync_1.GetSchemaCreationStatusCommand).resolvesOnce({ status: 'FAILED', details: 'invalid schema' });
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncGraphQLSchema: {
                    Type: 'AWS::AppSync::GraphQLSchema',
                    Properties: {
                        ApiId: 'apiId',
                        Definition: 'original graphqlSchema',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncGraphQLSchema', 'AWS::AppSync::GraphQLSchema', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/schema/my-schema'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncGraphQLSchema: {
                        Type: 'AWS::AppSync::GraphQLSchema',
                        Properties: {
                            ApiId: 'apiId',
                            Definition: 'new graphqlSchema',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        await expect(() => hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact)).rejects.toThrow('invalid schema');
        // THEN
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.StartSchemaCreationCommand, {
            apiId: 'apiId',
            definition: 'new graphqlSchema',
        });
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.GetSchemaCreationStatusCommand, {
            apiId: 'apiId',
        });
    });
    (0, silent_1.silentTest)('calls the updateApiKey() API when it receives only a expires property difference in an AppSync ApiKey', async () => {
        // GIVEN
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncApiKey: {
                    Type: 'AWS::AppSync::ApiKey',
                    Properties: {
                        ApiId: 'apiId',
                        Expires: 1000,
                        Id: 'key-id',
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncApiKey', 'AWS::AppSync::ApiKey', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/apikeys/api-key-id'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncApiKey: {
                        Type: 'AWS::AppSync::ApiKey',
                        Properties: {
                            ApiId: 'apiId',
                            Expires: 1001,
                            Id: 'key-id',
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateApiKeyCommand, {
            apiId: 'apiId',
            expires: 1001,
            id: 'key-id',
        });
    });
    (0, silent_1.silentTest)('calls the updateApiKey() API when it receives only a expires property difference and no api-key-id in an AppSync ApiKey', async () => {
        // GIVEN
        setup.setCurrentCfnStackTemplate({
            Resources: {
                AppSyncApiKey: {
                    Type: 'AWS::AppSync::ApiKey',
                    Properties: {
                        ApiId: 'apiId',
                        Expires: 1000,
                    },
                    Metadata: {
                        'aws:asset:path': 'old-path',
                    },
                },
            },
        });
        setup.pushStackResourceSummaries(setup.stackSummaryOf('AppSyncApiKey', 'AWS::AppSync::ApiKey', 'arn:aws:appsync:us-east-1:111111111111:apis/apiId/apikeys/api-key-id'));
        const cdkStackArtifact = setup.cdkStackArtifactOf({
            template: {
                Resources: {
                    AppSyncApiKey: {
                        Type: 'AWS::AppSync::ApiKey',
                        Properties: {
                            ApiId: 'apiId',
                            Expires: 1001,
                        },
                        Metadata: {
                            'aws:asset:path': 'new-path',
                        },
                    },
                },
            },
        });
        // WHEN
        const deployStackResult = await hotswapMockSdkProvider.tryHotswapDeployment(hotswapMode, cdkStackArtifact);
        // THEN
        expect(deployStackResult).not.toBeUndefined();
        expect(mock_sdk_1.mockAppSyncClient).toHaveReceivedCommandWith(client_appsync_1.UpdateApiKeyCommand, {
            apiId: 'apiId',
            expires: 1001,
            id: 'api-key-id',
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwc3luYy1tYXBwaW5nLXRlbXBsYXRlcy1ob3Rzd2FwLWRlcGxveW1lbnRzLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhcHBzeW5jLW1hcHBpbmctdGVtcGxhdGVzLWhvdHN3YXAtZGVwbG95bWVudHMudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLG1DQUFrQztBQUNsQyw0REFPaUM7QUFDakMsa0RBQXNEO0FBQ3RELHFEQUFxRDtBQUNyRCw4Q0FBOEM7QUFDOUMsNERBQThEO0FBQzlELGtEQUFzRTtBQUN0RSw4Q0FBK0M7QUFFL0MsSUFBSSxzQkFBb0QsQ0FBQztBQUV6RCxVQUFVLENBQUMsR0FBRyxFQUFFO0lBQ2Qsc0JBQXNCLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixFQUFFLENBQUM7QUFDckQsQ0FBQyxDQUFDLENBQUM7QUFFSCxNQUFNLGFBQWEsR0FBRyxDQUFDLEtBQWEsRUFBRSxFQUFFO0lBQ3RDLE1BQU0sTUFBTSxHQUFHLElBQUksaUJBQVEsRUFBRSxDQUFDO0lBQzlCLE1BQU0sQ0FBQyxLQUFLLEdBQUcsR0FBRyxFQUFFLEdBQUUsQ0FBQyxDQUFDO0lBQ3hCLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDbkIsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLG1CQUFtQjtJQUN0QyxPQUFPLElBQUEsNEJBQWMsRUFBQyxNQUFNLENBQUMsQ0FBQztBQUNoQyxDQUFDLENBQUM7QUFFRixRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsb0JBQVcsQ0FBQyxTQUFTLEVBQUUsb0JBQVcsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLFNBQVMsRUFBRSxDQUFDLFdBQVcsRUFBRSxFQUFFO0lBQzFGLElBQUEsbUJBQVUsRUFDUjs0Q0FDd0MsRUFDeEMsS0FBSyxJQUFJLEVBQUU7UUFDVCxRQUFRO1FBQ1IsTUFBTSxnQkFBZ0IsR0FBRyxLQUFLLENBQUMsa0JBQWtCLENB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QyxDQUFDO1FBRTNHLE9BQU87UUFDUCxNQUFNLENBQUMsaUJBQWlCLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLENBQUM7UUFDOUMsTUFBTSxDQUFDLDRCQUFpQixDQUFDLENBQUMseUJBQXlCLENBQUMsb0NBQW1CLEVBQUU7WUFDdkUsS0FBSyxFQUFFLE9BQU87WUFDZCxPQUFPLEVBQUUsSUFBSTtZQUNiLEVBQUUsRUFBRSxZQUFZO1NBQ2pCLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FDRixDQUFDO0FBQ0osQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBSZWFkYWJsZSB9IGZyb20gJ3N0cmVhbSc7XG5pbXBvcnQge1xuICBHZXRTY2hlbWFDcmVhdGlvblN0YXR1c0NvbW1hbmQsXG4gIExpc3RGdW5jdGlvbnNDb21tYW5kLFxuICBTdGFydFNjaGVtYUNyZWF0aW9uQ29tbWFuZCxcbiAgVXBkYXRlQXBpS2V5Q29tbWFuZCxcbiAgVXBkYXRlRnVuY3Rpb25Db21tYW5kLFxuICBVcGRhdGVSZXNvbHZlckNvbW1hbmQsXG59IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1hcHBzeW5jJztcbmltcG9ydCB7IEdldE9iamVjdENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtczMnO1xuaW1wb3J0IHsgc2RrU3RyZWFtTWl4aW4gfSBmcm9tICdAc21pdGh5L3V0aWwtc3RyZWFtJztcbmltcG9ydCAqIGFzIHNldHVwIGZyb20gJy4vaG90c3dhcC10ZXN0LXNldHVwJztcbmltcG9ydCB7IEhvdHN3YXBNb2RlIH0gZnJvbSAnLi4vLi4vLi4vbGliL2FwaS9ob3Rzd2FwL2NvbW1vbic7XG5pbXBvcnQgeyBtb2NrQXBwU3luY0NsaWVudCwgbW9ja1MzQ2xpZW50IH0gZnJvbSAnLi4vLi4vdXRpbC9tb2NrLXNkayc7XG5pbXBvcnQgeyBzaWxlbnRUZXN0IH0gZnJvbSAnLi4vLi4vdXRpbC9zaWxlbnQnO1xuXG5sZXQgaG90c3dhcE1vY2tTZGtQcm92aWRlcjogc2V0dXAuSG90c3dhcE1vY2tTZGtQcm92aWRlcjtcblxuYmVmb3JlRWFjaCgoKSA9PiB7XG4gIGhvdHN3YXBNb2NrU2RrUHJvdmlkZXIgPSBzZXR1cC5zZXR1cEhvdHN3YXBUZXN0cygpO1xufSk7XG5cbmNvbnN0IGdldEJvZHlTdHJlYW0gPSAoaW5wdXQ6IHN0cmluZykgPT4ge1xuICBjb25zdCBzdHJlYW0gPSBuZXcgUmVhZGFibGUoKTtcbiAgc3RyZWFtLl9yZWFkID0gKCkgPT4ge307XG4gIHN0cmVhbS5wdXNoKGlucHV0KTtcbiAgc3RyZWFtLnB1c2gobnVsbCk7IC8vIGNsb3NlIHRoZSBzdHJlYW1cbiAgcmV0dXJuIHNka1N0cmVhbU1peGluKHN0cmVhbSk7XG59O1xuXG5kZXNjcmliZS5lYWNoKFtIb3Rzd2FwTW9kZS5GQUxMX0JBQ0ssIEhvdHN3YXBNb2RlLkhPVFNXQVBfT05MWV0pKCclcCBtb2RlJywgKGhvdHN3YXBNb2RlKSA9PiB7XG4gIHNpbGVudFRlc3QoXG4gICAgYEEgbmV3IFJlc29sdmVyIGJlaW5nIGFkZGVkIHRvIHRoZSBTdGFjayByZXR1cm5zIHVuZGVmaW5lZCBpbiBDTEFTU0lDIG1vZGUgYW5kXG4gICAgICAgIHJldHVybnMgYSBub09wIGluIEhPVFNXQVBfT05MWSBtb2RlYCxcbiAgICBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBHSVZFTlxuICAgICAgY29uc3QgY2RrU3RhY2tBcnRpZmFjdCA9IHNldHVwLmNka1N0YWNrQXJ0aWZhY3RPZih7XG4gICAgICAgIHRlbXBsYXRlOiB7XG4gICAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgICBBcHBTeW5jUmVzb2x2ZXI6IHtcbiAgICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFdIRU5cbiAgICAgIGNvbnN0IGRlcGxveVN0YWNrUmVzdWx0ID0gYXdhaXQgaG90c3dhcE1vY2tTZGtQcm92aWRlci50cnlIb3Rzd2FwRGVwbG95bWVudChob3Rzd2FwTW9kZSwgY2RrU3RhY2tBcnRpZmFjdCk7XG5cbiAgICAgIC8vIFRIRU5cbiAgICAgIGlmIChob3Rzd2FwTW9kZSA9PT0gSG90c3dhcE1vZGUuRkFMTF9CQUNLKSB7XG4gICAgICAgIGV4cGVjdChkZXBsb3lTdGFja1Jlc3VsdCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgfSBlbHNlIGlmIChob3Rzd2FwTW9kZSA9PT0gSG90c3dhcE1vZGUuSE9UU1dBUF9PTkxZKSB7XG4gICAgICAgIGV4cGVjdChkZXBsb3lTdGFja1Jlc3VsdCkubm90LnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0Py5ub09wKS50b0VxdWFsKHRydWUpO1xuICAgICAgfVxuXG4gICAgICBleHBlY3QobW9ja0FwcFN5bmNDbGllbnQpLm5vdC50b0hhdmVSZWNlaXZlZENvbW1hbmQoVXBkYXRlRnVuY3Rpb25Db21tYW5kKTtcbiAgICAgIGV4cGVjdChtb2NrQXBwU3luY0NsaWVudCkubm90LnRvSGF2ZVJlY2VpdmVkQ29tbWFuZChVcGRhdGVSZXNvbHZlckNvbW1hbmQpO1xuICAgIH0sXG4gICk7XG5cbiAgc2lsZW50VGVzdChcbiAgICAnY2FsbHMgdGhlIHVwZGF0ZVJlc29sdmVyKCkgQVBJIHdoZW4gaXQgcmVjZWl2ZXMgb25seSBhIG1hcHBpbmcgdGVtcGxhdGUgZGlmZmVyZW5jZSBpbiBhIFVuaXQgUmVzb2x2ZXInLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEdJVkVOXG4gICAgICBzZXR1cC5zZXRDdXJyZW50Q2ZuU3RhY2tUZW1wbGF0ZSh7XG4gICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgIEFwcFN5bmNSZXNvbHZlcjoge1xuICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInLFxuICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICBBcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgICAgICAgRmllbGROYW1lOiAnbXlGaWVsZCcsXG4gICAgICAgICAgICAgIFR5cGVOYW1lOiAnUXVlcnknLFxuICAgICAgICAgICAgICBEYXRhU291cmNlTmFtZTogJ215LWRhdGFzb3VyY2UnLFxuICAgICAgICAgICAgICBLaW5kOiAnVU5JVCcsXG4gICAgICAgICAgICAgIFJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6ICcjIyBvcmlnaW5hbCByZXF1ZXN0IHRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgUmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6ICcjIyBvcmlnaW5hbCByZXNwb25zZSB0ZW1wbGF0ZScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ29sZC1wYXRoJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgc2V0dXAucHVzaFN0YWNrUmVzb3VyY2VTdW1tYXJpZXMoXG4gICAgICAgIHNldHVwLnN0YWNrU3VtbWFyeU9mKFxuICAgICAgICAgICdBcHBTeW5jUmVzb2x2ZXInLFxuICAgICAgICAgICdBV1M6OkFwcFN5bmM6OlJlc29sdmVyJyxcbiAgICAgICAgICAnYXJuOmF3czphcHBzeW5jOnVzLWVhc3QtMToxMTExMTExMTExMTE6YXBpcy9hcGlJZC90eXBlcy9RdWVyeS9yZXNvbHZlcnMvbXlGaWVsZCcsXG4gICAgICAgICksXG4gICAgICApO1xuICAgICAgY29uc3QgY2RrU3RhY2tBcnRpZmFjdCA9IHNldHVwLmNka1N0YWNrQXJ0aWZhY3RPZih7XG4gICAgICAgIHRlbXBsYXRlOiB7XG4gICAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgICBBcHBTeW5jUmVzb2x2ZXI6IHtcbiAgICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInLFxuICAgICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgICAgRmllbGROYW1lOiAnbXlGaWVsZCcsXG4gICAgICAgICAgICAgICAgVHlwZU5hbWU6ICdRdWVyeScsXG4gICAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgICAgICBLaW5kOiAnVU5JVCcsXG4gICAgICAgICAgICAgICAgUmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogJyMjIG5ldyByZXF1ZXN0IHRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgICBSZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlc3BvbnNlIHRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgICAnYXdzOmFzc2V0OnBhdGgnOiAnbmV3LXBhdGgnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFdIRU5cbiAgICAgIGNvbnN0IGRlcGxveVN0YWNrUmVzdWx0ID0gYXdhaXQgaG90c3dhcE1vY2tTZGtQcm92aWRlci50cnlIb3Rzd2FwRGVwbG95bWVudChob3Rzd2FwTW9kZSwgY2RrU3RhY2tBcnRpZmFjdCk7XG5cbiAgICAgIC8vIFRIRU5cbiAgICAgIGV4cGVjdChkZXBsb3lTdGFja1Jlc3VsdCkubm90LnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChtb2NrQXBwU3luY0NsaWVudCkudG9IYXZlUmVjZWl2ZWRDb21tYW5kV2l0aChVcGRhdGVSZXNvbHZlckNvbW1hbmQsIHtcbiAgICAgICAgYXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgIGRhdGFTb3VyY2VOYW1lOiAnbXktZGF0YXNvdXJjZScsXG4gICAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxuICAgICAgICBmaWVsZE5hbWU6ICdteUZpZWxkJyxcbiAgICAgICAga2luZDogJ1VOSVQnLFxuICAgICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiAnIyMgbmV3IHJlcXVlc3QgdGVtcGxhdGUnLFxuICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlc3BvbnNlIHRlbXBsYXRlJyxcbiAgICAgIH0pO1xuICAgIH0sXG4gICk7XG5cbiAgc2lsZW50VGVzdChcbiAgICAnY2FsbHMgdGhlIHVwZGF0ZVJlc29sdmVyKCkgQVBJIHdoZW4gaXQgcmVjZWl2ZXMgb25seSBhIG1hcHBpbmcgdGVtcGxhdGUgZGlmZmVyZW5jZSBzMyBsb2NhdGlvbiBpbiBhIFVuaXQgUmVzb2x2ZXInLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEdJVkVOXG4gICAgICBjb25zdCBib2R5ID0gZ2V0Qm9keVN0cmVhbSgndGVtcGxhdGUgZGVmaW5lZCBpbiBzMycpO1xuICAgICAgbW9ja1MzQ2xpZW50Lm9uKEdldE9iamVjdENvbW1hbmQpLnJlc29sdmVzKHtcbiAgICAgICAgQm9keTogYm9keSxcbiAgICAgIH0pO1xuICAgICAgc2V0dXAuc2V0Q3VycmVudENmblN0YWNrVGVtcGxhdGUoe1xuICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICBBcHBTeW5jUmVzb2x2ZXI6IHtcbiAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6OlJlc29sdmVyJyxcbiAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgIEZpZWxkTmFtZTogJ215RmllbGQnLFxuICAgICAgICAgICAgICBUeXBlTmFtZTogJ1F1ZXJ5JyxcbiAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgICAgS2luZDogJ1VOSVQnLFxuICAgICAgICAgICAgICBSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlUzNMb2NhdGlvbjogJ3MzOi8vdGVzdC1idWNrZXQvb2xkX2xvY2F0aW9uJyxcbiAgICAgICAgICAgICAgUmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6ICcjIyBvcmlnaW5hbCByZXNwb25zZSB0ZW1wbGF0ZScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ29sZC1wYXRoJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgc2V0dXAucHVzaFN0YWNrUmVzb3VyY2VTdW1tYXJpZXMoXG4gICAgICAgIHNldHVwLnN0YWNrU3VtbWFyeU9mKFxuICAgICAgICAgICdBcHBTeW5jUmVzb2x2ZXInLFxuICAgICAgICAgICdBV1M6OkFwcFN5bmM6OlJlc29sdmVyJyxcbiAgICAgICAgICAnYXJuOmF3czphcHBzeW5jOnVzLWVhc3QtMToxMTExMTExMTExMTE6YXBpcy9hcGlJZC90eXBlcy9RdWVyeS9yZXNvbHZlcnMvbXlGaWVsZCcsXG4gICAgICAgICksXG4gICAgICApO1xuICAgICAgY29uc3QgY2RrU3RhY2tBcnRpZmFjdCA9IHNldHVwLmNka1N0YWNrQXJ0aWZhY3RPZih7XG4gICAgICAgIHRlbXBsYXRlOiB7XG4gICAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgICBBcHBTeW5jUmVzb2x2ZXI6IHtcbiAgICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInLFxuICAgICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgICAgRmllbGROYW1lOiAnbXlGaWVsZCcsXG4gICAgICAgICAgICAgICAgVHlwZU5hbWU6ICdRdWVyeScsXG4gICAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgICAgICBLaW5kOiAnVU5JVCcsXG4gICAgICAgICAgICAgICAgUmVxdWVzdE1hcHBpbmdUZW1wbGF0ZVMzTG9jYXRpb246ICdzMzovL3Rlc3QtYnVja2V0L3BhdGgvdG8va2V5JyxcbiAgICAgICAgICAgICAgICBSZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlc3BvbnNlIHRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgICAnYXdzOmFzc2V0OnBhdGgnOiAnbmV3LXBhdGgnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFdIRU5cbiAgICAgIGNvbnN0IGRlcGxveVN0YWNrUmVzdWx0ID0gYXdhaXQgaG90c3dhcE1vY2tTZGtQcm92aWRlci50cnlIb3Rzd2FwRGVwbG95bWVudChob3Rzd2FwTW9kZSwgY2RrU3RhY2tBcnRpZmFjdCk7XG5cbiAgICAgIC8vIFRIRU5cbiAgICAgIGV4cGVjdChkZXBsb3lTdGFja1Jlc3VsdCkubm90LnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChtb2NrQXBwU3luY0NsaWVudCkudG9IYXZlUmVjZWl2ZWRDb21tYW5kV2l0aChVcGRhdGVSZXNvbHZlckNvbW1hbmQsIHtcbiAgICAgICAgYXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgIGRhdGFTb3VyY2VOYW1lOiAnbXktZGF0YXNvdXJjZScsXG4gICAgICAgIHR5cGVOYW1lOiAnUXVlcnknLFxuICAgICAgICBmaWVsZE5hbWU6ICdteUZpZWxkJyxcbiAgICAgICAga2luZDogJ1VOSVQnLFxuICAgICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiAndGVtcGxhdGUgZGVmaW5lZCBpbiBzMycsXG4gICAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiAnIyMgb3JpZ2luYWwgcmVzcG9uc2UgdGVtcGxhdGUnLFxuICAgICAgfSk7XG4gICAgICBleHBlY3QobW9ja1MzQ2xpZW50KS50b0hhdmVSZWNlaXZlZENvbW1hbmRXaXRoKEdldE9iamVjdENvbW1hbmQsIHtcbiAgICAgICAgQnVja2V0OiAndGVzdC1idWNrZXQnLFxuICAgICAgICBLZXk6ICdwYXRoL3RvL2tleScsXG4gICAgICB9KTtcbiAgICB9LFxuICApO1xuXG4gIHNpbGVudFRlc3QoXG4gICAgJ2NhbGxzIHRoZSB1cGRhdGVSZXNvbHZlcigpIEFQSSB3aGVuIGl0IHJlY2VpdmVzIG9ubHkgYSBjb2RlIHMzIGxvY2F0aW9uIGluIGEgUGlwZWxpbmUgUmVzb2x2ZXInLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEdJVkVOXG4gICAgICBjb25zdCBib2R5ID0gZ2V0Qm9keVN0cmVhbSgnY29kZSBkZWZpbmVkIGluIHMzJyk7XG4gICAgICBtb2NrUzNDbGllbnQub24oR2V0T2JqZWN0Q29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBCb2R5OiBib2R5LFxuICAgICAgfSk7XG4gICAgICBzZXR1cC5zZXRDdXJyZW50Q2ZuU3RhY2tUZW1wbGF0ZSh7XG4gICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgIEFwcFN5bmNSZXNvbHZlcjoge1xuICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInLFxuICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICBBcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgICAgICAgRmllbGROYW1lOiAnbXlGaWVsZCcsXG4gICAgICAgICAgICAgIFR5cGVOYW1lOiAnUXVlcnknLFxuICAgICAgICAgICAgICBEYXRhU291cmNlTmFtZTogJ215LWRhdGFzb3VyY2UnLFxuICAgICAgICAgICAgICBQaXBlbGluZUNvbmZpZzogWydmdW5jdGlvbjEnXSxcbiAgICAgICAgICAgICAgQ29kZVMzTG9jYXRpb246ICdzMzovL3Rlc3QtYnVja2V0L29sZF9sb2NhdGlvbicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ29sZC1wYXRoJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgc2V0dXAucHVzaFN0YWNrUmVzb3VyY2VTdW1tYXJpZXMoXG4gICAgICAgIHNldHVwLnN0YWNrU3VtbWFyeU9mKFxuICAgICAgICAgICdBcHBTeW5jUmVzb2x2ZXInLFxuICAgICAgICAgICdBV1M6OkFwcFN5bmM6OlJlc29sdmVyJyxcbiAgICAgICAgICAnYXJuOmF3czphcHBzeW5jOnVzLWVhc3QtMToxMTExMTExMTExMTE6YXBpcy9hcGlJZC90eXBlcy9RdWVyeS9yZXNvbHZlcnMvbXlGaWVsZCcsXG4gICAgICAgICksXG4gICAgICApO1xuICAgICAgY29uc3QgY2RrU3RhY2tBcnRpZmFjdCA9IHNldHVwLmNka1N0YWNrQXJ0aWZhY3RPZih7XG4gICAgICAgIHRlbXBsYXRlOiB7XG4gICAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgICBBcHBTeW5jUmVzb2x2ZXI6IHtcbiAgICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInLFxuICAgICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgICAgRmllbGROYW1lOiAnbXlGaWVsZCcsXG4gICAgICAgICAgICAgICAgVHlwZU5hbWU6ICdRdWVyeScsXG4gICAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgICAgICBQaXBlbGluZUNvbmZpZzogWydmdW5jdGlvbjEnXSxcbiAgICAgICAgICAgICAgICBDb2RlUzNMb2NhdGlvbjogJ3MzOi8vdGVzdC1idWNrZXQvcGF0aC90by9rZXknLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICduZXctcGF0aCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gV0hFTlxuICAgICAgY29uc3QgZGVwbG95U3RhY2tSZXN1bHQgPSBhd2FpdCBob3Rzd2FwTW9ja1Nka1Byb3ZpZGVyLnRyeUhvdHN3YXBEZXBsb3ltZW50KGhvdHN3YXBNb2RlLCBjZGtTdGFja0FydGlmYWN0KTtcblxuICAgICAgLy8gVEhFTlxuICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0KS5ub3QudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS50b0hhdmVSZWNlaXZlZENvbW1hbmRXaXRoKFVwZGF0ZVJlc29sdmVyQ29tbWFuZCwge1xuICAgICAgICBhcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgZGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXG4gICAgICAgIGZpZWxkTmFtZTogJ215RmllbGQnLFxuICAgICAgICBwaXBlbGluZUNvbmZpZzogWydmdW5jdGlvbjEnXSxcbiAgICAgICAgY29kZTogJ2NvZGUgZGVmaW5lZCBpbiBzMycsXG4gICAgICB9KTtcbiAgICAgIGV4cGVjdChtb2NrUzNDbGllbnQpLnRvSGF2ZVJlY2VpdmVkQ29tbWFuZFdpdGgoR2V0T2JqZWN0Q29tbWFuZCwge1xuICAgICAgICBCdWNrZXQ6ICd0ZXN0LWJ1Y2tldCcsXG4gICAgICAgIEtleTogJ3BhdGgvdG8va2V5JyxcbiAgICAgIH0pO1xuICAgIH0sXG4gICk7XG5cbiAgc2lsZW50VGVzdChcbiAgICAnY2FsbHMgdGhlIHVwZGF0ZVJlc29sdmVyKCkgQVBJIHdoZW4gaXQgcmVjZWl2ZXMgb25seSBhIGNvZGUgZGlmZmVyZW5jZSBpbiBhIFBpcGVsaW5lIFJlc29sdmVyJyxcbiAgICBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBHSVZFTlxuICAgICAgc2V0dXAuc2V0Q3VycmVudENmblN0YWNrVGVtcGxhdGUoe1xuICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICBBcHBTeW5jUmVzb2x2ZXI6IHtcbiAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6OlJlc29sdmVyJyxcbiAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgIEZpZWxkTmFtZTogJ215RmllbGQnLFxuICAgICAgICAgICAgICBUeXBlTmFtZTogJ1F1ZXJ5JyxcbiAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgICAgUGlwZWxpbmVDb25maWc6IFsnZnVuY3Rpb24xJ10sXG4gICAgICAgICAgICAgIENvZGU6ICdvbGQgY29kZScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ29sZC1wYXRoJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgc2V0dXAucHVzaFN0YWNrUmVzb3VyY2VTdW1tYXJpZXMoXG4gICAgICAgIHNldHVwLnN0YWNrU3VtbWFyeU9mKFxuICAgICAgICAgICdBcHBTeW5jUmVzb2x2ZXInLFxuICAgICAgICAgICdBV1M6OkFwcFN5bmM6OlJlc29sdmVyJyxcbiAgICAgICAgICAnYXJuOmF3czphcHBzeW5jOnVzLWVhc3QtMToxMTExMTExMTExMTE6YXBpcy9hcGlJZC90eXBlcy9RdWVyeS9yZXNvbHZlcnMvbXlGaWVsZCcsXG4gICAgICAgICksXG4gICAgICApO1xuICAgICAgY29uc3QgY2RrU3RhY2tBcnRpZmFjdCA9IHNldHVwLmNka1N0YWNrQXJ0aWZhY3RPZih7XG4gICAgICAgIHRlbXBsYXRlOiB7XG4gICAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgICBBcHBTeW5jUmVzb2x2ZXI6IHtcbiAgICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInLFxuICAgICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgICAgRmllbGROYW1lOiAnbXlGaWVsZCcsXG4gICAgICAgICAgICAgICAgVHlwZU5hbWU6ICdRdWVyeScsXG4gICAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgICAgICBQaXBlbGluZUNvbmZpZzogWydmdW5jdGlvbjEnXSxcbiAgICAgICAgICAgICAgICBDb2RlOiAnbmV3IGNvZGUnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICduZXctcGF0aCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gV0hFTlxuICAgICAgY29uc3QgZGVwbG95U3RhY2tSZXN1bHQgPSBhd2FpdCBob3Rzd2FwTW9ja1Nka1Byb3ZpZGVyLnRyeUhvdHN3YXBEZXBsb3ltZW50KGhvdHN3YXBNb2RlLCBjZGtTdGFja0FydGlmYWN0KTtcblxuICAgICAgLy8gVEhFTlxuICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0KS5ub3QudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS50b0hhdmVSZWNlaXZlZENvbW1hbmRXaXRoKFVwZGF0ZVJlc29sdmVyQ29tbWFuZCwge1xuICAgICAgICBhcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgZGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXG4gICAgICAgIGZpZWxkTmFtZTogJ215RmllbGQnLFxuICAgICAgICBwaXBlbGluZUNvbmZpZzogWydmdW5jdGlvbjEnXSxcbiAgICAgICAgY29kZTogJ25ldyBjb2RlJyxcbiAgICAgIH0pO1xuICAgIH0sXG4gICk7XG5cbiAgc2lsZW50VGVzdChcbiAgICAnY2FsbHMgdGhlIHVwZGF0ZVJlc29sdmVyKCkgQVBJIHdoZW4gaXQgcmVjZWl2ZXMgb25seSBhIG1hcHBpbmcgdGVtcGxhdGUgZGlmZmVyZW5jZSBpbiBhIFBpcGVsaW5lIFJlc29sdmVyJyxcbiAgICBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBHSVZFTlxuICAgICAgc2V0dXAuc2V0Q3VycmVudENmblN0YWNrVGVtcGxhdGUoe1xuICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICBBcHBTeW5jUmVzb2x2ZXI6IHtcbiAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6OlJlc29sdmVyJyxcbiAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgIEZpZWxkTmFtZTogJ215RmllbGQnLFxuICAgICAgICAgICAgICBUeXBlTmFtZTogJ1F1ZXJ5JyxcbiAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgICAgS2luZDogJ1BJUEVMSU5FJyxcbiAgICAgICAgICAgICAgUGlwZWxpbmVDb25maWc6IFsnZnVuY3Rpb24xJ10sXG4gICAgICAgICAgICAgIFJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6ICcjIyBvcmlnaW5hbCByZXF1ZXN0IHRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgUmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6ICcjIyBvcmlnaW5hbCByZXNwb25zZSB0ZW1wbGF0ZScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ29sZC1wYXRoJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgc2V0dXAucHVzaFN0YWNrUmVzb3VyY2VTdW1tYXJpZXMoXG4gICAgICAgIHNldHVwLnN0YWNrU3VtbWFyeU9mKFxuICAgICAgICAgICdBcHBTeW5jUmVzb2x2ZXInLFxuICAgICAgICAgICdBV1M6OkFwcFN5bmM6OlJlc29sdmVyJyxcbiAgICAgICAgICAnYXJuOmF3czphcHBzeW5jOnVzLWVhc3QtMToxMTExMTExMTExMTE6YXBpcy9hcGlJZC90eXBlcy9RdWVyeS9yZXNvbHZlcnMvbXlGaWVsZCcsXG4gICAgICAgICksXG4gICAgICApO1xuICAgICAgY29uc3QgY2RrU3RhY2tBcnRpZmFjdCA9IHNldHVwLmNka1N0YWNrQXJ0aWZhY3RPZih7XG4gICAgICAgIHRlbXBsYXRlOiB7XG4gICAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgICBBcHBTeW5jUmVzb2x2ZXI6IHtcbiAgICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInLFxuICAgICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgICAgRmllbGROYW1lOiAnbXlGaWVsZCcsXG4gICAgICAgICAgICAgICAgVHlwZU5hbWU6ICdRdWVyeScsXG4gICAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgICAgICBLaW5kOiAnUElQRUxJTkUnLFxuICAgICAgICAgICAgICAgIFBpcGVsaW5lQ29uZmlnOiBbJ2Z1bmN0aW9uMSddLFxuICAgICAgICAgICAgICAgIFJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6ICcjIyBuZXcgcmVxdWVzdCB0ZW1wbGF0ZScsXG4gICAgICAgICAgICAgICAgUmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6ICcjIyBvcmlnaW5hbCByZXNwb25zZSB0ZW1wbGF0ZScsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIE1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ25ldy1wYXRoJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBkZXBsb3lTdGFja1Jlc3VsdCA9IGF3YWl0IGhvdHN3YXBNb2NrU2RrUHJvdmlkZXIudHJ5SG90c3dhcERlcGxveW1lbnQoaG90c3dhcE1vZGUsIGNka1N0YWNrQXJ0aWZhY3QpO1xuXG4gICAgICAvLyBUSEVOXG4gICAgICBleHBlY3QoZGVwbG95U3RhY2tSZXN1bHQpLm5vdC50b0JlVW5kZWZpbmVkKCk7XG4gICAgICBleHBlY3QobW9ja0FwcFN5bmNDbGllbnQpLnRvSGF2ZVJlY2VpdmVkQ29tbWFuZFdpdGgoVXBkYXRlUmVzb2x2ZXJDb21tYW5kLCB7XG4gICAgICAgIGFwaUlkOiAnYXBpSWQnLFxuICAgICAgICBkYXRhU291cmNlTmFtZTogJ215LWRhdGFzb3VyY2UnLFxuICAgICAgICB0eXBlTmFtZTogJ1F1ZXJ5JyxcbiAgICAgICAgZmllbGROYW1lOiAnbXlGaWVsZCcsXG4gICAgICAgIGtpbmQ6ICdQSVBFTElORScsXG4gICAgICAgIHBpcGVsaW5lQ29uZmlnOiBbJ2Z1bmN0aW9uMSddLFxuICAgICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiAnIyMgbmV3IHJlcXVlc3QgdGVtcGxhdGUnLFxuICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlc3BvbnNlIHRlbXBsYXRlJyxcbiAgICAgIH0pO1xuICAgIH0sXG4gICk7XG5cbiAgc2lsZW50VGVzdChcbiAgICBgd2hlbiBpdCByZWNlaXZlcyBhIGNoYW5nZSB0aGF0IGlzIG5vdCBhIG1hcHBpbmcgdGVtcGxhdGUgZGlmZmVyZW5jZSBpbiBhIFJlc29sdmVyLCBpdCBkb2VzIG5vdCBjYWxsIHRoZSB1cGRhdGVSZXNvbHZlcigpIEFQSSBpbiBDTEFTU0lDIG1vZGVcbiAgICAgICAgYnV0IGRvZXMgY2FsbCB0aGUgdXBkYXRlUmVzb2x2ZXIoKSBBUEkgaW4gSE9UU1dBUF9PTkxZIG1vZGVgLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEdJVkVOXG4gICAgICBzZXR1cC5zZXRDdXJyZW50Q2ZuU3RhY2tUZW1wbGF0ZSh7XG4gICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgIEFwcFN5bmNSZXNvbHZlcjoge1xuICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInLFxuICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICBSZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlc3BvbnNlIHRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgUmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlcXVlc3QgdGVtcGxhdGUnLFxuICAgICAgICAgICAgICBGaWVsZE5hbWU6ICdvbGRGaWVsZCcsXG4gICAgICAgICAgICAgIEFwaUlkOiAnYXBpSWQnLFxuICAgICAgICAgICAgICBUeXBlTmFtZTogJ1F1ZXJ5JyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAnYXdzOmFzc2V0OnBhdGgnOiAnb2xkLXBhdGgnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBzZXR1cC5wdXNoU3RhY2tSZXNvdXJjZVN1bW1hcmllcyhcbiAgICAgICAgc2V0dXAuc3RhY2tTdW1tYXJ5T2YoXG4gICAgICAgICAgJ0FwcFN5bmNSZXNvbHZlcicsXG4gICAgICAgICAgJ0FXUzo6QXBwU3luYzo6UmVzb2x2ZXInLFxuICAgICAgICAgICdhcm46YXdzOmFwcHN5bmM6dXMtZWFzdC0xOjExMTExMTExMTExMTphcGlzL2FwaUlkL3R5cGVzL1F1ZXJ5L3Jlc29sdmVycy9teUZpZWxkJyxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgICBjb25zdCBjZGtTdGFja0FydGlmYWN0ID0gc2V0dXAuY2RrU3RhY2tBcnRpZmFjdE9mKHtcbiAgICAgICAgdGVtcGxhdGU6IHtcbiAgICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICAgIEFwcFN5bmNSZXNvbHZlcjoge1xuICAgICAgICAgICAgICBUeXBlOiAnQVdTOjpBcHBTeW5jOjpSZXNvbHZlcicsXG4gICAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICBSZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlc3BvbnNlIHRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgICBSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiAnIyMgbmV3IHJlcXVlc3QgdGVtcGxhdGUnLFxuICAgICAgICAgICAgICAgIEZpZWxkTmFtZTogJ25ld0ZpZWxkJyxcbiAgICAgICAgICAgICAgICBBcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgICAgICAgICBUeXBlTmFtZTogJ1F1ZXJ5JyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBXSEVOXG4gICAgICBjb25zdCBkZXBsb3lTdGFja1Jlc3VsdCA9IGF3YWl0IGhvdHN3YXBNb2NrU2RrUHJvdmlkZXIudHJ5SG90c3dhcERlcGxveW1lbnQoaG90c3dhcE1vZGUsIGNka1N0YWNrQXJ0aWZhY3QpO1xuXG4gICAgICAvLyBUSEVOXG4gICAgICBpZiAoaG90c3dhcE1vZGUgPT09IEhvdHN3YXBNb2RlLkZBTExfQkFDSykge1xuICAgICAgICBleHBlY3QoZGVwbG95U3RhY2tSZXN1bHQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS5ub3QudG9IYXZlUmVjZWl2ZWRDb21tYW5kKFVwZGF0ZVJlc29sdmVyQ29tbWFuZCk7XG4gICAgICB9IGVsc2UgaWYgKGhvdHN3YXBNb2RlID09PSBIb3Rzd2FwTW9kZS5IT1RTV0FQX09OTFkpIHtcbiAgICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0KS5ub3QudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgICBleHBlY3QobW9ja0FwcFN5bmNDbGllbnQpLnRvSGF2ZVJlY2VpdmVkQ29tbWFuZFdpdGgoVXBkYXRlUmVzb2x2ZXJDb21tYW5kLCB7XG4gICAgICAgICAgYXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgdHlwZU5hbWU6ICdRdWVyeScsXG4gICAgICAgICAgZmllbGROYW1lOiAnb2xkRmllbGQnLFxuICAgICAgICAgIHJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6ICcjIyBuZXcgcmVxdWVzdCB0ZW1wbGF0ZScsXG4gICAgICAgICAgcmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6ICcjIyBvcmlnaW5hbCByZXNwb25zZSB0ZW1wbGF0ZScsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBleHBlY3QobW9ja0FwcFN5bmNDbGllbnQpLm5vdC50b0hhdmVSZWNlaXZlZENvbW1hbmQoVXBkYXRlRnVuY3Rpb25Db21tYW5kKTtcbiAgICB9LFxuICApO1xuXG4gIHNpbGVudFRlc3QoXG4gICAgJ2RvZXMgbm90IGNhbGwgdGhlIHVwZGF0ZVJlc29sdmVyKCkgQVBJIHdoZW4gYSByZXNvdXJjZSB3aXRoIHR5cGUgdGhhdCBpcyBub3QgQVdTOjpBcHBTeW5jOjpSZXNvbHZlciBidXQgaGFzIHRoZSBzYW1lIHByb3BlcnRpZXMgaXMgY2hhbmdlZCcsXG4gICAgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gR0lWRU5cbiAgICAgIHNldHVwLnNldEN1cnJlbnRDZm5TdGFja1RlbXBsYXRlKHtcbiAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgQXBwU3luY1Jlc29sdmVyOiB7XG4gICAgICAgICAgICBUeXBlOiAnQVdTOjpBcHBTeW5jOjpOb3RBUmVzb2x2ZXInLFxuICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICBSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiAnIyMgb3JpZ2luYWwgdGVtcGxhdGUnLFxuICAgICAgICAgICAgICBGaWVsZE5hbWU6ICdvbGRGaWVsZCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ29sZC1wYXRoJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgY29uc3QgY2RrU3RhY2tBcnRpZmFjdCA9IHNldHVwLmNka1N0YWNrQXJ0aWZhY3RPZih7XG4gICAgICAgIHRlbXBsYXRlOiB7XG4gICAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgICBBcHBTeW5jUmVzb2x2ZXI6IHtcbiAgICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6Tm90QVJlc29sdmVyJyxcbiAgICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgIFJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6ICcjIyBuZXcgdGVtcGxhdGUnLFxuICAgICAgICAgICAgICAgIEZpZWxkTmFtZTogJ25ld0ZpZWxkJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBXSEVOXG4gICAgICBjb25zdCBkZXBsb3lTdGFja1Jlc3VsdCA9IGF3YWl0IGhvdHN3YXBNb2NrU2RrUHJvdmlkZXIudHJ5SG90c3dhcERlcGxveW1lbnQoaG90c3dhcE1vZGUsIGNka1N0YWNrQXJ0aWZhY3QpO1xuXG4gICAgICAvLyBUSEVOXG4gICAgICBpZiAoaG90c3dhcE1vZGUgPT09IEhvdHN3YXBNb2RlLkZBTExfQkFDSykge1xuICAgICAgICBleHBlY3QoZGVwbG95U3RhY2tSZXN1bHQpLnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIH0gZWxzZSBpZiAoaG90c3dhcE1vZGUgPT09IEhvdHN3YXBNb2RlLkhPVFNXQVBfT05MWSkge1xuICAgICAgICBleHBlY3QoZGVwbG95U3RhY2tSZXN1bHQpLm5vdC50b0JlVW5kZWZpbmVkKCk7XG4gICAgICAgIGV4cGVjdChkZXBsb3lTdGFja1Jlc3VsdD8ubm9PcCkudG9FcXVhbCh0cnVlKTtcbiAgICAgIH1cblxuICAgICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS5ub3QudG9IYXZlUmVjZWl2ZWRDb21tYW5kKFVwZGF0ZUZ1bmN0aW9uQ29tbWFuZCk7XG4gICAgICBleHBlY3QobW9ja0FwcFN5bmNDbGllbnQpLm5vdC50b0hhdmVSZWNlaXZlZENvbW1hbmQoVXBkYXRlUmVzb2x2ZXJDb21tYW5kKTtcbiAgICB9LFxuICApO1xuXG4gIHNpbGVudFRlc3QoXG4gICAgJ2NhbGxzIHRoZSB1cGRhdGVGdW5jdGlvbigpIEFQSSB3aGVuIGl0IHJlY2VpdmVzIG9ubHkgYSBtYXBwaW5nIHRlbXBsYXRlIGRpZmZlcmVuY2UgaW4gYSBGdW5jdGlvbicsXG4gICAgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gR0lWRU5cbiAgICAgIG1vY2tBcHBTeW5jQ2xpZW50XG4gICAgICAgIC5vbihMaXN0RnVuY3Rpb25zQ29tbWFuZClcbiAgICAgICAgLnJlc29sdmVzKHsgZnVuY3Rpb25zOiBbeyBuYW1lOiAnbXktZnVuY3Rpb24nLCBmdW5jdGlvbklkOiAnZnVuY3Rpb25JZCcgfV0gfSk7XG5cbiAgICAgIHNldHVwLnNldEN1cnJlbnRDZm5TdGFja1RlbXBsYXRlKHtcbiAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgQXBwU3luY0Z1bmN0aW9uOiB7XG4gICAgICAgICAgICBUeXBlOiAnQVdTOjpBcHBTeW5jOjpGdW5jdGlvbkNvbmZpZ3VyYXRpb24nLFxuICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICBOYW1lOiAnbXktZnVuY3Rpb24nLFxuICAgICAgICAgICAgICBBcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgICAgRnVuY3Rpb25WZXJzaW9uOiAnMjAxOC0wNS0yOScsXG4gICAgICAgICAgICAgIFJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6ICcjIyBvcmlnaW5hbCByZXF1ZXN0IHRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgUmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6ICcjIyBvcmlnaW5hbCByZXNwb25zZSB0ZW1wbGF0ZScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ29sZC1wYXRoJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgY29uc3QgY2RrU3RhY2tBcnRpZmFjdCA9IHNldHVwLmNka1N0YWNrQXJ0aWZhY3RPZih7XG4gICAgICAgIHRlbXBsYXRlOiB7XG4gICAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgICBBcHBTeW5jRnVuY3Rpb246IHtcbiAgICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6RnVuY3Rpb25Db25maWd1cmF0aW9uJyxcbiAgICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgIE5hbWU6ICdteS1mdW5jdGlvbicsXG4gICAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgICAgICBGdW5jdGlvblZlcnNpb246ICcyMDE4LTA1LTI5JyxcbiAgICAgICAgICAgICAgICBSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiAnIyMgb3JpZ2luYWwgcmVxdWVzdCB0ZW1wbGF0ZScsXG4gICAgICAgICAgICAgICAgUmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6ICcjIyBuZXcgcmVzcG9uc2UgdGVtcGxhdGUnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICduZXctcGF0aCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gV0hFTlxuICAgICAgY29uc3QgZGVwbG95U3RhY2tSZXN1bHQgPSBhd2FpdCBob3Rzd2FwTW9ja1Nka1Byb3ZpZGVyLnRyeUhvdHN3YXBEZXBsb3ltZW50KGhvdHN3YXBNb2RlLCBjZGtTdGFja0FydGlmYWN0KTtcblxuICAgICAgLy8gVEhFTlxuICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0KS5ub3QudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS50b0hhdmVSZWNlaXZlZENvbW1hbmRXaXRoKFVwZGF0ZUZ1bmN0aW9uQ29tbWFuZCwge1xuICAgICAgICBhcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgZGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgZnVuY3Rpb25JZDogJ2Z1bmN0aW9uSWQnLFxuICAgICAgICBmdW5jdGlvblZlcnNpb246ICcyMDE4LTA1LTI5JyxcbiAgICAgICAgbmFtZTogJ215LWZ1bmN0aW9uJyxcbiAgICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlcXVlc3QgdGVtcGxhdGUnLFxuICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogJyMjIG5ldyByZXNwb25zZSB0ZW1wbGF0ZScsXG4gICAgICB9KTtcbiAgICB9LFxuICApO1xuXG4gIHNpbGVudFRlc3QoXG4gICAgJ2NhbGxzIHRoZSB1cGRhdGVGdW5jdGlvbigpIEFQSSB3aXRoIGZ1bmN0aW9uIHZlcnNpb24gd2hlbiBpdCByZWNlaXZlcyBib3RoIGZ1bmN0aW9uIHZlcnNpb24gYW5kIHJ1bnRpbWUgd2l0aCBhIG1hcHBpbmcgdGVtcGxhdGUgaW4gYSBGdW5jdGlvbicsXG4gICAgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gR0lWRU5cbiAgICAgIG1vY2tBcHBTeW5jQ2xpZW50XG4gICAgICAgIC5vbihMaXN0RnVuY3Rpb25zQ29tbWFuZClcbiAgICAgICAgLnJlc29sdmVzKHsgZnVuY3Rpb25zOiBbeyBuYW1lOiAnbXktZnVuY3Rpb24nLCBmdW5jdGlvbklkOiAnZnVuY3Rpb25JZCcgfV0gfSk7XG5cbiAgICAgIHNldHVwLnNldEN1cnJlbnRDZm5TdGFja1RlbXBsYXRlKHtcbiAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgQXBwU3luY0Z1bmN0aW9uOiB7XG4gICAgICAgICAgICBUeXBlOiAnQVdTOjpBcHBTeW5jOjpGdW5jdGlvbkNvbmZpZ3VyYXRpb24nLFxuICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICBOYW1lOiAnbXktZnVuY3Rpb24nLFxuICAgICAgICAgICAgICBBcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgICAgRnVuY3Rpb25WZXJzaW9uOiAnMjAxOC0wNS0yOScsXG4gICAgICAgICAgICAgIFJ1bnRpbWU6ICdBUFBTWU5DX0pTJyxcbiAgICAgICAgICAgICAgUmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlcXVlc3QgdGVtcGxhdGUnLFxuICAgICAgICAgICAgICBSZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlc3BvbnNlIHRlbXBsYXRlJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAnYXdzOmFzc2V0OnBhdGgnOiAnb2xkLXBhdGgnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBjb25zdCBjZGtTdGFja0FydGlmYWN0ID0gc2V0dXAuY2RrU3RhY2tBcnRpZmFjdE9mKHtcbiAgICAgICAgdGVtcGxhdGU6IHtcbiAgICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICAgIEFwcFN5bmNGdW5jdGlvbjoge1xuICAgICAgICAgICAgICBUeXBlOiAnQVdTOjpBcHBTeW5jOjpGdW5jdGlvbkNvbmZpZ3VyYXRpb24nLFxuICAgICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgTmFtZTogJ215LWZ1bmN0aW9uJyxcbiAgICAgICAgICAgICAgICBBcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgICAgICAgICBEYXRhU291cmNlTmFtZTogJ215LWRhdGFzb3VyY2UnLFxuICAgICAgICAgICAgICAgIEZ1bmN0aW9uVmVyc2lvbjogJzIwMTgtMDUtMjknLFxuICAgICAgICAgICAgICAgIFJ1bnRpbWU6ICdBUFBTWU5DX0pTJyxcbiAgICAgICAgICAgICAgICBSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiAnIyMgb3JpZ2luYWwgcmVxdWVzdCB0ZW1wbGF0ZScsXG4gICAgICAgICAgICAgICAgUmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6ICcjIyBuZXcgcmVzcG9uc2UgdGVtcGxhdGUnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICduZXctcGF0aCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gV0hFTlxuICAgICAgY29uc3QgZGVwbG95U3RhY2tSZXN1bHQgPSBhd2FpdCBob3Rzd2FwTW9ja1Nka1Byb3ZpZGVyLnRyeUhvdHN3YXBEZXBsb3ltZW50KGhvdHN3YXBNb2RlLCBjZGtTdGFja0FydGlmYWN0KTtcblxuICAgICAgLy8gVEhFTlxuICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0KS5ub3QudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS50b0hhdmVSZWNlaXZlZENvbW1hbmRXaXRoKFVwZGF0ZUZ1bmN0aW9uQ29tbWFuZCwge1xuICAgICAgICBhcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgZGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgZnVuY3Rpb25JZDogJ2Z1bmN0aW9uSWQnLFxuICAgICAgICBmdW5jdGlvblZlcnNpb246ICcyMDE4LTA1LTI5JyxcbiAgICAgICAgbmFtZTogJ215LWZ1bmN0aW9uJyxcbiAgICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlcXVlc3QgdGVtcGxhdGUnLFxuICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogJyMjIG5ldyByZXNwb25zZSB0ZW1wbGF0ZScsXG4gICAgICB9KTtcbiAgICB9LFxuICApO1xuXG4gIHNpbGVudFRlc3QoXG4gICAgJ2NhbGxzIHRoZSB1cGRhdGVGdW5jdGlvbigpIEFQSSB3aXRoIHJ1bnRpbWUgd2hlbiBpdCByZWNlaXZlcyBib3RoIGZ1bmN0aW9uIHZlcnNpb24gYW5kIHJ1bnRpbWUgd2l0aCBjb2RlIGluIGEgRnVuY3Rpb24nLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEdJVkVOXG4gICAgICBtb2NrQXBwU3luY0NsaWVudFxuICAgICAgICAub24oTGlzdEZ1bmN0aW9uc0NvbW1hbmQpXG4gICAgICAgIC5yZXNvbHZlcyh7IGZ1bmN0aW9uczogW3sgbmFtZTogJ215LWZ1bmN0aW9uJywgZnVuY3Rpb25JZDogJ2Z1bmN0aW9uSWQnIH1dIH0pO1xuXG4gICAgICBzZXR1cC5zZXRDdXJyZW50Q2ZuU3RhY2tUZW1wbGF0ZSh7XG4gICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgIEFwcFN5bmNGdW5jdGlvbjoge1xuICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6RnVuY3Rpb25Db25maWd1cmF0aW9uJyxcbiAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgTmFtZTogJ215LWZ1bmN0aW9uJyxcbiAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgIERhdGFTb3VyY2VOYW1lOiAnbXktZGF0YXNvdXJjZScsXG4gICAgICAgICAgICAgIEZ1bmN0aW9uVmVyc2lvbjogJzIwMTgtMDUtMjknLFxuICAgICAgICAgICAgICBSdW50aW1lOiAnQVBQU1lOQ19KUycsXG4gICAgICAgICAgICAgIENvZGU6ICdvbGQgdGVzdCBjb2RlJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAnYXdzOmFzc2V0OnBhdGgnOiAnb2xkLXBhdGgnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBjb25zdCBjZGtTdGFja0FydGlmYWN0ID0gc2V0dXAuY2RrU3RhY2tBcnRpZmFjdE9mKHtcbiAgICAgICAgdGVtcGxhdGU6IHtcbiAgICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICAgIEFwcFN5bmNGdW5jdGlvbjoge1xuICAgICAgICAgICAgICBUeXBlOiAnQVdTOjpBcHBTeW5jOjpGdW5jdGlvbkNvbmZpZ3VyYXRpb24nLFxuICAgICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgTmFtZTogJ215LWZ1bmN0aW9uJyxcbiAgICAgICAgICAgICAgICBBcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgICAgICAgICBEYXRhU291cmNlTmFtZTogJ215LWRhdGFzb3VyY2UnLFxuICAgICAgICAgICAgICAgIEZ1bmN0aW9uVmVyc2lvbjogJzIwMTgtMDUtMjknLFxuICAgICAgICAgICAgICAgIFJ1bnRpbWU6ICdBUFBTWU5DX0pTJyxcbiAgICAgICAgICAgICAgICBDb2RlOiAnbmV3IHRlc3QgY29kZScsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIE1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ25ldy1wYXRoJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBXSEVOXG4gICAgICBjb25zdCBkZXBsb3lTdGFja1Jlc3VsdCA9IGF3YWl0IGhvdHN3YXBNb2NrU2RrUHJvdmlkZXIudHJ5SG90c3dhcERlcGxveW1lbnQoaG90c3dhcE1vZGUsIGNka1N0YWNrQXJ0aWZhY3QpO1xuXG4gICAgICAvLyBUSEVOXG4gICAgICBleHBlY3QoZGVwbG95U3RhY2tSZXN1bHQpLm5vdC50b0JlVW5kZWZpbmVkKCk7XG4gICAgICBleHBlY3QobW9ja0FwcFN5bmNDbGllbnQpLnRvSGF2ZVJlY2VpdmVkQ29tbWFuZFdpdGgoVXBkYXRlRnVuY3Rpb25Db21tYW5kLCB7XG4gICAgICAgIGFwaUlkOiAnYXBpSWQnLFxuICAgICAgICBkYXRhU291cmNlTmFtZTogJ215LWRhdGFzb3VyY2UnLFxuICAgICAgICBmdW5jdGlvbklkOiAnZnVuY3Rpb25JZCcsXG4gICAgICAgIHJ1bnRpbWU6ICdBUFBTWU5DX0pTJyxcbiAgICAgICAgbmFtZTogJ215LWZ1bmN0aW9uJyxcbiAgICAgICAgY29kZTogJ25ldyB0ZXN0IGNvZGUnLFxuICAgICAgfSk7XG4gICAgfSxcbiAgKTtcblxuICBzaWxlbnRUZXN0KFxuICAgICdjYWxscyB0aGUgdXBkYXRlRnVuY3Rpb24oKSBBUEkgd2hlbiBpdCByZWNlaXZlcyBvbmx5IGEgbWFwcGluZyB0ZW1wbGF0ZSBzMyBsb2NhdGlvbiBkaWZmZXJlbmNlIGluIGEgRnVuY3Rpb24nLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEdJVkVOXG4gICAgICBtb2NrUzNDbGllbnQub24oR2V0T2JqZWN0Q29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBCb2R5OiBnZXRCb2R5U3RyZWFtKCd0ZW1wbGF0ZSBkZWZpbmVkIGluIHMzJyksXG4gICAgICB9KTtcbiAgICAgIG1vY2tBcHBTeW5jQ2xpZW50XG4gICAgICAgIC5vbihMaXN0RnVuY3Rpb25zQ29tbWFuZClcbiAgICAgICAgLnJlc29sdmVzKHsgZnVuY3Rpb25zOiBbeyBuYW1lOiAnbXktZnVuY3Rpb24nLCBmdW5jdGlvbklkOiAnZnVuY3Rpb25JZCcgfV0gfSk7XG5cbiAgICAgIHNldHVwLnNldEN1cnJlbnRDZm5TdGFja1RlbXBsYXRlKHtcbiAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgQXBwU3luY0Z1bmN0aW9uOiB7XG4gICAgICAgICAgICBUeXBlOiAnQVdTOjpBcHBTeW5jOjpGdW5jdGlvbkNvbmZpZ3VyYXRpb24nLFxuICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICBOYW1lOiAnbXktZnVuY3Rpb24nLFxuICAgICAgICAgICAgICBBcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgICAgRnVuY3Rpb25WZXJzaW9uOiAnMjAxOC0wNS0yOScsXG4gICAgICAgICAgICAgIFJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6ICcjIyBvcmlnaW5hbCByZXF1ZXN0IHRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgUmVzcG9uc2VNYXBwaW5nVGVtcGxhdGVTM0xvY2F0aW9uOiAnczM6Ly90ZXN0LWJ1Y2tldC9vbGRfbG9jYXRpb24nLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIE1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICdvbGQtcGF0aCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGNka1N0YWNrQXJ0aWZhY3QgPSBzZXR1cC5jZGtTdGFja0FydGlmYWN0T2Yoe1xuICAgICAgICB0ZW1wbGF0ZToge1xuICAgICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgICAgQXBwU3luY0Z1bmN0aW9uOiB7XG4gICAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6OkZ1bmN0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICBOYW1lOiAnbXktZnVuY3Rpb24nLFxuICAgICAgICAgICAgICAgIEFwaUlkOiAnYXBpSWQnLFxuICAgICAgICAgICAgICAgIERhdGFTb3VyY2VOYW1lOiAnbXktZGF0YXNvdXJjZScsXG4gICAgICAgICAgICAgICAgRnVuY3Rpb25WZXJzaW9uOiAnMjAxOC0wNS0yOScsXG4gICAgICAgICAgICAgICAgUmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlcXVlc3QgdGVtcGxhdGUnLFxuICAgICAgICAgICAgICAgIFJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlUzNMb2NhdGlvbjogJ3MzOi8vdGVzdC1idWNrZXQvcGF0aC90by9rZXknLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICduZXctcGF0aCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gV0hFTlxuICAgICAgY29uc3QgZGVwbG95U3RhY2tSZXN1bHQgPSBhd2FpdCBob3Rzd2FwTW9ja1Nka1Byb3ZpZGVyLnRyeUhvdHN3YXBEZXBsb3ltZW50KGhvdHN3YXBNb2RlLCBjZGtTdGFja0FydGlmYWN0KTtcblxuICAgICAgLy8gVEhFTlxuICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0KS5ub3QudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS50b0hhdmVSZWNlaXZlZENvbW1hbmRXaXRoKFVwZGF0ZUZ1bmN0aW9uQ29tbWFuZCwge1xuICAgICAgICBhcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgZGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgZnVuY3Rpb25JZDogJ2Z1bmN0aW9uSWQnLFxuICAgICAgICBmdW5jdGlvblZlcnNpb246ICcyMDE4LTA1LTI5JyxcbiAgICAgICAgbmFtZTogJ215LWZ1bmN0aW9uJyxcbiAgICAgICAgcmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogJyMjIG9yaWdpbmFsIHJlcXVlc3QgdGVtcGxhdGUnLFxuICAgICAgICByZXNwb25zZU1hcHBpbmdUZW1wbGF0ZTogJ3RlbXBsYXRlIGRlZmluZWQgaW4gczMnLFxuICAgICAgfSk7XG4gICAgICBleHBlY3QobW9ja1MzQ2xpZW50KS50b0hhdmVSZWNlaXZlZENvbW1hbmRXaXRoKEdldE9iamVjdENvbW1hbmQsIHtcbiAgICAgICAgQnVja2V0OiAndGVzdC1idWNrZXQnLFxuICAgICAgICBLZXk6ICdwYXRoL3RvL2tleScsXG4gICAgICB9KTtcbiAgICB9LFxuICApO1xuXG4gIHNpbGVudFRlc3QoXG4gICAgYHdoZW4gaXQgcmVjZWl2ZXMgYSBjaGFuZ2UgdGhhdCBpcyBub3QgYSBtYXBwaW5nIHRlbXBsYXRlIGRpZmZlcmVuY2UgaW4gYSBGdW5jdGlvbiwgaXQgZG9lcyBub3QgY2FsbCB0aGUgdXBkYXRlRnVuY3Rpb24oKSBBUEkgaW4gQ0xBU1NJQyBtb2RlXG4gICAgICAgIGJ1dCBkb2VzIGluIEhPVFNXQVBfT05MWSBtb2RlYCxcbiAgICBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBHSVZFTlxuICAgICAgbW9ja0FwcFN5bmNDbGllbnRcbiAgICAgICAgLm9uKExpc3RGdW5jdGlvbnNDb21tYW5kKVxuICAgICAgICAucmVzb2x2ZXMoeyBmdW5jdGlvbnM6IFt7IG5hbWU6ICdteS1mdW5jdGlvbicsIGZ1bmN0aW9uSWQ6ICdmdW5jdGlvbklkJyB9XSB9KTtcblxuICAgICAgc2V0dXAuc2V0Q3VycmVudENmblN0YWNrVGVtcGxhdGUoe1xuICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICBBcHBTeW5jRnVuY3Rpb246IHtcbiAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6OkZ1bmN0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIFJlcXVlc3RNYXBwaW5nVGVtcGxhdGU6ICcjIyBvcmlnaW5hbCByZXF1ZXN0IHRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgUmVzcG9uc2VNYXBwaW5nVGVtcGxhdGU6ICcjIyBvcmlnaW5hbCByZXNwb25zZSB0ZW1wbGF0ZScsXG4gICAgICAgICAgICAgIE5hbWU6ICdteS1mdW5jdGlvbicsXG4gICAgICAgICAgICAgIEFwaUlkOiAnYXBpSWQnLFxuICAgICAgICAgICAgICBEYXRhU291cmNlTmFtZTogJ215LWRhdGFzb3VyY2UnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIE1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICdvbGQtcGF0aCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGNka1N0YWNrQXJ0aWZhY3QgPSBzZXR1cC5jZGtTdGFja0FydGlmYWN0T2Yoe1xuICAgICAgICB0ZW1wbGF0ZToge1xuICAgICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgICAgQXBwU3luY0Z1bmN0aW9uOiB7XG4gICAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6OkZ1bmN0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICBSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiAnIyMgbmV3IHJlcXVlc3QgdGVtcGxhdGUnLFxuICAgICAgICAgICAgICAgIFJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiAnIyMgb3JpZ2luYWwgcmVzcG9uc2UgdGVtcGxhdGUnLFxuICAgICAgICAgICAgICAgIEFwaUlkOiAnYXBpSWQnLFxuICAgICAgICAgICAgICAgIE5hbWU6ICdteS1mdW5jdGlvbicsXG4gICAgICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICduZXctZGF0YXNvdXJjZScsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gV0hFTlxuICAgICAgY29uc3QgZGVwbG95U3RhY2tSZXN1bHQgPSBhd2FpdCBob3Rzd2FwTW9ja1Nka1Byb3ZpZGVyLnRyeUhvdHN3YXBEZXBsb3ltZW50KGhvdHN3YXBNb2RlLCBjZGtTdGFja0FydGlmYWN0KTtcblxuICAgICAgLy8gVEhFTlxuICAgICAgaWYgKGhvdHN3YXBNb2RlID09PSBIb3Rzd2FwTW9kZS5GQUxMX0JBQ0spIHtcbiAgICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0KS50b0JlVW5kZWZpbmVkKCk7XG4gICAgICB9IGVsc2UgaWYgKGhvdHN3YXBNb2RlID09PSBIb3Rzd2FwTW9kZS5IT1RTV0FQX09OTFkpIHtcbiAgICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0KS5ub3QudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgICBleHBlY3QobW9ja0FwcFN5bmNDbGllbnQpLnRvSGF2ZVJlY2VpdmVkQ29tbWFuZFdpdGgoVXBkYXRlRnVuY3Rpb25Db21tYW5kLCB7XG4gICAgICAgICAgYXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgZGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICBmdW5jdGlvbklkOiAnZnVuY3Rpb25JZCcsXG4gICAgICAgICAgbmFtZTogJ215LWZ1bmN0aW9uJyxcbiAgICAgICAgICByZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiAnIyMgbmV3IHJlcXVlc3QgdGVtcGxhdGUnLFxuICAgICAgICAgIHJlc3BvbnNlTWFwcGluZ1RlbXBsYXRlOiAnIyMgb3JpZ2luYWwgcmVzcG9uc2UgdGVtcGxhdGUnLFxuICAgICAgICB9KTtcbiAgICAgICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS5ub3QudG9IYXZlUmVjZWl2ZWRDb21tYW5kKFVwZGF0ZVJlc29sdmVyQ29tbWFuZCk7XG4gICAgICB9XG4gICAgfSxcbiAgKTtcblxuICBzaWxlbnRUZXN0KFxuICAgICdkb2VzIG5vdCBjYWxsIHRoZSB1cGRhdGVGdW5jdGlvbigpIEFQSSB3aGVuIGEgcmVzb3VyY2Ugd2l0aCB0eXBlIHRoYXQgaXMgbm90IEFXUzo6QXBwU3luYzo6RnVuY3Rpb25Db25maWd1cmF0aW9uIGJ1dCBoYXMgdGhlIHNhbWUgcHJvcGVydGllcyBpcyBjaGFuZ2VkJyxcbiAgICBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBHSVZFTlxuICAgICAgc2V0dXAuc2V0Q3VycmVudENmblN0YWNrVGVtcGxhdGUoe1xuICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICBBcHBTeW5jRnVuY3Rpb246IHtcbiAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6Ok5vdEFGdW5jdGlvbkNvbmZpZ3VyYXRpb24nLFxuICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICBSZXF1ZXN0TWFwcGluZ1RlbXBsYXRlOiAnIyMgb3JpZ2luYWwgdGVtcGxhdGUnLFxuICAgICAgICAgICAgICBOYW1lOiAnbXktZnVuY3Rpb24nLFxuICAgICAgICAgICAgICBEYXRhU291cmNlTmFtZTogJ215LWRhdGFzb3VyY2UnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIE1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICdvbGQtcGF0aCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGNka1N0YWNrQXJ0aWZhY3QgPSBzZXR1cC5jZGtTdGFja0FydGlmYWN0T2Yoe1xuICAgICAgICB0ZW1wbGF0ZToge1xuICAgICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgICAgQXBwU3luY0Z1bmN0aW9uOiB7XG4gICAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6Ok5vdEFGdW5jdGlvbkNvbmZpZ3VyYXRpb24nLFxuICAgICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgUmVxdWVzdE1hcHBpbmdUZW1wbGF0ZTogJyMjIG5ldyB0ZW1wbGF0ZScsXG4gICAgICAgICAgICAgICAgTmFtZTogJ215LXJlc29sdmVyJyxcbiAgICAgICAgICAgICAgICBEYXRhU291cmNlTmFtZTogJ215LWRhdGFzb3VyY2UnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFdIRU5cbiAgICAgIGNvbnN0IGRlcGxveVN0YWNrUmVzdWx0ID0gYXdhaXQgaG90c3dhcE1vY2tTZGtQcm92aWRlci50cnlIb3Rzd2FwRGVwbG95bWVudChob3Rzd2FwTW9kZSwgY2RrU3RhY2tBcnRpZmFjdCk7XG5cbiAgICAgIC8vIFRIRU5cbiAgICAgIGlmIChob3Rzd2FwTW9kZSA9PT0gSG90c3dhcE1vZGUuRkFMTF9CQUNLKSB7XG4gICAgICAgIGV4cGVjdChkZXBsb3lTdGFja1Jlc3VsdCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgfSBlbHNlIGlmIChob3Rzd2FwTW9kZSA9PT0gSG90c3dhcE1vZGUuSE9UU1dBUF9PTkxZKSB7XG4gICAgICAgIGV4cGVjdChkZXBsb3lTdGFja1Jlc3VsdCkubm90LnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0Py5ub09wKS50b0VxdWFsKHRydWUpO1xuICAgICAgfVxuXG4gICAgICBleHBlY3QobW9ja0FwcFN5bmNDbGllbnQpLm5vdC50b0hhdmVSZWNlaXZlZENvbW1hbmQoVXBkYXRlRnVuY3Rpb25Db21tYW5kKTtcbiAgICAgIGV4cGVjdChtb2NrQXBwU3luY0NsaWVudCkubm90LnRvSGF2ZVJlY2VpdmVkQ29tbWFuZChVcGRhdGVSZXNvbHZlckNvbW1hbmQpO1xuICAgIH0sXG4gICk7XG5cbiAgc2lsZW50VGVzdChcbiAgICAnY2FsbHMgdGhlIHN0YXJ0U2NoZW1hQ3JlYXRpb24oKSBBUEkgd2hlbiBpdCByZWNlaXZlcyBvbmx5IGEgZGVmaW5pdGlvbiBkaWZmZXJlbmNlIGluIGEgZ3JhcGhxbCBzY2hlbWEnLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEdJVkVOXG4gICAgICBtb2NrQXBwU3luY0NsaWVudC5vbihTdGFydFNjaGVtYUNyZWF0aW9uQ29tbWFuZCkucmVzb2x2ZXNPbmNlKHtcbiAgICAgICAgc3RhdHVzOiAnU1VDQ0VTUycsXG4gICAgICB9KTtcblxuICAgICAgc2V0dXAuc2V0Q3VycmVudENmblN0YWNrVGVtcGxhdGUoe1xuICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICBBcHBTeW5jR3JhcGhRTFNjaGVtYToge1xuICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6R3JhcGhRTFNjaGVtYScsXG4gICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIEFwaUlkOiAnYXBpSWQnLFxuICAgICAgICAgICAgICBEZWZpbml0aW9uOiAnb3JpZ2luYWwgZ3JhcGhxbFNjaGVtYScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ29sZC1wYXRoJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgc2V0dXAucHVzaFN0YWNrUmVzb3VyY2VTdW1tYXJpZXMoXG4gICAgICAgIHNldHVwLnN0YWNrU3VtbWFyeU9mKFxuICAgICAgICAgICdBcHBTeW5jR3JhcGhRTFNjaGVtYScsXG4gICAgICAgICAgJ0FXUzo6QXBwU3luYzo6R3JhcGhRTFNjaGVtYScsXG4gICAgICAgICAgJ2Fybjphd3M6YXBwc3luYzp1cy1lYXN0LTE6MTExMTExMTExMTExOmFwaXMvYXBpSWQvc2NoZW1hL215LXNjaGVtYScsXG4gICAgICAgICksXG4gICAgICApO1xuICAgICAgY29uc3QgY2RrU3RhY2tBcnRpZmFjdCA9IHNldHVwLmNka1N0YWNrQXJ0aWZhY3RPZih7XG4gICAgICAgIHRlbXBsYXRlOiB7XG4gICAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgICBBcHBTeW5jR3JhcGhRTFNjaGVtYToge1xuICAgICAgICAgICAgICBUeXBlOiAnQVdTOjpBcHBTeW5jOjpHcmFwaFFMU2NoZW1hJyxcbiAgICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgIEFwaUlkOiAnYXBpSWQnLFxuICAgICAgICAgICAgICAgIERlZmluaXRpb246ICduZXcgZ3JhcGhxbFNjaGVtYScsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIE1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ25ldy1wYXRoJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBXSEVOXG4gICAgICBjb25zdCBkZXBsb3lTdGFja1Jlc3VsdCA9IGF3YWl0IGhvdHN3YXBNb2NrU2RrUHJvdmlkZXIudHJ5SG90c3dhcERlcGxveW1lbnQoaG90c3dhcE1vZGUsIGNka1N0YWNrQXJ0aWZhY3QpO1xuXG4gICAgICAvLyBUSEVOXG4gICAgICBleHBlY3QoZGVwbG95U3RhY2tSZXN1bHQpLm5vdC50b0JlVW5kZWZpbmVkKCk7XG4gICAgICBleHBlY3QobW9ja0FwcFN5bmNDbGllbnQpLnRvSGF2ZVJlY2VpdmVkQ29tbWFuZFdpdGgoU3RhcnRTY2hlbWFDcmVhdGlvbkNvbW1hbmQsIHtcbiAgICAgICAgYXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgIGRlZmluaXRpb246ICduZXcgZ3JhcGhxbFNjaGVtYScsXG4gICAgICB9KTtcbiAgICB9LFxuICApO1xuXG4gIHNpbGVudFRlc3QoJ2NhbGxzIHRoZSB1cGRhdGVGdW5jdGlvbigpIEFQSSB3aXRoIGZ1bmN0aW9uSWQgd2hlbiBmdW5jdGlvbiBpcyBsaXN0ZWQgb24gc2Vjb25kIHBhZ2UnLCBhc3luYyAoKSA9PiB7XG4gICAgLy8gR0lWRU5cbiAgICBtb2NrQXBwU3luY0NsaWVudFxuICAgICAgLm9uKExpc3RGdW5jdGlvbnNDb21tYW5kKVxuICAgICAgLnJlc29sdmVzT25jZSh7XG4gICAgICAgIGZ1bmN0aW9uczogW3sgbmFtZTogJ290aGVyLWZ1bmN0aW9uJywgZnVuY3Rpb25JZDogJ290aGVyLWZ1bmN0aW9uSWQnIH1dLFxuICAgICAgICBuZXh0VG9rZW46ICduZXh0VG9rZW4nLFxuICAgICAgfSlcbiAgICAgIC5yZXNvbHZlc09uY2Uoe1xuICAgICAgICBmdW5jdGlvbnM6IFt7IG5hbWU6ICdteS1mdW5jdGlvbicsIGZ1bmN0aW9uSWQ6ICdmdW5jdGlvbklkJyB9XSxcbiAgICAgIH0pO1xuXG4gICAgc2V0dXAuc2V0Q3VycmVudENmblN0YWNrVGVtcGxhdGUoe1xuICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgIEFwcFN5bmNGdW5jdGlvbjoge1xuICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6OkZ1bmN0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgTmFtZTogJ215LWZ1bmN0aW9uJyxcbiAgICAgICAgICAgIEFwaUlkOiAnYXBpSWQnLFxuICAgICAgICAgICAgRGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgICAgICAgIEZ1bmN0aW9uVmVyc2lvbjogJzIwMTgtMDUtMjknLFxuICAgICAgICAgICAgUnVudGltZTogJ0FQUFNZTkNfSlMnLFxuICAgICAgICAgICAgQ29kZTogJ29sZCB0ZXN0IGNvZGUnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICdvbGQtcGF0aCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgY29uc3QgY2RrU3RhY2tBcnRpZmFjdCA9IHNldHVwLmNka1N0YWNrQXJ0aWZhY3RPZih7XG4gICAgICB0ZW1wbGF0ZToge1xuICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICBBcHBTeW5jRnVuY3Rpb246IHtcbiAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6OkZ1bmN0aW9uQ29uZmlndXJhdGlvbicsXG4gICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIE5hbWU6ICdteS1mdW5jdGlvbicsXG4gICAgICAgICAgICAgIEFwaUlkOiAnYXBpSWQnLFxuICAgICAgICAgICAgICBEYXRhU291cmNlTmFtZTogJ215LWRhdGFzb3VyY2UnLFxuICAgICAgICAgICAgICBGdW5jdGlvblZlcnNpb246ICcyMDE4LTA1LTI5JyxcbiAgICAgICAgICAgICAgUnVudGltZTogJ0FQUFNZTkNfSlMnLFxuICAgICAgICAgICAgICBDb2RlOiAnbmV3IHRlc3QgY29kZScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ25ldy1wYXRoJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBXSEVOXG4gICAgY29uc3QgZGVwbG95U3RhY2tSZXN1bHQgPSBhd2FpdCBob3Rzd2FwTW9ja1Nka1Byb3ZpZGVyLnRyeUhvdHN3YXBEZXBsb3ltZW50KGhvdHN3YXBNb2RlLCBjZGtTdGFja0FydGlmYWN0KTtcblxuICAgIC8vIFRIRU5cbiAgICBleHBlY3QoZGVwbG95U3RhY2tSZXN1bHQpLm5vdC50b0JlVW5kZWZpbmVkKCk7XG4gICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS50b0hhdmVSZWNlaXZlZENvbW1hbmRUaW1lcyhMaXN0RnVuY3Rpb25zQ29tbWFuZCwgMik7XG4gICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS50b0hhdmVSZWNlaXZlZE50aENvbW1hbmRXaXRoKDEsIExpc3RGdW5jdGlvbnNDb21tYW5kLCB7XG4gICAgICBhcGlJZDogJ2FwaUlkJyxcbiAgICAgIG5leHRUb2tlbjogJ25leHRUb2tlbicsXG4gICAgfSk7XG4gICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS50b0hhdmVSZWNlaXZlZE50aENvbW1hbmRXaXRoKDIsIExpc3RGdW5jdGlvbnNDb21tYW5kLCB7XG4gICAgICBhcGlJZDogJ2FwaUlkJyxcbiAgICB9KTtcblxuICAgIGV4cGVjdChtb2NrQXBwU3luY0NsaWVudCkudG9IYXZlUmVjZWl2ZWRDb21tYW5kV2l0aChVcGRhdGVGdW5jdGlvbkNvbW1hbmQsIHtcbiAgICAgIGFwaUlkOiAnYXBpSWQnLFxuICAgICAgZGF0YVNvdXJjZU5hbWU6ICdteS1kYXRhc291cmNlJyxcbiAgICAgIGZ1bmN0aW9uSWQ6ICdmdW5jdGlvbklkJyxcbiAgICAgIHJ1bnRpbWU6ICdBUFBTWU5DX0pTJyxcbiAgICAgIG5hbWU6ICdteS1mdW5jdGlvbicsXG4gICAgICBjb2RlOiAnbmV3IHRlc3QgY29kZScsXG4gICAgfSk7XG4gIH0pO1xuXG4gIHNpbGVudFRlc3QoXG4gICAgJ2NhbGxzIHRoZSBzdGFydFNjaGVtYUNyZWF0aW9uKCkgQVBJIHdoZW4gaXQgcmVjZWl2ZXMgb25seSBhIGRlZmluaXRpb24gZGlmZmVyZW5jZSBpbiBhIGdyYXBocWwgc2NoZW1hJyxcbiAgICBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBHSVZFTlxuICAgICAgbW9ja0FwcFN5bmNDbGllbnQub24oU3RhcnRTY2hlbWFDcmVhdGlvbkNvbW1hbmQpLnJlc29sdmVzKHsgc3RhdHVzOiAnU1VDQ0VTUycgfSk7XG5cbiAgICAgIHNldHVwLnNldEN1cnJlbnRDZm5TdGFja1RlbXBsYXRlKHtcbiAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgQXBwU3luY0dyYXBoUUxTY2hlbWE6IHtcbiAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6OkdyYXBoUUxTY2hlbWEnLFxuICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICBBcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgICAgICAgRGVmaW5pdGlvbjogJ29yaWdpbmFsIGdyYXBocWxTY2hlbWEnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIE1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICdvbGQtcGF0aCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIHNldHVwLnB1c2hTdGFja1Jlc291cmNlU3VtbWFyaWVzKFxuICAgICAgICBzZXR1cC5zdGFja1N1bW1hcnlPZihcbiAgICAgICAgICAnQXBwU3luY0dyYXBoUUxTY2hlbWEnLFxuICAgICAgICAgICdBV1M6OkFwcFN5bmM6OkdyYXBoUUxTY2hlbWEnLFxuICAgICAgICAgICdhcm46YXdzOmFwcHN5bmM6dXMtZWFzdC0xOjExMTExMTExMTExMTphcGlzL2FwaUlkL3NjaGVtYS9teS1zY2hlbWEnLFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IGNka1N0YWNrQXJ0aWZhY3QgPSBzZXR1cC5jZGtTdGFja0FydGlmYWN0T2Yoe1xuICAgICAgICB0ZW1wbGF0ZToge1xuICAgICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgICAgQXBwU3luY0dyYXBoUUxTY2hlbWE6IHtcbiAgICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6R3JhcGhRTFNjaGVtYScsXG4gICAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICBBcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgICAgICAgICBEZWZpbml0aW9uOiAnbmV3IGdyYXBocWxTY2hlbWEnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICduZXctcGF0aCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gV0hFTlxuICAgICAgY29uc3QgZGVwbG95U3RhY2tSZXN1bHQgPSBhd2FpdCBob3Rzd2FwTW9ja1Nka1Byb3ZpZGVyLnRyeUhvdHN3YXBEZXBsb3ltZW50KGhvdHN3YXBNb2RlLCBjZGtTdGFja0FydGlmYWN0KTtcblxuICAgICAgLy8gVEhFTlxuICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0KS5ub3QudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS50b0hhdmVSZWNlaXZlZENvbW1hbmRXaXRoKFN0YXJ0U2NoZW1hQ3JlYXRpb25Db21tYW5kLCB7XG4gICAgICAgIGFwaUlkOiAnYXBpSWQnLFxuICAgICAgICBkZWZpbml0aW9uOiAnbmV3IGdyYXBocWxTY2hlbWEnLFxuICAgICAgfSk7XG4gICAgfSxcbiAgKTtcbiAgc2lsZW50VGVzdChcbiAgICAnY2FsbHMgdGhlIHN0YXJ0U2NoZW1hQ3JlYXRpb24oKSBBUEkgd2hlbiBpdCByZWNlaXZlcyBvbmx5IGEgZGVmaW5pdGlvbiBzMyBsb2NhdGlvbiBkaWZmZXJlbmNlIGluIGEgZ3JhcGhxbCBzY2hlbWEnLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEdJVkVOXG4gICAgICBtb2NrUzNDbGllbnQub24oR2V0T2JqZWN0Q29tbWFuZCkucmVzb2x2ZXMoe1xuICAgICAgICBCb2R5OiBnZXRCb2R5U3RyZWFtKCdzY2hlbWEgZGVmaW5lZCBpbiBzMycpLFxuICAgICAgfSk7XG4gICAgICBzZXR1cC5zZXRDdXJyZW50Q2ZuU3RhY2tUZW1wbGF0ZSh7XG4gICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgIEFwcFN5bmNHcmFwaFFMU2NoZW1hOiB7XG4gICAgICAgICAgICBUeXBlOiAnQVdTOjpBcHBTeW5jOjpHcmFwaFFMU2NoZW1hJyxcbiAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgIERlZmluaXRpb25TM0xvY2F0aW9uOiAnczM6Ly90ZXN0LWJ1Y2tldC9vbGRfbG9jYXRpb24nLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIE1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICdvbGQtcGF0aCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIHNldHVwLnB1c2hTdGFja1Jlc291cmNlU3VtbWFyaWVzKFxuICAgICAgICBzZXR1cC5zdGFja1N1bW1hcnlPZihcbiAgICAgICAgICAnQXBwU3luY0dyYXBoUUxTY2hlbWEnLFxuICAgICAgICAgICdBV1M6OkFwcFN5bmM6OkdyYXBoUUxTY2hlbWEnLFxuICAgICAgICAgICdhcm46YXdzOmFwcHN5bmM6dXMtZWFzdC0xOjExMTExMTExMTExMTphcGlzL2FwaUlkL3NjaGVtYS9teS1zY2hlbWEnLFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IGNka1N0YWNrQXJ0aWZhY3QgPSBzZXR1cC5jZGtTdGFja0FydGlmYWN0T2Yoe1xuICAgICAgICB0ZW1wbGF0ZToge1xuICAgICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgICAgQXBwU3luY0dyYXBoUUxTY2hlbWE6IHtcbiAgICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6R3JhcGhRTFNjaGVtYScsXG4gICAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgICBBcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgICAgICAgICBEZWZpbml0aW9uUzNMb2NhdGlvbjogJ3MzOi8vdGVzdC1idWNrZXQvcGF0aC90by9rZXknLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICduZXctcGF0aCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gV0hFTlxuICAgICAgY29uc3QgZGVwbG95U3RhY2tSZXN1bHQgPSBhd2FpdCBob3Rzd2FwTW9ja1Nka1Byb3ZpZGVyLnRyeUhvdHN3YXBEZXBsb3ltZW50KGhvdHN3YXBNb2RlLCBjZGtTdGFja0FydGlmYWN0KTtcblxuICAgICAgLy8gVEhFTlxuICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0KS5ub3QudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS50b0hhdmVSZWNlaXZlZENvbW1hbmRXaXRoKFN0YXJ0U2NoZW1hQ3JlYXRpb25Db21tYW5kLCB7XG4gICAgICAgIGFwaUlkOiAnYXBpSWQnLFxuICAgICAgICBkZWZpbml0aW9uOiAnc2NoZW1hIGRlZmluZWQgaW4gczMnLFxuICAgICAgfSk7XG5cbiAgICAgIGV4cGVjdChtb2NrUzNDbGllbnQpLnRvSGF2ZVJlY2VpdmVkQ29tbWFuZFdpdGgoR2V0T2JqZWN0Q29tbWFuZCwge1xuICAgICAgICBCdWNrZXQ6ICd0ZXN0LWJ1Y2tldCcsXG4gICAgICAgIEtleTogJ3BhdGgvdG8va2V5JyxcbiAgICAgIH0pO1xuICAgIH0sXG4gICk7XG5cbiAgc2lsZW50VGVzdChcbiAgICAnZG9lcyBub3QgY2FsbCBzdGFydFNjaGVtYUNyZWF0aW9uKCkgQVBJIHdoZW4gYSByZXNvdXJjZSB3aXRoIHR5cGUgdGhhdCBpcyBub3QgQVdTOjpBcHBTeW5jOjpHcmFwaFFMU2NoZW1hIGJ1dCBoYXMgdGhlIHNhbWUgcHJvcGVydGllcyBpcyBjaGFuZ2UnLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEdJVkVOXG4gICAgICBzZXR1cC5zZXRDdXJyZW50Q2ZuU3RhY2tUZW1wbGF0ZSh7XG4gICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgIEFwcFN5bmNHcmFwaFFMU2NoZW1hOiB7XG4gICAgICAgICAgICBUeXBlOiAnQVdTOjpBcHBTeW5jOjpOb3RHcmFwaFFMU2NoZW1hJyxcbiAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgIERlZmluaXRpb246ICdvcmlnaW5hbCBncmFwaHFsU2NoZW1hJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAnYXdzOmFzc2V0OnBhdGgnOiAnb2xkLXBhdGgnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBzZXR1cC5wdXNoU3RhY2tSZXNvdXJjZVN1bW1hcmllcyhcbiAgICAgICAgc2V0dXAuc3RhY2tTdW1tYXJ5T2YoXG4gICAgICAgICAgJ0FwcFN5bmNHcmFwaFFMU2NoZW1hJyxcbiAgICAgICAgICAnQVdTOjpBcHBTeW5jOjpHcmFwaFFMU2NoZW1hJyxcbiAgICAgICAgICAnYXJuOmF3czphcHBzeW5jOnVzLWVhc3QtMToxMTExMTExMTExMTE6YXBpcy9hcGlJZC9zY2hlbWEvbXktc2NoZW1hJyxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgICBjb25zdCBjZGtTdGFja0FydGlmYWN0ID0gc2V0dXAuY2RrU3RhY2tBcnRpZmFjdE9mKHtcbiAgICAgICAgdGVtcGxhdGU6IHtcbiAgICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICAgIEFwcFN5bmNHcmFwaFFMU2NoZW1hOiB7XG4gICAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6Ok5vdEdyYXBoUUxTY2hlbWEnLFxuICAgICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgICAgRGVmaW5pdGlvbjogJ25ldyBncmFwaHFsU2NoZW1hJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgICAnYXdzOmFzc2V0OnBhdGgnOiAnbmV3LXBhdGgnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFdIRU5cbiAgICAgIGNvbnN0IGRlcGxveVN0YWNrUmVzdWx0ID0gYXdhaXQgaG90c3dhcE1vY2tTZGtQcm92aWRlci50cnlIb3Rzd2FwRGVwbG95bWVudChob3Rzd2FwTW9kZSwgY2RrU3RhY2tBcnRpZmFjdCk7XG5cbiAgICAgIC8vIFRIRU5cbiAgICAgIGlmIChob3Rzd2FwTW9kZSA9PT0gSG90c3dhcE1vZGUuRkFMTF9CQUNLKSB7XG4gICAgICAgIGV4cGVjdChkZXBsb3lTdGFja1Jlc3VsdCkudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgfSBlbHNlIGlmIChob3Rzd2FwTW9kZSA9PT0gSG90c3dhcE1vZGUuSE9UU1dBUF9PTkxZKSB7XG4gICAgICAgIGV4cGVjdChkZXBsb3lTdGFja1Jlc3VsdCkubm90LnRvQmVVbmRlZmluZWQoKTtcbiAgICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0Py5ub09wKS50b0VxdWFsKHRydWUpO1xuICAgICAgfVxuXG4gICAgICBleHBlY3QobW9ja0FwcFN5bmNDbGllbnQpLm5vdC50b0hhdmVSZWNlaXZlZENvbW1hbmQoU3RhcnRTY2hlbWFDcmVhdGlvbkNvbW1hbmQpO1xuICAgIH0sXG4gICk7XG5cbiAgc2lsZW50VGVzdChcbiAgICAnY2FsbHMgdGhlIHN0YXJ0U2NoZW1hQ3JlYXRpb24oKSBhbmQgd2FpdHMgZm9yIHNjaGVtYSBjcmVhdGlvbiB0byBzdGFiaWxpemUgYmVmb3JlIGZpbmlzaGluZycsXG4gICAgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gR0lWRU5cbiAgICAgIG1vY2tBcHBTeW5jQ2xpZW50Lm9uKFN0YXJ0U2NoZW1hQ3JlYXRpb25Db21tYW5kKS5yZXNvbHZlc09uY2UoeyBzdGF0dXM6ICdQUk9DRVNTSU5HJyB9KTtcbiAgICAgIG1vY2tBcHBTeW5jQ2xpZW50Lm9uKEdldFNjaGVtYUNyZWF0aW9uU3RhdHVzQ29tbWFuZCkucmVzb2x2ZXNPbmNlKHsgc3RhdHVzOiAnU1VDQ0VTUycgfSk7XG4gICAgICBzZXR1cC5zZXRDdXJyZW50Q2ZuU3RhY2tUZW1wbGF0ZSh7XG4gICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgIEFwcFN5bmNHcmFwaFFMU2NoZW1hOiB7XG4gICAgICAgICAgICBUeXBlOiAnQVdTOjpBcHBTeW5jOjpHcmFwaFFMU2NoZW1hJyxcbiAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgIERlZmluaXRpb246ICdvcmlnaW5hbCBncmFwaHFsU2NoZW1hJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAnYXdzOmFzc2V0OnBhdGgnOiAnb2xkLXBhdGgnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBzZXR1cC5wdXNoU3RhY2tSZXNvdXJjZVN1bW1hcmllcyhcbiAgICAgICAgc2V0dXAuc3RhY2tTdW1tYXJ5T2YoXG4gICAgICAgICAgJ0FwcFN5bmNHcmFwaFFMU2NoZW1hJyxcbiAgICAgICAgICAnQVdTOjpBcHBTeW5jOjpHcmFwaFFMU2NoZW1hJyxcbiAgICAgICAgICAnYXJuOmF3czphcHBzeW5jOnVzLWVhc3QtMToxMTExMTExMTExMTE6YXBpcy9hcGlJZC9zY2hlbWEvbXktc2NoZW1hJyxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgICBjb25zdCBjZGtTdGFja0FydGlmYWN0ID0gc2V0dXAuY2RrU3RhY2tBcnRpZmFjdE9mKHtcbiAgICAgICAgdGVtcGxhdGU6IHtcbiAgICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICAgIEFwcFN5bmNHcmFwaFFMU2NoZW1hOiB7XG4gICAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6OkdyYXBoUUxTY2hlbWEnLFxuICAgICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgICAgRGVmaW5pdGlvbjogJ25ldyBncmFwaHFsU2NoZW1hJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgICAnYXdzOmFzc2V0OnBhdGgnOiAnbmV3LXBhdGgnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFdIRU5cbiAgICAgIGNvbnN0IGRlcGxveVN0YWNrUmVzdWx0ID0gYXdhaXQgaG90c3dhcE1vY2tTZGtQcm92aWRlci50cnlIb3Rzd2FwRGVwbG95bWVudChob3Rzd2FwTW9kZSwgY2RrU3RhY2tBcnRpZmFjdCk7XG5cbiAgICAgIC8vIFRIRU5cbiAgICAgIGV4cGVjdChkZXBsb3lTdGFja1Jlc3VsdCkubm90LnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChtb2NrQXBwU3luY0NsaWVudCkudG9IYXZlUmVjZWl2ZWRDb21tYW5kV2l0aChTdGFydFNjaGVtYUNyZWF0aW9uQ29tbWFuZCwge1xuICAgICAgICBhcGlJZDogJ2FwaUlkJyxcbiAgICAgICAgZGVmaW5pdGlvbjogJ25ldyBncmFwaHFsU2NoZW1hJyxcbiAgICAgIH0pO1xuICAgICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS50b0hhdmVSZWNlaXZlZENvbW1hbmRXaXRoKEdldFNjaGVtYUNyZWF0aW9uU3RhdHVzQ29tbWFuZCwge1xuICAgICAgICBhcGlJZDogJ2FwaUlkJyxcbiAgICAgIH0pO1xuICAgIH0sXG4gICk7XG5cbiAgc2lsZW50VGVzdCgnY2FsbHMgdGhlIHN0YXJ0U2NoZW1hQ3JlYXRpb24oKSBhbmQgdGhyb3dzIGlmIHNjaGVtYSBjcmVhdGlvbiBmYWlscycsIGFzeW5jICgpID0+IHtcbiAgICAvLyBHSVZFTlxuICAgIG1vY2tBcHBTeW5jQ2xpZW50Lm9uKFN0YXJ0U2NoZW1hQ3JlYXRpb25Db21tYW5kKS5yZXNvbHZlc09uY2UoeyBzdGF0dXM6ICdQUk9DRVNTSU5HJyB9KTtcbiAgICBtb2NrQXBwU3luY0NsaWVudC5vbihHZXRTY2hlbWFDcmVhdGlvblN0YXR1c0NvbW1hbmQpLnJlc29sdmVzT25jZSh7IHN0YXR1czogJ0ZBSUxFRCcsIGRldGFpbHM6ICdpbnZhbGlkIHNjaGVtYScgfSk7XG4gICAgc2V0dXAuc2V0Q3VycmVudENmblN0YWNrVGVtcGxhdGUoe1xuICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgIEFwcFN5bmNHcmFwaFFMU2NoZW1hOiB7XG4gICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6R3JhcGhRTFNjaGVtYScsXG4gICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICBEZWZpbml0aW9uOiAnb3JpZ2luYWwgZ3JhcGhxbFNjaGVtYScsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgJ2F3czphc3NldDpwYXRoJzogJ29sZC1wYXRoJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBzZXR1cC5wdXNoU3RhY2tSZXNvdXJjZVN1bW1hcmllcyhcbiAgICAgIHNldHVwLnN0YWNrU3VtbWFyeU9mKFxuICAgICAgICAnQXBwU3luY0dyYXBoUUxTY2hlbWEnLFxuICAgICAgICAnQVdTOjpBcHBTeW5jOjpHcmFwaFFMU2NoZW1hJyxcbiAgICAgICAgJ2Fybjphd3M6YXBwc3luYzp1cy1lYXN0LTE6MTExMTExMTExMTExOmFwaXMvYXBpSWQvc2NoZW1hL215LXNjaGVtYScsXG4gICAgICApLFxuICAgICk7XG4gICAgY29uc3QgY2RrU3RhY2tBcnRpZmFjdCA9IHNldHVwLmNka1N0YWNrQXJ0aWZhY3RPZih7XG4gICAgICB0ZW1wbGF0ZToge1xuICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICBBcHBTeW5jR3JhcGhRTFNjaGVtYToge1xuICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6R3JhcGhRTFNjaGVtYScsXG4gICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIEFwaUlkOiAnYXBpSWQnLFxuICAgICAgICAgICAgICBEZWZpbml0aW9uOiAnbmV3IGdyYXBocWxTY2hlbWEnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIE1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICduZXctcGF0aCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gV0hFTlxuICAgIGF3YWl0IGV4cGVjdCgoKSA9PiBob3Rzd2FwTW9ja1Nka1Byb3ZpZGVyLnRyeUhvdHN3YXBEZXBsb3ltZW50KGhvdHN3YXBNb2RlLCBjZGtTdGFja0FydGlmYWN0KSkucmVqZWN0cy50b1Rocm93KFxuICAgICAgJ2ludmFsaWQgc2NoZW1hJyxcbiAgICApO1xuXG4gICAgLy8gVEhFTlxuICAgIGV4cGVjdChtb2NrQXBwU3luY0NsaWVudCkudG9IYXZlUmVjZWl2ZWRDb21tYW5kV2l0aChTdGFydFNjaGVtYUNyZWF0aW9uQ29tbWFuZCwge1xuICAgICAgYXBpSWQ6ICdhcGlJZCcsXG4gICAgICBkZWZpbml0aW9uOiAnbmV3IGdyYXBocWxTY2hlbWEnLFxuICAgIH0pO1xuICAgIGV4cGVjdChtb2NrQXBwU3luY0NsaWVudCkudG9IYXZlUmVjZWl2ZWRDb21tYW5kV2l0aChHZXRTY2hlbWFDcmVhdGlvblN0YXR1c0NvbW1hbmQsIHtcbiAgICAgIGFwaUlkOiAnYXBpSWQnLFxuICAgIH0pO1xuICB9KTtcblxuICBzaWxlbnRUZXN0KFxuICAgICdjYWxscyB0aGUgdXBkYXRlQXBpS2V5KCkgQVBJIHdoZW4gaXQgcmVjZWl2ZXMgb25seSBhIGV4cGlyZXMgcHJvcGVydHkgZGlmZmVyZW5jZSBpbiBhbiBBcHBTeW5jIEFwaUtleScsXG4gICAgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gR0lWRU5cbiAgICAgIHNldHVwLnNldEN1cnJlbnRDZm5TdGFja1RlbXBsYXRlKHtcbiAgICAgICAgUmVzb3VyY2VzOiB7XG4gICAgICAgICAgQXBwU3luY0FwaUtleToge1xuICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6QXBpS2V5JyxcbiAgICAgICAgICAgIFByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgIEV4cGlyZXM6IDEwMDAsXG4gICAgICAgICAgICAgIElkOiAna2V5LWlkJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAnYXdzOmFzc2V0OnBhdGgnOiAnb2xkLXBhdGgnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICBzZXR1cC5wdXNoU3RhY2tSZXNvdXJjZVN1bW1hcmllcyhcbiAgICAgICAgc2V0dXAuc3RhY2tTdW1tYXJ5T2YoXG4gICAgICAgICAgJ0FwcFN5bmNBcGlLZXknLFxuICAgICAgICAgICdBV1M6OkFwcFN5bmM6OkFwaUtleScsXG4gICAgICAgICAgJ2Fybjphd3M6YXBwc3luYzp1cy1lYXN0LTE6MTExMTExMTExMTExOmFwaXMvYXBpSWQvYXBpa2V5cy9hcGkta2V5LWlkJyxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgICBjb25zdCBjZGtTdGFja0FydGlmYWN0ID0gc2V0dXAuY2RrU3RhY2tBcnRpZmFjdE9mKHtcbiAgICAgICAgdGVtcGxhdGU6IHtcbiAgICAgICAgICBSZXNvdXJjZXM6IHtcbiAgICAgICAgICAgIEFwcFN5bmNBcGlLZXk6IHtcbiAgICAgICAgICAgICAgVHlwZTogJ0FXUzo6QXBwU3luYzo6QXBpS2V5JyxcbiAgICAgICAgICAgICAgUHJvcGVydGllczoge1xuICAgICAgICAgICAgICAgIEFwaUlkOiAnYXBpSWQnLFxuICAgICAgICAgICAgICAgIEV4cGlyZXM6IDEwMDEsXG4gICAgICAgICAgICAgICAgSWQ6ICdrZXktaWQnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBNZXRhZGF0YToge1xuICAgICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICduZXctcGF0aCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gV0hFTlxuICAgICAgY29uc3QgZGVwbG95U3RhY2tSZXN1bHQgPSBhd2FpdCBob3Rzd2FwTW9ja1Nka1Byb3ZpZGVyLnRyeUhvdHN3YXBEZXBsb3ltZW50KGhvdHN3YXBNb2RlLCBjZGtTdGFja0FydGlmYWN0KTtcblxuICAgICAgLy8gVEhFTlxuICAgICAgZXhwZWN0KGRlcGxveVN0YWNrUmVzdWx0KS5ub3QudG9CZVVuZGVmaW5lZCgpO1xuICAgICAgZXhwZWN0KG1vY2tBcHBTeW5jQ2xpZW50KS50b0hhdmVSZWNlaXZlZENvbW1hbmRXaXRoKFVwZGF0ZUFwaUtleUNvbW1hbmQsIHtcbiAgICAgICAgYXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgIGV4cGlyZXM6IDEwMDEsXG4gICAgICAgIGlkOiAna2V5LWlkJyxcbiAgICAgIH0pO1xuICAgIH0sXG4gICk7XG5cbiAgc2lsZW50VGVzdChcbiAgICAnY2FsbHMgdGhlIHVwZGF0ZUFwaUtleSgpIEFQSSB3aGVuIGl0IHJlY2VpdmVzIG9ubHkgYSBleHBpcmVzIHByb3BlcnR5IGRpZmZlcmVuY2UgYW5kIG5vIGFwaS1rZXktaWQgaW4gYW4gQXBwU3luYyBBcGlLZXknLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIEdJVkVOXG4gICAgICBzZXR1cC5zZXRDdXJyZW50Q2ZuU3RhY2tUZW1wbGF0ZSh7XG4gICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgIEFwcFN5bmNBcGlLZXk6IHtcbiAgICAgICAgICAgIFR5cGU6ICdBV1M6OkFwcFN5bmM6OkFwaUtleScsXG4gICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgIEFwaUlkOiAnYXBpSWQnLFxuICAgICAgICAgICAgICBFeHBpcmVzOiAxMDAwLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIE1ldGFkYXRhOiB7XG4gICAgICAgICAgICAgICdhd3M6YXNzZXQ6cGF0aCc6ICdvbGQtcGF0aCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIHNldHVwLnB1c2hTdGFja1Jlc291cmNlU3VtbWFyaWVzKFxuICAgICAgICBzZXR1cC5zdGFja1N1bW1hcnlPZihcbiAgICAgICAgICAnQXBwU3luY0FwaUtleScsXG4gICAgICAgICAgJ0FXUzo6QXBwU3luYzo6QXBpS2V5JyxcbiAgICAgICAgICAnYXJuOmF3czphcHBzeW5jOnVzLWVhc3QtMToxMTExMTExMTExMTE6YXBpcy9hcGlJZC9hcGlrZXlzL2FwaS1rZXktaWQnLFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IGNka1N0YWNrQXJ0aWZhY3QgPSBzZXR1cC5jZGtTdGFja0FydGlmYWN0T2Yoe1xuICAgICAgICB0ZW1wbGF0ZToge1xuICAgICAgICAgIFJlc291cmNlczoge1xuICAgICAgICAgICAgQXBwU3luY0FwaUtleToge1xuICAgICAgICAgICAgICBUeXBlOiAnQVdTOjpBcHBTeW5jOjpBcGlLZXknLFxuICAgICAgICAgICAgICBQcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgICAgICAgQXBpSWQ6ICdhcGlJZCcsXG4gICAgICAgICAgICAgICAgRXhwaXJlczogMTAwMSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgTWV0YWRhdGE6IHtcbiAgICAgICAgICAgICAgICAnYXdzOmFzc2V0OnBhdGgnOiAnbmV3LXBhdGgnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFdIRU5cbiAgICAgIGNvbnN0IGRlcGxveVN0YWNrUmVzdWx0ID0gYXdhaXQgaG90c3dhcE1vY2tTZGtQcm92aWRlci50cnlIb3Rzd2FwRGVwbG95bWVudChob3Rzd2FwTW9kZSwgY2RrU3RhY2tBcnRpZmFjdCk7XG5cbiAgICAgIC8vIFRIRU5cbiAgICAgIGV4cGVjdChkZXBsb3lTdGFja1Jlc3VsdCkubm90LnRvQmVVbmRlZmluZWQoKTtcbiAgICAgIGV4cGVjdChtb2NrQXBwU3luY0NsaWVudCkudG9IYXZlUmVjZWl2ZWRDb21tYW5kV2l0aChVcGRhdGVBcGlLZXlDb21tYW5kLCB7XG4gICAgICAgIGFwaUlkOiAnYXBpSWQnLFxuICAgICAgICBleHBpcmVzOiAxMDAxLFxuICAgICAgICBpZDogJ2FwaS1rZXktaWQnLFxuICAgICAgfSk7XG4gICAgfSxcbiAgKTtcbn0pO1xuIl19