"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Settings = exports.Context = exports.Configuration = exports.Command = exports.TRANSIENT_CONTEXT_KEY = exports.USER_DEFAULTS = exports.PROJECT_CONTEXT = exports.PROJECT_CONFIG = void 0;
const os = require("os");
const fs_path = require("path");
const fs = require("fs-extra");
const logging_1 = require("./logging");
const util = require("./util");
exports.PROJECT_CONFIG = 'cdk.json';
exports.PROJECT_CONTEXT = 'cdk.context.json';
exports.USER_DEFAULTS = '~/.cdk.json';
/**
 * If a context value is an object with this key set to a truthy value, it won't be saved to cdk.context.json
 */
exports.TRANSIENT_CONTEXT_KEY = '$dontSaveContext';
const CONTEXT_KEY = 'context';
var Command;
(function (Command) {
    Command["LS"] = "ls";
    Command["LIST"] = "list";
    Command["DIFF"] = "diff";
    Command["BOOTSTRAP"] = "bootstrap";
    Command["DEPLOY"] = "deploy";
    Command["DESTROY"] = "destroy";
    Command["SYNTHESIZE"] = "synthesize";
    Command["SYNTH"] = "synth";
    Command["METADATA"] = "metadata";
    Command["INIT"] = "init";
    Command["VERSION"] = "version";
    Command["WATCH"] = "watch";
})(Command || (exports.Command = Command = {}));
const BUNDLING_COMMANDS = [
    Command.DEPLOY,
    Command.DIFF,
    Command.SYNTH,
    Command.SYNTHESIZE,
    Command.WATCH,
];
/**
 * All sources of settings combined
 */
class Configuration {
    constructor(props = {}) {
        this.props = props;
        this.settings = new Settings();
        this.context = new Context();
        this.defaultConfig = new Settings({
            versionReporting: true,
            assetMetadata: true,
            pathMetadata: true,
            output: 'cdk.out',
        });
        this.loaded = false;
        this.commandLineArguments = props.commandLineArguments
            ? Settings.fromCommandLineArguments(props.commandLineArguments)
            : new Settings();
        this.commandLineContext = this.commandLineArguments.subSettings([CONTEXT_KEY]).makeReadOnly();
    }
    get projectConfig() {
        if (!this._projectConfig) {
            throw new Error('#load has not been called yet!');
        }
        return this._projectConfig;
    }
    get projectContext() {
        if (!this._projectContext) {
            throw new Error('#load has not been called yet!');
        }
        return this._projectContext;
    }
    /**
     * Load all config
     */
    async load() {
        const userConfig = await loadAndLog(exports.USER_DEFAULTS);
        this._projectConfig = await loadAndLog(exports.PROJECT_CONFIG);
        this._projectContext = await loadAndLog(exports.PROJECT_CONTEXT);
        const readUserContext = this.props.readUserContext ?? true;
        if (userConfig.get(['build'])) {
            throw new Error('The `build` key cannot be specified in the user config (~/.cdk.json), specify it in the project config (cdk.json) instead');
        }
        const contextSources = [
            this.commandLineContext,
            this.projectConfig.subSettings([CONTEXT_KEY]).makeReadOnly(),
            this.projectContext,
        ];
        if (readUserContext) {
            contextSources.push(userConfig.subSettings([CONTEXT_KEY]).makeReadOnly());
        }
        this.context = new Context(...contextSources);
        // Build settings from what's left
        this.settings = this.defaultConfig
            .merge(userConfig)
            .merge(this.projectConfig)
            .merge(this.commandLineArguments)
            .makeReadOnly();
        (0, logging_1.debug)('merged settings:', this.settings.all);
        this.loaded = true;
        return this;
    }
    /**
     * Save the project context
     */
    async saveContext() {
        if (!this.loaded) {
            return this;
        } // Avoid overwriting files with nothing
        await this.projectContext.save(exports.PROJECT_CONTEXT);
        return this;
    }
}
exports.Configuration = Configuration;
async function loadAndLog(fileName) {
    const ret = new Settings();
    await ret.load(fileName);
    if (!ret.empty) {
        (0, logging_1.debug)(fileName + ':', JSON.stringify(ret.all, undefined, 2));
    }
    return ret;
}
/**
 * Class that supports overlaying property bags
 *
 * Reads come from the first property bag that can has the given key,
 * writes go to the first property bag that is not readonly. A write
 * will remove the value from all property bags after the first
 * writable one.
 */
class Context {
    constructor(...bags) {
        this.bags = bags.length > 0 ? bags : [new Settings()];
    }
    get keys() {
        return Object.keys(this.all);
    }
    has(key) {
        return this.keys.indexOf(key) > -1;
    }
    get all() {
        let ret = new Settings();
        // In reverse order so keys to the left overwrite keys to the right of them
        for (const bag of [...this.bags].reverse()) {
            ret = ret.merge(bag);
        }
        return ret.all;
    }
    get(key) {
        for (const bag of this.bags) {
            const v = bag.get([key]);
            if (v !== undefined) {
                return v;
            }
        }
        return undefined;
    }
    set(key, value) {
        for (const bag of this.bags) {
            if (bag.readOnly) {
                continue;
            }
            // All bags past the first one have the value erased
            bag.set([key], value);
            value = undefined;
        }
    }
    unset(key) {
        this.set(key, undefined);
    }
    clear() {
        for (const key of this.keys) {
            this.unset(key);
        }
    }
}
exports.Context = Context;
/**
 * A single bag of settings
 */
class Settings {
    /**
     * Parse Settings out of CLI arguments.
     *
     * CLI arguments in must be accessed in the CLI code via
     * `configuration.settings.get(['argName'])` instead of via `args.argName`.
     *
     * The advantage is that they can be configured via `cdk.json` and
     * `$HOME/.cdk.json`. Arguments not listed below and accessed via this object
     * can only be specified on the command line.
     *
     * @param argv the received CLI arguments.
     * @returns a new Settings object.
     */
    static fromCommandLineArguments(argv) {
        const context = this.parseStringContextListToObject(argv);
        const tags = this.parseStringTagsListToObject(expectStringList(argv.tags));
        // Determine bundling stacks
        let bundlingStacks;
        if (BUNDLING_COMMANDS.includes(argv._[0])) {
            // If we deploy, diff, synth or watch a list of stacks exclusively we skip
            // bundling for all other stacks.
            bundlingStacks = argv.exclusively
                ? argv.STACKS ?? ['**']
                : ['**'];
        }
        else { // Skip bundling for all stacks
            bundlingStacks = [];
        }
        return new Settings({
            app: argv.app,
            browser: argv.browser,
            build: argv.build,
            context,
            debug: argv.debug,
            tags,
            language: argv.language,
            pathMetadata: argv.pathMetadata,
            assetMetadata: argv.assetMetadata,
            profile: argv.profile,
            plugin: argv.plugin,
            requireApproval: argv.requireApproval,
            toolkitStackName: argv.toolkitStackName,
            toolkitBucket: {
                bucketName: argv.bootstrapBucketName,
                kmsKeyId: argv.bootstrapKmsKeyId,
            },
            versionReporting: argv.versionReporting,
            staging: argv.staging,
            output: argv.output,
            outputsFile: argv.outputsFile,
            progress: argv.progress,
            bundlingStacks,
            lookups: argv.lookups,
            rollback: argv.rollback,
            notices: argv.notices,
            assetParallelism: argv['asset-parallelism'],
            assetPrebuild: argv['asset-prebuild'],
            ignoreNoStacks: argv['ignore-no-stacks'],
            hotswap: {
                ecs: {
                    minimumEcsHealthyPercent: argv.minimumEcsHealthyPercent,
                    maximumEcsHealthyPercent: argv.maximumEcsHealthyPercent,
                },
            },
            unstable: argv.unstable,
        });
    }
    static mergeAll(...settings) {
        let ret = new Settings();
        for (const setting of settings) {
            ret = ret.merge(setting);
        }
        return ret;
    }
    static parseStringContextListToObject(argv) {
        const context = {};
        for (const assignment of (argv.context || [])) {
            const parts = assignment.split(/=(.*)/, 2);
            if (parts.length === 2) {
                (0, logging_1.debug)('CLI argument context: %s=%s', parts[0], parts[1]);
                if (parts[0].match(/^aws:.+/)) {
                    throw new Error(`User-provided context cannot use keys prefixed with 'aws:', but ${parts[0]} was provided.`);
                }
                context[parts[0]] = parts[1];
            }
            else {
                (0, logging_1.warning)('Context argument is not an assignment (key=value): %s', assignment);
            }
        }
        return context;
    }
    /**
     * Parse tags out of arguments
     *
     * Return undefined if no tags were provided, return an empty array if only empty
     * strings were provided
     */
    static parseStringTagsListToObject(argTags) {
        if (argTags === undefined) {
            return undefined;
        }
        if (argTags.length === 0) {
            return undefined;
        }
        const nonEmptyTags = argTags.filter(t => t !== '');
        if (nonEmptyTags.length === 0) {
            return [];
        }
        const tags = [];
        for (const assignment of nonEmptyTags) {
            const parts = assignment.split(/=(.*)/, 2);
            if (parts.length === 2) {
                (0, logging_1.debug)('CLI argument tags: %s=%s', parts[0], parts[1]);
                tags.push({
                    Key: parts[0],
                    Value: parts[1],
                });
            }
            else {
                (0, logging_1.warning)('Tags argument is not an assignment (key=value): %s', assignment);
            }
        }
        return tags.length > 0 ? tags : undefined;
    }
    constructor(settings = {}, readOnly = false) {
        this.settings = settings;
        this.readOnly = readOnly;
    }
    async load(fileName) {
        if (this.readOnly) {
            throw new Error(`Can't load ${fileName}: settings object is readonly`);
        }
        this.settings = {};
        const expanded = expandHomeDir(fileName);
        if (await fs.pathExists(expanded)) {
            this.settings = await fs.readJson(expanded);
        }
        // See https://github.com/aws/aws-cdk/issues/59
        this.prohibitContextKey('default-account', fileName);
        this.prohibitContextKey('default-region', fileName);
        this.warnAboutContextKey('aws:', fileName);
        return this;
    }
    async save(fileName) {
        const expanded = expandHomeDir(fileName);
        await fs.writeJson(expanded, stripTransientValues(this.settings), { spaces: 2 });
        return this;
    }
    get all() {
        return this.get([]);
    }
    merge(other) {
        return new Settings(util.deepMerge(this.settings, other.settings));
    }
    subSettings(keyPrefix) {
        return new Settings(this.get(keyPrefix) || {}, false);
    }
    makeReadOnly() {
        return new Settings(this.settings, true);
    }
    clear() {
        if (this.readOnly) {
            throw new Error('Cannot clear(): settings are readonly');
        }
        this.settings = {};
    }
    get empty() {
        return Object.keys(this.settings).length === 0;
    }
    get(path) {
        return util.deepClone(util.deepGet(this.settings, path));
    }
    set(path, value) {
        if (this.readOnly) {
            throw new Error(`Can't set ${path}: settings object is readonly`);
        }
        if (path.length === 0) {
            // deepSet can't handle this case
            this.settings = value;
        }
        else {
            util.deepSet(this.settings, path, value);
        }
        return this;
    }
    unset(path) {
        this.set(path, undefined);
    }
    prohibitContextKey(key, fileName) {
        if (!this.settings.context) {
            return;
        }
        if (key in this.settings.context) {
            // eslint-disable-next-line max-len
            throw new Error(`The 'context.${key}' key was found in ${fs_path.resolve(fileName)}, but it is no longer supported. Please remove it.`);
        }
    }
    warnAboutContextKey(prefix, fileName) {
        if (!this.settings.context) {
            return;
        }
        for (const contextKey of Object.keys(this.settings.context)) {
            if (contextKey.startsWith(prefix)) {
                // eslint-disable-next-line max-len
                (0, logging_1.warning)(`A reserved context key ('context.${prefix}') key was found in ${fs_path.resolve(fileName)}, it might cause surprising behavior and should be removed.`);
            }
        }
    }
}
exports.Settings = Settings;
function expandHomeDir(x) {
    if (x.startsWith('~')) {
        return fs_path.join(os.homedir(), x.slice(1));
    }
    return x;
}
/**
 * Return all context value that are not transient context values
 */
