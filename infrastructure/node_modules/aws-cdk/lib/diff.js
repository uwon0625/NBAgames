"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequireApproval = void 0;
exports.printStackDiff = printStackDiff;
exports.printSecurityDiff = printSecurityDiff;
const util_1 = require("util");
const cxschema = require("@aws-cdk/cloud-assembly-schema");
const cloudformation_diff_1 = require("@aws-cdk/cloudformation-diff");
const chalk = require("chalk");
const logging_1 = require("./logging");
/**
 * Pretty-prints the differences between two template states to the console.
 *
 * @param oldTemplate the old/current state of the stack.
 * @param newTemplate the new/target state of the stack.
 * @param strict      do not filter out AWS::CDK::Metadata or Rules
 * @param context     lines of context to use in arbitrary JSON diff
 * @param quiet       silences \'There were no differences\' messages
 *
 * @returns the number of stacks in this stack tree that have differences, including the top-level root stack
 */
function printStackDiff(oldTemplate, newTemplate, strict, context, quiet, stackName, changeSet, isImport, stream = process.stderr, nestedStackTemplates) {
    let diff = (0, cloudformation_diff_1.fullDiff)(oldTemplate, newTemplate.template, changeSet, isImport);
    // must output the stack name if there are differences, even if quiet
    if (stackName && (!quiet || !diff.isEmpty)) {
        stream.write((0, util_1.format)('Stack %s\n', chalk.bold(stackName)));
    }
    if (!quiet && isImport) {
        stream.write('Parameters and rules created during migration do not affect resource configuration.\n');
    }
    // detect and filter out mangled characters from the diff
    let filteredChangesCount = 0;
    if (diff.differenceCount && !strict) {
        const mangledNewTemplate = JSON.parse((0, cloudformation_diff_1.mangleLikeCloudFormation)(JSON.stringify(newTemplate.template)));
        const mangledDiff = (0, cloudformation_diff_1.fullDiff)(oldTemplate, mangledNewTemplate, changeSet);
        filteredChangesCount = Math.max(0, diff.differenceCount - mangledDiff.differenceCount);
        if (filteredChangesCount > 0) {
            diff = mangledDiff;
        }
    }
    // filter out 'AWS::CDK::Metadata' resources from the template
    // filter out 'CheckBootstrapVersion' rules from the template
    if (!strict) {
        obscureDiff(diff);
    }
    let stackDiffCount = 0;
    if (!diff.isEmpty) {
        stackDiffCount++;
        (0, cloudformation_diff_1.formatDifferences)(stream, diff, {
            ...logicalIdMapFromTemplate(oldTemplate),
            ...buildLogicalToPathMap(newTemplate),
        }, context);
    }
    else if (!quiet) {
        (0, logging_1.print)(chalk.green('There were no differences'));
    }
    if (filteredChangesCount > 0) {
        (0, logging_1.print)(chalk.yellow(`Omitted ${filteredChangesCount} changes because they are likely mangled non-ASCII characters. Use --strict to print them.`));
    }
    for (const nestedStackLogicalId of Object.keys(nestedStackTemplates ?? {})) {
        if (!nestedStackTemplates) {
            break;
        }
        const nestedStack = nestedStackTemplates[nestedStackLogicalId];
        newTemplate._template = nestedStack.generatedTemplate;
        stackDiffCount += printStackDiff(nestedStack.deployedTemplate, newTemplate, strict, context, quiet, nestedStack.physicalName ?? nestedStackLogicalId, undefined, isImport, stream, nestedStack.nestedStackTemplates);
    }
    return stackDiffCount;
}
var RequireApproval;
(function (RequireApproval) {
    RequireApproval["Never"] = "never";
    RequireApproval["AnyChange"] = "any-change";
    RequireApproval["Broadening"] = "broadening";
})(RequireApproval || (exports.RequireApproval = RequireApproval = {}));
/**
 * Print the security changes of this diff, if the change is impactful enough according to the approval level
 *
 * Returns true if the changes are prompt-worthy, false otherwise.
 */
