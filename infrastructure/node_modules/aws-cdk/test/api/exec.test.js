"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable import/order */
jest.mock('child_process');
const cdk_build_tools_1 = require("@aws-cdk/cdk-build-tools");
const cxschema = require("@aws-cdk/cloud-assembly-schema");
const cdk = require("aws-cdk-lib");
const semver = require("semver");
const sinon = require("sinon");
const ts_mock_imports_1 = require("ts-mock-imports");
const exec_1 = require("../../lib/api/cxapp/exec");
const logging_1 = require("../../lib/logging");
const settings_1 = require("../../lib/settings");
const util_1 = require("../util");
const mock_child_process_1 = require("../util/mock-child_process");
const mock_sdk_1 = require("../util/mock-sdk");
const rwlock_1 = require("../../lib/api/util/rwlock");
const assembly_versions_1 = require("./assembly-versions");
let sdkProvider;
let config;
beforeEach(() => {
    (0, logging_1.setLogLevel)(logging_1.LogLevel.DEBUG);
    sdkProvider = new mock_sdk_1.MockSdkProvider();
    config = new settings_1.Configuration();
    config.settings.set(['output'], 'cdk.out');
    // insert contents in fake filesystem
    (0, cdk_build_tools_1.bockfs)({
        '/home/project/cloud-executable': 'ARBITRARY',
        '/home/project/windows.js': 'ARBITRARY',
        'home/project/executable-app.js': 'ARBITRARY',
    });
    cdk_build_tools_1.bockfs.workingDirectory('/home/project');
    cdk_build_tools_1.bockfs.executable('/home/project/cloud-executable');
    cdk_build_tools_1.bockfs.executable('/home/project/executable-app.js');
});
afterEach(() => {
    (0, logging_1.setLogLevel)(logging_1.LogLevel.INFO);
    sinon.restore();
    cdk_build_tools_1.bockfs.restore();
});
// We need to increase the default 5s jest
// timeout for async tests because the 'execProgram' invocation
// might take a while :\
const TEN_SECOND_TIMEOUT = 10000;
function createApp() {
    const app = new cdk.App({ outdir: 'cdk.out' });
    const stack = new cdk.Stack(app, 'Stack');
    new cdk.CfnResource(stack, 'Role', {
        type: 'AWS::IAM::Role',
        properties: {
            RoleName: 'Role',
        },
    });
    return app;
}
test('cli throws when manifest version > schema version', async () => {
    const app = createApp();
    const currentSchemaVersion = cxschema.Manifest.version();
    const mockManifestVersion = semver.inc(currentSchemaVersion, 'major');
    // this mock will cause the framework to use a greater schema version than the real one,
    // and should cause the CLI to fail.
    const mockVersionNumber = ts_mock_imports_1.ImportMock.mockFunction(cxschema.Manifest, 'version', mockManifestVersion);
    try {
        app.synth();
    }
    finally {
        mockVersionNumber.restore();
    }
    (0, assembly_versions_1.rewriteManifestVersion)('cdk.out', `${mockManifestVersion}`);
    const expectedError = 'This CDK CLI is not compatible with the CDK library used by your application. Please upgrade the CLI to the latest version.'
        + `\n(Cloud assembly schema version mismatch: Maximum schema version supported is ${semver.major(currentSchemaVersion)}.x.x, but found ${mockManifestVersion})`;
    config.settings.set(['app'], 'cdk.out');
    await expect((0, exec_1.execProgram)(sdkProvider, config)).rejects.toEqual(new Error(expectedError));
}, TEN_SECOND_TIMEOUT);
test('cli does not throw when manifest version = schema version', async () => {
    const app = createApp();
    app.synth();
    rewriteManifestVersionToOurs();
    config.settings.set(['app'], 'cdk.out');
    const { lock } = await (0, exec_1.execProgram)(sdkProvider, config);
    await lock.release();
}, TEN_SECOND_TIMEOUT);
// Why do we have to do something here at all? Because `aws-cdk-lib` has its own version of `cloud-assembly-schema`,
// which will have real version `38.0.0`, different from the `0.0.0` version of `cloud-assembly-schema` that the CLI
// uses.
//
// Since our Cloud Assembly Schema version will be `0.0.0` and there is no such thing as `-1.0.0`, this test doesn't
// make any sense anymore.
// eslint-disable-next-line jest/no-disabled-tests
test.skip('cli does not throw when manifest version < schema version', async () => {
    const app = createApp();
    const currentSchemaVersion = cxschema.Manifest.version();
    app.synth();
    rewriteManifestVersionToOurs();
    config.settings.set(['app'], 'cdk.out');
    // this mock will cause the cli to think its exepcted schema version is
    // greater that the version created in the manifest, which is what we are testing for.
    const mockVersionNumber = ts_mock_imports_1.ImportMock.mockFunction(cxschema.Manifest, 'version', semver.inc(currentSchemaVersion, 'major'));
    try {
        const { lock } = await (0, exec_1.execProgram)(sdkProvider, config);
        await lock.release();
    }
    finally {
        mockVersionNumber.restore();
    }
}, TEN_SECOND_TIMEOUT);
test('validates --app key is present', async () => {
    // GIVEN no config key for `app`
    await expect((0, exec_1.execProgram)(sdkProvider, config)).rejects.toThrow('--app is required either in command-line, in cdk.json or in ~/.cdk.json');
});
test('bypasses synth when app points to a cloud assembly', async () => {
    // GIVEN
    config.settings.set(['app'], 'cdk.out');
    writeOutputAssembly();
    rewriteManifestVersionToOurs();
    // WHEN
    const { assembly: cloudAssembly, lock } = await (0, exec_1.execProgram)(sdkProvider, config);
    expect(cloudAssembly.artifacts).toEqual([]);
    expect(cloudAssembly.directory).toEqual('cdk.out');
    await lock.release();
});
test('the application set in --app is executed', async () => {
    // GIVEN
    config.settings.set(['app'], 'cloud-executable');
    (0, mock_child_process_1.mockSpawn)({
        commandLine: 'cloud-executable',
        sideEffect: () => writeOutputAssembly(),
    });
    // WHEN
    const { lock } = await (0, exec_1.execProgram)(sdkProvider, config);
    await lock.release();
});
test('the application set in --app is executed as-is if it contains a filename that does not exist', async () => {
    // GIVEN
    config.settings.set(['app'], 'does-not-exist');
    (0, mock_child_process_1.mockSpawn)({
        commandLine: 'does-not-exist',
        sideEffect: () => writeOutputAssembly(),
    });
    // WHEN
    const { lock } = await (0, exec_1.execProgram)(sdkProvider, config);
    await lock.release();
});
test('the application set in --app is executed with arguments', async () => {
    // GIVEN
    config.settings.set(['app'], 'cloud-executable an-arg');
    (0, mock_child_process_1.mockSpawn)({
        commandLine: 'cloud-executable an-arg',
        sideEffect: () => writeOutputAssembly(),
    });
    // WHEN
    const { lock } = await (0, exec_1.execProgram)(sdkProvider, config);
    await lock.release();
});
test('application set in --app as `*.js` always uses handler on windows', async () => {
    // GIVEN
    sinon.stub(process, 'platform').value('win32');
    config.settings.set(['app'], 'windows.js');
    (0, mock_child_process_1.mockSpawn)({
        commandLine: process.execPath + ' windows.js',
        sideEffect: () => writeOutputAssembly(),
    });
    // WHEN
    const { lock } = await (0, exec_1.execProgram)(sdkProvider, config);
    await lock.release();
});
test('application set in --app is `*.js` and executable', async () => {
    // GIVEN
    config.settings.set(['app'], 'executable-app.js');
    (0, mock_child_process_1.mockSpawn)({
        commandLine: 'executable-app.js',
        sideEffect: () => writeOutputAssembly(),
    });
    // WHEN
    const { lock } = await (0, exec_1.execProgram)(sdkProvider, config);
    await lock.release();
});
test('cli throws when the `build` script fails', async () => {
    // GIVEN
    config.settings.set(['build'], 'fake-command');
    (0, mock_child_process_1.mockSpawn)({
        commandLine: 'fake-command',
        exitCode: 127,
    });
    // WHEN
    await expect((0, exec_1.execProgram)(sdkProvider, config)).rejects.toEqual(new Error('Subprocess exited with error 127'));
}, TEN_SECOND_TIMEOUT);
test('cli does not throw when the `build` script succeeds', async () => {
    // GIVEN
    config.settings.set(['build'], 'real command');
    config.settings.set(['app'], 'executable-app.js');
    (0, mock_child_process_1.mockSpawn)({
        commandLine: 'real command', // `build` key is not split on whitespace
        exitCode: 0,
    }, {
        commandLine: 'executable-app.js',
        sideEffect: () => writeOutputAssembly(),
    });
    // WHEN
    const { lock } = await (0, exec_1.execProgram)(sdkProvider, config);
    await lock.release();
}, TEN_SECOND_TIMEOUT);
test('cli releases the outdir lock when execProgram throws', async () => {
    // GIVEN
    config.settings.set(['app'], 'cloud-executable');
    (0, mock_child_process_1.mockSpawn)({
        commandLine: 'fake-command',
        exitCode: 127,
    });
    // WHEN
    await expect((0, exec_1.execProgram)(sdkProvider, config)).rejects.toThrow();
    const output = config.settings.get(['output']);
    expect(output).toBeDefined();
    // check that the lock is released
    const lock = await new rwlock_1.RWLock(output).acquireWrite();
    await lock.release();
});
function writeOutputAssembly() {
    const asm = (0, util_1.testAssembly)({
        stacks: [],
    });
    cdk_build_tools_1.bockfs.write('/home/project/cdk.out/manifest.json', JSON.stringify(asm.manifest));
    rewriteManifestVersionToOurs(cdk_build_tools_1.bockfs.path('/home/project/cdk.out'));
}
/**
 * Rewrite the manifest schema version in the given directory to match the version number we expect (probably `0.0.0`).
 *
 * Why do we have to do this? Because `aws-cdk-lib` has its own version of `cloud-assembly-schema`,
 * which will have real version `38.0.0`, different from the `0.0.0` version of `cloud-assembly-schema` that the CLI
 * uses.
 *
 * If we don't do this, every time we load a Cloud Assembly the code will say "Maximum schema version supported is 0.x.x, but found 30.0.0".0
 */