function stripTransientValues(obj) {
    const ret = {};
    for (const [key, value] of Object.entries(obj)) {
        if (!isTransientValue(value)) {
            ret[key] = value;
        }
    }
    return ret;
}
/**
 * Return whether the given value is a transient context value
 *
 * Values that are objects with a magic key set to a truthy value are considered transient.
 */
function isTransientValue(value) {
    return typeof value === 'object' && value !== null && value[exports.TRANSIENT_CONTEXT_KEY];
}
function expectStringList(x) {
    if (x === undefined) {
        return undefined;
    }
    if (!Array.isArray(x)) {
        throw new Error(`Expected array, got '${x}'`);
    }
    const nonStrings = x.filter(e => typeof e !== 'string');
    if (nonStrings.length > 0) {
        throw new Error(`Expected list of strings, found ${nonStrings}`);
    }
    return x;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2V0dGluZ3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzZXR0aW5ncy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx5QkFBeUI7QUFDekIsZ0NBQWdDO0FBQ2hDLCtCQUErQjtBQUUvQix1Q0FBMkM7QUFDM0MsK0JBQStCO0FBSWxCLFFBQUEsY0FBYyxHQUFHLFVBQVUsQ0FBQztBQUM1QixRQUFBLGVBQWUsR0FBRyxrQkFBa0IsQ0FBQztBQUNyQyxRQUFBLGFBQWEsR0FBRyxhQUFhLENBQUM7QUFFM0M7O0dBRUc7QUFDVSxRQUFBLHFCQUFxQixHQUFHLGtCQUFrQixDQUFDO0FBRXhELE1BQU0sV0FBVyxHQUFHLFNBQVMsQ0FBQztBQUU5QixJQUFZLE9BYVg7QUFiRCxXQUFZLE9BQU87SUFDakIsb0JBQVMsQ0FBQTtJQUNULHdCQUFhLENBQUE7SUFDYix3QkFBYSxDQUFBO0lBQ2Isa0NBQXVCLENBQUE7SUFDdkIsNEJBQWlCLENBQUE7SUFDakIsOEJBQW1CLENBQUE7SUFDbkIsb0NBQXlCLENBQUE7SUFDekIsMEJBQWUsQ0FBQTtJQUNmLGdDQUFxQixDQUFBO0lBQ3JCLHdCQUFhLENBQUE7SUFDYiw4QkFBbUIsQ0FBQTtJQUNuQiwwQkFBZSxDQUFBO0FBQ2pCLENBQUMsRUFiVyxPQUFPLHVCQUFQLE9BQU8sUUFhbEI7QUFFRCxNQUFNLGlCQUFpQixHQUFHO0lBQ3hCLE9BQU8sQ0FBQyxNQUFNO0lBQ2QsT0FBTyxDQUFDLElBQUk7SUFDWixPQUFPLENBQUMsS0FBSztJQUNiLE9BQU8sQ0FBQyxVQUFVO0lBQ2xCLE9BQU8sQ0FBQyxLQUFLO0NBQ2QsQ0FBQztBQTBCRjs7R0FFRztBQUNILE1BQWEsYUFBYTtJQWlCeEIsWUFBNkIsUUFBNEIsRUFBRTtRQUE5QixVQUFLLEdBQUwsS0FBSyxDQUF5QjtRQWhCcEQsYUFBUSxHQUFHLElBQUksUUFBUSxFQUFFLENBQUM7UUFDMUIsWUFBTyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUM7UUFFZixrQkFBYSxHQUFHLElBQUksUUFBUSxDQUFDO1lBQzNDLGdCQUFnQixFQUFFLElBQUk7WUFDdEIsYUFBYSxFQUFFLElBQUk7WUFDbkIsWUFBWSxFQUFFLElBQUk7WUFDbEIsTUFBTSxFQUFFLFNBQVM7U0FDbEIsQ0FBQyxDQUFDO1FBTUssV0FBTSxHQUFHLEtBQUssQ0FBQztRQUdyQixJQUFJLENBQUMsb0JBQW9CLEdBQUcsS0FBSyxDQUFDLG9CQUFvQjtZQUNwRCxDQUFDLENBQUMsUUFBUSxDQUFDLHdCQUF3QixDQUFDLEtBQUssQ0FBQyxvQkFBb0IsQ0FBQztZQUMvRCxDQUFDLENBQUMsSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUNuQixJQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxDQUFDLG9CQUFvQixDQUFDLFdBQVcsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsWUFBWSxFQUFFLENBQUM7SUFDaEcsQ0FBQztJQUVELElBQVksYUFBYTtRQUN2QixJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3pCLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0NBQWdDLENBQUMsQ0FBQztRQUNwRCxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUMsY0FBYyxDQUFDO0lBQzdCLENBQUM7SUFFRCxJQUFZLGNBQWM7UUFDeEIsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLGdDQUFnQyxDQUFDLENBQUM7UUFDcEQsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLGVBQWUsQ0FBQztJQUM5QixDQUFDO0lBRUQ7O09BRUc7SUFDSSxLQUFLLENBQUMsSUFBSTtRQUNmLE1BQU0sVUFBVSxHQUFHLE1BQU0sVUFBVSxDQUFDLHFCQUFhLENBQUMsQ0FBQztRQUNuRCxJQUFJLENBQUMsY0FBYyxHQUFHLE1BQU0sVUFBVSxDQUFDLHNCQUFjLENBQUMsQ0FBQztRQUN2RCxJQUFJLENBQUMsZUFBZSxHQUFHLE1BQU0sVUFBVSxDQUFDLHVCQUFlLENBQUMsQ0FBQztRQUV6RCxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLGVBQWUsSUFBSSxJQUFJLENBQUM7UUFFM0QsSUFBSSxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQzlCLE1BQU0sSUFBSSxLQUFLLENBQUMsMkhBQTJILENBQUMsQ0FBQztRQUMvSSxDQUFDO1FBRUQsTUFBTSxjQUFjLEdBQUc7WUFDckIsSUFBSSxDQUFDLGtCQUFrQjtZQUN2QixJQUFJLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsWUFBWSxFQUFFO1lBQzVELElBQUksQ0FBQyxjQUFjO1NBQ3BCLENBQUM7UUFDRixJQUFJLGVBQWUsRUFBRSxDQUFDO1lBQ3BCLGNBQWMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsWUFBWSxFQUFFLENBQUMsQ0FBQztRQUM1RSxDQUFDO1FBRUQsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLE9BQU8sQ0FBQyxHQUFHLGNBQWMsQ0FBQyxDQUFDO1FBRTlDLGtDQUFrQztRQUNsQyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxhQUFhO2FBQy9CLEtBQUssQ0FBQyxVQUFVLENBQUM7YUFDakIsS0FBSyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUM7YUFDekIsS0FBSyxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQzthQUNoQyxZQUFZLEVBQUUsQ0FBQztRQUVsQixJQUFBLGVBQUssRUFBQyxrQkFBa0IsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBRTdDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO1FBRW5CLE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUVEOztPQUVHO0lBQ0ksS0FBSyxDQUFDLFdBQVc7UUFDdEIsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUFDLE9BQU8sSUFBSSxDQUFDO1FBQUMsQ0FBQyxDQUFDLHVDQUF1QztRQUUxRSxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLHVCQUFlLENBQUMsQ0FBQztRQUVoRCxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7Q0FDRjtBQXZGRCxzQ0F1RkM7QUFFRCxLQUFLLFVBQVUsVUFBVSxDQUFDLFFBQWdCO0lBQ3hDLE1BQU0sR0FBRyxHQUFHLElBQUksUUFBUSxFQUFFLENBQUM7SUFDM0IsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3pCLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDZixJQUFBLGVBQUssRUFBQyxRQUFRLEdBQUcsR0FBRyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUMvRCxDQUFDO0lBQ0QsT0FBTyxHQUFHLENBQUM7QUFDYixDQUFDO0FBRUQ7Ozs7Ozs7R0FPRztBQUNILE1BQWEsT0FBTztJQUdsQixZQUFZLEdBQUcsSUFBZ0I7UUFDN0IsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksUUFBUSxFQUFFLENBQUMsQ0FBQztJQUN4RCxDQUFDO0lBRUQsSUFBVyxJQUFJO1FBQ2IsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUMvQixDQUFDO0lBRU0sR0FBRyxDQUFDLEdBQVc7UUFDcEIsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztJQUNyQyxDQUFDO0lBRUQsSUFBVyxHQUFHO1FBQ1osSUFBSSxHQUFHLEdBQUcsSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUV6QiwyRUFBMkU7UUFDM0UsS0FBSyxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUM7WUFDM0MsR0FBRyxHQUFHLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDdkIsQ0FBQztRQUVELE9BQU8sR0FBRyxDQUFDLEdBQUcsQ0FBQztJQUNqQixDQUFDO0lBRU0sR0FBRyxDQUFDLEdBQVc7UUFDcEIsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDNUIsTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7WUFDekIsSUFBSSxDQUFDLEtBQUssU0FBUyxFQUFFLENBQUM7Z0JBQUMsT0FBTyxDQUFDLENBQUM7WUFBQyxDQUFDO1FBQ3BDLENBQUM7UUFDRCxPQUFPLFNBQVMsQ0FBQztJQUNuQixDQUFDO0lBRU0sR0FBRyxDQUFDLEdBQVcsRUFBRSxLQUFVO1FBQ2hDLEtBQUssTUFBTSxHQUFHLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQzVCLElBQUksR0FBRyxDQUFDLFFBQVEsRUFBRSxDQUFDO2dCQUFDLFNBQVM7WUFBQyxDQUFDO1lBRS9CLG9EQUFvRDtZQUNwRCxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDdEIsS0FBSyxHQUFHLFNBQVMsQ0FBQztRQUNwQixDQUFDO0lBQ0gsQ0FBQztJQUVNLEtBQUssQ0FBQyxHQUFXO1FBQ3RCLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQzNCLENBQUM7SUFFTSxLQUFLO1FBQ1YsS0FBSyxNQUFNLEdBQUcsSUFBSSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDNUIsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNsQixDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBckRELDBCQXFEQztBQUVEOztHQUVHO0FBQ0gsTUFBYSxRQUFRO0lBQ25COzs7Ozs7Ozs7Ozs7T0FZRztJQUNJLE1BQU0sQ0FBQyx3QkFBd0IsQ0FBQyxJQUFlO1FBQ3BELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyw4QkFBOEIsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUMxRCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsMkJBQTJCLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFFM0UsNEJBQTRCO1FBQzVCLElBQUksY0FBd0IsQ0FBQztRQUM3QixJQUFJLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztZQUM1QywwRUFBMEU7WUFDMUUsaUNBQWlDO1lBQy9CLGNBQWMsR0FBRyxJQUFJLENBQUMsV0FBVztnQkFDL0IsQ0FBQyxDQUFDLElBQUksQ0FBQyxNQUFNLElBQUksQ0FBQyxJQUFJLENBQUM7Z0JBQ3ZCLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ2IsQ0FBQzthQUFNLENBQUMsQ0FBQywrQkFBK0I7WUFDdEMsY0FBYyxHQUFHLEVBQUUsQ0FBQztRQUN0QixDQUFDO1FBRUQsT0FBTyxJQUFJLFFBQVEsQ0FBQztZQUNsQixHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUc7WUFDYixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDckIsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLO1lBQ2pCLE9BQU87WUFDUCxLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUs7WUFDakIsSUFBSTtZQUNKLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtZQUN2QixZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVk7WUFDL0IsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhO1lBQ2pDLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTztZQUNyQixNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDbkIsZUFBZSxFQUFFLElBQUksQ0FBQyxlQUFlO1lBQ3JDLGdCQUFnQixFQUFFLElBQUksQ0FBQyxnQkFBZ0I7WUFDdkMsYUFBYSxFQUFFO2dCQUNiLFVBQVUsRUFBRSxJQUFJLENBQUMsbUJBQW1CO2dCQUNwQyxRQUFRLEVBQUUsSUFBSSxDQUFDLGlCQUFpQjthQUNqQztZQUNELGdCQUFnQixFQUFFLElBQUksQ0FBQyxnQkFBZ0I7WUFDdkMsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ3JCLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtZQUNuQixXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVc7WUFDN0IsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRO1lBQ3ZCLGNBQWM7WUFDZCxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDckIsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRO1lBQ3ZCLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTztZQUNyQixnQkFBZ0IsRUFBRSxJQUFJLENBQUMsbUJBQW1CLENBQUM7WUFDM0MsYUFBYSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQztZQUNyQyxjQUFjLEVBQUUsSUFBSSxDQUFDLGtCQUFrQixDQUFDO1lBQ3hDLE9BQU8sRUFBRTtnQkFDUCxHQUFHLEVBQUU7b0JBQ0gsd0JBQXdCLEVBQUUsSUFBSSxDQUFDLHdCQUF3QjtvQkFDdkQsd0JBQXdCLEVBQUUsSUFBSSxDQUFDLHdCQUF3QjtpQkFDeEQ7YUFDRjtZQUNELFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUTtTQUN4QixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRU0sTUFBTSxDQUFDLFFBQVEsQ0FBQyxHQUFHLFFBQW9CO1FBQzVDLElBQUksR0FBRyxHQUFHLElBQUksUUFBUSxFQUFFLENBQUM7UUFDekIsS0FBSyxNQUFNLE9BQU8sSUFBSSxRQUFRLEVBQUUsQ0FBQztZQUMvQixHQUFHLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUMzQixDQUFDO1FBQ0QsT0FBTyxHQUFHLENBQUM7SUFDYixDQUFDO0lBRU8sTUFBTSxDQUFDLDhCQUE4QixDQUFDLElBQWU7UUFDM0QsTUFBTSxPQUFPLEdBQVEsRUFBRSxDQUFDO1FBRXhCLEtBQUssTUFBTSxVQUFVLElBQUksQ0FBRSxJQUFZLENBQUMsT0FBTyxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7WUFDdkQsTUFBTSxLQUFLLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDM0MsSUFBSSxLQUFLLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO2dCQUN2QixJQUFBLGVBQUssRUFBQyw2QkFBNkIsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3pELElBQUksS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO29CQUM5QixNQUFNLElBQUksS0FBSyxDQUFDLG1FQUFtRSxLQUFLLENBQUMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUM7Z0JBQy9HLENBQUM7Z0JBQ0QsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUMvQixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sSUFBQSxpQkFBTyxFQUFDLHVEQUF1RCxFQUFFLFVBQVUsQ0FBQyxDQUFDO1lBQy9FLENBQUM7UUFDSCxDQUFDO1FBQ0QsT0FBTyxPQUFPLENBQUM7SUFDakIsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0ssTUFBTSxDQUFDLDJCQUEyQixDQUFDLE9BQTZCO1FBQ3RFLElBQUksT0FBTyxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQUMsT0FBTyxTQUFTLENBQUM7UUFBQyxDQUFDO1FBQ2hELElBQUksT0FBTyxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUFDLE9BQU8sU0FBUyxDQUFDO1FBQUMsQ0FBQztRQUMvQyxNQUFNLFlBQVksR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDO1FBQ25ELElBQUksWUFBWSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUFDLE9BQU8sRUFBRSxDQUFDO1FBQUMsQ0FBQztRQUU3QyxNQUFNLElBQUksR0FBVSxFQUFFLENBQUM7UUFFdkIsS0FBSyxNQUFNLFVBQVUsSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUN0QyxNQUFNLEtBQUssR0FBRyxVQUFVLENBQUMsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUMsQ0FBQztZQUMzQyxJQUFJLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZCLElBQUEsZUFBSyxFQUFDLDBCQUEwQixFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDdEQsSUFBSSxDQUFDLElBQUksQ0FBQztvQkFDUixHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztvQkFDYixLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztpQkFDaEIsQ0FBQyxDQUFDO1lBQ0wsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLElBQUEsaUJBQU8sRUFBQyxvREFBb0QsRUFBRSxVQUFVLENBQUMsQ0FBQztZQUM1RSxDQUFDO1FBQ0gsQ0FBQztRQUNELE9BQU8sSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO0lBQzVDLENBQUM7SUFFRCxZQUFvQixXQUF3QixFQUFFLEVBQWtCLFdBQVcsS0FBSztRQUE1RCxhQUFRLEdBQVIsUUFBUSxDQUFrQjtRQUFrQixhQUFRLEdBQVIsUUFBUSxDQUFRO0lBQUcsQ0FBQztJQUU3RSxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQWdCO1FBQ2hDLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2xCLE1BQU0sSUFBSSxLQUFLLENBQUMsY0FBYyxRQUFRLCtCQUErQixDQUFDLENBQUM7UUFDekUsQ0FBQztRQUNELElBQUksQ0FBQyxRQUFRLEdBQUcsRUFBRSxDQUFDO1FBRW5CLE1BQU0sUUFBUSxHQUFHLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUN6QyxJQUFJLE1BQU0sRUFBRSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO1lBQ2xDLElBQUksQ0FBQyxRQUFRLEdBQUcsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQzlDLENBQUM7UUFFRCwrQ0FBK0M7UUFDL0MsSUFBSSxDQUFDLGtCQUFrQixDQUFDLGlCQUFpQixFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQ3JELElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxnQkFBZ0IsRUFBRSxRQUFRLENBQUMsQ0FBQztRQUNwRCxJQUFJLENBQUMsbUJBQW1CLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBRTNDLE9BQU8sSUFBSSxDQUFDO0lBQ2QsQ0FBQztJQUVNLEtBQUssQ0FBQyxJQUFJLENBQUMsUUFBZ0I7UUFDaEMsTUFBTSxRQUFRLEdBQUcsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ3pDLE1BQU0sRUFBRSxDQUFDLFNBQVMsQ0FBQyxRQUFRLEVBQUUsb0JBQW9CLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxFQUFFLEVBQUUsTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDakYsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsSUFBVyxHQUFHO1FBQ1osT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3RCLENBQUM7SUFFTSxLQUFLLENBQUMsS0FBZTtRQUMxQixPQUFPLElBQUksUUFBUSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztJQUNyRSxDQUFDO0lBRU0sV0FBVyxDQUFDLFNBQW1CO1FBQ3BDLE9BQU8sSUFBSSxRQUFRLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDeEQsQ0FBQztJQUVNLFlBQVk7UUFDakIsT0FBTyxJQUFJLFFBQVEsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQzNDLENBQUM7SUFFTSxLQUFLO1FBQ1YsSUFBSSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDbEIsTUFBTSxJQUFJLEtBQUssQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDO1FBQzNELENBQUM7UUFDRCxJQUFJLENBQUMsUUFBUSxHQUFHLEVBQUUsQ0FBQztJQUNyQixDQUFDO0lBRUQsSUFBVyxLQUFLO1FBQ2QsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFDO0lBQ2pELENBQUM7SUFFTSxHQUFHLENBQUMsSUFBYztRQUN2QixPQUFPLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDM0QsQ0FBQztJQUVNLEdBQUcsQ0FBQyxJQUFjLEVBQUUsS0FBVTtRQUNuQyxJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNsQixNQUFNLElBQUksS0FBSyxDQUFDLGFBQWEsSUFBSSwrQkFBK0IsQ0FBQyxDQUFDO1FBQ3BFLENBQUM7UUFDRCxJQUFJLElBQUksQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDdEIsaUNBQWlDO1lBQ2pDLElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDO1FBQ3hCLENBQUM7YUFBTSxDQUFDO1lBQ04sSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztRQUMzQyxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRU0sS0FBSyxDQUFDLElBQWM7UUFDekIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFDNUIsQ0FBQztJQUVPLGtCQUFrQixDQUFDLEdBQVcsRUFBRSxRQUFnQjtRQUN0RCxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUFDLE9BQU87UUFBQyxDQUFDO1FBQ3ZDLElBQUksR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDakMsbUNBQW1DO1lBQ25DLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0JBQWdCLEdBQUcsc0JBQXNCLE9BQU8sQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLG9EQUFvRCxDQUFDLENBQUM7UUFDMUksQ0FBQztJQUNILENBQUM7SUFFTyxtQkFBbUIsQ0FBQyxNQUFjLEVBQUUsUUFBZ0I7UUFDMUQsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUM7WUFBQyxPQUFPO1FBQUMsQ0FBQztRQUN2QyxLQUFLLE1BQU0sVUFBVSxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQzVELElBQUksVUFBVSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO2dCQUNsQyxtQ0FBbUM7Z0JBQ25DLElBQUEsaUJBQU8sRUFBQyxvQ0FBb0MsTUFBTSx1QkFBdUIsT0FBTyxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsNkRBQTZELENBQUMsQ0FBQztZQUNuSyxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7Q0FDRjtBQXpORCw0QkF5TkM7QUFFRCxTQUFTLGFBQWEsQ0FBQyxDQUFTO0lBQzlCLElBQUksQ0FBQyxDQUFDLFVBQVUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ3RCLE9BQU8sT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ2hELENBQUM7SUFDRCxPQUFPLENBQUMsQ0FBQztBQUNYLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsb0JBQW9CLENBQUMsR0FBeUI7SUFDckQsTUFBTSxHQUFHLEdBQVEsRUFBRSxDQUFDO0lBQ3BCLEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDL0MsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDN0IsR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEtBQUssQ0FBQztRQUNuQixDQUFDO0lBQ0gsQ0FBQztJQUNELE9BQU8sR0FBRyxDQUFDO0FBQ2IsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGdCQUFnQixDQUFDLEtBQVU7SUFDbEMsT0FBTyxPQUFPLEtBQUssS0FBSyxRQUFRLElBQUksS0FBSyxLQUFLLElBQUksSUFBSyxLQUFhLENBQUMsNkJBQXFCLENBQUMsQ0FBQztBQUM5RixDQUFDO0FBRUQsU0FBUyxnQkFBZ0IsQ0FBQyxDQUFVO0lBQ2xDLElBQUksQ0FBQyxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQUMsT0FBTyxTQUFTLENBQUM7SUFBQyxDQUFDO0lBQzFDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDdEIsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNoRCxDQUFDO0lBQ0QsTUFBTSxVQUFVLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxLQUFLLFFBQVEsQ0FBQyxDQUFDO0lBQ3hELElBQUksVUFBVSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUMxQixNQUFNLElBQUksS0FBSyxDQUFDLG1DQUFtQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO0lBQ25FLENBQUM7SUFDRCxPQUFPLENBQUMsQ0FBQztBQUNYLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBvcyBmcm9tICdvcyc7XG5pbXBvcnQgKiBhcyBmc19wYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0IHsgVGFnIH0gZnJvbSAnLi9jZGstdG9vbGtpdCc7XG5pbXBvcnQgeyBkZWJ1Zywgd2FybmluZyB9IGZyb20gJy4vbG9nZ2luZyc7XG5pbXBvcnQgKiBhcyB1dGlsIGZyb20gJy4vdXRpbCc7XG5cbmV4cG9ydCB0eXBlIFNldHRpbmdzTWFwID0ge1trZXk6IHN0cmluZ106IGFueX07XG5cbmV4cG9ydCBjb25zdCBQUk9KRUNUX0NPTkZJRyA9ICdjZGsuanNvbic7XG5leHBvcnQgY29uc3QgUFJPSkVDVF9DT05URVhUID0gJ2Nkay5jb250ZXh0Lmpzb24nO1xuZXhwb3J0IGNvbnN0IFVTRVJfREVGQVVMVFMgPSAnfi8uY2RrLmpzb24nO1xuXG4vKipcbiAqIElmIGEgY29udGV4dCB2YWx1ZSBpcyBhbiBvYmplY3Qgd2l0aCB0aGlzIGtleSBzZXQgdG8gYSB0cnV0aHkgdmFsdWUsIGl0IHdvbid0IGJlIHNhdmVkIHRvIGNkay5jb250ZXh0Lmpzb25cbiAqL1xuZXhwb3J0IGNvbnN0IFRSQU5TSUVOVF9DT05URVhUX0tFWSA9ICckZG9udFNhdmVDb250ZXh0JztcblxuY29uc3QgQ09OVEVYVF9LRVkgPSAnY29udGV4dCc7XG5cbmV4cG9ydCBlbnVtIENvbW1hbmQge1xuICBMUyA9ICdscycsXG4gIExJU1QgPSAnbGlzdCcsXG4gIERJRkYgPSAnZGlmZicsXG4gIEJPT1RTVFJBUCA9ICdib290c3RyYXAnLFxuICBERVBMT1kgPSAnZGVwbG95JyxcbiAgREVTVFJPWSA9ICdkZXN0cm95JyxcbiAgU1lOVEhFU0laRSA9ICdzeW50aGVzaXplJyxcbiAgU1lOVEggPSAnc3ludGgnLFxuICBNRVRBREFUQSA9ICdtZXRhZGF0YScsXG4gIElOSVQgPSAnaW5pdCcsXG4gIFZFUlNJT04gPSAndmVyc2lvbicsXG4gIFdBVENIID0gJ3dhdGNoJyxcbn1cblxuY29uc3QgQlVORExJTkdfQ09NTUFORFMgPSBbXG4gIENvbW1hbmQuREVQTE9ZLFxuICBDb21tYW5kLkRJRkYsXG4gIENvbW1hbmQuU1lOVEgsXG4gIENvbW1hbmQuU1lOVEhFU0laRSxcbiAgQ29tbWFuZC5XQVRDSCxcbl07XG5cbmV4cG9ydCB0eXBlIEFyZ3VtZW50cyA9IHtcbiAgcmVhZG9ubHkgXzogW0NvbW1hbmQsIC4uLnN0cmluZ1tdXTtcbiAgcmVhZG9ubHkgZXhjbHVzaXZlbHk/OiBib29sZWFuO1xuICByZWFkb25seSBTVEFDS1M/OiBzdHJpbmdbXTtcbiAgcmVhZG9ubHkgbG9va3Vwcz86IGJvb2xlYW47XG4gIHJlYWRvbmx5IFtuYW1lOiBzdHJpbmddOiB1bmtub3duO1xufTtcblxuZXhwb3J0IGludGVyZmFjZSBDb25maWd1cmF0aW9uUHJvcHMge1xuICAvKipcbiAgICogQ29uZmlndXJhdGlvbiBwYXNzZWQgdmlhIGNvbW1hbmQgbGluZSBhcmd1bWVudHNcbiAgICpcbiAgICogQGRlZmF1bHQgLSBOb3RoaW5nIHBhc3NlZFxuICAgKi9cbiAgcmVhZG9ubHkgY29tbWFuZExpbmVBcmd1bWVudHM/OiBBcmd1bWVudHM7XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgb3Igbm90IHRvIHVzZSBjb250ZXh0IGZyb20gYC5jZGsuanNvbmAgaW4gdXNlciBob21lIGRpcmVjdG9yeVxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICByZWFkb25seSByZWFkVXNlckNvbnRleHQ/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIEFsbCBzb3VyY2VzIG9mIHNldHRpbmdzIGNvbWJpbmVkXG4gKi9cbmV4cG9ydCBjbGFzcyBDb25maWd1cmF0aW9uIHtcbiAgcHVibGljIHNldHRpbmdzID0gbmV3IFNldHRpbmdzKCk7XG4gIHB1YmxpYyBjb250ZXh0ID0gbmV3IENvbnRleHQoKTtcblxuICBwdWJsaWMgcmVhZG9ubHkgZGVmYXVsdENvbmZpZyA9IG5ldyBTZXR0aW5ncyh7XG4gICAgdmVyc2lvblJlcG9ydGluZzogdHJ1ZSxcbiAgICBhc3NldE1ldGFkYXRhOiB0cnVlLFxuICAgIHBhdGhNZXRhZGF0YTogdHJ1ZSxcbiAgICBvdXRwdXQ6ICdjZGsub3V0JyxcbiAgfSk7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBjb21tYW5kTGluZUFyZ3VtZW50czogU2V0dGluZ3M7XG4gIHByaXZhdGUgcmVhZG9ubHkgY29tbWFuZExpbmVDb250ZXh0OiBTZXR0aW5ncztcbiAgcHJpdmF0ZSBfcHJvamVjdENvbmZpZz86IFNldHRpbmdzO1xuICBwcml2YXRlIF9wcm9qZWN0Q29udGV4dD86IFNldHRpbmdzO1xuICBwcml2YXRlIGxvYWRlZCA9IGZhbHNlO1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgcHJvcHM6IENvbmZpZ3VyYXRpb25Qcm9wcyA9IHt9KSB7XG4gICAgdGhpcy5jb21tYW5kTGluZUFyZ3VtZW50cyA9IHByb3BzLmNvbW1hbmRMaW5lQXJndW1lbnRzXG4gICAgICA/IFNldHRpbmdzLmZyb21Db21tYW5kTGluZUFyZ3VtZW50cyhwcm9wcy5jb21tYW5kTGluZUFyZ3VtZW50cylcbiAgICAgIDogbmV3IFNldHRpbmdzKCk7XG4gICAgdGhpcy5jb21tYW5kTGluZUNvbnRleHQgPSB0aGlzLmNvbW1hbmRMaW5lQXJndW1lbnRzLnN1YlNldHRpbmdzKFtDT05URVhUX0tFWV0pLm1ha2VSZWFkT25seSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXQgcHJvamVjdENvbmZpZygpIHtcbiAgICBpZiAoIXRoaXMuX3Byb2plY3RDb25maWcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignI2xvYWQgaGFzIG5vdCBiZWVuIGNhbGxlZCB5ZXQhJyk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLl9wcm9qZWN0Q29uZmlnO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXQgcHJvamVjdENvbnRleHQoKSB7XG4gICAgaWYgKCF0aGlzLl9wcm9qZWN0Q29udGV4dCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCcjbG9hZCBoYXMgbm90IGJlZW4gY2FsbGVkIHlldCEnKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX3Byb2plY3RDb250ZXh0O1xuICB9XG5cbiAgLyoqXG4gICAqIExvYWQgYWxsIGNvbmZpZ1xuICAgKi9cbiAgcHVibGljIGFzeW5jIGxvYWQoKTogUHJvbWlzZTx0aGlzPiB7XG4gICAgY29uc3QgdXNlckNvbmZpZyA9IGF3YWl0IGxvYWRBbmRMb2coVVNFUl9ERUZBVUxUUyk7XG4gICAgdGhpcy5fcHJvamVjdENvbmZpZyA9IGF3YWl0IGxvYWRBbmRMb2coUFJPSkVDVF9DT05GSUcpO1xuICAgIHRoaXMuX3Byb2plY3RDb250ZXh0ID0gYXdhaXQgbG9hZEFuZExvZyhQUk9KRUNUX0NPTlRFWFQpO1xuXG4gICAgY29uc3QgcmVhZFVzZXJDb250ZXh0ID0gdGhpcy5wcm9wcy5yZWFkVXNlckNvbnRleHQgPz8gdHJ1ZTtcblxuICAgIGlmICh1c2VyQ29uZmlnLmdldChbJ2J1aWxkJ10pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoZSBgYnVpbGRgIGtleSBjYW5ub3QgYmUgc3BlY2lmaWVkIGluIHRoZSB1c2VyIGNvbmZpZyAofi8uY2RrLmpzb24pLCBzcGVjaWZ5IGl0IGluIHRoZSBwcm9qZWN0IGNvbmZpZyAoY2RrLmpzb24pIGluc3RlYWQnKTtcbiAgICB9XG5cbiAgICBjb25zdCBjb250ZXh0U291cmNlcyA9IFtcbiAgICAgIHRoaXMuY29tbWFuZExpbmVDb250ZXh0LFxuICAgICAgdGhpcy5wcm9qZWN0Q29uZmlnLnN1YlNldHRpbmdzKFtDT05URVhUX0tFWV0pLm1ha2VSZWFkT25seSgpLFxuICAgICAgdGhpcy5wcm9qZWN0Q29udGV4dCxcbiAgICBdO1xuICAgIGlmIChyZWFkVXNlckNvbnRleHQpIHtcbiAgICAgIGNvbnRleHRTb3VyY2VzLnB1c2godXNlckNvbmZpZy5zdWJTZXR0aW5ncyhbQ09OVEVYVF9LRVldKS5tYWtlUmVhZE9ubHkoKSk7XG4gICAgfVxuXG4gICAgdGhpcy5jb250ZXh0ID0gbmV3IENvbnRleHQoLi4uY29udGV4dFNvdXJjZXMpO1xuXG4gICAgLy8gQnVpbGQgc2V0dGluZ3MgZnJvbSB3aGF0J3MgbGVmdFxuICAgIHRoaXMuc2V0dGluZ3MgPSB0aGlzLmRlZmF1bHRDb25maWdcbiAgICAgIC5tZXJnZSh1c2VyQ29uZmlnKVxuICAgICAgLm1lcmdlKHRoaXMucHJvamVjdENvbmZpZylcbiAgICAgIC5tZXJnZSh0aGlzLmNvbW1hbmRMaW5lQXJndW1lbnRzKVxuICAgICAgLm1ha2VSZWFkT25seSgpO1xuXG4gICAgZGVidWcoJ21lcmdlZCBzZXR0aW5nczonLCB0aGlzLnNldHRpbmdzLmFsbCk7XG5cbiAgICB0aGlzLmxvYWRlZCA9IHRydWU7XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBTYXZlIHRoZSBwcm9qZWN0IGNvbnRleHRcbiAgICovXG4gIHB1YmxpYyBhc3luYyBzYXZlQ29udGV4dCgpOiBQcm9taXNlPHRoaXM+IHtcbiAgICBpZiAoIXRoaXMubG9hZGVkKSB7IHJldHVybiB0aGlzOyB9IC8vIEF2b2lkIG92ZXJ3cml0aW5nIGZpbGVzIHdpdGggbm90aGluZ1xuXG4gICAgYXdhaXQgdGhpcy5wcm9qZWN0Q29udGV4dC5zYXZlKFBST0pFQ1RfQ09OVEVYVCk7XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBsb2FkQW5kTG9nKGZpbGVOYW1lOiBzdHJpbmcpOiBQcm9taXNlPFNldHRpbmdzPiB7XG4gIGNvbnN0IHJldCA9IG5ldyBTZXR0aW5ncygpO1xuICBhd2FpdCByZXQubG9hZChmaWxlTmFtZSk7XG4gIGlmICghcmV0LmVtcHR5KSB7XG4gICAgZGVidWcoZmlsZU5hbWUgKyAnOicsIEpTT04uc3RyaW5naWZ5KHJldC5hbGwsIHVuZGVmaW5lZCwgMikpO1xuICB9XG4gIHJldHVybiByZXQ7XG59XG5cbi8qKlxuICogQ2xhc3MgdGhhdCBzdXBwb3J0cyBvdmVybGF5aW5nIHByb3BlcnR5IGJhZ3NcbiAqXG4gKiBSZWFkcyBjb21lIGZyb20gdGhlIGZpcnN0IHByb3BlcnR5IGJhZyB0aGF0IGNhbiBoYXMgdGhlIGdpdmVuIGtleSxcbiAqIHdyaXRlcyBnbyB0byB0aGUgZmlyc3QgcHJvcGVydHkgYmFnIHRoYXQgaXMgbm90IHJlYWRvbmx5LiBBIHdyaXRlXG4gKiB3aWxsIHJlbW92ZSB0aGUgdmFsdWUgZnJvbSBhbGwgcHJvcGVydHkgYmFncyBhZnRlciB0aGUgZmlyc3RcbiAqIHdyaXRhYmxlIG9uZS5cbiAqL1xuZXhwb3J0IGNsYXNzIENvbnRleHQge1xuICBwcml2YXRlIHJlYWRvbmx5IGJhZ3M6IFNldHRpbmdzW107XG5cbiAgY29uc3RydWN0b3IoLi4uYmFnczogU2V0dGluZ3NbXSkge1xuICAgIHRoaXMuYmFncyA9IGJhZ3MubGVuZ3RoID4gMCA/IGJhZ3MgOiBbbmV3IFNldHRpbmdzKCldO1xuICB9XG5cbiAgcHVibGljIGdldCBrZXlzKCk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5hbGwpO1xuICB9XG5cbiAgcHVibGljIGhhcyhrZXk6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLmtleXMuaW5kZXhPZihrZXkpID4gLTE7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGFsbCgpOiB7W2tleTogc3RyaW5nXTogYW55fSB7XG4gICAgbGV0IHJldCA9IG5ldyBTZXR0aW5ncygpO1xuXG4gICAgLy8gSW4gcmV2ZXJzZSBvcmRlciBzbyBrZXlzIHRvIHRoZSBsZWZ0IG92ZXJ3cml0ZSBrZXlzIHRvIHRoZSByaWdodCBvZiB0aGVtXG4gICAgZm9yIChjb25zdCBiYWcgb2YgWy4uLnRoaXMuYmFnc10ucmV2ZXJzZSgpKSB7XG4gICAgICByZXQgPSByZXQubWVyZ2UoYmFnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmV0LmFsbDtcbiAgfVxuXG4gIHB1YmxpYyBnZXQoa2V5OiBzdHJpbmcpOiBhbnkge1xuICAgIGZvciAoY29uc3QgYmFnIG9mIHRoaXMuYmFncykge1xuICAgICAgY29uc3QgdiA9IGJhZy5nZXQoW2tleV0pO1xuICAgICAgaWYgKHYgIT09IHVuZGVmaW5lZCkgeyByZXR1cm4gdjsgfVxuICAgIH1cbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgcHVibGljIHNldChrZXk6IHN0cmluZywgdmFsdWU6IGFueSkge1xuICAgIGZvciAoY29uc3QgYmFnIG9mIHRoaXMuYmFncykge1xuICAgICAgaWYgKGJhZy5yZWFkT25seSkgeyBjb250aW51ZTsgfVxuXG4gICAgICAvLyBBbGwgYmFncyBwYXN0IHRoZSBmaXJzdCBvbmUgaGF2ZSB0aGUgdmFsdWUgZXJhc2VkXG4gICAgICBiYWcuc2V0KFtrZXldLCB2YWx1ZSk7XG4gICAgICB2YWx1ZSA9IHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgdW5zZXQoa2V5OiBzdHJpbmcpIHtcbiAgICB0aGlzLnNldChrZXksIHVuZGVmaW5lZCk7XG4gIH1cblxuICBwdWJsaWMgY2xlYXIoKSB7XG4gICAgZm9yIChjb25zdCBrZXkgb2YgdGhpcy5rZXlzKSB7XG4gICAgICB0aGlzLnVuc2V0KGtleSk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQSBzaW5nbGUgYmFnIG9mIHNldHRpbmdzXG4gKi9cbmV4cG9ydCBjbGFzcyBTZXR0aW5ncyB7XG4gIC8qKlxuICAgKiBQYXJzZSBTZXR0aW5ncyBvdXQgb2YgQ0xJIGFyZ3VtZW50cy5cbiAgICpcbiAgICogQ0xJIGFyZ3VtZW50cyBpbiBtdXN0IGJlIGFjY2Vzc2VkIGluIHRoZSBDTEkgY29kZSB2aWFcbiAgICogYGNvbmZpZ3VyYXRpb24uc2V0dGluZ3MuZ2V0KFsnYXJnTmFtZSddKWAgaW5zdGVhZCBvZiB2aWEgYGFyZ3MuYXJnTmFtZWAuXG4gICAqXG4gICAqIFRoZSBhZHZhbnRhZ2UgaXMgdGhhdCB0aGV5IGNhbiBiZSBjb25maWd1cmVkIHZpYSBgY2RrLmpzb25gIGFuZFxuICAgKiBgJEhPTUUvLmNkay5qc29uYC4gQXJndW1lbnRzIG5vdCBsaXN0ZWQgYmVsb3cgYW5kIGFjY2Vzc2VkIHZpYSB0aGlzIG9iamVjdFxuICAgKiBjYW4gb25seSBiZSBzcGVjaWZpZWQgb24gdGhlIGNvbW1hbmQgbGluZS5cbiAgICpcbiAgICogQHBhcmFtIGFyZ3YgdGhlIHJlY2VpdmVkIENMSSBhcmd1bWVudHMuXG4gICAqIEByZXR1cm5zIGEgbmV3IFNldHRpbmdzIG9iamVjdC5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZnJvbUNvbW1hbmRMaW5lQXJndW1lbnRzKGFyZ3Y6IEFyZ3VtZW50cyk6IFNldHRpbmdzIHtcbiAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5wYXJzZVN0cmluZ0NvbnRleHRMaXN0VG9PYmplY3QoYXJndik7XG4gICAgY29uc3QgdGFncyA9IHRoaXMucGFyc2VTdHJpbmdUYWdzTGlzdFRvT2JqZWN0KGV4cGVjdFN0cmluZ0xpc3QoYXJndi50YWdzKSk7XG5cbiAgICAvLyBEZXRlcm1pbmUgYnVuZGxpbmcgc3RhY2tzXG4gICAgbGV0IGJ1bmRsaW5nU3RhY2tzOiBzdHJpbmdbXTtcbiAgICBpZiAoQlVORExJTkdfQ09NTUFORFMuaW5jbHVkZXMoYXJndi5fWzBdKSkge1xuICAgIC8vIElmIHdlIGRlcGxveSwgZGlmZiwgc3ludGggb3Igd2F0Y2ggYSBsaXN0IG9mIHN0YWNrcyBleGNsdXNpdmVseSB3ZSBza2lwXG4gICAgLy8gYnVuZGxpbmcgZm9yIGFsbCBvdGhlciBzdGFja3MuXG4gICAgICBidW5kbGluZ1N0YWNrcyA9IGFyZ3YuZXhjbHVzaXZlbHlcbiAgICAgICAgPyBhcmd2LlNUQUNLUyA/PyBbJyoqJ11cbiAgICAgICAgOiBbJyoqJ107XG4gICAgfSBlbHNlIHsgLy8gU2tpcCBidW5kbGluZyBmb3IgYWxsIHN0YWNrc1xuICAgICAgYnVuZGxpbmdTdGFja3MgPSBbXTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFNldHRpbmdzKHtcbiAgICAgIGFwcDogYXJndi5hcHAsXG4gICAgICBicm93c2VyOiBhcmd2LmJyb3dzZXIsXG4gICAgICBidWlsZDogYXJndi5idWlsZCxcbiAgICAgIGNvbnRleHQsXG4gICAgICBkZWJ1ZzogYXJndi5kZWJ1ZyxcbiAgICAgIHRhZ3MsXG4gICAgICBsYW5ndWFnZTogYXJndi5sYW5ndWFnZSxcbiAgICAgIHBhdGhNZXRhZGF0YTogYXJndi5wYXRoTWV0YWRhdGEsXG4gICAgICBhc3NldE1ldGFkYXRhOiBhcmd2LmFzc2V0TWV0YWRhdGEsXG4gICAgICBwcm9maWxlOiBhcmd2LnByb2ZpbGUsXG4gICAgICBwbHVnaW46IGFyZ3YucGx1Z2luLFxuICAgICAgcmVxdWlyZUFwcHJvdmFsOiBhcmd2LnJlcXVpcmVBcHByb3ZhbCxcbiAgICAgIHRvb2xraXRTdGFja05hbWU6IGFyZ3YudG9vbGtpdFN0YWNrTmFtZSxcbiAgICAgIHRvb2xraXRCdWNrZXQ6IHtcbiAgICAgICAgYnVja2V0TmFtZTogYXJndi5ib290c3RyYXBCdWNrZXROYW1lLFxuICAgICAgICBrbXNLZXlJZDogYXJndi5ib290c3RyYXBLbXNLZXlJZCxcbiAgICAgIH0sXG4gICAgICB2ZXJzaW9uUmVwb3J0aW5nOiBhcmd2LnZlcnNpb25SZXBvcnRpbmcsXG4gICAgICBzdGFnaW5nOiBhcmd2LnN0YWdpbmcsXG4gICAgICBvdXRwdXQ6IGFyZ3Yub3V0cHV0LFxuICAgICAgb3V0cHV0c0ZpbGU6IGFyZ3Yub3V0cHV0c0ZpbGUsXG4gICAgICBwcm9ncmVzczogYXJndi5wcm9ncmVzcyxcbiAgICAgIGJ1bmRsaW5nU3RhY2tzLFxuICAgICAgbG9va3VwczogYXJndi5sb29rdXBzLFxuICAgICAgcm9sbGJhY2s6IGFyZ3Yucm9sbGJhY2ssXG4gICAgICBub3RpY2VzOiBhcmd2Lm5vdGljZXMsXG4gICAgICBhc3NldFBhcmFsbGVsaXNtOiBhcmd2Wydhc3NldC1wYXJhbGxlbGlzbSddLFxuICAgICAgYXNzZXRQcmVidWlsZDogYXJndlsnYXNzZXQtcHJlYnVpbGQnXSxcbiAgICAgIGlnbm9yZU5vU3RhY2tzOiBhcmd2WydpZ25vcmUtbm8tc3RhY2tzJ10sXG4gICAgICBob3Rzd2FwOiB7XG4gICAgICAgIGVjczoge1xuICAgICAgICAgIG1pbmltdW1FY3NIZWFsdGh5UGVyY2VudDogYXJndi5taW5pbXVtRWNzSGVhbHRoeVBlcmNlbnQsXG4gICAgICAgICAgbWF4aW11bUVjc0hlYWx0aHlQZXJjZW50OiBhcmd2Lm1heGltdW1FY3NIZWFsdGh5UGVyY2VudCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICB1bnN0YWJsZTogYXJndi51bnN0YWJsZSxcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzdGF0aWMgbWVyZ2VBbGwoLi4uc2V0dGluZ3M6IFNldHRpbmdzW10pOiBTZXR0aW5ncyB7XG4gICAgbGV0IHJldCA9IG5ldyBTZXR0aW5ncygpO1xuICAgIGZvciAoY29uc3Qgc2V0dGluZyBvZiBzZXR0aW5ncykge1xuICAgICAgcmV0ID0gcmV0Lm1lcmdlKHNldHRpbmcpO1xuICAgIH1cbiAgICByZXR1cm4gcmV0O1xuICB9XG5cbiAgcHJpdmF0ZSBzdGF0aWMgcGFyc2VTdHJpbmdDb250ZXh0TGlzdFRvT2JqZWN0KGFyZ3Y6IEFyZ3VtZW50cyk6IGFueSB7XG4gICAgY29uc3QgY29udGV4dDogYW55ID0ge307XG5cbiAgICBmb3IgKGNvbnN0IGFzc2lnbm1lbnQgb2YgKChhcmd2IGFzIGFueSkuY29udGV4dCB8fCBbXSkpIHtcbiAgICAgIGNvbnN0IHBhcnRzID0gYXNzaWdubWVudC5zcGxpdCgvPSguKikvLCAyKTtcbiAgICAgIGlmIChwYXJ0cy5sZW5ndGggPT09IDIpIHtcbiAgICAgICAgZGVidWcoJ0NMSSBhcmd1bWVudCBjb250ZXh0OiAlcz0lcycsIHBhcnRzWzBdLCBwYXJ0c1sxXSk7XG4gICAgICAgIGlmIChwYXJ0c1swXS5tYXRjaCgvXmF3czouKy8pKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVc2VyLXByb3ZpZGVkIGNvbnRleHQgY2Fubm90IHVzZSBrZXlzIHByZWZpeGVkIHdpdGggJ2F3czonLCBidXQgJHtwYXJ0c1swXX0gd2FzIHByb3ZpZGVkLmApO1xuICAgICAgICB9XG4gICAgICAgIGNvbnRleHRbcGFydHNbMF1dID0gcGFydHNbMV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB3YXJuaW5nKCdDb250ZXh0IGFyZ3VtZW50IGlzIG5vdCBhbiBhc3NpZ25tZW50IChrZXk9dmFsdWUpOiAlcycsIGFzc2lnbm1lbnQpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gY29udGV4dDtcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZSB0YWdzIG91dCBvZiBhcmd1bWVudHNcbiAgICpcbiAgICogUmV0dXJuIHVuZGVmaW5lZCBpZiBubyB0YWdzIHdlcmUgcHJvdmlkZWQsIHJldHVybiBhbiBlbXB0eSBhcnJheSBpZiBvbmx5IGVtcHR5XG4gICAqIHN0cmluZ3Mgd2VyZSBwcm92aWRlZFxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgcGFyc2VTdHJpbmdUYWdzTGlzdFRvT2JqZWN0KGFyZ1RhZ3M6IHN0cmluZ1tdIHwgdW5kZWZpbmVkKTogVGFnW10gfCB1bmRlZmluZWQge1xuICAgIGlmIChhcmdUYWdzID09PSB1bmRlZmluZWQpIHsgcmV0dXJuIHVuZGVmaW5lZDsgfVxuICAgIGlmIChhcmdUYWdzLmxlbmd0aCA9PT0gMCkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gICAgY29uc3Qgbm9uRW1wdHlUYWdzID0gYXJnVGFncy5maWx0ZXIodCA9PiB0ICE9PSAnJyk7XG4gICAgaWYgKG5vbkVtcHR5VGFncy5sZW5ndGggPT09IDApIHsgcmV0dXJuIFtdOyB9XG5cbiAgICBjb25zdCB0YWdzOiBUYWdbXSA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBhc3NpZ25tZW50IG9mIG5vbkVtcHR5VGFncykge1xuICAgICAgY29uc3QgcGFydHMgPSBhc3NpZ25tZW50LnNwbGl0KC89KC4qKS8sIDIpO1xuICAgICAgaWYgKHBhcnRzLmxlbmd0aCA9PT0gMikge1xuICAgICAgICBkZWJ1ZygnQ0xJIGFyZ3VtZW50IHRhZ3M6ICVzPSVzJywgcGFydHNbMF0sIHBhcnRzWzFdKTtcbiAgICAgICAgdGFncy5wdXNoKHtcbiAgICAgICAgICBLZXk6IHBhcnRzWzBdLFxuICAgICAgICAgIFZhbHVlOiBwYXJ0c1sxXSxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB3YXJuaW5nKCdUYWdzIGFyZ3VtZW50IGlzIG5vdCBhbiBhc3NpZ25tZW50IChrZXk9dmFsdWUpOiAlcycsIGFzc2lnbm1lbnQpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdGFncy5sZW5ndGggPiAwID8gdGFncyA6IHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgc2V0dGluZ3M6IFNldHRpbmdzTWFwID0ge30sIHB1YmxpYyByZWFkb25seSByZWFkT25seSA9IGZhbHNlKSB7fVxuXG4gIHB1YmxpYyBhc3luYyBsb2FkKGZpbGVOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHRoaXM+IHtcbiAgICBpZiAodGhpcy5yZWFkT25seSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW4ndCBsb2FkICR7ZmlsZU5hbWV9OiBzZXR0aW5ncyBvYmplY3QgaXMgcmVhZG9ubHlgKTtcbiAgICB9XG4gICAgdGhpcy5zZXR0aW5ncyA9IHt9O1xuXG4gICAgY29uc3QgZXhwYW5kZWQgPSBleHBhbmRIb21lRGlyKGZpbGVOYW1lKTtcbiAgICBpZiAoYXdhaXQgZnMucGF0aEV4aXN0cyhleHBhbmRlZCkpIHtcbiAgICAgIHRoaXMuc2V0dGluZ3MgPSBhd2FpdCBmcy5yZWFkSnNvbihleHBhbmRlZCk7XG4gICAgfVxuXG4gICAgLy8gU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvYXdzLWNkay9pc3N1ZXMvNTlcbiAgICB0aGlzLnByb2hpYml0Q29udGV4dEtleSgnZGVmYXVsdC1hY2NvdW50JywgZmlsZU5hbWUpO1xuICAgIHRoaXMucHJvaGliaXRDb250ZXh0S2V5KCdkZWZhdWx0LXJlZ2lvbicsIGZpbGVOYW1lKTtcbiAgICB0aGlzLndhcm5BYm91dENvbnRleHRLZXkoJ2F3czonLCBmaWxlTmFtZSk7XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzYXZlKGZpbGVOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHRoaXM+IHtcbiAgICBjb25zdCBleHBhbmRlZCA9IGV4cGFuZEhvbWVEaXIoZmlsZU5hbWUpO1xuICAgIGF3YWl0IGZzLndyaXRlSnNvbihleHBhbmRlZCwgc3RyaXBUcmFuc2llbnRWYWx1ZXModGhpcy5zZXR0aW5ncyksIHsgc3BhY2VzOiAyIH0pO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgcHVibGljIGdldCBhbGwoKTogYW55IHtcbiAgICByZXR1cm4gdGhpcy5nZXQoW10pO1xuICB9XG5cbiAgcHVibGljIG1lcmdlKG90aGVyOiBTZXR0aW5ncyk6IFNldHRpbmdzIHtcbiAgICByZXR1cm4gbmV3IFNldHRpbmdzKHV0aWwuZGVlcE1lcmdlKHRoaXMuc2V0dGluZ3MsIG90aGVyLnNldHRpbmdzKSk7XG4gIH1cblxuICBwdWJsaWMgc3ViU2V0dGluZ3Moa2V5UHJlZml4OiBzdHJpbmdbXSkge1xuICAgIHJldHVybiBuZXcgU2V0dGluZ3ModGhpcy5nZXQoa2V5UHJlZml4KSB8fCB7fSwgZmFsc2UpO1xuICB9XG5cbiAgcHVibGljIG1ha2VSZWFkT25seSgpOiBTZXR0aW5ncyB7XG4gICAgcmV0dXJuIG5ldyBTZXR0aW5ncyh0aGlzLnNldHRpbmdzLCB0cnVlKTtcbiAgfVxuXG4gIHB1YmxpYyBjbGVhcigpIHtcbiAgICBpZiAodGhpcy5yZWFkT25seSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgY2xlYXIoKTogc2V0dGluZ3MgYXJlIHJlYWRvbmx5Jyk7XG4gICAgfVxuICAgIHRoaXMuc2V0dGluZ3MgPSB7fTtcbiAgfVxuXG4gIHB1YmxpYyBnZXQgZW1wdHkoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuc2V0dGluZ3MpLmxlbmd0aCA9PT0gMDtcbiAgfVxuXG4gIHB1YmxpYyBnZXQocGF0aDogc3RyaW5nW10pOiBhbnkge1xuICAgIHJldHVybiB1dGlsLmRlZXBDbG9uZSh1dGlsLmRlZXBHZXQodGhpcy5zZXR0aW5ncywgcGF0aCkpO1xuICB9XG5cbiAgcHVibGljIHNldChwYXRoOiBzdHJpbmdbXSwgdmFsdWU6IGFueSk6IFNldHRpbmdzIHtcbiAgICBpZiAodGhpcy5yZWFkT25seSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW4ndCBzZXQgJHtwYXRofTogc2V0dGluZ3Mgb2JqZWN0IGlzIHJlYWRvbmx5YCk7XG4gICAgfVxuICAgIGlmIChwYXRoLmxlbmd0aCA9PT0gMCkge1xuICAgICAgLy8gZGVlcFNldCBjYW4ndCBoYW5kbGUgdGhpcyBjYXNlXG4gICAgICB0aGlzLnNldHRpbmdzID0gdmFsdWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIHV0aWwuZGVlcFNldCh0aGlzLnNldHRpbmdzLCBwYXRoLCB2YWx1ZSk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgcHVibGljIHVuc2V0KHBhdGg6IHN0cmluZ1tdKSB7XG4gICAgdGhpcy5zZXQocGF0aCwgdW5kZWZpbmVkKTtcbiAgfVxuXG4gIHByaXZhdGUgcHJvaGliaXRDb250ZXh0S2V5KGtleTogc3RyaW5nLCBmaWxlTmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLmNvbnRleHQpIHsgcmV0dXJuOyB9XG4gICAgaWYgKGtleSBpbiB0aGlzLnNldHRpbmdzLmNvbnRleHQpIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBtYXgtbGVuXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZSAnY29udGV4dC4ke2tleX0nIGtleSB3YXMgZm91bmQgaW4gJHtmc19wYXRoLnJlc29sdmUoZmlsZU5hbWUpfSwgYnV0IGl0IGlzIG5vIGxvbmdlciBzdXBwb3J0ZWQuIFBsZWFzZSByZW1vdmUgaXQuYCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSB3YXJuQWJvdXRDb250ZXh0S2V5KHByZWZpeDogc3RyaW5nLCBmaWxlTmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKCF0aGlzLnNldHRpbmdzLmNvbnRleHQpIHsgcmV0dXJuOyB9XG4gICAgZm9yIChjb25zdCBjb250ZXh0S2V5IG9mIE9iamVjdC5rZXlzKHRoaXMuc2V0dGluZ3MuY29udGV4dCkpIHtcbiAgICAgIGlmIChjb250ZXh0S2V5LnN0YXJ0c1dpdGgocHJlZml4KSkge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbWF4LWxlblxuICAgICAgICB3YXJuaW5nKGBBIHJlc2VydmVkIGNvbnRleHQga2V5ICgnY29udGV4dC4ke3ByZWZpeH0nKSBrZXkgd2FzIGZvdW5kIGluICR7ZnNfcGF0aC5yZXNvbHZlKGZpbGVOYW1lKX0sIGl0IG1pZ2h0IGNhdXNlIHN1cnByaXNpbmcgYmVoYXZpb3IgYW5kIHNob3VsZCBiZSByZW1vdmVkLmApO1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBleHBhbmRIb21lRGlyKHg6IHN0cmluZykge1xuICBpZiAoeC5zdGFydHNXaXRoKCd+JykpIHtcbiAgICByZXR1cm4gZnNfcGF0aC5qb2luKG9zLmhvbWVkaXIoKSwgeC5zbGljZSgxKSk7XG4gIH1cbiAgcmV0dXJuIHg7XG59XG5cbi8qKlxuICogUmV0dXJuIGFsbCBjb250ZXh0IHZhbHVlIHRoYXQgYXJlIG5vdCB0cmFuc2llbnQgY29udGV4dCB2YWx1ZXNcbiAqL1xuZnVuY3Rpb24gc3RyaXBUcmFuc2llbnRWYWx1ZXMob2JqOiB7W2tleTogc3RyaW5nXTogYW55fSkge1xuICBjb25zdCByZXQ6IGFueSA9IHt9O1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhvYmopKSB7XG4gICAgaWYgKCFpc1RyYW5zaWVudFZhbHVlKHZhbHVlKSkge1xuICAgICAgcmV0W2tleV0gPSB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJldDtcbn1cblxuLyoqXG4gKiBSZXR1cm4gd2hldGhlciB0aGUgZ2l2ZW4gdmFsdWUgaXMgYSB0cmFuc2llbnQgY29udGV4dCB2YWx1ZVxuICpcbiAqIFZhbHVlcyB0aGF0IGFyZSBvYmplY3RzIHdpdGggYSBtYWdpYyBrZXkgc2V0IHRvIGEgdHJ1dGh5IHZhbHVlIGFyZSBjb25zaWRlcmVkIHRyYW5zaWVudC5cbiAqL1xuZnVuY3Rpb24gaXNUcmFuc2llbnRWYWx1ZSh2YWx1ZTogYW55KSB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmICh2YWx1ZSBhcyBhbnkpW1RSQU5TSUVOVF9DT05URVhUX0tFWV07XG59XG5cbmZ1bmN0aW9uIGV4cGVjdFN0cmluZ0xpc3QoeDogdW5rbm93bik6IHN0cmluZ1tdIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHggPT09IHVuZGVmaW5lZCkgeyByZXR1cm4gdW5kZWZpbmVkOyB9XG4gIGlmICghQXJyYXkuaXNBcnJheSh4KSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgYXJyYXksIGdvdCAnJHt4fSdgKTtcbiAgfVxuICBjb25zdCBub25TdHJpbmdzID0geC5maWx0ZXIoZSA9PiB0eXBlb2YgZSAhPT0gJ3N0cmluZycpO1xuICBpZiAobm9uU3RyaW5ncy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBsaXN0IG9mIHN0cmluZ3MsIGZvdW5kICR7bm9uU3RyaW5nc31gKTtcbiAgfVxuICByZXR1cm4geDtcbn1cbiJdfQ==