function printSecurityDiff(oldTemplate, newTemplate, requireApproval, _quiet, stackName, changeSet, stream = process.stderr) {
    const diff = (0, cloudformation_diff_1.fullDiff)(oldTemplate, newTemplate.template, changeSet);
    if (diffRequiresApproval(diff, requireApproval)) {
        stream.write((0, util_1.format)('Stack %s\n', chalk.bold(stackName)));
        // eslint-disable-next-line max-len
        (0, logging_1.warning)(`This deployment will make potentially sensitive changes according to your current security approval level (--require-approval ${requireApproval}).`);
        (0, logging_1.warning)('Please confirm you intend to make the following modifications:\n');
        (0, cloudformation_diff_1.formatSecurityChanges)(process.stdout, diff, buildLogicalToPathMap(newTemplate));
        return true;
    }
    return false;
}
/**
 * Return whether the diff has security-impacting changes that need confirmation
 *
 * TODO: Filter the security impact determination based off of an enum that allows
 * us to pick minimum "severities" to alert on.
 */
function diffRequiresApproval(diff, requireApproval) {
    switch (requireApproval) {
        case RequireApproval.Never: return false;
        case RequireApproval.AnyChange: return diff.permissionsAnyChanges;
        case RequireApproval.Broadening: return diff.permissionsBroadened;
        default: throw new Error(`Unrecognized approval level: ${requireApproval}`);
    }
}
function buildLogicalToPathMap(stack) {
    const map = {};
    for (const md of stack.findMetadataByType(cxschema.ArtifactMetadataEntryType.LOGICAL_ID)) {
        map[md.data] = md.path;
    }
    return map;
}
function logicalIdMapFromTemplate(template) {
    const ret = {};
    for (const [logicalId, resource] of Object.entries(template.Resources ?? {})) {
        const path = resource?.Metadata?.['aws:cdk:path'];
        if (path) {
            ret[logicalId] = path;
        }
    }
    return ret;
}
/**
 * Remove any template elements that we don't want to show users.
 * This is currently:
 * - AWS::CDK::Metadata resource
 * - CheckBootstrapVersion Rule
 */
