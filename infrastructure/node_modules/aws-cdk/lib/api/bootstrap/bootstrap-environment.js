"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bootstrapper = void 0;
const console_1 = require("console");
const path = require("path");
const deploy_bootstrap_1 = require("./deploy-bootstrap");
const legacy_template_1 = require("./legacy-template");
const logging_1 = require("../../logging");
const serialize_1 = require("../../serialize");
const directories_1 = require("../../util/directories");
const plugin_1 = require("../plugin");
class Bootstrapper {
    constructor(source) {
        this.source = source;
    }
    bootstrapEnvironment(environment, sdkProvider, options = {}) {
        switch (this.source.source) {
            case 'legacy':
                return this.legacyBootstrap(environment, sdkProvider, options);
            case 'default':
                return this.modernBootstrap(environment, sdkProvider, options);
            case 'custom':
                return this.customBootstrap(environment, sdkProvider, options);
        }
    }
    async showTemplate(json) {
        const template = await this.loadTemplate();
        process.stdout.write(`${(0, serialize_1.serializeStructure)(template, json)}\n`);
    }
    /**
     * Deploy legacy bootstrap stack
     *
     */
    async legacyBootstrap(environment, sdkProvider, options = {}) {
        const params = options.parameters ?? {};
        if (params.trustedAccounts?.length) {
            throw new Error('--trust can only be passed for the modern bootstrap experience.');
        }
        if (params.cloudFormationExecutionPolicies?.length) {
            throw new Error('--cloudformation-execution-policies can only be passed for the modern bootstrap experience.');
        }
        if (params.createCustomerMasterKey !== undefined) {
            throw new Error('--bootstrap-customer-key can only be passed for the modern bootstrap experience.');
        }
        if (params.qualifier) {
            throw new Error('--qualifier can only be passed for the modern bootstrap experience.');
        }
        const current = await deploy_bootstrap_1.BootstrapStack.lookup(sdkProvider, environment, options.toolkitStackName);
        return current.update(await this.loadTemplate(params), {}, {
            ...options,
            terminationProtection: options.terminationProtection ?? current.terminationProtection,
        });
    }
    /**
     * Deploy CI/CD-ready bootstrap stack from template
     *
     */
    async modernBootstrap(environment, sdkProvider, options = {}) {
        const params = options.parameters ?? {};
        const bootstrapTemplate = await this.loadTemplate();
        const current = await deploy_bootstrap_1.BootstrapStack.lookup(sdkProvider, environment, options.toolkitStackName);
        const partition = await current.partition();
        if (params.createCustomerMasterKey !== undefined && params.kmsKeyId) {
            throw new Error("You cannot pass '--bootstrap-kms-key-id' and '--bootstrap-customer-key' together. Specify one or the other");
        }
        // If people re-bootstrap, existing parameter values are reused so that people don't accidentally change the configuration
        // on their bootstrap stack (this happens automatically in deployStack). However, to do proper validation on the
        // combined arguments (such that if --trust has been given, --cloudformation-execution-policies is necessary as well)
        // we need to take this parameter reuse into account.
        //
        // Ideally we'd do this inside the template, but the `Rules` section of CFN
        // templates doesn't seem to be able to express the conditions that we need
        // (can't use Fn::Join or reference Conditions) so we do it here instead.
        const trustedAccounts = params.trustedAccounts ?? splitCfnArray(current.parameters.TrustedAccounts);
        (0, console_1.info)(`Trusted accounts for deployment: ${trustedAccounts.length > 0 ? trustedAccounts.join(', ') : '(none)'}`);
        const trustedAccountsForLookup = params.trustedAccountsForLookup ?? splitCfnArray(current.parameters.TrustedAccountsForLookup);
        (0, console_1.info)(`Trusted accounts for lookup: ${trustedAccountsForLookup.length > 0 ? trustedAccountsForLookup.join(', ') : '(none)'}`);
        const cloudFormationExecutionPolicies = params.cloudFormationExecutionPolicies ?? splitCfnArray(current.parameters.CloudFormationExecutionPolicies);
        if (trustedAccounts.length === 0 && cloudFormationExecutionPolicies.length === 0) {
            // For self-trust it's okay to default to AdministratorAccess, and it improves the usability of bootstrapping a lot.
            //
            // We don't actually make the implicitly policy a physical parameter. The template will infer it instead,
            // we simply do the UI advertising that behavior here.
            //
            // If we DID make it an explicit parameter, we wouldn't be able to tell the difference between whether
            // we inferred it or whether the user told us, and the sequence:
            //
            // $ cdk bootstrap
            // $ cdk bootstrap --trust 1234
            //
            // Would leave AdministratorAccess policies with a trust relationship, without the user explicitly
            // approving the trust policy.
            const implicitPolicy = `arn:${partition}:iam::aws:policy/AdministratorAccess`;
            (0, logging_1.warning)(`Using default execution policy of '${implicitPolicy}'. Pass '--cloudformation-execution-policies' to customize.`);
        }
        else if (cloudFormationExecutionPolicies.length === 0) {
            throw new Error(`Please pass \'--cloudformation-execution-policies\' when using \'--trust\' to specify deployment permissions. Try a managed policy of the form \'arn:${partition}:iam::aws:policy/<PolicyName>\'.`);
        }
        else {
            // Remind people what the current settings are
            (0, console_1.info)(`Execution policies: ${cloudFormationExecutionPolicies.join(', ')}`);
        }
        // * If an ARN is given, that ARN. Otherwise:
        //   * '-' if customerKey = false
        //   * '' if customerKey = true
        //   * if customerKey is also not given
        //     * undefined if we already had a value in place (reusing what we had)
        //     * '-' if this is the first time we're deploying this stack (or upgrading from old to new bootstrap)
        const currentKmsKeyId = current.parameters.FileAssetsBucketKmsKeyId;
        const kmsKeyId = params.kmsKeyId ??
            (params.createCustomerMasterKey === true
                ? CREATE_NEW_KEY
                : params.createCustomerMasterKey === false || currentKmsKeyId === undefined
                    ? USE_AWS_MANAGED_KEY
                    : undefined);
        /* A permissions boundary can be provided via:
         *    - the flag indicating the example one should be used
         *    - the name indicating the custom permissions boundary to be used
         * Re-bootstrapping will NOT be blocked by either tightening or relaxing the permissions' boundary.
         */
        // InputPermissionsBoundary is an `any` type and if it is not defined it
        // appears as an empty string ''. We need to force it to evaluate an empty string
        // as undefined
        const currentPermissionsBoundary = current.parameters.InputPermissionsBoundary || undefined;
        const inputPolicyName = params.examplePermissionsBoundary
            ? CDK_BOOTSTRAP_PERMISSIONS_BOUNDARY
            : params.customPermissionsBoundary;
        let policyName;
        if (inputPolicyName) {
            // If the example policy is not already in place, it must be created.
            const sdk = (await sdkProvider.forEnvironment(environment, plugin_1.Mode.ForWriting)).sdk;
            policyName = await this.getPolicyName(environment, sdk, inputPolicyName, partition, params);
        }
        if (currentPermissionsBoundary !== policyName) {
            if (!currentPermissionsBoundary) {
                (0, logging_1.warning)(`Adding new permissions boundary ${policyName}`);
            }
            else if (!policyName) {
                (0, logging_1.warning)(`Removing existing permissions boundary ${currentPermissionsBoundary}`);
            }
            else {
                (0, logging_1.warning)(`Changing permissions boundary from ${currentPermissionsBoundary} to ${policyName}`);
            }
        }
        return current.update(bootstrapTemplate, {
            FileAssetsBucketName: params.bucketName,
            FileAssetsBucketKmsKeyId: kmsKeyId,
            // Empty array becomes empty string
            TrustedAccounts: trustedAccounts.join(','),
            TrustedAccountsForLookup: trustedAccountsForLookup.join(','),
            CloudFormationExecutionPolicies: cloudFormationExecutionPolicies.join(','),
            Qualifier: params.qualifier,
            PublicAccessBlockConfiguration: params.publicAccessBlockConfiguration || params.publicAccessBlockConfiguration === undefined
                ? 'true'
                : 'false',
            InputPermissionsBoundary: policyName,
        }, {
            ...options,
            terminationProtection: options.terminationProtection ?? current.terminationProtection,
        });
    }
    async getPolicyName(environment, sdk, permissionsBoundary, partition, params) {
        if (permissionsBoundary !== CDK_BOOTSTRAP_PERMISSIONS_BOUNDARY) {
            this.validatePolicyName(permissionsBoundary);
            return Promise.resolve(permissionsBoundary);
        }
        // if no Qualifier is supplied, resort to the default one
        const arn = await this.getExamplePermissionsBoundary(params.qualifier ?? 'hnb659fds', partition, environment.account, sdk);
        const policyName = arn.split('/').pop();
        if (!policyName) {
            throw new Error('Could not retrieve the example permission boundary!');
        }
        return Promise.resolve(policyName);
    }
    async getExamplePermissionsBoundary(qualifier, partition, account, sdk) {
        const iam = sdk.iam();
        let policyName = `cdk-${qualifier}-permissions-boundary`;
        const arn = `arn:${partition}:iam::${account}:policy/${policyName}`;
        try {
            let getPolicyResp = await iam.getPolicy({ PolicyArn: arn });
            if (getPolicyResp.Policy) {
                return arn;
            }
        }
        catch (e) {
            // https://docs.aws.amazon.com/IAM/latest/APIReference/API_GetPolicy.html#API_GetPolicy_Errors
            if (e.name === 'NoSuchEntity') {
                //noop, proceed with creating the policy
            }
            else {
                throw e;
            }
        }
        const policyDoc = {
            Version: '2012-10-17',
            Statement: [
                {
                    Action: ['*'],
                    Resource: '*',
                    Effect: 'Allow',
                    Sid: 'ExplicitAllowAll',
                },
                {
                    Condition: {
                        StringEquals: {
                            'iam:PermissionsBoundary': `arn:${partition}:iam::${account}:policy/cdk-${qualifier}-permissions-boundary`,
                        },
                    },
                    Action: [
                        'iam:CreateUser',
                        'iam:CreateRole',
                        'iam:PutRolePermissionsBoundary',
                        'iam:PutUserPermissionsBoundary',
                    ],
                    Resource: '*',
                    Effect: 'Allow',
                    Sid: 'DenyAccessIfRequiredPermBoundaryIsNotBeingApplied',
                },
                {
                    Action: [
                        'iam:CreatePolicyVersion',
                        'iam:DeletePolicy',
                        'iam:DeletePolicyVersion',
                        'iam:SetDefaultPolicyVersion',
                    ],
                    Resource: `arn:${partition}:iam::${account}:policy/cdk-${qualifier}-permissions-boundary`,
                    Effect: 'Deny',
                    Sid: 'DenyPermBoundaryIAMPolicyAlteration',
                },
                {
                    Action: ['iam:DeleteUserPermissionsBoundary', 'iam:DeleteRolePermissionsBoundary'],
                    Resource: '*',
                    Effect: 'Deny',
                    Sid: 'DenyRemovalOfPermBoundaryFromAnyUserOrRole',
                },
            ],
        };
        const request = {
            PolicyName: policyName,
            PolicyDocument: JSON.stringify(policyDoc),
        };
        const createPolicyResponse = await iam.createPolicy(request);
        if (createPolicyResponse.Policy?.Arn) {
            return createPolicyResponse.Policy.Arn;
        }
        else {
            throw new Error(`Could not retrieve the example permission boundary ${arn}!`);
        }
    }
    validatePolicyName(permissionsBoundary) {
        // https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreatePolicy.html
        // Added support for policy names with a path
        // See https://github.com/aws/aws-cdk/issues/26320
        const regexp = /[\w+\/=,.@-]+/;
        const matches = regexp.exec(permissionsBoundary);
        if (!(matches && matches.length === 1 && matches[0] === permissionsBoundary)) {
            throw new Error(`The permissions boundary name ${permissionsBoundary} does not match the IAM conventions.`);
        }
    }
    async customBootstrap(environment, sdkProvider, options = {}) {
        // Look at the template, decide whether it's most likely a legacy or modern bootstrap
        // template, and use the right bootstrapper for that.
        const version = (0, deploy_bootstrap_1.bootstrapVersionFromTemplate)(await this.loadTemplate());
        if (version === 0) {
            return this.legacyBootstrap(environment, sdkProvider, options);
        }
        else {
            return this.modernBootstrap(environment, sdkProvider, options);
        }
    }
    async loadTemplate(params = {}) {
        switch (this.source.source) {
            case 'custom':
                return (0, serialize_1.loadStructuredFile)(this.source.templateFile);
            case 'default':
                return (0, serialize_1.loadStructuredFile)(path.join((0, directories_1.rootDir)(), 'lib', 'api', 'bootstrap', 'bootstrap-template.yaml'));
            case 'legacy':
                return (0, legacy_template_1.legacyBootstrapTemplate)(params);
        }
    }
}
exports.Bootstrapper = Bootstrapper;
/**
 * Magic parameter value that will cause the bootstrap-template.yml to NOT create a CMK but use the default key
 */
