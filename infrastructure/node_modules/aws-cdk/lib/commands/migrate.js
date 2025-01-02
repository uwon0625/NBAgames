"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FromScan = exports.CfnTemplateGeneratorProvider = exports.FilterType = exports.ScanStatus = exports.TemplateSourceOptions = exports.MIGRATE_SUPPORTED_LANGUAGES = void 0;
exports.generateCdkApp = generateCdkApp;
exports.generateStack = generateStack;
exports.readFromPath = readFromPath;
exports.readFromStack = readFromStack;
exports.generateTemplate = generateTemplate;
exports.chunks = chunks;
exports.setEnvironment = setEnvironment;
exports.parseSourceOptions = parseSourceOptions;
exports.scanProgressBar = scanProgressBar;
exports.printBar = printBar;
exports.printDots = printDots;
exports.rewriteLine = rewriteLine;
exports.displayTimeDiff = displayTimeDiff;
exports.writeMigrateJsonFile = writeMigrateJsonFile;
exports.getMigrateScanType = getMigrateScanType;
exports.isThereAWarning = isThereAWarning;
exports.buildGenertedTemplateOutput = buildGenertedTemplateOutput;
exports.buildCfnClient = buildCfnClient;
exports.appendWarningsToReadme = appendWarningsToReadme;
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const path = require("path");
const cx_api_1 = require("@aws-cdk/cx-api");
const cdk_from_cfn = require("cdk-from-cfn");
const chalk = require("chalk");
const init_1 = require("../../lib/init");
const logging_1 = require("../../lib/logging");
const plugin_1 = require("../api/plugin");
const cloudformation_1 = require("../api/util/cloudformation");
const archive_1 = require("../util/archive");
const camelCase = require('camelcase');
const decamelize = require('decamelize');
/** The list of languages supported by the built-in noctilucent binary. */
exports.MIGRATE_SUPPORTED_LANGUAGES = cdk_from_cfn.supported_languages();
/**
 * Generates a CDK app from a yaml or json template.
 *
 * @param stackName The name to assign to the stack in the generated app
 * @param stack The yaml or json template for the stack
 * @param language The language to generate the CDK app in
 * @param outputPath The path at which to generate the CDK app
 */
async function generateCdkApp(stackName, stack, language, outputPath, compress) {
    const resolvedOutputPath = path.join(outputPath ?? process.cwd(), stackName);
    const formattedStackName = decamelize(stackName);
    try {
        fs.rmSync(resolvedOutputPath, { recursive: true, force: true });
        fs.mkdirSync(resolvedOutputPath, { recursive: true });
        const generateOnly = compress;
        await (0, init_1.cliInit)({
            type: 'app',
            language,
            canUseNetwork: true,
            generateOnly,
            workDir: resolvedOutputPath,
            stackName,
            migrate: true,
        });
        let stackFileName;
        switch (language) {
            case 'typescript':
                stackFileName = `${resolvedOutputPath}/lib/${formattedStackName}-stack.ts`;
                break;
            case 'java':
                stackFileName = `${resolvedOutputPath}/src/main/java/com/myorg/${camelCase(formattedStackName, { pascalCase: true })}Stack.java`;
                break;
            case 'python':
                stackFileName = `${resolvedOutputPath}/${formattedStackName.replace(/-/g, '_')}/${formattedStackName.replace(/-/g, '_')}_stack.py`;
                break;
            case 'csharp':
                stackFileName = `${resolvedOutputPath}/src/${camelCase(formattedStackName, { pascalCase: true })}/${camelCase(formattedStackName, { pascalCase: true })}Stack.cs`;
                break;
            case 'go':
                stackFileName = `${resolvedOutputPath}/${formattedStackName}.go`;
                break;
            default:
                throw new Error(`${language} is not supported by CDK Migrate. Please choose from: ${exports.MIGRATE_SUPPORTED_LANGUAGES.join(', ')}`);
        }
        fs.writeFileSync(stackFileName, stack);
        if (compress) {
            await (0, archive_1.zipDirectory)(resolvedOutputPath, `${resolvedOutputPath}.zip`);
            fs.rmSync(resolvedOutputPath, { recursive: true, force: true });
        }
    }
    catch (error) {
        fs.rmSync(resolvedOutputPath, { recursive: true, force: true });
        throw error;
    }
}
/**
 * Generates a CDK stack file.
 * @param template The template to translate into a CDK stack
 * @param stackName The name to assign to the stack
 * @param language The language to generate the stack in
 * @returns A string representation of a CDK stack file
 */
function generateStack(template, stackName, language) {
    const formattedStackName = `${camelCase(decamelize(stackName), { pascalCase: true })}Stack`;
    try {
        return cdk_from_cfn.transmute(template, language, formattedStackName);
    }
    catch (e) {
        throw new Error(`${formattedStackName} could not be generated because ${e.message}`);
    }
}
/**
 * Reads and returns a stack template from a local path.
 *
 * @param inputPath The location of the template
 * @returns A string representation of the template if present, otherwise undefined
 */
function readFromPath(inputPath) {
    let readFile;
    try {
        readFile = fs.readFileSync(inputPath, 'utf8');
    }
    catch (e) {
        throw new Error(`'${inputPath}' is not a valid path.`);
    }
    if (readFile == '') {
        throw new Error(`Cloudformation template filepath: '${inputPath}' is an empty file.`);
    }
    return readFile;
}
/**
 * Reads and returns a stack template from a deployed CloudFormation stack.
 *
 * @param stackName The name of the stack
 * @param sdkProvider The sdk provider for making CloudFormation calls
 * @param environment The account and region where the stack is deployed
 * @returns A string representation of the template if present, otherwise undefined
 */
async function readFromStack(stackName, sdkProvider, environment) {
    const cloudFormation = (await sdkProvider.forEnvironment(environment, plugin_1.Mode.ForReading)).sdk.cloudFormation();
    const stack = await cloudformation_1.CloudFormationStack.lookup(cloudFormation, stackName, true);
    if (stack.stackStatus.isDeploySuccess || stack.stackStatus.isRollbackSuccess) {
        return JSON.stringify(await stack.template());
    }
    else {
        throw new Error(`Stack '${stackName}' in account ${environment.account} and region ${environment.region} has a status of '${stack.stackStatus.name}' due to '${stack.stackStatus.reason}'. The stack cannot be migrated until it is in a healthy state.`);
    }
}
/**
 * Takes in a stack name and account and region and returns a generated cloudformation template using the cloudformation
 * template generator.
 *
 * @param GenerateTemplateOptions An object containing the stack name, filters, sdkProvider, environment, and newScan flag
 * @returns a generated cloudformation template
 */
async function generateTemplate(options) {
    const cfn = new CfnTemplateGeneratorProvider(await buildCfnClient(options.sdkProvider, options.environment));
    const scanId = await findLastSuccessfulScan(cfn, options);
    // if a customer accidentally ctrl-c's out of the command and runs it again, this will continue the progress bar where it left off
    const curScan = await cfn.describeResourceScan(scanId);
    if (curScan.Status == ScanStatus.IN_PROGRESS) {
        (0, logging_1.print)('Resource scan in progress. Please wait, this can take 10 minutes or longer.');
        await scanProgressBar(scanId, cfn);
    }
    displayTimeDiff(new Date(), new Date(curScan.StartTime));
    let resources = await cfn.listResourceScanResources(scanId, options.filters);
    (0, logging_1.print)('finding related resources.');
    let relatedResources = await cfn.getResourceScanRelatedResources(scanId, resources);
    (0, logging_1.print)(`Found ${relatedResources.length} resources.`);
    (0, logging_1.print)('Generating CFN template from scanned resources.');
    const templateArn = (await cfn.createGeneratedTemplate(options.stackName, relatedResources)).GeneratedTemplateId;
    let generatedTemplate = await cfn.describeGeneratedTemplate(templateArn);
    (0, logging_1.print)('Please wait, template creation in progress. This may take a couple minutes.');
    while (generatedTemplate.Status !== ScanStatus.COMPLETE && generatedTemplate.Status !== ScanStatus.FAILED) {
        await printDots(`[${generatedTemplate.Status}] Template Creation in Progress`, 400);
        generatedTemplate = await cfn.describeGeneratedTemplate(templateArn);
    }
    (0, logging_1.print)('');
    (0, logging_1.print)('Template successfully generated!');
    return buildGenertedTemplateOutput(generatedTemplate, (await cfn.getGeneratedTemplate(templateArn)).TemplateBody, templateArn);
}
async function findLastSuccessfulScan(cfn, options) {
    let resourceScanSummaries = [];
    const clientRequestToken = `cdk-migrate-${options.environment.account}-${options.environment.region}`;
    if (options.fromScan === FromScan.NEW) {
        (0, logging_1.print)(`Starting new scan for account ${options.environment.account} in region ${options.environment.region}`);
        try {
            await cfn.startResourceScan(clientRequestToken);
            resourceScanSummaries = (await cfn.listResourceScans()).ResourceScanSummaries;
        }
        catch (e) {
            // continuing here because if the scan fails on a new-scan it is very likely because there is either already a scan in progress
            // or the customer hit a rate limit. In either case we want to continue with the most recent scan.
            // If this happens to fail for a credential error then that will be caught immediately after anyway.
            (0, logging_1.print)(`Scan failed to start due to error '${e.message}', defaulting to latest scan.`);
        }
    }
    else {
        resourceScanSummaries = (await cfn.listResourceScans()).ResourceScanSummaries;
        await cfn.checkForResourceScan(resourceScanSummaries, options, clientRequestToken);
    }
    // get the latest scan, which we know will exist
    resourceScanSummaries = (await cfn.listResourceScans()).ResourceScanSummaries;
    let scanId = resourceScanSummaries[0].ResourceScanId;
    // find the most recent scan that isn't in a failed state in case we didn't start a new one
    for (const summary of resourceScanSummaries) {
        if (summary.Status !== ScanStatus.FAILED) {
            scanId = summary.ResourceScanId;
            break;
        }
    }
    return scanId;
}
/**
 * Takes a string of filters in the format of key1=value1,key2=value2 and returns a map of the filters.
 *
 * @param filters a string of filters in the format of key1=value1,key2=value2
 * @returns a map of the filters
 */
function parseFilters(filters) {
    if (!filters) {
        return {
            'resource-identifier': undefined,
            'resource-type-prefix': undefined,
            'tag-key': undefined,
            'tag-value': undefined,
        };
    }
    const filterShorthands = {
        'identifier': FilterType.RESOURCE_IDENTIFIER,
        'id': FilterType.RESOURCE_IDENTIFIER,
        'type': FilterType.RESOURCE_TYPE_PREFIX,
        'type-prefix': FilterType.RESOURCE_TYPE_PREFIX,
    };
    const filterList = filters.split(',');
    let filterMap = {
        [FilterType.RESOURCE_IDENTIFIER]: undefined,
        [FilterType.RESOURCE_TYPE_PREFIX]: undefined,
        [FilterType.TAG_KEY]: undefined,
        [FilterType.TAG_VALUE]: undefined,
    };
    for (const fil of filterList) {
        const filter = fil.split('=');
        let filterKey = filter[0];
        const filterValue = filter[1];
        // if the key is a shorthand, replace it with the full name
        if (filterKey in filterShorthands) {
            filterKey = filterShorthands[filterKey];
        }
        if (Object.values(FilterType).includes(filterKey)) {
            filterMap[filterKey] = filterValue;
        }
        else {
            throw new Error(`Invalid filter: ${filterKey}`);
        }
    }
    return filterMap;
}
/**
 * Takes a list of any type and breaks it up into chunks of a specified size.
 *
 * @param list The list to break up
 * @param chunkSize The size of each chunk
 * @returns A list of lists of the specified size
 */
function chunks(list, chunkSize) {
    const chunkedList = [];
    for (let i = 0; i < list.length; i += chunkSize) {
        chunkedList.push(list.slice(i, i + chunkSize));
    }
    return chunkedList;
}
/**
 * Sets the account and region for making CloudFormation calls.
 * @param account The account to use
 * @param region The region to use
 * @returns The environment object
 */
function setEnvironment(account, region) {
    return {
        account: account ?? cx_api_1.UNKNOWN_ACCOUNT,
        region: region ?? cx_api_1.UNKNOWN_REGION,
        name: 'cdk-migrate-env',
    };
}
/**
 * Enum for the source options for the template
 */
var TemplateSourceOptions;
(function (TemplateSourceOptions) {
    TemplateSourceOptions["PATH"] = "path";
    TemplateSourceOptions["STACK"] = "stack";
    TemplateSourceOptions["SCAN"] = "scan";
})(TemplateSourceOptions || (exports.TemplateSourceOptions = TemplateSourceOptions = {}));
/**
 * Enum for the status of a resource scan
 */
var ScanStatus;
(function (ScanStatus) {
    ScanStatus["IN_PROGRESS"] = "IN_PROGRESS";
    ScanStatus["COMPLETE"] = "COMPLETE";
    ScanStatus["FAILED"] = "FAILED";
})(ScanStatus || (exports.ScanStatus = ScanStatus = {}));
var FilterType;
(function (FilterType) {
    FilterType["RESOURCE_IDENTIFIER"] = "resource-identifier";
    FilterType["RESOURCE_TYPE_PREFIX"] = "resource-type-prefix";
    FilterType["TAG_KEY"] = "tag-key";
    FilterType["TAG_VALUE"] = "tag-value";
})(FilterType || (exports.FilterType = FilterType = {}));
/**
 * Validates that exactly one source option has been provided.
 * @param fromPath The content of the flag `--from-path`
 * @param fromStack the content of the flag `--from-stack`
 */
function parseSourceOptions(fromPath, fromStack, stackName) {
    if (fromPath && fromStack) {
        throw new Error('Only one of `--from-path` or `--from-stack` may be provided.');
    }
    if (!stackName) {
        throw new Error('`--stack-name` is a required field.');
    }
    if (!fromPath && !fromStack) {
        return { source: TemplateSourceOptions.SCAN };
    }
    if (fromPath) {
        return { source: TemplateSourceOptions.PATH, templatePath: fromPath };
    }
    return { source: TemplateSourceOptions.STACK, stackName: stackName };
}
/**
 * Takes a set of resources and removes any with the managedbystack flag set to true.
 *
 * @param resourceList the list of resources provided by the list scanned resources calls
 * @returns a list of resources not managed by cfn stacks
 */
function excludeManaged(resourceList) {
    return resourceList
        .filter((r) => !r.ManagedByStack)
        .map((r) => ({
        ResourceType: r.ResourceType,
        ResourceIdentifier: r.ResourceIdentifier,
    }));
}
/**
 * Transforms a list of resources into a list of resource identifiers by removing the ManagedByStack flag.
 * Setting the value of the field to undefined effectively removes it from the object.
 *
 * @param resourceList the list of resources provided by the list scanned resources calls
 * @returns a list of ScannedResourceIdentifier[]
 */
function resourceIdentifiers(resourceList) {
    const identifiers = [];
    resourceList.forEach((r) => {
        const identifier = {
            ResourceType: r.ResourceType,
            ResourceIdentifier: r.ResourceIdentifier,
        };
        identifiers.push(identifier);
    });
    return identifiers;
}
/**
 * Takes a scan id and maintains a progress bar to display the progress of a scan to the user.
 *
 * @param scanId A string representing the scan id
 * @param cloudFormation The CloudFormation sdk client to use
 */
async function scanProgressBar(scanId, cfn) {
    let curProgress = 0.5;
    // we know it's in progress initially since we wouldn't have gotten here if it wasn't
    let curScan = {
        Status: ScanStatus.IN_PROGRESS,
        $metadata: {},
    };
    while (curScan.Status == ScanStatus.IN_PROGRESS) {
        curScan = await cfn.describeResourceScan(scanId);
        curProgress = curScan.PercentageCompleted ?? curProgress;
        printBar(30, curProgress);
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    (0, logging_1.print)('');
    (0, logging_1.print)('✅ Scan Complete!');
}
/**
 * Prints a progress bar to the console. To be used in a while loop to show progress of a long running task.
 * The progress bar deletes the current line on the console and rewrites it with the progress amount.
 *
 * @param width The width of the progress bar
 * @param progress The current progress to display as a percentage of 100
 */
function printBar(width, progress) {
    if (!process.env.MIGRATE_INTEG_TEST) {
        const FULL_BLOCK = '█';
        const PARTIAL_BLOCK = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
        const fraction = Math.min(progress / 100, 1);
        const innerWidth = Math.max(1, width - 2);
        const chars = innerWidth * fraction;
        const remainder = chars - Math.floor(chars);
        const fullChars = FULL_BLOCK.repeat(Math.floor(chars));
        const partialChar = PARTIAL_BLOCK[Math.floor(remainder * PARTIAL_BLOCK.length)];
        const filler = '·'.repeat(innerWidth - Math.floor(chars) - (partialChar ? 1 : 0));
        const color = chalk.green;
        rewriteLine('[' + color(fullChars + partialChar) + filler + `] (${progress}%)`);
    }
}
/**
 * Prints a message to the console with a series periods appended to it. To be used in a while loop to show progress of a long running task.
 * The message deletes the current line and rewrites it several times to display 1-3 periods to show the user that the task is still running.
 *
 * @param message The message to display
 * @param timeoutx4 The amount of time to wait before printing the next period
 */
async function printDots(message, timeoutx4) {
    if (!process.env.MIGRATE_INTEG_TEST) {
        rewriteLine(message + ' .');
        await new Promise((resolve) => setTimeout(resolve, timeoutx4));
        rewriteLine(message + ' ..');
        await new Promise((resolve) => setTimeout(resolve, timeoutx4));
        rewriteLine(message + ' ...');
        await new Promise((resolve) => setTimeout(resolve, timeoutx4));
        rewriteLine(message);
        await new Promise((resolve) => setTimeout(resolve, timeoutx4));
    }
}
/**
 * Rewrites the current line on the console and writes a new message to it.
 * This is a helper funciton for printDots and printBar.
 *
 * @param message The message to display
 */
function rewriteLine(message) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(message);
}
/**
 * Prints the time difference between two dates in days, hours, and minutes.
 *
 * @param time1 The first date to compare
 * @param time2 The second date to compare
 */
