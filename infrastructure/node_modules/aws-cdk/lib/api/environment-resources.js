"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoBootstrapStackEnvironmentResources = exports.EnvironmentResources = exports.EnvironmentResourcesRegistry = void 0;
const toolkit_info_1 = require("./toolkit-info");
const logging_1 = require("../logging");
const notices_1 = require("../notices");
/**
 * Registry class for `EnvironmentResources`.
 *
 * The state management of this class is a bit non-standard. We want to cache
 * data related to toolkit stacks and SSM parameters, but we are not in charge
 * of ensuring caching of SDKs. Since `EnvironmentResources` needs an SDK to
 * function, we treat it as an ephemeral class, and store the actual cached data
 * in `EnvironmentResourcesRegistry`.
 */
class EnvironmentResourcesRegistry {
    constructor(toolkitStackName) {
        this.toolkitStackName = toolkitStackName;
        this.cache = new Map();
    }
    for(resolvedEnvironment, sdk) {
        const key = `${resolvedEnvironment.account}:${resolvedEnvironment.region}`;
        let envCache = this.cache.get(key);
        if (!envCache) {
            envCache = emptyCache();
            this.cache.set(key, envCache);
        }
        return new EnvironmentResources(resolvedEnvironment, sdk, envCache, this.toolkitStackName);
    }
}
exports.EnvironmentResourcesRegistry = EnvironmentResourcesRegistry;
/**
 * Interface with the account and region we're deploying into
 *
 * Manages lookups for bootstrapped resources, falling back to the legacy "CDK Toolkit"
 * original bootstrap stack if necessary.
 *
 * The state management of this class is a bit non-standard. We want to cache
 * data related to toolkit stacks and SSM parameters, but we are not in charge
 * of ensuring caching of SDKs. Since `EnvironmentResources` needs an SDK to
 * function, we treat it as an ephemeral class, and store the actual cached data
 * in `EnvironmentResourcesRegistry`.
 */
