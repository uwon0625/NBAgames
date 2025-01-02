"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentActivityPrinter = exports.HistoryActivityPrinter = exports.StackActivityMonitor = exports.StackActivityProgress = void 0;
const util = require("util");
const cloud_assembly_schema_1 = require("@aws-cdk/cloud-assembly-schema");
const chalk = require("chalk");
const stack_event_poller_1 = require("./stack-event-poller");
const logging_1 = require("../../../logging");
const display_1 = require("../display");
/**
 * Supported display modes for stack deployment activity
 */
var StackActivityProgress;
(function (StackActivityProgress) {
    /**
     * Displays a progress bar with only the events for the resource currently being deployed
     */
    StackActivityProgress["BAR"] = "bar";
    /**
     * Displays complete history with all CloudFormation stack events
     */
    StackActivityProgress["EVENTS"] = "events";
})(StackActivityProgress || (exports.StackActivityProgress = StackActivityProgress = {}));
class StackActivityMonitor {
    /**
     * Create a Stack Activity Monitor using a default printer, based on context clues
     */
    static withDefaultPrinter(cfn, stackName, stackArtifact, options = {}) {
        const stream = options.ci ? process.stdout : process.stderr;
        const props = {
            resourceTypeColumnWidth: calcMaxResourceTypeLength(stackArtifact.template),
            resourcesTotal: options.resourcesTotal,
            stream,
        };
        const isWindows = process.platform === 'win32';
        const verbose = options.logLevel ?? logging_1.LogLevel.INFO;
        // On some CI systems (such as CircleCI) output still reports as a TTY so we also
        // need an individual check for whether we're running on CI.
        // see: https://discuss.circleci.com/t/circleci-terminal-is-a-tty-but-term-is-not-set/9965
        const fancyOutputAvailable = !isWindows && stream.isTTY && !options.ci;
        const progress = options.progress ?? StackActivityProgress.BAR;
        const printer = fancyOutputAvailable && !verbose && progress === StackActivityProgress.BAR
            ? new CurrentActivityPrinter(props)
            : new HistoryActivityPrinter(props);
        return new StackActivityMonitor(cfn, stackName, printer, stackArtifact, options.changeSetCreationTime);
    }
    constructor(cfn, stackName, printer, stack, changeSetCreationTime) {
        this.stackName = stackName;
        this.printer = printer;
        this.stack = stack;
        this.errors = [];
        this.active = false;
        this.poller = new stack_event_poller_1.StackEventPoller(cfn, {
            stackName,
            startTime: changeSetCreationTime?.getTime() ?? Date.now(),
        });
    }
    start() {
        this.active = true;
        this.printer.start();
        this.scheduleNextTick();
        return this;
    }
    async stop() {
        this.active = false;
        if (this.tickTimer) {
            clearTimeout(this.tickTimer);
        }
        // Do a final poll for all events. This is to handle the situation where DescribeStackStatus
        // already returned an error, but the monitor hasn't seen all the events yet and we'd end
        // up not printing the failure reason to users.
        await this.finalPollToEnd();
        this.printer.stop();
    }
    scheduleNextTick() {
        if (!this.active) {
            return;
        }
        this.tickTimer = setTimeout(() => void this.tick(), this.printer.updateSleep);
    }
    async tick() {
        if (!this.active) {
            return;
        }
        try {
            this.readPromise = this.readNewEvents();
            await this.readPromise;
            this.readPromise = undefined;
            // We might have been stop()ped while the network call was in progress.
            if (!this.active) {
                return;
            }
            this.printer.print();
        }
        catch (e) {
            (0, logging_1.error)('Error occurred while monitoring stack: %s', e);
        }
        this.scheduleNextTick();
    }
    findMetadataFor(logicalId) {
        const metadata = this.stack?.manifest?.metadata;
        if (!logicalId || !metadata) {
            return undefined;
        }
        for (const path of Object.keys(metadata)) {
            const entry = metadata[path]
                .filter((e) => e.type === cloud_assembly_schema_1.ArtifactMetadataEntryType.LOGICAL_ID)
                .find((e) => e.data === logicalId);
            if (entry) {
                return {
                    entry,
                    constructPath: this.simplifyConstructPath(path),
                };
            }
        }
        return undefined;
    }
    /**
     * Reads all new events from the stack history
     *
     * The events are returned in reverse chronological order; we continue to the next page if we
     * see a next page and the last event in the page is new to us (and within the time window).
     * haven't seen the final event
     */
    async readNewEvents() {
        const pollEvents = await this.poller.poll();
        const activities = pollEvents.map((event) => ({
            ...event,
            metadata: this.findMetadataFor(event.event.LogicalResourceId),
        }));
        for (const activity of activities) {
            this.checkForErrors(activity);
            this.printer.addActivity(activity);
        }
    }
    /**
     * Perform a final poll to the end and flush out all events to the printer
     *
     * Finish any poll currently in progress, then do a final one until we've
     * reached the last page.
     */
    async finalPollToEnd() {
        // If we were doing a poll, finish that first. It was started before
        // the moment we were sure we weren't going to get any new events anymore
        // so we need to do a new one anyway. Need to wait for this one though
        // because our state is single-threaded.
        if (this.readPromise) {
            await this.readPromise;
        }
        await this.readNewEvents();
    }
    checkForErrors(activity) {
        if (hasErrorMessage(activity.event.ResourceStatus ?? '')) {
            const isCancelled = (activity.event.ResourceStatusReason ?? '').indexOf('cancelled') > -1;
            // Cancelled is not an interesting failure reason, nor is the stack message (stack
            // message will just say something like "stack failed to update")
            if (!isCancelled && activity.event.StackName !== activity.event.LogicalResourceId) {
                this.errors.push(activity.event.ResourceStatusReason ?? '');
            }
        }
    }
    simplifyConstructPath(path) {
        path = path.replace(/\/Resource$/, '');
        path = path.replace(/^\//, ''); // remove "/" prefix
        // remove "<stack-name>/" prefix
        if (path.startsWith(this.stackName + '/')) {
            path = path.slice(this.stackName.length + 1);
        }
        return path;
    }
}
exports.StackActivityMonitor = StackActivityMonitor;
function padRight(n, x) {
    return x + ' '.repeat(Math.max(0, n - x.length));
}
/**
 * Infamous padLeft()
 */
function padLeft(n, x) {
    return ' '.repeat(Math.max(0, n - x.length)) + x;
}
function calcMaxResourceTypeLength(template) {
    const resources = (template && template.Resources) || {};
    let maxWidth = 0;
    for (const id of Object.keys(resources)) {
        const type = resources[id].Type || '';
        if (type.length > maxWidth) {
            maxWidth = type.length;
        }
    }
    return maxWidth;
}
class ActivityPrinterBase {
    constructor(props) {
        this.props = props;
        /**
         * Fetch new activity every 5 seconds
         */
        this.updateSleep = 5000;
        /**
         * A list of resource IDs which are currently being processed
         */
        this.resourcesInProgress = {};
        /**
         * Previous completion state observed by logical ID
         *
         * We use this to detect that if we see a DELETE_COMPLETE after a
         * CREATE_COMPLETE, it's actually a rollback and we should DECREASE
         * resourcesDone instead of increase it
         */
        this.resourcesPrevCompleteState = {};
        /**
         * Count of resources that have reported a _COMPLETE status
         */
        this.resourcesDone = 0;
        /**
         * How many digits we need to represent the total count (for lining up the status reporting)
         */
        this.resourceDigits = 0;
        this.rollingBack = false;
        this.failures = new Array();
        this.hookFailureMap = new Map();
        // +1 because the stack also emits a "COMPLETE" event at the end, and that wasn't
        // counted yet. This makes it line up with the amount of events we expect.
        this.resourcesTotal = props.resourcesTotal ? props.resourcesTotal + 1 : undefined;
        // How many digits does this number take to represent?
        this.resourceDigits = this.resourcesTotal ? Math.ceil(Math.log10(this.resourcesTotal)) : 0;
        this.stream = props.stream;
    }
    failureReason(activity) {
        const resourceStatusReason = activity.event.ResourceStatusReason ?? '';
        const logicalResourceId = activity.event.LogicalResourceId ?? '';
        const hookFailureReasonMap = this.hookFailureMap.get(logicalResourceId);
        if (hookFailureReasonMap !== undefined) {
            for (const hookType of hookFailureReasonMap.keys()) {
                if (resourceStatusReason.includes(hookType)) {
                    return resourceStatusReason + ' : ' + hookFailureReasonMap.get(hookType);
                }
            }
        }
        return resourceStatusReason;
    }
    addActivity(activity) {
        const status = activity.event.ResourceStatus;
        const hookStatus = activity.event.HookStatus;
        const hookType = activity.event.HookType;
        if (!status || !activity.event.LogicalResourceId) {
            return;
        }
        if (status === 'ROLLBACK_IN_PROGRESS' || status === 'UPDATE_ROLLBACK_IN_PROGRESS') {
            // Only triggered on the stack once we've started doing a rollback
            this.rollingBack = true;
        }
        if (status.endsWith('_IN_PROGRESS')) {
            this.resourcesInProgress[activity.event.LogicalResourceId] = activity;
        }
        if (hasErrorMessage(status)) {
            const isCancelled = (activity.event.ResourceStatusReason ?? '').indexOf('cancelled') > -1;
            // Cancelled is not an interesting failure reason
            if (!isCancelled) {
                this.failures.push(activity);
            }
        }
        if (status.endsWith('_COMPLETE') || status.endsWith('_FAILED')) {
            delete this.resourcesInProgress[activity.event.LogicalResourceId];
        }
        if (status.endsWith('_COMPLETE_CLEANUP_IN_PROGRESS')) {
            this.resourcesDone++;
        }
        if (status.endsWith('_COMPLETE')) {
            const prevState = this.resourcesPrevCompleteState[activity.event.LogicalResourceId];
            if (!prevState) {
                this.resourcesDone++;
            }
            else {
                // If we completed this before and we're completing it AGAIN, means we're rolling back.
                // Protect against silly underflow.
                this.resourcesDone--;
                if (this.resourcesDone < 0) {
                    this.resourcesDone = 0;
                }
            }
            this.resourcesPrevCompleteState[activity.event.LogicalResourceId] = status;
        }
        if (hookStatus !== undefined &&
            hookStatus.endsWith('_COMPLETE_FAILED') &&
            activity.event.LogicalResourceId !== undefined &&
            hookType !== undefined) {
            if (this.hookFailureMap.has(activity.event.LogicalResourceId)) {
                this.hookFailureMap.get(activity.event.LogicalResourceId)?.set(hookType, activity.event.HookStatusReason ?? '');
            }
            else {
                this.hookFailureMap.set(activity.event.LogicalResourceId, new Map());
                this.hookFailureMap.get(activity.event.LogicalResourceId)?.set(hookType, activity.event.HookStatusReason ?? '');
            }
        }
    }
    start() {
        // Empty on purpose
    }
    stop() {
        // Empty on purpose
    }
}
/**
 * Activity Printer which shows a full log of all CloudFormation events
 *
 * When there hasn't been activity for a while, it will print the resources
 * that are currently in progress, to show what's holding up the deployment.
 */
class HistoryActivityPrinter extends ActivityPrinterBase {
    constructor(props) {
        super(props);
        /**
         * Last time we printed something to the console.
         *
         * Used to measure timeout for progress reporting.
         */
        this.lastPrintTime = Date.now();
        /**
         * Number of ms of change absence before we tell the user about the resources that are currently in progress.
         */
        this.inProgressDelay = 30000;
        this.printable = new Array();
    }
    addActivity(activity) {
        super.addActivity(activity);
        this.printable.push(activity);
        this.print();
    }
    print() {
        for (const activity of this.printable) {
            this.printOne(activity);
        }
        this.printable.splice(0, this.printable.length);
        this.printInProgress();
    }
    stop() {
        // Print failures at the end
        if (this.failures.length > 0) {
            this.stream.write('\nFailed resources:\n');
            for (const failure of this.failures) {
                // Root stack failures are not interesting
                if (failure.isStackEvent) {
                    continue;
                }
                this.printOne(failure, false);
            }
        }
    }
    printOne(activity, progress) {
        const event = activity.event;
        const color = colorFromStatusResult(event.ResourceStatus);
        let reasonColor = chalk.cyan;
        let stackTrace = '';
        const metadata = activity.metadata;
        if (event.ResourceStatus && event.ResourceStatus.indexOf('FAILED') !== -1) {
            if (progress == undefined || progress) {
                event.ResourceStatusReason = event.ResourceStatusReason ? this.failureReason(activity) : '';
            }
            if (metadata) {
                stackTrace = metadata.entry.trace ? `\n\t${metadata.entry.trace.join('\n\t\\_ ')}` : '';
            }
            reasonColor = chalk.red;
        }
        const resourceName = metadata ? metadata.constructPath : event.LogicalResourceId || '';
        const logicalId = resourceName !== event.LogicalResourceId ? `(${event.LogicalResourceId}) ` : '';
        this.stream.write(util.format('%s | %s%s | %s | %s | %s %s%s%s\n', event.StackName, progress !== false ? `${this.progress()} | ` : '', new Date(event.Timestamp).toLocaleTimeString(), color(padRight(STATUS_WIDTH, (event.ResourceStatus || '').slice(0, STATUS_WIDTH))), // pad left and trim
        padRight(this.props.resourceTypeColumnWidth, event.ResourceType || ''), color(chalk.bold(resourceName)), logicalId, reasonColor(chalk.bold(event.ResourceStatusReason ? event.ResourceStatusReason : '')), reasonColor(stackTrace)));
        this.lastPrintTime = Date.now();
    }
    /**
     * Report the current progress as a [34/42] string, or just [34] if the total is unknown
     */
    progress() {
        if (this.resourcesTotal == null) {
            // Don't have total, show simple count and hope the human knows
            return padLeft(3, util.format('%s', this.resourcesDone)); // max 500 resources
        }
        return util.format('%s/%s', padLeft(this.resourceDigits, this.resourcesDone.toString()), padLeft(this.resourceDigits, this.resourcesTotal != null ? this.resourcesTotal.toString() : '?'));
    }
    /**
     * If some resources are taking a while to create, notify the user about what's currently in progress
     */
    printInProgress() {
        if (Date.now() < this.lastPrintTime + this.inProgressDelay) {
            return;
        }
        if (Object.keys(this.resourcesInProgress).length > 0) {
            this.stream.write(util.format('%s Currently in progress: %s\n', this.progress(), chalk.bold(Object.keys(this.resourcesInProgress).join(', '))));
        }
        // We cheat a bit here. To prevent printInProgress() from repeatedly triggering,
        // we set the timestamp into the future. It will be reset whenever a regular print
        // occurs, after which we can be triggered again.
        this.lastPrintTime = +Infinity;
    }
}
exports.HistoryActivityPrinter = HistoryActivityPrinter;
/**
 * Activity Printer which shows the resources currently being updated
 *
 * It will continuously reupdate the terminal and show only the resources
 * that are currently being updated, in addition to a progress bar which
 * shows how far along the deployment is.
 *
 * Resources that have failed will always be shown, and will be recapitulated
 * along with their stack trace when the monitoring ends.
 *
 * Resources that failed deployment because they have been cancelled are
 * not included.
 */
class CurrentActivityPrinter extends ActivityPrinterBase {
    constructor(props) {
        super(props);
        /**
         * This looks very disorienting sleeping for 5 seconds. Update quicker.
         */
        this.updateSleep = 2000;
        this.oldLogLevel = logging_1.LogLevel.INFO;
        this.block = new display_1.RewritableBlock(this.stream);
    }
    print() {
        const lines = [];
        // Add a progress bar at the top
        const progressWidth = Math.max(Math.min((this.block.width ?? 80) - PROGRESSBAR_EXTRA_SPACE - 1, MAX_PROGRESSBAR_WIDTH), MIN_PROGRESSBAR_WIDTH);
        const prog = this.progressBar(progressWidth);
        if (prog) {
            lines.push('  ' + prog, '');
        }
        // Normally we'd only print "resources in progress", but it's also useful
        // to keep an eye on the failures and know about the specific errors asquickly
        // as possible (while the stack is still rolling back), so add those in.
        const toPrint = [...this.failures, ...Object.values(this.resourcesInProgress)];
        toPrint.sort((a, b) => a.event.Timestamp.getTime() - b.event.Timestamp.getTime());
        lines.push(...toPrint.map((res) => {
            const color = colorFromStatusActivity(res.event.ResourceStatus);
            const resourceName = res.metadata?.constructPath ?? res.event.LogicalResourceId ?? '';
            return util.format('%s | %s | %s | %s%s', padLeft(TIMESTAMP_WIDTH, new Date(res.event.Timestamp).toLocaleTimeString()), color(padRight(STATUS_WIDTH, (res.event.ResourceStatus || '').slice(0, STATUS_WIDTH))), padRight(this.props.resourceTypeColumnWidth, res.event.ResourceType || ''), color(chalk.bold(shorten(40, resourceName))), this.failureReasonOnNextLine(res));
        }));
        this.block.displayLines(lines);
    }
    start() {
        // Need to prevent the waiter from printing 'stack not stable' every 5 seconds, it messes
        // with the output calculations.
        (0, logging_1.setLogLevel)(logging_1.LogLevel.INFO);
    }
    stop() {
        (0, logging_1.setLogLevel)(this.oldLogLevel);
        // Print failures at the end
        const lines = new Array();
        for (const failure of this.failures) {
            // Root stack failures are not interesting
            if (failure.isStackEvent) {
                continue;
            }
            lines.push(util.format(chalk.red('%s | %s | %s | %s%s') + '\n', padLeft(TIMESTAMP_WIDTH, new Date(failure.event.Timestamp).toLocaleTimeString()), padRight(STATUS_WIDTH, (failure.event.ResourceStatus || '').slice(0, STATUS_WIDTH)), padRight(this.props.resourceTypeColumnWidth, failure.event.ResourceType || ''), shorten(40, failure.event.LogicalResourceId ?? ''), this.failureReasonOnNextLine(failure)));
            const trace = failure.metadata?.entry?.trace;
            if (trace) {
                lines.push(chalk.red(`\t${trace.join('\n\t\\_ ')}\n`));
            }
        }
        // Display in the same block space, otherwise we're going to have silly empty lines.
        this.block.displayLines(lines);
        this.block.removeEmptyLines();
    }
    progressBar(width) {
        if (!this.resourcesTotal) {
            return '';
        }
        const fraction = Math.min(this.resourcesDone / this.resourcesTotal, 1);
        const innerWidth = Math.max(1, width - 2);
        const chars = innerWidth * fraction;
        const remainder = chars - Math.floor(chars);
        const fullChars = FULL_BLOCK.repeat(Math.floor(chars));
        const partialChar = PARTIAL_BLOCK[Math.floor(remainder * PARTIAL_BLOCK.length)];
        const filler = '·'.repeat(innerWidth - Math.floor(chars) - (partialChar ? 1 : 0));
        const color = this.rollingBack ? chalk.yellow : chalk.green;
        return '[' + color(fullChars + partialChar) + filler + `] (${this.resourcesDone}/${this.resourcesTotal})`;
    }
    failureReasonOnNextLine(activity) {
        return hasErrorMessage(activity.event.ResourceStatus ?? '')
            ? `\n${' '.repeat(TIMESTAMP_WIDTH + STATUS_WIDTH + 6)}${chalk.red(this.failureReason(activity) ?? '')}`
            : '';
    }
}
exports.CurrentActivityPrinter = CurrentActivityPrinter;
const FULL_BLOCK = '█';
const PARTIAL_BLOCK = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const MAX_PROGRESSBAR_WIDTH = 60;
const MIN_PROGRESSBAR_WIDTH = 10;
const PROGRESSBAR_EXTRA_SPACE = 2 /* leading spaces */ + 2 /* brackets */ + 4 /* progress number decoration */ + 6; /* 2 progress numbers up to 999 */
function hasErrorMessage(status) {
    return status.endsWith('_FAILED') || status === 'ROLLBACK_IN_PROGRESS' || status === 'UPDATE_ROLLBACK_IN_PROGRESS';
}
function colorFromStatusResult(status) {
    if (!status) {
        return chalk.reset;
    }
    if (status.indexOf('FAILED') !== -1) {
        return chalk.red;
    }
    if (status.indexOf('ROLLBACK') !== -1) {
        return chalk.yellow;
    }
    if (status.indexOf('COMPLETE') !== -1) {
        return chalk.green;
    }
    return chalk.reset;
}
function colorFromStatusActivity(status) {
    if (!status) {
        return chalk.reset;
    }
    if (status.endsWith('_FAILED')) {
        return chalk.red;
    }
    if (status.startsWith('CREATE_') || status.startsWith('UPDATE_') || status.startsWith('IMPORT_')) {
        return chalk.green;
    }
    // For stacks, it may also be 'UPDDATE_ROLLBACK_IN_PROGRESS'
    if (status.indexOf('ROLLBACK_') !== -1) {
        return chalk.yellow;
    }
    if (status.startsWith('DELETE_')) {
        return chalk.yellow;
    }
    return chalk.reset;
}
function shorten(maxWidth, p) {
    if (p.length <= maxWidth) {
        return p;
    }
    const half = Math.floor((maxWidth - 3) / 2);
    return p.slice(0, half) + '...' + p.slice(-half);
}
const TIMESTAMP_WIDTH = 12;
const STATUS_WIDTH = 20;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhY2stYWN0aXZpdHktbW9uaXRvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInN0YWNrLWFjdGl2aXR5LW1vbml0b3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkJBQTZCO0FBQzdCLDBFQUErRjtBQUUvRiwrQkFBK0I7QUFDL0IsNkRBQXVFO0FBQ3ZFLDhDQUFnRTtBQUVoRSx3Q0FBNkM7QUFXN0M7O0dBRUc7QUFDSCxJQUFZLHFCQVVYO0FBVkQsV0FBWSxxQkFBcUI7SUFDL0I7O09BRUc7SUFDSCxvQ0FBVyxDQUFBO0lBRVg7O09BRUc7SUFDSCwwQ0FBaUIsQ0FBQTtBQUNuQixDQUFDLEVBVlcscUJBQXFCLHFDQUFyQixxQkFBcUIsUUFVaEM7QUFzREQsTUFBYSxvQkFBb0I7SUFDL0I7O09BRUc7SUFDSSxNQUFNLENBQUMsa0JBQWtCLENBQzlCLEdBQTBCLEVBQzFCLFNBQWlCLEVBQ2pCLGFBQTBDLEVBQzFDLFVBQW1DLEVBQUU7UUFFckMsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQztRQUU1RCxNQUFNLEtBQUssR0FBaUI7WUFDMUIsdUJBQXVCLEVBQUUseUJBQXlCLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQztZQUMxRSxjQUFjLEVBQUUsT0FBTyxDQUFDLGNBQWM7WUFDdEMsTUFBTTtTQUNQLENBQUM7UUFFRixNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsUUFBUSxLQUFLLE9BQU8sQ0FBQztRQUMvQyxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsUUFBUSxJQUFJLGtCQUFRLENBQUMsSUFBSSxDQUFDO1FBQ2xELGlGQUFpRjtRQUNqRiw0REFBNEQ7UUFDNUQsMEZBQTBGO1FBQzFGLE1BQU0sb0JBQW9CLEdBQUcsQ0FBQyxTQUFTLElBQUksTUFBTSxDQUFDLEtBQUssSUFBSSxDQUFDLE9BQU8s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QUFLLENBQUMsTUFBTSxDQUFDO0lBQ3RCLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQyxLQUFLLENBQUM7QUFDckIsQ0FBQztBQUVELFNBQVMsT0FBTyxDQUFDLFFBQWdCLEVBQUUsQ0FBUztJQUMxQyxJQUFJLENBQUMsQ0FBQyxNQUFNLElBQUksUUFBUSxFQUFFLENBQUM7UUFDekIsT0FBTyxDQUFDLENBQUM7SUFDWCxDQUFDO0lBQ0QsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLFFBQVEsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztJQUM1QyxPQUFPLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxHQUFHLEtBQUssR0FBRyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDbkQsQ0FBQztBQUVELE1BQU0sZUFBZSxHQUFHLEVBQUUsQ0FBQztBQUMzQixNQUFNLFlBQVksR0FBRyxFQUFFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyB1dGlsIGZyb20gJ3V0aWwnO1xuaW1wb3J0IHsgQXJ0aWZhY3RNZXRhZGF0YUVudHJ5VHlwZSwgdHlwZSBNZXRhZGF0YUVudHJ5IH0gZnJvbSAnQGF3cy1jZGsvY2xvdWQtYXNzZW1ibHktc2NoZW1hJztcbmltcG9ydCB0eXBlIHsgQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0IH0gZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCAqIGFzIGNoYWxrIGZyb20gJ2NoYWxrJztcbmltcG9ydCB7IFJlc291cmNlRXZlbnQsIFN0YWNrRXZlbnRQb2xsZXIgfSBmcm9tICcuL3N0YWNrLWV2ZW50LXBvbGxlcic7XG5pbXBvcnQgeyBlcnJvciwgTG9nTGV2ZWwsIHNldExvZ0xldmVsIH0gZnJvbSAnLi4vLi4vLi4vbG9nZ2luZyc7XG5pbXBvcnQgdHlwZSB7IElDbG91ZEZvcm1hdGlvbkNsaWVudCB9IGZyb20gJy4uLy4uL2F3cy1hdXRoJztcbmltcG9ydCB7IFJld3JpdGFibGVCbG9jayB9IGZyb20gJy4uL2Rpc3BsYXknO1xuXG5leHBvcnQgaW50ZXJmYWNlIFN0YWNrQWN0aXZpdHkgZXh0ZW5kcyBSZXNvdXJjZUV2ZW50IHtcbiAgcmVhZG9ubHkgbWV0YWRhdGE/OiBSZXNvdXJjZU1ldGFkYXRhO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlc291cmNlTWV0YWRhdGEge1xuICBlbnRyeTogTWV0YWRhdGFFbnRyeTtcbiAgY29uc3RydWN0UGF0aDogc3RyaW5nO1xufVxuXG4vKipcbiAqIFN1cHBvcnRlZCBkaXNwbGF5IG1vZGVzIGZvciBzdGFjayBkZXBsb3ltZW50IGFjdGl2aXR5XG4gKi9cbmV4cG9ydCBlbnVtIFN0YWNrQWN0aXZpdHlQcm9ncmVzcyB7XG4gIC8qKlxuICAgKiBEaXNwbGF5cyBhIHByb2dyZXNzIGJhciB3aXRoIG9ubHkgdGhlIGV2ZW50cyBmb3IgdGhlIHJlc291cmNlIGN1cnJlbnRseSBiZWluZyBkZXBsb3llZFxuICAgKi9cbiAgQkFSID0gJ2JhcicsXG5cbiAgLyoqXG4gICAqIERpc3BsYXlzIGNvbXBsZXRlIGhpc3Rvcnkgd2l0aCBhbGwgQ2xvdWRGb3JtYXRpb24gc3RhY2sgZXZlbnRzXG4gICAqL1xuICBFVkVOVFMgPSAnZXZlbnRzJyxcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXaXRoRGVmYXVsdFByaW50ZXJQcm9wcyB7XG4gIC8qKlxuICAgKiBUb3RhbCBudW1iZXIgb2YgcmVzb3VyY2VzIHRvIHVwZGF0ZVxuICAgKlxuICAgKiBVc2VkIHRvIGNhbGN1bGF0ZSBhIHByb2dyZXNzIGJhci5cbiAgICpcbiAgICogQGRlZmF1bHQgLSBObyBwcm9ncmVzcyByZXBvcnRpbmcuXG4gICAqL1xuICByZWFkb25seSByZXNvdXJjZXNUb3RhbD86IG51bWJlcjtcblxuICAvKipcbiAgICogVGhlIGxvZyBsZXZlbCB0aGF0IHdhcyByZXF1ZXN0ZWQgaW4gdGhlIENMSVxuICAgKlxuICAgKiBJZiB2ZXJib3NlIG9yIHRyYWNlIGlzIHJlcXVlc3RlZCwgd2UnbGwgYWx3YXlzIHVzZSB0aGUgZnVsbCBoaXN0b3J5IHByaW50ZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gVXNlIHZhbHVlIGZyb20gbG9nZ2luZy5sb2dMZXZlbFxuICAgKi9cbiAgcmVhZG9ubHkgbG9nTGV2ZWw/OiBMb2dMZXZlbDtcblxuICAvKipcbiAgICogV2hldGhlciB0byBkaXNwbGF5IGFsbCBzdGFjayBldmVudHMgb3IgdG8gZGlzcGxheSBvbmx5IHRoZSBldmVudHMgZm9yIHRoZVxuICAgKiByZXNvdXJjZSBjdXJyZW50bHkgYmVpbmcgZGVwbG95ZWRcbiAgICpcbiAgICogSWYgbm90IHNldCwgdGhlIHN0YWNrIGhpc3Rvcnkgd2l0aCBhbGwgc3RhY2sgZXZlbnRzIHdpbGwgYmUgZGlzcGxheWVkXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICBwcm9ncmVzcz86IFN0YWNrQWN0aXZpdHlQcm9ncmVzcztcblxuICAvKipcbiAgICogV2hldGhlciB3ZSBhcmUgb24gYSBDSSBzeXN0ZW1cbiAgICpcbiAgICogSWYgc28sIGRpc2FibGUgdGhlIFwib3B0aW1pemVkXCIgc3RhY2sgbW9uaXRvci5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IGNpPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogQ3JlYXRpb24gdGltZSBvZiB0aGUgY2hhbmdlIHNldFxuICAgKlxuICAgKiBUaGlzIHdpbGwgYmUgdXNlZCB0byBmaWx0ZXIgZXZlbnRzLCBvbmx5IHNob3dpbmcgdGhvc2UgZnJvbSBhZnRlciB0aGUgY2hhbmdlXG4gICAqIHNldCBjcmVhdGlvbiB0aW1lLlxuICAgKlxuICAgKiBJdCBpcyByZWNvbW1lbmRlZCB0byB1c2UgdGhpcywgb3RoZXJ3aXNlIHRoZSBmaWx0ZXJpbmcgd2lsbCBiZSBzdWJqZWN0XG4gICAqIHRvIGNsb2NrIGRyaWZ0IGJldHdlZW4gbG9jYWwgYW5kIGNsb3VkIG1hY2hpbmVzLlxuICAgKlxuICAgKiBAZGVmYXVsdCAtIGxvY2FsIG1hY2hpbmUncyBjdXJyZW50IHRpbWVcbiAgICovXG4gIHJlYWRvbmx5IGNoYW5nZVNldENyZWF0aW9uVGltZT86IERhdGU7XG59XG5cbmV4cG9ydCBjbGFzcyBTdGFja0FjdGl2aXR5TW9uaXRvciB7XG4gIC8qKlxuICAgKiBDcmVhdGUgYSBTdGFjayBBY3Rpdml0eSBNb25pdG9yIHVzaW5nIGEgZGVmYXVsdCBwcmludGVyLCBiYXNlZCBvbiBjb250ZXh0IGNsdWVzXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHdpdGhEZWZhdWx0UHJpbnRlcihcbiAgICBjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudCxcbiAgICBzdGFja05hbWU6IHN0cmluZyxcbiAgICBzdGFja0FydGlmYWN0OiBDbG91ZEZvcm1hdGlvblN0YWNrQXJ0aWZhY3QsXG4gICAgb3B0aW9uczogV2l0aERlZmF1bHRQcmludGVyUHJvcHMgPSB7fSxcbiAgKSB7XG4gICAgY29uc3Qgc3RyZWFtID0gb3B0aW9ucy5jaSA/IHByb2Nlc3Muc3Rkb3V0IDogcHJvY2Vzcy5zdGRlcnI7XG5cbiAgICBjb25zdCBwcm9wczogUHJpbnRlclByb3BzID0ge1xuICAgICAgcmVzb3VyY2VUeXBlQ29sdW1uV2lkdGg6IGNhbGNNYXhSZXNvdXJjZVR5cGVMZW5ndGgoc3RhY2tBcnRpZmFjdC50ZW1wbGF0ZSksXG4gICAgICByZXNvdXJjZXNUb3RhbDogb3B0aW9ucy5yZXNvdXJjZXNUb3RhbCxcbiAgICAgIHN0cmVhbSxcbiAgICB9O1xuXG4gICAgY29uc3QgaXNXaW5kb3dzID0gcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJztcbiAgICBjb25zdCB2ZXJib3NlID0gb3B0aW9ucy5sb2dMZXZlbCA/PyBMb2dMZXZlbC5JTkZPO1xuICAgIC8vIE9uIHNvbWUgQ0kgc3lzdGVtcyAoc3VjaCBhcyBDaXJjbGVDSSkgb3V0cHV0IHN0aWxsIHJlcG9ydHMgYXMgYSBUVFkgc28gd2UgYWxzb1xuICAgIC8vIG5lZWQgYW4gaW5kaXZpZHVhbCBjaGVjayBmb3Igd2hldGhlciB3ZSdyZSBydW5uaW5nIG9uIENJLlxuICAgIC8vIHNlZTogaHR0cHM6Ly9kaXNjdXNzLmNpcmNsZWNpLmNvbS90L2NpcmNsZWNpLXRlcm1pbmFsLWlzLWEtdHR5LWJ1dC10ZXJtLWlzLW5vdC1zZXQvOTk2NVxuICAgIGNvbnN0IGZhbmN5T3V0cHV0QXZhaWxhYmxlID0gIWlzV2luZG93cyAmJiBzdHJlYW0uaXNUVFkgJiYgIW9wdGlvbnMuY2k7XG4gICAgY29uc3QgcHJvZ3Jlc3MgPSBvcHRpb25zLnByb2dyZXNzID8/IFN0YWNrQWN0aXZpdHlQcm9ncmVzcy5CQVI7XG5cbiAgICBjb25zdCBwcmludGVyID1cbiAgICAgIGZhbmN5T3V0cHV0QXZhaWxhYmxlICYmICF2ZXJib3NlICYmIHByb2dyZXNzID09PSBTdGFja0FjdGl2aXR5UHJvZ3Jlc3MuQkFSXG4gICAgICAgID8gbmV3IEN1cnJlbnRBY3Rpdml0eVByaW50ZXIocHJvcHMpXG4gICAgICAgIDogbmV3IEhpc3RvcnlBY3Rpdml0eVByaW50ZXIocHJvcHMpO1xuXG4gICAgcmV0dXJuIG5ldyBTdGFja0FjdGl2aXR5TW9uaXRvcihjZm4sIHN0YWNrTmFtZSwgcHJpbnRlciwgc3RhY2tBcnRpZmFjdCwgb3B0aW9ucy5jaGFuZ2VTZXRDcmVhdGlvblRpbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBwb2xsZXIgdXNlZCB0byByZWFkIHN0YWNrIGV2ZW50c1xuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IHBvbGxlcjogU3RhY2tFdmVudFBvbGxlcjtcblxuICBwdWJsaWMgcmVhZG9ubHkgZXJyb3JzOiBzdHJpbmdbXSA9IFtdO1xuXG4gIHByaXZhdGUgYWN0aXZlID0gZmFsc2U7XG5cbiAgLyoqXG4gICAqIEN1cnJlbnQgdGljayB0aW1lclxuICAgKi9cbiAgcHJpdmF0ZSB0aWNrVGltZXI/OiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PjtcblxuICAvKipcbiAgICogU2V0IHRvIHRoZSBhY3Rpdml0eSBvZiByZWFkaW5nIHRoZSBjdXJyZW50IGV2ZW50c1xuICAgKi9cbiAgcHJpdmF0ZSByZWFkUHJvbWlzZT86IFByb21pc2U8YW55PjtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHN0YWNrTmFtZTogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcHJpbnRlcjogSUFjdGl2aXR5UHJpbnRlcixcbiAgICBwcml2YXRlIHJlYWRvbmx5IHN0YWNrPzogQ2xvdWRGb3JtYXRpb25TdGFja0FydGlmYWN0LFxuICAgIGNoYW5nZVNldENyZWF0aW9uVGltZT86IERhdGUsXG4gICkge1xuICAgIHRoaXMucG9sbGVyID0gbmV3IFN0YWNrRXZlbnRQb2xsZXIoY2ZuLCB7XG4gICAgICBzdGFja05hbWUsXG4gICAgICBzdGFydFRpbWU6IGNoYW5nZVNldENyZWF0aW9uVGltZT8uZ2V0VGltZSgpID8/IERhdGUubm93KCksXG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgc3RhcnQoKSB7XG4gICAgdGhpcy5hY3RpdmUgPSB0cnVlO1xuICAgIHRoaXMucHJpbnRlci5zdGFydCgpO1xuICAgIHRoaXMuc2NoZWR1bGVOZXh0VGljaygpO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHN0b3AoKSB7XG4gICAgdGhpcy5hY3RpdmUgPSBmYWxzZTtcbiAgICBpZiAodGhpcy50aWNrVGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLnRpY2tUaW1lcik7XG4gICAgfVxuXG4gICAgLy8gRG8gYSBmaW5hbCBwb2xsIGZvciBhbGwgZXZlbnRzLiBUaGlzIGlzIHRvIGhhbmRsZSB0aGUgc2l0dWF0aW9uIHdoZXJlIERlc2NyaWJlU3RhY2tTdGF0dXNcbiAgICAvLyBhbHJlYWR5IHJldHVybmVkIGFuIGVycm9yLCBidXQgdGhlIG1vbml0b3IgaGFzbid0IHNlZW4gYWxsIHRoZSBldmVudHMgeWV0IGFuZCB3ZSdkIGVuZFxuICAgIC8vIHVwIG5vdCBwcmludGluZyB0aGUgZmFpbHVyZSByZWFzb24gdG8gdXNlcnMuXG4gICAgYXdhaXQgdGhpcy5maW5hbFBvbGxUb0VuZCgpO1xuXG4gICAgdGhpcy5wcmludGVyLnN0b3AoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVOZXh0VGljaygpIHtcbiAgICBpZiAoIXRoaXMuYWN0aXZlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy50aWNrVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHZvaWQgdGhpcy50aWNrKCksIHRoaXMucHJpbnRlci51cGRhdGVTbGVlcCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHRpY2soKSB7XG4gICAgaWYgKCF0aGlzLmFjdGl2ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICB0aGlzLnJlYWRQcm9taXNlID0gdGhpcy5yZWFkTmV3RXZlbnRzKCk7XG4gICAgICBhd2FpdCB0aGlzLnJlYWRQcm9taXNlO1xuICAgICAgdGhpcy5yZWFkUHJvbWlzZSA9IHVuZGVmaW5lZDtcblxuICAgICAgLy8gV2UgbWlnaHQgaGF2ZSBiZWVuIHN0b3AoKXBlZCB3aGlsZSB0aGUgbmV0d29yayBjYWxsIHdhcyBpbiBwcm9ncmVzcy5cbiAgICAgIGlmICghdGhpcy5hY3RpdmUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnByaW50ZXIucHJpbnQoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBlcnJvcignRXJyb3Igb2NjdXJyZWQgd2hpbGUgbW9uaXRvcmluZyBzdGFjazogJXMnLCBlKTtcbiAgICB9XG4gICAgdGhpcy5zY2hlZHVsZU5leHRUaWNrKCk7XG4gIH1cblxuICBwcml2YXRlIGZpbmRNZXRhZGF0YUZvcihsb2dpY2FsSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCk6IFJlc291cmNlTWV0YWRhdGEgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IG1ldGFkYXRhID0gdGhpcy5zdGFjaz8ubWFuaWZlc3Q/Lm1ldGFkYXRhO1xuICAgIGlmICghbG9naWNhbElkIHx8ICFtZXRhZGF0YSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgZm9yIChjb25zdCBwYXRoIG9mIE9iamVjdC5rZXlzKG1ldGFkYXRhKSkge1xuICAgICAgY29uc3QgZW50cnkgPSBtZXRhZGF0YVtwYXRoXVxuICAgICAgICAuZmlsdGVyKChlKSA9PiBlLnR5cGUgPT09IEFydGlmYWN0TWV0YWRhdGFFbnRyeVR5cGUuTE9HSUNBTF9JRClcbiAgICAgICAgLmZpbmQoKGUpID0+IGUuZGF0YSA9PT0gbG9naWNhbElkKTtcbiAgICAgIGlmIChlbnRyeSkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGVudHJ5LFxuICAgICAgICAgIGNvbnN0cnVjdFBhdGg6IHRoaXMuc2ltcGxpZnlDb25zdHJ1Y3RQYXRoKHBhdGgpLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlYWRzIGFsbCBuZXcgZXZlbnRzIGZyb20gdGhlIHN0YWNrIGhpc3RvcnlcbiAgICpcbiAgICogVGhlIGV2ZW50cyBhcmUgcmV0dXJuZWQgaW4gcmV2ZXJzZSBjaHJvbm9sb2dpY2FsIG9yZGVyOyB3ZSBjb250aW51ZSB0byB0aGUgbmV4dCBwYWdlIGlmIHdlXG4gICAqIHNlZSBhIG5leHQgcGFnZSBhbmQgdGhlIGxhc3QgZXZlbnQgaW4gdGhlIHBhZ2UgaXMgbmV3IHRvIHVzIChhbmQgd2l0aGluIHRoZSB0aW1lIHdpbmRvdykuXG4gICAqIGhhdmVuJ3Qgc2VlbiB0aGUgZmluYWwgZXZlbnRcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcmVhZE5ld0V2ZW50cygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBwb2xsRXZlbnRzID0gYXdhaXQgdGhpcy5wb2xsZXIucG9sbCgpO1xuXG4gICAgY29uc3QgYWN0aXZpdGllczogU3RhY2tBY3Rpdml0eVtdID0gcG9sbEV2ZW50cy5tYXAoKGV2ZW50KSA9PiAoe1xuICAgICAgLi4uZXZlbnQsXG4gICAgICBtZXRhZGF0YTogdGhpcy5maW5kTWV0YWRhdGFGb3IoZXZlbnQuZXZlbnQuTG9naWNhbFJlc291cmNlSWQpLFxuICAgIH0pKTtcblxuICAgIGZvciAoY29uc3QgYWN0aXZpdHkgb2YgYWN0aXZpdGllcykge1xuICAgICAgdGhpcy5jaGVja0ZvckVycm9ycyhhY3Rpdml0eSk7XG4gICAgICB0aGlzLnByaW50ZXIuYWRkQWN0aXZpdHkoYWN0aXZpdHkpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQZXJmb3JtIGEgZmluYWwgcG9sbCB0byB0aGUgZW5kIGFuZCBmbHVzaCBvdXQgYWxsIGV2ZW50cyB0byB0aGUgcHJpbnRlclxuICAgKlxuICAgKiBGaW5pc2ggYW55IHBvbGwgY3VycmVudGx5IGluIHByb2dyZXNzLCB0aGVuIGRvIGEgZmluYWwgb25lIHVudGlsIHdlJ3ZlXG4gICAqIHJlYWNoZWQgdGhlIGxhc3QgcGFnZS5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgZmluYWxQb2xsVG9FbmQoKSB7XG4gICAgLy8gSWYgd2Ugd2VyZSBkb2luZyBhIHBvbGwsIGZpbmlzaCB0aGF0IGZpcnN0LiBJdCB3YXMgc3RhcnRlZCBiZWZvcmVcbiAgICAvLyB0aGUgbW9tZW50IHdlIHdlcmUgc3VyZSB3ZSB3ZXJlbid0IGdvaW5nIHRvIGdldCBhbnkgbmV3IGV2ZW50cyBhbnltb3JlXG4gICAgLy8gc28gd2UgbmVlZCB0byBkbyBhIG5ldyBvbmUgYW55d2F5LiBOZWVkIHRvIHdhaXQgZm9yIHRoaXMgb25lIHRob3VnaFxuICAgIC8vIGJlY2F1c2Ugb3VyIHN0YXRlIGlzIHNpbmdsZS10aHJlYWRlZC5cbiAgICBpZiAodGhpcy5yZWFkUHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5yZWFkUHJvbWlzZTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnJlYWROZXdFdmVudHMoKTtcbiAgfVxuXG4gIHByaXZhdGUgY2hlY2tGb3JFcnJvcnMoYWN0aXZpdHk6IFN0YWNrQWN0aXZpdHkpIHtcbiAgICBpZiAoaGFzRXJyb3JNZXNzYWdlKGFjdGl2aXR5LmV2ZW50LlJlc291cmNlU3RhdHVzID8/ICcnKSkge1xuICAgICAgY29uc3QgaXNDYW5jZWxsZWQgPSAoYWN0aXZpdHkuZXZlbnQuUmVzb3VyY2VTdGF0dXNSZWFzb24gPz8gJycpLmluZGV4T2YoJ2NhbmNlbGxlZCcpID4gLTE7XG5cbiAgICAgIC8vIENhbmNlbGxlZCBpcyBub3QgYW4gaW50ZXJlc3RpbmcgZmFpbHVyZSByZWFzb24sIG5vciBpcyB0aGUgc3RhY2sgbWVzc2FnZSAoc3RhY2tcbiAgICAgIC8vIG1lc3NhZ2Ugd2lsbCBqdXN0IHNheSBzb21ldGhpbmcgbGlrZSBcInN0YWNrIGZhaWxlZCB0byB1cGRhdGVcIilcbiAgICAgIGlmICghaXNDYW5jZWxsZWQgJiYgYWN0aXZpdHkuZXZlbnQuU3RhY2tOYW1lICE9PSBhY3Rpdml0eS5ldmVudC5Mb2dpY2FsUmVzb3VyY2VJZCkge1xuICAgICAgICB0aGlzLmVycm9ycy5wdXNoKGFjdGl2aXR5LmV2ZW50LlJlc291cmNlU3RhdHVzUmVhc29uID8/ICcnKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHNpbXBsaWZ5Q29uc3RydWN0UGF0aChwYXRoOiBzdHJpbmcpIHtcbiAgICBwYXRoID0gcGF0aC5yZXBsYWNlKC9cXC9SZXNvdXJjZSQvLCAnJyk7XG4gICAgcGF0aCA9IHBhdGgucmVwbGFjZSgvXlxcLy8sICcnKTsgLy8gcmVtb3ZlIFwiL1wiIHByZWZpeFxuXG4gICAgLy8gcmVtb3ZlIFwiPHN0YWNrLW5hbWU+L1wiIHByZWZpeFxuICAgIGlmIChwYXRoLnN0YXJ0c1dpdGgodGhpcy5zdGFja05hbWUgKyAnLycpKSB7XG4gICAgICBwYXRoID0gcGF0aC5zbGljZSh0aGlzLnN0YWNrTmFtZS5sZW5ndGggKyAxKTtcbiAgICB9XG4gICAgcmV0dXJuIHBhdGg7XG4gIH1cbn1cblxuZnVuY3Rpb24gcGFkUmlnaHQobjogbnVtYmVyLCB4OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4geCArICcgJy5yZXBlYXQoTWF0aC5tYXgoMCwgbiAtIHgubGVuZ3RoKSk7XG59XG5cbi8qKlxuICogSW5mYW1vdXMgcGFkTGVmdCgpXG4gKi9cbmZ1bmN0aW9uIHBhZExlZnQobjogbnVtYmVyLCB4OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gJyAnLnJlcGVhdChNYXRoLm1heCgwLCBuIC0geC5sZW5ndGgpKSArIHg7XG59XG5cbmZ1bmN0aW9uIGNhbGNNYXhSZXNvdXJjZVR5cGVMZW5ndGgodGVtcGxhdGU6IGFueSkge1xuICBjb25zdCByZXNvdXJjZXMgPSAodGVtcGxhdGUgJiYgdGVtcGxhdGUuUmVzb3VyY2VzKSB8fCB7fTtcbiAgbGV0IG1heFdpZHRoID0gMDtcbiAgZm9yIChjb25zdCBpZCBvZiBPYmplY3Qua2V5cyhyZXNvdXJjZXMpKSB7XG4gICAgY29uc3QgdHlwZSA9IHJlc291cmNlc1tpZF0uVHlwZSB8fCAnJztcbiAgICBpZiAodHlwZS5sZW5ndGggPiBtYXhXaWR0aCkge1xuICAgICAgbWF4V2lkdGggPSB0eXBlLmxlbmd0aDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1heFdpZHRoO1xufVxuXG5pbnRlcmZhY2UgUHJpbnRlclByb3BzIHtcbiAgLyoqXG4gICAqIFRvdGFsIHJlc291cmNlcyB0byBkZXBsb3lcbiAgICovXG4gIHJlYWRvbmx5IHJlc291cmNlc1RvdGFsPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgd2l0aCBvZiB0aGUgXCJyZXNvdXJjZSB0eXBlXCIgY29sdW1uLlxuICAgKi9cbiAgcmVhZG9ubHkgcmVzb3VyY2VUeXBlQ29sdW1uV2lkdGg6IG51bWJlcjtcblxuICAvKipcbiAgICogU3RyZWFtIHRvIHdyaXRlIHRvXG4gICAqL1xuICByZWFkb25seSBzdHJlYW06IE5vZGVKUy5Xcml0ZVN0cmVhbTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJQWN0aXZpdHlQcmludGVyIHtcbiAgcmVhZG9ubHkgdXBkYXRlU2xlZXA6IG51bWJlcjtcblxuICBhZGRBY3Rpdml0eShhY3Rpdml0eTogU3RhY2tBY3Rpdml0eSk6IHZvaWQ7XG4gIHByaW50KCk6IHZvaWQ7XG4gIHN0YXJ0KCk6IHZvaWQ7XG4gIHN0b3AoKTogdm9pZDtcbn1cblxuYWJzdHJhY3QgY2xhc3MgQWN0aXZpdHlQcmludGVyQmFzZSBpbXBsZW1lbnRzIElBY3Rpdml0eVByaW50ZXIge1xuICAvKipcbiAgICogRmV0Y2ggbmV3IGFjdGl2aXR5IGV2ZXJ5IDUgc2Vjb25kc1xuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IHVwZGF0ZVNsZWVwOiBudW1iZXIgPSA1XzAwMDtcblxuICAvKipcbiAgICogQSBsaXN0IG9mIHJlc291cmNlIElEcyB3aGljaCBhcmUgY3VycmVudGx5IGJlaW5nIHByb2Nlc3NlZFxuICAgKi9cbiAgcHJvdGVjdGVkIHJlc291cmNlc0luUHJvZ3Jlc3M6IFJlY29yZDxzdHJpbmcsIFN0YWNrQWN0aXZpdHk+ID0ge307XG5cbiAgLyoqXG4gICAqIFByZXZpb3VzIGNvbXBsZXRpb24gc3RhdGUgb2JzZXJ2ZWQgYnkgbG9naWNhbCBJRFxuICAgKlxuICAgKiBXZSB1c2UgdGhpcyB0byBkZXRlY3QgdGhhdCBpZiB3ZSBzZWUgYSBERUxFVEVfQ09NUExFVEUgYWZ0ZXIgYVxuICAgKiBDUkVBVEVfQ09NUExFVEUsIGl0J3MgYWN0dWFsbHkgYSByb2xsYmFjayBhbmQgd2Ugc2hvdWxkIERFQ1JFQVNFXG4gICAqIHJlc291cmNlc0RvbmUgaW5zdGVhZCBvZiBpbmNyZWFzZSBpdFxuICAgKi9cbiAgcHJvdGVjdGVkIHJlc291cmNlc1ByZXZDb21wbGV0ZVN0YXRlOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG5cbiAgLyoqXG4gICAqIENvdW50IG9mIHJlc291cmNlcyB0aGF0IGhhdmUgcmVwb3J0ZWQgYSBfQ09NUExFVEUgc3RhdHVzXG4gICAqL1xuICBwcm90ZWN0ZWQgcmVzb3VyY2VzRG9uZTogbnVtYmVyID0gMDtcblxuICAvKipcbiAgICogSG93IG1hbnkgZGlnaXRzIHdlIG5lZWQgdG8gcmVwcmVzZW50IHRoZSB0b3RhbCBjb3VudCAoZm9yIGxpbmluZyB1cCB0aGUgc3RhdHVzIHJlcG9ydGluZylcbiAgICovXG4gIHByb3RlY3RlZCByZWFkb25seSByZXNvdXJjZURpZ2l0czogbnVtYmVyID0gMDtcblxuICBwcm90ZWN0ZWQgcmVhZG9ubHkgcmVzb3VyY2VzVG90YWw/OiBudW1iZXI7XG5cbiAgcHJvdGVjdGVkIHJvbGxpbmdCYWNrID0gZmFsc2U7XG5cbiAgcHJvdGVjdGVkIHJlYWRvbmx5IGZhaWx1cmVzID0gbmV3IEFycmF5PFN0YWNrQWN0aXZpdHk+KCk7XG5cbiAgcHJvdGVjdGVkIGhvb2tGYWlsdXJlTWFwID0gbmV3IE1hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIHN0cmluZz4+KCk7XG5cbiAgcHJvdGVjdGVkIHJlYWRvbmx5IHN0cmVhbTogTm9kZUpTLldyaXRlU3RyZWFtO1xuXG4gIGNvbnN0cnVjdG9yKHByb3RlY3RlZCByZWFkb25seSBwcm9wczogUHJpbnRlclByb3BzKSB7XG4gICAgLy8gKzEgYmVjYXVzZSB0aGUgc3RhY2sgYWxzbyBlbWl0cyBhIFwiQ09NUExFVEVcIiBldmVudCBhdCB0aGUgZW5kLCBhbmQgdGhhdCB3YXNuJ3RcbiAgICAvLyBjb3VudGVkIHlldC4gVGhpcyBtYWtlcyBpdCBsaW5lIHVwIHdpdGggdGhlIGFtb3VudCBvZiBldmVudHMgd2UgZXhwZWN0LlxuICAgIHRoaXMucmVzb3VyY2VzVG90YWwgPSBwcm9wcy5yZXNvdXJjZXNUb3RhbCA/IHByb3BzLnJlc291cmNlc1RvdGFsICsgMSA6IHVuZGVmaW5lZDtcblxuICAgIC8vIEhvdyBtYW55IGRpZ2l0cyBkb2VzIHRoaXMgbnVtYmVyIHRha2UgdG8gcmVwcmVzZW50P1xuICAgIHRoaXMucmVzb3VyY2VEaWdpdHMgPSB0aGlzLnJlc291cmNlc1RvdGFsID8gTWF0aC5jZWlsKE1hdGgubG9nMTAodGhpcy5yZXNvdXJjZXNUb3RhbCkpIDogMDtcblxuICAgIHRoaXMuc3RyZWFtID0gcHJvcHMuc3RyZWFtO1xuICB9XG5cbiAgcHVibGljIGZhaWx1cmVSZWFzb24oYWN0aXZpdHk6IFN0YWNrQWN0aXZpdHkpIHtcbiAgICBjb25zdCByZXNvdXJjZVN0YXR1c1JlYXNvbiA9IGFjdGl2aXR5LmV2ZW50LlJlc291cmNlU3RhdHVzUmVhc29uID8/ICcnO1xuICAgIGNvbnN0IGxvZ2ljYWxSZXNvdXJjZUlkID0gYWN0aXZpdHkuZXZlbnQuTG9naWNhbFJlc291cmNlSWQgPz8gJyc7XG4gICAgY29uc3QgaG9va0ZhaWx1cmVSZWFzb25NYXAgPSB0aGlzLmhvb2tGYWlsdXJlTWFwLmdldChsb2dpY2FsUmVzb3VyY2VJZCk7XG5cbiAgICBpZiAoaG9va0ZhaWx1cmVSZWFzb25NYXAgIT09IHVuZGVmaW5lZCkge1xuICAgICAgZm9yIChjb25zdCBob29rVHlwZSBvZiBob29rRmFpbHVyZVJlYXNvbk1hcC5rZXlzKCkpIHtcbiAgICAgICAgaWYgKHJlc291cmNlU3RhdHVzUmVhc29uLmluY2x1ZGVzKGhvb2tUeXBlKSkge1xuICAgICAgICAgIHJldHVybiByZXNvdXJjZVN0YXR1c1JlYXNvbiArICcgOiAnICsgaG9va0ZhaWx1cmVSZWFzb25NYXAuZ2V0KGhvb2tUeXBlKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmVzb3VyY2VTdGF0dXNSZWFzb247XG4gIH1cblxuICBwdWJsaWMgYWRkQWN0aXZpdHkoYWN0aXZpdHk6IFN0YWNrQWN0aXZpdHkpIHtcbiAgICBjb25zdCBzdGF0dXMgPSBhY3Rpdml0eS5ldmVudC5SZXNvdXJjZVN0YXR1cztcbiAgICBjb25zdCBob29rU3RhdHVzID0gYWN0aXZpdHkuZXZlbnQuSG9va1N0YXR1cztcbiAgICBjb25zdCBob29rVHlwZSA9IGFjdGl2aXR5LmV2ZW50Lkhvb2tUeXBlO1xuICAgIGlmICghc3RhdHVzIHx8ICFhY3Rpdml0eS5ldmVudC5Mb2dpY2FsUmVzb3VyY2VJZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChzdGF0dXMgPT09ICdST0xMQkFDS19JTl9QUk9HUkVTUycgfHwgc3RhdHVzID09PSAnVVBEQVRFX1JPTExCQUNLX0lOX1BST0dSRVNTJykge1xuICAgICAgLy8gT25seSB0cmlnZ2VyZWQgb24gdGhlIHN0YWNrIG9uY2Ugd2UndmUgc3RhcnRlZCBkb2luZyBhIHJvbGxiYWNrXG4gICAgICB0aGlzLnJvbGxpbmdCYWNrID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAoc3RhdHVzLmVuZHNXaXRoKCdfSU5fUFJPR1JFU1MnKSkge1xuICAgICAgdGhpcy5yZXNvdXJjZXNJblByb2dyZXNzW2FjdGl2aXR5LmV2ZW50LkxvZ2ljYWxSZXNvdXJjZUlkXSA9IGFjdGl2aXR5O1xuICAgIH1cblxuICAgIGlmIChoYXNFcnJvck1lc3NhZ2Uoc3RhdHVzKSkge1xuICAgICAgY29uc3QgaXNDYW5jZWxsZWQgPSAoYWN0aXZpdHkuZXZlbnQuUmVzb3VyY2VTdGF0dXNSZWFzb24gPz8gJycpLmluZGV4T2YoJ2NhbmNlbGxlZCcpID4gLTE7XG5cbiAgICAgIC8vIENhbmNlbGxlZCBpcyBub3QgYW4gaW50ZXJlc3RpbmcgZmFpbHVyZSByZWFzb25cbiAgICAgIGlmICghaXNDYW5jZWxsZWQpIHtcbiAgICAgICAgdGhpcy5mYWlsdXJlcy5wdXNoKGFjdGl2aXR5KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc3RhdHVzLmVuZHNXaXRoKCdfQ09NUExFVEUnKSB8fCBzdGF0dXMuZW5kc1dpdGgoJ19GQUlMRUQnKSkge1xuICAgICAgZGVsZXRlIHRoaXMucmVzb3VyY2VzSW5Qcm9ncmVzc1thY3Rpdml0eS5ldmVudC5Mb2dpY2FsUmVzb3VyY2VJZF07XG4gICAgfVxuXG4gICAgaWYgKHN0YXR1cy5lbmRzV2l0aCgnX0NPTVBMRVRFX0NMRUFOVVBfSU5fUFJPR1JFU1MnKSkge1xuICAgICAgdGhpcy5yZXNvdXJjZXNEb25lKys7XG4gICAgfVxuXG4gICAgaWYgKHN0YXR1cy5lbmRzV2l0aCgnX0NPTVBMRVRFJykpIHtcbiAgICAgIGNvbnN0IHByZXZTdGF0ZSA9IHRoaXMucmVzb3VyY2VzUHJldkNvbXBsZXRlU3RhdGVbYWN0aXZpdHkuZXZlbnQuTG9naWNhbFJlc291cmNlSWRdO1xuICAgICAgaWYgKCFwcmV2U3RhdGUpIHtcbiAgICAgICAgdGhpcy5yZXNvdXJjZXNEb25lKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBJZiB3ZSBjb21wbGV0ZWQgdGhpcyBiZWZvcmUgYW5kIHdlJ3JlIGNvbXBsZXRpbmcgaXQgQUdBSU4sIG1lYW5zIHdlJ3JlIHJvbGxpbmcgYmFjay5cbiAgICAgICAgLy8gUHJvdGVjdCBhZ2FpbnN0IHNpbGx5IHVuZGVyZmxvdy5cbiAgICAgICAgdGhpcy5yZXNvdXJjZXNEb25lLS07XG4gICAgICAgIGlmICh0aGlzLnJlc291cmNlc0RvbmUgPCAwKSB7XG4gICAgICAgICAgdGhpcy5yZXNvdXJjZXNEb25lID0gMDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5yZXNvdXJjZXNQcmV2Q29tcGxldGVTdGF0ZVthY3Rpdml0eS5ldmVudC5Mb2dpY2FsUmVzb3VyY2VJZF0gPSBzdGF0dXM7XG4gICAgfVxuXG4gICAgaWYgKFxuICAgICAgaG9va1N0YXR1cyAhPT0gdW5kZWZpbmVkICYmXG4gICAgICBob29rU3RhdHVzLmVuZHNXaXRoKCdfQ09NUExFVEVfRkFJTEVEJykgJiZcbiAgICAgIGFjdGl2aXR5LmV2ZW50LkxvZ2ljYWxSZXNvdXJjZUlkICE9PSB1bmRlZmluZWQgJiZcbiAgICAgIGhvb2tUeXBlICE9PSB1bmRlZmluZWRcbiAgICApIHtcbiAgICAgIGlmICh0aGlzLmhvb2tGYWlsdXJlTWFwLmhhcyhhY3Rpdml0eS5ldmVudC5Mb2dpY2FsUmVzb3VyY2VJZCkpIHtcbiAgICAgICAgdGhpcy5ob29rRmFpbHVyZU1hcC5nZXQoYWN0aXZpdHkuZXZlbnQuTG9naWNhbFJlc291cmNlSWQpPy5zZXQoaG9va1R5cGUsIGFjdGl2aXR5LmV2ZW50Lkhvb2tTdGF0dXNSZWFzb24gPz8gJycpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5ob29rRmFpbHVyZU1hcC5zZXQoYWN0aXZpdHkuZXZlbnQuTG9naWNhbFJlc291cmNlSWQsIG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCkpO1xuICAgICAgICB0aGlzLmhvb2tGYWlsdXJlTWFwLmdldChhY3Rpdml0eS5ldmVudC5Mb2dpY2FsUmVzb3VyY2VJZCk/LnNldChob29rVHlwZSwgYWN0aXZpdHkuZXZlbnQuSG9va1N0YXR1c1JlYXNvbiA/PyAnJyk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHVibGljIGFic3RyYWN0IHByaW50KCk6IHZvaWQ7XG5cbiAgcHVibGljIHN0YXJ0KCkge1xuICAgIC8vIEVtcHR5IG9uIHB1cnBvc2VcbiAgfVxuXG4gIHB1YmxpYyBzdG9wKCkge1xuICAgIC8vIEVtcHR5IG9uIHB1cnBvc2VcbiAgfVxufVxuXG4vKipcbiAqIEFjdGl2aXR5IFByaW50ZXIgd2hpY2ggc2hvd3MgYSBmdWxsIGxvZyBvZiBhbGwgQ2xvdWRGb3JtYXRpb24gZXZlbnRzXG4gKlxuICogV2hlbiB0aGVyZSBoYXNuJ3QgYmVlbiBhY3Rpdml0eSBmb3IgYSB3aGlsZSwgaXQgd2lsbCBwcmludCB0aGUgcmVzb3VyY2VzXG4gKiB0aGF0IGFyZSBjdXJyZW50bHkgaW4gcHJvZ3Jlc3MsIHRvIHNob3cgd2hhdCdzIGhvbGRpbmcgdXAgdGhlIGRlcGxveW1lbnQuXG4gKi9cbmV4cG9ydCBjbGFzcyBIaXN0b3J5QWN0aXZpdHlQcmludGVyIGV4dGVuZHMgQWN0aXZpdHlQcmludGVyQmFzZSB7XG4gIC8qKlxuICAgKiBMYXN0IHRpbWUgd2UgcHJpbnRlZCBzb21ldGhpbmcgdG8gdGhlIGNvbnNvbGUuXG4gICAqXG4gICAqIFVzZWQgdG8gbWVhc3VyZSB0aW1lb3V0IGZvciBwcm9ncmVzcyByZXBvcnRpbmcuXG4gICAqL1xuICBwcml2YXRlIGxhc3RQcmludFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gIC8qKlxuICAgKiBOdW1iZXIgb2YgbXMgb2YgY2hhbmdlIGFic2VuY2UgYmVmb3JlIHdlIHRlbGwgdGhlIHVzZXIgYWJvdXQgdGhlIHJlc291cmNlcyB0aGF0IGFyZSBjdXJyZW50bHkgaW4gcHJvZ3Jlc3MuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGluUHJvZ3Jlc3NEZWxheSA9IDMwXzAwMDtcblxuICBwcml2YXRlIHJlYWRvbmx5IHByaW50YWJsZSA9IG5ldyBBcnJheTxTdGFja0FjdGl2aXR5PigpO1xuXG4gIGNvbnN0cnVjdG9yKHByb3BzOiBQcmludGVyUHJvcHMpIHtcbiAgICBzdXBlcihwcm9wcyk7XG4gIH1cblxuICBwdWJsaWMgYWRkQWN0aXZpdHkoYWN0aXZpdHk6IFN0YWNrQWN0aXZpdHkpIHtcbiAgICBzdXBlci5hZGRBY3Rpdml0eShhY3Rpdml0eSk7XG4gICAgdGhpcy5wcmludGFibGUucHVzaChhY3Rpdml0eSk7XG4gICAgdGhpcy5wcmludCgpO1xuICB9XG5cbiAgcHVibGljIHByaW50KCkge1xuICAgIGZvciAoY29uc3QgYWN0aXZpdHkgb2YgdGhpcy5wcmludGFibGUpIHtcbiAgICAgIHRoaXMucHJpbnRPbmUoYWN0aXZpdHkpO1xuICAgIH1cbiAgICB0aGlzLnByaW50YWJsZS5zcGxpY2UoMCwgdGhpcy5wcmludGFibGUubGVuZ3RoKTtcbiAgICB0aGlzLnByaW50SW5Qcm9ncmVzcygpO1xuICB9XG5cbiAgcHVibGljIHN0b3AoKSB7XG4gICAgLy8gUHJpbnQgZmFpbHVyZXMgYXQgdGhlIGVuZFxuICAgIGlmICh0aGlzLmZhaWx1cmVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHRoaXMuc3RyZWFtLndyaXRlKCdcXG5GYWlsZWQgcmVzb3VyY2VzOlxcbicpO1xuICAgICAgZm9yIChjb25zdCBmYWlsdXJlIG9mIHRoaXMuZmFpbHVyZXMpIHtcbiAgICAgICAgLy8gUm9vdCBzdGFjayBmYWlsdXJlcyBhcmUgbm90IGludGVyZXN0aW5nXG4gICAgICAgIGlmIChmYWlsdXJlLmlzU3RhY2tFdmVudCkge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5wcmludE9uZShmYWlsdXJlLCBmYWxzZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBwcmludE9uZShhY3Rpdml0eTogU3RhY2tBY3Rpdml0eSwgcHJvZ3Jlc3M/OiBib29sZWFuKSB7XG4gICAgY29uc3QgZXZlbnQgPSBhY3Rpdml0eS5ldmVudDtcbiAgICBjb25zdCBjb2xvciA9IGNvbG9yRnJvbVN0YXR1c1Jlc3VsdChldmVudC5SZXNvdXJjZVN0YXR1cyk7XG4gICAgbGV0IHJlYXNvbkNvbG9yID0gY2hhbGsuY3lhbjtcblxuICAgIGxldCBzdGFja1RyYWNlID0gJyc7XG4gICAgY29uc3QgbWV0YWRhdGEgPSBhY3Rpdml0eS5tZXRhZGF0YTtcblxuICAgIGlmIChldmVudC5SZXNvdXJjZVN0YXR1cyAmJiBldmVudC5SZXNvdXJjZVN0YXR1cy5pbmRleE9mKCdGQUlMRUQnKSAhPT0gLTEpIHtcbiAgICAgIGlmIChwcm9ncmVzcyA9PSB1bmRlZmluZWQgfHwgcHJvZ3Jlc3MpIHtcbiAgICAgICAgZXZlbnQuUmVzb3VyY2VTdGF0dXNSZWFzb24gPSBldmVudC5SZXNvdXJjZVN0YXR1c1JlYXNvbiA/IHRoaXMuZmFpbHVyZVJlYXNvbihhY3Rpdml0eSkgOiAnJztcbiAgICAgIH1cbiAgICAgIGlmIChtZXRhZGF0YSkge1xuICAgICAgICBzdGFja1RyYWNlID0gbWV0YWRhdGEuZW50cnkudHJhY2UgPyBgXFxuXFx0JHttZXRhZGF0YS5lbnRyeS50cmFjZS5qb2luKCdcXG5cXHRcXFxcXyAnKX1gIDogJyc7XG4gICAgICB9XG4gICAgICByZWFzb25Db2xvciA9IGNoYWxrLnJlZDtcbiAgICB9XG5cbiAgICBjb25zdCByZXNvdXJjZU5hbWUgPSBtZXRhZGF0YSA/IG1ldGFkYXRhLmNvbnN0cnVjdFBhdGggOiBldmVudC5Mb2dpY2FsUmVzb3VyY2VJZCB8fCAnJztcblxuICAgIGNvbnN0IGxvZ2ljYWxJZCA9IHJlc291cmNlTmFtZSAhPT0gZXZlbnQuTG9naWNhbFJlc291cmNlSWQgPyBgKCR7ZXZlbnQuTG9naWNhbFJlc291cmNlSWR9KSBgIDogJyc7XG5cbiAgICB0aGlzLnN0cmVhbS53cml0ZShcbiAgICAgIHV0aWwuZm9ybWF0KFxuICAgICAgICAnJXMgfCAlcyVzIHwgJXMgfCAlcyB8ICVzICVzJXMlc1xcbicsXG4gICAgICAgIGV2ZW50LlN0YWNrTmFtZSxcbiAgICAgICAgcHJvZ3Jlc3MgIT09IGZhbHNlID8gYCR7dGhpcy5wcm9ncmVzcygpfSB8IGAgOiAnJyxcbiAgICAgICAgbmV3IERhdGUoZXZlbnQuVGltZXN0YW1wISkudG9Mb2NhbGVUaW1lU3RyaW5nKCksXG4gICAgICAgIGNvbG9yKHBhZFJpZ2h0KFNUQVRVU19XSURUSCwgKGV2ZW50LlJlc291cmNlU3RhdHVzIHx8ICcnKS5zbGljZSgwLCBTVEFUVVNfV0lEVEgpKSksIC8vIHBhZCBsZWZ0IGFuZCB0cmltXG4gICAgICAgIHBhZFJpZ2h0KHRoaXMucHJvcHMucmVzb3VyY2VUeXBlQ29sdW1uV2lkdGgsIGV2ZW50LlJlc291cmNlVHlwZSB8fCAnJyksXG4gICAgICAgIGNvbG9yKGNoYWxrLmJvbGQocmVzb3VyY2VOYW1lKSksXG4gICAgICAgIGxvZ2ljYWxJZCxcbiAgICAgICAgcmVhc29uQ29sb3IoY2hhbGsuYm9sZChldmVudC5SZXNvdXJjZVN0YXR1c1JlYXNvbiA/IGV2ZW50LlJlc291cmNlU3RhdHVzUmVhc29uIDogJycpKSxcbiAgICAgICAgcmVhc29uQ29sb3Ioc3RhY2tUcmFjZSksXG4gICAgICApLFxuICAgICk7XG5cbiAgICB0aGlzLmxhc3RQcmludFRpbWUgPSBEYXRlLm5vdygpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJlcG9ydCB0aGUgY3VycmVudCBwcm9ncmVzcyBhcyBhIFszNC80Ml0gc3RyaW5nLCBvciBqdXN0IFszNF0gaWYgdGhlIHRvdGFsIGlzIHVua25vd25cbiAgICovXG4gIHByaXZhdGUgcHJvZ3Jlc3MoKTogc3RyaW5nIHtcbiAgICBpZiAodGhpcy5yZXNvdXJjZXNUb3RhbCA9PSBudWxsKSB7XG4gICAgICAvLyBEb24ndCBoYXZlIHRvdGFsLCBzaG93IHNpbXBsZSBjb3VudCBhbmQgaG9wZSB0aGUgaHVtYW4ga25vd3NcbiAgICAgIHJldHVybiBwYWRMZWZ0KDMsIHV0aWwuZm9ybWF0KCclcycsIHRoaXMucmVzb3VyY2VzRG9uZSkpOyAvLyBtYXggNTAwIHJlc291cmNlc1xuICAgIH1cblxuICAgIHJldHVybiB1dGlsLmZvcm1hdChcbiAgICAgICclcy8lcycsXG4gICAgICBwYWRMZWZ0KHRoaXMucmVzb3VyY2VEaWdpdHMsIHRoaXMucmVzb3VyY2VzRG9uZS50b1N0cmluZygpKSxcbiAgICAgIHBhZExlZnQodGhpcy5yZXNvdXJjZURpZ2l0cywgdGhpcy5yZXNvdXJjZXNUb3RhbCAhPSBudWxsID8gdGhpcy5yZXNvdXJjZXNUb3RhbC50b1N0cmluZygpIDogJz8nKSxcbiAgICApO1xuICB9XG5cbiAgLyoqXG4gICAqIElmIHNvbWUgcmVzb3VyY2VzIGFyZSB0YWtpbmcgYSB3aGlsZSB0byBjcmVhdGUsIG5vdGlmeSB0aGUgdXNlciBhYm91dCB3aGF0J3MgY3VycmVudGx5IGluIHByb2dyZXNzXG4gICAqL1xuICBwcml2YXRlIHByaW50SW5Qcm9ncmVzcygpIHtcbiAgICBpZiAoRGF0ZS5ub3coKSA8IHRoaXMubGFzdFByaW50VGltZSArIHRoaXMuaW5Qcm9ncmVzc0RlbGF5KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHRoaXMucmVzb3VyY2VzSW5Qcm9ncmVzcykubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5zdHJlYW0ud3JpdGUoXG4gICAgICAgIHV0aWwuZm9ybWF0KFxuICAgICAgICAgICclcyBDdXJyZW50bHkgaW4gcHJvZ3Jlc3M6ICVzXFxuJyxcbiAgICAgICAgICB0aGlzLnByb2dyZXNzKCksXG4gICAgICAgICAgY2hhbGsuYm9sZChPYmplY3Qua2V5cyh0aGlzLnJlc291cmNlc0luUHJvZ3Jlc3MpLmpvaW4oJywgJykpLFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBXZSBjaGVhdCBhIGJpdCBoZXJlLiBUbyBwcmV2ZW50IHByaW50SW5Qcm9ncmVzcygpIGZyb20gcmVwZWF0ZWRseSB0cmlnZ2VyaW5nLFxuICAgIC8vIHdlIHNldCB0aGUgdGltZXN0YW1wIGludG8gdGhlIGZ1dHVyZS4gSXQgd2lsbCBiZSByZXNldCB3aGVuZXZlciBhIHJlZ3VsYXIgcHJpbnRcbiAgICAvLyBvY2N1cnMsIGFmdGVyIHdoaWNoIHdlIGNhbiBiZSB0cmlnZ2VyZWQgYWdhaW4uXG4gICAgdGhpcy5sYXN0UHJpbnRUaW1lID0gK0luZmluaXR5O1xuICB9XG59XG5cbi8qKlxuICogQWN0aXZpdHkgUHJpbnRlciB3aGljaCBzaG93cyB0aGUgcmVzb3VyY2VzIGN1cnJlbnRseSBiZWluZyB1cGRhdGVkXG4gKlxuICogSXQgd2lsbCBjb250aW51b3VzbHkgcmV1cGRhdGUgdGhlIHRlcm1pbmFsIGFuZCBzaG93IG9ubHkgdGhlIHJlc291cmNlc1xuICogdGhhdCBhcmUgY3VycmVudGx5IGJlaW5nIHVwZGF0ZWQsIGluIGFkZGl0aW9uIHRvIGEgcHJvZ3Jlc3MgYmFyIHdoaWNoXG4gKiBzaG93cyBob3cgZmFyIGFsb25nIHRoZSBkZXBsb3ltZW50IGlzLlxuICpcbiAqIFJlc291cmNlcyB0aGF0IGhhdmUgZmFpbGVkIHdpbGwgYWx3YXlzIGJlIHNob3duLCBhbmQgd2lsbCBiZSByZWNhcGl0dWxhdGVkXG4gKiBhbG9uZyB3aXRoIHRoZWlyIHN0YWNrIHRyYWNlIHdoZW4gdGhlIG1vbml0b3JpbmcgZW5kcy5cbiAqXG4gKiBSZXNvdXJjZXMgdGhhdCBmYWlsZWQgZGVwbG95bWVudCBiZWNhdXNlIHRoZXkgaGF2ZSBiZWVuIGNhbmNlbGxlZCBhcmVcbiAqIG5vdCBpbmNsdWRlZC5cbiAqL1xuZXhwb3J0IGNsYXNzIEN1cnJlbnRBY3Rpdml0eVByaW50ZXIgZXh0ZW5kcyBBY3Rpdml0eVByaW50ZXJCYXNlIHtcbiAgLyoqXG4gICAqIFRoaXMgbG9va3MgdmVyeSBkaXNvcmllbnRpbmcgc2xlZXBpbmcgZm9yIDUgc2Vjb25kcy4gVXBkYXRlIHF1aWNrZXIuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgdXBkYXRlU2xlZXA6IG51bWJlciA9IDJfMDAwO1xuXG4gIHByaXZhdGUgb2xkTG9nTGV2ZWw6IExvZ0xldmVsID0gTG9nTGV2ZWwuSU5GTztcbiAgcHJpdmF0ZSBibG9jayA9IG5ldyBSZXdyaXRhYmxlQmxvY2sodGhpcy5zdHJlYW0pO1xuXG4gIGNvbnN0cnVjdG9yKHByb3BzOiBQcmludGVyUHJvcHMpIHtcbiAgICBzdXBlcihwcm9wcyk7XG4gIH1cblxuICBwdWJsaWMgcHJpbnQoKTogdm9pZCB7XG4gICAgY29uc3QgbGluZXMgPSBbXTtcblxuICAgIC8vIEFkZCBhIHByb2dyZXNzIGJhciBhdCB0aGUgdG9wXG4gICAgY29uc3QgcHJvZ3Jlc3NXaWR0aCA9IE1hdGgubWF4KFxuICAgICAgTWF0aC5taW4oKHRoaXMuYmxvY2sud2lkdGggPz8gODApIC0gUFJPR1JFU1NCQVJfRVhUUkFfU1BBQ0UgLSAxLCBNQVhfUFJPR1JFU1NCQVJfV0lEVEgpLFxuICAgICAgTUlOX1BST0dSRVNTQkFSX1dJRFRILFxuICAgICk7XG4gICAgY29uc3QgcHJvZyA9IHRoaXMucHJvZ3Jlc3NCYXIocHJvZ3Jlc3NXaWR0aCk7XG4gICAgaWYgKHByb2cpIHtcbiAgICAgIGxpbmVzLnB1c2goJyAgJyArIHByb2csICcnKTtcbiAgICB9XG5cbiAgICAvLyBOb3JtYWxseSB3ZSdkIG9ubHkgcHJpbnQgXCJyZXNvdXJjZXMgaW4gcHJvZ3Jlc3NcIiwgYnV0IGl0J3MgYWxzbyB1c2VmdWxcbiAgICAvLyB0byBrZWVwIGFuIGV5ZSBvbiB0aGUgZmFpbHVyZXMgYW5kIGtub3cgYWJvdXQgdGhlIHNwZWNpZmljIGVycm9ycyBhc3F1aWNrbHlcbiAgICAvLyBhcyBwb3NzaWJsZSAod2hpbGUgdGhlIHN0YWNrIGlzIHN0aWxsIHJvbGxpbmcgYmFjayksIHNvIGFkZCB0aG9zZSBpbi5cbiAgICBjb25zdCB0b1ByaW50OiBTdGFja0FjdGl2aXR5W10gPSBbLi4udGhpcy5mYWlsdXJlcywgLi4uT2JqZWN0LnZhbHVlcyh0aGlzLnJlc291cmNlc0luUHJvZ3Jlc3MpXTtcbiAgICB0b1ByaW50LnNvcnQoKGEsIGIpID0+IGEuZXZlbnQuVGltZXN0YW1wIS5nZXRUaW1lKCkgLSBiLmV2ZW50LlRpbWVzdGFtcCEuZ2V0VGltZSgpKTtcblxuICAgIGxpbmVzLnB1c2goXG4gICAgICAuLi50b1ByaW50Lm1hcCgocmVzKSA9PiB7XG4gICAgICAgIGNvbnN0IGNvbG9yID0gY29sb3JGcm9tU3RhdHVzQWN0aXZpdHkocmVzLmV2ZW50LlJlc291cmNlU3RhdHVzKTtcbiAgICAgICAgY29uc3QgcmVzb3VyY2VOYW1lID0gcmVzLm1ldGFkYXRhPy5jb25zdHJ1Y3RQYXRoID8/IHJlcy5ldmVudC5Mb2dpY2FsUmVzb3VyY2VJZCA/PyAnJztcblxuICAgICAgICByZXR1cm4gdXRpbC5mb3JtYXQoXG4gICAgICAgICAgJyVzIHwgJXMgfCAlcyB8ICVzJXMnLFxuICAgICAgICAgIHBhZExlZnQoVElNRVNUQU1QX1dJRFRILCBuZXcgRGF0ZShyZXMuZXZlbnQuVGltZXN0YW1wISkudG9Mb2NhbGVUaW1lU3RyaW5nKCkpLFxuICAgICAgICAgIGNvbG9yKHBhZFJpZ2h0KFNUQVRVU19XSURUSCwgKHJlcy5ldmVudC5SZXNvdXJjZVN0YXR1cyB8fCAnJykuc2xpY2UoMCwgU1RBVFVTX1dJRFRIKSkpLFxuICAgICAgICAgIHBhZFJpZ2h0KHRoaXMucHJvcHMucmVzb3VyY2VUeXBlQ29sdW1uV2lkdGgsIHJlcy5ldmVudC5SZXNvdXJjZVR5cGUgfHwgJycpLFxuICAgICAgICAgIGNvbG9yKGNoYWxrLmJvbGQoc2hvcnRlbig0MCwgcmVzb3VyY2VOYW1lKSkpLFxuICAgICAgICAgIHRoaXMuZmFpbHVyZVJlYXNvbk9uTmV4dExpbmUocmVzKSxcbiAgICAgICAgKTtcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLmJsb2NrLmRpc3BsYXlMaW5lcyhsaW5lcyk7XG4gIH1cblxuICBwdWJsaWMgc3RhcnQoKSB7XG4gICAgLy8gTmVlZCB0byBwcmV2ZW50IHRoZSB3YWl0ZXIgZnJvbSBwcmludGluZyAnc3RhY2sgbm90IHN0YWJsZScgZXZlcnkgNSBzZWNvbmRzLCBpdCBtZXNzZXNcbiAgICAvLyB3aXRoIHRoZSBvdXRwdXQgY2FsY3VsYXRpb25zLlxuICAgIHNldExvZ0xldmVsKExvZ0xldmVsLklORk8pO1xuICB9XG5cbiAgcHVibGljIHN0b3AoKSB7XG4gICAgc2V0TG9nTGV2ZWwodGhpcy5vbGRMb2dMZXZlbCk7XG5cbiAgICAvLyBQcmludCBmYWlsdXJlcyBhdCB0aGUgZW5kXG4gICAgY29uc3QgbGluZXMgPSBuZXcgQXJyYXk8c3RyaW5nPigpO1xuICAgIGZvciAoY29uc3QgZmFpbHVyZSBvZiB0aGlzLmZhaWx1cmVzKSB7XG4gICAgICAvLyBSb290IHN0YWNrIGZhaWx1cmVzIGFyZSBub3QgaW50ZXJlc3RpbmdcbiAgICAgIGlmIChmYWlsdXJlLmlzU3RhY2tFdmVudCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgbGluZXMucHVzaChcbiAgICAgICAgdXRpbC5mb3JtYXQoXG4gICAgICAgICAgY2hhbGsucmVkKCclcyB8ICVzIHwgJXMgfCAlcyVzJykgKyAnXFxuJyxcbiAgICAgICAgICBwYWRMZWZ0KFRJTUVTVEFNUF9XSURUSCwgbmV3IERhdGUoZmFpbHVyZS5ldmVudC5UaW1lc3RhbXAhKS50b0xvY2FsZVRpbWVTdHJpbmcoKSksXG4gICAgICAgICAgcGFkUmlnaHQoU1RBVFVTX1dJRFRILCAoZmFpbHVyZS5ldmVudC5SZXNvdXJjZVN0YXR1cyB8fCAnJykuc2xpY2UoMCwgU1RBVFVTX1dJRFRIKSksXG4gICAgICAgICAgcGFkUmlnaHQodGhpcy5wcm9wcy5yZXNvdXJjZVR5cGVDb2x1bW5XaWR0aCwgZmFpbHVyZS5ldmVudC5SZXNvdXJjZVR5cGUgfHwgJycpLFxuICAgICAgICAgIHNob3J0ZW4oNDAsIGZhaWx1cmUuZXZlbnQuTG9naWNhbFJlc291cmNlSWQgPz8gJycpLFxuICAgICAgICAgIHRoaXMuZmFpbHVyZVJlYXNvbk9uTmV4dExpbmUoZmFpbHVyZSksXG4gICAgICAgICksXG4gICAgICApO1xuXG4gICAgICBjb25zdCB0cmFjZSA9IGZhaWx1cmUubWV0YWRhdGE/LmVudHJ5Py50cmFjZTtcbiAgICAgIGlmICh0cmFjZSkge1xuICAgICAgICBsaW5lcy5wdXNoKGNoYWxrLnJlZChgXFx0JHt0cmFjZS5qb2luKCdcXG5cXHRcXFxcXyAnKX1cXG5gKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRGlzcGxheSBpbiB0aGUgc2FtZSBibG9jayBzcGFjZSwgb3RoZXJ3aXNlIHdlJ3JlIGdvaW5nIHRvIGhhdmUgc2lsbHkgZW1wdHkgbGluZXMuXG4gICAgdGhpcy5ibG9jay5kaXNwbGF5TGluZXMobGluZXMpO1xuICAgIHRoaXMuYmxvY2sucmVtb3ZlRW1wdHlMaW5lcygpO1xuICB9XG5cbiAgcHJpdmF0ZSBwcm9ncmVzc0Jhcih3aWR0aDogbnVtYmVyKSB7XG4gICAgaWYgKCF0aGlzLnJlc291cmNlc1RvdGFsKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuICAgIGNvbnN0IGZyYWN0aW9uID0gTWF0aC5taW4odGhpcy5yZXNvdXJjZXNEb25lIC8gdGhpcy5yZXNvdXJjZXNUb3RhbCwgMSk7XG4gICAgY29uc3QgaW5uZXJXaWR0aCA9IE1hdGgubWF4KDEsIHdpZHRoIC0gMik7XG4gICAgY29uc3QgY2hhcnMgPSBpbm5lcldpZHRoICogZnJhY3Rpb247XG4gICAgY29uc3QgcmVtYWluZGVyID0gY2hhcnMgLSBNYXRoLmZsb29yKGNoYXJzKTtcblxuICAgIGNvbnN0IGZ1bGxDaGFycyA9IEZVTExfQkxPQ0sucmVwZWF0KE1hdGguZmxvb3IoY2hhcnMpKTtcbiAgICBjb25zdCBwYXJ0aWFsQ2hhciA9IFBBUlRJQUxfQkxPQ0tbTWF0aC5mbG9vcihyZW1haW5kZXIgKiBQQVJUSUFMX0JMT0NLLmxlbmd0aCldO1xuICAgIGNvbnN0IGZpbGxlciA9ICfCtycucmVwZWF0KGlubmVyV2lkdGggLSBNYXRoLmZsb29yKGNoYXJzKSAtIChwYXJ0aWFsQ2hhciA/IDEgOiAwKSk7XG5cbiAgICBjb25zdCBjb2xvciA9IHRoaXMucm9sbGluZ0JhY2sgPyBjaGFsay55ZWxsb3cgOiBjaGFsay5ncmVlbjtcblxuICAgIHJldHVybiAnWycgKyBjb2xvcihmdWxsQ2hhcnMgKyBwYXJ0aWFsQ2hhcikgKyBmaWxsZXIgKyBgXSAoJHt0aGlzLnJlc291cmNlc0RvbmV9LyR7dGhpcy5yZXNvdXJjZXNUb3RhbH0pYDtcbiAgfVxuXG4gIHByaXZhdGUgZmFpbHVyZVJlYXNvbk9uTmV4dExpbmUoYWN0aXZpdHk6IFN0YWNrQWN0aXZpdHkpIHtcbiAgICByZXR1cm4gaGFzRXJyb3JNZXNzYWdlKGFjdGl2aXR5LmV2ZW50LlJlc291cmNlU3RhdHVzID8/ICcnKVxuICAgICAgPyBgXFxuJHsnICcucmVwZWF0KFRJTUVTVEFNUF9XSURUSCArIFNUQVRVU19XSURUSCArIDYpfSR7Y2hhbGsucmVkKHRoaXMuZmFpbHVyZVJlYXNvbihhY3Rpdml0eSkgPz8gJycpfWBcbiAgICAgIDogJyc7XG4gIH1cbn1cblxuY29uc3QgRlVMTF9CTE9DSyA9ICfilognO1xuY29uc3QgUEFSVElBTF9CTE9DSyA9IFsnJywgJ+KWjycsICfilo4nLCAn4paNJywgJ+KWjCcsICfilosnLCAn4paKJywgJ+KWiSddO1xuY29uc3QgTUFYX1BST0dSRVNTQkFSX1dJRFRIID0gNjA7XG5jb25zdCBNSU5fUFJPR1JFU1NCQVJfV0lEVEggPSAxMDtcbmNvbnN0IFBST0dSRVNTQkFSX0VYVFJBX1NQQUNFID1cbiAgMiAvKiBsZWFkaW5nIHNwYWNlcyAqLyArIDIgLyogYnJhY2tldHMgKi8gKyA0IC8qIHByb2dyZXNzIG51bWJlciBkZWNvcmF0aW9uICovICsgNjsgLyogMiBwcm9ncmVzcyBudW1iZXJzIHVwIHRvIDk5OSAqL1xuXG5mdW5jdGlvbiBoYXNFcnJvck1lc3NhZ2Uoc3RhdHVzOiBzdHJpbmcpIHtcbiAgcmV0dXJuIHN0YXR1cy5lbmRzV2l0aCgnX0ZBSUxFRCcpIHx8IHN0YXR1cyA9PT0gJ1JPTExCQUNLX0lOX1BST0dSRVNTJyB8fCBzdGF0dXMgPT09ICdVUERBVEVfUk9MTEJBQ0tfSU5fUFJPR1JFU1MnO1xufVxuXG5mdW5jdGlvbiBjb2xvckZyb21TdGF0dXNSZXN1bHQoc3RhdHVzPzogc3RyaW5nKSB7XG4gIGlmICghc3RhdHVzKSB7XG4gICAgcmV0dXJuIGNoYWxrLnJlc2V0O1xuICB9XG5cbiAgaWYgKHN0YXR1cy5pbmRleE9mKCdGQUlMRUQnKSAhPT0gLTEpIHtcbiAgICByZXR1cm4gY2hhbGsucmVkO1xuICB9XG4gIGlmIChzdGF0dXMuaW5kZXhPZignUk9MTEJBQ0snKSAhPT0gLTEpIHtcbiAgICByZXR1cm4gY2hhbGsueWVsbG93O1xuICB9XG4gIGlmIChzdGF0dXMuaW5kZXhPZignQ09NUExFVEUnKSAhPT0gLTEpIHtcbiAgICByZXR1cm4gY2hhbGsuZ3JlZW47XG4gIH1cblxuICByZXR1cm4gY2hhbGsucmVzZXQ7XG59XG5cbmZ1bmN0aW9uIGNvbG9yRnJvbVN0YXR1c0FjdGl2aXR5KHN0YXR1cz86IHN0cmluZykge1xuICBpZiAoIXN0YXR1cykge1xuICAgIHJldHVybiBjaGFsay5yZXNldDtcbiAgfVxuXG4gIGlmIChzdGF0dXMuZW5kc1dpdGgoJ19GQUlMRUQnKSkge1xuICAgIHJldHVybiBjaGFsay5yZWQ7XG4gIH1cblxuICBpZiAoc3RhdHVzLnN0YXJ0c1dpdGgoJ0NSRUFURV8nKSB8fCBzdGF0dXMuc3RhcnRzV2l0aCgnVVBEQVRFXycpIHx8IHN0YXR1cy5zdGFydHNXaXRoKCdJTVBPUlRfJykpIHtcbiAgICByZXR1cm4gY2hhbGsuZ3JlZW47XG4gIH1cbiAgLy8gRm9yIHN0YWNrcywgaXQgbWF5IGFsc28gYmUgJ1VQRERBVEVfUk9MTEJBQ0tfSU5fUFJPR1JFU1MnXG4gIGlmIChzdGF0dXMuaW5kZXhPZignUk9MTEJBQ0tfJykgIT09IC0xKSB7XG4gICAgcmV0dXJuIGNoYWxrLnllbGxvdztcbiAgfVxuICBpZiAoc3RhdHVzLnN0YXJ0c1dpdGgoJ0RFTEVURV8nKSkge1xuICAgIHJldHVybiBjaGFsay55ZWxsb3c7XG4gIH1cblxuICByZXR1cm4gY2hhbGsucmVzZXQ7XG59XG5cbmZ1bmN0aW9uIHNob3J0ZW4obWF4V2lkdGg6IG51bWJlciwgcDogc3RyaW5nKSB7XG4gIGlmIChwLmxlbmd0aCA8PSBtYXhXaWR0aCkge1xuICAgIHJldHVybiBwO1xuICB9XG4gIGNvbnN0IGhhbGYgPSBNYXRoLmZsb29yKChtYXhXaWR0aCAtIDMpIC8gMik7XG4gIHJldHVybiBwLnNsaWNlKDAsIGhhbGYpICsgJy4uLicgKyBwLnNsaWNlKC1oYWxmKTtcbn1cblxuY29uc3QgVElNRVNUQU1QX1dJRFRIID0gMTI7XG5jb25zdCBTVEFUVVNfV0lEVEggPSAyMDtcbiJdfQ==