function obscureDiff(diff) {
    if (diff.unknown) {
        // see https://github.com/aws/aws-cdk/issues/17942
        diff.unknown = diff.unknown.filter(change => {
            if (!change) {
                return true;
            }
            if (change.newValue?.CheckBootstrapVersion) {
                return false;
            }
            if (change.oldValue?.CheckBootstrapVersion) {
                return false;
            }
            return true;
        });
    }
    if (diff.resources) {
        diff.resources = diff.resources.filter(change => {
            if (!change) {
                return true;
            }
            if (change.newResourceType === 'AWS::CDK::Metadata') {
                return false;
            }
            if (change.oldResourceType === 'AWS::CDK::Metadata') {
                return false;
            }
            return true;
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGlmZi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImRpZmYudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBMkJBLHdDQTJFQztBQWVELDhDQXNCQztBQTNJRCwrQkFBOEI7QUFDOUIsMkRBQTJEO0FBQzNELHNFQVFzQztBQUV0QywrQkFBK0I7QUFFL0IsdUNBQTJDO0FBRTNDOzs7Ozs7Ozs7O0dBVUc7QUFDSCxTQUFnQixjQUFjLENBQzVCLFdBQWdCLEVBQ2hCLFdBQThDLEVBQzlDLE1BQWUsRUFDZixPQUFlLEVBQ2YsS0FBYyxFQUNkLFNBQWtCLEVBQ2xCLFNBQW1DLEVBQ25DLFFBQWtCLEVBQ2xCLFNBQXVCLE9BQU8sQ0FBQyxNQUFNLEVBQ3JDLG9CQUErRTtJQUMvRSxJQUFJLElBQUksR0FBRyxJQUFBLDhCQUFRLEVBQUMsV0FBVyxFQUFFLFdBQVcsQ0FBQyxRQUFRLEVBQUUsU0FBUyxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBRTVFLHFFQUFxRTtJQUNyRSxJQUFJLFNBQVMsSUFBSSxDQUFDLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDM0MsTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFBLGFBQU0sRUFBQyxZQUFZLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDNUQsQ0FBQztJQUVELElBQUksQ0FBQyxLQUFLLElBQUksUUFBUSxFQUFFLENBQUM7UUFDdkIsTUFBTSxDQUFDLEtBQUssQ0FBQyx1RkFBdUYsQ0FBQyxDQUFDO0lBQ3hHLENBQUM7SUFFRCx5REFBeUQ7SUFDekQsSUFBSSxvQkFBb0IsR0FBRyxDQUFDLENBQUM7SUFDN0IsSUFBSSxJQUFJLENBQUMsZUFBZSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDcEMsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUEsOENBQXdCLEVBQUMsSUFBSSxDQUFDLFNB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QWUsS0FBSyxvQkFBb0IsRUFBRSxDQUFDO2dCQUFDLE9BQU8sS0FBSyxDQUFDO1lBQUMsQ0FBQztZQUN0RSxJQUFJLE1BQU0sQ0FBQyxlQUFlLEtBQUssb0JBQW9CLEVBQUUsQ0FBQztnQkFBQyxPQUFPLEtBQUssQ0FBQztZQUFDLENBQUM7WUFDdEUsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZm9ybWF0IH0gZnJvbSAndXRpbCc7XG5pbXBvcnQgKiBhcyBjeHNjaGVtYSBmcm9tICdAYXdzLWNkay9jbG91ZC1hc3NlbWJseS1zY2hlbWEnO1xuaW1wb3J0IHtcbiAgdHlwZSBEZXNjcmliZUNoYW5nZVNldE91dHB1dCxcbiAgdHlwZSBGb3JtYXRTdHJlYW0sXG4gIHR5cGUgVGVtcGxhdGVEaWZmLFxuICBmb3JtYXREaWZmZXJlbmNlcyxcbiAgZm9ybWF0U2VjdXJpdHlDaGFuZ2VzLFxuICBmdWxsRGlmZixcbiAgbWFuZ2xlTGlrZUNsb3VkRm9ybWF0aW9uLFxufSBmcm9tICdAYXdzLWNkay9jbG91ZGZvcm1hdGlvbi1kaWZmJztcbmltcG9ydCAqIGFzIGN4YXBpIGZyb20gJ0Bhd3MtY2RrL2N4LWFwaSc7XG5pbXBvcnQgKiBhcyBjaGFsayBmcm9tICdjaGFsayc7XG5pbXBvcnQgeyBOZXN0ZWRTdGFja1RlbXBsYXRlcyB9IGZyb20gJy4vYXBpL25lc3RlZC1zdGFjay1oZWxwZXJzJztcbmltcG9ydCB7IHByaW50LCB3YXJuaW5nIH0gZnJvbSAnLi9sb2dnaW5nJztcblxuLyoqXG4gKiBQcmV0dHktcHJpbnRzIHRoZSBkaWZmZXJlbmNlcyBiZXR3ZWVuIHR3byB0ZW1wbGF0ZSBzdGF0ZXMgdG8gdGhlIGNvbnNvbGUuXG4gKlxuICogQHBhcmFtIG9sZFRlbXBsYXRlIHRoZSBvbGQvY3VycmVudCBzdGF0ZSBvZiB0aGUgc3RhY2suXG4gKiBAcGFyYW0gbmV3VGVtcGxhdGUgdGhlIG5ldy90YXJnZXQgc3RhdGUgb2YgdGhlIHN0YWNrLlxuICogQHBhcmFtIHN0cmljdCAgICAgIGRvIG5vdCBmaWx0ZXIgb3V0IEFXUzo6Q0RLOjpNZXRhZGF0YSBvciBSdWxlc1xuICogQHBhcmFtIGNvbnRleHQgICAgIGxpbmVzIG9mIGNvbnRleHQgdG8gdXNlIGluIGFyYml0cmFyeSBKU09OIGRpZmZcbiAqIEBwYXJhbSBxdWlldCAgICAgICBzaWxlbmNlcyBcXCdUaGVyZSB3ZXJlIG5vIGRpZmZlcmVuY2VzXFwnIG1lc3NhZ2VzXG4gKlxuICogQHJldHVybnMgdGhlIG51bWJlciBvZiBzdGFja3MgaW4gdGhpcyBzdGFjayB0cmVlIHRoYXQgaGF2ZSBkaWZmZXJlbmNlcywgaW5jbHVkaW5nIHRoZSB0b3AtbGV2ZWwgcm9vdCBzdGFja1xuICovXG5leHBvcnQgZnVuY3Rpb24gcHJpbnRTdGFja0RpZmYoXG4gIG9sZFRlbXBsYXRlOiBhbnksXG4gIG5ld1RlbXBsYXRlOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QsXG4gIHN0cmljdDogYm9vbGVhbixcbiAgY29udGV4dDogbnVtYmVyLFxuICBxdWlldDogYm9vbGVhbixcbiAgc3RhY2tOYW1lPzogc3RyaW5nLFxuICBjaGFuZ2VTZXQ/OiBEZXNjcmliZUNoYW5nZVNldE91dHB1dCxcbiAgaXNJbXBvcnQ/OiBib29sZWFuLFxuICBzdHJlYW06IEZvcm1hdFN0cmVhbSA9IHByb2Nlc3Muc3RkZXJyLFxuICBuZXN0ZWRTdGFja1RlbXBsYXRlcz86IHsgW25lc3RlZFN0YWNrTG9naWNhbElkOiBzdHJpbmddOiBOZXN0ZWRTdGFja1RlbXBsYXRlcyB9KTogbnVtYmVyIHtcbiAgbGV0IGRpZmYgPSBmdWxsRGlmZihvbGRUZW1wbGF0ZSwgbmV3VGVtcGxhdGUudGVtcGxhdGUsIGNoYW5nZVNldCwgaXNJbXBvcnQpO1xuXG4gIC8vIG11c3Qgb3V0cHV0IHRoZSBzdGFjayBuYW1lIGlmIHRoZXJlIGFyZSBkaWZmZXJlbmNlcywgZXZlbiBpZiBxdWlldFxuICBpZiAoc3RhY2tOYW1lICYmICghcXVpZXQgfHwgIWRpZmYuaXNFbXB0eSkpIHtcbiAgICBzdHJlYW0ud3JpdGUoZm9ybWF0KCdTdGFjayAlc1xcbicsIGNoYWxrLmJvbGQoc3RhY2tOYW1lKSkpO1xuICB9XG5cbiAgaWYgKCFxdWlldCAmJiBpc0ltcG9ydCkge1xuICAgIHN0cmVhbS53cml0ZSgnUGFyYW1ldGVycyBhbmQgcnVsZXMgY3JlYXRlZCBkdXJpbmcgbWlncmF0aW9uIGRvIG5vdCBhZmZlY3QgcmVzb3VyY2UgY29uZmlndXJhdGlvbi5cXG4nKTtcbiAgfVxuXG4gIC8vIGRldGVjdCBhbmQgZmlsdGVyIG91dCBtYW5nbGVkIGNoYXJhY3RlcnMgZnJvbSB0aGUgZGlmZlxuICBsZXQgZmlsdGVyZWRDaGFuZ2VzQ291bnQgPSAwO1xuICBpZiAoZGlmZi5kaWZmZXJlbmNlQ291bnQgJiYgIXN0cmljdCkge1xuICAgIGNvbnN0IG1hbmdsZWROZXdUZW1wbGF0ZSA9IEpTT04ucGFyc2UobWFuZ2xlTGlrZUNsb3VkRm9ybWF0aW9uKEpTT04uc3RyaW5naWZ5KG5ld1RlbXBsYXRlLnRlbXBsYXRlKSkpO1xuICAgIGNvbnN0IG1hbmdsZWREaWZmID0gZnVsbERpZmYob2xkVGVtcGxhdGUsIG1hbmdsZWROZXdUZW1wbGF0ZSwgY2hhbmdlU2V0KTtcbiAgICBmaWx0ZXJlZENoYW5nZXNDb3VudCA9IE1hdGgubWF4KDAsIGRpZmYuZGlmZmVyZW5jZUNvdW50IC0gbWFuZ2xlZERpZmYuZGlmZmVyZW5jZUNvdW50KTtcbiAgICBpZiAoZmlsdGVyZWRDaGFuZ2VzQ291bnQgPiAwKSB7XG4gICAgICBkaWZmID0gbWFuZ2xlZERpZmY7XG4gICAgfVxuICB9XG5cbiAgLy8gZmlsdGVyIG91dCAnQVdTOjpDREs6Ok1ldGFkYXRhJyByZXNvdXJjZXMgZnJvbSB0aGUgdGVtcGxhdGVcbiAgLy8gZmlsdGVyIG91dCAnQ2hlY2tCb290c3RyYXBWZXJzaW9uJyBydWxlcyBmcm9tIHRoZSB0ZW1wbGF0ZVxuICBpZiAoIXN0cmljdCkge1xuICAgIG9ic2N1cmVEaWZmKGRpZmYpO1xuICB9XG5cbiAgbGV0IHN0YWNrRGlmZkNvdW50ID0gMDtcbiAgaWYgKCFkaWZmLmlzRW1wdHkpIHtcbiAgICBzdGFja0RpZmZDb3VudCsrO1xuICAgIGZvcm1hdERpZmZlcmVuY2VzKHN0cmVhbSwgZGlmZiwge1xuICAgICAgLi4ubG9naWNhbElkTWFwRnJvbVRlbXBsYXRlKG9sZFRlbXBsYXRlKSxcbiAgICAgIC4uLmJ1aWxkTG9naWNhbFRvUGF0aE1hcChuZXdUZW1wbGF0ZSksXG4gICAgfSwgY29udGV4dCk7XG4gIH0gZWxzZSBpZiAoIXF1aWV0KSB7XG4gICAgcHJpbnQoY2hhbGsuZ3JlZW4oJ1RoZXJlIHdlcmUgbm8gZGlmZmVyZW5jZXMnKSk7XG4gIH1cbiAgaWYgKGZpbHRlcmVkQ2hhbmdlc0NvdW50ID4gMCkge1xuICAgIHByaW50KGNoYWxrLnllbGxvdyhgT21pdHRlZCAke2ZpbHRlcmVkQ2hhbmdlc0NvdW50fSBjaGFuZ2VzIGJlY2F1c2UgdGhleSBhcmUgbGlrZWx5IG1hbmdsZWQgbm9uLUFTQ0lJIGNoYXJhY3RlcnMuIFVzZSAtLXN0cmljdCB0byBwcmludCB0aGVtLmApKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgbmVzdGVkU3RhY2tMb2dpY2FsSWQgb2YgT2JqZWN0LmtleXMobmVzdGVkU3RhY2tUZW1wbGF0ZXMgPz8ge30pKSB7XG4gICAgaWYgKCFuZXN0ZWRTdGFja1RlbXBsYXRlcykge1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGNvbnN0IG5lc3RlZFN0YWNrID0gbmVzdGVkU3RhY2tUZW1wbGF0ZXNbbmVzdGVkU3RhY2tMb2dpY2FsSWRdO1xuXG4gICAgKG5ld1RlbXBsYXRlIGFzIGFueSkuX3RlbXBsYXRlID0gbmVzdGVkU3RhY2suZ2VuZXJhdGVkVGVtcGxhdGU7XG4gICAgc3RhY2tEaWZmQ291bnQgKz0gcHJpbnRTdGFja0RpZmYoXG4gICAgICBuZXN0ZWRTdGFjay5kZXBsb3llZFRlbXBsYXRlLFxuICAgICAgbmV3VGVtcGxhdGUsXG4gICAgICBzdHJpY3QsXG4gICAgICBjb250ZXh0LFxuICAgICAgcXVpZXQsXG4gICAgICBuZXN0ZWRTdGFjay5waHlzaWNhbE5hbWUgPz8gbmVzdGVkU3RhY2tMb2dpY2FsSWQsXG4gICAgICB1bmRlZmluZWQsXG4gICAgICBpc0ltcG9ydCxcbiAgICAgIHN0cmVhbSxcbiAgICAgIG5lc3RlZFN0YWNrLm5lc3RlZFN0YWNrVGVtcGxhdGVzLFxuICAgICk7XG4gIH1cblxuICByZXR1cm4gc3RhY2tEaWZmQ291bnQ7XG59XG5cbmV4cG9ydCBlbnVtIFJlcXVpcmVBcHByb3ZhbCB7XG4gIE5ldmVyID0gJ25ldmVyJyxcblxuICBBbnlDaGFuZ2UgPSAnYW55LWNoYW5nZScsXG5cbiAgQnJvYWRlbmluZyA9ICdicm9hZGVuaW5nJyxcbn1cblxuLyoqXG4gKiBQcmludCB0aGUgc2VjdXJpdHkgY2hhbmdlcyBvZiB0aGlzIGRpZmYsIGlmIHRoZSBjaGFuZ2UgaXMgaW1wYWN0ZnVsIGVub3VnaCBhY2NvcmRpbmcgdG8gdGhlIGFwcHJvdmFsIGxldmVsXG4gKlxuICogUmV0dXJucyB0cnVlIGlmIHRoZSBjaGFuZ2VzIGFyZSBwcm9tcHQtd29ydGh5LCBmYWxzZSBvdGhlcndpc2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcmludFNlY3VyaXR5RGlmZihcbiAgb2xkVGVtcGxhdGU6IGFueSxcbiAgbmV3VGVtcGxhdGU6IGN4YXBpLkNsb3VkRm9ybWF0aW9uU3RhY2tBcnRpZmFjdCxcbiAgcmVxdWlyZUFwcHJvdmFsOiBSZXF1aXJlQXBwcm92YWwsXG4gIF9xdWlldD86IGJvb2xlYW4sXG4gIHN0YWNrTmFtZT86IHN0cmluZyxcbiAgY2hhbmdlU2V0PzogRGVzY3JpYmVDaGFuZ2VTZXRPdXRwdXQsXG4gIHN0cmVhbTogRm9ybWF0U3RyZWFtID0gcHJvY2Vzcy5zdGRlcnIsXG4pOiBib29sZWFuIHtcbiAgY29uc3QgZGlmZiA9IGZ1bGxEaWZmKG9sZFRlbXBsYXRlLCBuZXdUZW1wbGF0ZS50ZW1wbGF0ZSwgY2hhbmdlU2V0KTtcblxuICBpZiAoZGlmZlJlcXVpcmVzQXBwcm92YWwoZGlmZiwgcmVxdWlyZUFwcHJvdmFsKSkge1xuICAgIHN0cmVhbS53cml0ZShmb3JtYXQoJ1N0YWNrICVzXFxuJywgY2hhbGsuYm9sZChzdGFja05hbWUpKSk7XG5cbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbWF4LWxlblxuICAgIHdhcm5pbmcoYFRoaXMgZGVwbG95bWVudCB3aWxsIG1ha2UgcG90ZW50aWFsbHkgc2Vuc2l0aXZlIGNoYW5nZXMgYWNjb3JkaW5nIHRvIHlvdXIgY3VycmVudCBzZWN1cml0eSBhcHByb3ZhbCBsZXZlbCAoLS1yZXF1aXJlLWFwcHJvdmFsICR7cmVxdWlyZUFwcHJvdmFsfSkuYCk7XG4gICAgd2FybmluZygnUGxlYXNlIGNvbmZpcm0geW91IGludGVuZCB0byBtYWtlIHRoZSBmb2xsb3dpbmcgbW9kaWZpY2F0aW9uczpcXG4nKTtcblxuICAgIGZvcm1hdFNlY3VyaXR5Q2hhbmdlcyhwcm9jZXNzLnN0ZG91dCwgZGlmZiwgYnVpbGRMb2dpY2FsVG9QYXRoTWFwKG5ld1RlbXBsYXRlKSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKipcbiAqIFJldHVybiB3aGV0aGVyIHRoZSBkaWZmIGhhcyBzZWN1cml0eS1pbXBhY3RpbmcgY2hhbmdlcyB0aGF0IG5lZWQgY29uZmlybWF0aW9uXG4gKlxuICogVE9ETzogRmlsdGVyIHRoZSBzZWN1cml0eSBpbXBhY3QgZGV0ZXJtaW5hdGlvbiBiYXNlZCBvZmYgb2YgYW4gZW51bSB0aGF0IGFsbG93c1xuICogdXMgdG8gcGljayBtaW5pbXVtIFwic2V2ZXJpdGllc1wiIHRvIGFsZXJ0IG9uLlxuICovXG5mdW5jdGlvbiBkaWZmUmVxdWlyZXNBcHByb3ZhbChkaWZmOiBUZW1wbGF0ZURpZmYsIHJlcXVpcmVBcHByb3ZhbDogUmVxdWlyZUFwcHJvdmFsKSB7XG4gIHN3aXRjaCAocmVxdWlyZUFwcHJvdmFsKSB7XG4gICAgY2FzZSBSZXF1aXJlQXBwcm92YWwuTmV2ZXI6IHJldHVybiBmYWxzZTtcbiAgICBjYXNlIFJlcXVpcmVBcHByb3ZhbC5BbnlDaGFuZ2U6IHJldHVybiBkaWZmLnBlcm1pc3Npb25zQW55Q2hhbmdlcztcbiAgICBjYXNlIFJlcXVpcmVBcHByb3ZhbC5Ccm9hZGVuaW5nOiByZXR1cm4gZGlmZi5wZXJtaXNzaW9uc0Jyb2FkZW5lZDtcbiAgICBkZWZhdWx0OiB0aHJvdyBuZXcgRXJyb3IoYFVucmVjb2duaXplZCBhcHByb3ZhbCBsZXZlbDogJHtyZXF1aXJlQXBwcm92YWx9YCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYnVpbGRMb2dpY2FsVG9QYXRoTWFwKHN0YWNrOiBjeGFwaS5DbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QpIHtcbiAgY29uc3QgbWFwOiB7IFtpZDogc3RyaW5nXTogc3RyaW5nIH0gPSB7fTtcbiAgZm9yIChjb25zdCBtZCBvZiBzdGFjay5maW5kTWV0YWRhdGFCeVR5cGUoY3hzY2hlbWEuQXJ0aWZhY3RNZXRhZGF0YUVudHJ5VHlwZS5MT0dJQ0FMX0lEKSkge1xuICAgIG1hcFttZC5kYXRhIGFzIHN0cmluZ10gPSBtZC5wYXRoO1xuICB9XG4gIHJldHVybiBtYXA7XG59XG5cbmZ1bmN0aW9uIGxvZ2ljYWxJZE1hcEZyb21UZW1wbGF0ZSh0ZW1wbGF0ZTogYW55KSB7XG4gIGNvbnN0IHJldDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuXG4gIGZvciAoY29uc3QgW2xvZ2ljYWxJZCwgcmVzb3VyY2VdIG9mIE9iamVjdC5lbnRyaWVzKHRlbXBsYXRlLlJlc291cmNlcyA/PyB7fSkpIHtcbiAgICBjb25zdCBwYXRoID0gKHJlc291cmNlIGFzIGFueSk/Lk1ldGFkYXRhPy5bJ2F3czpjZGs6cGF0aCddO1xuICAgIGlmIChwYXRoKSB7XG4gICAgICByZXRbbG9naWNhbElkXSA9IHBhdGg7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXQ7XG59XG5cbi8qKlxuICogUmVtb3ZlIGFueSB0ZW1wbGF0ZSBlbGVtZW50cyB0aGF0IHdlIGRvbid0IHdhbnQgdG8gc2hvdyB1c2Vycy5cbiAqIFRoaXMgaXMgY3VycmVudGx5OlxuICogLSBBV1M6OkNESzo6TWV0YWRhdGEgcmVzb3VyY2VcbiAqIC0gQ2hlY2tCb290c3RyYXBWZXJzaW9uIFJ1bGVcbiAqL1xuZnVuY3Rpb24gb2JzY3VyZURpZmYoZGlmZjogVGVtcGxhdGVEaWZmKSB7XG4gIGlmIChkaWZmLnVua25vd24pIHtcbiAgICAvLyBzZWUgaHR0cHM6Ly9naXRodWIuY29tL2F3cy9hd3MtY2RrL2lzc3Vlcy8xNzk0MlxuICAgIGRpZmYudW5rbm93biA9IGRpZmYudW5rbm93bi5maWx0ZXIoY2hhbmdlID0+IHtcbiAgICAgIGlmICghY2hhbmdlKSB7IHJldHVybiB0cnVlOyB9XG4gICAgICBpZiAoY2hhbmdlLm5ld1ZhbHVlPy5DaGVja0Jvb3RzdHJhcFZlcnNpb24pIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgICBpZiAoY2hhbmdlLm9sZFZhbHVlPy5DaGVja0Jvb3RzdHJhcFZlcnNpb24pIHsgcmV0dXJuIGZhbHNlOyB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9KTtcbiAgfVxuXG4gIGlmIChkaWZmLnJlc291cmNlcykge1xuICAgIGRpZmYucmVzb3VyY2VzID0gZGlmZi5yZXNvdXJjZXMuZmlsdGVyKGNoYW5nZSA9PiB7XG4gICAgICBpZiAoIWNoYW5nZSkgeyByZXR1cm4gdHJ1ZTsgfVxuICAgICAgaWYgKGNoYW5nZS5uZXdSZXNvdXJjZVR5cGUgPT09ICdBV1M6OkNESzo6TWV0YWRhdGEnKSB7IHJldHVybiBmYWxzZTsgfVxuICAgICAgaWYgKGNoYW5nZS5vbGRSZXNvdXJjZVR5cGUgPT09ICdBV1M6OkNESzo6TWV0YWRhdGEnKSB7IHJldHVybiBmYWxzZTsgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==