class EnvironmentResources {
    constructor(environment, sdk, cache, toolkitStackName) {
        this.environment = environment;
        this.sdk = sdk;
        this.cache = cache;
        this.toolkitStackName = toolkitStackName;
    }
    /**
     * Look up the toolkit for a given environment, using a given SDK
     */
    async lookupToolkit() {
        if (!this.cache.toolkitInfo) {
            this.cache.toolkitInfo = await toolkit_info_1.ToolkitInfo.lookup(this.environment, this.sdk, this.toolkitStackName);
        }
        return this.cache.toolkitInfo;
    }
    /**
     * Validate that the bootstrap stack version matches or exceeds the expected version
     *
     * Use the SSM parameter name to read the version number if given, otherwise use the version
     * discovered on the bootstrap stack.
     *
     * Pass in the SSM parameter name so we can cache the lookups an don't need to do the same
     * lookup again and again for every artifact.
     */
    async validateVersion(expectedVersion, ssmParameterName) {
        if (expectedVersion === undefined) {
            // No requirement
            return;
        }
        const defExpectedVersion = expectedVersion;
        if (ssmParameterName !== undefined) {
            try {
                doValidate(await this.versionFromSsmParameter(ssmParameterName), this.environment);
                return;
            }
            catch (e) {
                if (e.name !== 'AccessDeniedException') {
                    throw e;
                }
                // This is a fallback! The bootstrap template that goes along with this change introduces
                // a new 'ssm:GetParameter' permission, but when run using the previous bootstrap template we
                // won't have the permissions yet to read the version, so we won't be able to show the
                // message telling the user they need to update! When we see an AccessDeniedException, fall
                // back to the version we read from Stack Outputs; but ONLY if the version we discovered via
                // outputs is legitimately an old version. If it's newer than that, something else must be broken,
                // so let it fail as it would if we didn't have this fallback.
                const bootstrapStack = await this.lookupToolkit();
                if (bootstrapStack.found && bootstrapStack.version < BOOTSTRAP_TEMPLATE_VERSION_INTRODUCING_GETPARAMETER) {
                    (0, logging_1.warning)(`Could not read SSM parameter ${ssmParameterName}: ${e.message}, falling back to version from ${bootstrapStack}`);
                    doValidate(bootstrapStack.version, this.environment);
                    return;
                }
                throw new Error(`This CDK deployment requires bootstrap stack version '${expectedVersion}', but during the confirmation via SSM parameter ${ssmParameterName} the following error occurred: ${e}`);
            }
        }
        // No SSM parameter
        const bootstrapStack = await this.lookupToolkit();
        doValidate(bootstrapStack.version, this.environment);
        function doValidate(version, environment) {
            const notices = notices_1.Notices.get();
            if (notices) {
                // if `Notices` hasn't been initialized there is probably a good
                // reason for it. handle gracefully.
                notices.addBootstrappedEnvironment({ bootstrapStackVersion: version, environment });
            }
            if (defExpectedVersion > version) {
                throw new Error(`This CDK deployment requires bootstrap stack version '${expectedVersion}', found '${version}'. Please run 'cdk bootstrap'.`);
            }
        }
    }
    /**
     * Read a version from an SSM parameter, cached
     */
    async versionFromSsmParameter(parameterName) {
        const existing = this.cache.ssmParameters.get(parameterName);
        if (existing !== undefined) {
            return existing;
        }
        const ssm = this.sdk.ssm();
        try {
            const result = await ssm.getParameter({ Name: parameterName });
            const asNumber = parseInt(`${result.Parameter?.Value}`, 10);
            if (isNaN(asNumber)) {
                throw new Error(`SSM parameter ${parameterName} not a number: ${result.Parameter?.Value}`);
            }
            this.cache.ssmParameters.set(parameterName, asNumber);
            return asNumber;
        }
        catch (e) {
            if (e.name === 'ParameterNotFound') {
                throw new Error(`SSM parameter ${parameterName} not found. Has the environment been bootstrapped? Please run \'cdk bootstrap\' (see https://docs.aws.amazon.com/cdk/latest/guide/bootstrapping.html)`);
            }
            throw e;
        }
    }
    async prepareEcrRepository(repositoryName) {
        if (!this.sdk) {
            throw new Error('ToolkitInfo needs to have been initialized with an sdk to call prepareEcrRepository');
        }
        const ecr = this.sdk.ecr();
        // check if repo already exists
        try {
            (0, logging_1.debug)(`${repositoryName}: checking if ECR repository already exists`);
            const describeResponse = await ecr.describeRepositories({
                repositoryNames: [repositoryName],
            });
            const existingRepositoryUri = describeResponse.repositories[0]?.repositoryUri;
            if (existingRepositoryUri) {
                return { repositoryUri: existingRepositoryUri };
            }
        }
        catch (e) {
            if (e.name !== 'RepositoryNotFoundException') {
                throw e;
            }
        }
        // create the repo (tag it so it will be easier to garbage collect in the future)
        (0, logging_1.debug)(`${repositoryName}: creating ECR repository`);
        const assetTag = { Key: 'awscdk:asset', Value: 'true' };
        const response = await ecr.createRepository({
            repositoryName,
            tags: [assetTag],
        });
        const repositoryUri = response.repository?.repositoryUri;
        if (!repositoryUri) {
            throw new Error(`CreateRepository did not return a repository URI for ${repositoryUri}`);
        }
        // configure image scanning on push (helps in identifying software vulnerabilities, no additional charge)
        (0, logging_1.debug)(`${repositoryName}: enable image scanning`);
        await ecr.putImageScanningConfiguration({
            repositoryName,
            imageScanningConfiguration: { scanOnPush: true },
        });
        return { repositoryUri };
    }
}
exports.EnvironmentResources = EnvironmentResources;
class NoBootstrapStackEnvironmentResources extends EnvironmentResources {
    constructor(environment, sdk) {
        super(environment, sdk, emptyCache());
    }
    /**
     * Look up the toolkit for a given environment, using a given SDK
     */
    async lookupToolkit() {
        throw new Error('Trying to perform an operation that requires a bootstrap stack; you should not see this error, this is a bug in the CDK CLI.');
    }
}
exports.NoBootstrapStackEnvironmentResources = NoBootstrapStackEnvironmentResources;
function emptyCache() {
    return {
        ssmParameters: new Map(),
        toolkitInfo: undefined,
    };
}
/**
 * The bootstrap template version that introduced ssm:GetParameter
 */
