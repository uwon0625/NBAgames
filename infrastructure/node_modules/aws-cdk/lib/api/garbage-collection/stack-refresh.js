"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackgroundStackRefresh = exports.ActiveAssetCache = void 0;
exports.refreshStacks = refreshStacks;
const logging_1 = require("../../logging");
class ActiveAssetCache {
    constructor() {
        this.stacks = new Set();
    }
    rememberStack(stackTemplate) {
        this.stacks.add(stackTemplate);
    }
    contains(asset) {
        for (const stack of this.stacks) {
            if (stack.includes(asset)) {
                return true;
            }
        }
        return false;
    }
}
exports.ActiveAssetCache = ActiveAssetCache;
async function paginateSdkCall(cb) {
    let finished = false;
    let nextToken;
    while (!finished) {
        nextToken = await cb(nextToken);
        if (nextToken === undefined) {
            finished = true;
        }
    }
}
/**
 * Fetches all relevant stack templates from CloudFormation. It ignores the following stacks:
 * - stacks in DELETE_COMPLETE or DELETE_IN_PROGRESS stage
 * - stacks that are using a different bootstrap qualifier
 */
async function fetchAllStackTemplates(cfn, qualifier) {
    const stackNames = [];
    await paginateSdkCall(async (nextToken) => {
        const stacks = await cfn.listStacks({ NextToken: nextToken });
        // We ignore stacks with these statuses because their assets are no longer live
        const ignoredStatues = ['CREATE_FAILED', 'DELETE_COMPLETE', 'DELETE_IN_PROGRESS', 'DELETE_FAILED', 'REVIEW_IN_PROGRESS'];
        stackNames.push(...(stacks.StackSummaries ?? [])
            .filter((s) => !ignoredStatues.includes(s.StackStatus))
            .map((s) => s.StackId ?? s.StackName));
        return stacks.NextToken;
    });
    (0, logging_1.debug)(`Parsing through ${stackNames.length} stacks`);
    const templates = [];
    for (const stack of stackNames) {
        let summary;
        summary = await cfn.getTemplateSummary({
            StackName: stack,
        });
        if (bootstrapFilter(summary.Parameters, qualifier)) {
            // This stack is definitely bootstrapped to a different qualifier so we can safely ignore it
            continue;
        }
        else {
            const template = await cfn.getTemplate({
                StackName: stack,
            });
            templates.push((template.TemplateBody ?? '') + JSON.stringify(summary?.Parameters));
        }
    }
    (0, logging_1.debug)('Done parsing through stacks');
    return templates;
}
/**
 * Filter out stacks that we KNOW are using a different bootstrap qualifier
 * This is mostly necessary for the integration tests that can run the same app (with the same assets)
 * under different qualifiers.
 * This is necessary because a stack under a different bootstrap could coincidentally reference the same hash
 * and cause a false negative (cause an asset to be preserved when its isolated)
 * This is intentionally done in a way where we ONLY filter out stacks that are meant for a different qualifier
 * because we are okay with false positives.
 */
function bootstrapFilter(parameters, qualifier) {
    const bootstrapVersion = parameters?.find((p) => p.ParameterKey === 'BootstrapVersion');
    const splitBootstrapVersion = bootstrapVersion?.DefaultValue?.split('/');
    // We find the qualifier in a specific part of the bootstrap version parameter
    return (qualifier &&
        splitBootstrapVersion &&
        splitBootstrapVersion.length == 4 &&
        splitBootstrapVersion[2] != qualifier);
}
async function refreshStacks(cfn, activeAssets, qualifier) {
    try {
        const stacks = await fetchAllStackTemplates(cfn, qualifier);
        for (const stack of stacks) {
            activeAssets.rememberStack(stack);
        }
    }
    catch (err) {
        throw new Error(`Error refreshing stacks: ${err}`);
    }
}
/**
 * Class that controls scheduling of the background stack refresh
 */
