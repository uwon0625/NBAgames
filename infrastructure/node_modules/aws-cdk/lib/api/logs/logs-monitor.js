"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudWatchLogEventMonitor = void 0;
const util = require("util");
const chalk = require("chalk");
const logging_1 = require("../../logging");
const arrays_1 = require("../../util/arrays");
/**
 * After reading events from all CloudWatch log groups
 * how long should we wait to read more events.
 *
 * If there is some error with reading events (i.e. Throttle)
 * then this is also how long we wait until we try again
 */
const SLEEP = 2000;
class CloudWatchLogEventMonitor {
    constructor(startTime) {
        /**
         * Map of environment (account:region) to LogGroupsAccessSettings
         */
        this.envsLogGroupsAccessSettings = new Map();
        this.active = false;
        this.startTime = startTime?.getTime() ?? Date.now();
    }
    /**
     * resume reading/printing events
     */
    activate() {
        this.active = true;
        this.scheduleNextTick(0);
    }
    /**
     * deactivates the monitor so no new events are read
     * use case for this is when we are in the middle of performing a deployment
     * and don't want to interweave all the logs together with the CFN
     * deployment logs
     *
     * Also resets the start time to be when the new deployment was triggered
     * and clears the list of tracked log groups
     */
    deactivate() {
        this.active = false;
        this.startTime = Date.now();
        this.envsLogGroupsAccessSettings.clear();
    }
    /**
     * Adds CloudWatch log groups to read log events from.
     * Since we could be watching multiple stacks that deploy to
     * multiple environments (account+region), we need to store a list of log groups
     * per env along with the SDK object that has access to read from
     * that environment.
     */
    addLogGroups(env, sdk, logGroupNames) {
        const awsEnv = `${env.account}:${env.region}`;
        const logGroupsStartTimes = logGroupNames.reduce((acc, groupName) => {
            acc[groupName] = this.startTime;
            return acc;
        }, {});
        this.envsLogGroupsAccessSettings.set(awsEnv, {
            sdk,
            logGroupsStartTimes: {
                ...this.envsLogGroupsAccessSettings.get(awsEnv)?.logGroupsStartTimes,
                ...logGroupsStartTimes,
            },
        });
    }
    scheduleNextTick(sleep) {
        setTimeout(() => void this.tick(), sleep);
    }
    async tick() {
        // excluding from codecoverage because this
        // doesn't always run (depends on timing)
        /* istanbul ignore next */
        if (!this.active) {
            return;
        }
        try {
            const events = (0, arrays_1.flatten)(await this.readNewEvents());
            events.forEach((event) => {
                this.print(event);
            });
        }
        catch (e) {
            (0, logging_1.error)('Error occurred while monitoring logs: %s', e);
        }
        this.scheduleNextTick(SLEEP);
    }
    /**
     * Reads all new log events from a set of CloudWatch Log Groups
     * in parallel
     */
    async readNewEvents() {
        const promises = [];
        for (const settings of this.envsLogGroupsAccessSettings.values()) {
            for (const group of Object.keys(settings.logGroupsStartTimes)) {
                promises.push(this.readEventsFromLogGroup(settings, group));
            }
        }
        // Limited set of log groups
        // eslint-disable-next-line @cdklabs/promiseall-no-unbounded-parallelism
        return Promise.all(promises);
    }
    /**
     * Print out a cloudwatch event
     */
    print(event) {
        (0, logging_1.print)(util.format('[%s] %s %s', chalk.blue(event.logGroupName), chalk.yellow(event.timestamp.toLocaleTimeString()), event.message.trim()));
    }
    /**
     * Reads all new log events from a CloudWatch Log Group
     * starting at either the time the hotswap was triggered or
     * when the last event was read on the previous tick
     */
    async readEventsFromLogGroup(logGroupsAccessSettings, logGroupName) {
        const events = [];
        // log events from some service are ingested faster than others
        // so we need to track the start/end time for each log group individually
        // to make sure that we process all events from each log group
        const startTime = logGroupsAccessSettings.logGroupsStartTimes[logGroupName] ?? this.startTime;
        let endTime = startTime;
        try {
            const response = await logGroupsAccessSettings.sdk.cloudWatchLogs().filterLogEvents({
                logGroupName: logGroupName,
                limit: 100,
                startTime: startTime,
            });
            const filteredEvents = response.events ?? [];
            for (const event of filteredEvents) {
                if (event.message) {
                    events.push({
                        message: event.message,
                        logGroupName,
                        timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
                    });
                    if (event.timestamp && endTime < event.timestamp) {
                        endTime = event.timestamp;
                    }
                }
            }
            // As long as there are _any_ events in the log group `filterLogEvents` will return a nextToken.
            // This is true even if these events are before `startTime`. So if we have 100 events and a nextToken
            // then assume that we have hit the limit and let the user know some messages have been supressed.
            // We are essentially showing them a sampling (10000 events printed out is not very useful)
            if (filteredEvents.length === 100 && response.nextToken) {
                events.push({
                    message: '>>> `watch` shows only the first 100 log messages - the rest have been truncated...',
                    logGroupName,
                    timestamp: new Date(endTime),
                });
            }
        }
        catch (e) {
            // with Lambda functions the CloudWatch is not created
            // until something is logged, so just keep polling until
            // there is somthing to find
            if (e.name === 'ResourceNotFoundException') {
                return [];
            }
            throw e;
        }
        logGroupsAccessSettings.logGroupsStartTimes[logGroupName] = endTime + 1;
        return events;
    }
}
exports.CloudWatchLogEventMonitor = CloudWatchLogEventMonitor;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9ncy1tb25pdG9yLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibG9ncy1tb25pdG9yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZCQUE2QjtBQUU3QiwrQkFBK0I7QUFDL0IsMkNBQTZDO0FBQzdDLDhDQUE0QztBQUc1Qzs7Ozs7O0dBTUc7QUFDSCxNQUFNLEtBQUssR0FBRyxJQUFLLENBQUM7QUEwQ3BCLE1BQWEseUJBQXlCO0lBYXBDLFlBQVksU0FBZ0I7UUFQNUI7O1dBRUc7UUFDYyxnQ0FBMkIsR0FBRyxJQUFJLEdBQUcsRUFBbUMsQ0FBQztRQUVsRixXQUFNLEdBQUcsS0FBSyxDQUFDO1FBR3JCLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxFQUFFLE9BQU8sRUFBRSxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUN0RCxDQUFDO0lBRUQ7O09BRUc7SUFDSSxRQUFRO1FBQ2IsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUM7UUFDbkIsSUFBSSxDQUFDLGdCQUFnQixDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQzNCLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNJLFVBQVU7UUFDZixJQUFJLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQztRQUNwQixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUM1QixJQUFJLENBQUMsMkJBQTJCLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDM0MsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNJLFlBQVksQ0FBQyxHQUFzQixFQUFFLEdBQVEsRUFBRSxhQUF1QjtRQUMzRSxNQUFNLE1BQU0sR0FBRyxHQUFHLEdBQUcsQ0FBQyxPQUFPLElBQUksR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQzlDLE1BQU0sbUJBQW1CLEdBQUcsYUFBYSxDQUFDLE1BQU0sQ0FDOUMsQ0FBQyxHQUFHLEVBQUUsU0FBUyxFQUFFLEVBQUU7WUFDakIsR0FBRyxDQUFD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LENBQUMsSUFBSSxLQUFLLDJCQUEyQixFQUFFLENBQUM7Z0JBQzNDLE9BQU8sRUFBRSxDQUFDO1lBQ1osQ0FBQztZQUNELE1BQU0sQ0FBQyxDQUFDO1FBQ1YsQ0FBQztRQUNELHVCQUF1QixDQUFDLG1CQUFtQixDQUFDLFlBQVksQ0FBQyxHQUFHLE9BQU8sR0FBRyxDQUFDLENBQUM7UUFDeEUsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztDQUNGO0FBbExELDhEQWtMQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHV0aWwgZnJvbSAndXRpbCc7XG5pbXBvcnQgKiBhcyBjeGFwaSBmcm9tICdAYXdzLWNkay9jeC1hcGknO1xuaW1wb3J0ICogYXMgY2hhbGsgZnJvbSAnY2hhbGsnO1xuaW1wb3J0IHsgcHJpbnQsIGVycm9yIH0gZnJvbSAnLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgeyBmbGF0dGVuIH0gZnJvbSAnLi4vLi4vdXRpbC9hcnJheXMnO1xuaW1wb3J0IHR5cGUgeyBTREsgfSBmcm9tICcuLi9hd3MtYXV0aCc7XG5cbi8qKlxuICogQWZ0ZXIgcmVhZGluZyBldmVudHMgZnJvbSBhbGwgQ2xvdWRXYXRjaCBsb2cgZ3JvdXBzXG4gKiBob3cgbG9uZyBzaG91bGQgd2Ugd2FpdCB0byByZWFkIG1vcmUgZXZlbnRzLlxuICpcbiAqIElmIHRoZXJlIGlzIHNvbWUgZXJyb3Igd2l0aCByZWFkaW5nIGV2ZW50cyAoaS5lLiBUaHJvdHRsZSlcbiAqIHRoZW4gdGhpcyBpcyBhbHNvIGhvdyBsb25nIHdlIHdhaXQgdW50aWwgd2UgdHJ5IGFnYWluXG4gKi9cbmNvbnN0IFNMRUVQID0gMl8wMDA7XG5cbi8qKlxuICogUmVwcmVzZW50cyBhIENsb3VkV2F0Y2ggTG9nIEV2ZW50IHRoYXQgd2lsbCBiZVxuICogcHJpbnRlZCB0byB0aGUgdGVybWluYWxcbiAqL1xuaW50ZXJmYWNlIENsb3VkV2F0Y2hMb2dFdmVudCB7XG4gIC8qKlxuICAgKiBUaGUgbG9nIGV2ZW50IG1lc3NhZ2VcbiAgICovXG4gIHJlYWRvbmx5IG1lc3NhZ2U6IHN0cmluZztcblxuICAvKipcbiAgICogVGhlIG5hbWUgb2YgdGhlIGxvZyBncm91cFxuICAgKi9cbiAgcmVhZG9ubHkgbG9nR3JvdXBOYW1lOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSB0aW1lIGF0IHdoaWNoIHRoZSBldmVudCBvY2N1cnJlZFxuICAgKi9cbiAgcmVhZG9ubHkgdGltZXN0YW1wOiBEYXRlO1xufVxuXG4vKipcbiAqIENvbmZpZ3VyYXRpb24gdHJhY2tpbmcgaW5mb3JtYXRpb24gb24gdGhlIGxvZyBncm91cHMgdGhhdCBhcmVcbiAqIGJlaW5nIG1vbml0b3JlZFxuICovXG5pbnRlcmZhY2UgTG9nR3JvdXBzQWNjZXNzU2V0dGluZ3Mge1xuICAvKipcbiAgICogVGhlIFNESyBmb3IgYSBnaXZlbiBlbnZpcm9ubWVudCAoYWNjb3VudC9yZWdpb24pXG4gICAqL1xuICByZWFkb25seSBzZGs6IFNESztcblxuICAvKipcbiAgICogQSBtYXAgb2YgbG9nIGdyb3VwcyBhbmQgYXNzb2NpYXRlZCBzdGFydFRpbWUgaW4gYSBnaXZlbiBhY2NvdW50LlxuICAgKlxuICAgKiBUaGUgbW9uaXRvciB3aWxsIHJlYWQgZXZlbnRzIGZyb20gdGhlIGxvZyBncm91cCBzdGFydGluZyBhdCB0aGVcbiAgICogYXNzb2NpYXRlZCBzdGFydFRpbWVcbiAgICovXG4gIHJlYWRvbmx5IGxvZ0dyb3Vwc1N0YXJ0VGltZXM6IHsgW2xvZ0dyb3VwTmFtZTogc3RyaW5nXTogbnVtYmVyIH07XG59XG5cbmV4cG9ydCBjbGFzcyBDbG91ZFdhdGNoTG9nRXZlbnRNb25pdG9yIHtcbiAgLyoqXG4gICAqIERldGVybWluZXMgd2hpY2ggZXZlbnRzIG5vdCB0byBkaXNwbGF5XG4gICAqL1xuICBwcml2YXRlIHN0YXJ0VGltZTogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBNYXAgb2YgZW52aXJvbm1lbnQgKGFjY291bnQ6cmVnaW9uKSB0byBMb2dHcm91cHNBY2Nlc3NTZXR0aW5nc1xuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBlbnZzTG9nR3JvdXBzQWNjZXNzU2V0dGluZ3MgPSBuZXcgTWFwPHN0cmluZywgTG9nR3JvdXBzQWNjZXNzU2V0dGluZ3M+KCk7XG5cbiAgcHJpdmF0ZSBhY3RpdmUgPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihzdGFydFRpbWU/OiBEYXRlKSB7XG4gICAgdGhpcy5zdGFydFRpbWUgPSBzdGFydFRpbWU/LmdldFRpbWUoKSA/PyBEYXRlLm5vdygpO1xuICB9XG5cbiAgLyoqXG4gICAqIHJlc3VtZSByZWFkaW5nL3ByaW50aW5nIGV2ZW50c1xuICAgKi9cbiAgcHVibGljIGFjdGl2YXRlKCk6IHZvaWQge1xuICAgIHRoaXMuYWN0aXZlID0gdHJ1ZTtcbiAgICB0aGlzLnNjaGVkdWxlTmV4dFRpY2soMCk7XG4gIH1cblxuICAvKipcbiAgICogZGVhY3RpdmF0ZXMgdGhlIG1vbml0b3Igc28gbm8gbmV3IGV2ZW50cyBhcmUgcmVhZFxuICAgKiB1c2UgY2FzZSBmb3IgdGhpcyBpcyB3aGVuIHdlIGFyZSBpbiB0aGUgbWlkZGxlIG9mIHBlcmZvcm1pbmcgYSBkZXBsb3ltZW50XG4gICAqIGFuZCBkb24ndCB3YW50IHRvIGludGVyd2VhdmUgYWxsIHRoZSBsb2dzIHRvZ2V0aGVyIHdpdGggdGhlIENGTlxuICAgKiBkZXBsb3ltZW50IGxvZ3NcbiAgICpcbiAgICogQWxzbyByZXNldHMgdGhlIHN0YXJ0IHRpbWUgdG8gYmUgd2hlbiB0aGUgbmV3IGRlcGxveW1lbnQgd2FzIHRyaWdnZXJlZFxuICAgKiBhbmQgY2xlYXJzIHRoZSBsaXN0IG9mIHRyYWNrZWQgbG9nIGdyb3Vwc1xuICAgKi9cbiAgcHVibGljIGRlYWN0aXZhdGUoKTogdm9pZCB7XG4gICAgdGhpcy5hY3RpdmUgPSBmYWxzZTtcbiAgICB0aGlzLnN0YXJ0VGltZSA9IERhdGUubm93KCk7XG4gICAgdGhpcy5lbnZzTG9nR3JvdXBzQWNjZXNzU2V0dGluZ3MuY2xlYXIoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIENsb3VkV2F0Y2ggbG9nIGdyb3VwcyB0byByZWFkIGxvZyBldmVudHMgZnJvbS5cbiAgICogU2luY2Ugd2UgY291bGQgYmUgd2F0Y2hpbmcgbXVsdGlwbGUgc3RhY2tzIHRoYXQgZGVwbG95IHRvXG4gICAqIG11bHRpcGxlIGVudmlyb25tZW50cyAoYWNjb3VudCtyZWdpb24pLCB3ZSBuZWVkIHRvIHN0b3JlIGEgbGlzdCBvZiBsb2cgZ3JvdXBzXG4gICAqIHBlciBlbnYgYWxvbmcgd2l0aCB0aGUgU0RLIG9iamVjdCB0aGF0IGhhcyBhY2Nlc3MgdG8gcmVhZCBmcm9tXG4gICAqIHRoYXQgZW52aXJvbm1lbnQuXG4gICAqL1xuICBwdWJsaWMgYWRkTG9nR3JvdXBzKGVudjogY3hhcGkuRW52aXJvbm1lbnQsIHNkazogU0RLLCBsb2dHcm91cE5hbWVzOiBzdHJpbmdbXSk6IHZvaWQge1xuICAgIGNvbnN0IGF3c0VudiA9IGAke2Vudi5hY2NvdW50fToke2Vudi5yZWdpb259YDtcbiAgICBjb25zdCBsb2dHcm91cHNTdGFydFRpbWVzID0gbG9nR3JvdXBOYW1lcy5yZWR1Y2UoXG4gICAgICAoYWNjLCBncm91cE5hbWUpID0+IHtcbiAgICAgICAgYWNjW2dyb3VwTmFtZV0gPSB0aGlzLnN0YXJ0VGltZTtcbiAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgIH0sXG4gICAgICB7fSBhcyB7IFtsb2dHcm91cE5hbWU6IHN0cmluZ106IG51bWJlciB9LFxuICAgICk7XG4gICAgdGhpcy5lbnZzTG9nR3JvdXBzQWNjZXNzU2V0dGluZ3Muc2V0KGF3c0Vudiwge1xuICAgICAgc2RrLFxuICAgICAgbG9nR3JvdXBzU3RhcnRUaW1lczoge1xuICAgICAgICAuLi50aGlzLmVudnNMb2dHcm91cHNBY2Nlc3NTZXR0aW5ncy5nZXQoYXdzRW52KT8ubG9nR3JvdXBzU3RhcnRUaW1lcyxcbiAgICAgICAgLi4ubG9nR3JvdXBzU3RhcnRUaW1lcyxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlTmV4dFRpY2soc2xlZXA6IG51bWJlcik6IHZvaWQge1xuICAgIHNldFRpbWVvdXQoKCkgPT4gdm9pZCB0aGlzLnRpY2soKSwgc2xlZXApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB0aWNrKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIGV4Y2x1ZGluZyBmcm9tIGNvZGVjb3ZlcmFnZSBiZWNhdXNlIHRoaXNcbiAgICAvLyBkb2Vzbid0IGFsd2F5cyBydW4gKGRlcGVuZHMgb24gdGltaW5nKVxuICAgIC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovXG4gICAgaWYgKCF0aGlzLmFjdGl2ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgY29uc3QgZXZlbnRzID0gZmxhdHRlbihhd2FpdCB0aGlzLnJlYWROZXdFdmVudHMoKSk7XG4gICAgICBldmVudHMuZm9yRWFjaCgoZXZlbnQpID0+IHtcbiAgICAgICAgdGhpcy5wcmludChldmVudCk7XG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBlcnJvcignRXJyb3Igb2NjdXJyZWQgd2hpbGUgbW9uaXRvcmluZyBsb2dzOiAlcycsIGUpO1xuICAgIH1cblxuICAgIHRoaXMuc2NoZWR1bGVOZXh0VGljayhTTEVFUCk7XG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYWxsIG5ldyBsb2cgZXZlbnRzIGZyb20gYSBzZXQgb2YgQ2xvdWRXYXRjaCBMb2cgR3JvdXBzXG4gICAqIGluIHBhcmFsbGVsXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHJlYWROZXdFdmVudHMoKTogUHJvbWlzZTxBcnJheTxBcnJheTxDbG91ZFdhdGNoTG9nRXZlbnQ+Pj4ge1xuICAgIGNvbnN0IHByb21pc2VzOiBBcnJheTxQcm9taXNlPEFycmF5PENsb3VkV2F0Y2hMb2dFdmVudD4+PiA9IFtdO1xuICAgIGZvciAoY29uc3Qgc2V0dGluZ3Mgb2YgdGhpcy5lbnZzTG9nR3JvdXBzQWNjZXNzU2V0dGluZ3MudmFsdWVzKCkpIHtcbiAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgT2JqZWN0LmtleXMoc2V0dGluZ3MubG9nR3JvdXBzU3RhcnRUaW1lcykpIHtcbiAgICAgICAgcHJvbWlzZXMucHVzaCh0aGlzLnJlYWRFdmVudHNGcm9tTG9nR3JvdXAoc2V0dGluZ3MsIGdyb3VwKSk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIExpbWl0ZWQgc2V0IG9mIGxvZyBncm91cHNcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQGNka2xhYnMvcHJvbWlzZWFsbC1uby11bmJvdW5kZWQtcGFyYWxsZWxpc21cbiAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIFByaW50IG91dCBhIGNsb3Vkd2F0Y2ggZXZlbnRcbiAgICovXG4gIHByaXZhdGUgcHJpbnQoZXZlbnQ6IENsb3VkV2F0Y2hMb2dFdmVudCk6IHZvaWQge1xuICAgIHByaW50KFxuICAgICAgdXRpbC5mb3JtYXQoXG4gICAgICAgICdbJXNdICVzICVzJyxcbiAgICAgICAgY2hhbGsuYmx1ZShldmVudC5sb2dHcm91cE5hbWUpLFxuICAgICAgICBjaGFsay55ZWxsb3coZXZlbnQudGltZXN0YW1wLnRvTG9jYWxlVGltZVN0cmluZygpKSxcbiAgICAgICAgZXZlbnQubWVzc2FnZS50cmltKCksXG4gICAgICApLFxuICAgICk7XG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYWxsIG5ldyBsb2cgZXZlbnRzIGZyb20gYSBDbG91ZFdhdGNoIExvZyBHcm91cFxuICAgKiBzdGFydGluZyBhdCBlaXRoZXIgdGhlIHRpbWUgdGhlIGhvdHN3YXAgd2FzIHRyaWdnZXJlZCBvclxuICAgKiB3aGVuIHRoZSBsYXN0IGV2ZW50IHdhcyByZWFkIG9uIHRoZSBwcmV2aW91cyB0aWNrXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHJlYWRFdmVudHNGcm9tTG9nR3JvdXAoXG4gICAgbG9nR3JvdXBzQWNjZXNzU2V0dGluZ3M6IExvZ0dyb3Vwc0FjY2Vzc1NldHRpbmdzLFxuICAgIGxvZ0dyb3VwTmFtZTogc3RyaW5nLFxuICApOiBQcm9taXNlPEFycmF5PENsb3VkV2F0Y2hMb2dFdmVudD4+IHtcbiAgICBjb25zdCBldmVudHM6IENsb3VkV2F0Y2hMb2dFdmVudFtdID0gW107XG5cbiAgICAvLyBsb2cgZXZlbnRzIGZyb20gc29tZSBzZXJ2aWNlIGFyZSBpbmdlc3RlZCBmYXN0ZXIgdGhhbiBvdGhlcnNcbiAgICAvLyBzbyB3ZSBuZWVkIHRvIHRyYWNrIHRoZSBzdGFydC9lbmQgdGltZSBmb3IgZWFjaCBsb2cgZ3JvdXAgaW5kaXZpZHVhbGx5XG4gICAgLy8gdG8gbWFrZSBzdXJlIHRoYXQgd2UgcHJvY2VzcyBhbGwgZXZlbnRzIGZyb20gZWFjaCBsb2cgZ3JvdXBcbiAgICBjb25zdCBzdGFydFRpbWUgPSBsb2dHcm91cHNBY2Nlc3NTZXR0aW5ncy5sb2dHcm91cHNTdGFydFRpbWVzW2xvZ0dyb3VwTmFtZV0gPz8gdGhpcy5zdGFydFRpbWU7XG4gICAgbGV0IGVuZFRpbWUgPSBzdGFydFRpbWU7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbG9nR3JvdXBzQWNjZXNzU2V0dGluZ3Muc2RrLmNsb3VkV2F0Y2hMb2dzKCkuZmlsdGVyTG9nRXZlbnRzKHtcbiAgICAgICAgbG9nR3JvdXBOYW1lOiBsb2dHcm91cE5hbWUsXG4gICAgICAgIGxpbWl0OiAxMDAsXG4gICAgICAgIHN0YXJ0VGltZTogc3RhcnRUaW1lLFxuICAgICAgfSk7XG4gICAgICBjb25zdCBmaWx0ZXJlZEV2ZW50cyA9IHJlc3BvbnNlLmV2ZW50cyA/PyBbXTtcblxuICAgICAgZm9yIChjb25zdCBldmVudCBvZiBmaWx0ZXJlZEV2ZW50cykge1xuICAgICAgICBpZiAoZXZlbnQubWVzc2FnZSkge1xuICAgICAgICAgIGV2ZW50cy5wdXNoKHtcbiAgICAgICAgICAgIG1lc3NhZ2U6IGV2ZW50Lm1lc3NhZ2UsXG4gICAgICAgICAgICBsb2dHcm91cE5hbWUsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IGV2ZW50LnRpbWVzdGFtcCA/IG5ldyBEYXRlKGV2ZW50LnRpbWVzdGFtcCkgOiBuZXcgRGF0ZSgpLFxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgaWYgKGV2ZW50LnRpbWVzdGFtcCAmJiBlbmRUaW1lIDwgZXZlbnQudGltZXN0YW1wKSB7XG4gICAgICAgICAgICBlbmRUaW1lID0gZXZlbnQudGltZXN0YW1wO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gQXMgbG9uZyBhcyB0aGVyZSBhcmUgX2FueV8gZXZlbnRzIGluIHRoZSBsb2cgZ3JvdXAgYGZpbHRlckxvZ0V2ZW50c2Agd2lsbCByZXR1cm4gYSBuZXh0VG9rZW4uXG4gICAgICAvLyBUaGlzIGlzIHRydWUgZXZlbiBpZiB0aGVzZSBldmVudHMgYXJlIGJlZm9yZSBgc3RhcnRUaW1lYC4gU28gaWYgd2UgaGF2ZSAxMDAgZXZlbnRzIGFuZCBhIG5leHRUb2tlblxuICAgICAgLy8gdGhlbiBhc3N1bWUgdGhhdCB3ZSBoYXZlIGhpdCB0aGUgbGltaXQgYW5kIGxldCB0aGUgdXNlciBrbm93IHNvbWUgbWVzc2FnZXMgaGF2ZSBiZWVuIHN1cHJlc3NlZC5cbiAgICAgIC8vIFdlIGFyZSBlc3NlbnRpYWxseSBzaG93aW5nIHRoZW0gYSBzYW1wbGluZyAoMTAwMDAgZXZlbnRzIHByaW50ZWQgb3V0IGlzIG5vdCB2ZXJ5IHVzZWZ1bClcbiAgICAgIGlmIChmaWx0ZXJlZEV2ZW50cy5sZW5ndGggPT09IDEwMCAmJiByZXNwb25zZS5uZXh0VG9rZW4pIHtcbiAgICAgICAgZXZlbnRzLnB1c2goe1xuICAgICAgICAgIG1lc3NhZ2U6ICc+Pj4gYHdhdGNoYCBzaG93cyBvbmx5IHRoZSBmaXJzdCAxMDAgbG9nIG1lc3NhZ2VzIC0gdGhlIHJlc3QgaGF2ZSBiZWVuIHRydW5jYXRlZC4uLicsXG4gICAgICAgICAgbG9nR3JvdXBOYW1lLFxuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoZW5kVGltZSksXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgLy8gd2l0aCBMYW1iZGEgZnVuY3Rpb25zIHRoZSBDbG91ZFdhdGNoIGlzIG5vdCBjcmVhdGVkXG4gICAgICAvLyB1bnRpbCBzb21ldGhpbmcgaXMgbG9nZ2VkLCBzbyBqdXN0IGtlZXAgcG9sbGluZyB1bnRpbFxuICAgICAgLy8gdGhlcmUgaXMgc29tdGhpbmcgdG8gZmluZFxuICAgICAgaWYgKGUubmFtZSA9PT0gJ1Jlc291cmNlTm90Rm91bmRFeGNlcHRpb24nKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICAgIHRocm93IGU7XG4gICAgfVxuICAgIGxvZ0dyb3Vwc0FjY2Vzc1NldHRpbmdzLmxvZ0dyb3Vwc1N0YXJ0VGltZXNbbG9nR3JvdXBOYW1lXSA9IGVuZFRpbWUgKyAxO1xuICAgIHJldHVybiBldmVudHM7XG4gIH1cbn1cbiJdfQ==