"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.execProgram = execProgram;
exports.createAssembly = createAssembly;
exports.prepareDefaultEnvironment = prepareDefaultEnvironment;
exports.prepareContext = prepareContext;
const childProcess = require("child_process");
const os = require("os");
const path = require("path");
const cxschema = require("@aws-cdk/cloud-assembly-schema");
const cxapi = require("@aws-cdk/cx-api");
const fs = require("fs-extra");
const semver = require("semver");
const logging_1 = require("../../logging");
const settings_1 = require("../../settings");
const tree_1 = require("../../tree");
const objects_1 = require("../../util/objects");
const version_1 = require("../../version");
const rwlock_1 = require("../util/rwlock");
/** Invokes the cloud executable and returns JSON output */
async function execProgram(aws, config) {
    const env = await prepareDefaultEnvironment(aws);
    const context = await prepareContext(config, env);
    const build = config.settings.get(['build']);
    if (build) {
        await exec(build);
    }
    const app = config.settings.get(['app']);
    if (!app) {
        throw new Error(`--app is required either in command-line, in ${settings_1.PROJECT_CONFIG} or in ${settings_1.USER_DEFAULTS}`);
    }
    // bypass "synth" if app points to a cloud assembly
    if (await fs.pathExists(app) && (await fs.stat(app)).isDirectory()) {
        (0, logging_1.debug)('--app points to a cloud assembly, so we bypass synth');
        // Acquire a read lock on this directory
        const lock = await new rwlock_1.RWLock(app).acquireRead();
        return { assembly: createAssembly(app), lock };
    }
    const commandLine = await guessExecutable(appToArray(app));
    const outdir = config.settings.get(['output']);
    if (!outdir) {
        throw new Error('unexpected: --output is required');
    }
    if (typeof outdir !== 'string') {
        throw new Error(`--output takes a string, got ${JSON.stringify(outdir)}`);
    }
    try {
        await fs.mkdirp(outdir);
    }
    catch (error) {
        throw new Error(`Could not create output directory ${outdir} (${error.message})`);
    }
    (0, logging_1.debug)('outdir:', outdir);
    env[cxapi.OUTDIR_ENV] = outdir;
    // Acquire a lock on the output directory
    const writerLock = await new rwlock_1.RWLock(outdir).acquireWrite();
    try {
        // Send version information
        env[cxapi.CLI_ASM_VERSION_ENV] = cxschema.Manifest.version();
        env[cxapi.CLI_VERSION_ENV] = (0, version_1.versionNumber)();
        (0, logging_1.debug)('env:', env);
        const envVariableSizeLimit = os.platform() === 'win32' ? 32760 : 131072;
        const [smallContext, overflow] = (0, objects_1.splitBySize)(context, spaceAvailableForContext(env, envVariableSizeLimit));
        // Store the safe part in the environment variable
        env[cxapi.CONTEXT_ENV] = JSON.stringify(smallContext);
        // If there was any overflow, write it to a temporary file
        let contextOverflowLocation;
        if (Object.keys(overflow ?? {}).length > 0) {
            const contextDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdk-context'));
            contextOverflowLocation = path.join(contextDir, 'context-overflow.json');
            fs.writeJSONSync(contextOverflowLocation, overflow);
            env[cxapi.CONTEXT_OVERFLOW_LOCATION_ENV] = contextOverflowLocation;
        }
        await exec(commandLine.join(' '));
        const assembly = createAssembly(outdir);
        contextOverflowCleanup(contextOverflowLocation, assembly);
        return { assembly, lock: await writerLock.convertToReaderLock() };
    }
    catch (e) {
        await writerLock.release();
        throw e;
    }
    async function exec(commandAndArgs) {
        return new Promise((ok, fail) => {
            // We use a slightly lower-level interface to:
            //
            // - Pass arguments in an array instead of a string, to get around a
            //   number of quoting issues introduced by the intermediate shell layer
            //   (which would be different between Linux and Windows).
            //
            // - Inherit stderr from controlling terminal. We don't use the captured value
            //   anyway, and if the subprocess is printing to it for debugging purposes the
            //   user gets to see it sooner. Plus, capturing doesn't interact nicely with some
            //   processes like Maven.
            const proc = childProcess.spawn(commandAndArgs, {
                stdio: ['ignore', 'inherit', 'inherit'],
                detached: false,
                shell: true,
                env: {
                    ...process.env,
                    ...env,
                },
            });
            proc.on('error', fail);
            proc.on('exit', code => {
                if (code === 0) {
                    return ok();
                }
                else {
                    (0, logging_1.debug)('failed command:', commandAndArgs);
                    return fail(new Error(`Subprocess exited with error ${code}`));
                }
            });
        });
    }
}
/**
 * Creates an assembly with error handling
 */
function createAssembly(appDir) {
    try {
        return new cxapi.CloudAssembly(appDir, {
            // We sort as we deploy
            topoSort: false,
        });
    }
    catch (error) {
        if (error.message.includes(cxschema.VERSION_MISMATCH)) {
            // this means the CLI version is too old.
            // we instruct the user to upgrade.
            throw new Error(`This CDK CLI is not compatible with the CDK library used by your application. Please upgrade the CLI to the latest version.\n(${error.message})`);
        }
        throw error;
    }
}
/**
 * If we don't have region/account defined in context, we fall back to the default SDK behavior
 * where region is retrieved from ~/.aws/config and account is based on default credentials provider
 * chain and then STS is queried.
 *
 * This is done opportunistically: for example, if we can't access STS for some reason or the region
 * is not configured, the context value will be 'null' and there could failures down the line. In
 * some cases, synthesis does not require region/account information at all, so that might be perfectly
 * fine in certain scenarios.
 *
 * @param context The context key/value bash.
 */