const USE_AWS_MANAGED_KEY = 'AWS_MANAGED_KEY';
/**
 * Magic parameter value that will cause the bootstrap-template.yml to create a CMK
 */
const CREATE_NEW_KEY = '';
/**
 * Parameter value indicating the use of the default, CDK provided permissions boundary for bootstrap-template.yml
 */
const CDK_BOOTSTRAP_PERMISSIONS_BOUNDARY = 'CDK_BOOTSTRAP_PERMISSIONS_BOUNDARY';
/**
 * Split an array-like CloudFormation parameter on ,
 *
 * An empty string is the empty array (instead of `['']`).
 */
function splitCfnArray(xs) {
    if (xs === '' || xs === undefined) {
        return [];
    }
    return xs.split(',');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYm9vdHN0cmFwLWVudmlyb25tZW50LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYm9vdHN0cmFwLWVudmlyb25tZW50LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHFDQUErQjtBQUMvQiw2QkFBNkI7QUFHN0IseURBQWtGO0FBQ2xGLHVEQUE0RDtBQUM1RCwyQ0FBd0M7QUFDeEMsK0NBQXlFO0FBQ3pFLHdEQUFpRDtBQUdqRCxzQ0FBaUM7QUFJakMsTUFBYSxZQUFZO0lBQ3ZCLFlBQTZCLE1BQXVCO1FBQXZCLFdBQU0sR0FBTixNQUFNLENBQWlCO0lBQUcsQ0FBQztJQUVqRCxvQkFBb0IsQ0FDekIsV0FBOEIsRUFDOUIsV0FBd0IsRUFDeEIsVUFBdUMsRUFBRTtRQUV6QyxRQUFRLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDM0IsS0FBSyxRQUFRO2dCQUNYLE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQyxXQUFXLEVBQUUsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBQ2pFLEtBQUssU0FBUztnQkFDWixPQUFPLElBQUksQ0FBQyxlQUFlLENBQUMsV0FBVyxFQUFFLFdBQVcsRUFBRSxPQUFPLENBQUMsQ0FBQztZQUNqRSxLQUFLLFFBQVE7Z0JBQ1gsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFDbkUsQ0FBQztJQUNILENBQUM7SUFFTSxLQUFLLENBQUMsWUFBWSxDQUFDLElBQWE7UUFDckMsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7UUFDM0MsT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxJQUFBLDhCQUFrQixFQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDbEUsQ0FBQztJQUVEOzs7T0FHRztJQUNLLEtBQUssQ0FBQyxlQUFlLENBQzNCLFdBQThCLEVBQzlCLFdBQXdCLEVBQ3hCLFVBQXVDLEVBQUU7UUFFekMsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLFVBQVUsSUFBSSxFQUFFLENBQUM7UUFFeEMsSUFBSSxNQUFNLENBQUMsZUFBZSxFQUFFLE1BQU0sRUFBRSxDQUFDO1lBQ25DLE1BQU0sSUFBSSxLQUFLLENBQUMsaUVBQWlFLENBQUMsQ0FBQztRQUNyRixDQUFDO1FBQ0QsSUFBSSxNQUFNLENBQUMsK0JBQStCLEVBQUUsTUFBTSxFQUFFLENBQUM7WUFDbkQsTUFBTSxJQUFJLEtBQUssQ0FBQyw2RkFBNkYsQ0FBQyxDQUFDO1FBQ2pILENBQUM7UUFDRCxJQUFJLE1BQU0sQ0FBQyx1QkFBdUIsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUNqRCxNQUFNLElBQUksS0FBSyxDQUFDLGtGQUFrRixDQUFDLENBQUM7UUFDdEcsQ0FBQztRQUNELElBQUksTUFBTSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ3JCLE1BQU0sSUFBSSxLQUFLLENBQUMscUVBQXFFLENBQUMsQ0FBQztRQUN6RixDQUFDO1FBRUQsTUFBTSxPQUFPLEdBQUcsTUFBTSxpQ0FBYyxDQUFDLE1BQU0sQ0FBQyxXQUFXLEVBQUUsV0FBVyxFQUFFLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ2hHLE9BQU8sT0FBTyxDQUFDLE1BQU0sQ0FDbkIsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxFQUMvQixFQUFFLEVBQ0Y7WUFDRSxHQUFHLE9BQU87WUFDVixxQkFBcUIsRUFBRSxPQUFPLENBQUMscUJBQXFCLElBQUksT0FBTyxDQUFDLHFCQUFxQjtTQUN0RixDQUNGLENBQUM7SUFDSixDQUFDO0lBRUQ7OztPQUdHO0lBQ0ssS0FBSyxDQUFDLGVBQWUsQ0FDM0IsV0FBOEIsRUFDOUIsV0FBd0IsRUFDeEIsVUFBdUMsRUFBRTtRQUV6QyxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsVUFBVSxJQUFJLEVBQUUsQ0FBQztRQUV4QyxNQUFNLGlCQUFpQixHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBRXBELE1BQU0sT0FBTyxHQUFHLE1BQU0saUNBQWMsQ0FBQyxNQUFNLENBQUMsV0FBVyxFQUFFLFdBQVcsRUFBRSxPQUFPLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztRQUNoRyxNQUFNLFNBQVMsR0FBRyxNQUFNLE9BQU8sQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUU1QyxJQUFJLE1BQU0sQ0FBQyx1QkFBdUIsS0FBSyxTQUFTLElBQUksTUFBTSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ3BFLE1BQU0sSUFBSSxLQUFLLENBQ2IsNEdBQTRHLENBQzdHLENBQUM7UUFDSixDQUFDO1FBRUQsMEhBQTBIO1FBQzFILGdIQUFnSDtRQUNoSCxxSEFBcUg7UUFDckgscURBQXFEO1FBQ3JELEVBQUU7UUFDRiwyRUFBMkU7UUFDM0UsMkVBQTJFO1FBQzNFLHlFQUF5RTtRQUN6RSxNQUFNLGVBQWUsR0FBRyxNQUFNLENBQUMsZUFBZSxJQUFJLGFBQWEsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBQ3BHLElBQUEsY0FBSSxFQUFDLG9DQUFvQyxlQUFlLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQztRQUUvRyxNQUFNLHdCQUF3QixHQUM1QixNQUFNLENBQUMsd0JBQXdCLElBQUksYUFBYSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsd0JBQXdCLENBQUMsQ0FBQztRQUNoRyxJQUFBLGNBQUksRUFDRixnQ0FBZ0Msd0JBQXdCLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FDdkgsQ0FBQztRQUVGLE1BQU0sK0JBQStCLEdBQ25DLE1BQU0sQ0FBQywrQkFBK0IsSUFBSSxhQUFhLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQywrQkFBK0IsQ0FBQyxDQUFDO1FBQzlHLElBQUksZUFBZSxDQUFDLE1BQU0sS0FBSyxDQUFDLElBQUksK0JBQStCLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ2pGLG9IQUFvSDtZQUNwSCxFQUFFO1lBQ0YseUdBQXlHO1lBQ3pHLHNEQUFzRDtZQUN0RCxFQUFFO1lBQ0Ysc0dBQXNHO1lBQ3RHLGdFQUFnRTtZQUNoRSxFQUFFO1lBQ0Ysa0JBQWtCO1lBQ2xCLCtCQUErQjtZQUMvQixFQUFFO1lBQ0Ysa0dBQWtHO1lBQ2xHLDhCQUE4QjtZQUM5QixNQUFNLGNBQWMsR0FBRyxPQUFPLFNBQVMsc0NBQXNDLENBQUM7WUFDOUUsSUFBQSxpQkFBTyxFQUNMLHNDQUFzQyxjQUFjLDZEQUE2RCxDQUNsSCxDQUFDO1FBQ0osQ0FBQzthQUFNLElBQUksK0JBQStCLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3hELE1BQU0sSUFBSSxLQUFLLENBQ2Isd0pBQXdKLFNBQVMsa0NBQWtDLENBQ3BNLENBQUM7UUFDSixDQUFDO2FBQU0sQ0FBQztZQUNOLDhDQUE4QztZQUM5QyxJQUFBLGNBQUksRUFBQyx1QkFBdUIsK0JBQStCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUM1RSxDQUFDO1FBRUQsNkNBQTZDO1FBQzdDLGlDQUFpQztRQUNqQywrQkFBK0I7UUFDL0IsdUNBQXVDO1FBQ3ZDLDJFQUEyRTtRQUMzRSwwR0FBMEc7UUFDMUcsTUFBTSxlQUFlLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyx3QkFBd0IsQ0FBQztRQUNwRSxNQUFNLFFBQVEsR0FDWixNQUFNLENBQUMsUUFBUTtZQUNmLENBQUMsTUFBTSxDQUFDLHVCQUF1QixLQUFLLElBQUk7Z0JBQ3RDLENBQUMsQ0FBQyxjQUFjO2dCQUNoQixDQUFDLENBQUMsTUFBTSxDQUFDLHVCQUF1QixLQUFLLEtBQUssSUFBSSxlQUFlLEtBQUssU0FBUztvQkFDekUsQ0FBQyxDQUFDLG1CQUFtQjtvQkFDckIsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBRW5COzs7O1dBSUc7UUFFSCx3RUFBd0U7UUFDeEUsaUZBQWlGO1FBQ2pGLGVBQWU7UUFDZixNQUFNLDBCQUEwQixHQUF1QixPQUFPLENBQUMsVUFBVSxDQUFDLHdCQUF3QixJQUFJLFNBQVMsQ0FBQztRQUNoSCxNQUFNLGVBQWUsR0FBRyxNQUFNLENBQUMsMEJBQTBCO1lBQ3ZELENBQUMsQ0FBQyxrQ0FBa0M7WUFDcEMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyx5QkFBeUIsQ0FBQztRQUNyQyxJQUFJLFVBQThCLENBQUM7UUFDbkMsSUFBSSxlQUFlLEVBQUUsQ0FBQztZQUNwQixxRUFBcUU7WUFDckUsTUFBTSxHQUFHLEdBQUcsQ0FBQyxNQUFNLFdBQVcsQ0FBQyxjQUFjLENBQUMsV0FBVyxFQUFFLGFBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQztZQUNqRixVQUFVLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsRUFBRSxHQUFHLEVBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUM5RixDQUFDO1FBQ0QsSUFBSSwwQkFBMEIsS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUM5QyxJQUFJLENBQUMsMEJBQTBCLEVBQUUsQ0FBQztnQkFDaEMsSUFBQSxpQkFBTyxFQUFDLG1DQUFtQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1lBQzNELENBQUM7aUJBQU0sSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUN2QixJQUFBLGlCQUFPLEVBQUMsMENBQTBDLDBCQUEwQixFQUFFLENBQUMsQ0FBQztZQUNsRixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sSUFBQSxpQkFBTyxFQUFDLHNDQUFzQywwQkFBMEIsT0FBTyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1lBQy9GLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxPQUFPLENBQUMsTUFBTSxDQUNuQixpQkFBaUIsRUFDakI7WUFDRSxvQkFBb0IsRUFBRSxNQUFNLENBQUMsVUFBVTtZQUN2Qyx3QkFBd0IsRUFBRSxRQUFRO1lBQ2xDLG1DQUFtQztZQUNuQyxlQUFlLEVBQUUsZUFBZSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUM7WUFDMUMsd0JBQXdCLEVBQUUsd0JBQXdCLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQztZQUM1RCwrQkFBK0IsRUFBRSwrQkFBK0IsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDO1lBQzFFLFNBQVMsRUFBRSxNQUFNLENBQUMsU0FBUztZQUMzQiw4QkFBOEIsRUFDNUIsTUFBTSxDQUFDLDhCQUE4QixJQUFJLE1BQU0sQ0FBQyw4QkFBOEIsS0FBSyxTQUFTO2dCQUMxRixDQUFDLENBQUMsTUFBTTtnQkFDUixDQUFDLENBQUMsT0FBTztZQUNiLHdCQUF3QixFQUFFLFVBQVU7U0FDckMsRUFDRDtZQUNFLEdBQUcsT0FBTztZQUNWLHFCQUFxQixFQUFFLE9BQU8sQ0FBQyxxQkFBcUIsSUFBSSxPQUFPLENBQUMscUJBQXFCO1NBQ3RGLENBQ0YsQ0FBQztJQUNKLENBQUM7SUFFTyxLQUFLLENBQUMsYUFBYSxDQUN6QixXQUE4QixFQUM5QixHQUFRLEVBQ1IsbUJBQTJCLEVBQzNCLFNBQWlCLEVBQ2pCLE1BQStCO1FBRS9CLElBQUksbUJBQW1CLEtBQUssa0NBQWtDLEVBQUUsQ0FBQztZQUMvRCxJQUFJLENBQUMsa0JBQWtCLENBQUMsbUJBQW1CLENBQUMsQ0FBQztZQUM3QyxPQUFPLE9BQU8sQ0FBQyxPQUFPLENBQUMsbUJBQW1CLENBQUMsQ0FBQztRQUM5QyxDQUFDO1FBQ0QseURBQXlEO1FBQ3pELE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDLDZCQUE2QixDQUNsRCxNQUFNLENBQUMsU0FBUyxJQUFJLFdBQVcsRUFDL0IsU0FBUyxFQUNULFdBQVcsQ0FBQyxPQUFPLEVBQ25CLEdBQUcsQ0FDSixDQUFDO1FBQ0YsTUFBTSxVQUFVLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUN4QyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDaEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxxREFBcUQsQ0FBQyxDQUFDO1FBQ3pFLENBQUM7UUFDRCxPQUFPLE9BQU8sQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUM7SUFDckMsQ0FBQztJQUVPLEtBQUssQ0FBQyw2QkFBNkIsQ0FDekMsU0FBaUIsRUFDakIsU0FBaUIsRUFDakIsT0FBZSxFQUNmLEdBQVE7UUFFUixNQUFNLEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7UUFFdEIsSUFBSSxVQUFVLEdBQUcsT0FBTyxTQUFTLHVCQUF1QixDQUFDO1FBQ3pELE1BQU0sR0FBRyxHQUFHLE9BQU8sU0FBUyxTQUFTLE9BQU8sV0FBVyxVQUFVLEVBQUUsQ0FBQztRQUVwRSxJQUFJLENBQUM7WUFDSCxJQUFJLGFBQWEsR0FBRyxNQUFNLEdBQUcsQ0FBQyxTQUFTLENBQUMsRUFBRSxTQUFTLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztZQUM1RCxJQUFJLGFBQWEsQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDekIsT0FBTyxHQUFHLENBQUM7WUFDYixDQUFDO1FBQ0gsQ0FBQztRQUFDLE9BQU8sQ0FBTSxFQUFFLENBQUM7WUFDaEIsOEZBQThGO1lBQzlGLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxjQUFjLEVBQUUsQ0FBQztnQkFDOUIsd0NBQXdDO1lBQzFDLENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLENBQUMsQ0FBQztZQUNWLENBQUM7UUFDSCxDQUFDO1FBRUQsTUFBTSxTQUFTLEdBQUc7WUFDaEIsT0FBTyxFQUFFLFlBQVk7WUFDckIsU0FBUyxFQUFFO2dCQUNUO29CQUNFLE1BQU0sRUFBRSxDQUFDLEdBQUcsQ0FBQztvQkFDYixRQUFRLEVBQUUsR0FBRztvQkFDYixNQUFNLEVBQUUsT0FBTztvQkFDZixHQUFHLEVBQUUsa0JBQWtCO2lCQUN4QjtnQkFDRDtvQkFDRSxTQUFTLEVBQUU7d0JBQ1QsWUFBWSxFQUFFOzRCQUNaLHlCQUF5QixFQUFFLE9BQU8sU0FBUyxTQUFTLE9BQU8sZUFBZSxTQUFTLHVCQUF1Qjt5QkFDM0c7cUJBQ0Y7b0JBQ0QsTUFBTSxFQUFFO3dCQUNOLGdCQUFnQjt3QkFDaEIsZ0JBQWdCO3dCQUNoQixnQ0FBZ0M7d0JBQ2hDLGdDQUFnQztxQkFDakM7b0JBQ0QsUUFBUSxFQUFFLEdBQUc7b0JBQ2IsTUFBTSxFQUFFLE9BQU87b0JBQ2YsR0FBRyxFQUFFLG1EQUFtRDtpQkFDekQ7Z0JBQ0Q7b0JBQ0UsTUFBTSxFQUFFO3dCQUNOLHlCQUF5Qjt3QkFDekIsa0JBQWtCO3dCQUNsQix5QkFBeUI7d0JBQ3pCLDZCQUE2QjtxQkFDOUI7b0JBQ0QsUUFBUSxFQUFFLE9BQU8sU0FBUyxTQUFTLE9BQU8sZUFBZSxTQUFTLHVCQUF1QjtvQkFDekYsTUFBTSxFQUFFLE1BQU07b0JBQ2QsR0FBRyxFQUFFLHFDQUFxQztpQkFDM0M7Z0JBQ0Q7b0JBQ0UsTUFBTSxFQUFFLENBQUMsbUNBQW1DLEVBQUUsbUNBQW1DLENBQUM7b0JBQ2xGLFFBQVEsRUFBRSxHQUFHO29CQUNiLE1BQU0sRUFBRSxNQUFNO29CQUNkLEdBQUcsRUFBRSw0Q0FBNEM7aUJBQ2xEO2FBQ0Y7U0FDRixDQUFDO1FBQ0YsTUFBTSxPQUFPLEdBQUc7WUFDZCxVQUFVLEVBQUUsVUFBVTtZQUN0QixjQUFjLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUM7U0FDMUMsQ0FBQztRQUNGLE1BQU0sb0JBQW9CLEdBQUcsTUFBTSxHQUFHLENBQUMsWUFBWSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzdELElBQUksb0JBQW9CLENBQUMsTUFBTSxFQUFFLEdBQUcsRUFBRSxDQUFDO1lBQ3JDLE9BQU8sb0JBQW9CLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQztRQUN6QyxDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sSUFBSSxLQUFLLENBQUMsc0RBQXNELEdBQUcsR0FBRyxDQUFDLENBQUM7UUFDaEYsQ0FBQztJQUNILENBQUM7SUFFTyxrQkFBa0IsQ0FBQyxtQkFBMkI7UUFDcEQsNEVBQTRFO1FBQzVFLDZDQUE2QztRQUM3QyxrREFBa0Q7UUFDbEQsTUFBTSxNQUFNLEdBQVcsZUFBZSxDQUFDO1FBQ3ZDLE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FBQztRQUNqRCxJQUFJLENBQUMsQ0FBQyxPQUFPLElBQUksT0FBTyxDQUFDLE1BQU0sS0FBSyxDQUFDLElBQUksT0FBTyxDQUFDLENBQUMsQ0FBQyxLQUFLLG1CQUFtQixDQUFDLEVBQUUsQ0FBQztZQUM3RSxNQUFNLElBQUksS0FBSyxDQUFDLGlDQUFpQyxtQkFBbUIsc0NBQXNDLENBQUMsQ0FBQztRQUM5RyxDQUFDO0lBQ0gsQ0FBQztJQUVPLEtBQUssQ0FBQyxlQUFlLENBQzNCLFdBQThCLEVBQzlCLFdBQXdCLEVBQ3hCLFVBQXVDLEVBQUU7UUFFekMscUZBQXFGO1FBQ3JGLHFEQUFxRDtRQUNyRCxNQUFNLE9BQU8sR0FBRyxJQUFBLCtDQUE0QixFQUFDLE1BQU0sSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDLENBQUM7UUFDeEUsSUFBSSxPQUFPLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDbEIsT0FBTyxJQUFJLENBQUMsZUFBZSxDQUFDLFdBQVcsRUFBRSxXQUFXLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFDakUsQ0FBQzthQUFNLENBQUM7WUFDTixPQUFPLElBQUksQ0FBQyxlQUFlLENBQUMsV0FBVyxFQUFFLFdBQVcsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUNqRSxDQUFDO0lBQ0gsQ0FBQztJQUVPLEtBQUssQ0FBQyxZQUFZLENBQUMsU0FBa0MsRUFBRTtRQUM3RCxRQUFRLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDM0IsS0FBSyxRQUFRO2dCQUNYLE9BQU8sSUFBQSw4QkFBa0IsRUFBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDO1lBQ3RELEtBQUssU0FBUztnQkFDWixPQUFPLElBQUEsOEJBQWtCLEVBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFBLHFCQUFPLEdBQUUsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSx5QkFBeUIsQ0FBQyxDQUFDLENBQUM7WUFDeEcsS0FBSyxRQUFRO2dCQUNYLE9BQU8sSUFBQSx5Q0FBdUIsRUFBQyxNQUFNLENBQUMsQ0FBQztRQUMzQyxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBL1VELG9DQStVQztBQUVEOztHQUVHO0FBQ0gsTUFBTSxtQkFBbUIsR0FBRyxpQkFBaUIsQ0FBQztBQUU5Qzs7R0FFRztBQUNILE1BQU0sY0FBYyxHQUFHLEVBQUUsQ0FBQztBQUMxQjs7R0FFRztBQUNILE1BQU0sa0NBQWtDLEdBQUcsb0NBQW9DLENBQUM7QUFFaEY7Ozs7R0FJRztBQUNILFNBQVMsYUFBYSxDQUFDLEVBQXNCO0lBQzNDLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDbEMsT0FBTyxFQUFFLENBQUM7SUFDWixDQUFDO0lBQ0QsT0FBTyxFQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBpbmZvIH0gZnJvbSAnY29uc29sZSc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgY3hhcGkgZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCB0eXBlIHsgQm9vdHN0cmFwRW52aXJvbm1lbnRPcHRpb25zLCBCb290c3RyYXBwaW5nUGFyYW1ldGVycyB9IGZyb20gJy4vYm9vdHN0cmFwLXByb3BzJztcbmltcG9ydCB7IEJvb3RzdHJhcFN0YWNrLCBib290c3RyYXBWZXJzaW9uRnJvbVRlbXBsYXRlIH0gZnJvbSAnLi9kZXBsb3ktYm9vdHN0cmFwJztcbmltcG9ydCB7IGxlZ2FjeUJvb3RzdHJhcFRlbXBsYXRlIH0gZnJvbSAnLi9sZWdhY3ktdGVtcGxhdGUnO1xuaW1wb3J0IHsgd2FybmluZyB9IGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHsgbG9hZFN0cnVjdHVyZWRGaWxlLCBzZXJpYWxpemVTdHJ1Y3R1cmUgfSBmcm9tICcuLi8uLi9zZXJpYWxpemUnO1xuaW1wb3J0IHsgcm9vdERpciB9IGZyb20gJy4uLy4uL3V0aWwvZGlyZWN0b3JpZXMnO1xuaW1wb3J0IHR5cGUgeyBTREssIFNka1Byb3ZpZGVyIH0gZnJvbSAnLi4vYXdzLWF1dGgnO1xuaW1wb3J0IHR5cGUgeyBTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQgfSBmcm9tICcuLi9kZXBsb3ktc3RhY2snO1xuaW1wb3J0IHsgTW9kZSB9IGZyb20gJy4uL3BsdWdpbic7XG5cbmV4cG9ydCB0eXBlIEJvb3RzdHJhcFNvdXJjZSA9IHsgc291cmNlOiAnbGVnYWN5JyB9IHwgeyBzb3VyY2U6ICdkZWZhdWx0JyB9IHwgeyBzb3VyY2U6ICdjdXN0b20nOyB0ZW1wbGF0ZUZpbGU6IHN0cmluZyB9O1xuXG5leHBvcnQgY2xhc3MgQm9vdHN0cmFwcGVyIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBzb3VyY2U6IEJvb3RzdHJhcFNvdXJjZSkge31cblxuICBwdWJsaWMgYm9vdHN0cmFwRW52aXJvbm1lbnQoXG4gICAgZW52aXJvbm1lbnQ6IGN4YXBpLkVudmlyb25tZW50LFxuICAgIHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlcixcbiAgICBvcHRpb25zOiBCb290c3RyYXBFbnZpcm9ubWVudE9wdGlvbnMgPSB7fSxcbiAgKTogUHJvbWlzZTxTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQ+IHtcbiAgICBzd2l0Y2ggKHRoaXMuc291cmNlLnNvdXJjZSkge1xuICAgICAgY2FzZSAnbGVnYWN5JzpcbiAgICAgICAgcmV0dXJuIHRoaXMubGVnYWN5Qm9vdHN0cmFwKGVudmlyb25tZW50LCBzZGtQcm92aWRlciwgb3B0aW9ucyk7XG4gICAgICBjYXNlICdkZWZhdWx0JzpcbiAgICAgICAgcmV0dXJuIHRoaXMubW9kZXJuQm9vdHN0cmFwKGVudmlyb25tZW50LCBzZGtQcm92aWRlciwgb3B0aW9ucyk7XG4gICAgICBjYXNlICdjdXN0b20nOlxuICAgICAgICByZXR1cm4gdGhpcy5jdXN0b21Cb290c3RyYXAoZW52aXJvbm1lbnQsIHNka1Byb3ZpZGVyLCBvcHRpb25zKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgc2hvd1RlbXBsYXRlKGpzb246IGJvb2xlYW4pIHtcbiAgICBjb25zdCB0ZW1wbGF0ZSA9IGF3YWl0IHRoaXMubG9hZFRlbXBsYXRlKCk7XG4gICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUoYCR7c2VyaWFsaXplU3RydWN0dXJlKHRlbXBsYXRlLCBqc29uKX1cXG5gKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXBsb3kgbGVnYWN5IGJvb3RzdHJhcCBzdGFja1xuICAgKlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBsZWdhY3lCb290c3RyYXAoXG4gICAgZW52aXJvbm1lbnQ6IGN4YXBpLkVudmlyb25tZW50LFxuICAgIHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlcixcbiAgICBvcHRpb25zOiBCb290c3RyYXBFbnZpcm9ubWVudE9wdGlvbnMgPSB7fSxcbiAgKTogUHJvbWlzZTxTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQ+IHtcbiAgICBjb25zdCBwYXJhbXMgPSBvcHRpb25zLnBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBpZiAocGFyYW1zLnRydXN0ZWRBY2NvdW50cz8ubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJy0tdHJ1c3QgY2FuIG9ubHkgYmUgcGFzc2VkIGZvciB0aGUgbW9kZXJuIGJvb3RzdHJhcCBleHBlcmllbmNlLicpO1xuICAgIH1cbiAgICBpZiAocGFyYW1zLmNsb3VkRm9ybWF0aW9uRXhlY3V0aW9uUG9saWNpZXM/Lmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCctLWNsb3VkZm9ybWF0aW9uLWV4ZWN1dGlvbi1wb2xpY2llcyBjYW4gb25seSBiZSBwYXNzZWQgZm9yIHRoZSBtb2Rlcm4gYm9vdHN0cmFwIGV4cGVyaWVuY2UuJyk7XG4gICAgfVxuICAgIGlmIChwYXJhbXMuY3JlYXRlQ3VzdG9tZXJNYXN0ZXJLZXkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCctLWJvb3RzdHJhcC1jdXN0b21lci1rZXkgY2FuIG9ubHkgYmUgcGFzc2VkIGZvciB0aGUgbW9kZXJuIGJvb3RzdHJhcCBleHBlcmllbmNlLicpO1xuICAgIH1cbiAgICBpZiAocGFyYW1zLnF1YWxpZmllcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCctLXF1YWxpZmllciBjYW4gb25seSBiZSBwYXNzZWQgZm9yIHRoZSBtb2Rlcm4gYm9vdHN0cmFwIGV4cGVyaWVuY2UuJyk7XG4gICAgfVxuXG4gICAgY29uc3QgY3VycmVudCA9IGF3YWl0IEJvb3RzdHJhcFN0YWNrLmxvb2t1cChzZGtQcm92aWRlciwgZW52aXJvbm1lbnQsIG9wdGlvbnMudG9vbGtpdFN0YWNrTmFtZSk7XG4gICAgcmV0dXJuIGN1cnJlbnQudXBkYXRlKFxuICAgICAgYXdhaXQgdGhpcy5sb2FkVGVtcGxhdGUocGFyYW1zKSxcbiAgICAgIHt9LFxuICAgICAge1xuICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICB0ZXJtaW5hdGlvblByb3RlY3Rpb246IG9wdGlvbnMudGVybWluYXRpb25Qcm90ZWN0aW9uID8/IGN1cnJlbnQudGVybWluYXRpb25Qcm90ZWN0aW9uLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgLyoqXG4gICAqIERlcGxveSBDSS9DRC1yZWFkeSBib290c3RyYXAgc3RhY2sgZnJvbSB0ZW1wbGF0ZVxuICAgKlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBtb2Rlcm5Cb290c3RyYXAoXG4gICAgZW52aXJvbm1lbnQ6IGN4YXBpLkVudmlyb25tZW50LFxuICAgIHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlcixcbiAgICBvcHRpb25zOiBCb290c3RyYXBFbnZpcm9ubWVudE9wdGlvbnMgPSB7fSxcbiAgKTogUHJvbWlzZTxTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQ+IHtcbiAgICBjb25zdCBwYXJhbXMgPSBvcHRpb25zLnBhcmFtZXRlcnMgPz8ge307XG5cbiAgICBjb25zdCBib290c3RyYXBUZW1wbGF0ZSA9IGF3YWl0IHRoaXMubG9hZFRlbXBsYXRlKCk7XG5cbiAgICBjb25zdCBjdXJyZW50ID0gYXdhaXQgQm9vdHN0cmFwU3RhY2subG9va3VwKHNka1Byb3ZpZGVyLCBlbnZpcm9ubWVudCwgb3B0aW9ucy50b29sa2l0U3RhY2tOYW1lKTtcbiAgICBjb25zdCBwYXJ0aXRpb24gPSBhd2FpdCBjdXJyZW50LnBhcnRpdGlvbigpO1xuXG4gICAgaWYgKHBhcmFtcy5jcmVhdGVDdXN0b21lck1hc3RlcktleSAhPT0gdW5kZWZpbmVkICYmIHBhcmFtcy5rbXNLZXlJZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIllvdSBjYW5ub3QgcGFzcyAnLS1ib290c3RyYXAta21zLWtleS1pZCcgYW5kICctLWJvb3RzdHJhcC1jdXN0b21lci1rZXknIHRvZ2V0aGVyLiBTcGVjaWZ5IG9uZSBvciB0aGUgb3RoZXJcIixcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gSWYgcGVvcGxlIHJlLWJvb3RzdHJhcCwgZXhpc3RpbmcgcGFyYW1ldGVyIHZhbHVlcyBhcmUgcmV1c2VkIHNvIHRoYXQgcGVvcGxlIGRvbid0IGFjY2lkZW50YWxseSBjaGFuZ2UgdGhlIGNvbmZpZ3VyYXRpb25cbiAgICAvLyBvbiB0aGVpciBib290c3RyYXAgc3RhY2sgKHRoaXMgaGFwcGVucyBhdXRvbWF0aWNhbGx5IGluIGRlcGxveVN0YWNrKS4gSG93ZXZlciwgdG8gZG8gcHJvcGVyIHZhbGlkYXRpb24gb24gdGhlXG4gICAgLy8gY29tYmluZWQgYXJndW1lbnRzIChzdWNoIHRoYXQgaWYgLS10cnVzdCBoYXMgYmVlbiBnaXZlbiwgLS1jbG91ZGZvcm1hdGlvbi1leGVjdXRpb24tcG9saWNpZXMgaXMgbmVjZXNzYXJ5IGFzIHdlbGwpXG4gICAgLy8gd2UgbmVlZCB0byB0YWtlIHRoaXMgcGFyYW1ldGVyIHJldXNlIGludG8gYWNjb3VudC5cbiAgICAvL1xuICAgIC8vIElkZWFsbHkgd2UnZCBkbyB0aGlzIGluc2lkZSB0aGUgdGVtcGxhdGUsIGJ1dCB0aGUgYFJ1bGVzYCBzZWN0aW9uIG9mIENGTlxuICAgIC8vIHRlbXBsYXRlcyBkb2Vzbid0IHNlZW0gdG8gYmUgYWJsZSB0byBleHByZXNzIHRoZSBjb25kaXRpb25zIHRoYXQgd2UgbmVlZFxuICAgIC8vIChjYW4ndCB1c2UgRm46OkpvaW4gb3IgcmVmZXJlbmNlIENvbmRpdGlvbnMpIHNvIHdlIGRvIGl0IGhlcmUgaW5zdGVhZC5cbiAgICBjb25zdCB0cnVzdGVkQWNjb3VudHMgPSBwYXJhbXMudHJ1c3RlZEFjY291bnRzID8/IHNwbGl0Q2ZuQXJyYXkoY3VycmVudC5wYXJhbWV0ZXJzLlRydXN0ZWRBY2NvdW50cyk7XG4gICAgaW5mbyhgVHJ1c3RlZCBhY2NvdW50cyBmb3IgZGVwbG95bWVudDogJHt0cnVzdGVkQWNjb3VudHMubGVuZ3RoID4gMCA/IHRydXN0ZWRBY2NvdW50cy5qb2luKCcsICcpIDogJyhub25lKSd9YCk7XG5cbiAgICBjb25zdCB0cnVzdGVkQWNjb3VudHNGb3JMb29rdXAgPVxuICAgICAgcGFyYW1zLnRydXN0ZWRBY2NvdW50c0Zvckxvb2t1cCA/PyBzcGxpdENmbkFycmF5KGN1cnJlbnQucGFyYW1ldGVycy5UcnVzdGVkQWNjb3VudHNGb3JMb29rdXApO1xuICAgIGluZm8oXG4gICAgICBgVHJ1c3RlZCBhY2NvdW50cyBmb3IgbG9va3VwOiAke3RydXN0ZWRBY2NvdW50c0Zvckxvb2t1cC5sZW5ndGggPiAwID8gdHJ1c3RlZEFjY291bnRzRm9yTG9va3VwLmpvaW4oJywgJykgOiAnKG5vbmUpJ31gLFxuICAgICk7XG5cbiAgICBjb25zdCBjbG91ZEZvcm1hdGlvbkV4ZWN1dGlvblBvbGljaWVzID1cbiAgICAgIHBhcmFtcy5jbG91ZEZvcm1hdGlvbkV4ZWN1dGlvblBvbGljaWVzID8/IHNwbGl0Q2ZuQXJyYXkoY3VycmVudC5wYXJhbWV0ZXJzLkNsb3VkRm9ybWF0aW9uRXhlY3V0aW9uUG9saWNpZXMpO1xuICAgIGlmICh0cnVzdGVkQWNjb3VudHMubGVuZ3RoID09PSAwICYmIGNsb3VkRm9ybWF0aW9uRXhlY3V0aW9uUG9saWNpZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAvLyBGb3Igc2VsZi10cnVzdCBpdCdzIG9rYXkgdG8gZGVmYXVsdCB0byBBZG1pbmlzdHJhdG9yQWNjZXNzLCBhbmQgaXQgaW1wcm92ZXMgdGhlIHVzYWJpbGl0eSBvZiBib290c3RyYXBwaW5nIGEgbG90LlxuICAgICAgLy9cbiAgICAgIC8vIFdlIGRvbid0IGFjdHVhbGx5IG1ha2UgdGhlIGltcGxpY2l0bHkgcG9saWN5IGEgcGh5c2ljYWwgcGFyYW1ldGVyLiBUaGUgdGVtcGxhdGUgd2lsbCBpbmZlciBpdCBpbnN0ZWFkLFxuICAgICAgLy8gd2Ugc2ltcGx5IGRvIHRoZSBVSSBhZHZlcnRpc2luZyB0aGF0IGJlaGF2aW9yIGhlcmUuXG4gICAgICAvL1xuICAgICAgLy8gSWYgd2UgRElEIG1ha2UgaXQgYW4gZXhwbGljaXQgcGFyYW1ldGVyLCB3ZSB3b3VsZG4ndCBiZSBhYmxlIHRvIHRlbGwgdGhlIGRpZmZlcmVuY2UgYmV0d2VlbiB3aGV0aGVyXG4gICAgICAvLyB3ZSBpbmZlcnJlZCBpdCBvciB3aGV0aGVyIHRoZSB1c2VyIHRvbGQgdXMsIGFuZCB0aGUgc2VxdWVuY2U6XG4gICAgICAvL1xuICAgICAgLy8gJCBjZGsgYm9vdHN0cmFwXG4gICAgICAvLyAkIGNkayBib290c3RyYXAgLS10cnVzdCAxMjM0XG4gICAgICAvL1xuICAgICAgLy8gV291bGQgbGVhdmUgQWRtaW5pc3RyYXRvckFjY2VzcyBwb2xpY2llcyB3aXRoIGEgdHJ1c3QgcmVsYXRpb25zaGlwLCB3aXRob3V0IHRoZSB1c2VyIGV4cGxpY2l0bHlcbiAgICAgIC8vIGFwcHJvdmluZyB0aGUgdHJ1c3QgcG9saWN5LlxuICAgICAgY29uc3QgaW1wbGljaXRQb2xpY3kgPSBgYXJuOiR7cGFydGl0aW9ufTppYW06OmF3czpwb2xpY3kvQWRtaW5pc3RyYXRvckFjY2Vzc2A7XG4gICAgICB3YXJuaW5nKFxuICAgICAgICBgVXNpbmcgZGVmYXVsdCBleGVjdXRpb24gcG9saWN5IG9mICcke2ltcGxpY2l0UG9saWN5fScuIFBhc3MgJy0tY2xvdWRmb3JtYXRpb24tZXhlY3V0aW9uLXBvbGljaWVzJyB0byBjdXN0b21pemUuYCxcbiAgICAgICk7XG4gICAgfSBlbHNlIGlmIChjbG91ZEZvcm1hdGlvbkV4ZWN1dGlvblBvbGljaWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgUGxlYXNlIHBhc3MgXFwnLS1jbG91ZGZvcm1hdGlvbi1leGVjdXRpb24tcG9saWNpZXNcXCcgd2hlbiB1c2luZyBcXCctLXRydXN0XFwnIHRvIHNwZWNpZnkgZGVwbG95bWVudCBwZXJtaXNzaW9ucy4gVHJ5IGEgbWFuYWdlZCBwb2xpY3kgb2YgdGhlIGZvcm0gXFwnYXJuOiR7cGFydGl0aW9ufTppYW06OmF3czpwb2xpY3kvPFBvbGljeU5hbWU+XFwnLmAsXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZW1pbmQgcGVvcGxlIHdoYXQgdGhlIGN1cnJlbnQgc2V0dGluZ3MgYXJlXG4gICAgICBpbmZvKGBFeGVjdXRpb24gcG9saWNpZXM6ICR7Y2xvdWRGb3JtYXRpb25FeGVjdXRpb25Qb2xpY2llcy5qb2luKCcsICcpfWApO1xuICAgIH1cblxuICAgIC8vICogSWYgYW4gQVJOIGlzIGdpdmVuLCB0aGF0IEFSTi4gT3RoZXJ3aXNlOlxuICAgIC8vICAgKiAnLScgaWYgY3VzdG9tZXJLZXkgPSBmYWxzZVxuICAgIC8vICAgKiAnJyBpZiBjdXN0b21lcktleSA9IHRydWVcbiAgICAvLyAgICogaWYgY3VzdG9tZXJLZXkgaXMgYWxzbyBub3QgZ2l2ZW5cbiAgICAvLyAgICAgKiB1bmRlZmluZWQgaWYgd2UgYWxyZWFkeSBoYWQgYSB2YWx1ZSBpbiBwbGFjZSAocmV1c2luZyB3aGF0IHdlIGhhZClcbiAgICAvLyAgICAgKiAnLScgaWYgdGhpcyBpcyB0aGUgZmlyc3QgdGltZSB3ZSdyZSBkZXBsb3lpbmcgdGhpcyBzdGFjayAob3IgdXBncmFkaW5nIGZyb20gb2xkIHRvIG5ldyBib290c3RyYXApXG4gICAgY29uc3QgY3VycmVudEttc0tleUlkID0gY3VycmVudC5wYXJhbWV0ZXJzLkZpbGVBc3NldHNCdWNrZXRLbXNLZXlJZDtcbiAgICBjb25zdCBrbXNLZXlJZCA9XG4gICAgICBwYXJhbXMua21zS2V5SWQgPz9cbiAgICAgIChwYXJhbXMuY3JlYXRlQ3VzdG9tZXJNYXN0ZXJLZXkgPT09IHRydWVcbiAgICAgICAgPyBDUkVBVEVfTkVXX0tFWVxuICAgICAgICA6IHBhcmFtcy5jcmVhdGVDdXN0b21lck1hc3RlcktleSA9PT0gZmFsc2UgfHwgY3VycmVudEttc0tleUlkID09PSB1bmRlZmluZWRcbiAgICAgICAgICA/IFVTRV9BV1NfTUFOQUdFRF9LRVlcbiAgICAgICAgICA6IHVuZGVmaW5lZCk7XG5cbiAgICAvKiBBIHBlcm1pc3Npb25zIGJvdW5kYXJ5IGNhbiBiZSBwcm92aWRlZCB2aWE6XG4gICAgICogICAgLSB0aGUgZmxhZyBpbmRpY2F0aW5nIHRoZSBleGFtcGxlIG9uZSBzaG91bGQgYmUgdXNlZFxuICAgICAqICAgIC0gdGhlIG5hbWUgaW5kaWNhdGluZyB0aGUgY3VzdG9tIHBlcm1pc3Npb25zIGJvdW5kYXJ5IHRvIGJlIHVzZWRcbiAgICAgKiBSZS1ib290c3RyYXBwaW5nIHdpbGwgTk9UIGJlIGJsb2NrZWQgYnkgZWl0aGVyIHRpZ2h0ZW5pbmcgb3IgcmVsYXhpbmcgdGhlIHBlcm1pc3Npb25zJyBib3VuZGFyeS5cbiAgICAgKi9cblxuICAgIC8vIElucHV0UGVybWlzc2lvbnNCb3VuZGFyeSBpcyBhbiBgYW55YCB0eXBlIGFuZCBpZiBpdCBpcyBub3QgZGVmaW5lZCBpdFxuICAgIC8vIGFwcGVhcnMgYXMgYW4gZW1wdHkgc3RyaW5nICcnLiBXZSBuZWVkIHRvIGZvcmNlIGl0IHRvIGV2YWx1YXRlIGFuIGVtcHR5IHN0cmluZ1xuICAgIC8vIGFzIHVuZGVmaW5lZFxuICAgIGNvbnN0IGN1cnJlbnRQZXJtaXNzaW9uc0JvdW5kYXJ5OiBzdHJpbmcgfCB1bmRlZmluZWQgPSBjdXJyZW50LnBhcmFtZXRlcnMuSW5wdXRQZXJtaXNzaW9uc0JvdW5kYXJ5IHx8IHVuZGVmaW5lZDtcbiAgICBjb25zdCBpbnB1dFBvbGljeU5hbWUgPSBwYXJhbXMuZXhhbXBsZVBlcm1pc3Npb25zQm91bmRhcnlcbiAgICAgID8gQ0RLX0JPT1RTVFJBUF9QRVJNSVNTSU9OU19CT1VOREFSWVxuICAgICAgOiBwYXJhbXMuY3VzdG9tUGVybWlzc2lvbnNCb3VuZGFyeTtcbiAgICBsZXQgcG9saWN5TmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIGlmIChpbnB1dFBvbGljeU5hbWUpIHtcbiAgICAgIC8vIElmIHRoZSBleGFtcGxlIHBvbGljeSBpcyBub3QgYWxyZWFkeSBpbiBwbGFjZSwgaXQgbXVzdCBiZSBjcmVhdGVkLlxuICAgICAgY29uc3Qgc2RrID0gKGF3YWl0IHNka1Byb3ZpZGVyLmZvckVudmlyb25tZW50KGVudmlyb25tZW50LCBNb2RlLkZvcldyaXRpbmcpKS5zZGs7XG4gICAgICBwb2xpY3lOYW1lID0gYXdhaXQgdGhpcy5nZXRQb2xpY3lOYW1lKGVudmlyb25tZW50LCBzZGssIGlucHV0UG9saWN5TmFtZSwgcGFydGl0aW9uLCBwYXJhbXMpO1xuICAgIH1cbiAgICBpZiAoY3VycmVudFBlcm1pc3Npb25zQm91bmRhcnkgIT09IHBvbGljeU5hbWUpIHtcbiAgICAgIGlmICghY3VycmVudFBlcm1pc3Npb25zQm91bmRhcnkpIHtcbiAgICAgICAgd2FybmluZyhgQWRkaW5nIG5ldyBwZXJtaXNzaW9ucyBib3VuZGFyeSAke3BvbGljeU5hbWV9YCk7XG4gICAgICB9IGVsc2UgaWYgKCFwb2xpY3lOYW1lKSB7XG4gICAgICAgIHdhcm5pbmcoYFJlbW92aW5nIGV4aXN0aW5nIHBlcm1pc3Npb25zIGJvdW5kYXJ5ICR7Y3VycmVudFBlcm1pc3Npb25zQm91bmRhcnl9YCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB3YXJuaW5nKGBDaGFuZ2luZyBwZXJtaXNzaW9ucyBib3VuZGFyeSBmcm9tICR7Y3VycmVudFBlcm1pc3Npb25zQm91bmRhcnl9IHRvICR7cG9saWN5TmFtZX1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gY3VycmVudC51cGRhdGUoXG4gICAgICBib290c3RyYXBUZW1wbGF0ZSxcbiAgICAgIHtcbiAgICAgICAgRmlsZUFzc2V0c0J1Y2tldE5hbWU6IHBhcmFtcy5idWNrZXROYW1lLFxuICAgICAgICBGaWxlQXNzZXRzQnVja2V0S21zS2V5SWQ6IGttc0tleUlkLFxuICAgICAgICAvLyBFbXB0eSBhcnJheSBiZWNvbWVzIGVtcHR5IHN0cmluZ1xuICAgICAgICBUcnVzdGVkQWNjb3VudHM6IHRydXN0ZWRBY2NvdW50cy5qb2luKCcsJyksXG4gICAgICAgIFRydXN0ZWRBY2NvdW50c0Zvckxvb2t1cDogdHJ1c3RlZEFjY291bnRzRm9yTG9va3VwLmpvaW4oJywnKSxcbiAgICAgICAgQ2xvdWRGb3JtYXRpb25FeGVjdXRpb25Qb2xpY2llczogY2xvdWRGb3JtYXRpb25FeGVjdXRpb25Qb2xpY2llcy5qb2luKCcsJyksXG4gICAgICAgIFF1YWxpZmllcjogcGFyYW1zLnF1YWxpZmllcixcbiAgICAgICAgUHVibGljQWNjZXNzQmxvY2tDb25maWd1cmF0aW9uOlxuICAgICAgICAgIHBhcmFtcy5wdWJsaWNBY2Nlc3NCbG9ja0NvbmZpZ3VyYXRpb24gfHwgcGFyYW1zLnB1YmxpY0FjY2Vzc0Jsb2NrQ29uZmlndXJhdGlvbiA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/ICd0cnVlJ1xuICAgICAgICAgICAgOiAnZmFsc2UnLFxuICAgICAgICBJbnB1dFBlcm1pc3Npb25zQm91bmRhcnk6IHBvbGljeU5hbWUsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICAuLi5vcHRpb25zLFxuICAgICAgICB0ZXJtaW5hdGlvblByb3RlY3Rpb246IG9wdGlvbnMudGVybWluYXRpb25Qcm90ZWN0aW9uID8/IGN1cnJlbnQudGVybWluYXRpb25Qcm90ZWN0aW9uLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRQb2xpY3lOYW1lKFxuICAgIGVudmlyb25tZW50OiBjeGFwaS5FbnZpcm9ubWVudCxcbiAgICBzZGs6IFNESyxcbiAgICBwZXJtaXNzaW9uc0JvdW5kYXJ5OiBzdHJpbmcsXG4gICAgcGFydGl0aW9uOiBzdHJpbmcsXG4gICAgcGFyYW1zOiBCb290c3RyYXBwaW5nUGFyYW1ldGVycyxcbiAgKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBpZiAocGVybWlzc2lvbnNCb3VuZGFyeSAhPT0gQ0RLX0JPT1RTVFJBUF9QRVJNSVNTSU9OU19CT1VOREFSWSkge1xuICAgICAgdGhpcy52YWxpZGF0ZVBvbGljeU5hbWUocGVybWlzc2lvbnNCb3VuZGFyeSk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHBlcm1pc3Npb25zQm91bmRhcnkpO1xuICAgIH1cbiAgICAvLyBpZiBubyBRdWFsaWZpZXIgaXMgc3VwcGxpZWQsIHJlc29ydCB0byB0aGUgZGVmYXVsdCBvbmVcbiAgICBjb25zdCBhcm4gPSBhd2FpdCB0aGlzLmdldEV4YW1wbGVQZXJtaXNzaW9uc0JvdW5kYXJ5KFxuICAgICAgcGFyYW1zLnF1YWxpZmllciA/PyAnaG5iNjU5ZmRzJyxcbiAgICAgIHBhcnRpdGlvbixcbiAgICAgIGVudmlyb25tZW50LmFjY291bnQsXG4gICAgICBzZGssXG4gICAgKTtcbiAgICBjb25zdCBwb2xpY3lOYW1lID0gYXJuLnNwbGl0KCcvJykucG9wKCk7XG4gICAgaWYgKCFwb2xpY3lOYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvdWxkIG5vdCByZXRyaWV2ZSB0aGUgZXhhbXBsZSBwZXJtaXNzaW9uIGJvdW5kYXJ5IScpO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHBvbGljeU5hbWUpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRFeGFtcGxlUGVybWlzc2lvbnNCb3VuZGFyeShcbiAgICBxdWFsaWZpZXI6IHN0cmluZyxcbiAgICBwYXJ0aXRpb246IHN0cmluZyxcbiAgICBhY2NvdW50OiBzdHJpbmcsXG4gICAgc2RrOiBTREssXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3QgaWFtID0gc2RrLmlhbSgpO1xuXG4gICAgbGV0IHBvbGljeU5hbWUgPSBgY2RrLSR7cXVhbGlmaWVyfS1wZXJtaXNzaW9ucy1ib3VuZGFyeWA7XG4gICAgY29uc3QgYXJuID0gYGFybjoke3BhcnRpdGlvbn06aWFtOjoke2FjY291bnR9OnBvbGljeS8ke3BvbGljeU5hbWV9YDtcblxuICAgIHRyeSB7XG4gICAgICBsZXQgZ2V0UG9saWN5UmVzcCA9IGF3YWl0IGlhbS5nZXRQb2xpY3koeyBQb2xpY3lBcm46IGFybiB9KTtcbiAgICAgIGlmIChnZXRQb2xpY3lSZXNwLlBvbGljeSkge1xuICAgICAgICByZXR1cm4gYXJuO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgLy8gaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0lBTS9sYXRlc3QvQVBJUmVmZXJlbmNlL0FQSV9HZXRQb2xpY3kuaHRtbCNBUElfR2V0UG9saWN5X0Vycm9yc1xuICAgICAgaWYgKGUubmFtZSA9PT0gJ05vU3VjaEVudGl0eScpIHtcbiAgICAgICAgLy9ub29wLCBwcm9jZWVkIHdpdGggY3JlYXRpbmcgdGhlIHBvbGljeVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBwb2xpY3lEb2MgPSB7XG4gICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gICAgICBTdGF0ZW1lbnQ6IFtcbiAgICAgICAge1xuICAgICAgICAgIEFjdGlvbjogWycqJ10sXG4gICAgICAgICAgUmVzb3VyY2U6ICcqJyxcbiAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICAgICAgU2lkOiAnRXhwbGljaXRBbGxvd0FsbCcsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBDb25kaXRpb246IHtcbiAgICAgICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICAgICAnaWFtOlBlcm1pc3Npb25zQm91bmRhcnknOiBgYXJuOiR7cGFydGl0aW9ufTppYW06OiR7YWNjb3VudH06cG9saWN5L2Nkay0ke3F1YWxpZmllcn0tcGVybWlzc2lvbnMtYm91bmRhcnlgLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIEFjdGlvbjogW1xuICAgICAgICAgICAgJ2lhbTpDcmVhdGVVc2VyJyxcbiAgICAgICAgICAgICdpYW06Q3JlYXRlUm9sZScsXG4gICAgICAgICAgICAnaWFtOlB1dFJvbGVQZXJtaXNzaW9uc0JvdW5kYXJ5JyxcbiAgICAgICAgICAgICdpYW06UHV0VXNlclBlcm1pc3Npb25zQm91bmRhcnknLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgUmVzb3VyY2U6ICcqJyxcbiAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICAgICAgU2lkOiAnRGVueUFjY2Vzc0lmUmVxdWlyZWRQZXJtQm91bmRhcnlJc05vdEJlaW5nQXBwbGllZCcsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBBY3Rpb246IFtcbiAgICAgICAgICAgICdpYW06Q3JlYXRlUG9saWN5VmVyc2lvbicsXG4gICAgICAgICAgICAnaWFtOkRlbGV0ZVBvbGljeScsXG4gICAgICAgICAgICAnaWFtOkRlbGV0ZVBvbGljeVZlcnNpb24nLFxuICAgICAgICAgICAgJ2lhbTpTZXREZWZhdWx0UG9saWN5VmVyc2lvbicsXG4gICAgICAgICAgXSxcbiAgICAgICAgICBSZXNvdXJjZTogYGFybjoke3BhcnRpdGlvbn06aWFtOjoke2FjY291bnR9OnBvbGljeS9jZGstJHtxdWFsaWZpZXJ9LXBlcm1pc3Npb25zLWJvdW5kYXJ5YCxcbiAgICAgICAgICBFZmZlY3Q6ICdEZW55JyxcbiAgICAgICAgICBTaWQ6ICdEZW55UGVybUJvdW5kYXJ5SUFNUG9saWN5QWx0ZXJhdGlvbicsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBBY3Rpb246IFsnaWFtOkRlbGV0ZVVzZXJQZXJtaXNzaW9uc0JvdW5kYXJ5JywgJ2lhbTpEZWxldGVSb2xlUGVybWlzc2lvbnNCb3VuZGFyeSddLFxuICAgICAgICAgIFJlc291cmNlOiAnKicsXG4gICAgICAgICAgRWZmZWN0OiAnRGVueScsXG4gICAgICAgICAgU2lkOiAnRGVueVJlbW92YWxPZlBlcm1Cb3VuZGFyeUZyb21BbnlVc2VyT3JSb2xlJyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfTtcbiAgICBjb25zdCByZXF1ZXN0ID0ge1xuICAgICAgUG9saWN5TmFtZTogcG9saWN5TmFtZSxcbiAgICAgIFBvbGljeURvY3VtZW50OiBKU09OLnN0cmluZ2lmeShwb2xpY3lEb2MpLFxuICAgIH07XG4gICAgY29uc3QgY3JlYXRlUG9saWN5UmVzcG9uc2UgPSBhd2FpdCBpYW0uY3JlYXRlUG9saWN5KHJlcXVlc3QpO1xuICAgIGlmIChjcmVhdGVQb2xpY3lSZXNwb25zZS5Qb2xpY3k/LkFybikge1xuICAgICAgcmV0dXJuIGNyZWF0ZVBvbGljeVJlc3BvbnNlLlBvbGljeS5Bcm47XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGQgbm90IHJldHJpZXZlIHRoZSBleGFtcGxlIHBlcm1pc3Npb24gYm91bmRhcnkgJHthcm59IWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVQb2xpY3lOYW1lKHBlcm1pc3Npb25zQm91bmRhcnk6IHN0cmluZykge1xuICAgIC8vIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9JQU0vbGF0ZXN0L0FQSVJlZmVyZW5jZS9BUElfQ3JlYXRlUG9saWN5Lmh0bWxcbiAgICAvLyBBZGRlZCBzdXBwb3J0IGZvciBwb2xpY3kgbmFtZXMgd2l0aCBhIHBhdGhcbiAgICAvLyBTZWUgaHR0cHM6Ly9naXRodWIuY29tL2F3cy9hd3MtY2RrL2lzc3Vlcy8yNjMyMFxuICAgIGNvbnN0IHJlZ2V4cDogUmVnRXhwID0gL1tcXHcrXFwvPSwuQC1dKy87XG4gICAgY29uc3QgbWF0Y2hlcyA9IHJlZ2V4cC5leGVjKHBlcm1pc3Npb25zQm91bmRhcnkpO1xuICAgIGlmICghKG1hdGNoZXMgJiYgbWF0Y2hlcy5sZW5ndGggPT09IDEgJiYgbWF0Y2hlc1swXSA9PT0gcGVybWlzc2lvbnNCb3VuZGFyeSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGhlIHBlcm1pc3Npb25zIGJvdW5kYXJ5IG5hbWUgJHtwZXJtaXNzaW9uc0JvdW5kYXJ5fSBkb2VzIG5vdCBtYXRjaCB0aGUgSUFNIGNvbnZlbnRpb25zLmApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY3VzdG9tQm9vdHN0cmFwKFxuICAgIGVudmlyb25tZW50OiBjeGFwaS5FbnZpcm9ubWVudCxcbiAgICBzZGtQcm92aWRlcjogU2RrUHJvdmlkZXIsXG4gICAgb3B0aW9uczogQm9vdHN0cmFwRW52aXJvbm1lbnRPcHRpb25zID0ge30sXG4gICk6IFByb21pc2U8U3VjY2Vzc2Z1bERlcGxveVN0YWNrUmVzdWx0PiB7XG4gICAgLy8gTG9vayBhdCB0aGUgdGVtcGxhdGUsIGRlY2lkZSB3aGV0aGVyIGl0J3MgbW9zdCBsaWtlbHkgYSBsZWdhY3kgb3IgbW9kZXJuIGJvb3RzdHJhcFxuICAgIC8vIHRlbXBsYXRlLCBhbmQgdXNlIHRoZSByaWdodCBib290c3RyYXBwZXIgZm9yIHRoYXQuXG4gICAgY29uc3QgdmVyc2lvbiA9IGJvb3RzdHJhcFZlcnNpb25Gcm9tVGVtcGxhdGUoYXdhaXQgdGhpcy5sb2FkVGVtcGxhdGUoKSk7XG4gICAgaWYgKHZlcnNpb24gPT09IDApIHtcbiAgICAgIHJldHVybiB0aGlzLmxlZ2FjeUJvb3RzdHJhcChlbnZpcm9ubWVudCwgc2RrUHJvdmlkZXIsIG9wdGlvbnMpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdGhpcy5tb2Rlcm5Cb290c3RyYXAoZW52aXJvbm1lbnQsIHNka1Byb3ZpZGVyLCBvcHRpb25zKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGxvYWRUZW1wbGF0ZShwYXJhbXM6IEJvb3RzdHJhcHBpbmdQYXJhbWV0ZXJzID0ge30pOiBQcm9taXNlPGFueT4ge1xuICAgIHN3aXRjaCAodGhpcy5zb3VyY2Uuc291cmNlKSB7XG4gICAgICBjYXNlICdjdXN0b20nOlxuICAgICAgICByZXR1cm4gbG9hZFN0cnVjdHVyZWRGaWxlKHRoaXMuc291cmNlLnRlbXBsYXRlRmlsZSk7XG4gICAgICBjYXNlICdkZWZhdWx0JzpcbiAgICAgICAgcmV0dXJuIGxvYWRTdHJ1Y3R1cmVkRmlsZShwYXRoLmpvaW4ocm9vdERpcigpLCAnbGliJywgJ2FwaScsICdib290c3RyYXAnLCAnYm9vdHN0cmFwLXRlbXBsYXRlLnlhbWwnKSk7XG4gICAgICBjYXNlICdsZWdhY3knOlxuICAgICAgICByZXR1cm4gbGVnYWN5Qm9vdHN0cmFwVGVtcGxhdGUocGFyYW1zKTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBNYWdpYyBwYXJhbWV0ZXIgdmFsdWUgdGhhdCB3aWxsIGNhdXNlIHRoZSBib290c3RyYXAtdGVtcGxhdGUueW1sIHRvIE5PVCBjcmVhdGUgYSBDTUsgYnV0IHVzZSB0aGUgZGVmYXVsdCBrZXlcbiAqL1xuY29uc3QgVVNFX0FXU19NQU5BR0VEX0tFWSA9ICdBV1NfTUFOQUdFRF9LRVknO1xuXG4vKipcbiAqIE1hZ2ljIHBhcmFtZXRlciB2YWx1ZSB0aGF0IHdpbGwgY2F1c2UgdGhlIGJvb3RzdHJhcC10ZW1wbGF0ZS55bWwgdG8gY3JlYXRlIGEgQ01LXG4gKi9cbmNvbnN0IENSRUFURV9ORVdfS0VZID0gJyc7XG4vKipcbiAqIFBhcmFtZXRlciB2YWx1ZSBpbmRpY2F0aW5nIHRoZSB1c2Ugb2YgdGhlIGRlZmF1bHQsIENESyBwcm92aWRlZCBwZXJtaXNzaW9ucyBib3VuZGFyeSBmb3IgYm9vdHN0cmFwLXRlbXBsYXRlLnltbFxuICovXG5jb25zdCBDREtfQk9PVFNUUkFQX1BFUk1JU1NJT05TX0JPVU5EQVJZID0gJ0NES19CT09UU1RSQVBfUEVSTUlTU0lPTlNfQk9VTkRBUlknO1xuXG4vKipcbiAqIFNwbGl0IGFuIGFycmF5LWxpa2UgQ2xvdWRGb3JtYXRpb24gcGFyYW1ldGVyIG9uICxcbiAqXG4gKiBBbiBlbXB0eSBzdHJpbmcgaXMgdGhlIGVtcHR5IGFycmF5IChpbnN0ZWFkIG9mIGBbJyddYCkuXG4gKi9cbmZ1bmN0aW9uIHNwbGl0Q2ZuQXJyYXkoeHM6IHN0cmluZyB8IHVuZGVmaW5lZCk6IHN0cmluZ1tdIHtcbiAgaWYgKHhzID09PSAnJyB8fCB4cyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG4gIHJldHVybiB4cy5zcGxpdCgnLCcpO1xufVxuIl19