function displayTimeDiff(time1, time2) {
    const diff = Math.abs(time1.getTime() - time2.getTime());
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    (0, logging_1.print)(`Using the latest successful scan which is ${days} days, ${hours} hours, and ${minutes} minutes old.`);
}
/**
 * Writes a migrate.json file to the output directory.
 *
 * @param outputPath The path to write the migrate.json file to
 * @param stackName The name of the stack
 * @param generatedOutput The output of the template generator
 */
function writeMigrateJsonFile(outputPath, stackName, migrateJson) {
    const outputToJson = {
        '//': 'This file is generated by cdk migrate. It will be automatically deleted after the first successful deployment of this app to the environment of the original resources.',
        'Source': migrateJson.source,
        'Resources': migrateJson.resources,
    };
    fs.writeFileSync(`${path.join(outputPath ?? process.cwd(), stackName)}/migrate.json`, JSON.stringify(outputToJson, null, 2));
}
/**
 * Takes a string representing the from-scan flag and returns a FromScan enum value.
 *
 * @param scanType A string representing the from-scan flag
 * @returns A FromScan enum value
 */
function getMigrateScanType(scanType) {
    switch (scanType) {
        case 'new':
            return FromScan.NEW;
        case 'most-recent':
            return FromScan.MOST_RECENT;
        case '':
            return FromScan.DEFAULT;
        case undefined:
            return FromScan.DEFAULT;
        default:
            throw new Error(`Unknown scan type: ${scanType}`);
    }
}
/**
 * Takes a generatedTemplateOutput objct and returns a boolean representing whether there are any warnings on any rescources.
 *
 * @param generatedTemplateOutput A GenerateTemplateOutput object
 * @returns A boolean representing whether there are any warnings on any rescources
 */
function isThereAWarning(generatedTemplateOutput) {
    if (generatedTemplateOutput.resources) {
        for (const resource of generatedTemplateOutput.resources) {
            if (resource.Warnings && resource.Warnings.length > 0) {
                return true;
            }
        }
    }
    return false;
}
/**
 * Builds the GenerateTemplateOutput object from the DescribeGeneratedTemplateOutput and the template body.
 *
 * @param generatedTemplateSummary The output of the describe generated template call
 * @param templateBody The body of the generated template
 * @returns A GenerateTemplateOutput object
 */
function buildGenertedTemplateOutput(generatedTemplateSummary, templateBody, source) {
    const resources = generatedTemplateSummary.Resources;
    const migrateJson = {
        templateBody: templateBody,
        source: source,
        resources: generatedTemplateSummary.Resources.map((r) => ({
            ResourceType: r.ResourceType,
            LogicalResourceId: r.LogicalResourceId,
            ResourceIdentifier: r.ResourceIdentifier,
        })),
    };
    const templateId = generatedTemplateSummary.GeneratedTemplateId;
    return {
        migrateJson: migrateJson,
        resources: resources,
        templateId: templateId,
    };
}
/**
 * Builds a CloudFormation sdk client for making requests with the CFN template generator.
 *
 * @param sdkProvider The sdk provider for making CloudFormation calls
 * @param environment The account and region where the stack is deployed
 * @returns A CloudFormation sdk client
 */
async function buildCfnClient(sdkProvider, environment) {
    const sdk = (await sdkProvider.forEnvironment(environment, plugin_1.Mode.ForReading)).sdk;
    sdk.appendCustomUserAgent('cdk-migrate');
    return sdk.cloudFormation();
}
/**
 * Appends a list of warnings to a readme file.
 *
 * @param filepath The path to the readme file
 * @param resources A list of resources to append warnings for
 */
function appendWarningsToReadme(filepath, resources) {
    const readme = fs.readFileSync(filepath, 'utf8');
    const lines = readme.split('\n');
    const index = lines.findIndex((line) => line.trim() === 'Enjoy!');
    let linesToAdd = ['\n## Warnings'];
    linesToAdd.push('### Write-only properties');
    linesToAdd.push("Write-only properties are resource property values that can be written to but can't be read by AWS CloudFormation or CDK Migrate. For more information, see [IaC generator and write-only properties](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/generate-IaC-write-only-properties.html).");
    linesToAdd.push('\n');
    linesToAdd.push('Write-only properties discovered during migration are organized here by resource ID and categorized by write-only property type. Resolve write-only properties by providing property values in your CDK app. For guidance, see [Resolve write-only properties](https://docs.aws.amazon.com/cdk/v2/guide/migrate.html#migrate-resources-writeonly).');
    for (const resource of resources) {
        if (resource.Warnings && resource.Warnings.length > 0) {
            linesToAdd.push(`### ${resource.LogicalResourceId}`);
            for (const warning of resource.Warnings) {
                linesToAdd.push(`- **${warning.Type}**: `);
                for (const property of warning.Properties) {
                    linesToAdd.push(`  - ${property.PropertyPath}: ${property.Description}`);
                }
            }
        }
    }
    lines.splice(index, 0, ...linesToAdd);
    fs.writeFileSync(filepath, lines.join('\n'));
}
/**
 * takes a list of resources and returns a list of unique resources based on the resource type and logical resource id.
 *
 * @param resources A list of resources to deduplicate
 * @returns A list of unique resources
 */
function deduplicateResources(resources) {
    let uniqueResources = {};
    for (const resource of resources) {
        const key = Object.keys(resource.ResourceIdentifier)[0];
        // Creating our unique identifier using the resource type, the key, and the value of the resource identifier
        // The resource identifier is a combination of a key value pair defined by a resource's schema, and the resource type of the resource.
        const uniqueIdentifer = `${resource.ResourceType}:${key}:${resource.ResourceIdentifier[key]}`;
        uniqueResources[uniqueIdentifer] = resource;
    }
    return Object.values(uniqueResources);
}
/**
 * Class for making CloudFormation template generator calls
 */
class CfnTemplateGeneratorProvider {
    constructor(cfn) {
        this.cfn = cfn;
    }
    async checkForResourceScan(resourceScanSummaries, options, clientRequestToken) {
        if (!resourceScanSummaries || resourceScanSummaries.length === 0) {
            if (options.fromScan === FromScan.MOST_RECENT) {
                throw new Error('No scans found. Please either start a new scan with the `--from-scan` new or do not specify a `--from-scan` option.');
            }
            else {
                (0, logging_1.print)('No scans found. Initiating a new resource scan.');
                await this.startResourceScan(clientRequestToken);
            }
        }
    }
    /**
     * Retrieves a tokenized list of resources and their associated scan. If a token is present the function
     * will loop through all pages and combine them into a single list of ScannedRelatedResources
     *
     * @param scanId scan id for the to list resources for
     * @param resources A list of resources to find related resources for
     */
    async getResourceScanRelatedResources(scanId, resources) {
        let relatedResourceList = resources;
        // break the list of resources into chunks of 100 to avoid hitting the 100 resource limit
        for (const chunk of chunks(resources, 100)) {
            // get the first page of related resources
            const res = await this.cfn.listResourceScanRelatedResources({
                ResourceScanId: scanId,
                Resources: chunk,
            });
            // add the first page to the list
            relatedResourceList.push(...(res.RelatedResources ?? []));
            let nextToken = res.NextToken;
            // if there are more pages, cycle through them and add them to the list before moving on to the next chunk
            while (nextToken) {
                const nextRelatedResources = await this.cfn.listResourceScanRelatedResources({
                    ResourceScanId: scanId,
                    Resources: resourceIdentifiers(resources),
                    NextToken: nextToken,
                });
                nextToken = nextRelatedResources.NextToken;
                relatedResourceList.push(...(nextRelatedResources.RelatedResources ?? []));
            }
        }
        relatedResourceList = deduplicateResources(relatedResourceList);
        // prune the managedbystack flag off of them again.
        return process.env.MIGRATE_INTEG_TEST
            ? resourceIdentifiers(relatedResourceList)
            : resourceIdentifiers(excludeManaged(relatedResourceList));
    }
    /**
     * Kicks off a scan of a customers account, returning the scan id. A scan can take
     * 10 minutes or longer to complete. However this will return a scan id as soon as
     * the scan has begun.
     *
     * @returns A string representing the scan id
     */
    async startResourceScan(requestToken) {
        return (await this.cfn.startResourceScan({
            ClientRequestToken: requestToken,
        })).ResourceScanId;
    }
    /**
     * Gets the most recent scans a customer has completed
     *
     * @returns a list of resource scan summaries
     */
    async listResourceScans() {
        return this.cfn.listResourceScans();
    }
    /**
     * Retrieves a tokenized list of resources from a resource scan. If a token is present, this function
     * will loop through all pages and combine them into a single list of ScannedResource[].
     * Additionally will apply any filters provided by the customer.
     *
     * @param scanId scan id for the to list resources for
     * @param filters a string of filters in the format of key1=value1,key2=value2
     * @returns a combined list of all resources from the scan
     */
    async listResourceScanResources(scanId, filters = []) {
        let resourceList = [];
        let resourceScanInputs;
        if (filters.length > 0) {
            (0, logging_1.print)('Applying filters to resource scan.');
            for (const filter of filters) {
                const filterList = parseFilters(filter);
                resourceScanInputs = {
                    ResourceScanId: scanId,
                    ResourceIdentifier: filterList[FilterType.RESOURCE_IDENTIFIER],
                    ResourceTypePrefix: filterList[FilterType.RESOURCE_TYPE_PREFIX],
                    TagKey: filterList[FilterType.TAG_KEY],
                    TagValue: filterList[FilterType.TAG_VALUE],
                };
                const resources = await this.cfn.listResourceScanResources(resourceScanInputs);
                resourceList = resourceList.concat(resources.Resources ?? []);
                let nextToken = resources.NextToken;
                // cycle through the pages adding all resources to the list until we run out of pages
                while (nextToken) {
                    resourceScanInputs.NextToken = nextToken;
                    const nextResources = await this.cfn.listResourceScanResources(resourceScanInputs);
                    nextToken = nextResources.NextToken;
                    resourceList = resourceList.concat(nextResources.Resources ?? []);
                }
            }
        }
        else {
            (0, logging_1.print)('No filters provided. Retrieving all resources from scan.');
            resourceScanInputs = {
                ResourceScanId: scanId,
            };
            const resources = await this.cfn.listResourceScanResources(resourceScanInputs);
            resourceList = resourceList.concat(resources.Resources ?? []);
            let nextToken = resources.NextToken;
            // cycle through the pages adding all resources to the list until we run out of pages
            while (nextToken) {
                resourceScanInputs.NextToken = nextToken;
                const nextResources = await this.cfn.listResourceScanResources(resourceScanInputs);
                nextToken = nextResources.NextToken;
                resourceList = resourceList.concat(nextResources.Resources ?? []);
            }
        }
        if (resourceList.length === 0) {
            throw new Error(`No resources found with filters ${filters.join(' ')}. Please try again with different filters.`);
        }
        resourceList = deduplicateResources(resourceList);
        return process.env.MIGRATE_INTEG_TEST
            ? resourceIdentifiers(resourceList)
            : resourceIdentifiers(excludeManaged(resourceList));
    }
    /**
     * Retrieves information about a resource scan.
     *
     * @param scanId scan id for the to list resources for
     * @returns information about the scan
     */
    async describeResourceScan(scanId) {
        return this.cfn.describeResourceScan({
            ResourceScanId: scanId,
        });
    }
    /**
     * Describes the current status of the template being generated.
     *
     * @param templateId A string representing the template id
     * @returns DescribeGeneratedTemplateOutput an object containing the template status and results
     */
    async describeGeneratedTemplate(templateId) {
        const generatedTemplate = await this.cfn.describeGeneratedTemplate({
            GeneratedTemplateName: templateId,
        });
        if (generatedTemplate.Status == ScanStatus.FAILED) {
            throw new Error(generatedTemplate.StatusReason);
        }
        return generatedTemplate;
    }
    /**
     * Retrieves a completed generated cloudformation template from the template generator.
     *
     * @param templateId A string representing the template id
     * @param cloudFormation The CloudFormation sdk client to use
     * @returns DescribeGeneratedTemplateOutput an object containing the template status and body
     */
    async getGeneratedTemplate(templateId) {
        return this.cfn.getGeneratedTemplate({
            GeneratedTemplateName: templateId,
        });
    }
    /**
     * Kicks off a template generation for a set of resources.
     *
     * @param stackName The name of the stack
     * @param resources A list of resources to generate the template from
     * @returns CreateGeneratedTemplateOutput an object containing the template arn to query on later
     */
    async createGeneratedTemplate(stackName, resources) {
        const createTemplateOutput = await this.cfn.createGeneratedTemplate({
            Resources: resources,
            GeneratedTemplateName: stackName,
        });
        if (createTemplateOutput.GeneratedTemplateId === undefined) {
            throw new Error('CreateGeneratedTemplate failed to return an Arn.');
        }
        return createTemplateOutput;
    }
    /**
     * Deletes a generated template from the template generator.
     *
     * @param templateArn The arn of the template to delete
     * @returns A promise that resolves when the template has been deleted
     */
    async deleteGeneratedTemplate(templateArn) {
        await this.cfn.deleteGeneratedTemplate({
            GeneratedTemplateName: templateArn,
        });
    }
}
exports.CfnTemplateGeneratorProvider = CfnTemplateGeneratorProvider;
/**
 * The possible ways to choose a scan to generate a CDK application from
 */