async function prepareDefaultEnvironment(aws) {
    const env = {};
    env[cxapi.DEFAULT_REGION_ENV] = aws.defaultRegion;
    (0, logging_1.debug)(`Setting "${cxapi.DEFAULT_REGION_ENV}" environment variable to`, env[cxapi.DEFAULT_REGION_ENV]);
    const accountId = (await aws.defaultAccount())?.accountId;
    if (accountId) {
        env[cxapi.DEFAULT_ACCOUNT_ENV] = accountId;
        (0, logging_1.debug)(`Setting "${cxapi.DEFAULT_ACCOUNT_ENV}" environment variable to`, env[cxapi.DEFAULT_ACCOUNT_ENV]);
    }
    return env;
}
/**
 * Settings related to synthesis are read from context.
 * The merging of various configuration sources like cli args or cdk.json has already happened.
 * We now need to set the final values to the context.
 */
async function prepareContext(config, env) {
    const context = config.context.all;
    const debugMode = config.settings.get(['debug']) ?? true;
    if (debugMode) {
        env.CDK_DEBUG = 'true';
    }
    const pathMetadata = config.settings.get(['pathMetadata']) ?? true;
    if (pathMetadata) {
        context[cxapi.PATH_METADATA_ENABLE_CONTEXT] = true;
    }
    const assetMetadata = config.settings.get(['assetMetadata']) ?? true;
    if (assetMetadata) {
        context[cxapi.ASSET_RESOURCE_METADATA_ENABLED_CONTEXT] = true;
    }
    const versionReporting = config.settings.get(['versionReporting']) ?? true;
    if (versionReporting) {
        context[cxapi.ANALYTICS_REPORTING_ENABLED_CONTEXT] = true;
    }
    // We need to keep on doing this for framework version from before this flag was deprecated.
    if (!versionReporting) {
        context['aws:cdk:disable-version-reporting'] = true;
    }
    const stagingEnabled = config.settings.get(['staging']) ?? true;
    if (!stagingEnabled) {
        context[cxapi.DISABLE_ASSET_STAGING_CONTEXT] = true;
    }
    const bundlingStacks = config.settings.get(['bundlingStacks']) ?? ['**'];
    context[cxapi.BUNDLING_STACKS] = bundlingStacks;
    (0, logging_1.debug)('context:', context);
    return context;
}
/**
 * Make sure the 'app' is an array
 *
 * If it's a string, split on spaces as a trivial way of tokenizing the command line.
 */
function appToArray(app) {
    return typeof app === 'string' ? app.split(' ') : app;
}
/**
 * Execute the given file with the same 'node' process as is running the current process
 */
function executeNode(scriptFile) {
    return [process.execPath, scriptFile];
}
/**
 * Mapping of extensions to command-line generators
 */
const EXTENSION_MAP = new Map([
    ['.js', executeNode],
]);
/**
 * Guess the executable from the command-line argument
 *
 * Only do this if the file is NOT marked as executable. If it is,
 * we'll defer to the shebang inside the file itself.
 *
 * If we're on Windows, we ALWAYS take the handler, since it's hard to
 * verify if registry associations have or have not been set up for this
 * file type, so we'll assume the worst and take control.
 */