class BackgroundStackRefresh {
    constructor(props) {
        this.props = props;
        this.queuedPromises = [];
        this.lastRefreshTime = Date.now();
    }
    start() {
        // Since start is going to be called right after the first invocation of refreshStacks,
        // lets wait some time before beginning the background refresh.
        this.timeout = setTimeout(() => this.refresh(), 300000); // 5 minutes
    }
    async refresh() {
        const startTime = Date.now();
        await refreshStacks(this.props.cfn, this.props.activeAssets, this.props.qualifier);
        this.justRefreshedStacks();
        // If the last invocation of refreshStacks takes <5 minutes, the next invocation starts 5 minutes after the last one started.
        // If the last invocation of refreshStacks takes >5 minutes, the next invocation starts immediately.
        this.timeout = setTimeout(() => this.refresh(), Math.max(startTime + 300000 - Date.now(), 0));
    }
    justRefreshedStacks() {
        this.lastRefreshTime = Date.now();
        for (const p of this.queuedPromises.splice(0, this.queuedPromises.length)) {
            p(undefined);
        }
    }
    /**
     * Checks if the last successful background refresh happened within the specified time frame.
     * If the last refresh is older than the specified time frame, it returns a Promise that resolves
     * when the next background refresh completes or rejects if the refresh takes too long.
     */
    noOlderThan(ms) {
        const horizon = Date.now() - ms;
        // The last refresh happened within the time frame
        if (this.lastRefreshTime >= horizon) {
            return Promise.resolve();
        }
        // The last refresh happened earlier than the time frame
        // We will wait for the latest refresh to land or reject if it takes too long
        return Promise.race([
            new Promise(resolve => this.queuedPromises.push(resolve)),
            new Promise((_, reject) => setTimeout(() => reject(new Error('refreshStacks took too long; the background thread likely threw an error')), ms)),
        ]);
    }
    stop() {
        clearTimeout(this.timeout);
    }
}
exports.BackgroundStackRefresh = BackgroundStackRefresh;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhY2stcmVmcmVzaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInN0YWNrLXJlZnJlc2gudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBa0dBLHNDQVNDO0FBMUdELDJDQUFzQztBQUd0QyxNQUFhLGdCQUFnQjtJQUE3QjtRQUNtQixXQUFNLEdBQWdCLElBQUksR0FBRyxFQUFFLENBQUM7SUFjbkQsQ0FBQztJQVpRLGFBQWEsQ0FBQyxhQUFxQjtRQUN4QyxJQUFJLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRU0sUUFBUSxDQUFDLEtBQWE7UUFDM0IsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDaEMsSUFBSSxLQUFLLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQzFCLE9BQU8sSUFBSSxDQUFDO1lBQ2QsQ0FBQztRQUNILENBQUM7UUFDRCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7Q0FDRjtBQWZELDRDQWVDO0FBRUQsS0FBSyxVQUFVLGVBQWUsQ0FBQyxFQUF1RDtJQUNwRixJQUFJLFFBQVEsR0FBRyxLQUFLLENBQUM7SUFDckIsSUFBSSxTQUE2QixDQUFDO0lBQ2xDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUNqQixTQUFTLEdBQUcsTUFBTSxFQUFFLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDaEMsSUFBSSxTQUFTLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDNUIsUUFBUSxHQUFHLElBQUksQ0FBQztRQUNsQixDQUFDO0lBQ0gsQ0FBQztBQUNILENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsS0FBSyxVQUFVLHNCQUFzQixDQUFDLEdBQTBCLEVBQUUsU0FBa0I7SUFDbEYsTUFBTSxVQUFVLEdBQWEsRUFBRSxDQUFDO0lBQ2hDLE1BQU0sZUFBZSxDQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsRUFBRTtRQUN4QyxNQUFN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U0FBUyxDQUFDLENBQUM7UUFDZixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxXQUFXLENBQUMsRUFBVTtRQUMzQixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDO1FBRWhDLGtEQUFrRDtRQUNsRCxJQUFJLElBQUksQ0FBQyxlQUFlLElBQUksT0FBTyxFQUFFLENBQUM7WUFDcEMsT0FBTyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDM0IsQ0FBQztRQUVELHdEQUF3RDtRQUN4RCw2RUFBNkU7UUFDN0UsT0FBTyxPQUFPLENBQUMsSUFBSSxDQUFDO1lBQ2xCLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDekQsSUFBSSxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsTUFBTSxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksS0FBSyxDQUFDLDBFQUEwRSxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztTQUNoSixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRU0sSUFBSTtRQUNULFlBQVksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDN0IsQ0FBQztDQUNGO0FBekRELHdEQXlEQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFBhcmFtZXRlckRlY2xhcmF0aW9uIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3VkZm9ybWF0aW9uJztcbmltcG9ydCB7IGRlYnVnIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBJQ2xvdWRGb3JtYXRpb25DbGllbnQgfSBmcm9tICcuLi9hd3MtYXV0aCc7XG5cbmV4cG9ydCBjbGFzcyBBY3RpdmVBc3NldENhY2hlIHtcbiAgcHJpdmF0ZSByZWFkb25seSBzdGFja3M6IFNldDxzdHJpbmc+ID0gbmV3IFNldCgpO1xuXG4gIHB1YmxpYyByZW1lbWJlclN0YWNrKHN0YWNrVGVtcGxhdGU6IHN0cmluZykge1xuICAgIHRoaXMuc3RhY2tzLmFkZChzdGFja1RlbXBsYXRlKTtcbiAgfVxuXG4gIHB1YmxpYyBjb250YWlucyhhc3NldDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgZm9yIChjb25zdCBzdGFjayBvZiB0aGlzLnN0YWNrcykge1xuICAgICAgaWYgKHN0YWNrLmluY2x1ZGVzKGFzc2V0KSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHBhZ2luYXRlU2RrQ2FsbChjYjogKG5leHRUb2tlbj86IHN0cmluZykgPT4gUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+KSB7XG4gIGxldCBmaW5pc2hlZCA9IGZhbHNlO1xuICBsZXQgbmV4dFRva2VuOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIHdoaWxlICghZmluaXNoZWQpIHtcbiAgICBuZXh0VG9rZW4gPSBhd2FpdCBjYihuZXh0VG9rZW4pO1xuICAgIGlmIChuZXh0VG9rZW4gPT09IHVuZGVmaW5lZCkge1xuICAgICAgZmluaXNoZWQgPSB0cnVlO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIEZldGNoZXMgYWxsIHJlbGV2YW50IHN0YWNrIHRlbXBsYXRlcyBmcm9tIENsb3VkRm9ybWF0aW9uLiBJdCBpZ25vcmVzIHRoZSBmb2xsb3dpbmcgc3RhY2tzOlxuICogLSBzdGFja3MgaW4gREVMRVRFX0NPTVBMRVRFIG9yIERFTEVURV9JTl9QUk9HUkVTUyBzdGFnZVxuICogLSBzdGFja3MgdGhhdCBhcmUgdXNpbmcgYSBkaWZmZXJlbnQgYm9vdHN0cmFwIHF1YWxpZmllclxuICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaEFsbFN0YWNrVGVtcGxhdGVzKGNmbjogSUNsb3VkRm9ybWF0aW9uQ2xpZW50LCBxdWFsaWZpZXI/OiBzdHJpbmcpIHtcbiAgY29uc3Qgc3RhY2tOYW1lczogc3RyaW5nW10gPSBbXTtcbiAgYXdhaXQgcGFnaW5hdGVTZGtDYWxsKGFzeW5jIChuZXh0VG9rZW4pID0+IHtcbiAgICBjb25zdCBzdGFja3MgPSBhd2FpdCBjZm4ubGlzdFN0YWNrcyh7IE5leHRUb2tlbjogbmV4dFRva2VuIH0pO1xuXG4gICAgLy8gV2UgaWdub3JlIHN0YWNrcyB3aXRoIHRoZXNlIHN0YXR1c2VzIGJlY2F1c2UgdGhlaXIgYXNzZXRzIGFyZSBubyBsb25nZXIgbGl2ZVxuICAgIGNvbnN0IGlnbm9yZWRTdGF0dWVzID0gWydDUkVBVEVfRkFJTEVEJywgJ0RFTEVURV9DT01QTEVURScsICdERUxFVEVfSU5fUFJPR1JFU1MnLCAnREVMRVRFX0ZBSUxFRCcsICdSRVZJRVdfSU5fUFJPR1JFU1MnXTtcbiAgICBzdGFja05hbWVzLnB1c2goXG4gICAgICAuLi4oc3RhY2tzLlN0YWNrU3VtbWFyaWVzID8/IFtdKVxuICAgICAgICAuZmlsdGVyKChzOiBhbnkpID0+ICFpZ25vcmVkU3RhdHVlcy5pbmNsdWRlcyhzLlN0YWNrU3RhdHVzKSlcbiAgICAgICAgLm1hcCgoczogYW55KSA9PiBzLlN0YWNrSWQgPz8gcy5TdGFja05hbWUpLFxuICAgICk7XG5cbiAgICByZXR1cm4gc3RhY2tzLk5leHRUb2tlbjtcbiAgfSk7XG5cbiAgZGVidWcoYFBhcnNpbmcgdGhyb3VnaCAke3N0YWNrTmFtZXMubGVuZ3RofSBzdGFja3NgKTtcblxuICBjb25zdCB0ZW1wbGF0ZXM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3Qgc3RhY2sgb2Ygc3RhY2tOYW1lcykge1xuICAgIGxldCBzdW1tYXJ5O1xuICAgIHN1bW1hcnkgPSBhd2FpdCBjZm4uZ2V0VGVtcGxhdGVTdW1tYXJ5KHtcbiAgICAgIFN0YWNrTmFtZTogc3RhY2ssXG4gICAgfSk7XG5cbiAgICBpZiAoYm9vdHN0cmFwRmlsdGVyKHN1bW1hcnkuUGFyYW1ldGVycywgcXVhbGlmaWVyKSkge1xuICAgICAgLy8gVGhpcyBzdGFjayBpcyBkZWZpbml0ZWx5IGJvb3RzdHJhcHBlZCB0byBhIGRpZmZlcmVudCBxdWFsaWZpZXIgc28gd2UgY2FuIHNhZmVseSBpZ25vcmUgaXRcbiAgICAgIGNvbnRpbnVlO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IGF3YWl0IGNmbi5nZXRUZW1wbGF0ZSh7XG4gICAgICAgIFN0YWNrTmFtZTogc3RhY2ssXG4gICAgICB9KTtcblxuICAgICAgdGVtcGxhdGVzLnB1c2goKHRlbXBsYXRlLlRlbXBsYXRlQm9keSA/PyAnJykgKyBKU09OLnN0cmluZ2lmeShzdW1tYXJ5Py5QYXJhbWV0ZXJzKSk7XG4gICAgfVxuICB9XG5cbiAgZGVidWcoJ0RvbmUgcGFyc2luZyB0aHJvdWdoIHN0YWNrcycpO1xuXG4gIHJldHVybiB0ZW1wbGF0ZXM7XG59XG5cbi8qKlxuICogRmlsdGVyIG91dCBzdGFja3MgdGhhdCB3ZSBLTk9XIGFyZSB1c2luZyBhIGRpZmZlcmVudCBib290c3RyYXAgcXVhbGlmaWVyXG4gKiBUaGlzIGlzIG1vc3RseSBuZWNlc3NhcnkgZm9yIHRoZSBpbnRlZ3JhdGlvbiB0ZXN0cyB0aGF0IGNhbiBydW4gdGhlIHNhbWUgYXBwICh3aXRoIHRoZSBzYW1lIGFzc2V0cylcbiAqIHVuZGVyIGRpZmZlcmVudCBxdWFsaWZpZXJzLlxuICogVGhpcyBpcyBuZWNlc3NhcnkgYmVjYXVzZSBhIHN0YWNrIHVuZGVyIGEgZGlmZmVyZW50IGJvb3RzdHJhcCBjb3VsZCBjb2luY2lkZW50YWxseSByZWZlcmVuY2UgdGhlIHNhbWUgaGFzaFxuICogYW5kIGNhdXNlIGEgZmFsc2UgbmVnYXRpdmUgKGNhdXNlIGFuIGFzc2V0IHRvIGJlIHByZXNlcnZlZCB3aGVuIGl0cyBpc29sYXRlZClcbiAqIFRoaXMgaXMgaW50ZW50aW9uYWxseSBkb25lIGluIGEgd2F5IHdoZXJlIHdlIE9OTFkgZmlsdGVyIG91dCBzdGFja3MgdGhhdCBhcmUgbWVhbnQgZm9yIGEgZGlmZmVyZW50IHF1YWxpZmllclxuICogYmVjYXVzZSB3ZSBhcmUgb2theSB3aXRoIGZhbHNlIHBvc2l0aXZlcy5cbiAqL1xuZnVuY3Rpb24gYm9vdHN0cmFwRmlsdGVyKHBhcmFtZXRlcnM/OiBQYXJhbWV0ZXJEZWNsYXJhdGlvbltdLCBxdWFsaWZpZXI/OiBzdHJpbmcpIHtcbiAgY29uc3QgYm9vdHN0cmFwVmVyc2lvbiA9IHBhcmFtZXRlcnM/LmZpbmQoKHApID0+IHAuUGFyYW1ldGVyS2V5ID09PSAnQm9vdHN0cmFwVmVyc2lvbicpO1xuICBjb25zdCBzcGxpdEJvb3RzdHJhcFZlcnNpb24gPSBib290c3RyYXBWZXJzaW9uPy5EZWZhdWx0VmFsdWU/LnNwbGl0KCcvJyk7XG4gIC8vIFdlIGZpbmQgdGhlIHF1YWxpZmllciBpbiBhIHNwZWNpZmljIHBhcnQgb2YgdGhlIGJvb3RzdHJhcCB2ZXJzaW9uIHBhcmFtZXRlclxuICByZXR1cm4gKHF1YWxpZmllciAmJlxuICAgICAgICAgIHNwbGl0Qm9vdHN0cmFwVmVyc2lvbiAmJlxuICAgICAgICAgIHNwbGl0Qm9vdHN0cmFwVmVyc2lvbi5sZW5ndGggPT0gNCAmJlxuICAgICAgICAgIHNwbGl0Qm9vdHN0cmFwVmVyc2lvblsyXSAhPSBxdWFsaWZpZXIpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFN0YWNrcyhjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudCwgYWN0aXZlQXNzZXRzOiBBY3RpdmVBc3NldENhY2hlLCBxdWFsaWZpZXI/OiBzdHJpbmcpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdGFja3MgPSBhd2FpdCBmZXRjaEFsbFN0YWNrVGVtcGxhdGVzKGNmbiwgcXVhbGlmaWVyKTtcbiAgICBmb3IgKGNvbnN0IHN0YWNrIG9mIHN0YWNrcykge1xuICAgICAgYWN0aXZlQXNzZXRzLnJlbWVtYmVyU3RhY2soc3RhY2spO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFcnJvciByZWZyZXNoaW5nIHN0YWNrczogJHtlcnJ9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBCYWNrZ3JvdW5kIFN0YWNrIFJlZnJlc2ggcHJvcGVydGllc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIEJhY2tncm91bmRTdGFja1JlZnJlc2hQcm9wcyB7XG4gIC8qKlxuICAgKiBUaGUgQ0ZOIFNESyBoYW5kbGVyXG4gICAqL1xuICByZWFkb25seSBjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudDtcblxuICAvKipcbiAgICogQWN0aXZlIEFzc2V0IHN0b3JhZ2VcbiAgICovXG4gIHJlYWRvbmx5IGFjdGl2ZUFzc2V0czogQWN0aXZlQXNzZXRDYWNoZTtcblxuICAvKipcbiAgICogU3RhY2sgYm9vdHN0cmFwIHF1YWxpZmllclxuICAgKi9cbiAgcmVhZG9ubHkgcXVhbGlmaWVyPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIENsYXNzIHRoYXQgY29udHJvbHMgc2NoZWR1bGluZyBvZiB0aGUgYmFja2dyb3VuZCBzdGFjayByZWZyZXNoXG4gKi9cbmV4cG9ydCBjbGFzcyBCYWNrZ3JvdW5kU3RhY2tSZWZyZXNoIHtcbiAgcHJpdmF0ZSB0aW1lb3V0PzogTm9kZUpTLlRpbWVvdXQ7XG4gIHByaXZhdGUgbGFzdFJlZnJlc2hUaW1lOiBudW1iZXI7XG4gIHByaXZhdGUgcXVldWVkUHJvbWlzZXM6IEFycmF5PCh2YWx1ZTogdW5rbm93bikgPT4gdm9pZD4gPSBbXTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHByb3BzOiBCYWNrZ3JvdW5kU3RhY2tSZWZyZXNoUHJvcHMpIHtcbiAgICB0aGlzLmxhc3RSZWZyZXNoVGltZSA9IERhdGUubm93KCk7XG4gIH1cblxuICBwdWJsaWMgc3RhcnQoKSB7XG4gICAgLy8gU2luY2Ugc3RhcnQgaXMgZ29pbmcgdG8gYmUgY2FsbGVkIHJpZ2h0IGFmdGVyIHRoZSBmaXJzdCBpbnZvY2F0aW9uIG9mIHJlZnJlc2hTdGFja3MsXG4gICAgLy8gbGV0cyB3YWl0IHNvbWUgdGltZSBiZWZvcmUgYmVnaW5uaW5nIHRoZSBiYWNrZ3JvdW5kIHJlZnJlc2guXG4gICAgdGhpcy50aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLnJlZnJlc2goKSwgMzAwXzAwMCk7IC8vIDUgbWludXRlc1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWZyZXNoKCkge1xuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICBhd2FpdCByZWZyZXNoU3RhY2tzKHRoaXMucHJvcHMuY2ZuLCB0aGlzLnByb3BzLmFjdGl2ZUFzc2V0cywgdGhpcy5wcm9wcy5xdWFsaWZpZXIpO1xuICAgIHRoaXMuanVzdFJlZnJlc2hlZFN0YWNrcygpO1xuXG4gICAgLy8gSWYgdGhlIGxhc3QgaW52b2NhdGlvbiBvZiByZWZyZXNoU3RhY2tzIHRha2VzIDw1IG1pbnV0ZXMsIHRoZSBuZXh0IGludm9jYXRpb24gc3RhcnRzIDUgbWludXRlcyBhZnRlciB0aGUgbGFzdCBvbmUgc3RhcnRlZC5cbiAgICAvLyBJZiB0aGUgbGFzdCBpbnZvY2F0aW9uIG9mIHJlZnJlc2hTdGFja3MgdGFrZXMgPjUgbWludXRlcywgdGhlIG5leHQgaW52b2NhdGlvbiBzdGFydHMgaW1tZWRpYXRlbHkuXG4gICAgdGhpcy50aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB0aGlzLnJlZnJlc2goKSwgTWF0aC5tYXgoc3RhcnRUaW1lICsgMzAwXzAwMCAtIERhdGUubm93KCksIDApKTtcbiAgfVxuXG4gIHByaXZhdGUganVzdFJlZnJlc2hlZFN0YWNrcygpIHtcbiAgICB0aGlzLmxhc3RSZWZyZXNoVGltZSA9IERhdGUubm93KCk7XG4gICAgZm9yIChjb25zdCBwIG9mIHRoaXMucXVldWVkUHJvbWlzZXMuc3BsaWNlKDAsIHRoaXMucXVldWVkUHJvbWlzZXMubGVuZ3RoKSkge1xuICAgICAgcCh1bmRlZmluZWQpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgdGhlIGxhc3Qgc3VjY2Vzc2Z1bCBiYWNrZ3JvdW5kIHJlZnJlc2ggaGFwcGVuZWQgd2l0aGluIHRoZSBzcGVjaWZpZWQgdGltZSBmcmFtZS5cbiAgICogSWYgdGhlIGxhc3QgcmVmcmVzaCBpcyBvbGRlciB0aGFuIHRoZSBzcGVjaWZpZWQgdGltZSBmcmFtZSwgaXQgcmV0dXJucyBhIFByb21pc2UgdGhhdCByZXNvbHZlc1xuICAgKiB3aGVuIHRoZSBuZXh0IGJhY2tncm91bmQgcmVmcmVzaCBjb21wbGV0ZXMgb3IgcmVqZWN0cyBpZiB0aGUgcmVmcmVzaCB0YWtlcyB0b28gbG9uZy5cbiAgICovXG4gIHB1YmxpYyBub09sZGVyVGhhbihtczogbnVtYmVyKSB7XG4gICAgY29uc3QgaG9yaXpvbiA9IERhdGUubm93KCkgLSBtcztcblxuICAgIC8vIFRoZSBsYXN0IHJlZnJlc2ggaGFwcGVuZWQgd2l0aGluIHRoZSB0aW1lIGZyYW1lXG4gICAgaWYgKHRoaXMubGFzdFJlZnJlc2hUaW1lID49IGhvcml6b24pIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICAvLyBUaGUgbGFzdCByZWZyZXNoIGhhcHBlbmVkIGVhcmxpZXIgdGhhbiB0aGUgdGltZSBmcmFtZVxuICAgIC8vIFdlIHdpbGwgd2FpdCBmb3IgdGhlIGxhdGVzdCByZWZyZXNoIHRvIGxhbmQgb3IgcmVqZWN0IGlmIGl0IHRha2VzIHRvbyBsb25nXG4gICAgcmV0dXJuIFByb21pc2UucmFjZShbXG4gICAgICBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHRoaXMucXVldWVkUHJvbWlzZXMucHVzaChyZXNvbHZlKSksXG4gICAgICBuZXcgUHJvbWlzZSgoXywgcmVqZWN0KSA9PiBzZXRUaW1lb3V0KCgpID0+IHJlamVjdChuZXcgRXJyb3IoJ3JlZnJlc2hTdGFja3MgdG9vayB0b28gbG9uZzsgdGhlIGJhY2tncm91bmQgdGhyZWFkIGxpa2VseSB0aHJldyBhbiBlcnJvcicpKSwgbXMpKSxcbiAgICBdKTtcbiAgfVxuXG4gIHB1YmxpYyBzdG9wKCkge1xuICAgIGNsZWFyVGltZW91dCh0aGlzLnRpbWVvdXQpO1xuICB9XG59XG4iXX0=