const BOOTSTRAP_TEMPLATE_VERSION_INTRODUCING_GETPARAMETER = 5;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW52aXJvbm1lbnQtcmVzb3VyY2VzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZW52aXJvbm1lbnQtcmVzb3VyY2VzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVBLGlEQUFxRTtBQUNyRSx3Q0FBNEM7QUFDNUMsd0NBQXFDO0FBRXJDOzs7Ozs7OztHQVFHO0FBQ0gsTUFBYSw0QkFBNEI7SUFHdkMsWUFBNkIsZ0JBQXlCO1FBQXpCLHFCQUFnQixHQUFoQixnQkFBZ0IsQ0FBUztRQUZyQyxVQUFLLEdBQUcsSUFBSSxHQUFHLEVBQTRCLENBQUM7SUFFSixDQUFDO0lBRW5ELEdBQUcsQ0FBQyxtQkFBZ0MsRUFBRSxHQUFRO1FBQ25ELE1BQU0sR0FBRyxHQUFHLEdBQUcsbUJBQW1CLENBQUMsT0FBTyxJQUFJLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQzNFLElBQUksUUFBUSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ25DLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNkLFFBQVEsR0FBRyxVQUFVLEVBQUUsQ0FBQztZQUN4QixJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDaEMsQ0FBQztRQUNELE9BQU8sSUFBSSxvQkFBb0IsQ0FBQyxtQkFBbUIsRUFBRSxHQUFHLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO0lBQzdGLENBQUM7Q0FDRjtBQWRELG9FQWNDO0FBRUQ7Ozs7Ozs7Ozs7O0dBV0c7QUFDSCxNQUFhLG9CQUFvQjtJQUMvQixZQUNrQixXQUF3QixFQUN2QixHQUFRLEVBQ1IsS0FBdUIsRUFDdkIsZ0JBQXlCO1FBSDFCLGdCQUFXLEdBQVgsV0FBVyxDQUFhO1FBQ3ZCLFFBQUcsR0FBSCxHQUFHLENBQUs7UUFDUixVQUFLLEdBQUwsS0FBSyxDQUFrQjtRQUN2QixxQkFBZ0Is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QWMseUJBQXlCLENBQUMsQ0FBQztRQUNsRCxNQUFNLEdBQUcsQ0FBQyw2QkFBNkIsQ0FBQztZQUN0QyxjQUFjO1lBQ2QsMEJBQTBCLEVBQUUsRUFBRSxVQUFVLEVBQUUsSUFBSSxFQUFFO1NBQ2pELENBQUMsQ0FBQztRQUVILE9BQU8sRUFBRSxhQUFhLEVBQUUsQ0FBQztJQUMzQixDQUFDO0NBQ0Y7QUE5SkQsb0RBOEpDO0FBRUQsTUFBYSxvQ0FBcUMsU0FBUSxvQkFBb0I7SUFDNUUsWUFBWSxXQUF3QixFQUFFLEdBQVE7UUFDNUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxHQUFHLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQztJQUN4QyxDQUFDO0lBRUQ7O09BRUc7SUFDSSxLQUFLLENBQUMsYUFBYTtRQUN4QixNQUFNLElBQUksS0FBSyxDQUNiLDhIQUE4SCxDQUMvSCxDQUFDO0lBQ0osQ0FBQztDQUNGO0FBYkQsb0ZBYUM7QUFZRCxTQUFTLFVBQVU7SUFDakIsT0FBTztRQUNMLGFBQWEsRUFBRSxJQUFJLEdBQUcsRUFBRTtRQUN4QixXQUFXLEVBQUUsU0FBUztLQUN2QixDQUFDO0FBQ0osQ0FBQztBQUVEOztHQUVHO0FBQ0gsTUFBTSxtREFBbUQsR0FBRyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IEVudmlyb25tZW50IH0gZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCB0eXBlIHsgU0RLIH0gZnJvbSAnLi9hd3MtYXV0aCc7XG5pbXBvcnQgeyB0eXBlIEVjclJlcG9zaXRvcnlJbmZvLCBUb29sa2l0SW5mbyB9IGZyb20gJy4vdG9vbGtpdC1pbmZvJztcbmltcG9ydCB7IGRlYnVnLCB3YXJuaW5nIH0gZnJvbSAnLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBOb3RpY2VzIH0gZnJvbSAnLi4vbm90aWNlcyc7XG5cbi8qKlxuICogUmVnaXN0cnkgY2xhc3MgZm9yIGBFbnZpcm9ubWVudFJlc291cmNlc2AuXG4gKlxuICogVGhlIHN0YXRlIG1hbmFnZW1lbnQgb2YgdGhpcyBjbGFzcyBpcyBhIGJpdCBub24tc3RhbmRhcmQuIFdlIHdhbnQgdG8gY2FjaGVcbiAqIGRhdGEgcmVsYXRlZCB0byB0b29sa2l0IHN0YWNrcyBhbmQgU1NNIHBhcmFtZXRlcnMsIGJ1dCB3ZSBhcmUgbm90IGluIGNoYXJnZVxuICogb2YgZW5zdXJpbmcgY2FjaGluZyBvZiBTREtzLiBTaW5jZSBgRW52aXJvbm1lbnRSZXNvdXJjZXNgIG5lZWRzIGFuIFNESyB0b1xuICogZnVuY3Rpb24sIHdlIHRyZWF0IGl0IGFzIGFuIGVwaGVtZXJhbCBjbGFzcywgYW5kIHN0b3JlIHRoZSBhY3R1YWwgY2FjaGVkIGRhdGFcbiAqIGluIGBFbnZpcm9ubWVudFJlc291cmNlc1JlZ2lzdHJ5YC5cbiAqL1xuZXhwb3J0IGNsYXNzIEVudmlyb25tZW50UmVzb3VyY2VzUmVnaXN0cnkge1xuICBwcml2YXRlIHJlYWRvbmx5IGNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIEVudmlyb25tZW50Q2FjaGU+KCk7XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSB0b29sa2l0U3RhY2tOYW1lPzogc3RyaW5nKSB7fVxuXG4gIHB1YmxpYyBmb3IocmVzb2x2ZWRFbnZpcm9ubWVudDogRW52aXJvbm1lbnQsIHNkazogU0RLKSB7XG4gICAgY29uc3Qga2V5ID0gYCR7cmVzb2x2ZWRFbnZpcm9ubWVudC5hY2NvdW50fToke3Jlc29sdmVkRW52aXJvbm1lbnQucmVnaW9ufWA7XG4gICAgbGV0IGVudkNhY2hlID0gdGhpcy5jYWNoZS5nZXQoa2V5KTtcbiAgICBpZiAoIWVudkNhY2hlKSB7XG4gICAgICBlbnZDYWNoZSA9IGVtcHR5Q2FjaGUoKTtcbiAgICAgIHRoaXMuY2FjaGUuc2V0KGtleSwgZW52Q2FjaGUpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IEVudmlyb25tZW50UmVzb3VyY2VzKHJlc29sdmVkRW52aXJvbm1lbnQsIHNkaywgZW52Q2FjaGUsIHRoaXMudG9vbGtpdFN0YWNrTmFtZSk7XG4gIH1cbn1cblxuLyoqXG4gKiBJbnRlcmZhY2Ugd2l0aCB0aGUgYWNjb3VudCBhbmQgcmVnaW9uIHdlJ3JlIGRlcGxveWluZyBpbnRvXG4gKlxuICogTWFuYWdlcyBsb29rdXBzIGZvciBib290c3RyYXBwZWQgcmVzb3VyY2VzLCBmYWxsaW5nIGJhY2sgdG8gdGhlIGxlZ2FjeSBcIkNESyBUb29sa2l0XCJcbiAqIG9yaWdpbmFsIGJvb3RzdHJhcCBzdGFjayBpZiBuZWNlc3NhcnkuXG4gKlxuICogVGhlIHN0YXRlIG1hbmFnZW1lbnQgb2YgdGhpcyBjbGFzcyBpcyBhIGJpdCBub24tc3RhbmRhcmQuIFdlIHdhbnQgdG8gY2FjaGVcbiAqIGRhdGEgcmVsYXRlZCB0byB0b29sa2l0IHN0YWNrcyBhbmQgU1NNIHBhcmFtZXRlcnMsIGJ1dCB3ZSBhcmUgbm90IGluIGNoYXJnZVxuICogb2YgZW5zdXJpbmcgY2FjaGluZyBvZiBTREtzLiBTaW5jZSBgRW52aXJvbm1lbnRSZXNvdXJjZXNgIG5lZWRzIGFuIFNESyB0b1xuICogZnVuY3Rpb24sIHdlIHRyZWF0IGl0IGFzIGFuIGVwaGVtZXJhbCBjbGFzcywgYW5kIHN0b3JlIHRoZSBhY3R1YWwgY2FjaGVkIGRhdGFcbiAqIGluIGBFbnZpcm9ubWVudFJlc291cmNlc1JlZ2lzdHJ5YC5cbiAqL1xuZXhwb3J0IGNsYXNzIEVudmlyb25tZW50UmVzb3VyY2VzIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHVibGljIHJlYWRvbmx5IGVudmlyb25tZW50OiBFbnZpcm9ubWVudCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHNkazogU0RLLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY2FjaGU6IEVudmlyb25tZW50Q2FjaGUsXG4gICAgcHJpdmF0ZSByZWFkb25seSB0b29sa2l0U3RhY2tOYW1lPzogc3RyaW5nLFxuICApIHt9XG5cbiAgLyoqXG4gICAqIExvb2sgdXAgdGhlIHRvb2xraXQgZm9yIGEgZ2l2ZW4gZW52aXJvbm1lbnQsIHVzaW5nIGEgZ2l2ZW4gU0RLXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgbG9va3VwVG9vbGtpdCgpIHtcbiAgICBpZiAoIXRoaXMuY2FjaGUudG9vbGtpdEluZm8pIHtcbiAgICAgIHRoaXMuY2FjaGUudG9vbGtpdEluZm8gPSBhd2FpdCBUb29sa2l0SW5mby5sb29rdXAodGhpcy5lbnZpcm9ubWVudCwgdGhpcy5zZGssIHRoaXMudG9vbGtpdFN0YWNrTmFtZSk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmNhY2hlLnRvb2xraXRJbmZvO1xuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlIHRoYXQgdGhlIGJvb3RzdHJhcCBzdGFjayB2ZXJzaW9uIG1hdGNoZXMgb3IgZXhjZWVkcyB0aGUgZXhwZWN0ZWQgdmVyc2lvblxuICAgKlxuICAgKiBVc2UgdGhlIFNTTSBwYXJhbWV0ZXIgbmFtZSB0byByZWFkIHRoZSB2ZXJzaW9uIG51bWJlciBpZiBnaXZlbiwgb3RoZXJ3aXNlIHVzZSB0aGUgdmVyc2lvblxuICAgKiBkaXNjb3ZlcmVkIG9uIHRoZSBib290c3RyYXAgc3RhY2suXG4gICAqXG4gICAqIFBhc3MgaW4gdGhlIFNTTSBwYXJhbWV0ZXIgbmFtZSBzbyB3ZSBjYW4gY2FjaGUgdGhlIGxvb2t1cHMgYW4gZG9uJ3QgbmVlZCB0byBkbyB0aGUgc2FtZVxuICAgKiBsb29rdXAgYWdhaW4gYW5kIGFnYWluIGZvciBldmVyeSBhcnRpZmFjdC5cbiAgICovXG4gIHB1YmxpYyBhc3luYyB2YWxpZGF0ZVZlcnNpb24oZXhwZWN0ZWRWZXJzaW9uOiBudW1iZXIgfCB1bmRlZmluZWQsIHNzbVBhcmFtZXRlck5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZCkge1xuICAgIGlmIChleHBlY3RlZFZlcnNpb24gPT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gTm8gcmVxdWlyZW1lbnRcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgZGVmRXhwZWN0ZWRWZXJzaW9uID0gZXhwZWN0ZWRWZXJzaW9uO1xuXG4gICAgaWYgKHNzbVBhcmFtZXRlck5hbWUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgZG9WYWxpZGF0ZShhd2FpdCB0aGlzLnZlcnNpb25Gcm9tU3NtUGFyYW1ldGVyKHNzbVBhcmFtZXRlck5hbWUpLCB0aGlzLmVudmlyb25tZW50KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICAgIGlmIChlLm5hbWUgIT09ICdBY2Nlc3NEZW5pZWRFeGNlcHRpb24nKSB7XG4gICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFRoaXMgaXMgYSBmYWxsYmFjayEgVGhlIGJvb3RzdHJhcCB0ZW1wbGF0ZSB0aGF0IGdvZXMgYWxvbmcgd2l0aCB0aGlzIGNoYW5nZSBpbnRyb2R1Y2VzXG4gICAgICAgIC8vIGEgbmV3ICdzc206R2V0UGFyYW1ldGVyJyBwZXJtaXNzaW9uLCBidXQgd2hlbiBydW4gdXNpbmcgdGhlIHByZXZpb3VzIGJvb3RzdHJhcCB0ZW1wbGF0ZSB3ZVxuICAgICAgICAvLyB3b24ndCBoYXZlIHRoZSBwZXJtaXNzaW9ucyB5ZXQgdG8gcmVhZCB0aGUgdmVyc2lvbiwgc28gd2Ugd29uJ3QgYmUgYWJsZSB0byBzaG93IHRoZVxuICAgICAgICAvLyBtZXNzYWdlIHRlbGxpbmcgdGhlIHVzZXIgdGhleSBuZWVkIHRvIHVwZGF0ZSEgV2hlbiB3ZSBzZWUgYW4gQWNjZXNzRGVuaWVkRXhjZXB0aW9uLCBmYWxsXG4gICAgICAgIC8vIGJhY2sgdG8gdGhlIHZlcnNpb24gd2UgcmVhZCBmcm9tIFN0YWNrIE91dHB1dHM7IGJ1dCBPTkxZIGlmIHRoZSB2ZXJzaW9uIHdlIGRpc2NvdmVyZWQgdmlhXG4gICAgICAgIC8vIG91dHB1dHMgaXMgbGVnaXRpbWF0ZWx5IGFuIG9sZCB2ZXJzaW9uLiBJZiBpdCdzIG5ld2VyIHRoYW4gdGhhdCwgc29tZXRoaW5nIGVsc2UgbXVzdCBiZSBicm9rZW4sXG4gICAgICAgIC8vIHNvIGxldCBpdCBmYWlsIGFzIGl0IHdvdWxkIGlmIHdlIGRpZG4ndCBoYXZlIHRoaXMgZmFsbGJhY2suXG4gICAgICAgIGNvbnN0IGJvb3RzdHJhcFN0YWNrID0gYXdhaXQgdGhpcy5sb29rdXBUb29sa2l0KCk7XG4gICAgICAgIGlmIChib290c3RyYXBTdGFjay5mb3VuZCAmJiBib290c3RyYXBTdGFjay52ZXJzaW9uIDwgQk9PVFNUUkFQX1RFTVBMQVRFX1ZFUlNJT05fSU5UUk9EVUNJTkdfR0VUUEFSQU1FVEVSKSB7XG4gICAgICAgICAgd2FybmluZyhcbiAgICAgICAgICAgIGBDb3VsZCBub3QgcmVhZCBTU00gcGFyYW1ldGVyICR7c3NtUGFyYW1ldGVyTmFtZX06ICR7ZS5tZXNzYWdlfSwgZmFsbGluZyBiYWNrIHRvIHZlcnNpb24gZnJvbSAke2Jvb3RzdHJhcFN0YWNrfWAsXG4gICAgICAgICAgKTtcbiAgICAgICAgICBkb1ZhbGlkYXRlKGJvb3RzdHJhcFN0YWNrLnZlcnNpb24sIHRoaXMuZW52aXJvbm1lbnQpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgVGhpcyBDREsgZGVwbG95bWVudCByZXF1aXJlcyBib290c3RyYXAgc3RhY2sgdmVyc2lvbiAnJHtleHBlY3RlZFZlcnNpb259JywgYnV0IGR1cmluZyB0aGUgY29uZmlybWF0aW9uIHZpYSBTU00gcGFyYW1ldGVyICR7c3NtUGFyYW1ldGVyTmFtZX0gdGhlIGZvbGxvd2luZyBlcnJvciBvY2N1cnJlZDogJHtlfWAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gTm8gU1NNIHBhcmFtZXRlclxuICAgIGNvbnN0IGJvb3RzdHJhcFN0YWNrID0gYXdhaXQgdGhpcy5sb29rdXBUb29sa2l0KCk7XG4gICAgZG9WYWxpZGF0ZShib290c3RyYXBTdGFjay52ZXJzaW9uLCB0aGlzLmVudmlyb25tZW50KTtcblxuICAgIGZ1bmN0aW9uIGRvVmFsaWRhdGUodmVyc2lvbjogbnVtYmVyLCBlbnZpcm9ubWVudDogRW52aXJvbm1lbnQpIHtcbiAgICAgIGNvbnN0IG5vdGljZXMgPSBOb3RpY2VzLmdldCgpO1xuICAgICAgaWYgKG5vdGljZXMpIHtcbiAgICAgICAgLy8gaWYgYE5vdGljZXNgIGhhc24ndCBiZWVuIGluaXRpYWxpemVkIHRoZXJlIGlzIHByb2JhYmx5IGEgZ29vZFxuICAgICAgICAvLyByZWFzb24gZm9yIGl0LiBoYW5kbGUgZ3JhY2VmdWxseS5cbiAgICAgICAgbm90aWNlcy5hZGRCb290c3RyYXBwZWRFbnZpcm9ubWVudCh7IGJvb3RzdHJhcFN0YWNrVmVyc2lvbjogdmVyc2lvbiwgZW52aXJvbm1lbnQgfSk7XG4gICAgICB9XG4gICAgICBpZiAoZGVmRXhwZWN0ZWRWZXJzaW9uID4gdmVyc2lvbikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgYFRoaXMgQ0RLIGRlcGxveW1lbnQgcmVxdWlyZXMgYm9vdHN0cmFwIHN0YWNrIHZlcnNpb24gJyR7ZXhwZWN0ZWRWZXJzaW9ufScsIGZvdW5kICcke3ZlcnNpb259Jy4gUGxlYXNlIHJ1biAnY2RrIGJvb3RzdHJhcCcuYCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhIHZlcnNpb24gZnJvbSBhbiBTU00gcGFyYW1ldGVyLCBjYWNoZWRcbiAgICovXG4gIHB1YmxpYyBhc3luYyB2ZXJzaW9uRnJvbVNzbVBhcmFtZXRlcihwYXJhbWV0ZXJOYW1lOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5jYWNoZS5zc21QYXJhbWV0ZXJzLmdldChwYXJhbWV0ZXJOYW1lKTtcbiAgICBpZiAoZXhpc3RpbmcgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGV4aXN0aW5nO1xuICAgIH1cblxuICAgIGNvbnN0IHNzbSA9IHRoaXMuc2RrLnNzbSgpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNzbS5nZXRQYXJhbWV0ZXIoeyBOYW1lOiBwYXJhbWV0ZXJOYW1lIH0pO1xuXG4gICAgICBjb25zdCBhc051bWJlciA9IHBhcnNlSW50KGAke3Jlc3VsdC5QYXJhbWV0ZXI/LlZhbHVlfWAsIDEwKTtcbiAgICAgIGlmIChpc05hTihhc051bWJlcikpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBTU00gcGFyYW1ldGVyICR7cGFyYW1ldGVyTmFtZX0gbm90IGEgbnVtYmVyOiAke3Jlc3VsdC5QYXJhbWV0ZXI/LlZhbHVlfWApO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmNhY2hlLnNzbVBhcmFtZXRlcnMuc2V0KHBhcmFtZXRlck5hbWUsIGFzTnVtYmVyKTtcbiAgICAgIHJldHVybiBhc051bWJlcjtcbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIGlmIChlLm5hbWUgPT09ICdQYXJhbWV0ZXJOb3RGb3VuZCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIGBTU00gcGFyYW1ldGVyICR7cGFyYW1ldGVyTmFtZX0gbm90IGZvdW5kLiBIYXMgdGhlIGVudmlyb25tZW50IGJlZW4gYm9vdHN0cmFwcGVkPyBQbGVhc2UgcnVuIFxcJ2NkayBib290c3RyYXBcXCcgKHNlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vY2RrL2xhdGVzdC9ndWlkZS9ib290c3RyYXBwaW5nLmh0bWwpYCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIGFzeW5jIHByZXBhcmVFY3JSZXBvc2l0b3J5KHJlcG9zaXRvcnlOYW1lOiBzdHJpbmcpOiBQcm9taXNlPEVjclJlcG9zaXRvcnlJbmZvPiB7XG4gICAgaWYgKCF0aGlzLnNkaykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdUb29sa2l0SW5mbyBuZWVkcyB0byBoYXZlIGJlZW4gaW5pdGlhbGl6ZWQgd2l0aCBhbiBzZGsgdG8gY2FsbCBwcmVwYXJlRWNyUmVwb3NpdG9yeScpO1xuICAgIH1cbiAgICBjb25zdCBlY3IgPSB0aGlzLnNkay5lY3IoKTtcblxuICAgIC8vIGNoZWNrIGlmIHJlcG8gYWxyZWFkeSBleGlzdHNcbiAgICB0cnkge1xuICAgICAgZGVidWcoYCR7cmVwb3NpdG9yeU5hbWV9OiBjaGVja2luZyBpZiBFQ1IgcmVwb3NpdG9yeSBhbHJlYWR5IGV4aXN0c2ApO1xuICAgICAgY29uc3QgZGVzY3JpYmVSZXNwb25zZSA9IGF3YWl0IGVjci5kZXNjcmliZVJlcG9zaXRvcmllcyh7XG4gICAgICAgIHJlcG9zaXRvcnlOYW1lczogW3JlcG9zaXRvcnlOYW1lXSxcbiAgICAgIH0pO1xuICAgICAgY29uc3QgZXhpc3RpbmdSZXBvc2l0b3J5VXJpID0gZGVzY3JpYmVSZXNwb25zZS5yZXBvc2l0b3JpZXMhWzBdPy5yZXBvc2l0b3J5VXJpO1xuICAgICAgaWYgKGV4aXN0aW5nUmVwb3NpdG9yeVVyaSkge1xuICAgICAgICByZXR1cm4geyByZXBvc2l0b3J5VXJpOiBleGlzdGluZ1JlcG9zaXRvcnlVcmkgfTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICAgIGlmIChlLm5hbWUgIT09ICdSZXBvc2l0b3J5Tm90Rm91bmRFeGNlcHRpb24nKSB7XG4gICAgICAgIHRocm93IGU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gY3JlYXRlIHRoZSByZXBvICh0YWcgaXQgc28gaXQgd2lsbCBiZSBlYXNpZXIgdG8gZ2FyYmFnZSBjb2xsZWN0IGluIHRoZSBmdXR1cmUpXG4gICAgZGVidWcoYCR7cmVwb3NpdG9yeU5hbWV9OiBjcmVhdGluZyBFQ1IgcmVwb3NpdG9yeWApO1xuICAgIGNvbnN0IGFzc2V0VGFnID0geyBLZXk6ICdhd3NjZGs6YXNzZXQnLCBWYWx1ZTogJ3RydWUnIH07XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBlY3IuY3JlYXRlUmVwb3NpdG9yeSh7XG4gICAgICByZXBvc2l0b3J5TmFtZSxcbiAgICAgIHRhZ3M6IFthc3NldFRhZ10sXG4gICAgfSk7XG4gICAgY29uc3QgcmVwb3NpdG9yeVVyaSA9IHJlc3BvbnNlLnJlcG9zaXRvcnk/LnJlcG9zaXRvcnlVcmk7XG4gICAgaWYgKCFyZXBvc2l0b3J5VXJpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENyZWF0ZVJlcG9zaXRvcnkgZGlkIG5vdCByZXR1cm4gYSByZXBvc2l0b3J5IFVSSSBmb3IgJHtyZXBvc2l0b3J5VXJpfWApO1xuICAgIH1cblxuICAgIC8vIGNvbmZpZ3VyZSBpbWFnZSBzY2FubmluZyBvbiBwdXNoIChoZWxwcyBpbiBpZGVudGlmeWluZyBzb2Z0d2FyZSB2dWxuZXJhYmlsaXRpZXMsIG5vIGFkZGl0aW9uYWwgY2hhcmdlKVxuICAgIGRlYnVnKGAke3JlcG9zaXRvcnlOYW1lfTogZW5hYmxlIGltYWdlIHNjYW5uaW5nYCk7XG4gICAgYXdhaXQgZWNyLnB1dEltYWdlU2Nhbm5pbmdDb25maWd1cmF0aW9uKHtcbiAgICAgIHJlcG9zaXRvcnlOYW1lLFxuICAgICAgaW1hZ2VTY2FubmluZ0NvbmZpZ3VyYXRpb246IHsgc2Nhbk9uUHVzaDogdHJ1ZSB9LFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHsgcmVwb3NpdG9yeVVyaSB9O1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBOb0Jvb3RzdHJhcFN0YWNrRW52aXJvbm1lbnRSZXNvdXJjZXMgZXh0ZW5kcyBFbnZpcm9ubWVudFJlc291cmNlcyB7XG4gIGNvbnN0cnVjdG9yKGVudmlyb25tZW50OiBFbnZpcm9ubWVudCwgc2RrOiBTREspIHtcbiAgICBzdXBlcihlbnZpcm9ubWVudCwgc2RrLCBlbXB0eUNhY2hlKCkpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvb2sgdXAgdGhlIHRvb2xraXQgZm9yIGEgZ2l2ZW4gZW52aXJvbm1lbnQsIHVzaW5nIGEgZ2l2ZW4gU0RLXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgbG9va3VwVG9vbGtpdCgpOiBQcm9taXNlPFRvb2xraXRJbmZvPiB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ1RyeWluZyB0byBwZXJmb3JtIGFuIG9wZXJhdGlvbiB0aGF0IHJlcXVpcmVzIGEgYm9vdHN0cmFwIHN0YWNrOyB5b3Ugc2hvdWxkIG5vdCBzZWUgdGhpcyBlcnJvciwgdGhpcyBpcyBhIGJ1ZyBpbiB0aGUgQ0RLIENMSS4nLFxuICAgICk7XG4gIH1cbn1cblxuLyoqXG4gKiBEYXRhIHRoYXQgaXMgY2FjaGVkIG9uIGEgcGVyLWVudmlyb25tZW50IGxldmVsXG4gKlxuICogVGhpcyBjYWNoZSBtYXkgYmUgc2hhcmVkIGJldHdlZW4gZGlmZmVyZW50IGluc3RhbmNlcyBvZiB0aGUgYEVudmlyb25tZW50UmVzb3VyY2VzYCBjbGFzcy5cbiAqL1xuaW50ZXJmYWNlIEVudmlyb25tZW50Q2FjaGUge1xuICByZWFkb25seSBzc21QYXJhbWV0ZXJzOiBNYXA8c3RyaW5nLCBudW1iZXI+O1xuICB0b29sa2l0SW5mbz86IFRvb2xraXRJbmZvO1xufVxuXG5mdW5jdGlvbiBlbXB0eUNhY2hlKCk6IEVudmlyb25tZW50Q2FjaGUge1xuICByZXR1cm4ge1xuICAgIHNzbVBhcmFtZXRlcnM6IG5ldyBNYXAoKSxcbiAgICB0b29sa2l0SW5mbzogdW5kZWZpbmVkLFxuICB9O1xufVxuXG4vKipcbiAqIFRoZSBib290c3RyYXAgdGVtcGxhdGUgdmVyc2lvbiB0aGF0IGludHJvZHVjZWQgc3NtOkdldFBhcmFtZXRlclxuICovXG5jb25zdCBCT09UU1RSQVBfVEVNUExBVEVfVkVSU0lPTl9JTlRST0RVQ0lOR19HRVRQQVJBTUVURVIgPSA1O1xuIl19