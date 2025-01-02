"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnvironmentAccess = void 0;
const logging_1 = require("../logging");
const environment_resources_1 = require("./environment-resources");
const plugin_1 = require("./plugin");
const placeholders_1 = require("./util/placeholders");
/**
 * Access particular AWS resources, based on information from the CX manifest
 *
 * It is not possible to grab direct access to AWS credentials; 9 times out of 10
 * we have to allow for role assumption, and role assumption can only work if
 * there is a CX Manifest that contains a role ARN.
 *
 * This class exists so new code isn't tempted to go and get SDK credentials directly.
 */
class EnvironmentAccess {
    constructor(sdkProvider, toolkitStackName) {
        this.sdkProvider = sdkProvider;
        this.sdkCache = new Map();
        this.environmentResources = new environment_resources_1.EnvironmentResourcesRegistry(toolkitStackName);
    }
    /**
     * Resolves the environment for a stack.
     */
    async resolveStackEnvironment(stack) {
        return this.sdkProvider.resolveEnvironment(stack.environment);
    }
    /**
     * Get an SDK to access the given stack's environment for stack operations
     *
     * Will ask plugins for readonly credentials if available, use the default
     * AWS credentials if not.
     *
     * Will assume the deploy role if configured on the stack. Check the default `deploy-role`
     * policies to see what you can do with this role.
     */
    async accessStackForReadOnlyStackOperations(stack) {
        return this.accessStackForStackOperations(stack, plugin_1.Mode.ForReading);
    }
    /**
     * Get an SDK to access the given stack's environment for stack operations
     *
     * Will ask plugins for mutating credentials if available, use the default AWS
     * credentials if not.  The `mode` parameter is only used for querying
     * plugins.
     *
     * Will assume the deploy role if configured on the stack. Check the default `deploy-role`
     * policies to see what you can do with this role.
     */
    async accessStackForMutableStackOperations(stack) {
        return this.accessStackForStackOperations(stack, plugin_1.Mode.ForWriting);
    }
    /**
     * Get an SDK to access the given stack's environment for environmental lookups
     *
     * Will use a plugin if available, use the default AWS credentials if not.
     * The `mode` parameter is only used for querying plugins.
     *
     * Will assume the lookup role if configured on the stack. Check the default `lookup-role`
     * policies to see what you can do with this role. It can generally read everything
     * in the account that does not require KMS access.
     *
     * ---
     *
     * For backwards compatibility reasons, there are some scenarios that are handled here:
     *
     *  1. The lookup role may not exist (it was added in bootstrap stack version 7). If so:
     *     a. Return the default credentials if the default credentials are for the stack account
     *        (you will notice this as `isFallbackCredentials=true`).
     *     b. Throw an error if the default credentials are not for the stack account.
     *
     *  2. The lookup role may not have the correct permissions (for example, ReadOnlyAccess was added in
     *     bootstrap stack version 8); the stack will have a minimum version number on it.
     *     a. If it does not we throw an error which should be handled in the calling
     *        function (and fallback to use a different role, etc)
     *
     * Upon success, caller will have an SDK for the right account, which may or may not have
     * the right permissions.
     */
    async accessStackForLookup(stack) {
        if (!stack.environment) {
            throw new Error(`The stack ${stack.displayName} does not have an environment`);
        }
        const lookupEnv = await this.prepareSdk({
            environment: stack.environment,
            mode: plugin_1.Mode.ForReading,
            assumeRoleArn: stack.lookupRole?.arn,
            assumeRoleExternalId: stack.lookupRole?.assumeRoleExternalId,
            assumeRoleAdditionalOptions: stack.lookupRole?.assumeRoleAdditionalOptions,
        });
        // if we succeed in assuming the lookup role, make sure we have the correct bootstrap stack version
        if (lookupEnv.didAssumeRole && stack.lookupRole?.bootstrapStackVersionSsmParameter && stack.lookupRole.requiresBootstrapStackVersion) {
            const version = await lookupEnv.resources.versionFromSsmParameter(stack.lookupRole.bootstrapStackVersionSsmParameter);
            if (version < stack.lookupRole.requiresBootstrapStackVersion) {
                throw new Error(`Bootstrap stack version '${stack.lookupRole.requiresBootstrapStackVersion}' is required, found version '${version}'. To get rid of this error, please upgrade to bootstrap version >= ${stack.lookupRole.requiresBootstrapStackVersion}`);
            }
        }
        if (lookupEnv.isFallbackCredentials) {
            const arn = await lookupEnv.replacePlaceholders(stack.lookupRole?.arn);
            (0, logging_1.warning)(`Lookup role ${arn} was not assumed. Proceeding with default credentials.`);
        }
        return lookupEnv;
    }
    /**
     * Get an SDK to access the given stack's environment for reading stack attributes
     *
     * Will use a plugin if available, use the default AWS credentials if not.
     * The `mode` parameter is only used for querying plugins.
     *
     * Will try to assume the lookup role if given, will use the regular stack operations
     * access (deploy-role) otherwise. When calling this, you should assume that you will get
     * the least privileged role, so don't try to use it for anything the `deploy-role`
     * wouldn't be able to do. Also you cannot rely on being able to read encrypted anything.
     */
    async accessStackForLookupBestEffort(stack) {
        if (!stack.environment) {
            throw new Error(`The stack ${stack.displayName} does not have an environment`);
        }
        try {
            return await this.accessStackForLookup(stack);
        }
        catch (e) {
            (0, logging_1.warning)(`${e.message}`);
        }
        return this.accessStackForStackOperations(stack, plugin_1.Mode.ForReading);
    }
    /**
     * Get an SDK to access the given stack's environment for stack operations
     *
     * Will use a plugin if available, use the default AWS credentials if not.
     * The `mode` parameter is only used for querying plugins.
     *
     * Will assume the deploy role if configured on the stack. Check the default `deploy-role`
     * policies to see what you can do with this role.
     */
    async accessStackForStackOperations(stack, mode) {
        if (!stack.environment) {
            throw new Error(`The stack ${stack.displayName} does not have an environment`);
        }
        return this.prepareSdk({
            environment: stack.environment,
            mode,
            assumeRoleArn: stack.assumeRoleArn,
            assumeRoleExternalId: stack.assumeRoleExternalId,
            assumeRoleAdditionalOptions: stack.assumeRoleAdditionalOptions,
        });
    }
    /**
     * Prepare an SDK for use in the given environment and optionally with a role assumed.
     */
    async prepareSdk(options) {
        const resolvedEnvironment = await this.sdkProvider.resolveEnvironment(options.environment);
        // Substitute any placeholders with information about the current environment
        const { assumeRoleArn } = await (0, placeholders_1.replaceEnvPlaceholders)({
            assumeRoleArn: options.assumeRoleArn,
        }, resolvedEnvironment, this.sdkProvider);
        const stackSdk = await this.cachedSdkForEnvironment(resolvedEnvironment, options.mode, {
            assumeRoleArn,
            assumeRoleExternalId: options.assumeRoleExternalId,
            assumeRoleAdditionalOptions: options.assumeRoleAdditionalOptions,
        });
        return {
            sdk: stackSdk.sdk,
            resolvedEnvironment,
            resources: this.environmentResources.for(resolvedEnvironment, stackSdk.sdk),
            // If we asked for a role, did not successfully assume it, and yet got here without an exception: that
            // means we must have fallback credentials.
            isFallbackCredentials: !stackSdk.didAssumeRole && !!assumeRoleArn,
            didAssumeRole: stackSdk.didAssumeRole,
            replacePlaceholders: async (str) => {
                const ret = await (0, placeholders_1.replaceEnvPlaceholders)({ str }, resolvedEnvironment, this.sdkProvider);
                return ret.str;
            },
        };
    }
    async cachedSdkForEnvironment(environment, mode, options) {
        const cacheKeyElements = [
            environment.account,
            environment.region,
            `${mode}`,
            options?.assumeRoleArn ?? '',
            options?.assumeRoleExternalId ?? '',
        ];
        if (options?.assumeRoleAdditionalOptions) {
            cacheKeyElements.push(JSON.stringify(options.assumeRoleAdditionalOptions));
        }
        const cacheKey = cacheKeyElements.join(':');
        const existing = this.sdkCache.get(cacheKey);
        if (existing) {
            return existing;
        }
        const ret = await this.sdkProvider.forEnvironment(environment, mode, options);
        this.sdkCache.set(cacheKey, ret);
        return ret;
    }
}
exports.EnvironmentAccess = EnvironmentAccess;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW52aXJvbm1lbnQtYWNjZXNzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZW52aXJvbm1lbnQtYWNjZXNzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLHdDQUFxQztBQUVyQyxtRUFBNkY7QUFDN0YscUNBQWdDO0FBQ2hDLHNEQUF3RjtBQUV4Rjs7Ozs7Ozs7R0FRRztBQUNILE1BQWEsaUJBQWlCO0lBSTVCLFlBQTZCLFdBQXdCLEVBQUUsZ0JBQXdCO1FBQWxELGdCQUFXLEdBQVgsV0FBVyxDQUFhO1FBSHBDLGFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBNkIsQ0FBQztRQUkvRCxJQUFJLENBQUMsb0JBQW9CLEdBQUcsSUFBSSxvREFBNEIsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO0lBQ2pGLENBQUM7SUFFRDs7T0FFRztJQUNJLEtBQUssQ0FBQyx1QkFBdUIsQ0FBQyxLQUF3QztRQUMzRSxPQUFPLElBQUksQ0FBQyxXQUFXLENBQUMsa0JBQWtCLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQ2hFLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNJLEtBQUssQ0FBQyxxQ0FBcUMsQ0FBQyxLQUF3QztRQUN6RixPQUFPLElBQUksQ0FBQyw2QkFBNkIsQ0FBQyxLQUFLLEVBQUUsYUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQ3BFLENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSSxLQUFLLENBQUMsb0NBQW9DLENBQUMsS0FBd0M7UUFDeEYsT0FBTyxJQUFJLENBQUMsNkJBQTZCLENBQUMsS0FBSyxFQUFFLGFBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQztJQUNwRSxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O09BMEJHO0lBQ0ksS0FBSyxDQUFDLG9CQUFvQixDQUFDLEtBQXdDO1FBQ3hFLElBQUksQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDdkIsTUFBTSxJQUFJLEtBQUssQ0FBQyxhQUFhLEtB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QUMsT0FBTztZQUNuQixXQUFXLENBQUMsTUFBTTtZQUNsQixHQUFHLElBQUksRUFBRTtZQUNULE9BQU8sRUFBRSxhQUFhLElBQUksRUFBRTtZQUM1QixPQUFPLEVBQUUsb0JBQW9CLElBQUksRUFBRTtTQUNwQyxDQUFDO1FBRUYsSUFBSSxPQUFPLEVBQUUsMkJBQTJCLEVBQUUsQ0FBQztZQUN6QyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsMkJBQTJCLENBQUMsQ0FBQyxDQUFDO1FBQzdFLENBQUM7UUFFRCxNQUFNLFFBQVEsR0FBRyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDNUMsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDN0MsSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUNiLE9BQU8sUUFBUSxDQUFDO1FBQ2xCLENBQUM7UUFDRCxNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxXQUFXLENBQUMsY0FBYyxDQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFDOUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ2pDLE9BQU8sR0FBRyxDQUFDO0lBQ2IsQ0FBQztDQUNGO0FBM01ELDhDQTJNQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGN4YXBpIGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgeyBTREsgfSBmcm9tICcuL2F3cy1hdXRoJztcbmltcG9ydCB7IHdhcm5pbmcgfSBmcm9tICcuLi9sb2dnaW5nJztcbmltcG9ydCB7IENyZWRlbnRpYWxzT3B0aW9ucywgU2RrRm9yRW52aXJvbm1lbnQsIFNka1Byb3ZpZGVyIH0gZnJvbSAnLi9hd3MtYXV0aC9zZGstcHJvdmlkZXInO1xuaW1wb3J0IHsgRW52aXJvbm1lbnRSZXNvdXJjZXMsIEVudmlyb25tZW50UmVzb3VyY2VzUmVnaXN0cnkgfSBmcm9tICcuL2Vudmlyb25tZW50LXJlc291cmNlcyc7XG5pbXBvcnQgeyBNb2RlIH0gZnJvbSAnLi9wbHVnaW4nO1xuaW1wb3J0IHsgcmVwbGFjZUVudlBsYWNlaG9sZGVycywgU3RyaW5nV2l0aG91dFBsYWNlaG9sZGVycyB9IGZyb20gJy4vdXRpbC9wbGFjZWhvbGRlcnMnO1xuXG4vKipcbiAqIEFjY2VzcyBwYXJ0aWN1bGFyIEFXUyByZXNvdXJjZXMsIGJhc2VkIG9uIGluZm9ybWF0aW9uIGZyb20gdGhlIENYIG1hbmlmZXN0XG4gKlxuICogSXQgaXMgbm90IHBvc3NpYmxlIHRvIGdyYWIgZGlyZWN0IGFjY2VzcyB0byBBV1MgY3JlZGVudGlhbHM7IDkgdGltZXMgb3V0IG9mIDEwXG4gKiB3ZSBoYXZlIHRvIGFsbG93IGZvciByb2xlIGFzc3VtcHRpb24sIGFuZCByb2xlIGFzc3VtcHRpb24gY2FuIG9ubHkgd29yayBpZlxuICogdGhlcmUgaXMgYSBDWCBNYW5pZmVzdCB0aGF0IGNvbnRhaW5zIGEgcm9sZSBBUk4uXG4gKlxuICogVGhpcyBjbGFzcyBleGlzdHMgc28gbmV3IGNvZGUgaXNuJ3QgdGVtcHRlZCB0byBnbyBhbmQgZ2V0IFNESyBjcmVkZW50aWFscyBkaXJlY3RseS5cbiAqL1xuZXhwb3J0IGNsYXNzIEVudmlyb25tZW50QWNjZXNzIHtcbiAgcHJpdmF0ZSByZWFkb25seSBzZGtDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBTZGtGb3JFbnZpcm9ubWVudD4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBlbnZpcm9ubWVudFJlc291cmNlczogRW52aXJvbm1lbnRSZXNvdXJjZXNSZWdpc3RyeTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlciwgdG9vbGtpdFN0YWNrTmFtZTogc3RyaW5nKSB7XG4gICAgdGhpcy5lbnZpcm9ubWVudFJlc291cmNlcyA9IG5ldyBFbnZpcm9ubWVudFJlc291cmNlc1JlZ2lzdHJ5KHRvb2xraXRTdGFja05hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBlbnZpcm9ubWVudCBmb3IgYSBzdGFjay5cbiAgICovXG4gIHB1YmxpYyBhc3luYyByZXNvbHZlU3RhY2tFbnZpcm9ubWVudChzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0KTogUHJvbWlzZTxjeGFwaS5FbnZpcm9ubWVudD4ge1xuICAgIHJldHVybiB0aGlzLnNka1Byb3ZpZGVyLnJlc29sdmVFbnZpcm9ubWVudChzdGFjay5lbnZpcm9ubWVudCk7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGFuIFNESyB0byBhY2Nlc3MgdGhlIGdpdmVuIHN0YWNrJ3MgZW52aXJvbm1lbnQgZm9yIHN0YWNrIG9wZXJhdGlvbnNcbiAgICpcbiAgICogV2lsbCBhc2sgcGx1Z2lucyBmb3IgcmVhZG9ubHkgY3JlZGVudGlhbHMgaWYgYXZhaWxhYmxlLCB1c2UgdGhlIGRlZmF1bHRcbiAgICogQVdTIGNyZWRlbnRpYWxzIGlmIG5vdC5cbiAgICpcbiAgICogV2lsbCBhc3N1bWUgdGhlIGRlcGxveSByb2xlIGlmIGNvbmZpZ3VyZWQgb24gdGhlIHN0YWNrLiBDaGVjayB0aGUgZGVmYXVsdCBgZGVwbG95LXJvbGVgXG4gICAqIHBvbGljaWVzIHRvIHNlZSB3aGF0IHlvdSBjYW4gZG8gd2l0aCB0aGlzIHJvbGUuXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgYWNjZXNzU3RhY2tGb3JSZWFkT25seVN0YWNrT3BlcmF0aW9ucyhzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0KTogUHJvbWlzZTxUYXJnZXRFbnZpcm9ubWVudD4ge1xuICAgIHJldHVybiB0aGlzLmFjY2Vzc1N0YWNrRm9yU3RhY2tPcGVyYXRpb25zKHN0YWNrLCBNb2RlLkZvclJlYWRpbmcpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBhbiBTREsgdG8gYWNjZXNzIHRoZSBnaXZlbiBzdGFjaydzIGVudmlyb25tZW50IGZvciBzdGFjayBvcGVyYXRpb25zXG4gICAqXG4gICAqIFdpbGwgYXNrIHBsdWdpbnMgZm9yIG11dGF0aW5nIGNyZWRlbnRpYWxzIGlmIGF2YWlsYWJsZSwgdXNlIHRoZSBkZWZhdWx0IEFXU1xuICAgKiBjcmVkZW50aWFscyBpZiBub3QuICBUaGUgYG1vZGVgIHBhcmFtZXRlciBpcyBvbmx5IHVzZWQgZm9yIHF1ZXJ5aW5nXG4gICAqIHBsdWdpbnMuXG4gICAqXG4gICAqIFdpbGwgYXNzdW1lIHRoZSBkZXBsb3kgcm9sZSBpZiBjb25maWd1cmVkIG9uIHRoZSBzdGFjay4gQ2hlY2sgdGhlIGRlZmF1bHQgYGRlcGxveS1yb2xlYFxuICAgKiBwb2xpY2llcyB0byBzZWUgd2hhdCB5b3UgY2FuIGRvIHdpdGggdGhpcyByb2xlLlxuICAgKi9cbiAgcHVibGljIGFzeW5jIGFjY2Vzc1N0YWNrRm9yTXV0YWJsZVN0YWNrT3BlcmF0aW9ucyhzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0KTogUHJvbWlzZTxUYXJnZXRFbnZpcm9ubWVudD4ge1xuICAgIHJldHVybiB0aGlzLmFjY2Vzc1N0YWNrRm9yU3RhY2tPcGVyYXRpb25zKHN0YWNrLCBNb2RlLkZvcldyaXRpbmcpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBhbiBTREsgdG8gYWNjZXNzIHRoZSBnaXZlbiBzdGFjaydzIGVudmlyb25tZW50IGZvciBlbnZpcm9ubWVudGFsIGxvb2t1cHNcbiAgICpcbiAgICogV2lsbCB1c2UgYSBwbHVnaW4gaWYgYXZhaWxhYmxlLCB1c2UgdGhlIGRlZmF1bHQgQVdTIGNyZWRlbnRpYWxzIGlmIG5vdC5cbiAgICogVGhlIGBtb2RlYCBwYXJhbWV0ZXIgaXMgb25seSB1c2VkIGZvciBxdWVyeWluZyBwbHVnaW5zLlxuICAgKlxuICAgKiBXaWxsIGFzc3VtZSB0aGUgbG9va3VwIHJvbGUgaWYgY29uZmlndXJlZCBvbiB0aGUgc3RhY2suIENoZWNrIHRoZSBkZWZhdWx0IGBsb29rdXAtcm9sZWBcbiAgICogcG9saWNpZXMgdG8gc2VlIHdoYXQgeW91IGNhbiBkbyB3aXRoIHRoaXMgcm9sZS4gSXQgY2FuIGdlbmVyYWxseSByZWFkIGV2ZXJ5dGhpbmdcbiAgICogaW4gdGhlIGFjY291bnQgdGhhdCBkb2VzIG5vdCByZXF1aXJlIEtNUyBhY2Nlc3MuXG4gICAqXG4gICAqIC0tLVxuICAgKlxuICAgKiBGb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHkgcmVhc29ucywgdGhlcmUgYXJlIHNvbWUgc2NlbmFyaW9zIHRoYXQgYXJlIGhhbmRsZWQgaGVyZTpcbiAgICpcbiAgICogIDEuIFRoZSBsb29rdXAgcm9sZSBtYXkgbm90IGV4aXN0IChpdCB3YXMgYWRkZWQgaW4gYm9vdHN0cmFwIHN0YWNrIHZlcnNpb24gNykuIElmIHNvOlxuICAgKiAgICAgYS4gUmV0dXJuIHRoZSBkZWZhdWx0IGNyZWRlbnRpYWxzIGlmIHRoZSBkZWZhdWx0IGNyZWRlbnRpYWxzIGFyZSBmb3IgdGhlIHN0YWNrIGFjY291bnRcbiAgICogICAgICAgICh5b3Ugd2lsbCBub3RpY2UgdGhpcyBhcyBgaXNGYWxsYmFja0NyZWRlbnRpYWxzPXRydWVgKS5cbiAgICogICAgIGIuIFRocm93IGFuIGVycm9yIGlmIHRoZSBkZWZhdWx0IGNyZWRlbnRpYWxzIGFyZSBub3QgZm9yIHRoZSBzdGFjayBhY2NvdW50LlxuICAgKlxuICAgKiAgMi4gVGhlIGxvb2t1cCByb2xlIG1heSBub3QgaGF2ZSB0aGUgY29ycmVjdCBwZXJtaXNzaW9ucyAoZm9yIGV4YW1wbGUsIFJlYWRPbmx5QWNjZXNzIHdhcyBhZGRlZCBpblxuICAgKiAgICAgYm9vdHN0cmFwIHN0YWNrIHZlcnNpb24gOCk7IHRoZSBzdGFjayB3aWxsIGhhdmUgYSBtaW5pbXVtIHZlcnNpb24gbnVtYmVyIG9uIGl0LlxuICAgKiAgICAgYS4gSWYgaXQgZG9lcyBub3Qgd2UgdGhyb3cgYW4gZXJyb3Igd2hpY2ggc2hvdWxkIGJlIGhhbmRsZWQgaW4gdGhlIGNhbGxpbmdcbiAgICogICAgICAgIGZ1bmN0aW9uIChhbmQgZmFsbGJhY2sgdG8gdXNlIGEgZGlmZmVyZW50IHJvbGUsIGV0YylcbiAgICpcbiAgICogVXBvbiBzdWNjZXNzLCBjYWxsZXIgd2lsbCBoYXZlIGFuIFNESyBmb3IgdGhlIHJpZ2h0IGFjY291bnQsIHdoaWNoIG1heSBvciBtYXkgbm90IGhhdmVcbiAgICogdGhlIHJpZ2h0IHBlcm1pc3Npb25zLlxuICAgKi9cbiAgcHVibGljIGFzeW5jIGFjY2Vzc1N0YWNrRm9yTG9va3VwKHN0YWNrOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QpOiBQcm9taXNlPFRhcmdldEVudmlyb25tZW50PiB7XG4gICAgaWYgKCFzdGFjay5lbnZpcm9ubWVudCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBUaGUgc3RhY2sgJHtzdGFjay5kaXNwbGF5TmFtZX0gZG9lcyBub3QgaGF2ZSBhbiBlbnZpcm9ubWVudGApO1xuICAgIH1cblxuICAgIGNvbnN0IGxvb2t1cEVudiA9IGF3YWl0IHRoaXMucHJlcGFyZVNkayh7XG4gICAgICBlbnZpcm9ubWVudDogc3RhY2suZW52aXJvbm1lbnQsXG4gICAgICBtb2RlOiBNb2RlLkZvclJlYWRpbmcsXG4gICAgICBhc3N1bWVSb2xlQXJuOiBzdGFjay5sb29rdXBSb2xlPy5hcm4sXG4gICAgICBhc3N1bWVSb2xlRXh0ZXJuYWxJZDogc3RhY2subG9va3VwUm9sZT8uYXNzdW1lUm9sZUV4dGVybmFsSWQsXG4gICAgICBhc3N1bWVSb2xlQWRkaXRpb25hbE9wdGlvbnM6IHN0YWNrLmxvb2t1cFJvbGU/LmFzc3VtZVJvbGVBZGRpdGlvbmFsT3B0aW9ucyxcbiAgICB9KTtcblxuICAgIC8vIGlmIHdlIHN1Y2NlZWQgaW4gYXNzdW1pbmcgdGhlIGxvb2t1cCByb2xlLCBtYWtlIHN1cmUgd2UgaGF2ZSB0aGUgY29ycmVjdCBib290c3RyYXAgc3RhY2sgdmVyc2lvblxuICAgIGlmIChsb29rdXBFbnYuZGlkQXNzdW1lUm9sZSAmJiBzdGFjay5sb29rdXBSb2xlPy5ib290c3RyYXBTdGFja1ZlcnNpb25Tc21QYXJhbWV0ZXIgJiYgc3RhY2subG9va3VwUm9sZS5yZXF1aXJlc0Jvb3RzdHJhcFN0YWNrVmVyc2lvbikge1xuICAgICAgY29uc3QgdmVyc2lvbiA9IGF3YWl0IGxvb2t1cEVudi5yZXNvdXJjZXMudmVyc2lvbkZyb21Tc21QYXJhbWV0ZXIoc3RhY2subG9va3VwUm9sZS5ib290c3RyYXBTdGFja1ZlcnNpb25Tc21QYXJhbWV0ZXIpO1xuICAgICAgaWYgKHZlcnNpb24gPCBzdGFjay5sb29rdXBSb2xlLnJlcXVpcmVzQm9vdHN0cmFwU3RhY2tWZXJzaW9uKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQm9vdHN0cmFwIHN0YWNrIHZlcnNpb24gJyR7c3RhY2subG9va3VwUm9sZS5yZXF1aXJlc0Jvb3RzdHJhcFN0YWNrVmVyc2lvbn0nIGlzIHJlcXVpcmVkLCBmb3VuZCB2ZXJzaW9uICcke3ZlcnNpb259Jy4gVG8gZ2V0IHJpZCBvZiB0aGlzIGVycm9yLCBwbGVhc2UgdXBncmFkZSB0byBib290c3RyYXAgdmVyc2lvbiA+PSAke3N0YWNrLmxvb2t1cFJvbGUucmVxdWlyZXNCb290c3RyYXBTdGFja1ZlcnNpb259YCk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChsb29rdXBFbnYuaXNGYWxsYmFja0NyZWRlbnRpYWxzKSB7XG4gICAgICBjb25zdCBhcm4gPSBhd2FpdCBsb29rdXBFbnYucmVwbGFjZVBsYWNlaG9sZGVycyhzdGFjay5sb29rdXBSb2xlPy5hcm4pO1xuICAgICAgd2FybmluZyhgTG9va3VwIHJvbGUgJHthcm59IHdhcyBub3QgYXNzdW1lZC4gUHJvY2VlZGluZyB3aXRoIGRlZmF1bHQgY3JlZGVudGlhbHMuYCk7XG4gICAgfVxuICAgIHJldHVybiBsb29rdXBFbnY7XG4gIH1cblxuICAvKipcbiAgICogR2V0IGFuIFNESyB0byBhY2Nlc3MgdGhlIGdpdmVuIHN0YWNrJ3MgZW52aXJvbm1lbnQgZm9yIHJlYWRpbmcgc3RhY2sgYXR0cmlidXRlc1xuICAgKlxuICAgKiBXaWxsIHVzZSBhIHBsdWdpbiBpZiBhdmFpbGFibGUsIHVzZSB0aGUgZGVmYXVsdCBBV1MgY3JlZGVudGlhbHMgaWYgbm90LlxuICAgKiBUaGUgYG1vZGVgIHBhcmFtZXRlciBpcyBvbmx5IHVzZWQgZm9yIHF1ZXJ5aW5nIHBsdWdpbnMuXG4gICAqXG4gICAqIFdpbGwgdHJ5IHRvIGFzc3VtZSB0aGUgbG9va3VwIHJvbGUgaWYgZ2l2ZW4sIHdpbGwgdXNlIHRoZSByZWd1bGFyIHN0YWNrIG9wZXJhdGlvbnNcbiAgICogYWNjZXNzIChkZXBsb3ktcm9sZSkgb3RoZXJ3aXNlLiBXaGVuIGNhbGxpbmcgdGhpcywgeW91IHNob3VsZCBhc3N1bWUgdGhhdCB5b3Ugd2lsbCBnZXRcbiAgICogdGhlIGxlYXN0IHByaXZpbGVnZWQgcm9sZSwgc28gZG9uJ3QgdHJ5IHRvIHVzZSBpdCBmb3IgYW55dGhpbmcgdGhlIGBkZXBsb3ktcm9sZWBcbiAgICogd291bGRuJ3QgYmUgYWJsZSB0byBkby4gQWxzbyB5b3UgY2Fubm90IHJlbHkgb24gYmVpbmcgYWJsZSB0byByZWFkIGVuY3J5cHRlZCBhbnl0aGluZy5cbiAgICovXG4gIHB1YmxpYyBhc3luYyBhY2Nlc3NTdGFja0Zvckxvb2t1cEJlc3RFZmZvcnQoc3RhY2s6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCk6IFByb21pc2U8VGFyZ2V0RW52aXJvbm1lbnQ+IHtcbiAgICBpZiAoIXN0YWNrLmVudmlyb25tZW50KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZSBzdGFjayAke3N0YWNrLmRpc3BsYXlOYW1lfSBkb2VzIG5vdCBoYXZlIGFuIGVudmlyb25tZW50YCk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFjY2Vzc1N0YWNrRm9yTG9va3VwKHN0YWNrKTtcbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIHdhcm5pbmcoYCR7ZS5tZXNzYWdlfWApO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5hY2Nlc3NTdGFja0ZvclN0YWNrT3BlcmF0aW9ucyhzdGFjaywgTW9kZS5Gb3JSZWFkaW5nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgYW4gU0RLIHRvIGFjY2VzcyB0aGUgZ2l2ZW4gc3RhY2sncyBlbnZpcm9ubWVudCBmb3Igc3RhY2sgb3BlcmF0aW9uc1xuICAgKlxuICAgKiBXaWxsIHVzZSBhIHBsdWdpbiBpZiBhdmFpbGFibGUsIHVzZSB0aGUgZGVmYXVsdCBBV1MgY3JlZGVudGlhbHMgaWYgbm90LlxuICAgKiBUaGUgYG1vZGVgIHBhcmFtZXRlciBpcyBvbmx5IHVzZWQgZm9yIHF1ZXJ5aW5nIHBsdWdpbnMuXG4gICAqXG4gICAqIFdpbGwgYXNzdW1lIHRoZSBkZXBsb3kgcm9sZSBpZiBjb25maWd1cmVkIG9uIHRoZSBzdGFjay4gQ2hlY2sgdGhlIGRlZmF1bHQgYGRlcGxveS1yb2xlYFxuICAgKiBwb2xpY2llcyB0byBzZWUgd2hhdCB5b3UgY2FuIGRvIHdpdGggdGhpcyByb2xlLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBhY2Nlc3NTdGFja0ZvclN0YWNrT3BlcmF0aW9ucyhzdGFjazogY3hhcGkuQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0LCBtb2RlOiBNb2RlKTogUHJvbWlzZTxUYXJnZXRFbnZpcm9ubWVudD4ge1xuICAgIGlmICghc3RhY2suZW52aXJvbm1lbnQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGhlIHN0YWNrICR7c3RhY2suZGlzcGxheU5hbWV9IGRvZXMgbm90IGhhdmUgYW4gZW52aXJvbm1lbnRgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5wcmVwYXJlU2RrKHtcbiAgICAgIGVudmlyb25tZW50OiBzdGFjay5lbnZpcm9ubWVudCxcbiAgICAgIG1vZGUsXG4gICAgICBhc3N1bWVSb2xlQXJuOiBzdGFjay5hc3N1bWVSb2xlQXJuLFxuICAgICAgYXNzdW1lUm9sZUV4dGVybmFsSWQ6IHN0YWNrLmFzc3VtZVJvbGVFeHRlcm5hbElkLFxuICAgICAgYXNzdW1lUm9sZUFkZGl0aW9uYWxPcHRpb25zOiBzdGFjay5hc3N1bWVSb2xlQWRkaXRpb25hbE9wdGlvbnMsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogUHJlcGFyZSBhbiBTREsgZm9yIHVzZSBpbiB0aGUgZ2l2ZW4gZW52aXJvbm1lbnQgYW5kIG9wdGlvbmFsbHkgd2l0aCBhIHJvbGUgYXNzdW1lZC5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcHJlcGFyZVNkayhcbiAgICBvcHRpb25zOiBQcmVwYXJlU2RrUm9sZU9wdGlvbnMsXG4gICk6IFByb21pc2U8VGFyZ2V0RW52aXJvbm1lbnQ+IHtcbiAgICBjb25zdCByZXNvbHZlZEVudmlyb25tZW50ID0gYXdhaXQgdGhpcy5zZGtQcm92aWRlci5yZXNvbHZlRW52aXJvbm1lbnQob3B0aW9ucy5lbnZpcm9ubWVudCk7XG5cbiAgICAvLyBTdWJzdGl0dXRlIGFueSBwbGFjZWhvbGRlcnMgd2l0aCBpbmZvcm1hdGlvbiBhYm91dCB0aGUgY3VycmVudCBlbnZpcm9ubWVudFxuICAgIGNvbnN0IHsgYXNzdW1lUm9sZUFybiB9ID0gYXdhaXQgcmVwbGFjZUVudlBsYWNlaG9sZGVycyh7XG4gICAgICBhc3N1bWVSb2xlQXJuOiBvcHRpb25zLmFzc3VtZVJvbGVBcm4sXG4gICAgfSwgcmVzb2x2ZWRFbnZpcm9ubWVudCwgdGhpcy5zZGtQcm92aWRlcik7XG5cbiAgICBjb25zdCBzdGFja1NkayA9IGF3YWl0IHRoaXMuY2FjaGVkU2RrRm9yRW52aXJvbm1lbnQocmVzb2x2ZWRFbnZpcm9ubWVudCwgb3B0aW9ucy5tb2RlLCB7XG4gICAgICBhc3N1bWVSb2xlQXJuLFxuICAgICAgYXNzdW1lUm9sZUV4dGVybmFsSWQ6IG9wdGlvbnMuYXNzdW1lUm9sZUV4dGVybmFsSWQsXG4gICAgICBhc3N1bWVSb2xlQWRkaXRpb25hbE9wdGlvbnM6IG9wdGlvbnMuYXNzdW1lUm9sZUFkZGl0aW9uYWxPcHRpb25zLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNkazogc3RhY2tTZGsuc2RrLFxuICAgICAgcmVzb2x2ZWRFbnZpcm9ubWVudCxcbiAgICAgIHJlc291cmNlczogdGhpcy5lbnZpcm9ubWVudFJlc291cmNlcy5mb3IocmVzb2x2ZWRFbnZpcm9ubWVudCwgc3RhY2tTZGsuc2RrKSxcbiAgICAgIC8vIElmIHdlIGFza2VkIGZvciBhIHJvbGUsIGRpZCBub3Qgc3VjY2Vzc2Z1bGx5IGFzc3VtZSBpdCwgYW5kIHlldCBnb3QgaGVyZSB3aXRob3V0IGFuIGV4Y2VwdGlvbjogdGhhdFxuICAgICAgLy8gbWVhbnMgd2UgbXVzdCBoYXZlIGZhbGxiYWNrIGNyZWRlbnRpYWxzLlxuICAgICAgaXNGYWxsYmFja0NyZWRlbnRpYWxzOiAhc3RhY2tTZGsuZGlkQXNzdW1lUm9sZSAmJiAhIWFzc3VtZVJvbGVBcm4sXG4gICAgICBkaWRBc3N1bWVSb2xlOiBzdGFja1Nkay5kaWRBc3N1bWVSb2xlLFxuICAgICAgcmVwbGFjZVBsYWNlaG9sZGVyczogYXN5bmMgPEEgZXh0ZW5kcyBzdHJpbmcgfCB1bmRlZmluZWQ+KHN0cjogQSkgPT4ge1xuICAgICAgICBjb25zdCByZXQgPSBhd2FpdCByZXBsYWNlRW52UGxhY2Vob2xkZXJzKHsgc3RyIH0sIHJlc29sdmVkRW52aXJvbm1lbnQsIHRoaXMuc2RrUHJvdmlkZXIpO1xuICAgICAgICByZXR1cm4gcmV0LnN0cjtcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY2FjaGVkU2RrRm9yRW52aXJvbm1lbnQoXG4gICAgZW52aXJvbm1lbnQ6IGN4YXBpLkVudmlyb25tZW50LFxuICAgIG1vZGU6IE1vZGUsXG4gICAgb3B0aW9ucz86IENyZWRlbnRpYWxzT3B0aW9ucyxcbiAgKSB7XG4gICAgY29uc3QgY2FjaGVLZXlFbGVtZW50cyA9IFtcbiAgICAgIGVudmlyb25tZW50LmFjY291bnQsXG4gICAgICBlbnZpcm9ubWVudC5yZWdpb24sXG4gICAgICBgJHttb2RlfWAsXG4gICAgICBvcHRpb25zPy5hc3N1bWVSb2xlQXJuID8/ICcnLFxuICAgICAgb3B0aW9ucz8uYXNzdW1lUm9sZUV4dGVybmFsSWQgPz8gJycsXG4gICAgXTtcblxuICAgIGlmIChvcHRpb25zPy5hc3N1bWVSb2xlQWRkaXRpb25hbE9wdGlvbnMpIHtcbiAgICAgIGNhY2hlS2V5RWxlbWVudHMucHVzaChKU09OLnN0cmluZ2lmeShvcHRpb25zLmFzc3VtZVJvbGVBZGRpdGlvbmFsT3B0aW9ucykpO1xuICAgIH1cblxuICAgIGNvbnN0IGNhY2hlS2V5ID0gY2FjaGVLZXlFbGVtZW50cy5qb2luKCc6Jyk7XG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLnNka0NhY2hlLmdldChjYWNoZUtleSk7XG4gICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICByZXR1cm4gZXhpc3Rpbmc7XG4gICAgfVxuICAgIGNvbnN0IHJldCA9IGF3YWl0IHRoaXMuc2RrUHJvdmlkZXIuZm9yRW52aXJvbm1lbnQoZW52aXJvbm1lbnQsIG1vZGUsIG9wdGlvbnMpO1xuICAgIHRoaXMuc2RrQ2FjaGUuc2V0KGNhY2hlS2V5LCByZXQpO1xuICAgIHJldHVybiByZXQ7XG4gIH1cbn1cblxuLyoqXG4gKiBTREsgb2J0YWluZWQgYnkgYXNzdW1pbmcgdGhlIGRlcGxveSByb2xlXG4gKiBmb3IgYSBnaXZlbiBlbnZpcm9ubWVudFxuICovXG5leHBvcnQgaW50ZXJmYWNlIFRhcmdldEVudmlyb25tZW50IHtcbiAgLyoqXG4gICAqIFRoZSBTREsgZm9yIHRoZSBnaXZlbiBlbnZpcm9ubWVudFxuICAgKi9cbiAgcmVhZG9ubHkgc2RrOiBTREs7XG5cbiAgLyoqXG4gICAqIFRoZSByZXNvbHZlZCBlbnZpcm9ubWVudCBmb3IgdGhlIHN0YWNrXG4gICAqIChubyBtb3JlICd1bmtub3duLWFjY291bnQvdW5rbm93bi1yZWdpb24nKVxuICAgKi9cbiAgcmVhZG9ubHkgcmVzb2x2ZWRFbnZpcm9ubWVudDogY3hhcGkuRW52aXJvbm1lbnQ7XG5cbiAgLyoqXG4gICAqIEFjY2VzcyBjbGFzcyBmb3IgZW52aXJvbm1lbnRhbCByZXNvdXJjZXMgdG8gaGVscCB0aGUgZGVwbG95bWVudFxuICAgKi9cbiAgcmVhZG9ubHkgcmVzb3VyY2VzOiBFbnZpcm9ubWVudFJlc291cmNlcztcblxuICAvKipcbiAgICogV2hldGhlciBvciBub3Qgd2UgYXNzdW1lZCBhIHJvbGUgaW4gdGhlIHByb2Nlc3Mgb2YgZ2V0dGluZyB0aGVzZSBjcmVkZW50aWFsc1xuICAgKi9cbiAgcmVhZG9ubHkgZGlkQXNzdW1lUm9sZTogYm9vbGVhbjtcblxuICAvKipcbiAgICogV2hldGhlciBvciBub3QgdGhlc2UgYXJlIGZhbGxiYWNrIGNyZWRlbnRpYWxzXG4gICAqXG4gICAqIEZhbGxiYWNrIGNyZWRlbnRpYWxzIG1lYW5zIHRoYXQgYXNzdW1pbmcgdGhlIGludGVuZGVkIHJvbGUgZmFpbGVkLCBidXQgdGhlXG4gICAqIGJhc2UgY3JlZGVudGlhbHMgaGFwcGVuIHRvIGJlIGZvciB0aGUgcmlnaHQgYWNjb3VudCBzbyB3ZSBqdXN0IHBpY2tlZCB0aG9zZVxuICAgKiBhbmQgaG9wZSB0aGUgZnV0dXJlIFNESyBjYWxscyBzdWNjZWVkLlxuICAgKlxuICAgKiBUaGlzIGlzIGEgYmFja3dhcmRzIGNvbXBhdGliaWxpdHkgbWVjaGFuaXNtIGZyb20gYXJvdW5kIHRoZSB0aW1lIHdlIGludHJvZHVjZWRcbiAgICogZGVwbG95bWVudCByb2xlcy5cbiAgICovXG4gIHJlYWRvbmx5IGlzRmFsbGJhY2tDcmVkZW50aWFsczogYm9vbGVhbjtcblxuICAvKipcbiAgICogUmVwbGFjZSBlbnZpcm9ubWVudCBwbGFjZWhvbGRlcnMgYWNjb3JkaW5nIHRvIHRoZSBjdXJyZW50IGVudmlyb25tZW50XG4gICAqL1xuICByZXBsYWNlUGxhY2Vob2xkZXJzKHg6IHN0cmluZyB8IHVuZGVmaW5lZCk6IFByb21pc2U8U3RyaW5nV2l0aG91dFBsYWNlaG9sZGVycyB8IHVuZGVmaW5lZD47XG59XG5cbmludGVyZmFjZSBQcmVwYXJlU2RrUm9sZU9wdGlvbnMge1xuICByZWFkb25seSBlbnZpcm9ubWVudDogY3hhcGkuRW52aXJvbm1lbnQ7XG4gIHJlYWRvbmx5IG1vZGU6IE1vZGU7XG4gIHJlYWRvbmx5IGFzc3VtZVJvbGVBcm4/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IGFzc3VtZVJvbGVFeHRlcm5hbElkPzogc3RyaW5nO1xuICByZWFkb25seSBhc3N1bWVSb2xlQWRkaXRpb25hbE9wdGlvbnM/OiB7IFtrZXk6IHN0cmluZ106IGFueSB9O1xufVxuIl19