async function guessExecutable(commandLine) {
    if (commandLine.length === 1) {
        let fstat;
        try {
            fstat = await fs.stat(commandLine[0]);
        }
        catch {
            (0, logging_1.debug)(`Not a file: '${commandLine[0]}'. Using '${commandLine}' as command-line`);
            return commandLine;
        }
        // eslint-disable-next-line no-bitwise
        const isExecutable = (fstat.mode & fs.constants.X_OK) !== 0;
        const isWindows = process.platform === 'win32';
        const handler = EXTENSION_MAP.get(path.extname(commandLine[0]));
        if (handler && (!isExecutable || isWindows)) {
            return handler(commandLine[0]);
        }
    }
    return commandLine;
}
function contextOverflowCleanup(location, assembly) {
    if (location) {
        fs.removeSync(path.dirname(location));
        const tree = (0, tree_1.loadTree)(assembly);
        const frameworkDoesNotSupportContextOverflow = (0, tree_1.some)(tree, node => {
            const fqn = node.constructInfo?.fqn;
            const version = node.constructInfo?.version;
            return (fqn === 'aws-cdk-lib.App' && version != null && semver.lte(version, '2.38.0'))
                || fqn === '@aws-cdk/core.App'; // v1
        });
        // We're dealing with an old version of the framework here. It is unaware of the temporary
        // file, which means that it will ignore the context overflow.
        if (frameworkDoesNotSupportContextOverflow) {
            (0, logging_1.warning)('Part of the context could not be sent to the application. Please update the AWS CDK library to the latest version.');
        }
    }
}
function spaceAvailableForContext(env, limit) {
    const size = (value) => value != null ? Buffer.byteLength(value) : 0;
    const usedSpace = Object.entries(env)
        .map(([k, v]) => k === cxapi.CONTEXT_ENV ? size(k) : size(k) + size(v))
        .reduce((a, b) => a + b, 0);
    return Math.max(0, limit - usedSpace);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhlYy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImV4ZWMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFxQkEsa0NBaUhDO0FBS0Qsd0NBY0M7QUFjRCw4REFhQztBQU9ELHdDQWtDQztBQTdORCw4Q0FBOEM7QUFDOUMseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QiwyREFBMkQ7QUFDM0QseUNBQXlDO0FBQ3pDLCtCQUErQjtBQUMvQixpQ0FBaUM7QUFDakMsMkNBQStDO0FBQy9DLDZDQUE4RTtBQUM5RSxxQ0FBNEM7QUFDNUMsZ0RBQWlEO0FBQ2pELDJDQUE4QztBQUU5QywyQ0FBK0M7QUFPL0MsMkRBQTJEO0FBQ3BELEtBQUssVUFBVSxXQUFXLENBQUMsR0FBZ0IsRUFBRSxNQUFxQjtJQUN2RSxNQUFNLEdBQUcsR0FBRyxNQUFNLHlCQUF5QixDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ2pELE1BQU0sT0FBTyxHQUFHLE1BQU0sY0FBYyxDQUFDLE1BQU0sRUFBRSxHQUFHLENBQUMsQ0FBQztJQUVsRCxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7SUFDN0MsSUFBSSxLQUFLLEVBQUUsQ0FBQztRQUNWLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3BCLENBQUM7SUFFRCxNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7SUFDekMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ1QsTUFBTSxJQUFJLEtBQUssQ0FBQyxnREFBZ0QseUJBQWMsVUFBVSx3QkFBYSxFQUFFLENBQUMsQ0FBQztJQUMzRyxDQUFDO0lBRUQsbURBQW1EO0lBQ25ELElBQUksTUFBTSxFQUFFLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxDQUFD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QUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEtBQUssS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1NBQ3RFLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFFOUIsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxLQUFLLEdBQUcsU0FBUyxDQUFDLENBQUM7QUFDeEMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNoaWxkUHJvY2VzcyBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ29zJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBjeHNjaGVtYSBmcm9tICdAYXdzLWNkay9jbG91ZC1hc3NlbWJseS1zY2hlbWEnO1xuaW1wb3J0ICogYXMgY3hhcGkgZnJvbSAnQGF3cy1jZGsvY3gtYXBpJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzLWV4dHJhJztcbmltcG9ydCAqIGFzIHNlbXZlciBmcm9tICdzZW12ZXInO1xuaW1wb3J0IHsgZGVidWcsIHdhcm5pbmcgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcbmltcG9ydCB7IENvbmZpZ3VyYXRpb24sIFBST0pFQ1RfQ09ORklHLCBVU0VSX0RFRkFVTFRTIH0gZnJvbSAnLi4vLi4vc2V0dGluZ3MnO1xuaW1wb3J0IHsgbG9hZFRyZWUsIHNvbWUgfSBmcm9tICcuLi8uLi90cmVlJztcbmltcG9ydCB7IHNwbGl0QnlTaXplIH0gZnJvbSAnLi4vLi4vdXRpbC9vYmplY3RzJztcbmltcG9ydCB7IHZlcnNpb25OdW1iZXIgfSBmcm9tICcuLi8uLi92ZXJzaW9uJztcbmltcG9ydCB7IFNka1Byb3ZpZGVyIH0gZnJvbSAnLi4vYXdzLWF1dGgnO1xuaW1wb3J0IHsgUldMb2NrLCBJTG9jayB9IGZyb20gJy4uL3V0aWwvcndsb2NrJztcblxuZXhwb3J0IGludGVyZmFjZSBFeGVjUHJvZ3JhbVJlc3VsdCB7XG4gIHJlYWRvbmx5IGFzc2VtYmx5OiBjeGFwaS5DbG91ZEFzc2VtYmx5O1xuICByZWFkb25seSBsb2NrOiBJTG9jaztcbn1cblxuLyoqIEludm9rZXMgdGhlIGNsb3VkIGV4ZWN1dGFibGUgYW5kIHJldHVybnMgSlNPTiBvdXRwdXQgKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBleGVjUHJvZ3JhbShhd3M6IFNka1Byb3ZpZGVyLCBjb25maWc6IENvbmZpZ3VyYXRpb24pOiBQcm9taXNlPEV4ZWNQcm9ncmFtUmVzdWx0PiB7XG4gIGNvbnN0IGVudiA9IGF3YWl0IHByZXBhcmVEZWZhdWx0RW52aXJvbm1lbnQoYXdzKTtcbiAgY29uc3QgY29udGV4dCA9IGF3YWl0IHByZXBhcmVDb250ZXh0KGNvbmZpZywgZW52KTtcblxuICBjb25zdCBidWlsZCA9IGNvbmZpZy5zZXR0aW5ncy5nZXQoWydidWlsZCddKTtcbiAgaWYgKGJ1aWxkKSB7XG4gICAgYXdhaXQgZXhlYyhidWlsZCk7XG4gIH1cblxuICBjb25zdCBhcHAgPSBjb25maWcuc2V0dGluZ3MuZ2V0KFsnYXBwJ10pO1xuICBpZiAoIWFwcCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgLS1hcHAgaXMgcmVxdWlyZWQgZWl0aGVyIGluIGNvbW1hbmQtbGluZSwgaW4gJHtQUk9KRUNUX0NPTkZJR30gb3IgaW4gJHtVU0VSX0RFRkFVTFRTfWApO1xuICB9XG5cbiAgLy8gYnlwYXNzIFwic3ludGhcIiBpZiBhcHAgcG9pbnRzIHRvIGEgY2xvdWQgYXNzZW1ibHlcbiAgaWYgKGF3YWl0IGZzLnBhdGhFeGlzdHMoYXBwKSAmJiAoYXdhaXQgZnMuc3RhdChhcHApKS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgZGVidWcoJy0tYXBwIHBvaW50cyB0byBhIGNsb3VkIGFzc2VtYmx5LCBzbyB3ZSBieXBhc3Mgc3ludGgnKTtcblxuICAgIC8vIEFjcXVpcmUgYSByZWFkIGxvY2sgb24gdGhpcyBkaXJlY3RvcnlcbiAgICBjb25zdCBsb2NrID0gYXdhaXQgbmV3IFJXTG9jayhhcHApLmFjcXVpcmVSZWFkKCk7XG5cbiAgICByZXR1cm4geyBhc3NlbWJseTogY3JlYXRlQXNzZW1ibHkoYXBwKSwgbG9jayB9O1xuICB9XG5cbiAgY29uc3QgY29tbWFuZExpbmUgPSBhd2FpdCBndWVzc0V4ZWN1dGFibGUoYXBwVG9BcnJheShhcHApKTtcblxuICBjb25zdCBvdXRkaXIgPSBjb25maWcuc2V0dGluZ3MuZ2V0KFsnb3V0cHV0J10pO1xuICBpZiAoIW91dGRpcikge1xuICAgIHRocm93IG5ldyBFcnJvcigndW5leHBlY3RlZDogLS1vdXRwdXQgaXMgcmVxdWlyZWQnKTtcbiAgfVxuICBpZiAodHlwZW9mIG91dGRpciAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYC0tb3V0cHV0IHRha2VzIGEgc3RyaW5nLCBnb3QgJHtKU09OLnN0cmluZ2lmeShvdXRkaXIpfWApO1xuICB9XG4gIHRyeSB7XG4gICAgYXdhaXQgZnMubWtkaXJwKG91dGRpcik7XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkIG5vdCBjcmVhdGUgb3V0cHV0IGRpcmVjdG9yeSAke291dGRpcn0gKCR7ZXJyb3IubWVzc2FnZX0pYCk7XG4gIH1cblxuICBkZWJ1Zygnb3V0ZGlyOicsIG91dGRpcik7XG4gIGVudltjeGFwaS5PVVRESVJfRU5WXSA9IG91dGRpcjtcblxuICAvLyBBY3F1aXJlIGEgbG9jayBvbiB0aGUgb3V0cHV0IGRpcmVjdG9yeVxuICBjb25zdCB3cml0ZXJMb2NrID0gYXdhaXQgbmV3IFJXTG9jayhvdXRkaXIpLmFjcXVpcmVXcml0ZSgpO1xuXG4gIHRyeSB7XG4gICAgLy8gU2VuZCB2ZXJzaW9uIGluZm9ybWF0aW9uXG4gICAgZW52W2N4YXBpLkNMSV9BU01fVkVSU0lPTl9FTlZdID0gY3hzY2hlbWEuTWFuaWZlc3QudmVyc2lvbigpO1xuICAgIGVudltjeGFwaS5DTElfVkVSU0lPTl9FTlZdID0gdmVyc2lvbk51bWJlcigpO1xuXG4gICAgZGVidWcoJ2VudjonLCBlbnYpO1xuXG4gICAgY29uc3QgZW52VmFyaWFibGVTaXplTGltaXQgPSBvcy5wbGF0Zm9ybSgpID09PSAnd2luMzInID8gMzI3NjAgOiAxMzEwNzI7XG4gICAgY29uc3QgW3NtYWxsQ29udGV4dCwgb3ZlcmZsb3ddID0gc3BsaXRCeVNpemUoY29udGV4dCwgc3BhY2VBdmFpbGFibGVGb3JDb250ZXh0KGVudiwgZW52VmFyaWFibGVTaXplTGltaXQpKTtcblxuICAgIC8vIFN0b3JlIHRoZSBzYWZlIHBhcnQgaW4gdGhlIGVudmlyb25tZW50IHZhcmlhYmxlXG4gICAgZW52W2N4YXBpLkNPTlRFWFRfRU5WXSA9IEpTT04uc3RyaW5naWZ5KHNtYWxsQ29udGV4dCk7XG5cbiAgICAvLyBJZiB0aGVyZSB3YXMgYW55IG92ZXJmbG93LCB3cml0ZSBpdCB0byBhIHRlbXBvcmFyeSBmaWxlXG4gICAgbGV0IGNvbnRleHRPdmVyZmxvd0xvY2F0aW9uO1xuICAgIGlmIChPYmplY3Qua2V5cyhvdmVyZmxvdyA/PyB7fSkubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgY29udGV4dERpciA9IGF3YWl0IGZzLm1rZHRlbXAocGF0aC5qb2luKG9zLnRtcGRpcigpLCAnY2RrLWNvbnRleHQnKSk7XG4gICAgICBjb250ZXh0T3ZlcmZsb3dMb2NhdGlvbiA9IHBhdGguam9pbihjb250ZXh0RGlyLCAnY29udGV4dC1vdmVyZmxvdy5qc29uJyk7XG4gICAgICBmcy53cml0ZUpTT05TeW5jKGNvbnRleHRPdmVyZmxvd0xvY2F0aW9uLCBvdmVyZmxvdyk7XG4gICAgICBlbnZbY3hhcGkuQ09OVEVYVF9PVkVSRkxPV19MT0NBVElPTl9FTlZdID0gY29udGV4dE92ZXJmbG93TG9jYXRpb247XG4gICAgfVxuXG4gICAgYXdhaXQgZXhlYyhjb21tYW5kTGluZS5qb2luKCcgJykpO1xuXG4gICAgY29uc3QgYXNzZW1ibHkgPSBjcmVhdGVBc3NlbWJseShvdXRkaXIpO1xuXG4gICAgY29udGV4dE92ZXJmbG93Q2xlYW51cChjb250ZXh0T3ZlcmZsb3dMb2NhdGlvbiwgYXNzZW1ibHkpO1xuXG4gICAgcmV0dXJuIHsgYXNzZW1ibHksIGxvY2s6IGF3YWl0IHdyaXRlckxvY2suY29udmVydFRvUmVhZGVyTG9jaygpIH07XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBhd2FpdCB3cml0ZXJMb2NrLnJlbGVhc2UoKTtcbiAgICB0aHJvdyBlO1xuICB9XG5cbiAgYXN5bmMgZnVuY3Rpb24gZXhlYyhjb21tYW5kQW5kQXJnczogc3RyaW5nKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlPHZvaWQ+KChvaywgZmFpbCkgPT4ge1xuICAgICAgLy8gV2UgdXNlIGEgc2xpZ2h0bHkgbG93ZXItbGV2ZWwgaW50ZXJmYWNlIHRvOlxuICAgICAgLy9cbiAgICAgIC8vIC0gUGFzcyBhcmd1bWVudHMgaW4gYW4gYXJyYXkgaW5zdGVhZCBvZiBhIHN0cmluZywgdG8gZ2V0IGFyb3VuZCBhXG4gICAgICAvLyAgIG51bWJlciBvZiBxdW90aW5nIGlzc3VlcyBpbnRyb2R1Y2VkIGJ5IHRoZSBpbnRlcm1lZGlhdGUgc2hlbGwgbGF5ZXJcbiAgICAgIC8vICAgKHdoaWNoIHdvdWxkIGJlIGRpZmZlcmVudCBiZXR3ZWVuIExpbnV4IGFuZCBXaW5kb3dzKS5cbiAgICAgIC8vXG4gICAgICAvLyAtIEluaGVyaXQgc3RkZXJyIGZyb20gY29udHJvbGxpbmcgdGVybWluYWwuIFdlIGRvbid0IHVzZSB0aGUgY2FwdHVyZWQgdmFsdWVcbiAgICAgIC8vICAgYW55d2F5LCBhbmQgaWYgdGhlIHN1YnByb2Nlc3MgaXMgcHJpbnRpbmcgdG8gaXQgZm9yIGRlYnVnZ2luZyBwdXJwb3NlcyB0aGVcbiAgICAgIC8vICAgdXNlciBnZXRzIHRvIHNlZSBpdCBzb29uZXIuIFBsdXMsIGNhcHR1cmluZyBkb2Vzbid0IGludGVyYWN0IG5pY2VseSB3aXRoIHNvbWVcbiAgICAgIC8vICAgcHJvY2Vzc2VzIGxpa2UgTWF2ZW4uXG4gICAgICBjb25zdCBwcm9jID0gY2hpbGRQcm9jZXNzLnNwYXduKGNvbW1hbmRBbmRBcmdzLCB7XG4gICAgICAgIHN0ZGlvOiBbJ2lnbm9yZScsICdpbmhlcml0JywgJ2luaGVyaXQnXSxcbiAgICAgICAgZGV0YWNoZWQ6IGZhbHNlLFxuICAgICAgICBzaGVsbDogdHJ1ZSxcbiAgICAgICAgZW52OiB7XG4gICAgICAgICAgLi4ucHJvY2Vzcy5lbnYsXG4gICAgICAgICAgLi4uZW52LFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIHByb2Mub24oJ2Vycm9yJywgZmFpbCk7XG5cbiAgICAgIHByb2Mub24oJ2V4aXQnLCBjb2RlID0+IHtcbiAgICAgICAgaWYgKGNvZGUgPT09IDApIHtcbiAgICAgICAgICByZXR1cm4gb2soKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBkZWJ1ZygnZmFpbGVkIGNvbW1hbmQ6JywgY29tbWFuZEFuZEFyZ3MpO1xuICAgICAgICAgIHJldHVybiBmYWlsKG5ldyBFcnJvcihgU3VicHJvY2VzcyBleGl0ZWQgd2l0aCBlcnJvciAke2NvZGV9YCkpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gYXNzZW1ibHkgd2l0aCBlcnJvciBoYW5kbGluZ1xuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQXNzZW1ibHkoYXBwRGlyOiBzdHJpbmcpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gbmV3IGN4YXBpLkNsb3VkQXNzZW1ibHkoYXBwRGlyLCB7XG4gICAgICAvLyBXZSBzb3J0IGFzIHdlIGRlcGxveVxuICAgICAgdG9wb1NvcnQ6IGZhbHNlLFxuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgaWYgKGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoY3hzY2hlbWEuVkVSU0lPTl9NSVNNQVRDSCkpIHtcbiAgICAgIC8vIHRoaXMgbWVhbnMgdGhlIENMSSB2ZXJzaW9uIGlzIHRvbyBvbGQuXG4gICAgICAvLyB3ZSBpbnN0cnVjdCB0aGUgdXNlciB0byB1cGdyYWRlLlxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBUaGlzIENESyBDTEkgaXMgbm90IGNvbXBhdGlibGUgd2l0aCB0aGUgQ0RLIGxpYnJhcnkgdXNlZCBieSB5b3VyIGFwcGxpY2F0aW9uLiBQbGVhc2UgdXBncmFkZSB0aGUgQ0xJIHRvIHRoZSBsYXRlc3QgdmVyc2lvbi5cXG4oJHtlcnJvci5tZXNzYWdlfSlgKTtcbiAgICB9XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbn1cblxuLyoqXG4gKiBJZiB3ZSBkb24ndCBoYXZlIHJlZ2lvbi9hY2NvdW50IGRlZmluZWQgaW4gY29udGV4dCwgd2UgZmFsbCBiYWNrIHRvIHRoZSBkZWZhdWx0IFNESyBiZWhhdmlvclxuICogd2hlcmUgcmVnaW9uIGlzIHJldHJpZXZlZCBmcm9tIH4vLmF3cy9jb25maWcgYW5kIGFjY291bnQgaXMgYmFzZWQgb24gZGVmYXVsdCBjcmVkZW50aWFscyBwcm92aWRlclxuICogY2hhaW4gYW5kIHRoZW4gU1RTIGlzIHF1ZXJpZWQuXG4gKlxuICogVGhpcyBpcyBkb25lIG9wcG9ydHVuaXN0aWNhbGx5OiBmb3IgZXhhbXBsZSwgaWYgd2UgY2FuJ3QgYWNjZXNzIFNUUyBmb3Igc29tZSByZWFzb24gb3IgdGhlIHJlZ2lvblxuICogaXMgbm90IGNvbmZpZ3VyZWQsIHRoZSBjb250ZXh0IHZhbHVlIHdpbGwgYmUgJ251bGwnIGFuZCB0aGVyZSBjb3VsZCBmYWlsdXJlcyBkb3duIHRoZSBsaW5lLiBJblxuICogc29tZSBjYXNlcywgc3ludGhlc2lzIGRvZXMgbm90IHJlcXVpcmUgcmVnaW9uL2FjY291bnQgaW5mb3JtYXRpb24gYXQgYWxsLCBzbyB0aGF0IG1pZ2h0IGJlIHBlcmZlY3RseVxuICogZmluZSBpbiBjZXJ0YWluIHNjZW5hcmlvcy5cbiAqXG4gKiBAcGFyYW0gY29udGV4dCBUaGUgY29udGV4dCBrZXkvdmFsdWUgYmFzaC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHByZXBhcmVEZWZhdWx0RW52aXJvbm1lbnQoYXdzOiBTZGtQcm92aWRlcik6IFByb21pc2U8eyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfT4ge1xuICBjb25zdCBlbnY6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH0gPSB7IH07XG5cbiAgZW52W2N4YXBpLkRFRkFVTFRfUkVHSU9OX0VOVl0gPSBhd3MuZGVmYXVsdFJlZ2lvbjtcbiAgZGVidWcoYFNldHRpbmcgXCIke2N4YXBpLkRFRkFVTFRfUkVHSU9OX0VOVn1cIiBlbnZpcm9ubWVudCB2YXJpYWJsZSB0b2AsIGVudltjeGFwaS5ERUZBVUxUX1JFR0lPTl9FTlZdKTtcblxuICBjb25zdCBhY2NvdW50SWQgPSAoYXdhaXQgYXdzLmRlZmF1bHRBY2NvdW50KCkpPy5hY2NvdW50SWQ7XG4gIGlmIChhY2NvdW50SWQpIHtcbiAgICBlbnZbY3hhcGkuREVGQVVMVF9BQ0NPVU5UX0VOVl0gPSBhY2NvdW50SWQ7XG4gICAgZGVidWcoYFNldHRpbmcgXCIke2N4YXBpLkRFRkFVTFRfQUNDT1VOVF9FTlZ9XCIgZW52aXJvbm1lbnQgdmFyaWFibGUgdG9gLCBlbnZbY3hhcGkuREVGQVVMVF9BQ0NPVU5UX0VOVl0pO1xuICB9XG5cbiAgcmV0dXJuIGVudjtcbn1cblxuLyoqXG4gKiBTZXR0aW5ncyByZWxhdGVkIHRvIHN5bnRoZXNpcyBhcmUgcmVhZCBmcm9tIGNvbnRleHQuXG4gKiBUaGUgbWVyZ2luZyBvZiB2YXJpb3VzIGNvbmZpZ3VyYXRpb24gc291cmNlcyBsaWtlIGNsaSBhcmdzIG9yIGNkay5qc29uIGhhcyBhbHJlYWR5IGhhcHBlbmVkLlxuICogV2Ugbm93IG5lZWQgdG8gc2V0IHRoZSBmaW5hbCB2YWx1ZXMgdG8gdGhlIGNvbnRleHQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwcmVwYXJlQ29udGV4dChjb25maWc6IENvbmZpZ3VyYXRpb24sIGVudjogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfCB1bmRlZmluZWR9KSB7XG4gIGNvbnN0IGNvbnRleHQgPSBjb25maWcuY29udGV4dC5hbGw7XG5cbiAgY29uc3QgZGVidWdNb2RlOiBib29sZWFuID0gY29uZmlnLnNldHRpbmdzLmdldChbJ2RlYnVnJ10pID8/IHRydWU7XG4gIGlmIChkZWJ1Z01vZGUpIHtcbiAgICBlbnYuQ0RLX0RFQlVHID0gJ3RydWUnO1xuICB9XG5cbiAgY29uc3QgcGF0aE1ldGFkYXRhOiBib29sZWFuID0gY29uZmlnLnNldHRpbmdzLmdldChbJ3BhdGhNZXRhZGF0YSddKSA/PyB0cnVlO1xuICBpZiAocGF0aE1ldGFkYXRhKSB7XG4gICAgY29udGV4dFtjeGFwaS5QQVRIX01FVEFEQVRBX0VOQUJMRV9DT05URVhUXSA9IHRydWU7XG4gIH1cblxuICBjb25zdCBhc3NldE1ldGFkYXRhOiBib29sZWFuID0gY29uZmlnLnNldHRpbmdzLmdldChbJ2Fzc2V0TWV0YWRhdGEnXSkgPz8gdHJ1ZTtcbiAgaWYgKGFzc2V0TWV0YWRhdGEpIHtcbiAgICBjb250ZXh0W2N4YXBpLkFTU0VUX1JFU09VUkNFX01FVEFEQVRBX0VOQUJMRURfQ09OVEVYVF0gPSB0cnVlO1xuICB9XG5cbiAgY29uc3QgdmVyc2lvblJlcG9ydGluZzogYm9vbGVhbiA9IGNvbmZpZy5zZXR0aW5ncy5nZXQoWyd2ZXJzaW9uUmVwb3J0aW5nJ10pID8/IHRydWU7XG4gIGlmICh2ZXJzaW9uUmVwb3J0aW5nKSB7IGNvbnRleHRbY3hhcGkuQU5BTFlUSUNTX1JFUE9SVElOR19FTkFCTEVEX0NPTlRFWFRdID0gdHJ1ZTsgfVxuICAvLyBXZSBuZWVkIHRvIGtlZXAgb24gZG9pbmcgdGhpcyBmb3IgZnJhbWV3b3JrIHZlcnNpb24gZnJvbSBiZWZvcmUgdGhpcyBmbGFnIHdhcyBkZXByZWNhdGVkLlxuICBpZiAoIXZlcnNpb25SZXBvcnRpbmcpIHsgY29udGV4dFsnYXdzOmNkazpkaXNhYmxlLXZlcnNpb24tcmVwb3J0aW5nJ10gPSB0cnVlOyB9XG5cbiAgY29uc3Qgc3RhZ2luZ0VuYWJsZWQgPSBjb25maWcuc2V0dGluZ3MuZ2V0KFsnc3RhZ2luZyddKSA/PyB0cnVlO1xuICBpZiAoIXN0YWdpbmdFbmFibGVkKSB7XG4gICAgY29udGV4dFtjeGFwaS5ESVNBQkxFX0FTU0VUX1NUQUdJTkdfQ09OVEVYVF0gPSB0cnVlO1xuICB9XG5cbiAgY29uc3QgYnVuZGxpbmdTdGFja3MgPSBjb25maWcuc2V0dGluZ3MuZ2V0KFsnYnVuZGxpbmdTdGFja3MnXSkgPz8gWycqKiddO1xuICBjb250ZXh0W2N4YXBpLkJVTkRMSU5HX1NUQUNLU10gPSBidW5kbGluZ1N0YWNrcztcblxuICBkZWJ1ZygnY29udGV4dDonLCBjb250ZXh0KTtcblxuICByZXR1cm4gY29udGV4dDtcbn1cblxuLyoqXG4gKiBNYWtlIHN1cmUgdGhlICdhcHAnIGlzIGFuIGFycmF5XG4gKlxuICogSWYgaXQncyBhIHN0cmluZywgc3BsaXQgb24gc3BhY2VzIGFzIGEgdHJpdmlhbCB3YXkgb2YgdG9rZW5pemluZyB0aGUgY29tbWFuZCBsaW5lLlxuICovXG5mdW5jdGlvbiBhcHBUb0FycmF5KGFwcDogYW55KSB7XG4gIHJldHVybiB0eXBlb2YgYXBwID09PSAnc3RyaW5nJyA/IGFwcC5zcGxpdCgnICcpIDogYXBwO1xufVxuXG50eXBlIENvbW1hbmRHZW5lcmF0b3IgPSAoZmlsZTogc3RyaW5nKSA9PiBzdHJpbmdbXTtcblxuLyoqXG4gKiBFeGVjdXRlIHRoZSBnaXZlbiBmaWxlIHdpdGggdGhlIHNhbWUgJ25vZGUnIHByb2Nlc3MgYXMgaXMgcnVubmluZyB0aGUgY3VycmVudCBwcm9jZXNzXG4gKi9cbmZ1bmN0aW9uIGV4ZWN1dGVOb2RlKHNjcmlwdEZpbGU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIFtwcm9jZXNzLmV4ZWNQYXRoLCBzY3JpcHRGaWxlXTtcbn1cblxuLyoqXG4gKiBNYXBwaW5nIG9mIGV4dGVuc2lvbnMgdG8gY29tbWFuZC1saW5lIGdlbmVyYXRvcnNcbiAqL1xuY29uc3QgRVhURU5TSU9OX01BUCA9IG5ldyBNYXA8c3RyaW5nLCBDb21tYW5kR2VuZXJhdG9yPihbXG4gIFsnLmpzJywgZXhlY3V0ZU5vZGVdLFxuXSk7XG5cbi8qKlxuICogR3Vlc3MgdGhlIGV4ZWN1dGFibGUgZnJvbSB0aGUgY29tbWFuZC1saW5lIGFyZ3VtZW50XG4gKlxuICogT25seSBkbyB0aGlzIGlmIHRoZSBmaWxlIGlzIE5PVCBtYXJrZWQgYXMgZXhlY3V0YWJsZS4gSWYgaXQgaXMsXG4gKiB3ZSdsbCBkZWZlciB0byB0aGUgc2hlYmFuZyBpbnNpZGUgdGhlIGZpbGUgaXRzZWxmLlxuICpcbiAqIElmIHdlJ3JlIG9uIFdpbmRvd3MsIHdlIEFMV0FZUyB0YWtlIHRoZSBoYW5kbGVyLCBzaW5jZSBpdCdzIGhhcmQgdG9cbiAqIHZlcmlmeSBpZiByZWdpc3RyeSBhc3NvY2lhdGlvbnMgaGF2ZSBvciBoYXZlIG5vdCBiZWVuIHNldCB1cCBmb3IgdGhpc1xuICogZmlsZSB0eXBlLCBzbyB3ZSdsbCBhc3N1bWUgdGhlIHdvcnN0IGFuZCB0YWtlIGNvbnRyb2wuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGd1ZXNzRXhlY3V0YWJsZShjb21tYW5kTGluZTogc3RyaW5nW10pIHtcbiAgaWYgKGNvbW1hbmRMaW5lLmxlbmd0aCA9PT0gMSkge1xuICAgIGxldCBmc3RhdDtcblxuICAgIHRyeSB7XG4gICAgICBmc3RhdCA9IGF3YWl0IGZzLnN0YXQoY29tbWFuZExpbmVbMF0pO1xuICAgIH0gY2F0Y2gge1xuICAgICAgZGVidWcoYE5vdCBhIGZpbGU6ICcke2NvbW1hbmRMaW5lWzBdfScuIFVzaW5nICcke2NvbW1hbmRMaW5lfScgYXMgY29tbWFuZC1saW5lYCk7XG4gICAgICByZXR1cm4gY29tbWFuZExpbmU7XG4gICAgfVxuXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWJpdHdpc2VcbiAgICBjb25zdCBpc0V4ZWN1dGFibGUgPSAoZnN0YXQubW9kZSAmIGZzLmNvbnN0YW50cy5YX09LKSAhPT0gMDtcbiAgICBjb25zdCBpc1dpbmRvd3MgPSBwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInO1xuXG4gICAgY29uc3QgaGFuZGxlciA9IEVYVEVOU0lPTl9NQVAuZ2V0KHBhdGguZXh0bmFtZShjb21tYW5kTGluZVswXSkpO1xuICAgIGlmIChoYW5kbGVyICYmICghaXNFeGVjdXRhYmxlIHx8IGlzV2luZG93cykpIHtcbiAgICAgIHJldHVybiBoYW5kbGVyKGNvbW1hbmRMaW5lWzBdKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNvbW1hbmRMaW5lO1xufVxuXG5mdW5jdGlvbiBjb250ZXh0T3ZlcmZsb3dDbGVhbnVwKGxvY2F0aW9uOiBzdHJpbmcgfCB1bmRlZmluZWQsIGFzc2VtYmx5OiBjeGFwaS5DbG91ZEFzc2VtYmx5KSB7XG4gIGlmIChsb2NhdGlvbikge1xuICAgIGZzLnJlbW92ZVN5bmMocGF0aC5kaXJuYW1lKGxvY2F0aW9uKSk7XG5cbiAgICBjb25zdCB0cmVlID0gbG9hZFRyZWUoYXNzZW1ibHkpO1xuICAgIGNvbnN0IGZyYW1ld29ya0RvZXNOb3RTdXBwb3J0Q29udGV4dE92ZXJmbG93ID0gc29tZSh0cmVlLCBub2RlID0+IHtcbiAgICAgIGNvbnN0IGZxbiA9IG5vZGUuY29uc3RydWN0SW5mbz8uZnFuO1xuICAgICAgY29uc3QgdmVyc2lvbiA9IG5vZGUuY29uc3RydWN0SW5mbz8udmVyc2lvbjtcbiAgICAgIHJldHVybiAoZnFuID09PSAnYXdzLWNkay1saWIuQXBwJyAmJiB2ZXJzaW9uICE9IG51bGwgJiYgc2VtdmVyLmx0ZSh2ZXJzaW9uLCAnMi4zOC4wJykpXG4gICAgICAgIHx8IGZxbiA9PT0gJ0Bhd3MtY2RrL2NvcmUuQXBwJzsgLy8gdjFcbiAgICB9KTtcblxuICAgIC8vIFdlJ3JlIGRlYWxpbmcgd2l0aCBhbiBvbGQgdmVyc2lvbiBvZiB0aGUgZnJhbWV3b3JrIGhlcmUuIEl0IGlzIHVuYXdhcmUgb2YgdGhlIHRlbXBvcmFyeVxuICAgIC8vIGZpbGUsIHdoaWNoIG1lYW5zIHRoYXQgaXQgd2lsbCBpZ25vcmUgdGhlIGNvbnRleHQgb3ZlcmZsb3cuXG4gICAgaWYgKGZyYW1ld29ya0RvZXNOb3RTdXBwb3J0Q29udGV4dE92ZXJmbG93KSB7XG4gICAgICB3YXJuaW5nKCdQYXJ0IG9mIHRoZSBjb250ZXh0IGNvdWxkIG5vdCBiZSBzZW50IHRvIHRoZSBhcHBsaWNhdGlvbi4gUGxlYXNlIHVwZGF0ZSB0aGUgQVdTIENESyBsaWJyYXJ5IHRvIHRoZSBsYXRlc3QgdmVyc2lvbi4nKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gc3BhY2VBdmFpbGFibGVGb3JDb250ZXh0KGVudjogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSwgbGltaXQ6IG51bWJlcikge1xuICBjb25zdCBzaXplID0gKHZhbHVlOiBzdHJpbmcpID0+IHZhbHVlICE9IG51bGwgPyBCdWZmZXIuYnl0ZUxlbmd0aCh2YWx1ZSkgOiAwO1xuXG4gIGNvbnN0IHVzZWRTcGFjZSA9IE9iamVjdC5lbnRyaWVzKGVudilcbiAgICAubWFwKChbaywgdl0pID0+IGsgPT09IGN4YXBpLkNPTlRFWFRfRU5WID8gc2l6ZShrKSA6IHNpemUoaykgKyBzaXplKHYpKVxuICAgIC5yZWR1Y2UoKGEsIGIpID0+IGEgKyBiLCAwKTtcblxuICByZXR1cm4gTWF0aC5tYXgoMCwgbGltaXQgLSB1c2VkU3BhY2UpO1xufVxuIl19