function rewriteManifestVersionToOurs(dir = 'cdk.out') {
    (0, assembly_versions_1.rewriteManifestVersion)(dir, cxschema.Manifest.version());
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXhlYy50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZXhlYy50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsaUNBQWlDO0FBQ2pDLElBQUksQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUM7QUFDM0IsOERBQWtEO0FBQ2xELDJEQUEyRDtBQUMzRCxtQ0FBbUM7QUFDbkMsaUNBQWlDO0FBQ2pDLCtCQUErQjtBQUMvQixxREFBNkM7QUFDN0MsbURBQXVEO0FBQ3ZELCtDQUEwRDtBQUMxRCxpREFBbUQ7QUFDbkQsa0NBQXVDO0FBQ3ZDLG1FQUF1RDtBQUN2RCwrQ0FBbUQ7QUFDbkQsc0RBQW1EO0FBQ25ELDJEQUE2RDtBQUU3RCxJQUFJLFdBQTRCLENBQUM7QUFDakMsSUFBSSxNQUFxQixDQUFDO0FBQzFCLFVBQVUsQ0FBQyxHQUFHLEVBQUU7SUFDZCxJQUFBLHFCQUFXLEVBQUMsa0JBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUU1QixXQUFXLEdBQUcsSUFBSSwwQkFBZSxFQUFFLENBQUM7SUFDcEMsTUFBTSxHQUFHLElBQUksd0JBQWEsRUFBRSxDQUFDO0lBRTdCLE1BQU0sQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsUUFBUSxDQUFDLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFFM0MscUNBQXFDO0lBQ3JDLElBQUEsd0JBQU0sRUFBQztRQUNMLGdDQUFnQyxFQUFFLFdBQVc7UUFDN0MsMEJBQTBCLEVBQUUsV0FBVztRQUN2QyxnQ0FBZ0MsRUFBRSxXQUFXO0tBQzlDLENBQUMsQ0FBQztJQUNILHdCQUFNLENBQUMsZ0JBQWdCLENBQUMsZUFBZSxDQUFDLENBQUM7SUFDekMsd0JBQU0sQ0FBQyxVQUFVLENBQUMsZ0NBQWdDLENBQUMsQ0FBQztJQUNwRCx3QkFBTSxDQUFDLFVBQVUsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO0FBQ3ZELENBQUMsQ0FBQyxDQUFDO0FBRUgsU0FBUyxDQUFDLEdBQUcsRUFBRTtJQUNi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QU0sQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO0lBRTdCLGtDQUFrQztJQUNsQyxNQUFNLElBQUksR0FBRyxNQUFNLElBQUksZUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLFlBQVksRUFBRSxDQUFDO0lBQ3JELE1BQU0sSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO0FBQ3ZCLENBQUMsQ0FBQyxDQUFDO0FBRUgsU0FBUyxtQkFBbUI7SUFDMUIsTUFBTSxHQUFHLEdBQUcsSUFBQSxtQkFBWSxFQUFDO1FBQ3ZCLE1BQU0sRUFBRSxFQUFFO0tBQ1gsQ0FBQyxDQUFDO0lBQ0gsd0JBQU0sQ0FBQyxLQUFLLENBQUMscUNBQXFDLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztJQUNsRiw0QkFBNEIsQ0FBQyx3QkFBTSxDQUFDLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxDQUFDLENBQUM7QUFDckUsQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsU0FBUyw0QkFBNEIsQ0FBQyxNQUFjLFNBQVM7SUFDM0QsSUFBQSwwQ0FBc0IsRUFBQyxHQUFHLEVBQUUsUUFBUSxDQUFDLFFBQVEsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO0FBQzNELENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKiBlc2xpbnQtZGlzYWJsZSBpbXBvcnQvb3JkZXIgKi9cbmplc3QubW9jaygnY2hpbGRfcHJvY2VzcycpO1xuaW1wb3J0IHsgYm9ja2ZzIH0gZnJvbSAnQGF3cy1jZGsvY2RrLWJ1aWxkLXRvb2xzJztcbmltcG9ydCAqIGFzIGN4c2NoZW1hIGZyb20gJ0Bhd3MtY2RrL2Nsb3VkLWFzc2VtYmx5LXNjaGVtYSc7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgc2VtdmVyIGZyb20gJ3NlbXZlcic7XG5pbXBvcnQgKiBhcyBzaW5vbiBmcm9tICdzaW5vbic7XG5pbXBvcnQgeyBJbXBvcnRNb2NrIH0gZnJvbSAndHMtbW9jay1pbXBvcnRzJztcbmltcG9ydCB7IGV4ZWNQcm9ncmFtIH0gZnJvbSAnLi4vLi4vbGliL2FwaS9jeGFwcC9leGVjJztcbmltcG9ydCB7IExvZ0xldmVsLCBzZXRMb2dMZXZlbCB9IGZyb20gJy4uLy4uL2xpYi9sb2dnaW5nJztcbmltcG9ydCB7IENvbmZpZ3VyYXRpb24gfSBmcm9tICcuLi8uLi9saWIvc2V0dGluZ3MnO1xuaW1wb3J0IHsgdGVzdEFzc2VtYmx5IH0gZnJvbSAnLi4vdXRpbCc7XG5pbXBvcnQgeyBtb2NrU3Bhd24gfSBmcm9tICcuLi91dGlsL21vY2stY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBNb2NrU2RrUHJvdmlkZXIgfSBmcm9tICcuLi91dGlsL21vY2stc2RrJztcbmltcG9ydCB7IFJXTG9jayB9IGZyb20gJy4uLy4uL2xpYi9hcGkvdXRpbC9yd2xvY2snO1xuaW1wb3J0IHsgcmV3cml0ZU1hbmlmZXN0VmVyc2lvbiB9IGZyb20gJy4vYXNzZW1ibHktdmVyc2lvbnMnO1xuXG5sZXQgc2RrUHJvdmlkZXI6IE1vY2tTZGtQcm92aWRlcjtcbmxldCBjb25maWc6IENvbmZpZ3VyYXRpb247XG5iZWZvcmVFYWNoKCgpID0+IHtcbiAgc2V0TG9nTGV2ZWwoTG9nTGV2ZWwuREVCVUcpO1xuXG4gIHNka1Byb3ZpZGVyID0gbmV3IE1vY2tTZGtQcm92aWRlcigpO1xuICBjb25maWcgPSBuZXcgQ29uZmlndXJhdGlvbigpO1xuXG4gIGNvbmZpZy5zZXR0aW5ncy5zZXQoWydvdXRwdXQnXSwgJ2Nkay5vdXQnKTtcblxuICAvLyBpbnNlcnQgY29udGVudHMgaW4gZmFrZSBmaWxlc3lzdGVtXG4gIGJvY2tmcyh7XG4gICAgJy9ob21lL3Byb2plY3QvY2xvdWQtZXhlY3V0YWJsZSc6ICdBUkJJVFJBUlknLFxuICAgICcvaG9tZS9wcm9qZWN0L3dpbmRvd3MuanMnOiAnQVJCSVRSQVJZJyxcbiAgICAnaG9tZS9wcm9qZWN0L2V4ZWN1dGFibGUtYXBwLmpzJzogJ0FSQklUUkFSWScsXG4gIH0pO1xuICBib2NrZnMud29ya2luZ0RpcmVjdG9yeSgnL2hvbWUvcHJvamVjdCcpO1xuICBib2NrZnMuZXhlY3V0YWJsZSgnL2hvbWUvcHJvamVjdC9jbG91ZC1leGVjdXRhYmxlJyk7XG4gIGJvY2tmcy5leGVjdXRhYmxlKCcvaG9tZS9wcm9qZWN0L2V4ZWN1dGFibGUtYXBwLmpzJyk7XG59KTtcblxuYWZ0ZXJFYWNoKCgpID0+IHtcbiAgc2V0TG9nTGV2ZWwoTG9nTGV2ZWwuSU5GTyk7XG5cbiAgc2lub24ucmVzdG9yZSgpO1xuICBib2NrZnMucmVzdG9yZSgpO1xufSk7XG5cbi8vIFdlIG5lZWQgdG8gaW5jcmVhc2UgdGhlIGRlZmF1bHQgNXMgamVzdFxuLy8gdGltZW91dCBmb3IgYXN5bmMgdGVzdHMgYmVjYXVzZSB0aGUgJ2V4ZWNQcm9ncmFtJyBpbnZvY2F0aW9uXG4vLyBtaWdodCB0YWtlIGEgd2hpbGUgOlxcXG5jb25zdCBURU5fU0VDT05EX1RJTUVPVVQgPSAxMDAwMDtcblxuZnVuY3Rpb24gY3JlYXRlQXBwKCk6IGNkay5BcHAge1xuICBjb25zdCBhcHAgPSBuZXcgY2RrLkFwcCh7IG91dGRpcjogJ2Nkay5vdXQnIH0pO1xuICBjb25zdCBzdGFjayA9IG5ldyBjZGsuU3RhY2soYXBwLCAnU3RhY2snKTtcblxuICBuZXcgY2RrLkNmblJlc291cmNlKHN0YWNrLCAnUm9sZScsIHtcbiAgICB0eXBlOiAnQVdTOjpJQU06OlJvbGUnLFxuICAgIHByb3BlcnRpZXM6IHtcbiAgICAgIFJvbGVOYW1lOiAnUm9sZScsXG4gICAgfSxcbiAgfSk7XG5cbiAgcmV0dXJuIGFwcDtcbn1cblxudGVzdCgnY2xpIHRocm93cyB3aGVuIG1hbmlmZXN0IHZlcnNpb24gPiBzY2hlbWEgdmVyc2lvbicsIGFzeW5jICgpID0+IHtcblxuICBjb25zdCBhcHAgPSBjcmVhdGVBcHAoKTtcbiAgY29uc3QgY3VycmVudFNjaGVtYVZlcnNpb24gPSBjeHNjaGVtYS5NYW5pZmVzdC52ZXJzaW9uKCk7XG4gIGNvbnN0IG1vY2tNYW5pZmVzdFZlcnNpb24gPSBzZW12ZXIuaW5jKGN1cnJlbnRTY2hlbWFWZXJzaW9uLCAnbWFqb3InKTtcblxuICAvLyB0aGlzIG1vY2sgd2lsbCBjYXVzZSB0aGUgZnJhbWV3b3JrIHRvIHVzZSBhIGdyZWF0ZXIgc2NoZW1hIHZlcnNpb24gdGhhbiB0aGUgcmVhbCBvbmUsXG4gIC8vIGFuZCBzaG91bGQgY2F1c2UgdGhlIENMSSB0byBmYWlsLlxuICBjb25zdCBtb2NrVmVyc2lvbk51bWJlciA9IEltcG9ydE1vY2subW9ja0Z1bmN0aW9uKGN4c2NoZW1hLk1hbmlmZXN0LCAndmVyc2lvbicsIG1vY2tNYW5pZmVzdFZlcnNpb24pO1xuICB0cnkge1xuICAgIGFwcC5zeW50aCgpO1xuICB9IGZpbmFsbHkge1xuICAgIG1vY2tWZXJzaW9uTnVtYmVyLnJlc3RvcmUoKTtcbiAgfVxuXG4gIHJld3JpdGVNYW5pZmVzdFZlcnNpb24oJ2Nkay5vdXQnLCBgJHttb2NrTWFuaWZlc3RWZXJzaW9ufWApO1xuXG4gIGNvbnN0IGV4cGVjdGVkRXJyb3IgPSAnVGhpcyBDREsgQ0xJIGlzIG5vdCBjb21wYXRpYmxlIHdpdGggdGhlIENESyBsaWJyYXJ5IHVzZWQgYnkgeW91ciBhcHBsaWNhdGlvbi4gUGxlYXNlIHVwZ3JhZGUgdGhlIENMSSB0byB0aGUgbGF0ZXN0IHZlcnNpb24uJ1xuICAgICsgYFxcbihDbG91ZCBhc3NlbWJseSBzY2hlbWEgdmVyc2lvbiBtaXNtYXRjaDogTWF4aW11bSBzY2hlbWEgdmVyc2lvbiBzdXBwb3J0ZWQgaXMgJHtzZW12ZXIubWFqb3IoY3VycmVudFNjaGVtYVZlcnNpb24pfS54LngsIGJ1dCBmb3VuZCAke21vY2tNYW5pZmVzdFZlcnNpb259KWA7XG5cbiAgY29uZmlnLnNldHRpbmdzLnNldChbJ2FwcCddLCAnY2RrLm91dCcpO1xuXG4gIGF3YWl0IGV4cGVjdChleGVjUHJvZ3JhbShzZGtQcm92aWRlciwgY29uZmlnKSkucmVqZWN0cy50b0VxdWFsKG5ldyBFcnJvcihleHBlY3RlZEVycm9yKSk7XG5cbn0sIFRFTl9TRUNPTkRfVElNRU9VVCk7XG5cbnRlc3QoJ2NsaSBkb2VzIG5vdCB0aHJvdyB3aGVuIG1hbmlmZXN0IHZlcnNpb24gPSBzY2hlbWEgdmVyc2lvbicsIGFzeW5jICgpID0+IHtcblxuICBjb25zdCBhcHAgPSBjcmVhdGVBcHAoKTtcbiAgYXBwLnN5bnRoKCk7XG5cbiAgcmV3cml0ZU1hbmlmZXN0VmVyc2lvblRvT3VycygpO1xuXG4gIGNvbmZpZy5zZXR0aW5ncy5zZXQoWydhcHAnXSwgJ2Nkay5vdXQnKTtcblxuICBjb25zdCB7IGxvY2sgfSA9IGF3YWl0IGV4ZWNQcm9ncmFtKHNka1Byb3ZpZGVyLCBjb25maWcpO1xuICBhd2FpdCBsb2NrLnJlbGVhc2UoKTtcblxufSwgVEVOX1NFQ09ORF9USU1FT1VUKTtcblxuLy8gV2h5IGRvIHdlIGhhdmUgdG8gZG8gc29tZXRoaW5nIGhlcmUgYXQgYWxsPyBCZWNhdXNlIGBhd3MtY2RrLWxpYmAgaGFzIGl0cyBvd24gdmVyc2lvbiBvZiBgY2xvdWQtYXNzZW1ibHktc2NoZW1hYCxcbi8vIHdoaWNoIHdpbGwgaGF2ZSByZWFsIHZlcnNpb24gYDM4LjAuMGAsIGRpZmZlcmVudCBmcm9tIHRoZSBgMC4wLjBgIHZlcnNpb24gb2YgYGNsb3VkLWFzc2VtYmx5LXNjaGVtYWAgdGhhdCB0aGUgQ0xJXG4vLyB1c2VzLlxuLy9cbi8vIFNpbmNlIG91ciBDbG91ZCBBc3NlbWJseSBTY2hlbWEgdmVyc2lvbiB3aWxsIGJlIGAwLjAuMGAgYW5kIHRoZXJlIGlzIG5vIHN1Y2ggdGhpbmcgYXMgYC0xLjAuMGAsIHRoaXMgdGVzdCBkb2Vzbid0XG4vLyBtYWtlIGFueSBzZW5zZSBhbnltb3JlLlxuLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIGplc3Qvbm8tZGlzYWJsZWQtdGVzdHNcbnRlc3Quc2tpcCgnY2xpIGRvZXMgbm90IHRocm93IHdoZW4gbWFuaWZlc3QgdmVyc2lvbiA8IHNjaGVtYSB2ZXJzaW9uJywgYXN5bmMgKCkgPT4ge1xuXG4gIGNvbnN0IGFwcCA9IGNyZWF0ZUFwcCgpO1xuICBjb25zdCBjdXJyZW50U2NoZW1hVmVyc2lvbiA9IGN4c2NoZW1hLk1hbmlmZXN0LnZlcnNpb24oKTtcblxuICBhcHAuc3ludGgoKTtcblxuICByZXdyaXRlTWFuaWZlc3RWZXJzaW9uVG9PdXJzKCk7XG5cbiAgY29uZmlnLnNldHRpbmdzLnNldChbJ2FwcCddLCAnY2RrLm91dCcpO1xuXG4gIC8vIHRoaXMgbW9jayB3aWxsIGNhdXNlIHRoZSBjbGkgdG8gdGhpbmsgaXRzIGV4ZXBjdGVkIHNjaGVtYSB2ZXJzaW9uIGlzXG4gIC8vIGdyZWF0ZXIgdGhhdCB0aGUgdmVyc2lvbiBjcmVhdGVkIGluIHRoZSBtYW5pZmVzdCwgd2hpY2ggaXMgd2hhdCB3ZSBhcmUgdGVzdGluZyBmb3IuXG4gIGNvbnN0IG1vY2tWZXJzaW9uTnVtYmVyID0gSW1wb3J0TW9jay5tb2NrRnVuY3Rpb24oY3hzY2hlbWEuTWFuaWZlc3QsICd2ZXJzaW9uJywgc2VtdmVyLmluYyhjdXJyZW50U2NoZW1hVmVyc2lvbiwgJ21ham9yJykpO1xuICB0cnkge1xuICAgIGNvbnN0IHsgbG9jayB9ID0gYXdhaXQgZXhlY1Byb2dyYW0oc2RrUHJvdmlkZXIsIGNvbmZpZyk7XG4gICAgYXdhaXQgbG9jay5yZWxlYXNlKCk7XG4gIH0gZmluYWxseSB7XG4gICAgbW9ja1ZlcnNpb25OdW1iZXIucmVzdG9yZSgpO1xuICB9XG5cbn0sIFRFTl9TRUNPTkRfVElNRU9VVCk7XG5cbnRlc3QoJ3ZhbGlkYXRlcyAtLWFwcCBrZXkgaXMgcHJlc2VudCcsIGFzeW5jICgpID0+IHtcbiAgLy8gR0lWRU4gbm8gY29uZmlnIGtleSBmb3IgYGFwcGBcbiAgYXdhaXQgZXhwZWN0KGV4ZWNQcm9ncmFtKHNka1Byb3ZpZGVyLCBjb25maWcpKS5yZWplY3RzLnRvVGhyb3coXG4gICAgJy0tYXBwIGlzIHJlcXVpcmVkIGVpdGhlciBpbiBjb21tYW5kLWxpbmUsIGluIGNkay5qc29uIG9yIGluIH4vLmNkay5qc29uJyxcbiAgKTtcblxufSk7XG5cbnRlc3QoJ2J5cGFzc2VzIHN5bnRoIHdoZW4gYXBwIHBvaW50cyB0byBhIGNsb3VkIGFzc2VtYmx5JywgYXN5bmMgKCkgPT4ge1xuICAvLyBHSVZFTlxuICBjb25maWcuc2V0dGluZ3Muc2V0KFsnYXBwJ10sICdjZGsub3V0Jyk7XG4gIHdyaXRlT3V0cHV0QXNzZW1ibHkoKTtcbiAgcmV3cml0ZU1hbmlmZXN0VmVyc2lvblRvT3VycygpO1xuXG4gIC8vIFdIRU5cbiAgY29uc3QgeyBhc3NlbWJseTogY2xvdWRBc3NlbWJseSwgbG9jayB9ID0gYXdhaXQgZXhlY1Byb2dyYW0oc2RrUHJvdmlkZXIsIGNvbmZpZyk7XG4gIGV4cGVjdChjbG91ZEFzc2VtYmx5LmFydGlmYWN0cykudG9FcXVhbChbXSk7XG4gIGV4cGVjdChjbG91ZEFzc2VtYmx5LmRpcmVjdG9yeSkudG9FcXVhbCgnY2RrLm91dCcpO1xuXG4gIGF3YWl0IGxvY2sucmVsZWFzZSgpO1xufSk7XG5cbnRlc3QoJ3RoZSBhcHBsaWNhdGlvbiBzZXQgaW4gLS1hcHAgaXMgZXhlY3V0ZWQnLCBhc3luYyAoKSA9PiB7XG4gIC8vIEdJVkVOXG4gIGNvbmZpZy5zZXR0aW5ncy5zZXQoWydhcHAnXSwgJ2Nsb3VkLWV4ZWN1dGFibGUnKTtcbiAgbW9ja1NwYXduKHtcbiAgICBjb21tYW5kTGluZTogJ2Nsb3VkLWV4ZWN1dGFibGUnLFxuICAgIHNpZGVFZmZlY3Q6ICgpID0+IHdyaXRlT3V0cHV0QXNzZW1ibHkoKSxcbiAgfSk7XG5cbiAgLy8gV0hFTlxuICBjb25zdCB7IGxvY2sgfSA9IGF3YWl0IGV4ZWNQcm9ncmFtKHNka1Byb3ZpZGVyLCBjb25maWcpO1xuICBhd2FpdCBsb2NrLnJlbGVhc2UoKTtcbn0pO1xuXG50ZXN0KCd0aGUgYXBwbGljYXRpb24gc2V0IGluIC0tYXBwIGlzIGV4ZWN1dGVkIGFzLWlzIGlmIGl0IGNvbnRhaW5zIGEgZmlsZW5hbWUgdGhhdCBkb2VzIG5vdCBleGlzdCcsIGFzeW5jICgpID0+IHtcbiAgLy8gR0lWRU5cbiAgY29uZmlnLnNldHRpbmdzLnNldChbJ2FwcCddLCAnZG9lcy1ub3QtZXhpc3QnKTtcbiAgbW9ja1NwYXduKHtcbiAgICBjb21tYW5kTGluZTogJ2RvZXMtbm90LWV4aXN0JyxcbiAgICBzaWRlRWZmZWN0OiAoKSA9PiB3cml0ZU91dHB1dEFzc2VtYmx5KCksXG4gIH0pO1xuXG4gIC8vIFdIRU5cbiAgY29uc3QgeyBsb2NrIH0gPSBhd2FpdCBleGVjUHJvZ3JhbShzZGtQcm92aWRlciwgY29uZmlnKTtcbiAgYXdhaXQgbG9jay5yZWxlYXNlKCk7XG59KTtcblxudGVzdCgndGhlIGFwcGxpY2F0aW9uIHNldCBpbiAtLWFwcCBpcyBleGVjdXRlZCB3aXRoIGFyZ3VtZW50cycsIGFzeW5jICgpID0+IHtcbiAgLy8gR0lWRU5cbiAgY29uZmlnLnNldHRpbmdzLnNldChbJ2FwcCddLCAnY2xvdWQtZXhlY3V0YWJsZSBhbi1hcmcnKTtcbiAgbW9ja1NwYXduKHtcbiAgICBjb21tYW5kTGluZTogJ2Nsb3VkLWV4ZWN1dGFibGUgYW4tYXJnJyxcbiAgICBzaWRlRWZmZWN0OiAoKSA9PiB3cml0ZU91dHB1dEFzc2VtYmx5KCksXG4gIH0pO1xuXG4gIC8vIFdIRU5cbiAgY29uc3QgeyBsb2NrIH0gPSBhd2FpdCBleGVjUHJvZ3JhbShzZGtQcm92aWRlciwgY29uZmlnKTtcbiAgYXdhaXQgbG9jay5yZWxlYXNlKCk7XG59KTtcblxudGVzdCgnYXBwbGljYXRpb24gc2V0IGluIC0tYXBwIGFzIGAqLmpzYCBhbHdheXMgdXNlcyBoYW5kbGVyIG9uIHdpbmRvd3MnLCBhc3luYyAoKSA9PiB7XG4gIC8vIEdJVkVOXG4gIHNpbm9uLnN0dWIocHJvY2VzcywgJ3BsYXRmb3JtJykudmFsdWUoJ3dpbjMyJyk7XG4gIGNvbmZpZy5zZXR0aW5ncy5zZXQoWydhcHAnXSwgJ3dpbmRvd3MuanMnKTtcbiAgbW9ja1NwYXduKHtcbiAgICBjb21tYW5kTGluZTogcHJvY2Vzcy5leGVjUGF0aCArICcgd2luZG93cy5qcycsXG4gICAgc2lkZUVmZmVjdDogKCkgPT4gd3JpdGVPdXRwdXRBc3NlbWJseSgpLFxuICB9KTtcblxuICAvLyBXSEVOXG4gIGNvbnN0IHsgbG9jayB9ID0gYXdhaXQgZXhlY1Byb2dyYW0oc2RrUHJvdmlkZXIsIGNvbmZpZyk7XG4gIGF3YWl0IGxvY2sucmVsZWFzZSgpO1xufSk7XG5cbnRlc3QoJ2FwcGxpY2F0aW9uIHNldCBpbiAtLWFwcCBpcyBgKi5qc2AgYW5kIGV4ZWN1dGFibGUnLCBhc3luYyAoKSA9PiB7XG4gIC8vIEdJVkVOXG4gIGNvbmZpZy5zZXR0aW5ncy5zZXQoWydhcHAnXSwgJ2V4ZWN1dGFibGUtYXBwLmpzJyk7XG4gIG1vY2tTcGF3bih7XG4gICAgY29tbWFuZExpbmU6ICdleGVjdXRhYmxlLWFwcC5qcycsXG4gICAgc2lkZUVmZmVjdDogKCkgPT4gd3JpdGVPdXRwdXRBc3NlbWJseSgpLFxuICB9KTtcblxuICAvLyBXSEVOXG4gIGNvbnN0IHsgbG9jayB9ID0gYXdhaXQgZXhlY1Byb2dyYW0oc2RrUHJvdmlkZXIsIGNvbmZpZyk7XG4gIGF3YWl0IGxvY2sucmVsZWFzZSgpO1xufSk7XG5cbnRlc3QoJ2NsaSB0aHJvd3Mgd2hlbiB0aGUgYGJ1aWxkYCBzY3JpcHQgZmFpbHMnLCBhc3luYyAoKSA9PiB7XG4gIC8vIEdJVkVOXG4gIGNvbmZpZy5zZXR0aW5ncy5zZXQoWydidWlsZCddLCAnZmFrZS1jb21tYW5kJyk7XG4gIG1vY2tTcGF3bih7XG4gICAgY29tbWFuZExpbmU6ICdmYWtlLWNvbW1hbmQnLFxuICAgIGV4aXRDb2RlOiAxMjcsXG4gIH0pO1xuXG4gIC8vIFdIRU5cbiAgYXdhaXQgZXhwZWN0KGV4ZWNQcm9ncmFtKHNka1Byb3ZpZGVyLCBjb25maWcpKS5yZWplY3RzLnRvRXF1YWwobmV3IEVycm9yKCdTdWJwcm9jZXNzIGV4aXRlZCB3aXRoIGVycm9yIDEyNycpKTtcbn0sIFRFTl9TRUNPTkRfVElNRU9VVCk7XG5cbnRlc3QoJ2NsaSBkb2VzIG5vdCB0aHJvdyB3aGVuIHRoZSBgYnVpbGRgIHNjcmlwdCBzdWNjZWVkcycsIGFzeW5jICgpID0+IHtcbiAgLy8gR0lWRU5cbiAgY29uZmlnLnNldHRpbmdzLnNldChbJ2J1aWxkJ10sICdyZWFsIGNvbW1hbmQnKTtcbiAgY29uZmlnLnNldHRpbmdzLnNldChbJ2FwcCddLCAnZXhlY3V0YWJsZS1hcHAuanMnKTtcbiAgbW9ja1NwYXduKHtcbiAgICBjb21tYW5kTGluZTogJ3JlYWwgY29tbWFuZCcsIC8vIGBidWlsZGAga2V5IGlzIG5vdCBzcGxpdCBvbiB3aGl0ZXNwYWNlXG4gICAgZXhpdENvZGU6IDAsXG4gIH0sXG4gIHtcbiAgICBjb21tYW5kTGluZTogJ2V4ZWN1dGFibGUtYXBwLmpzJyxcbiAgICBzaWRlRWZmZWN0OiAoKSA9PiB3cml0ZU91dHB1dEFzc2VtYmx5KCksXG4gIH0pO1xuXG4gIC8vIFdIRU5cbiAgY29uc3QgeyBsb2NrIH0gPSBhd2FpdCBleGVjUHJvZ3JhbShzZGtQcm92aWRlciwgY29uZmlnKTtcbiAgYXdhaXQgbG9jay5yZWxlYXNlKCk7XG59LCBURU5fU0VDT05EX1RJTUVPVVQpO1xuXG50ZXN0KCdjbGkgcmVsZWFzZXMgdGhlIG91dGRpciBsb2NrIHdoZW4gZXhlY1Byb2dyYW0gdGhyb3dzJywgYXN5bmMgKCkgPT4ge1xuICAvLyBHSVZFTlxuICBjb25maWcuc2V0dGluZ3Muc2V0KFsnYXBwJ10sICdjbG91ZC1leGVjdXRhYmxlJyk7XG4gIG1vY2tTcGF3bih7XG4gICAgY29tbWFuZExpbmU6ICdmYWtlLWNvbW1hbmQnLFxuICAgIGV4aXRDb2RlOiAxMjcsXG4gIH0pO1xuXG4gIC8vIFdIRU5cbiAgYXdhaXQgZXhwZWN0KGV4ZWNQcm9ncmFtKHNka1Byb3ZpZGVyLCBjb25maWcpKS5yZWplY3RzLnRvVGhyb3coKTtcblxuICBjb25zdCBvdXRwdXQgPSBjb25maWcuc2V0dGluZ3MuZ2V0KFsnb3V0cHV0J10pO1xuICBleHBlY3Qob3V0cHV0KS50b0JlRGVmaW5lZCgpO1xuXG4gIC8vIGNoZWNrIHRoYXQgdGhlIGxvY2sgaXMgcmVsZWFzZWRcbiAgY29uc3QgbG9jayA9IGF3YWl0IG5ldyBSV0xvY2sob3V0cHV0KS5hY3F1aXJlV3JpdGUoKTtcbiAgYXdhaXQgbG9jay5yZWxlYXNlKCk7XG59KTtcblxuZnVuY3Rpb24gd3JpdGVPdXRwdXRBc3NlbWJseSgpIHtcbiAgY29uc3QgYXNtID0gdGVzdEFzc2VtYmx5KHtcbiAgICBzdGFja3M6IFtdLFxuICB9KTtcbiAgYm9ja2ZzLndyaXRlKCcvaG9tZS9wcm9qZWN0L2Nkay5vdXQvbWFuaWZlc3QuanNvbicsIEpTT04uc3RyaW5naWZ5KGFzbS5tYW5pZmVzdCkpO1xuICByZXdyaXRlTWFuaWZlc3RWZXJzaW9uVG9PdXJzKGJvY2tmcy5wYXRoKCcvaG9tZS9wcm9qZWN0L2Nkay5vdXQnKSk7XG59XG5cbi8qKlxuICogUmV3cml0ZSB0aGUgbWFuaWZlc3Qgc2NoZW1hIHZlcnNpb24gaW4gdGhlIGdpdmVuIGRpcmVjdG9yeSB0byBtYXRjaCB0aGUgdmVyc2lvbiBudW1iZXIgd2UgZXhwZWN0IChwcm9iYWJseSBgMC4wLjBgKS5cbiAqXG4gKiBXaHkgZG8gd2UgaGF2ZSB0byBkbyB0aGlzPyBCZWNhdXNlIGBhd3MtY2RrLWxpYmAgaGFzIGl0cyBvd24gdmVyc2lvbiBvZiBgY2xvdWQtYXNzZW1ibHktc2NoZW1hYCxcbiAqIHdoaWNoIHdpbGwgaGF2ZSByZWFsIHZlcnNpb24gYDM4LjAuMGAsIGRpZmZlcmVudCBmcm9tIHRoZSBgMC4wLjBgIHZlcnNpb24gb2YgYGNsb3VkLWFzc2VtYmx5LXNjaGVtYWAgdGhhdCB0aGUgQ0xJXG4gKiB1c2VzLlxuICpcbiAqIElmIHdlIGRvbid0IGRvIHRoaXMsIGV2ZXJ5IHRpbWUgd2UgbG9hZCBhIENsb3VkIEFzc2VtYmx5IHRoZSBjb2RlIHdpbGwgc2F5IFwiTWF4aW11bSBzY2hlbWEgdmVyc2lvbiBzdXBwb3J0ZWQgaXMgMC54LngsIGJ1dCBmb3VuZCAzMC4wLjBcIi4wXG4gKi9cbmZ1bmN0aW9uIHJld3JpdGVNYW5pZmVzdFZlcnNpb25Ub091cnMoZGlyOiBzdHJpbmcgPSAnY2RrLm91dCcpIHtcbiAgcmV3cml0ZU1hbmlmZXN0VmVyc2lvbihkaXIsIGN4c2NoZW1hLk1hbmlmZXN0LnZlcnNpb24oKSk7XG59XG4iXX0=