"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BootstrapStack = void 0;
exports.bootstrapVersionFromTemplate = bootstrapVersionFromTemplate;
exports.bootstrapVariantFromTemplate = bootstrapVariantFromTemplate;
const os = require("os");
const path = require("path");
const cloud_assembly_schema_1 = require("@aws-cdk/cloud-assembly-schema");
const cx_api_1 = require("@aws-cdk/cx-api");
const fs = require("fs-extra");
const bootstrap_props_1 = require("./bootstrap-props");
const logging = require("../../logging");
const deploy_stack_1 = require("../deploy-stack");
const environment_resources_1 = require("../environment-resources");
const plugin_1 = require("../plugin");
const toolkit_info_1 = require("../toolkit-info");
/**
 * A class to hold state around stack bootstrapping
 *
 * This class exists so we can break bootstrapping into 2 phases:
 *
 * ```ts
 * const current = BootstrapStack.lookup(...);
 * // ...
 * current.update(newTemplate, ...);
 * ```
 *
 * And do something in between the two phases (such as look at the
 * current bootstrap stack and doing something intelligent).
 */
class BootstrapStack {
    static async lookup(sdkProvider, environment, toolkitStackName) {
        toolkitStackName = toolkitStackName ?? toolkit_info_1.DEFAULT_TOOLKIT_STACK_NAME;
        const resolvedEnvironment = await sdkProvider.resolveEnvironment(environment);
        const sdk = (await sdkProvider.forEnvironment(resolvedEnvironment, plugin_1.Mode.ForWriting)).sdk;
        const currentToolkitInfo = await toolkit_info_1.ToolkitInfo.lookup(resolvedEnvironment, sdk, toolkitStackName);
        return new BootstrapStack(sdkProvider, sdk, resolvedEnvironment, toolkitStackName, currentToolkitInfo);
    }
    constructor(sdkProvider, sdk, resolvedEnvironment, toolkitStackName, currentToolkitInfo) {
        this.sdkProvider = sdkProvider;
        this.sdk = sdk;
        this.resolvedEnvironment = resolvedEnvironment;
        this.toolkitStackName = toolkitStackName;
        this.currentToolkitInfo = currentToolkitInfo;
    }
    get parameters() {
        return this.currentToolkitInfo.found ? this.currentToolkitInfo.bootstrapStack.parameters : {};
    }
    get terminationProtection() {
        return this.currentToolkitInfo.found ? this.currentToolkitInfo.bootstrapStack.terminationProtection : undefined;
    }
    async partition() {
        return (await this.sdk.currentAccount()).partition;
    }
    /**
     * Perform the actual deployment of a bootstrap stack, given a template and some parameters
     */
    async update(template, parameters, options) {
        if (this.currentToolkitInfo.found && !options.force) {
            // Safety checks
            const abortResponse = {
                type: 'did-deploy-stack',
                noOp: true,
                outputs: {},
                stackArn: this.currentToolkitInfo.bootstrapStack.stackId,
            };
            // Validate that the bootstrap stack we're trying to replace is from the same variant as the one we're trying to deploy
            const currentVariant = this.currentToolkitInfo.variant;
            const newVariant = bootstrapVariantFromTemplate(template);
            if (currentVariant !== newVariant) {
                logging.warning(`Bootstrap stack already exists, containing '${currentVariant}'. Not overwriting it with a template containing '${newVariant}' (use --force if you intend to overwrite)`);
                return abortResponse;
            }
            // Validate that we're not downgrading the bootstrap stack
            const newVersion = bootstrapVersionFromTemplate(template);
            const currentVersion = this.currentToolkitInfo.version;
            if (newVersion < currentVersion) {
                logging.warning(`Bootstrap stack already at version ${currentVersion}. Not downgrading it to version ${newVersion} (use --force if you intend to downgrade)`);
                if (newVersion === 0) {
                    // A downgrade with 0 as target version means we probably have a new-style bootstrap in the account,
                    // and an old-style bootstrap as current target, which means the user probably forgot to put this flag in.
                    logging.warning("(Did you set the '@aws-cdk/core:newStyleStackSynthesis' feature flag in cdk.json?)");
                }
                return abortResponse;
            }
        }
        const outdir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk-bootstrap'));
        const builder = new cx_api_1.CloudAssemblyBuilder(outdir);
        const templateFile = `${this.toolkitStackName}.template.json`;
        await fs.writeJson(path.join(builder.outdir, templateFile), template, {
            spaces: 2,
        });
        builder.addArtifact(this.toolkitStackName, {
            type: cloud_assembly_schema_1.ArtifactType.AWS_CLOUDFORMATION_STACK,
            environment: cx_api_1.EnvironmentUtils.format(this.resolvedEnvironment.account, this.resolvedEnvironment.region),
            properties: {
                templateFile,
                terminationProtection: options.terminationProtection ?? false,
            },
        });
        const assembly = builder.buildAssembly();
        const ret = await (0, deploy_stack_1.deployStack)({
            stack: assembly.getStackByName(this.toolkitStackName),
            resolvedEnvironment: this.resolvedEnvironment,
            sdk: this.sdk,
            sdkProvider: this.sdkProvider,
            force: options.force,
            roleArn: options.roleArn,
            tags: options.tags,
            deploymentMethod: { method: 'change-set', execute: options.execute },
            parameters,
            usePreviousParameters: options.usePreviousParameters ?? true,
            // Obviously we can't need a bootstrap stack to deploy a bootstrap stack
            envResources: new environment_resources_1.NoBootstrapStackEnvironmentResources(this.resolvedEnvironment, this.sdk),
        });
        (0, deploy_stack_1.assertIsSuccessfulDeployStackResult)(ret);
        return ret;
    }
}
exports.BootstrapStack = BootstrapStack;
function bootstrapVersionFromTemplate(template) {
    const versionSources = [
        template.Outputs?.[bootstrap_props_1.BOOTSTRAP_VERSION_OUTPUT]?.Value,
        template.Resources?.[bootstrap_props_1.BOOTSTRAP_VERSION_RESOURCE]?.Properties?.Value,
    ];
    for (const vs of versionSources) {
        if (typeof vs === 'number') {
            return vs;
        }
        if (typeof vs === 'string' && !isNaN(parseInt(vs, 10))) {
            return parseInt(vs, 10);
        }
    }
    return 0;
}
function bootstrapVariantFromTemplate(template) {
    return template.Parameters?.[bootstrap_props_1.BOOTSTRAP_VARIANT_PARAMETER]?.Default ?? bootstrap_props_1.DEFAULT_BOOTSTRAP_VARIANT;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVwbG95LWJvb3RzdHJhcC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImRlcGxveS1ib290c3RyYXAudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBbUpBLG9FQWVDO0FBRUQsb0VBRUM7QUF0S0QseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QiwwRUFBOEQ7QUFDOUQsNENBQXNGO0FBQ3RGLCtCQUErQjtBQUMvQix1REFNMkI7QUFDM0IseUNBQXlDO0FBRXpDLGtEQUFnSDtBQUNoSCxvRUFBZ0Y7QUFDaEYsc0NBQWlDO0FBQ2pDLGtEQUEwRTtBQUUxRTs7Ozs7Ozs7Ozs7OztHQWFHO0FBQ0gsTUFBYSxjQUFjO0lBQ2xCLE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLFdBQXdCLEVBQUUsV0FBd0IsRUFBRSxnQkFBeUI7UUFDdEcsZ0JBQWdCLEdBQUcsZ0JBQWdCLElBQUkseUNBQTBCLENBQUM7UUFFbEUsTUFBTSxtQkFBbUIsR0FBRyxNQUFNLFdBQVcsQ0FBQyxrQkFBa0IsQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUM5RSxNQUFNLEdBQUcsR0FBRyxDQUFDLE1BQU0sV0FBVyxDQUFDLGNBQWMsQ0FBQyxtQkFBbUIsRUFBRSxhQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUM7UUFFekYsTUFBTSxrQkFBa0IsR0FBRyxNQUFNLDBCQUFXLENBQUMsTUFBTSxDQUFDLG1CQUFtQixFQUFFLEdBQUcsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO1FBRWhHLE9BQU8sSUFBSSxjQUFjLENBQUMsV0FBVyxFQUFFLEdBQUcsRUFBRSxtQkFBbUIsRUFBRSxnQkFBZ0IsRUFBRSxrQkFBa0IsQ0FBQyxDQUFDO0lBQ3pHLENBQUM7SUFFRCxZQUNtQixXQUF3QixFQUN4QixHQUFRLEVBQ1IsbUJBQWdDLEVBQ2hDLGdCQUF3QixFQUN4QixrQkFBK0I7UUFKL0IsZ0JBQVcsR0FBWCxXQUFXLENBQWE7UUFDeEIsUUFBRyxHQUFILEdBQUcsQ0FB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QWdIQztBQUVELFNBQWdCLDRCQUE0QixDQUFDLFFBQWE7SUFDeEQsTUFBTSxjQUFjLEdBQUc7UUFDckIsUUFBUSxDQUFDLE9BQU8sRUFBRSxDQUFDLDBDQUF3QixDQUFDLEVBQUUsS0FBSztRQUNuRCxRQUFRLENBQUMsU0FBUyxFQUFFLENBQUMsNENBQTBCLENBQUMsRUFBRSxVQUFVLEVBQUUsS0FBSztLQUNwRSxDQUFDO0lBRUYsS0FBSyxNQUFNLEVBQUUsSUFBSSxjQUFjLEVBQUUsQ0FBQztRQUNoQyxJQUFJLE9BQU8sRUFBRSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQzNCLE9BQU8sRUFBRSxDQUFDO1FBQ1osQ0FBQztRQUNELElBQUksT0FBTyxFQUFFLEtBQUssUUFBUSxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQ3ZELE9BQU8sUUFBUSxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUMxQixDQUFDO0lBQ0gsQ0FBQztJQUNELE9BQU8sQ0FBQyxDQUFDO0FBQ1gsQ0FBQztBQUVELFNBQWdCLDRCQUE0QixDQUFDLFFBQWE7SUFDeEQsT0FBTyxRQUFRLENBQUMsVUFBVSxFQUFFLENBQUMsNkNBQTJCLENBQUMsRUFBRSxPQUFPLElBQUksMkNBQXlCLENBQUM7QUFDbEcsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIG9zIGZyb20gJ29zJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBBcnRpZmFjdFR5cGUgfSBmcm9tICdAYXdzLWNkay9jbG91ZC1hc3NlbWJseS1zY2hlbWEnO1xuaW1wb3J0IHsgQ2xvdWRBc3NlbWJseUJ1aWxkZXIsIEVudmlyb25tZW50LCBFbnZpcm9ubWVudFV0aWxzIH0gZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzLWV4dHJhJztcbmltcG9ydCB7XG4gIEJPT1RTVFJBUF9WQVJJQU5UX1BBUkFNRVRFUixcbiAgQk9PVFNUUkFQX1ZFUlNJT05fT1VUUFVULFxuICBCT09UU1RSQVBfVkVSU0lPTl9SRVNPVVJDRSxcbiAgQm9vdHN0cmFwRW52aXJvbm1lbnRPcHRpb25zLFxuICBERUZBVUxUX0JPT1RTVFJBUF9WQVJJQU5ULFxufSBmcm9tICcuL2Jvb3RzdHJhcC1wcm9wcyc7XG5pbXBvcnQgKiBhcyBsb2dnaW5nIGZyb20gJy4uLy4uL2xvZ2dpbmcnO1xuaW1wb3J0IHR5cGUgeyBTREssIFNka1Byb3ZpZGVyIH0gZnJvbSAnLi4vYXdzLWF1dGgnO1xuaW1wb3J0IHsgYXNzZXJ0SXNTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQsIGRlcGxveVN0YWNrLCBTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQgfSBmcm9tICcuLi9kZXBsb3ktc3RhY2snO1xuaW1wb3J0IHsgTm9Cb290c3RyYXBTdGFja0Vudmlyb25tZW50UmVzb3VyY2VzIH0gZnJvbSAnLi4vZW52aXJvbm1lbnQtcmVzb3VyY2VzJztcbmltcG9ydCB7IE1vZGUgfSBmcm9tICcuLi9wbHVnaW4nO1xuaW1wb3J0IHsgREVGQVVMVF9UT09MS0lUX1NUQUNLX05BTUUsIFRvb2xraXRJbmZvIH0gZnJvbSAnLi4vdG9vbGtpdC1pbmZvJztcblxuLyoqXG4gKiBBIGNsYXNzIHRvIGhvbGQgc3RhdGUgYXJvdW5kIHN0YWNrIGJvb3RzdHJhcHBpbmdcbiAqXG4gKiBUaGlzIGNsYXNzIGV4aXN0cyBzbyB3ZSBjYW4gYnJlYWsgYm9vdHN0cmFwcGluZyBpbnRvIDIgcGhhc2VzOlxuICpcbiAqIGBgYHRzXG4gKiBjb25zdCBjdXJyZW50ID0gQm9vdHN0cmFwU3RhY2subG9va3VwKC4uLik7XG4gKiAvLyAuLi5cbiAqIGN1cnJlbnQudXBkYXRlKG5ld1RlbXBsYXRlLCAuLi4pO1xuICogYGBgXG4gKlxuICogQW5kIGRvIHNvbWV0aGluZyBpbiBiZXR3ZWVuIHRoZSB0d28gcGhhc2VzIChzdWNoIGFzIGxvb2sgYXQgdGhlXG4gKiBjdXJyZW50IGJvb3RzdHJhcCBzdGFjayBhbmQgZG9pbmcgc29tZXRoaW5nIGludGVsbGlnZW50KS5cbiAqL1xuZXhwb3J0IGNsYXNzIEJvb3RzdHJhcFN0YWNrIHtcbiAgcHVibGljIHN0YXRpYyBhc3luYyBsb29rdXAoc2RrUHJvdmlkZXI6IFNka1Byb3ZpZGVyLCBlbnZpcm9ubWVudDogRW52aXJvbm1lbnQsIHRvb2xraXRTdGFja05hbWU/OiBzdHJpbmcpIHtcbiAgICB0b29sa2l0U3RhY2tOYW1lID0gdG9vbGtpdFN0YWNrTmFtZSA/PyBERUZBVUxUX1RPT0xLSVRfU1RBQ0tfTkFNRTtcblxuICAgIGNvbnN0IHJlc29sdmVkRW52aXJvbm1lbnQgPSBhd2FpdCBzZGtQcm92aWRlci5yZXNvbHZlRW52aXJvbm1lbnQoZW52aXJvbm1lbnQpO1xuICAgIGNvbnN0IHNkayA9IChhd2FpdCBzZGtQcm92aWRlci5mb3JFbnZpcm9ubWVudChyZXNvbHZlZEVudmlyb25tZW50LCBNb2RlLkZvcldyaXRpbmcpKS5zZGs7XG5cbiAgICBjb25zdCBjdXJyZW50VG9vbGtpdEluZm8gPSBhd2FpdCBUb29sa2l0SW5mby5sb29rdXAocmVzb2x2ZWRFbnZpcm9ubWVudCwgc2RrLCB0b29sa2l0U3RhY2tOYW1lKTtcblxuICAgIHJldHVybiBuZXcgQm9vdHN0cmFwU3RhY2soc2RrUHJvdmlkZXIsIHNkaywgcmVzb2x2ZWRFbnZpcm9ubWVudCwgdG9vbGtpdFN0YWNrTmFtZSwgY3VycmVudFRvb2xraXRJbmZvKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlcixcbiAgICBwcml2YXRlIHJlYWRvbmx5IHNkazogU0RLLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVzb2x2ZWRFbnZpcm9ubWVudDogRW52aXJvbm1lbnQsXG4gICAgcHJpdmF0ZSByZWFkb25seSB0b29sa2l0U3RhY2tOYW1lOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBjdXJyZW50VG9vbGtpdEluZm86IFRvb2xraXRJbmZvLFxuICApIHt9XG5cbiAgcHVibGljIGdldCBwYXJhbWV0ZXJzKCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIHJldHVybiB0aGlzLmN1cnJlbnRUb29sa2l0SW5mby5mb3VuZCA/IHRoaXMuY3VycmVudFRvb2xraXRJbmZvLmJvb3RzdHJhcFN0YWNrLnBhcmFtZXRlcnMgOiB7fTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgdGVybWluYXRpb25Qcm90ZWN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmN1cnJlbnRUb29sa2l0SW5mby5mb3VuZCA/IHRoaXMuY3VycmVudFRvb2xraXRJbmZvLmJvb3RzdHJhcFN0YWNrLnRlcm1pbmF0aW9uUHJvdGVjdGlvbiA6IHVuZGVmaW5lZDtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBwYXJ0aXRpb24oKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gKGF3YWl0IHRoaXMuc2RrLmN1cnJlbnRBY2NvdW50KCkpLnBhcnRpdGlvbjtcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJmb3JtIHRoZSBhY3R1YWwgZGVwbG95bWVudCBvZiBhIGJvb3RzdHJhcCBzdGFjaywgZ2l2ZW4gYSB0ZW1wbGF0ZSBhbmQgc29tZSBwYXJhbWV0ZXJzXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgdXBkYXRlKFxuICAgIHRlbXBsYXRlOiBhbnksXG4gICAgcGFyYW1ldGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPixcbiAgICBvcHRpb25zOiBPbWl0PEJvb3RzdHJhcEVudmlyb25tZW50T3B0aW9ucywgJ3BhcmFtZXRlcnMnPixcbiAgKTogUHJvbWlzZTxTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQ+IHtcbiAgICBpZiAodGhpcy5jdXJyZW50VG9vbGtpdEluZm8uZm91bmQgJiYgIW9wdGlvbnMuZm9yY2UpIHtcbiAgICAgIC8vIFNhZmV0eSBjaGVja3NcbiAgICAgIGNvbnN0IGFib3J0UmVzcG9uc2UgPSB7XG4gICAgICAgIHR5cGU6ICdkaWQtZGVwbG95LXN0YWNrJyxcbiAgICAgICAgbm9PcDogdHJ1ZSxcbiAgICAgICAgb3V0cHV0czoge30sXG4gICAgICAgIHN0YWNrQXJuOiB0aGlzLmN1cnJlbnRUb29sa2l0SW5mby5ib290c3RyYXBTdGFjay5zdGFja0lkLFxuICAgICAgfSBzYXRpc2ZpZXMgU3VjY2Vzc2Z1bERlcGxveVN0YWNrUmVzdWx0O1xuXG4gICAgICAvLyBWYWxpZGF0ZSB0aGF0IHRoZSBib290c3RyYXAgc3RhY2sgd2UncmUgdHJ5aW5nIHRvIHJlcGxhY2UgaXMgZnJvbSB0aGUgc2FtZSB2YXJpYW50IGFzIHRoZSBvbmUgd2UncmUgdHJ5aW5nIHRvIGRlcGxveVxuICAgICAgY29uc3QgY3VycmVudFZhcmlhbnQgPSB0aGlzLmN1cnJlbnRUb29sa2l0SW5mby52YXJpYW50O1xuICAgICAgY29uc3QgbmV3VmFyaWFudCA9IGJvb3RzdHJhcFZhcmlhbnRGcm9tVGVtcGxhdGUodGVtcGxhdGUpO1xuICAgICAgaWYgKGN1cnJlbnRWYXJpYW50ICE9PSBuZXdWYXJpYW50KSB7XG4gICAgICAgIGxvZ2dpbmcud2FybmluZyhcbiAgICAgICAgICBgQm9vdHN0cmFwIHN0YWNrIGFscmVhZHkgZXhpc3RzLCBjb250YWluaW5nICcke2N1cnJlbnRWYXJpYW50fScuIE5vdCBvdmVyd3JpdGluZyBpdCB3aXRoIGEgdGVtcGxhdGUgY29udGFpbmluZyAnJHtuZXdWYXJpYW50fScgKHVzZSAtLWZvcmNlIGlmIHlvdSBpbnRlbmQgdG8gb3ZlcndyaXRlKWAsXG4gICAgICAgICk7XG4gICAgICAgIHJldHVybiBhYm9ydFJlc3BvbnNlO1xuICAgICAgfVxuXG4gICAgICAvLyBWYWxpZGF0ZSB0aGF0IHdlJ3JlIG5vdCBkb3duZ3JhZGluZyB0aGUgYm9vdHN0cmFwIHN0YWNrXG4gICAgICBjb25zdCBuZXdWZXJzaW9uID0gYm9vdHN0cmFwVmVyc2lvbkZyb21UZW1wbGF0ZSh0ZW1wbGF0ZSk7XG4gICAgICBjb25zdCBjdXJyZW50VmVyc2lvbiA9IHRoaXMuY3VycmVudFRvb2xraXRJbmZvLnZlcnNpb247XG4gICAgICBpZiAobmV3VmVyc2lvbiA8IGN1cnJlbnRWZXJzaW9uKSB7XG4gICAgICAgIGxvZ2dpbmcud2FybmluZyhcbiAgICAgICAgICBgQm9vdHN0cmFwIHN0YWNrIGFscmVhZHkgYXQgdmVyc2lvbiAke2N1cnJlbnRWZXJzaW9ufS4gTm90IGRvd25ncmFkaW5nIGl0IHRvIHZlcnNpb24gJHtuZXdWZXJzaW9ufSAodXNlIC0tZm9yY2UgaWYgeW91IGludGVuZCB0byBkb3duZ3JhZGUpYCxcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKG5ld1ZlcnNpb24gPT09IDApIHtcbiAgICAgICAgICAvLyBBIGRvd25ncmFkZSB3aXRoIDAgYXMgdGFyZ2V0IHZlcnNpb24gbWVhbnMgd2UgcHJvYmFibHkgaGF2ZSBhIG5ldy1zdHlsZSBib290c3RyYXAgaW4gdGhlIGFjY291bnQsXG4gICAgICAgICAgLy8gYW5kIGFuIG9sZC1zdHlsZSBib290c3RyYXAgYXMgY3VycmVudCB0YXJnZXQsIHdoaWNoIG1lYW5zIHRoZSB1c2VyIHByb2JhYmx5IGZvcmdvdCB0byBwdXQgdGhpcyBmbGFnIGluLlxuICAgICAgICAgIGxvZ2dpbmcud2FybmluZyhcIihEaWQgeW91IHNldCB0aGUgJ0Bhd3MtY2RrL2NvcmU6bmV3U3R5bGVTdGFja1N5bnRoZXNpcycgZmVhdHVyZSBmbGFnIGluIGNkay5qc29uPylcIik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGFib3J0UmVzcG9uc2U7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgb3V0ZGlyID0gYXdhaXQgZnMubWtkdGVtcChwYXRoLmpvaW4ob3MudG1wZGlyKCksICdjZGstYm9vdHN0cmFwJykpO1xuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgQ2xvdWRBc3NlbWJseUJ1aWxkZXIob3V0ZGlyKTtcbiAgICBjb25zdCB0ZW1wbGF0ZUZpbGUgPSBgJHt0aGlzLnRvb2xraXRTdGFja05hbWV9LnRlbXBsYXRlLmpzb25gO1xuICAgIGF3YWl0IGZzLndyaXRlSnNvbihwYXRoLmpvaW4oYnVpbGRlci5vdXRkaXIsIHRlbXBsYXRlRmlsZSksIHRlbXBsYXRlLCB7XG4gICAgICBzcGFjZXM6IDIsXG4gICAgfSk7XG5cbiAgICBidWlsZGVyLmFkZEFydGlmYWN0KHRoaXMudG9vbGtpdFN0YWNrTmFtZSwge1xuICAgICAgdHlwZTogQXJ0aWZhY3RUeXBlLkFXU19DTE9VREZPUk1BVElPTl9TVEFDSyxcbiAgICAgIGVudmlyb25tZW50OiBFbnZpcm9ubWVudFV0aWxzLmZvcm1hdCh0aGlzLnJlc29sdmVkRW52aXJvbm1lbnQuYWNjb3VudCwgdGhpcy5yZXNvbHZlZEVudmlyb25tZW50LnJlZ2lvbiksXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIHRlbXBsYXRlRmlsZSxcbiAgICAgICAgdGVybWluYXRpb25Qcm90ZWN0aW9uOiBvcHRpb25zLnRlcm1pbmF0aW9uUHJvdGVjdGlvbiA/PyBmYWxzZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBhc3NlbWJseSA9IGJ1aWxkZXIuYnVpbGRBc3NlbWJseSgpO1xuXG4gICAgY29uc3QgcmV0ID0gYXdhaXQgZGVwbG95U3RhY2soe1xuICAgICAgc3RhY2s6IGFzc2VtYmx5LmdldFN0YWNrQnlOYW1lKHRoaXMudG9vbGtpdFN0YWNrTmFtZSksXG4gICAgICByZXNvbHZlZEVudmlyb25tZW50OiB0aGlzLnJlc29sdmVkRW52aXJvbm1lbnQsXG4gICAgICBzZGs6IHRoaXMuc2RrLFxuICAgICAgc2RrUHJvdmlkZXI6IHRoaXMuc2RrUHJvdmlkZXIsXG4gICAgICBmb3JjZTogb3B0aW9ucy5mb3JjZSxcbiAgICAgIHJvbGVBcm46IG9wdGlvbnMucm9sZUFybixcbiAgICAgIHRhZ3M6IG9wdGlvbnMudGFncyxcbiAgICAgIGRlcGxveW1lbnRNZXRob2Q6IHsgbWV0aG9kOiAnY2hhbmdlLXNldCcsIGV4ZWN1dGU6IG9wdGlvbnMuZXhlY3V0ZSB9LFxuICAgICAgcGFyYW1ldGVycyxcbiAgICAgIHVzZVByZXZpb3VzUGFyYW1ldGVyczogb3B0aW9ucy51c2VQcmV2aW91c1BhcmFtZXRlcnMgPz8gdHJ1ZSxcbiAgICAgIC8vIE9idmlvdXNseSB3ZSBjYW4ndCBuZWVkIGEgYm9vdHN0cmFwIHN0YWNrIHRvIGRlcGxveSBhIGJvb3RzdHJhcCBzdGFja1xuICAgICAgZW52UmVzb3VyY2VzOiBuZXcgTm9Cb290c3RyYXBTdGFja0Vudmlyb25tZW50UmVzb3VyY2VzKHRoaXMucmVzb2x2ZWRFbnZpcm9ubWVudCwgdGhpcy5zZGspLFxuICAgIH0pO1xuXG4gICAgYXNzZXJ0SXNTdWNjZXNzZnVsRGVwbG95U3RhY2tSZXN1bHQocmV0KTtcblxuICAgIHJldHVybiByZXQ7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJvb3RzdHJhcFZlcnNpb25Gcm9tVGVtcGxhdGUodGVtcGxhdGU6IGFueSk6IG51bWJlciB7XG4gIGNvbnN0IHZlcnNpb25Tb3VyY2VzID0gW1xuICAgIHRlbXBsYXRlLk91dHB1dHM/LltCT09UU1RSQVBfVkVSU0lPTl9PVVRQVVRdPy5WYWx1ZSxcbiAgICB0ZW1wbGF0ZS5SZXNvdXJjZXM/LltCT09UU1RSQVBfVkVSU0lPTl9SRVNPVVJDRV0/LlByb3BlcnRpZXM/LlZhbHVlLFxuICBdO1xuXG4gIGZvciAoY29uc3QgdnMgb2YgdmVyc2lvblNvdXJjZXMpIHtcbiAgICBpZiAodHlwZW9mIHZzID09PSAnbnVtYmVyJykge1xuICAgICAgcmV0dXJuIHZzO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHZzID09PSAnc3RyaW5nJyAmJiAhaXNOYU4ocGFyc2VJbnQodnMsIDEwKSkpIHtcbiAgICAgIHJldHVybiBwYXJzZUludCh2cywgMTApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gMDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJvb3RzdHJhcFZhcmlhbnRGcm9tVGVtcGxhdGUodGVtcGxhdGU6IGFueSk6IHN0cmluZyB7XG4gIHJldHVybiB0ZW1wbGF0ZS5QYXJhbWV0ZXJzPy5bQk9PVFNUUkFQX1ZBUklBTlRfUEFSQU1FVEVSXT8uRGVmYXVsdCA/PyBERUZBVUxUX0JPT1RTVFJBUF9WQVJJQU5UO1xufVxuIl19