var FromScan;
(function (FromScan) {
    /**
     * Initiate a new resource scan to build the CDK application from.
     */
    FromScan[FromScan["NEW"] = 0] = "NEW";
    /**
     * Use the last successful scan to build the CDK application from. Will fail if no scan is found.
     */
    FromScan[FromScan["MOST_RECENT"] = 1] = "MOST_RECENT";
    /**
     * Starts a scan if none exists, otherwise uses the most recent successful scan to build the CDK application from.
     */
    FromScan[FromScan["DEFAULT"] = 2] = "DEFAULT";
})(FromScan || (exports.FromScan = FromScan = {}));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1pZ3JhdGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBc0NBLHdDQXVEQztBQVNELHNDQU9DO0FBUUQsb0NBV0M7QUFVRCxzQ0FlQztBQVNELDRDQXNDQztBQWdHRCx3QkFNQztBQVFELHdDQU1DO0FBd0NELGdEQWNDO0FBMENELDBDQWVDO0FBU0QsNEJBaUJDO0FBU0QsOEJBY0M7QUFRRCxrQ0FJQztBQVFELDBDQVFDO0FBU0Qsb0RBY0M7QUFRRCxnREFhQztBQVFELDBDQVNDO0FBU0Qsa0VBcUJDO0FBU0Qsd0NBSUM7QUFRRCx3REEwQkM7QUFsb0JELDBEQUEwRDtBQUMxRCx1REFBdUQ7QUFDdkQseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3Qiw0Q0FBK0U7QUFhL0UsNkNBQTZDO0FBQzdDLCtCQUErQjtBQUMvQix5Q0FBeUM7QUFDekMsK0NBQTBDO0FBRTFDLDBDQUFxQztBQUNyQywrREFBaUU7QUFDakUsNkNBQStDO0FBQy9DLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztBQUN2QyxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDekMsMEVBQTBFO0FBQzdELFFBQUEsMkJBQTJCLEdBQXNCLFlBQVksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO0FBRWpHOzs7Ozs7O0dBT0c7QUFDSSxLQUFLLFVBQVUsY0FBYyxDQUNsQyxTQUFpQixFQUNqQixLQUFhLEVBQ2IsUUFBZ0IsRUFDaEIsVUFBbUIsRUFDbkIsUUFBa0I7SUFFbEIsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxPQUFPLENBQUMsR0FBRyxFQUFFLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFDN0UsTUFBTSxrQkFBa0IsR0FBRyxVQUFVLENBQUMsU0FBUyxDQUFDLENBQUM7SUFFakQsSUFBSSxDQUFDO1FBQ0gsRUFBRSxDQUFDLE1B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c2xpbnQtZGlzYWJsZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tcmVxdWlyZS1pbXBvcnRzICovXG4vKiBlc2xpbnQtZGlzYWJsZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tdmFyLXJlcXVpcmVzICovXG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgRW52aXJvbm1lbnQsIFVOS05PV05fQUNDT1VOVCwgVU5LTk9XTl9SRUdJT04gfSBmcm9tICdAYXdzLWNkay9jeC1hcGknO1xuaW1wb3J0IHR5cGUge1xuICBEZXNjcmliZUdlbmVyYXRlZFRlbXBsYXRlQ29tbWFuZE91dHB1dCxcbiAgRGVzY3JpYmVSZXNvdXJjZVNjYW5Db21tYW5kT3V0cHV0LFxuICBHZXRHZW5lcmF0ZWRUZW1wbGF0ZUNvbW1hbmRPdXRwdXQsXG4gIExpc3RSZXNvdXJjZVNjYW5SZXNvdXJjZXNDb21tYW5kSW5wdXQsXG4gIFJlc291cmNlRGVmaW5pdGlvbixcbiAgUmVzb3VyY2VEZXRhaWwsXG4gIFJlc291cmNlSWRlbnRpZmllclN1bW1hcnksXG4gIFJlc291cmNlU2NhblN1bW1hcnksXG4gIFNjYW5uZWRSZXNvdXJjZSxcbiAgU2Nhbm5lZFJlc291cmNlSWRlbnRpZmllcixcbn0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3VkZm9ybWF0aW9uJztcbmltcG9ydCAqIGFzIGNka19mcm9tX2NmbiBmcm9tICdjZGstZnJvbS1jZm4nO1xuaW1wb3J0ICogYXMgY2hhbGsgZnJvbSAnY2hhbGsnO1xuaW1wb3J0IHsgY2xpSW5pdCB9IGZyb20gJy4uLy4uL2xpYi9pbml0JztcbmltcG9ydCB7IHByaW50IH0gZnJvbSAnLi4vLi4vbGliL2xvZ2dpbmcnO1xuaW1wb3J0IHR5cGUgeyBJQ2xvdWRGb3JtYXRpb25DbGllbnQsIFNka1Byb3ZpZGVyIH0gZnJvbSAnLi4vYXBpL2F3cy1hdXRoJztcbmltcG9ydCB7IE1vZGUgfSBmcm9tICcuLi9hcGkvcGx1Z2luJztcbmltcG9ydCB7IENsb3VkRm9ybWF0aW9uU3RhY2sgfSBmcm9tICcuLi9hcGkvdXRpbC9jbG91ZGZvcm1hdGlvbic7XG5pbXBvcnQgeyB6aXBEaXJlY3RvcnkgfSBmcm9tICcuLi91dGlsL2FyY2hpdmUnO1xuY29uc3QgY2FtZWxDYXNlID0gcmVxdWlyZSgnY2FtZWxjYXNlJyk7XG5jb25zdCBkZWNhbWVsaXplID0gcmVxdWlyZSgnZGVjYW1lbGl6ZScpO1xuLyoqIFRoZSBsaXN0IG9mIGxhbmd1YWdlcyBzdXBwb3J0ZWQgYnkgdGhlIGJ1aWx0LWluIG5vY3RpbHVjZW50IGJpbmFyeS4gKi9cbmV4cG9ydCBjb25zdCBNSUdSQVRFX1NVUFBPUlRFRF9MQU5HVUFHRVM6IHJlYWRvbmx5IHN0cmluZ1tdID0gY2RrX2Zyb21fY2ZuLnN1cHBvcnRlZF9sYW5ndWFnZXMoKTtcblxuLyoqXG4gKiBHZW5lcmF0ZXMgYSBDREsgYXBwIGZyb20gYSB5YW1sIG9yIGpzb24gdGVtcGxhdGUuXG4gKlxuICogQHBhcmFtIHN0YWNrTmFtZSBUaGUgbmFtZSB0byBhc3NpZ24gdG8gdGhlIHN0YWNrIGluIHRoZSBnZW5lcmF0ZWQgYXBwXG4gKiBAcGFyYW0gc3RhY2sgVGhlIHlhbWwgb3IganNvbiB0ZW1wbGF0ZSBmb3IgdGhlIHN0YWNrXG4gKiBAcGFyYW0gbGFuZ3VhZ2UgVGhlIGxhbmd1YWdlIHRvIGdlbmVyYXRlIHRoZSBDREsgYXBwIGluXG4gKiBAcGFyYW0gb3V0cHV0UGF0aCBUaGUgcGF0aCBhdCB3aGljaCB0byBnZW5lcmF0ZSB0aGUgQ0RLIGFwcFxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVDZGtBcHAoXG4gIHN0YWNrTmFtZTogc3RyaW5nLFxuICBzdGFjazogc3RyaW5nLFxuICBsYW5ndWFnZTogc3RyaW5nLFxuICBvdXRwdXRQYXRoPzogc3RyaW5nLFxuICBjb21wcmVzcz86IGJvb2xlYW4sXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgcmVzb2x2ZWRPdXRwdXRQYXRoID0gcGF0aC5qb2luKG91dHB1dFBhdGggPz8gcHJvY2Vzcy5jd2QoKSwgc3RhY2tOYW1lKTtcbiAgY29uc3QgZm9ybWF0dGVkU3RhY2tOYW1lID0gZGVjYW1lbGl6ZShzdGFja05hbWUpO1xuXG4gIHRyeSB7XG4gICAgZnMucm1TeW5jKHJlc29sdmVkT3V0cHV0UGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgIGZzLm1rZGlyU3luYyhyZXNvbHZlZE91dHB1dFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgIGNvbnN0IGdlbmVyYXRlT25seSA9IGNvbXByZXNzO1xuICAgIGF3YWl0IGNsaUluaXQoe1xuICAgICAgdHlwZTogJ2FwcCcsXG4gICAgICBsYW5ndWFnZSxcbiAgICAgIGNhblVzZU5ldHdvcms6IHRydWUsXG4gICAgICBnZW5lcmF0ZU9ubHksXG4gICAgICB3b3JrRGlyOiByZXNvbHZlZE91dHB1dFBhdGgsXG4gICAgICBzdGFja05hbWUsXG4gICAgICBtaWdyYXRlOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgbGV0IHN0YWNrRmlsZU5hbWU6IHN0cmluZztcbiAgICBzd2l0Y2ggKGxhbmd1YWdlKSB7XG4gICAgICBjYXNlICd0eXBlc2NyaXB0JzpcbiAgICAgICAgc3RhY2tGaWxlTmFtZSA9IGAke3Jlc29sdmVkT3V0cHV0UGF0aH0vbGliLyR7Zm9ybWF0dGVkU3RhY2tOYW1lfS1zdGFjay50c2A7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnamF2YSc6XG4gICAgICAgIHN0YWNrRmlsZU5hbWUgPSBgJHtyZXNvbHZlZE91dHB1dFBhdGh9L3NyYy9tYWluL2phdmEvY29tL215b3JnLyR7Y2FtZWxDYXNlKGZvcm1hdHRlZFN0YWNrTmFtZSwgeyBwYXNjYWxDYXNlOiB0cnVlIH0pfVN0YWNrLmphdmFgO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3B5dGhvbic6XG4gICAgICAgIHN0YWNrRmlsZU5hbWUgPSBgJHtyZXNvbHZlZE91dHB1dFBhdGh9LyR7Zm9ybWF0dGVkU3RhY2tOYW1lLnJlcGxhY2UoLy0vZywgJ18nKX0vJHtmb3JtYXR0ZWRTdGFja05hbWUucmVwbGFjZSgvLS9nLCAnXycpfV9zdGFjay5weWA7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnY3NoYXJwJzpcbiAgICAgICAgc3RhY2tGaWxlTmFtZSA9IGAke3Jlc29sdmVkT3V0cHV0UGF0aH0vc3JjLyR7Y2FtZWxDYXNlKGZvcm1hdHRlZFN0YWNrTmFtZSwgeyBwYXNjYWxDYXNlOiB0cnVlIH0pfS8ke2NhbWVsQ2FzZShmb3JtYXR0ZWRTdGFja05hbWUsIHsgcGFzY2FsQ2FzZTogdHJ1ZSB9KX1TdGFjay5jc2A7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnZ28nOlxuICAgICAgICBzdGFja0ZpbGVOYW1lID0gYCR7cmVzb2x2ZWRPdXRwdXRQYXRofS8ke2Zvcm1hdHRlZFN0YWNrTmFtZX0uZ29gO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgJHtsYW5ndWFnZX0gaXMgbm90IHN1cHBvcnRlZCBieSBDREsgTWlncmF0ZS4gUGxlYXNlIGNob29zZSBmcm9tOiAke01JR1JBVEVfU1VQUE9SVEVEX0xBTkdVQUdFUy5qb2luKCcsICcpfWAsXG4gICAgICAgICk7XG4gICAgfVxuICAgIGZzLndyaXRlRmlsZVN5bmMoc3RhY2tGaWxlTmFtZSwgc3RhY2spO1xuICAgIGlmIChjb21wcmVzcykge1xuICAgICAgYXdhaXQgemlwRGlyZWN0b3J5KHJlc29sdmVkT3V0cHV0UGF0aCwgYCR7cmVzb2x2ZWRPdXRwdXRQYXRofS56aXBgKTtcbiAgICAgIGZzLnJtU3luYyhyZXNvbHZlZE91dHB1dFBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgZnMucm1TeW5jKHJlc29sdmVkT3V0cHV0UGF0aCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pO1xuICAgIHRocm93IGVycm9yO1xuICB9XG59XG5cbi8qKlxuICogR2VuZXJhdGVzIGEgQ0RLIHN0YWNrIGZpbGUuXG4gKiBAcGFyYW0gdGVtcGxhdGUgVGhlIHRlbXBsYXRlIHRvIHRyYW5zbGF0ZSBpbnRvIGEgQ0RLIHN0YWNrXG4gKiBAcGFyYW0gc3RhY2tOYW1lIFRoZSBuYW1lIHRvIGFzc2lnbiB0byB0aGUgc3RhY2tcbiAqIEBwYXJhbSBsYW5ndWFnZSBUaGUgbGFuZ3VhZ2UgdG8gZ2VuZXJhdGUgdGhlIHN0YWNrIGluXG4gKiBAcmV0dXJucyBBIHN0cmluZyByZXByZXNlbnRhdGlvbiBvZiBhIENESyBzdGFjayBmaWxlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZW5lcmF0ZVN0YWNrKHRlbXBsYXRlOiBzdHJpbmcsIHN0YWNrTmFtZTogc3RyaW5nLCBsYW5ndWFnZTogc3RyaW5nKSB7XG4gIGNvbnN0IGZvcm1hdHRlZFN0YWNrTmFtZSA9IGAke2NhbWVsQ2FzZShkZWNhbWVsaXplKHN0YWNrTmFtZSksIHsgcGFzY2FsQ2FzZTogdHJ1ZSB9KX1TdGFja2A7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGNka19mcm9tX2Nmbi50cmFuc211dGUodGVtcGxhdGUsIGxhbmd1YWdlLCBmb3JtYXR0ZWRTdGFja05hbWUpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGAke2Zvcm1hdHRlZFN0YWNrTmFtZX0gY291bGQgbm90IGJlIGdlbmVyYXRlZCBiZWNhdXNlICR7KGUgYXMgRXJyb3IpLm1lc3NhZ2V9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBSZWFkcyBhbmQgcmV0dXJucyBhIHN0YWNrIHRlbXBsYXRlIGZyb20gYSBsb2NhbCBwYXRoLlxuICpcbiAqIEBwYXJhbSBpbnB1dFBhdGggVGhlIGxvY2F0aW9uIG9mIHRoZSB0ZW1wbGF0ZVxuICogQHJldHVybnMgQSBzdHJpbmcgcmVwcmVzZW50YXRpb24gb2YgdGhlIHRlbXBsYXRlIGlmIHByZXNlbnQsIG90aGVyd2lzZSB1bmRlZmluZWRcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlYWRGcm9tUGF0aChpbnB1dFBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCByZWFkRmlsZTogc3RyaW5nO1xuICB0cnkge1xuICAgIHJlYWRGaWxlID0gZnMucmVhZEZpbGVTeW5jKGlucHV0UGF0aCwgJ3V0ZjgnKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgJyR7aW5wdXRQYXRofScgaXMgbm90IGEgdmFsaWQgcGF0aC5gKTtcbiAgfVxuICBpZiAocmVhZEZpbGUgPT0gJycpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYENsb3VkZm9ybWF0aW9uIHRlbXBsYXRlIGZpbGVwYXRoOiAnJHtpbnB1dFBhdGh9JyBpcyBhbiBlbXB0eSBmaWxlLmApO1xuICB9XG4gIHJldHVybiByZWFkRmlsZTtcbn1cblxuLyoqXG4gKiBSZWFkcyBhbmQgcmV0dXJucyBhIHN0YWNrIHRlbXBsYXRlIGZyb20gYSBkZXBsb3llZCBDbG91ZEZvcm1hdGlvbiBzdGFjay5cbiAqXG4gKiBAcGFyYW0gc3RhY2tOYW1lIFRoZSBuYW1lIG9mIHRoZSBzdGFja1xuICogQHBhcmFtIHNka1Byb3ZpZGVyIFRoZSBzZGsgcHJvdmlkZXIgZm9yIG1ha2luZyBDbG91ZEZvcm1hdGlvbiBjYWxsc1xuICogQHBhcmFtIGVudmlyb25tZW50IFRoZSBhY2NvdW50IGFuZCByZWdpb24gd2hlcmUgdGhlIHN0YWNrIGlzIGRlcGxveWVkXG4gKiBAcmV0dXJucyBBIHN0cmluZyByZXByZXNlbnRhdGlvbiBvZiB0aGUgdGVtcGxhdGUgaWYgcHJlc2VudCwgb3RoZXJ3aXNlIHVuZGVmaW5lZFxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVhZEZyb21TdGFjayhcbiAgc3RhY2tOYW1lOiBzdHJpbmcsXG4gIHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlcixcbiAgZW52aXJvbm1lbnQ6IEVudmlyb25tZW50LFxuKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3QgY2xvdWRGb3JtYXRpb24gPSAoYXdhaXQgc2RrUHJvdmlkZXIuZm9yRW52aXJvbm1lbnQoZW52aXJvbm1lbnQsIE1vZGUuRm9yUmVhZGluZykpLnNkay5jbG91ZEZvcm1hdGlvbigpO1xuXG4gIGNvbnN0IHN0YWNrID0gYXdhaXQgQ2xvdWRGb3JtYXRpb25TdGFjay5sb29rdXAoY2xvdWRGb3JtYXRpb24sIHN0YWNrTmFtZSwgdHJ1ZSk7XG4gIGlmIChzdGFjay5zdGFja1N0YXR1cy5pc0RlcGxveVN1Y2Nlc3MgfHwgc3RhY2suc3RhY2tTdGF0dXMuaXNSb2xsYmFja1N1Y2Nlc3MpIHtcbiAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoYXdhaXQgc3RhY2sudGVtcGxhdGUoKSk7XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYFN0YWNrICcke3N0YWNrTmFtZX0nIGluIGFjY291bnQgJHtlbnZpcm9ubWVudC5hY2NvdW50fSBhbmQgcmVnaW9uICR7ZW52aXJvbm1lbnQucmVnaW9ufSBoYXMgYSBzdGF0dXMgb2YgJyR7c3RhY2suc3RhY2tTdGF0dXMubmFtZX0nIGR1ZSB0byAnJHtzdGFjay5zdGFja1N0YXR1cy5yZWFzb259Jy4gVGhlIHN0YWNrIGNhbm5vdCBiZSBtaWdyYXRlZCB1bnRpbCBpdCBpcyBpbiBhIGhlYWx0aHkgc3RhdGUuYCxcbiAgICApO1xuICB9XG59XG5cbi8qKlxuICogVGFrZXMgaW4gYSBzdGFjayBuYW1lIGFuZCBhY2NvdW50IGFuZCByZWdpb24gYW5kIHJldHVybnMgYSBnZW5lcmF0ZWQgY2xvdWRmb3JtYXRpb24gdGVtcGxhdGUgdXNpbmcgdGhlIGNsb3VkZm9ybWF0aW9uXG4gKiB0ZW1wbGF0ZSBnZW5lcmF0b3IuXG4gKlxuICogQHBhcmFtIEdlbmVyYXRlVGVtcGxhdGVPcHRpb25zIEFuIG9iamVjdCBjb250YWluaW5nIHRoZSBzdGFjayBuYW1lLCBmaWx0ZXJzLCBzZGtQcm92aWRlciwgZW52aXJvbm1lbnQsIGFuZCBuZXdTY2FuIGZsYWdcbiAqIEByZXR1cm5zIGEgZ2VuZXJhdGVkIGNsb3VkZm9ybWF0aW9uIHRlbXBsYXRlXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZW5lcmF0ZVRlbXBsYXRlKG9wdGlvbnM6IEdlbmVyYXRlVGVtcGxhdGVPcHRpb25zKTogUHJvbWlzZTxHZW5lcmF0ZVRlbXBsYXRlT3V0cHV0PiB7XG4gIGNvbnN0IGNmbiA9IG5ldyBDZm5UZW1wbGF0ZUdlbmVyYXRvclByb3ZpZGVyKGF3YWl0IGJ1aWxkQ2ZuQ2xpZW50KG9wdGlvbnMuc2RrUHJvdmlkZXIsIG9wdGlvbnMuZW52aXJvbm1lbnQpKTtcblxuICBjb25zdCBzY2FuSWQgPSBhd2FpdCBmaW5kTGFzdFN1Y2Nlc3NmdWxTY2FuKGNmbiwgb3B0aW9ucyk7XG5cbiAgLy8gaWYgYSBjdXN0b21lciBhY2NpZGVudGFsbHkgY3RybC1jJ3Mgb3V0IG9mIHRoZSBjb21tYW5kIGFuZCBydW5zIGl0IGFnYWluLCB0aGlzIHdpbGwgY29udGludWUgdGhlIHByb2dyZXNzIGJhciB3aGVyZSBpdCBsZWZ0IG9mZlxuICBjb25zdCBjdXJTY2FuID0gYXdhaXQgY2ZuLmRlc2NyaWJlUmVzb3VyY2VTY2FuKHNjYW5JZCk7XG4gIGlmIChjdXJTY2FuLlN0YXR1cyA9PSBTY2FuU3RhdHVzLklOX1BST0dSRVNTKSB7XG4gICAgcHJpbnQoJ1Jlc291cmNlIHNjYW4gaW4gcHJvZ3Jlc3MuIFBsZWFzZSB3YWl0LCB0aGlzIGNhbiB0YWtlIDEwIG1pbnV0ZXMgb3IgbG9uZ2VyLicpO1xuICAgIGF3YWl0IHNjYW5Qcm9ncmVzc0JhcihzY2FuSWQsIGNmbik7XG4gIH1cblxuICBkaXNwbGF5VGltZURpZmYobmV3IERhdGUoKSwgbmV3IERhdGUoY3VyU2Nhbi5TdGFydFRpbWUhKSk7XG5cbiAgbGV0IHJlc291cmNlczogU2Nhbm5lZFJlc291cmNlW10gPSBhd2FpdCBjZm4ubGlzdFJlc291cmNlU2NhblJlc291cmNlcyhzY2FuSWQhLCBvcHRpb25zLmZpbHRlcnMpO1xuXG4gIHByaW50KCdmaW5kaW5nIHJlbGF0ZWQgcmVzb3VyY2VzLicpO1xuICBsZXQgcmVsYXRlZFJlc291cmNlcyA9IGF3YWl0IGNmbi5nZXRSZXNvdXJjZVNjYW5SZWxhdGVkUmVzb3VyY2VzKHNjYW5JZCEsIHJlc291cmNlcyk7XG5cbiAgcHJpbnQoYEZvdW5kICR7cmVsYXRlZFJlc291cmNlcy5sZW5ndGh9IHJlc291cmNlcy5gKTtcblxuICBwcmludCgnR2VuZXJhdGluZyBDRk4gdGVtcGxhdGUgZnJvbSBzY2FubmVkIHJlc291cmNlcy4nKTtcbiAgY29uc3QgdGVtcGxhdGVBcm4gPSAoYXdhaXQgY2ZuLmNyZWF0ZUdlbmVyYXRlZFRlbXBsYXRlKG9wdGlvbnMuc3RhY2tOYW1lLCByZWxhdGVkUmVzb3VyY2VzKSkuR2VuZXJhdGVkVGVtcGxhdGVJZCE7XG5cbiAgbGV0IGdlbmVyYXRlZFRlbXBsYXRlID0gYXdhaXQgY2ZuLmRlc2NyaWJlR2VuZXJhdGVkVGVtcGxhdGUodGVtcGxhdGVBcm4pO1xuXG4gIHByaW50KCdQbGVhc2Ugd2FpdCwgdGVtcGxhdGUgY3JlYXRpb24gaW4gcHJvZ3Jlc3MuIFRoaXMgbWF5IHRha2UgYSBjb3VwbGUgbWludXRlcy4nKTtcbiAgd2hpbGUgKGdlbmVyYXRlZFRlbXBsYXRlLlN0YXR1cyAhPT0gU2NhblN0YXR1cy5DT01QTEVURSAmJiBnZW5lcmF0ZWRUZW1wbGF0ZS5TdGF0dXMgIT09IFNjYW5TdGF0dXMuRkFJTEVEKSB7XG4gICAgYXdhaXQgcHJpbnREb3RzKGBbJHtnZW5lcmF0ZWRUZW1wbGF0ZS5TdGF0dXN9XSBUZW1wbGF0ZSBDcmVhdGlvbiBpbiBQcm9ncmVzc2AsIDQwMCk7XG4gICAgZ2VuZXJhdGVkVGVtcGxhdGUgPSBhd2FpdCBjZm4uZGVzY3JpYmVHZW5lcmF0ZWRUZW1wbGF0ZSh0ZW1wbGF0ZUFybik7XG4gIH1cbiAgcHJpbnQoJycpO1xuICBwcmludCgnVGVtcGxhdGUgc3VjY2Vzc2Z1bGx5IGdlbmVyYXRlZCEnKTtcbiAgcmV0dXJuIGJ1aWxkR2VuZXJ0ZWRUZW1wbGF0ZU91dHB1dChcbiAgICBnZW5lcmF0ZWRUZW1wbGF0ZSxcbiAgICAoYXdhaXQgY2ZuLmdldEdlbmVyYXRlZFRlbXBsYXRlKHRlbXBsYXRlQXJuKSkuVGVtcGxhdGVCb2R5ISxcbiAgICB0ZW1wbGF0ZUFybixcbiAgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmluZExhc3RTdWNjZXNzZnVsU2NhbihcbiAgY2ZuOiBDZm5UZW1wbGF0ZUdlbmVyYXRvclByb3ZpZGVyLFxuICBvcHRpb25zOiBHZW5lcmF0ZVRlbXBsYXRlT3B0aW9ucyxcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGxldCByZXNvdXJjZVNjYW5TdW1tYXJpZXM6IFJlc291cmNlU2NhblN1bW1hcnlbXSB8IHVuZGVmaW5lZCA9IFtdO1xuICBjb25zdCBjbGllbnRSZXF1ZXN0VG9rZW4gPSBgY2RrLW1pZ3JhdGUtJHtvcHRpb25zLmVudmlyb25tZW50LmFjY291bnR9LSR7b3B0aW9ucy5lbnZpcm9ubWVudC5yZWdpb259YDtcbiAgaWYgKG9wdGlvbnMuZnJvbVNjYW4gPT09IEZyb21TY2FuLk5FVykge1xuICAgIHByaW50KGBTdGFydGluZyBuZXcgc2NhbiBmb3IgYWNjb3VudCAke29wdGlvbnMuZW52aXJvbm1lbnQuYWNjb3VudH0gaW4gcmVnaW9uICR7b3B0aW9ucy5lbnZpcm9ubWVudC5yZWdpb259YCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNmbi5zdGFydFJlc291cmNlU2NhbihjbGllbnRSZXF1ZXN0VG9rZW4pO1xuICAgICAgcmVzb3VyY2VTY2FuU3VtbWFyaWVzID0gKGF3YWl0IGNmbi5saXN0UmVzb3VyY2VTY2FucygpKS5SZXNvdXJjZVNjYW5TdW1tYXJpZXM7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gY29udGludWluZyBoZXJlIGJlY2F1c2UgaWYgdGhlIHNjYW4gZmFpbHMgb24gYSBuZXctc2NhbiBpdCBpcyB2ZXJ5IGxpa2VseSBiZWNhdXNlIHRoZXJlIGlzIGVpdGhlciBhbHJlYWR5IGEgc2NhbiBpbiBwcm9ncmVzc1xuICAgICAgLy8gb3IgdGhlIGN1c3RvbWVyIGhpdCBhIHJhdGUgbGltaXQuIEluIGVpdGhlciBjYXNlIHdlIHdhbnQgdG8gY29udGludWUgd2l0aCB0aGUgbW9zdCByZWNlbnQgc2Nhbi5cbiAgICAgIC8vIElmIHRoaXMgaGFwcGVucyB0byBmYWlsIGZvciBhIGNyZWRlbnRpYWwgZXJyb3IgdGhlbiB0aGF0IHdpbGwgYmUgY2F1Z2h0IGltbWVkaWF0ZWx5IGFmdGVyIGFueXdheS5cbiAgICAgIHByaW50KGBTY2FuIGZhaWxlZCB0byBzdGFydCBkdWUgdG8gZXJyb3IgJyR7KGUgYXMgRXJyb3IpLm1lc3NhZ2V9JywgZGVmYXVsdGluZyB0byBsYXRlc3Qgc2Nhbi5gKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgcmVzb3VyY2VTY2FuU3VtbWFyaWVzID0gKGF3YWl0IGNmbi5saXN0UmVzb3VyY2VTY2FucygpKS5SZXNvdXJjZVNjYW5TdW1tYXJpZXM7XG4gICAgYXdhaXQgY2ZuLmNoZWNrRm9yUmVzb3VyY2VTY2FuKHJlc291cmNlU2NhblN1bW1hcmllcywgb3B0aW9ucywgY2xpZW50UmVxdWVzdFRva2VuKTtcbiAgfVxuICAvLyBnZXQgdGhlIGxhdGVzdCBzY2FuLCB3aGljaCB3ZSBrbm93IHdpbGwgZXhpc3RcbiAgcmVzb3VyY2VTY2FuU3VtbWFyaWVzID0gKGF3YWl0IGNmbi5saXN0UmVzb3VyY2VTY2FucygpKS5SZXNvdXJjZVNjYW5TdW1tYXJpZXM7XG4gIGxldCBzY2FuSWQ6IHN0cmluZyB8IHVuZGVmaW5lZCA9IHJlc291cmNlU2NhblN1bW1hcmllcyFbMF0uUmVzb3VyY2VTY2FuSWQ7XG5cbiAgLy8gZmluZCB0aGUgbW9zdCByZWNlbnQgc2NhbiB0aGF0IGlzbid0IGluIGEgZmFpbGVkIHN0YXRlIGluIGNhc2Ugd2UgZGlkbid0IHN0YXJ0IGEgbmV3IG9uZVxuICBmb3IgKGNvbnN0IHN1bW1hcnkgb2YgcmVzb3VyY2VTY2FuU3VtbWFyaWVzISkge1xuICAgIGlmIChzdW1tYXJ5LlN0YXR1cyAhPT0gU2NhblN0YXR1cy5GQUlMRUQpIHtcbiAgICAgIHNjYW5JZCA9IHN1bW1hcnkuUmVzb3VyY2VTY2FuSWQhO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHNjYW5JZCE7XG59XG5cbi8qKlxuICogVGFrZXMgYSBzdHJpbmcgb2YgZmlsdGVycyBpbiB0aGUgZm9ybWF0IG9mIGtleTE9dmFsdWUxLGtleTI9dmFsdWUyIGFuZCByZXR1cm5zIGEgbWFwIG9mIHRoZSBmaWx0ZXJzLlxuICpcbiAqIEBwYXJhbSBmaWx0ZXJzIGEgc3RyaW5nIG9mIGZpbHRlcnMgaW4gdGhlIGZvcm1hdCBvZiBrZXkxPXZhbHVlMSxrZXkyPXZhbHVlMlxuICogQHJldHVybnMgYSBtYXAgb2YgdGhlIGZpbHRlcnNcbiAqL1xuZnVuY3Rpb24gcGFyc2VGaWx0ZXJzKGZpbHRlcnM6IHN0cmluZyk6IHtcbiAgW2tleSBpbiBGaWx0ZXJUeXBlXTogc3RyaW5nIHwgdW5kZWZpbmVkO1xufSB7XG4gIGlmICghZmlsdGVycykge1xuICAgIHJldHVybiB7XG4gICAgICAncmVzb3VyY2UtaWRlbnRpZmllcic6IHVuZGVmaW5lZCxcbiAgICAgICdyZXNvdXJjZS10eXBlLXByZWZpeCc6IHVuZGVmaW5lZCxcbiAgICAgICd0YWcta2V5JzogdW5kZWZpbmVkLFxuICAgICAgJ3RhZy12YWx1ZSc6IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgZmlsdGVyU2hvcnRoYW5kczogeyBba2V5OiBzdHJpbmddOiBGaWx0ZXJUeXBlIH0gPSB7XG4gICAgJ2lkZW50aWZpZXInOiBGaWx0ZXJUeXBlLlJFU09VUkNFX0lERU5USUZJRVIsXG4gICAgJ2lkJzogRmlsdGVyVHlwZS5SRVNPVVJDRV9JREVOVElGSUVSLFxuICAgICd0eXBlJzogRmlsdGVyVHlwZS5SRVNPVVJDRV9UWVBFX1BSRUZJWCxcbiAgICAndHlwZS1wcmVmaXgnOiBGaWx0ZXJUeXBlLlJFU09VUkNFX1RZUEVfUFJFRklYLFxuICB9O1xuXG4gIGNvbnN0IGZpbHRlckxpc3QgPSBmaWx0ZXJzLnNwbGl0KCcsJyk7XG5cbiAgbGV0IGZpbHRlck1hcDogeyBba2V5IGluIEZpbHRlclR5cGVdOiBzdHJpbmcgfCB1bmRlZmluZWQgfSA9IHtcbiAgICBbRmlsdGVyVHlwZS5SRVNPVVJDRV9JREVOVElGSUVSXTogdW5kZWZpbmVkLFxuICAgIFtGaWx0ZXJUeXBlLlJFU09VUkNFX1RZUEVfUFJFRklYXTogdW5kZWZpbmVkLFxuICAgIFtGaWx0ZXJUeXBlLlRBR19LRVldOiB1bmRlZmluZWQsXG4gICAgW0ZpbHRlclR5cGUuVEFHX1ZBTFVFXTogdW5kZWZpbmVkLFxuICB9O1xuXG4gIGZvciAoY29uc3QgZmlsIG9mIGZpbHRlckxpc3QpIHtcbiAgICBjb25zdCBmaWx0ZXIgPSBmaWwuc3BsaXQoJz0nKTtcbiAgICBsZXQgZmlsdGVyS2V5ID0gZmlsdGVyWzBdO1xuICAgIGNvbnN0IGZpbHRlclZhbHVlID0gZmlsdGVyWzFdO1xuICAgIC8vIGlmIHRoZSBrZXkgaXMgYSBzaG9ydGhhbmQsIHJlcGxhY2UgaXQgd2l0aCB0aGUgZnVsbCBuYW1lXG4gICAgaWYgKGZpbHRlcktleSBpbiBmaWx0ZXJTaG9ydGhhbmRzKSB7XG4gICAgICBmaWx0ZXJLZXkgPSBmaWx0ZXJTaG9ydGhhbmRzW2ZpbHRlcktleV07XG4gICAgfVxuICAgIGlmIChPYmplY3QudmFsdWVzKEZpbHRlclR5cGUpLmluY2x1ZGVzKGZpbHRlcktleSBhcyBhbnkpKSB7XG4gICAgICBmaWx0ZXJNYXBbZmlsdGVyS2V5IGFzIGtleW9mIHR5cGVvZiBmaWx0ZXJNYXBdID0gZmlsdGVyVmFsdWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBmaWx0ZXI6ICR7ZmlsdGVyS2V5fWApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZmlsdGVyTWFwO1xufVxuXG4vKipcbiAqIFRha2VzIGEgbGlzdCBvZiBhbnkgdHlwZSBhbmQgYnJlYWtzIGl0IHVwIGludG8gY2h1bmtzIG9mIGEgc3BlY2lmaWVkIHNpemUuXG4gKlxuICogQHBhcmFtIGxpc3QgVGhlIGxpc3QgdG8gYnJlYWsgdXBcbiAqIEBwYXJhbSBjaHVua1NpemUgVGhlIHNpemUgb2YgZWFjaCBjaHVua1xuICogQHJldHVybnMgQSBsaXN0IG9mIGxpc3RzIG9mIHRoZSBzcGVjaWZpZWQgc2l6ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gY2h1bmtzKGxpc3Q6IGFueVtdLCBjaHVua1NpemU6IG51bWJlcik6IGFueVtdW10ge1xuICBjb25zdCBjaHVua2VkTGlzdDogYW55W11bXSA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpICs9IGNodW5rU2l6ZSkge1xuICAgIGNodW5rZWRMaXN0LnB1c2gobGlzdC5zbGljZShpLCBpICsgY2h1bmtTaXplKSk7XG4gIH1cbiAgcmV0dXJuIGNodW5rZWRMaXN0O1xufVxuXG4vKipcbiAqIFNldHMgdGhlIGFjY291bnQgYW5kIHJlZ2lvbiBmb3IgbWFraW5nIENsb3VkRm9ybWF0aW9uIGNhbGxzLlxuICogQHBhcmFtIGFjY291bnQgVGhlIGFjY291bnQgdG8gdXNlXG4gKiBAcGFyYW0gcmVnaW9uIFRoZSByZWdpb24gdG8gdXNlXG4gKiBAcmV0dXJucyBUaGUgZW52aXJvbm1lbnQgb2JqZWN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRFbnZpcm9ubWVudChhY2NvdW50Pzogc3RyaW5nLCByZWdpb24/OiBzdHJpbmcpOiBFbnZpcm9ubWVudCB7XG4gIHJldHVybiB7XG4gICAgYWNjb3VudDogYWNjb3VudCA/PyBVTktOT1dOX0FDQ09VTlQsXG4gICAgcmVnaW9uOiByZWdpb24gPz8gVU5LTk9XTl9SRUdJT04sXG4gICAgbmFtZTogJ2Nkay1taWdyYXRlLWVudicsXG4gIH07XG59XG5cbi8qKlxuICogRW51bSBmb3IgdGhlIHNvdXJjZSBvcHRpb25zIGZvciB0aGUgdGVtcGxhdGVcbiAqL1xuZXhwb3J0IGVudW0gVGVtcGxhdGVTb3VyY2VPcHRpb25zIHtcbiAgUEFUSCA9ICdwYXRoJyxcbiAgU1RBQ0sgPSAnc3RhY2snLFxuICBTQ0FOID0gJ3NjYW4nLFxufVxuXG4vKipcbiAqIEFuIG9iamVjdCByZXByZXNlbnRpbmcgdGhlIHNvdXJjZSBvZiBhIHRlbXBsYXRlLlxuICovXG50eXBlIFRlbXBsYXRlU291cmNlID1cbiAgfCB7IHNvdXJjZTogVGVtcGxhdGVTb3VyY2VPcHRpb25zLlNDQU4gfVxuICB8IHsgc291cmNlOiBUZW1wbGF0ZVNvdXJjZU9wdGlvbnMuUEFUSDsgdGVtcGxhdGVQYXRoOiBzdHJpbmcgfVxuICB8IHsgc291cmNlOiBUZW1wbGF0ZVNvdXJjZU9wdGlvbnMuU1RBQ0s7IHN0YWNrTmFtZTogc3RyaW5nIH07XG5cbi8qKlxuICogRW51bSBmb3IgdGhlIHN0YXR1cyBvZiBhIHJlc291cmNlIHNjYW5cbiAqL1xuZXhwb3J0IGVudW0gU2NhblN0YXR1cyB7XG4gIElOX1BST0dSRVNTID0gJ0lOX1BST0dSRVNTJyxcbiAgQ09NUExFVEUgPSAnQ09NUExFVEUnLFxuICBGQUlMRUQgPSAnRkFJTEVEJyxcbn1cblxuZXhwb3J0IGVudW0gRmlsdGVyVHlwZSB7XG4gIFJFU09VUkNFX0lERU5USUZJRVIgPSAncmVzb3VyY2UtaWRlbnRpZmllcicsXG4gIFJFU09VUkNFX1RZUEVfUFJFRklYID0gJ3Jlc291cmNlLXR5cGUtcHJlZml4JyxcbiAgVEFHX0tFWSA9ICd0YWcta2V5JyxcbiAgVEFHX1ZBTFVFID0gJ3RhZy12YWx1ZScsXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIHRoYXQgZXhhY3RseSBvbmUgc291cmNlIG9wdGlvbiBoYXMgYmVlbiBwcm92aWRlZC5cbiAqIEBwYXJhbSBmcm9tUGF0aCBUaGUgY29udGVudCBvZiB0aGUgZmxhZyBgLS1mcm9tLXBhdGhgXG4gKiBAcGFyYW0gZnJvbVN0YWNrIHRoZSBjb250ZW50IG9mIHRoZSBmbGFnIGAtLWZyb20tc3RhY2tgXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVNvdXJjZU9wdGlvbnMoZnJvbVBhdGg/OiBzdHJpbmcsIGZyb21TdGFjaz86IGJvb2xlYW4sIHN0YWNrTmFtZT86IHN0cmluZyk6IFRlbXBsYXRlU291cmNlIHtcbiAgaWYgKGZyb21QYXRoICYmIGZyb21TdGFjaykge1xuICAgIHRocm93IG5ldyBFcnJvcignT25seSBvbmUgb2YgYC0tZnJvbS1wYXRoYCBvciBgLS1mcm9tLXN0YWNrYCBtYXkgYmUgcHJvdmlkZWQuJyk7XG4gIH1cbiAgaWYgKCFzdGFja05hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2AtLXN0YWNrLW5hbWVgIGlzIGEgcmVxdWlyZWQgZmllbGQuJyk7XG4gIH1cbiAgaWYgKCFmcm9tUGF0aCAmJiAhZnJvbVN0YWNrKSB7XG4gICAgcmV0dXJuIHsgc291cmNlOiBUZW1wbGF0ZVNvdXJjZU9wdGlvbnMuU0NBTiB9O1xuICB9XG4gIGlmIChmcm9tUGF0aCkge1xuICAgIHJldHVybiB7IHNvdXJjZTogVGVtcGxhdGVTb3VyY2VPcHRpb25zLlBBVEgsIHRlbXBsYXRlUGF0aDogZnJvbVBhdGggfTtcbiAgfVxuICByZXR1cm4geyBzb3VyY2U6IFRlbXBsYXRlU291cmNlT3B0aW9ucy5TVEFDSywgc3RhY2tOYW1lOiBzdGFja05hbWUhIH07XG59XG5cbi8qKlxuICogVGFrZXMgYSBzZXQgb2YgcmVzb3VyY2VzIGFuZCByZW1vdmVzIGFueSB3aXRoIHRoZSBtYW5hZ2VkYnlzdGFjayBmbGFnIHNldCB0byB0cnVlLlxuICpcbiAqIEBwYXJhbSByZXNvdXJjZUxpc3QgdGhlIGxpc3Qgb2YgcmVzb3VyY2VzIHByb3ZpZGVkIGJ5IHRoZSBsaXN0IHNjYW5uZWQgcmVzb3VyY2VzIGNhbGxzXG4gKiBAcmV0dXJucyBhIGxpc3Qgb2YgcmVzb3VyY2VzIG5vdCBtYW5hZ2VkIGJ5IGNmbiBzdGFja3NcbiAqL1xuZnVuY3Rpb24gZXhjbHVkZU1hbmFnZWQocmVzb3VyY2VMaXN0OiBTY2FubmVkUmVzb3VyY2VbXSk6IFNjYW5uZWRSZXNvdXJjZUlkZW50aWZpZXJbXSB7XG4gIHJldHVybiByZXNvdXJjZUxpc3RcbiAgICAuZmlsdGVyKChyKSA9PiAhci5NYW5hZ2VkQnlTdGFjaylcbiAgICAubWFwKChyKSA9PiAoe1xuICAgICAgUmVzb3VyY2VUeXBlOiByLlJlc291cmNlVHlwZSEsXG4gICAgICBSZXNvdXJjZUlkZW50aWZpZXI6IHIuUmVzb3VyY2VJZGVudGlmaWVyISxcbiAgICB9KSk7XG59XG5cbi8qKlxuICogVHJhbnNmb3JtcyBhIGxpc3Qgb2YgcmVzb3VyY2VzIGludG8gYSBsaXN0IG9mIHJlc291cmNlIGlkZW50aWZpZXJzIGJ5IHJlbW92aW5nIHRoZSBNYW5hZ2VkQnlTdGFjayBmbGFnLlxuICogU2V0dGluZyB0aGUgdmFsdWUgb2YgdGhlIGZpZWxkIHRvIHVuZGVmaW5lZCBlZmZlY3RpdmVseSByZW1vdmVzIGl0IGZyb20gdGhlIG9iamVjdC5cbiAqXG4gKiBAcGFyYW0gcmVzb3VyY2VMaXN0IHRoZSBsaXN0IG9mIHJlc291cmNlcyBwcm92aWRlZCBieSB0aGUgbGlzdCBzY2FubmVkIHJlc291cmNlcyBjYWxsc1xuICogQHJldHVybnMgYSBsaXN0IG9mIFNjYW5uZWRSZXNvdXJjZUlkZW50aWZpZXJbXVxuICovXG5mdW5jdGlvbiByZXNvdXJjZUlkZW50aWZpZXJzKHJlc291cmNlTGlzdDogU2Nhbm5lZFJlc291cmNlW10pOiBTY2FubmVkUmVzb3VyY2VJZGVudGlmaWVyW10ge1xuICBjb25zdCBpZGVudGlmaWVyczogU2Nhbm5lZFJlc291cmNlSWRlbnRpZmllcltdID0gW107XG4gIHJlc291cmNlTGlzdC5mb3JFYWNoKChyKSA9PiB7XG4gICAgY29uc3QgaWRlbnRpZmllcjogU2Nhbm5lZFJlc291cmNlSWRlbnRpZmllciA9IHtcbiAgICAgIFJlc291cmNlVHlwZTogci5SZXNvdXJjZVR5cGUhLFxuICAgICAgUmVzb3VyY2VJZGVudGlmaWVyOiByLlJlc291cmNlSWRlbnRpZmllciEsXG4gICAgfTtcbiAgICBpZGVudGlmaWVycy5wdXNoKGlkZW50aWZpZXIpO1xuICB9KTtcbiAgcmV0dXJuIGlkZW50aWZpZXJzO1xufVxuXG4vKipcbiAqIFRha2VzIGEgc2NhbiBpZCBhbmQgbWFpbnRhaW5zIGEgcHJvZ3Jlc3MgYmFyIHRvIGRpc3BsYXkgdGhlIHByb2dyZXNzIG9mIGEgc2NhbiB0byB0aGUgdXNlci5cbiAqXG4gKiBAcGFyYW0gc2NhbklkIEEgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgc2NhbiBpZFxuICogQHBhcmFtIGNsb3VkRm9ybWF0aW9uIFRoZSBDbG91ZEZvcm1hdGlvbiBzZGsgY2xpZW50IHRvIHVzZVxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2NhblByb2dyZXNzQmFyKHNjYW5JZDogc3RyaW5nLCBjZm46IENmblRlbXBsYXRlR2VuZXJhdG9yUHJvdmlkZXIpIHtcbiAgbGV0IGN1clByb2dyZXNzID0gMC41O1xuICAvLyB3ZSBrbm93IGl0J3MgaW4gcHJvZ3Jlc3MgaW5pdGlhbGx5IHNpbmNlIHdlIHdvdWxkbid0IGhhdmUgZ290dGVuIGhlcmUgaWYgaXQgd2Fzbid0XG4gIGxldCBjdXJTY2FuOiBEZXNjcmliZVJlc291cmNlU2NhbkNvbW1hbmRPdXRwdXQgPSB7XG4gICAgU3RhdHVzOiBTY2FuU3RhdHVzLklOX1BST0dSRVNTLFxuICAgICRtZXRhZGF0YToge30sXG4gIH07XG4gIHdoaWxlIChjdXJTY2FuLlN0YXR1cyA9PSBTY2FuU3RhdHVzLklOX1BST0dSRVNTKSB7XG4gICAgY3VyU2NhbiA9IGF3YWl0IGNmbi5kZXNjcmliZVJlc291cmNlU2NhbihzY2FuSWQpO1xuICAgIGN1clByb2dyZXNzID0gY3VyU2Nhbi5QZXJjZW50YWdlQ29tcGxldGVkID8/IGN1clByb2dyZXNzO1xuICAgIHByaW50QmFyKDMwLCBjdXJQcm9ncmVzcyk7XG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMjAwMCkpO1xuICB9XG4gIHByaW50KCcnKTtcbiAgcHJpbnQoJ+KchSBTY2FuIENvbXBsZXRlIScpO1xufVxuXG4vKipcbiAqIFByaW50cyBhIHByb2dyZXNzIGJhciB0byB0aGUgY29uc29sZS4gVG8gYmUgdXNlZCBpbiBhIHdoaWxlIGxvb3AgdG8gc2hvdyBwcm9ncmVzcyBvZiBhIGxvbmcgcnVubmluZyB0YXNrLlxuICogVGhlIHByb2dyZXNzIGJhciBkZWxldGVzIHRoZSBjdXJyZW50IGxpbmUgb24gdGhlIGNvbnNvbGUgYW5kIHJld3JpdGVzIGl0IHdpdGggdGhlIHByb2dyZXNzIGFtb3VudC5cbiAqXG4gKiBAcGFyYW0gd2lkdGggVGhlIHdpZHRoIG9mIHRoZSBwcm9ncmVzcyBiYXJcbiAqIEBwYXJhbSBwcm9ncmVzcyBUaGUgY3VycmVudCBwcm9ncmVzcyB0byBkaXNwbGF5IGFzIGEgcGVyY2VudGFnZSBvZiAxMDBcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByaW50QmFyKHdpZHRoOiBudW1iZXIsIHByb2dyZXNzOiBudW1iZXIpIHtcbiAgaWYgKCFwcm9jZXNzLmVudi5NSUdSQVRFX0lOVEVHX1RFU1QpIHtcbiAgICBjb25zdCBGVUxMX0JMT0NLID0gJ+KWiCc7XG4gICAgY29uc3QgUEFSVElBTF9CTE9DSyA9IFsnJywgJ+KWjycsICfilo4nLCAn4paNJywgJ+KWjCcsICfilosnLCAn4paKJywgJ+KWiSddO1xuICAgIGNvbnN0IGZyYWN0aW9uID0gTWF0aC5taW4ocHJvZ3Jlc3MgLyAxMDAsIDEpO1xuICAgIGNvbnN0IGlubmVyV2lkdGggPSBNYXRoLm1heCgxLCB3aWR0aCAtIDIpO1xuICAgIGNvbnN0IGNoYXJzID0gaW5uZXJXaWR0aCAqIGZyYWN0aW9uO1xuICAgIGNvbnN0IHJlbWFpbmRlciA9IGNoYXJzIC0gTWF0aC5mbG9vcihjaGFycyk7XG5cbiAgICBjb25zdCBmdWxsQ2hhcnMgPSBGVUxMX0JMT0NLLnJlcGVhdChNYXRoLmZsb29yKGNoYXJzKSk7XG4gICAgY29uc3QgcGFydGlhbENoYXIgPSBQQVJUSUFMX0JMT0NLW01hdGguZmxvb3IocmVtYWluZGVyICogUEFSVElBTF9CTE9DSy5sZW5ndGgpXTtcbiAgICBjb25zdCBmaWxsZXIgPSAnwrcnLnJlcGVhdChpbm5lcldpZHRoIC0gTWF0aC5mbG9vcihjaGFycykgLSAocGFydGlhbENoYXIgPyAxIDogMCkpO1xuXG4gICAgY29uc3QgY29sb3IgPSBjaGFsay5ncmVlbjtcblxuICAgIHJld3JpdGVMaW5lKCdbJyArIGNvbG9yKGZ1bGxDaGFycyArIHBhcnRpYWxDaGFyKSArIGZpbGxlciArIGBdICgke3Byb2dyZXNzfSUpYCk7XG4gIH1cbn1cblxuLyoqXG4gKiBQcmludHMgYSBtZXNzYWdlIHRvIHRoZSBjb25zb2xlIHdpdGggYSBzZXJpZXMgcGVyaW9kcyBhcHBlbmRlZCB0byBpdC4gVG8gYmUgdXNlZCBpbiBhIHdoaWxlIGxvb3AgdG8gc2hvdyBwcm9ncmVzcyBvZiBhIGxvbmcgcnVubmluZyB0YXNrLlxuICogVGhlIG1lc3NhZ2UgZGVsZXRlcyB0aGUgY3VycmVudCBsaW5lIGFuZCByZXdyaXRlcyBpdCBzZXZlcmFsIHRpbWVzIHRvIGRpc3BsYXkgMS0zIHBlcmlvZHMgdG8gc2hvdyB0aGUgdXNlciB0aGF0IHRoZSB0YXNrIGlzIHN0aWxsIHJ1bm5pbmcuXG4gKlxuICogQHBhcmFtIG1lc3NhZ2UgVGhlIG1lc3NhZ2UgdG8gZGlzcGxheVxuICogQHBhcmFtIHRpbWVvdXR4NCBUaGUgYW1vdW50IG9mIHRpbWUgdG8gd2FpdCBiZWZvcmUgcHJpbnRpbmcgdGhlIG5leHQgcGVyaW9kXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwcmludERvdHMobWVzc2FnZTogc3RyaW5nLCB0aW1lb3V0eDQ6IG51bWJlcikge1xuICBpZiAoIXByb2Nlc3MuZW52Lk1JR1JBVEVfSU5URUdfVEVTVCkge1xuICAgIHJld3JpdGVMaW5lKG1lc3NhZ2UgKyAnIC4nKTtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCB0aW1lb3V0eDQpKTtcblxuICAgIHJld3JpdGVMaW5lKG1lc3NhZ2UgKyAnIC4uJyk7XG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgdGltZW91dHg0KSk7XG5cbiAgICByZXdyaXRlTGluZShtZXNzYWdlICsgJyAuLi4nKTtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gc2V0VGltZW91dChyZXNvbHZlLCB0aW1lb3V0eDQpKTtcblxuICAgIHJld3JpdGVMaW5lKG1lc3NhZ2UpO1xuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIHRpbWVvdXR4NCkpO1xuICB9XG59XG5cbi8qKlxuICogUmV3cml0ZXMgdGhlIGN1cnJlbnQgbGluZSBvbiB0aGUgY29uc29sZSBhbmQgd3JpdGVzIGEgbmV3IG1lc3NhZ2UgdG8gaXQuXG4gKiBUaGlzIGlzIGEgaGVscGVyIGZ1bmNpdG9uIGZvciBwcmludERvdHMgYW5kIHByaW50QmFyLlxuICpcbiAqIEBwYXJhbSBtZXNzYWdlIFRoZSBtZXNzYWdlIHRvIGRpc3BsYXlcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJld3JpdGVMaW5lKG1lc3NhZ2U6IHN0cmluZykge1xuICBwcm9jZXNzLnN0ZG91dC5jbGVhckxpbmUoMCk7XG4gIHByb2Nlc3Muc3Rkb3V0LmN1cnNvclRvKDApO1xuICBwcm9jZXNzLnN0ZG91dC53cml0ZShtZXNzYWdlKTtcbn1cblxuLyoqXG4gKiBQcmludHMgdGhlIHRpbWUgZGlmZmVyZW5jZSBiZXR3ZWVuIHR3byBkYXRlcyBpbiBkYXlzLCBob3VycywgYW5kIG1pbnV0ZXMuXG4gKlxuICogQHBhcmFtIHRpbWUxIFRoZSBmaXJzdCBkYXRlIHRvIGNvbXBhcmVcbiAqIEBwYXJhbSB0aW1lMiBUaGUgc2Vjb25kIGRhdGUgdG8gY29tcGFyZVxuICovXG5leHBvcnQgZnVuY3Rpb24gZGlzcGxheVRpbWVEaWZmKHRpbWUxOiBEYXRlLCB0aW1lMjogRGF0ZSk6IHZvaWQge1xuICBjb25zdCBkaWZmID0gTWF0aC5hYnModGltZTEuZ2V0VGltZSgpIC0gdGltZTIuZ2V0VGltZSgpKTtcblxuICBjb25zdCBkYXlzID0gTWF0aC5mbG9vcihkaWZmIC8gKDEwMDAgKiA2MCAqIDYwICogMjQpKTtcbiAgY29uc3QgaG91cnMgPSBNYXRoLmZsb29yKChkaWZmICUgKDEwMDAgKiA2MCAqIDYwICogMjQpKSAvICgxMDAwICogNjAgKiA2MCkpO1xuICBjb25zdCBtaW51dGVzID0gTWF0aC5mbG9vcigoZGlmZiAlICgxMDAwICogNjAgKiA2MCkpIC8gKDEwMDAgKiA2MCkpO1xuXG4gIHByaW50KGBVc2luZyB0aGUgbGF0ZXN0IHN1Y2Nlc3NmdWwgc2NhbiB3aGljaCBpcyAke2RheXN9IGRheXMsICR7aG91cnN9IGhvdXJzLCBhbmQgJHttaW51dGVzfSBtaW51dGVzIG9sZC5gKTtcbn1cblxuLyoqXG4gKiBXcml0ZXMgYSBtaWdyYXRlLmpzb24gZmlsZSB0byB0aGUgb3V0cHV0IGRpcmVjdG9yeS5cbiAqXG4gKiBAcGFyYW0gb3V0cHV0UGF0aCBUaGUgcGF0aCB0byB3cml0ZSB0aGUgbWlncmF0ZS5qc29uIGZpbGUgdG9cbiAqIEBwYXJhbSBzdGFja05hbWUgVGhlIG5hbWUgb2YgdGhlIHN0YWNrXG4gKiBAcGFyYW0gZ2VuZXJhdGVkT3V0cHV0IFRoZSBvdXRwdXQgb2YgdGhlIHRlbXBsYXRlIGdlbmVyYXRvclxuICovXG5leHBvcnQgZnVuY3Rpb24gd3JpdGVNaWdyYXRlSnNvbkZpbGUoXG4gIG91dHB1dFBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgc3RhY2tOYW1lOiBzdHJpbmcsXG4gIG1pZ3JhdGVKc29uOiBNaWdyYXRlSnNvbkZvcm1hdCxcbikge1xuICBjb25zdCBvdXRwdXRUb0pzb24gPSB7XG4gICAgJy8vJzogJ1RoaXMgZmlsZSBpcyBnZW5lcmF0ZWQgYnkgY2RrIG1pZ3JhdGUuIEl0IHdpbGwgYmUgYXV0b21hdGljYWxseSBkZWxldGVkIGFmdGVyIHRoZSBmaXJzdCBzdWNjZXNzZnVsIGRlcGxveW1lbnQgb2YgdGhpcyBhcHAgdG8gdGhlIGVudmlyb25tZW50IG9mIHRoZSBvcmlnaW5hbCByZXNvdXJjZXMuJyxcbiAgICAnU291cmNlJzogbWlncmF0ZUpzb24uc291cmNlLFxuICAgICdSZXNvdXJjZXMnOiBtaWdyYXRlSnNvbi5yZXNvdXJjZXMsXG4gIH07XG4gIGZzLndyaXRlRmlsZVN5bmMoXG4gICAgYCR7cGF0aC5qb2luKG91dHB1dFBhdGggPz8gcHJvY2Vzcy5jd2QoKSwgc3RhY2tOYW1lKX0vbWlncmF0ZS5qc29uYCxcbiAgICBKU09OLnN0cmluZ2lmeShvdXRwdXRUb0pzb24sIG51bGwsIDIpLFxuICApO1xufVxuXG4vKipcbiAqIFRha2VzIGEgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgZnJvbS1zY2FuIGZsYWcgYW5kIHJldHVybnMgYSBGcm9tU2NhbiBlbnVtIHZhbHVlLlxuICpcbiAqIEBwYXJhbSBzY2FuVHlwZSBBIHN0cmluZyByZXByZXNlbnRpbmcgdGhlIGZyb20tc2NhbiBmbGFnXG4gKiBAcmV0dXJucyBBIEZyb21TY2FuIGVudW0gdmFsdWVcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldE1pZ3JhdGVTY2FuVHlwZShzY2FuVHlwZTogc3RyaW5nKSB7XG4gIHN3aXRjaCAoc2NhblR5cGUpIHtcbiAgICBjYXNlICduZXcnOlxuICAgICAgcmV0dXJuIEZyb21TY2FuLk5FVztcbiAgICBjYXNlICdtb3N0LXJlY2VudCc6XG4gICAgICByZXR1cm4gRnJvbVNjYW4uTU9TVF9SRUNFTlQ7XG4gICAgY2FzZSAnJzpcbiAgICAgIHJldHVybiBGcm9tU2Nhbi5ERUZBVUxUO1xuICAgIGNhc2UgdW5kZWZpbmVkOlxuICAgICAgcmV0dXJuIEZyb21TY2FuLkRFRkFVTFQ7XG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBzY2FuIHR5cGU6ICR7c2NhblR5cGV9YCk7XG4gIH1cbn1cblxuLyoqXG4gKiBUYWtlcyBhIGdlbmVyYXRlZFRlbXBsYXRlT3V0cHV0IG9iamN0IGFuZCByZXR1cm5zIGEgYm9vbGVhbiByZXByZXNlbnRpbmcgd2hldGhlciB0aGVyZSBhcmUgYW55IHdhcm5pbmdzIG9uIGFueSByZXNjb3VyY2VzLlxuICpcbiAqIEBwYXJhbSBnZW5lcmF0ZWRUZW1wbGF0ZU91dHB1dCBBIEdlbmVyYXRlVGVtcGxhdGVPdXRwdXQgb2JqZWN0XG4gKiBAcmV0dXJucyBBIGJvb2xlYW4gcmVwcmVzZW50aW5nIHdoZXRoZXIgdGhlcmUgYXJlIGFueSB3YXJuaW5ncyBvbiBhbnkgcmVzY291cmNlc1xuICovXG5leHBvcnQgZnVuY3Rpb24gaXNUaGVyZUFXYXJuaW5nKGdlbmVyYXRlZFRlbXBsYXRlT3V0cHV0OiBHZW5lcmF0ZVRlbXBsYXRlT3V0cHV0KSB7XG4gIGlmIChnZW5lcmF0ZWRUZW1wbGF0ZU91dHB1dC5yZXNvdXJjZXMpIHtcbiAgICBmb3IgKGNvbnN0IHJlc291cmNlIG9mIGdlbmVyYXRlZFRlbXBsYXRlT3V0cHV0LnJlc291cmNlcykge1xuICAgICAgaWYgKHJlc291cmNlLldhcm5pbmdzICYmIHJlc291cmNlLldhcm5pbmdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqXG4gKiBCdWlsZHMgdGhlIEdlbmVyYXRlVGVtcGxhdGVPdXRwdXQgb2JqZWN0IGZyb20gdGhlIERlc2NyaWJlR2VuZXJhdGVkVGVtcGxhdGVPdXRwdXQgYW5kIHRoZSB0ZW1wbGF0ZSBib2R5LlxuICpcbiAqIEBwYXJhbSBnZW5lcmF0ZWRUZW1wbGF0ZVN1bW1hcnkgVGhlIG91dHB1dCBvZiB0aGUgZGVzY3JpYmUgZ2VuZXJhdGVkIHRlbXBsYXRlIGNhbGxcbiAqIEBwYXJhbSB0ZW1wbGF0ZUJvZHkgVGhlIGJvZHkgb2YgdGhlIGdlbmVyYXRlZCB0ZW1wbGF0ZVxuICogQHJldHVybnMgQSBHZW5lcmF0ZVRlbXBsYXRlT3V0cHV0IG9iamVjdFxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRHZW5lcnRlZFRlbXBsYXRlT3V0cHV0KFxuICBnZW5lcmF0ZWRUZW1wbGF0ZVN1bW1hcnk6IERlc2NyaWJlR2VuZXJhdGVkVGVtcGxhdGVDb21tYW5kT3V0cHV0LFxuICB0ZW1wbGF0ZUJvZHk6IHN0cmluZyxcbiAgc291cmNlOiBzdHJpbmcsXG4pOiBHZW5lcmF0ZVRlbXBsYXRlT3V0cHV0IHtcbiAgY29uc3QgcmVzb3VyY2VzOiBSZXNvdXJjZURldGFpbFtdIHwgdW5kZWZpbmVkID0gZ2VuZXJhdGVkVGVtcGxhdGVTdW1tYXJ5LlJlc291cmNlcztcbiAgY29uc3QgbWlncmF0ZUpzb246IE1pZ3JhdGVKc29uRm9ybWF0ID0ge1xuICAgIHRlbXBsYXRlQm9keTogdGVtcGxhdGVCb2R5LFxuICAgIHNvdXJjZTogc291cmNlLFxuICAgIHJlc291cmNlczogZ2VuZXJhdGVkVGVtcGxhdGVTdW1tYXJ5LlJlc291cmNlcyEubWFwKChyKSA9PiAoe1xuICAgICAgUmVzb3VyY2VUeXBlOiByLlJlc291cmNlVHlwZSEsXG4gICAgICBMb2dpY2FsUmVzb3VyY2VJZDogci5Mb2dpY2FsUmVzb3VyY2VJZCEsXG4gICAgICBSZXNvdXJjZUlkZW50aWZpZXI6IHIuUmVzb3VyY2VJZGVudGlmaWVyISxcbiAgICB9KSksXG4gIH07XG4gIGNvbnN0IHRlbXBsYXRlSWQgPSBnZW5lcmF0ZWRUZW1wbGF0ZVN1bW1hcnkuR2VuZXJhdGVkVGVtcGxhdGVJZCE7XG4gIHJldHVybiB7XG4gICAgbWlncmF0ZUpzb246IG1pZ3JhdGVKc29uLFxuICAgIHJlc291cmNlczogcmVzb3VyY2VzLFxuICAgIHRlbXBsYXRlSWQ6IHRlbXBsYXRlSWQsXG4gIH07XG59XG5cbi8qKlxuICogQnVpbGRzIGEgQ2xvdWRGb3JtYXRpb24gc2RrIGNsaWVudCBmb3IgbWFraW5nIHJlcXVlc3RzIHdpdGggdGhlIENGTiB0ZW1wbGF0ZSBnZW5lcmF0b3IuXG4gKlxuICogQHBhcmFtIHNka1Byb3ZpZGVyIFRoZSBzZGsgcHJvdmlkZXIgZm9yIG1ha2luZyBDbG91ZEZvcm1hdGlvbiBjYWxsc1xuICogQHBhcmFtIGVudmlyb25tZW50IFRoZSBhY2NvdW50IGFuZCByZWdpb24gd2hlcmUgdGhlIHN0YWNrIGlzIGRlcGxveWVkXG4gKiBAcmV0dXJucyBBIENsb3VkRm9ybWF0aW9uIHNkayBjbGllbnRcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGJ1aWxkQ2ZuQ2xpZW50KHNka1Byb3ZpZGVyOiBTZGtQcm92aWRlciwgZW52aXJvbm1lbnQ6IEVudmlyb25tZW50KSB7XG4gIGNvbnN0IHNkayA9IChhd2FpdCBzZGtQcm92aWRlci5mb3JFbnZpcm9ubWVudChlbnZpcm9ubWVudCwgTW9kZS5Gb3JSZWFkaW5nKSkuc2RrO1xuICBzZGsuYXBwZW5kQ3VzdG9tVXNlckFnZW50KCdjZGstbWlncmF0ZScpO1xuICByZXR1cm4gc2RrLmNsb3VkRm9ybWF0aW9uKCk7XG59XG5cbi8qKlxuICogQXBwZW5kcyBhIGxpc3Qgb2Ygd2FybmluZ3MgdG8gYSByZWFkbWUgZmlsZS5cbiAqXG4gKiBAcGFyYW0gZmlsZXBhdGggVGhlIHBhdGggdG8gdGhlIHJlYWRtZSBmaWxlXG4gKiBAcGFyYW0gcmVzb3VyY2VzIEEgbGlzdCBvZiByZXNvdXJjZXMgdG8gYXBwZW5kIHdhcm5pbmdzIGZvclxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwZW5kV2FybmluZ3NUb1JlYWRtZShmaWxlcGF0aDogc3RyaW5nLCByZXNvdXJjZXM6IFJlc291cmNlRGV0YWlsW10pIHtcbiAgY29uc3QgcmVhZG1lID0gZnMucmVhZEZpbGVTeW5jKGZpbGVwYXRoLCAndXRmOCcpO1xuICBjb25zdCBsaW5lcyA9IHJlYWRtZS5zcGxpdCgnXFxuJyk7XG4gIGNvbnN0IGluZGV4ID0gbGluZXMuZmluZEluZGV4KChsaW5lKSA9PiBsaW5lLnRyaW0oKSA9PT0gJ0Vuam95IScpO1xuICBsZXQgbGluZXNUb0FkZCA9IFsnXFxuIyMgV2FybmluZ3MnXTtcbiAgbGluZXNUb0FkZC5wdXNoKCcjIyMgV3JpdGUtb25seSBwcm9wZXJ0aWVzJyk7XG4gIGxpbmVzVG9BZGQucHVzaChcbiAgICBcIldyaXRlLW9ubHkgcHJvcGVydGllcyBhcmUgcmVzb3VyY2UgcHJvcGVydHkgdmFsdWVzIHRoYXQgY2FuIGJlIHdyaXR0ZW4gdG8gYnV0IGNhbid0IGJlIHJlYWQgYnkgQVdTIENsb3VkRm9ybWF0aW9uIG9yIENESyBNaWdyYXRlLiBGb3IgbW9yZSBpbmZvcm1hdGlvbiwgc2VlIFtJYUMgZ2VuZXJhdG9yIGFuZCB3cml0ZS1vbmx5IHByb3BlcnRpZXNdKGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BV1NDbG91ZEZvcm1hdGlvbi9sYXRlc3QvVXNlckd1aWRlL2dlbmVyYXRlLUlhQy13cml0ZS1vbmx5LXByb3BlcnRpZXMuaHRtbCkuXCIsXG4gICk7XG4gIGxpbmVzVG9BZGQucHVzaCgnXFxuJyk7XG4gIGxpbmVzVG9BZGQucHVzaChcbiAgICAnV3JpdGUtb25seSBwcm9wZXJ0aWVzIGRpc2NvdmVyZWQgZHVyaW5nIG1pZ3JhdGlvbiBhcmUgb3JnYW5pemVkIGhlcmUgYnkgcmVzb3VyY2UgSUQgYW5kIGNhdGVnb3JpemVkIGJ5IHdyaXRlLW9ubHkgcHJvcGVydHkgdHlwZS4gUmVzb2x2ZSB3cml0ZS1vbmx5IHByb3BlcnRpZXMgYnkgcHJvdmlkaW5nIHByb3BlcnR5IHZhbHVlcyBpbiB5b3VyIENESyBhcHAuIEZvciBndWlkYW5jZSwgc2VlIFtSZXNvbHZlIHdyaXRlLW9ubHkgcHJvcGVydGllc10oaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL2Nkay92Mi9ndWlkZS9taWdyYXRlLmh0bWwjbWlncmF0ZS1yZXNvdXJjZXMtd3JpdGVvbmx5KS4nLFxuICApO1xuICBmb3IgKGNvbnN0IHJlc291cmNlIG9mIHJlc291cmNlcykge1xuICAgIGlmIChyZXNvdXJjZS5XYXJuaW5ncyAmJiByZXNvdXJjZS5XYXJuaW5ncy5sZW5ndGggPiAwKSB7XG4gICAgICBsaW5lc1RvQWRkLnB1c2goYCMjIyAke3Jlc291cmNlLkxvZ2ljYWxSZXNvdXJjZUlkfWApO1xuICAgICAgZm9yIChjb25zdCB3YXJuaW5nIG9mIHJlc291cmNlLldhcm5pbmdzKSB7XG4gICAgICAgIGxpbmVzVG9BZGQucHVzaChgLSAqKiR7d2FybmluZy5UeXBlfSoqOiBgKTtcbiAgICAgICAgZm9yIChjb25zdCBwcm9wZXJ0eSBvZiB3YXJuaW5nLlByb3BlcnRpZXMhKSB7XG4gICAgICAgICAgbGluZXNUb0FkZC5wdXNoKGAgIC0gJHtwcm9wZXJ0eS5Qcm9wZXJ0eVBhdGh9OiAke3Byb3BlcnR5LkRlc2NyaXB0aW9ufWApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG4gIGxpbmVzLnNwbGljZShpbmRleCwgMCwgLi4ubGluZXNUb0FkZCk7XG4gIGZzLndyaXRlRmlsZVN5bmMoZmlsZXBhdGgsIGxpbmVzLmpvaW4oJ1xcbicpKTtcbn1cblxuLyoqXG4gKiB0YWtlcyBhIGxpc3Qgb2YgcmVzb3VyY2VzIGFuZCByZXR1cm5zIGEgbGlzdCBvZiB1bmlxdWUgcmVzb3VyY2VzIGJhc2VkIG9uIHRoZSByZXNvdXJjZSB0eXBlIGFuZCBsb2dpY2FsIHJlc291cmNlIGlkLlxuICpcbiAqIEBwYXJhbSByZXNvdXJjZXMgQSBsaXN0IG9mIHJlc291cmNlcyB0byBkZWR1cGxpY2F0ZVxuICogQHJldHVybnMgQSBsaXN0IG9mIHVuaXF1ZSByZXNvdXJjZXNcbiAqL1xuZnVuY3Rpb24gZGVkdXBsaWNhdGVSZXNvdXJjZXMocmVzb3VyY2VzOiBSZXNvdXJjZURldGFpbFtdKSB7XG4gIGxldCB1bmlxdWVSZXNvdXJjZXM6IHsgW2tleTogc3RyaW5nXTogUmVzb3VyY2VEZXRhaWwgfSA9IHt9O1xuXG4gIGZvciAoY29uc3QgcmVzb3VyY2Ugb2YgcmVzb3VyY2VzKSB7XG4gICAgY29uc3Qga2V5ID0gT2JqZWN0LmtleXMocmVzb3VyY2UuUmVzb3VyY2VJZGVudGlmaWVyISlbMF07XG5cbiAgICAvLyBDcmVhdGluZyBvdXIgdW5pcXVlIGlkZW50aWZpZXIgdXNpbmcgdGhlIHJlc291cmNlIHR5cGUsIHRoZSBrZXksIGFuZCB0aGUgdmFsdWUgb2YgdGhlIHJlc291cmNlIGlkZW50aWZpZXJcbiAgICAvLyBUaGUgcmVzb3VyY2UgaWRlbnRpZmllciBpcyBhIGNvbWJpbmF0aW9uIG9mIGEga2V5IHZhbHVlIHBhaXIgZGVmaW5lZCBieSBhIHJlc291cmNlJ3Mgc2NoZW1hLCBhbmQgdGhlIHJlc291cmNlIHR5cGUgb2YgdGhlIHJlc291cmNlLlxuICAgIGNvbnN0IHVuaXF1ZUlkZW50aWZlciA9IGAke3Jlc291cmNlLlJlc291cmNlVHlwZX06JHtrZXl9OiR7cmVzb3VyY2UuUmVzb3VyY2VJZGVudGlmaWVyIVtrZXldfWA7XG4gICAgdW5pcXVlUmVzb3VyY2VzW3VuaXF1ZUlkZW50aWZlcl0gPSByZXNvdXJjZTtcbiAgfVxuXG4gIHJldHVybiBPYmplY3QudmFsdWVzKHVuaXF1ZVJlc291cmNlcyk7XG59XG5cbi8qKlxuICogQ2xhc3MgZm9yIG1ha2luZyBDbG91ZEZvcm1hdGlvbiB0ZW1wbGF0ZSBnZW5lcmF0b3IgY2FsbHNcbiAqL1xuZXhwb3J0IGNsYXNzIENmblRlbXBsYXRlR2VuZXJhdG9yUHJvdmlkZXIge1xuICBwcml2YXRlIGNmbjogSUNsb3VkRm9ybWF0aW9uQ2xpZW50O1xuICBjb25zdHJ1Y3RvcihjZm46IElDbG91ZEZvcm1hdGlvbkNsaWVudCkge1xuICAgIHRoaXMuY2ZuID0gY2ZuO1xuICB9XG5cbiAgYXN5bmMgY2hlY2tGb3JSZXNvdXJjZVNjYW4oXG4gICAgcmVzb3VyY2VTY2FuU3VtbWFyaWVzOiBSZXNvdXJjZVNjYW5TdW1tYXJ5W10gfCB1bmRlZmluZWQsXG4gICAgb3B0aW9uczogR2VuZXJhdGVUZW1wbGF0ZU9wdGlvbnMsXG4gICAgY2xpZW50UmVxdWVzdFRva2VuOiBzdHJpbmcsXG4gICkge1xuICAgIGlmICghcmVzb3VyY2VTY2FuU3VtbWFyaWVzIHx8IHJlc291cmNlU2NhblN1bW1hcmllcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGlmIChvcHRpb25zLmZyb21TY2FuID09PSBGcm9tU2Nhbi5NT1NUX1JFQ0VOVCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgJ05vIHNjYW5zIGZvdW5kLiBQbGVhc2UgZWl0aGVyIHN0YXJ0IGEgbmV3IHNjYW4gd2l0aCB0aGUgYC0tZnJvbS1zY2FuYCBuZXcgb3IgZG8gbm90IHNwZWNpZnkgYSBgLS1mcm9tLXNjYW5gIG9wdGlvbi4nLFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHJpbnQoJ05vIHNjYW5zIGZvdW5kLiBJbml0aWF0aW5nIGEgbmV3IHJlc291cmNlIHNjYW4uJyk7XG4gICAgICAgIGF3YWl0IHRoaXMuc3RhcnRSZXNvdXJjZVNjYW4oY2xpZW50UmVxdWVzdFRva2VuKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIGEgdG9rZW5pemVkIGxpc3Qgb2YgcmVzb3VyY2VzIGFuZCB0aGVpciBhc3NvY2lhdGVkIHNjYW4uIElmIGEgdG9rZW4gaXMgcHJlc2VudCB0aGUgZnVuY3Rpb25cbiAgICogd2lsbCBsb29wIHRocm91Z2ggYWxsIHBhZ2VzIGFuZCBjb21iaW5lIHRoZW0gaW50byBhIHNpbmdsZSBsaXN0IG9mIFNjYW5uZWRSZWxhdGVkUmVzb3VyY2VzXG4gICAqXG4gICAqIEBwYXJhbSBzY2FuSWQgc2NhbiBpZCBmb3IgdGhlIHRvIGxpc3QgcmVzb3VyY2VzIGZvclxuICAgKiBAcGFyYW0gcmVzb3VyY2VzIEEgbGlzdCBvZiByZXNvdXJjZXMgdG8gZmluZCByZWxhdGVkIHJlc291cmNlcyBmb3JcbiAgICovXG4gIGFzeW5jIGdldFJlc291cmNlU2NhblJlbGF0ZWRSZXNvdXJjZXMoXG4gICAgc2NhbklkOiBzdHJpbmcsXG4gICAgcmVzb3VyY2VzOiBTY2FubmVkUmVzb3VyY2VbXSxcbiAgKTogUHJvbWlzZTxTY2FubmVkUmVzb3VyY2VJZGVudGlmaWVyW10+IHtcbiAgICBsZXQgcmVsYXRlZFJlc291cmNlTGlzdCA9IHJlc291cmNlcztcblxuICAgIC8vIGJyZWFrIHRoZSBsaXN0IG9mIHJlc291cmNlcyBpbnRvIGNodW5rcyBvZiAxMDAgdG8gYXZvaWQgaGl0dGluZyB0aGUgMTAwIHJlc291cmNlIGxpbWl0XG4gICAgZm9yIChjb25zdCBjaHVuayBvZiBjaHVua3MocmVzb3VyY2VzLCAxMDApKSB7XG4gICAgICAvLyBnZXQgdGhlIGZpcnN0IHBhZ2Ugb2YgcmVsYXRlZCByZXNvdXJjZXNcbiAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHRoaXMuY2ZuLmxpc3RSZXNvdXJjZVNjYW5SZWxhdGVkUmVzb3VyY2VzKHtcbiAgICAgICAgUmVzb3VyY2VTY2FuSWQ6IHNjYW5JZCxcbiAgICAgICAgUmVzb3VyY2VzOiBjaHVuayxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBhZGQgdGhlIGZpcnN0IHBhZ2UgdG8gdGhlIGxpc3RcbiAgICAgIHJlbGF0ZWRSZXNvdXJjZUxpc3QucHVzaCguLi4ocmVzLlJlbGF0ZWRSZXNvdXJjZXMgPz8gW10pKTtcbiAgICAgIGxldCBuZXh0VG9rZW4gPSByZXMuTmV4dFRva2VuO1xuXG4gICAgICAvLyBpZiB0aGVyZSBhcmUgbW9yZSBwYWdlcywgY3ljbGUgdGhyb3VnaCB0aGVtIGFuZCBhZGQgdGhlbSB0byB0aGUgbGlzdCBiZWZvcmUgbW92aW5nIG9uIHRvIHRoZSBuZXh0IGNodW5rXG4gICAgICB3aGlsZSAobmV4dFRva2VuKSB7XG4gICAgICAgIGNvbnN0IG5leHRSZWxhdGVkUmVzb3VyY2VzID0gYXdhaXQgdGhpcy5jZm4ubGlzdFJlc291cmNlU2NhblJlbGF0ZWRSZXNvdXJjZXMoe1xuICAgICAgICAgIFJlc291cmNlU2NhbklkOiBzY2FuSWQsXG4gICAgICAgICAgUmVzb3VyY2VzOiByZXNvdXJjZUlkZW50aWZpZXJzKHJlc291cmNlcyksXG4gICAgICAgICAgTmV4dFRva2VuOiBuZXh0VG9rZW4sXG4gICAgICAgIH0pO1xuICAgICAgICBuZXh0VG9rZW4gPSBuZXh0UmVsYXRlZFJlc291cmNlcy5OZXh0VG9rZW47XG4gICAgICAgIHJlbGF0ZWRSZXNvdXJjZUxpc3QucHVzaCguLi4obmV4dFJlbGF0ZWRSZXNvdXJjZXMuUmVsYXRlZFJlc291cmNlcyA/PyBbXSkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJlbGF0ZWRSZXNvdXJjZUxpc3QgPSBkZWR1cGxpY2F0ZVJlc291cmNlcyhyZWxhdGVkUmVzb3VyY2VMaXN0KTtcblxuICAgIC8vIHBydW5lIHRoZSBtYW5hZ2VkYnlzdGFjayBmbGFnIG9mZiBvZiB0aGVtIGFnYWluLlxuICAgIHJldHVybiBwcm9jZXNzLmVudi5NSUdSQVRFX0lOVEVHX1RFU1RcbiAgICAgID8gcmVzb3VyY2VJZGVudGlmaWVycyhyZWxhdGVkUmVzb3VyY2VMaXN0KVxuICAgICAgOiByZXNvdXJjZUlkZW50aWZpZXJzKGV4Y2x1ZGVNYW5hZ2VkKHJlbGF0ZWRSZXNvdXJjZUxpc3QpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBLaWNrcyBvZmYgYSBzY2FuIG9mIGEgY3VzdG9tZXJzIGFjY291bnQsIHJldHVybmluZyB0aGUgc2NhbiBpZC4gQSBzY2FuIGNhbiB0YWtlXG4gICAqIDEwIG1pbnV0ZXMgb3IgbG9uZ2VyIHRvIGNvbXBsZXRlLiBIb3dldmVyIHRoaXMgd2lsbCByZXR1cm4gYSBzY2FuIGlkIGFzIHNvb24gYXNcbiAgICogdGhlIHNjYW4gaGFzIGJlZ3VuLlxuICAgKlxuICAgKiBAcmV0dXJucyBBIHN0cmluZyByZXByZXNlbnRpbmcgdGhlIHNjYW4gaWRcbiAgICovXG4gIGFzeW5jIHN0YXJ0UmVzb3VyY2VTY2FuKHJlcXVlc3RUb2tlbjogc3RyaW5nKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIGF3YWl0IHRoaXMuY2ZuLnN0YXJ0UmVzb3VyY2VTY2FuKHtcbiAgICAgICAgQ2xpZW50UmVxdWVzdFRva2VuOiByZXF1ZXN0VG9rZW4sXG4gICAgICB9KVxuICAgICkuUmVzb3VyY2VTY2FuSWQ7XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgbW9zdCByZWNlbnQgc2NhbnMgYSBjdXN0b21lciBoYXMgY29tcGxldGVkXG4gICAqXG4gICAqIEByZXR1cm5zIGEgbGlzdCBvZiByZXNvdXJjZSBzY2FuIHN1bW1hcmllc1xuICAgKi9cbiAgYXN5bmMgbGlzdFJlc291cmNlU2NhbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuY2ZuLmxpc3RSZXNvdXJjZVNjYW5zKCk7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIGEgdG9rZW5pemVkIGxpc3Qgb2YgcmVzb3VyY2VzIGZyb20gYSByZXNvdXJjZSBzY2FuLiBJZiBhIHRva2VuIGlzIHByZXNlbnQsIHRoaXMgZnVuY3Rpb25cbiAgICogd2lsbCBsb29wIHRocm91Z2ggYWxsIHBhZ2VzIGFuZCBjb21iaW5lIHRoZW0gaW50byBhIHNpbmdsZSBsaXN0IG9mIFNjYW5uZWRSZXNvdXJjZVtdLlxuICAgKiBBZGRpdGlvbmFsbHkgd2lsbCBhcHBseSBhbnkgZmlsdGVycyBwcm92aWRlZCBieSB0aGUgY3VzdG9tZXIuXG4gICAqXG4gICAqIEBwYXJhbSBzY2FuSWQgc2NhbiBpZCBmb3IgdGhlIHRvIGxpc3QgcmVzb3VyY2VzIGZvclxuICAgKiBAcGFyYW0gZmlsdGVycyBhIHN0cmluZyBvZiBmaWx0ZXJzIGluIHRoZSBmb3JtYXQgb2Yga2V5MT12YWx1ZTEsa2V5Mj12YWx1ZTJcbiAgICogQHJldHVybnMgYSBjb21iaW5lZCBsaXN0IG9mIGFsbCByZXNvdXJjZXMgZnJvbSB0aGUgc2NhblxuICAgKi9cbiAgYXN5bmMgbGlzdFJlc291cmNlU2NhblJlc291cmNlcyhzY2FuSWQ6IHN0cmluZywgZmlsdGVyczogc3RyaW5nW10gPSBbXSk6IFByb21pc2U8U2Nhbm5lZFJlc291cmNlSWRlbnRpZmllcltdPiB7XG4gICAgbGV0IHJlc291cmNlTGlzdDogU2Nhbm5lZFJlc291cmNlW10gPSBbXTtcbiAgICBsZXQgcmVzb3VyY2VTY2FuSW5wdXRzOiBMaXN0UmVzb3VyY2VTY2FuUmVzb3VyY2VzQ29tbWFuZElucHV0O1xuXG4gICAgaWYgKGZpbHRlcnMubGVuZ3RoID4gMCkge1xuICAgICAgcHJpbnQoJ0FwcGx5aW5nIGZpbHRlcnMgdG8gcmVzb3VyY2Ugc2Nhbi4nKTtcbiAgICAgIGZvciAoY29uc3QgZmlsdGVyIG9mIGZpbHRlcnMpIHtcbiAgICAgICAgY29uc3QgZmlsdGVyTGlzdCA9IHBhcnNlRmlsdGVycyhmaWx0ZXIpO1xuICAgICAgICByZXNvdXJjZVNjYW5JbnB1dHMgPSB7XG4gICAgICAgICAgUmVzb3VyY2VTY2FuSWQ6IHNjYW5JZCxcbiAgICAgICAgICBSZXNvdXJjZUlkZW50aWZpZXI6IGZpbHRlckxpc3RbRmlsdGVyVHlwZS5SRVNPVVJDRV9JREVOVElGSUVSXSxcbiAgICAgICAgICBSZXNvdXJjZVR5cGVQcmVmaXg6IGZpbHRlckxpc3RbRmlsdGVyVHlwZS5SRVNPVVJDRV9UWVBFX1BSRUZJWF0sXG4gICAgICAgICAgVGFnS2V5OiBmaWx0ZXJMaXN0W0ZpbHRlclR5cGUuVEFHX0tFWV0sXG4gICAgICAgICAgVGFnVmFsdWU6IGZpbHRlckxpc3RbRmlsdGVyVHlwZS5UQUdfVkFMVUVdLFxuICAgICAgICB9O1xuICAgICAgICBjb25zdCByZXNvdXJjZXMgPSBhd2FpdCB0aGlzLmNmbi5saXN0UmVzb3VyY2VTY2FuUmVzb3VyY2VzKHJlc291cmNlU2NhbklucHV0cyk7XG4gICAgICAgIHJlc291cmNlTGlzdCA9IHJlc291cmNlTGlzdC5jb25jYXQocmVzb3VyY2VzLlJlc291cmNlcyA/PyBbXSk7XG4gICAgICAgIGxldCBuZXh0VG9rZW4gPSByZXNvdXJjZXMuTmV4dFRva2VuO1xuXG4gICAgICAgIC8vIGN5Y2xlIHRocm91Z2ggdGhlIHBhZ2VzIGFkZGluZyBhbGwgcmVzb3VyY2VzIHRvIHRoZSBsaXN0IHVudGlsIHdlIHJ1biBvdXQgb2YgcGFnZXNcbiAgICAgICAgd2hpbGUgKG5leHRUb2tlbikge1xuICAgICAgICAgIHJlc291cmNlU2NhbklucHV0cy5OZXh0VG9rZW4gPSBuZXh0VG9rZW47XG4gICAgICAgICAgY29uc3QgbmV4dFJlc291cmNlcyA9IGF3YWl0IHRoaXMuY2ZuLmxpc3RSZXNvdXJjZVNjYW5SZXNvdXJjZXMocmVzb3VyY2VTY2FuSW5wdXRzKTtcbiAgICAgICAgICBuZXh0VG9rZW4gPSBuZXh0UmVzb3VyY2VzLk5leHRUb2tlbjtcbiAgICAgICAgICByZXNvdXJjZUxpc3QgPSByZXNvdXJjZUxpc3QhLmNvbmNhdChuZXh0UmVzb3VyY2VzLlJlc291cmNlcyA/PyBbXSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcHJpbnQoJ05vIGZpbHRlcnMgcHJvdmlkZWQuIFJldHJpZXZpbmcgYWxsIHJlc291cmNlcyBmcm9tIHNjYW4uJyk7XG4gICAgICByZXNvdXJjZVNjYW5JbnB1dHMgPSB7XG4gICAgICAgIFJlc291cmNlU2NhbklkOiBzY2FuSWQsXG4gICAgICB9O1xuICAgICAgY29uc3QgcmVzb3VyY2VzID0gYXdhaXQgdGhpcy5jZm4ubGlzdFJlc291cmNlU2NhblJlc291cmNlcyhyZXNvdXJjZVNjYW5JbnB1dHMpO1xuICAgICAgcmVzb3VyY2VMaXN0ID0gcmVzb3VyY2VMaXN0IS5jb25jYXQocmVzb3VyY2VzLlJlc291cmNlcyA/PyBbXSk7XG4gICAgICBsZXQgbmV4dFRva2VuID0gcmVzb3VyY2VzLk5leHRUb2tlbjtcblxuICAgICAgLy8gY3ljbGUgdGhyb3VnaCB0aGUgcGFnZXMgYWRkaW5nIGFsbCByZXNvdXJjZXMgdG8gdGhlIGxpc3QgdW50aWwgd2UgcnVuIG91dCBvZiBwYWdlc1xuICAgICAgd2hpbGUgKG5leHRUb2tlbikge1xuICAgICAgICByZXNvdXJjZVNjYW5JbnB1dHMuTmV4dFRva2VuID0gbmV4dFRva2VuO1xuICAgICAgICBjb25zdCBuZXh0UmVzb3VyY2VzID0gYXdhaXQgdGhpcy5jZm4ubGlzdFJlc291cmNlU2NhblJlc291cmNlcyhyZXNvdXJjZVNjYW5JbnB1dHMpO1xuICAgICAgICBuZXh0VG9rZW4gPSBuZXh0UmVzb3VyY2VzLk5leHRUb2tlbjtcbiAgICAgICAgcmVzb3VyY2VMaXN0ID0gcmVzb3VyY2VMaXN0IS5jb25jYXQobmV4dFJlc291cmNlcy5SZXNvdXJjZXMgPz8gW10pO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAocmVzb3VyY2VMaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyByZXNvdXJjZXMgZm91bmQgd2l0aCBmaWx0ZXJzICR7ZmlsdGVycy5qb2luKCcgJyl9LiBQbGVhc2UgdHJ5IGFnYWluIHdpdGggZGlmZmVyZW50IGZpbHRlcnMuYCk7XG4gICAgfVxuICAgIHJlc291cmNlTGlzdCA9IGRlZHVwbGljYXRlUmVzb3VyY2VzKHJlc291cmNlTGlzdCk7XG5cbiAgICByZXR1cm4gcHJvY2Vzcy5lbnYuTUlHUkFURV9JTlRFR19URVNUXG4gICAgICA/IHJlc291cmNlSWRlbnRpZmllcnMocmVzb3VyY2VMaXN0KVxuICAgICAgOiByZXNvdXJjZUlkZW50aWZpZXJzKGV4Y2x1ZGVNYW5hZ2VkKHJlc291cmNlTGlzdCkpO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHJpZXZlcyBpbmZvcm1hdGlvbiBhYm91dCBhIHJlc291cmNlIHNjYW4uXG4gICAqXG4gICAqIEBwYXJhbSBzY2FuSWQgc2NhbiBpZCBmb3IgdGhlIHRvIGxpc3QgcmVzb3VyY2VzIGZvclxuICAgKiBAcmV0dXJucyBpbmZvcm1hdGlvbiBhYm91dCB0aGUgc2NhblxuICAgKi9cbiAgYXN5bmMgZGVzY3JpYmVSZXNvdXJjZVNjYW4oc2NhbklkOiBzdHJpbmcpOiBQcm9taXNlPERlc2NyaWJlUmVzb3VyY2VTY2FuQ29tbWFuZE91dHB1dD4ge1xuICAgIHJldHVybiB0aGlzLmNmbi5kZXNjcmliZVJlc291cmNlU2Nhbih7XG4gICAgICBSZXNvdXJjZVNjYW5JZDogc2NhbklkLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIERlc2NyaWJlcyB0aGUgY3VycmVudCBzdGF0dXMgb2YgdGhlIHRlbXBsYXRlIGJlaW5nIGdlbmVyYXRlZC5cbiAgICpcbiAgICogQHBhcmFtIHRlbXBsYXRlSWQgQSBzdHJpbmcgcmVwcmVzZW50aW5nIHRoZSB0ZW1wbGF0ZSBpZFxuICAgKiBAcmV0dXJucyBEZXNjcmliZUdlbmVyYXRlZFRlbXBsYXRlT3V0cHV0IGFuIG9iamVjdCBjb250YWluaW5nIHRoZSB0ZW1wbGF0ZSBzdGF0dXMgYW5kIHJlc3VsdHNcbiAgICovXG4gIGFzeW5jIGRlc2NyaWJlR2VuZXJhdGVkVGVtcGxhdGUodGVtcGxhdGVJZDogc3RyaW5nKTogUHJvbWlzZTxEZXNjcmliZUdlbmVyYXRlZFRlbXBsYXRlQ29tbWFuZE91dHB1dD4ge1xuICAgIGNvbnN0IGdlbmVyYXRlZFRlbXBsYXRlID0gYXdhaXQgdGhpcy5jZm4uZGVzY3JpYmVHZW5lcmF0ZWRUZW1wbGF0ZSh7XG4gICAgICBHZW5lcmF0ZWRUZW1wbGF0ZU5hbWU6IHRlbXBsYXRlSWQsXG4gICAgfSk7XG5cbiAgICBpZiAoZ2VuZXJhdGVkVGVtcGxhdGUuU3RhdHVzID09IFNjYW5TdGF0dXMuRkFJTEVEKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZ2VuZXJhdGVkVGVtcGxhdGUuU3RhdHVzUmVhc29uKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZ2VuZXJhdGVkVGVtcGxhdGU7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIGEgY29tcGxldGVkIGdlbmVyYXRlZCBjbG91ZGZvcm1hdGlvbiB0ZW1wbGF0ZSBmcm9tIHRoZSB0ZW1wbGF0ZSBnZW5lcmF0b3IuXG4gICAqXG4gICAqIEBwYXJhbSB0ZW1wbGF0ZUlkIEEgc3RyaW5nIHJlcHJlc2VudGluZyB0aGUgdGVtcGxhdGUgaWRcbiAgICogQHBhcmFtIGNsb3VkRm9ybWF0aW9uIFRoZSBDbG91ZEZvcm1hdGlvbiBzZGsgY2xpZW50IHRvIHVzZVxuICAgKiBAcmV0dXJucyBEZXNjcmliZUdlbmVyYXRlZFRlbXBsYXRlT3V0cHV0IGFuIG9iamVjdCBjb250YWluaW5nIHRoZSB0ZW1wbGF0ZSBzdGF0dXMgYW5kIGJvZHlcbiAgICovXG4gIGFzeW5jIGdldEdlbmVyYXRlZFRlbXBsYXRlKHRlbXBsYXRlSWQ6IHN0cmluZyk6IFByb21pc2U8R2V0R2VuZXJhdGVkVGVtcGxhdGVDb21tYW5kT3V0cHV0PiB7XG4gICAgcmV0dXJuIHRoaXMuY2ZuLmdldEdlbmVyYXRlZFRlbXBsYXRlKHtcbiAgICAgIEdlbmVyYXRlZFRlbXBsYXRlTmFtZTogdGVtcGxhdGVJZCxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBLaWNrcyBvZmYgYSB0ZW1wbGF0ZSBnZW5lcmF0aW9uIGZvciBhIHNldCBvZiByZXNvdXJjZXMuXG4gICAqXG4gICAqIEBwYXJhbSBzdGFja05hbWUgVGhlIG5hbWUgb2YgdGhlIHN0YWNrXG4gICAqIEBwYXJhbSByZXNvdXJjZXMgQSBsaXN0IG9mIHJlc291cmNlcyB0byBnZW5lcmF0ZSB0aGUgdGVtcGxhdGUgZnJvbVxuICAgKiBAcmV0dXJucyBDcmVhdGVHZW5lcmF0ZWRUZW1wbGF0ZU91dHB1dCBhbiBvYmplY3QgY29udGFpbmluZyB0aGUgdGVtcGxhdGUgYXJuIHRvIHF1ZXJ5IG9uIGxhdGVyXG4gICAqL1xuICBhc3luYyBjcmVhdGVHZW5lcmF0ZWRUZW1wbGF0ZShzdGFja05hbWU6IHN0cmluZywgcmVzb3VyY2VzOiBSZXNvdXJjZURlZmluaXRpb25bXSkge1xuICAgIGNvbnN0IGNyZWF0ZVRlbXBsYXRlT3V0cHV0ID0gYXdhaXQgdGhpcy5jZm4uY3JlYXRlR2VuZXJhdGVkVGVtcGxhdGUoe1xuICAgICAgUmVzb3VyY2VzOiByZXNvdXJjZXMsXG4gICAgICBHZW5lcmF0ZWRUZW1wbGF0ZU5hbWU6IHN0YWNrTmFtZSxcbiAgICB9KTtcblxuICAgIGlmIChjcmVhdGVUZW1wbGF0ZU91dHB1dC5HZW5lcmF0ZWRUZW1wbGF0ZUlkID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ3JlYXRlR2VuZXJhdGVkVGVtcGxhdGUgZmFpbGVkIHRvIHJldHVybiBhbiBBcm4uJyk7XG4gICAgfVxuICAgIHJldHVybiBjcmVhdGVUZW1wbGF0ZU91dHB1dDtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWxldGVzIGEgZ2VuZXJhdGVkIHRlbXBsYXRlIGZyb20gdGhlIHRlbXBsYXRlIGdlbmVyYXRvci5cbiAgICpcbiAgICogQHBhcmFtIHRlbXBsYXRlQXJuIFRoZSBhcm4gb2YgdGhlIHRlbXBsYXRlIHRvIGRlbGV0ZVxuICAgKiBAcmV0dXJucyBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHRoZSB0ZW1wbGF0ZSBoYXMgYmVlbiBkZWxldGVkXG4gICAqL1xuICBhc3luYyBkZWxldGVHZW5lcmF0ZWRUZW1wbGF0ZSh0ZW1wbGF0ZUFybjogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5jZm4uZGVsZXRlR2VuZXJhdGVkVGVtcGxhdGUoe1xuICAgICAgR2VuZXJhdGVkVGVtcGxhdGVOYW1lOiB0ZW1wbGF0ZUFybixcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFRoZSBwb3NzaWJsZSB3YXlzIHRvIGNob29zZSBhIHNjYW4gdG8gZ2VuZXJhdGUgYSBDREsgYXBwbGljYXRpb24gZnJvbVxuICovXG5leHBvcnQgZW51bSBGcm9tU2NhbiB7XG4gIC8qKlxuICAgKiBJbml0aWF0ZSBhIG5ldyByZXNvdXJjZSBzY2FuIHRvIGJ1aWxkIHRoZSBDREsgYXBwbGljYXRpb24gZnJvbS5cbiAgICovXG4gIE5FVyxcblxuICAvKipcbiAgICogVXNlIHRoZSBsYXN0IHN1Y2Nlc3NmdWwgc2NhbiB0byBidWlsZCB0aGUgQ0RLIGFwcGxpY2F0aW9uIGZyb20uIFdpbGwgZmFpbCBpZiBubyBzY2FuIGlzIGZvdW5kLlxuICAgKi9cbiAgTU9TVF9SRUNFTlQsXG5cbiAgLyoqXG4gICAqIFN0YXJ0cyBhIHNjYW4gaWYgbm9uZSBleGlzdHMsIG90aGVyd2lzZSB1c2VzIHRoZSBtb3N0IHJlY2VudCBzdWNjZXNzZnVsIHNjYW4gdG8gYnVpbGQgdGhlIENESyBhcHBsaWNhdGlvbiBmcm9tLlxuICAgKi9cbiAgREVGQVVMVCxcbn1cblxuLyoqXG4gKiBJbnRlcmZhY2UgZm9yIHRoZSBvcHRpb25zIG9iamVjdCBwYXNzZWQgdG8gdGhlIGdlbmVyYXRlVGVtcGxhdGUgZnVuY3Rpb25cbiAqXG4gKiBAcGFyYW0gc3RhY2tOYW1lIFRoZSBuYW1lIG9mIHRoZSBzdGFja1xuICogQHBhcmFtIGZpbHRlcnMgQSBsaXN0IG9mIGZpbHRlcnMgdG8gYXBwbHkgdG8gdGhlIHNjYW5cbiAqIEBwYXJhbSBmcm9tU2NhbiBBbiBlbnVtIHZhbHVlIHNwZWNpZnlpbmcgd2hldGhlciBhIG5ldyBzY2FuIHNob3VsZCBiZSBzdGFydGVkIG9yIHRoZSBtb3N0IHJlY2VudCBzdWNjZXNzZnVsIHNjYW4gc2hvdWxkIGJlIHVzZWRcbiAqIEBwYXJhbSBzZGtQcm92aWRlciBUaGUgc2RrIHByb3ZpZGVyIGZvciBtYWtpbmcgQ2xvdWRGb3JtYXRpb24gY2FsbHNcbiAqIEBwYXJhbSBlbnZpcm9ubWVudCBUaGUgYWNjb3VudCBhbmQgcmVnaW9uIHdoZXJlIHRoZSBzdGFjayBpcyBkZXBsb3llZFxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdlbmVyYXRlVGVtcGxhdGVPcHRpb25zIHtcbiAgc3RhY2tOYW1lOiBzdHJpbmc7XG4gIGZpbHRlcnM/OiBzdHJpbmdbXTtcbiAgZnJvbVNjYW4/OiBGcm9tU2NhbjtcbiAgc2RrUHJvdmlkZXI6IFNka1Byb3ZpZGVyO1xuICBlbnZpcm9ubWVudDogRW52aXJvbm1lbnQ7XG59XG5cbi8qKlxuICogSW50ZXJmYWNlIGZvciB0aGUgb3V0cHV0IG9mIHRoZSBnZW5lcmF0ZVRlbXBsYXRlIGZ1bmN0aW9uXG4gKlxuICogQHBhcmFtIG1pZ3JhdGVKc29uIFRoZSBnZW5lcmF0ZWQgTWlncmF0ZS5qc29uIGZpbGVcbiAqIEBwYXJhbSByZXNvdXJjZXMgVGhlIGdlbmVyYXRlZCB0ZW1wbGF0ZVxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdlbmVyYXRlVGVtcGxhdGVPdXRwdXQge1xuICBtaWdyYXRlSnNvbjogTWlncmF0ZUpzb25Gb3JtYXQ7XG4gIHJlc291cmNlcz86IFJlc291cmNlRGV0YWlsW107XG4gIHRlbXBsYXRlSWQ/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogSW50ZXJmYWNlIGRlZmluaW5nIHRoZSBmb3JtYXQgb2YgdGhlIGdlbmVyYXRlZCBNaWdyYXRlLmpzb24gZmlsZVxuICpcbiAqIEBwYXJhbSBUZW1wbGF0ZUJvZHkgVGhlIGdlbmVyYXRlZCB0ZW1wbGF0ZVxuICogQHBhcmFtIFNvdXJjZSBUaGUgc291cmNlIG9mIHRoZSB0ZW1wbGF0ZVxuICogQHBhcmFtIFJlc291cmNlcyBBIGxpc3Qgb2YgcmVzb3VyY2VzIHRoYXQgd2VyZSB1c2VkIHRvIGdlbmVyYXRlIHRoZSB0ZW1wbGF0ZVxuICovXG5leHBvcnQgaW50ZXJmYWNlIE1pZ3JhdGVKc29uRm9ybWF0IHtcbiAgdGVtcGxhdGVCb2R5OiBzdHJpbmc7XG4gIHNvdXJjZTogc3RyaW5nO1xuICByZXNvdXJjZXM/OiBHZW5lcmF0ZWRSZXNvdXJjZUltcG9ydElkZW50aWZpZXJbXTtcbn1cblxuLyoqXG4gKiBJbnRlcmZhY2UgcmVwcmVzZW50aW5nIHRoZSBmb3JtYXQgb2YgYSByZXNvdXJjZSBpZGVudGlmaWVyIHJlcXVpcmVkIGZvciByZXNvdXJjZSBpbXBvcnRcbiAqXG4gKiBAcGFyYW0gUmVzb3VyY2VUeXBlIFRoZSB0eXBlIG9mIHJlc291cmNlXG4gKiBAcGFyYW0gTG9naWNhbFJlc291cmNlSWQgVGhlIGxvZ2ljYWwgaWQgb2YgdGhlIHJlc291cmNlXG4gKiBAcGFyYW0gUmVzb3VyY2VJZGVudGlmaWVyIFRoZSByZXNvdXJjZSBpZGVudGlmaWVyIG9mIHRoZSByZXNvdXJjZVxuICovXG5leHBvcnQgaW50ZXJmYWNlIEdlbmVyYXRlZFJlc291cmNlSW1wb3J0SWRlbnRpZmllciB7XG4gIC8vIGNkayBkZXBsb3kgZXhwZWN0cyB0aGUgbWlncmF0ZS5qc29uIHJlc291cmNlIGlkZW50aWZpZXJzIHRvIGJlIFBhc2NhbENhc2UsIG5vdCBjYW1lbENhc2UuXG4gIFJlc291cmNlVHlwZTogc3RyaW5nO1xuICBMb2dpY2FsUmVzb3VyY2VJZDogc3RyaW5nO1xuICBSZXNvdXJjZUlkZW50aWZpZXI6IFJlc291cmNlSWRlbnRpZmllclN1bW1hcnk7XG59XG4iXX0=