"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CachedDataSource = exports.WebsiteNoticeDataSource = exports.FilteredNotice = exports.Notices = exports.NoticesFilter = void 0;
const https = require("https");
const path = require("path");
const fs = require("fs-extra");
const semver = require("semver");
const logging_1 = require("./logging");
const tree_1 = require("./tree");
const util_1 = require("./util");
const directories_1 = require("./util/directories");
const version_1 = require("./version");
const CACHE_FILE_PATH = path.join((0, directories_1.cdkCacheDir)(), 'notices.json');
class NoticesFilter {
    static filter(options) {
        return [
            ...this.findForCliVersion(options.data, options.cliVersion),
            ...this.findForFrameworkVersion(options.data, options.outDir),
            ...this.findForBootstrapVersion(options.data, options.bootstrappedEnvironments),
        ];
    }
    static findForCliVersion(data, cliVersion) {
        return (0, util_1.flatMap)(data, notice => {
            const affectedComponent = notice.components.find(component => component.name === 'cli');
            const affectedRange = affectedComponent?.version;
            if (affectedRange == null) {
                return [];
            }
            if (!semver.satisfies(cliVersion, affectedRange)) {
                return [];
            }
            return [new FilteredNotice(notice)];
        });
    }
    static findForFrameworkVersion(data, outDir) {
        const tree = (0, tree_1.loadTreeFromDir)(outDir);
        return (0, util_1.flatMap)(data, notice => {
            //  A match happens when:
            //
            //  1. The version of the node matches the version in the notice, interpreted
            //  as a semver range.
            //
            //  AND
            //
            //  2. The name in the notice is a prefix of the node name when the query ends in '.',
            //  or the two names are exactly the same, otherwise.
            const matched = (0, tree_1.some)(tree, node => {
                return this.resolveAliases(notice.components).some(component => compareNames(component.name, node.constructInfo?.fqn) &&
                    compareVersions(component.version, node.constructInfo?.version));
            });
            if (!matched) {
                return [];
            }
            return [new FilteredNotice(notice)];
            function compareNames(pattern, target) {
                if (target == null) {
                    return false;
                }
                return pattern.endsWith('.') ? target.startsWith(pattern) : pattern === target;
            }
            function compareVersions(pattern, target) {
                return semver.satisfies(target ?? '', pattern);
            }
        });
    }
    static findForBootstrapVersion(data, bootstrappedEnvironments) {
        return (0, util_1.flatMap)(data, notice => {
            const affectedComponent = notice.components.find(component => component.name === 'bootstrap');
            const affectedRange = affectedComponent?.version;
            if (affectedRange == null) {
                return [];
            }
            const affected = bootstrappedEnvironments.filter(i => {
                const semverBootstrapVersion = semver.coerce(i.bootstrapStackVersion);
                if (!semverBootstrapVersion) {
                    // we don't throw because notices should never crash the cli.
                    (0, logging_1.warning)(`While filtering notices, could not coerce bootstrap version '${i.bootstrapStackVersion}' into semver`);
                    return false;
                }
                return semver.satisfies(semverBootstrapVersion, affectedRange);
            });
            if (affected.length === 0) {
                return [];
            }
            const filtered = new FilteredNotice(notice);
            filtered.addDynamicValue('ENVIRONMENTS', affected.map(s => s.environment.name).join(','));
            return [filtered];
        });
    }
    static resolveAliases(components) {
        return (0, util_1.flatMap)(components, component => {
            if (component.name === 'framework') {
                return [{
                        name: '@aws-cdk/core.',
                        version: component.version,
                    }, {
                        name: 'aws-cdk-lib.',
                        version: component.version,
                    }];
            }
            else {
                return [component];
            }
        });
    }
}
exports.NoticesFilter = NoticesFilter;
/**
 * Provides access to notices the CLI can display.
 */
class Notices {
    /**
     * Create an instance. Note that this replaces the singleton.
     */
    static create(props) {
        this._instance = new Notices(props);
        return this._instance;
    }
    /**
     * Get the singleton instance. May return `undefined` if `create` has not been called.
     */
    static get() {
        return this._instance;
    }
    constructor(props) {
        this.data = new Set();
        // sets don't deduplicate interfaces, so we use a map.
        this.bootstrappedEnvironments = new Map();
        this.configuration = props.configuration;
        this.acknowledgedIssueNumbers = new Set(this.configuration.context.get('acknowledged-issue-numbers') ?? []);
        this.includeAcknowlegded = props.includeAcknowledged ?? false;
    }
    /**
     * Add a bootstrap information to filter on. Can have multiple values
     * in case of multi-environment deployments.
     */
    addBootstrappedEnvironment(bootstrapped) {
        const key = [
            bootstrapped.bootstrapStackVersion,
            bootstrapped.environment.account,
            bootstrapped.environment.region,
            bootstrapped.environment.name,
        ].join(':');
        this.bootstrappedEnvironments.set(key, bootstrapped);
    }
    /**
     * Refresh the list of notices this instance is aware of.
     * To make sure this never crashes the CLI process, all failures are caught and
     * slitently logged.
     *
     * If context is configured to not display notices, this will no-op.
     */
    async refresh(options = {}) {
        if (!this.shouldDisplay()) {
            return;
        }
        try {
            const dataSource = new CachedDataSource(CACHE_FILE_PATH, options.dataSource ?? new WebsiteNoticeDataSource(), options.force ?? false);
            const notices = await dataSource.fetch();
            this.data = new Set(this.includeAcknowlegded ? notices : notices.filter(n => !this.acknowledgedIssueNumbers.has(n.issueNumber)));
        }
        catch (e) {
            (0, logging_1.debug)(`Could not refresh notices: ${e}`);
        }
    }
    /**
     * Display the relevant notices (unless context dictates we shouldn't).
     */
    display(options = {}) {
        if (!this.shouldDisplay()) {
            return;
        }
        const filteredNotices = NoticesFilter.filter({
            data: Array.from(this.data),
            cliVersion: (0, version_1.versionNumber)(),
            outDir: this.configuration.settings.get(['output']) ?? 'cdk.out',
            bootstrappedEnvironments: Array.from(this.bootstrappedEnvironments.values()),
        });
        if (filteredNotices.length > 0) {
            (0, logging_1.print)('');
            (0, logging_1.print)('NOTICES         (What\'s this? https://github.com/aws/aws-cdk/wiki/CLI-Notices)');
            (0, logging_1.print)('');
            for (const filtered of filteredNotices) {
                const formatted = filtered.format();
                switch (filtered.notice.severity) {
                    case 'warning':
                        (0, logging_1.warning)(formatted);
                        break;
                    case 'error':
                        (0, logging_1.error)(formatted);
                        break;
                    default:
                        (0, logging_1.print)(formatted);
                }
                (0, logging_1.print)('');
            }
            (0, logging_1.print)(`If you don’t want to see a notice anymore, use "cdk acknowledge <id>". For example, "cdk acknowledge ${filteredNotices[0].notice.issueNumber}".`);
        }
        if (options.showTotal ?? false) {
            (0, logging_1.print)('');
            (0, logging_1.print)(`There are ${filteredNotices.length} unacknowledged notice(s).`);
        }
    }
    /**
     * Determine whether or not notices should be displayed based on the
     * configuration provided at instantiation time.
     */
    shouldDisplay() {
        return this.configuration.settings.get(['notices']) ?? true;
    }
}
exports.Notices = Notices;
/**
 * Notice after passing the filter. A filter can augment a notice with
 * dynamic values as it has access to the dynamic matching data.
 */
class FilteredNotice {
    constructor(notice) {
        this.notice = notice;
        this.dynamicValues = {};
    }
    addDynamicValue(key, value) {
        this.dynamicValues[`{resolve:${key}}`] = value;
    }
    format() {
        const componentsValue = this.notice.components.map(c => `${c.name}: ${c.version}`).join(', ');
        return this.resolveDynamicValues([
            `${this.notice.issueNumber}\t${this.notice.title}`,
            this.formatOverview(),
            `\tAffected versions: ${componentsValue}`,
            `\tMore information at: https://github.com/aws/aws-cdk/issues/${this.notice.issueNumber}`,
        ].join('\n\n') + '\n');
    }
    formatOverview() {
        const wrap = (s) => s.replace(/(?![^\n]{1,60}$)([^\n]{1,60})\s/g, '$1\n');
        const heading = 'Overview: ';
        const separator = `\n\t${' '.repeat(heading.length)}`;
        const content = wrap(this.notice.overview)
            .split('\n')
            .join(separator);
        return '\t' + heading + content;
    }
    resolveDynamicValues(input) {
        const pattern = new RegExp(Object.keys(this.dynamicValues).join('|'), 'g');
        return input.replace(pattern, (matched) => this.dynamicValues[matched] ?? matched);
    }
}
exports.FilteredNotice = FilteredNotice;
class WebsiteNoticeDataSource {
    fetch() {
        const timeout = 3000;
        return new Promise((resolve, reject) => {
            let req;
            let timer = setTimeout(() => {
                if (req) {
                    req.destroy(new Error('Request timed out'));
                }
            }, timeout);
            timer.unref();
            try {
                req = https.get('https://cli.cdk.dev-tools.aws.dev/notices.json', res => {
                    if (res.statusCode === 200) {
                        res.setEncoding('utf8');
                        let rawData = '';
                        res.on('data', (chunk) => {
                            rawData += chunk;
                        });
                        res.on('end', () => {
                            try {
                                const data = JSON.parse(rawData).notices;
                                if (!data) {
                                    throw new Error("'notices' key is missing");
                                }
                                (0, logging_1.debug)('Notices refreshed');
                                resolve(data ?? []);
                            }
                            catch (e) {
                                reject(new Error(`Failed to parse notices: ${e.message}`));
                            }
                        });
                        res.on('error', e => {
                            reject(new Error(`Failed to fetch notices: ${e.message}`));
                        });
                    }
                    else {
                        reject(new Error(`Failed to fetch notices. Status code: ${res.statusCode}`));
                    }
                });
                req.on('error', reject);
            }
            catch (e) {
                reject(new Error(`HTTPS 'get' call threw an error: ${e.message}`));
            }
        });
    }
}
exports.WebsiteNoticeDataSource = WebsiteNoticeDataSource;
const TIME_TO_LIVE_SUCCESS = 60 * 60 * 1000; // 1 hour
const TIME_TO_LIVE_ERROR = 1 * 60 * 1000; // 1 minute
class CachedDataSource {
    constructor(fileName, dataSource, skipCache) {
        this.fileName = fileName;
        this.dataSource = dataSource;
        this.skipCache = skipCache;
    }
    async fetch() {
        const cachedData = await this.load();
        const data = cachedData.notices;
        const expiration = cachedData.expiration ?? 0;
        if (Date.now() > expiration || this.skipCache) {
            const freshData = await this.fetchInner();
            await this.save(freshData);
            return freshData.notices;
        }
        else {
            (0, logging_1.debug)(`Reading cached notices from ${this.fileName}`);
            return data;
        }
    }
    async fetchInner() {
        try {
            return {
                expiration: Date.now() + TIME_TO_LIVE_SUCCESS,
                notices: await this.dataSource.fetch(),
            };
        }
        catch (e) {
            (0, logging_1.debug)(`Could not refresh notices: ${e}`);
            return {
                expiration: Date.now() + TIME_TO_LIVE_ERROR,
                notices: [],
            };
        }
    }
    async load() {
        const defaultValue = {
            expiration: 0,
            notices: [],
        };
        try {
            return fs.existsSync(this.fileName)
                ? await fs.readJSON(this.fileName)
                : defaultValue;
        }
        catch (e) {
            (0, logging_1.debug)(`Failed to load notices from cache: ${e}`);
            return defaultValue;
        }
    }
    async save(cached) {
        try {
            await fs.writeJSON(this.fileName, cached);
        }
        catch (e) {
            (0, logging_1.debug)(`Failed to store notices in the cache: ${e}`);
        }
    }
}
exports.CachedDataSource = CachedDataSource;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibm90aWNlcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm5vdGljZXMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsK0JBQStCO0FBQy9CLDZCQUE2QjtBQUU3QiwrQkFBK0I7QUFDL0IsaUNBQWlDO0FBQ2pDLHVDQUF5RDtBQUV6RCxpQ0FBK0M7QUFDL0MsaUNBQWlDO0FBQ2pDLG9EQUFpRDtBQUNqRCx1Q0FBMEM7QUFFMUMsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFBLHlCQUFXLEdBQUUsRUFBRSxjQUFjLENBQUMsQ0FBQztBQW1EakUsTUFBYSxhQUFhO0lBRWpCLE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBbUM7UUFDdEQsT0FBTztZQUNMLEdBQUcsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsT0FBTyxDQUFDLFVBQVUsQ0FBQztZQUMzRCxHQUFHLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxNQUFNLENBQUM7WUFDN0QsR0FBRyxJQUFJLENBQUMsdUJBQXVCLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsd0JBQXdCLENBQUM7U0FDaEYsQ0FBQztJQUNKLENBQUM7SUFFTyxNQUFNLENBQUMsaUJBQWlCLENBQUMsSUFBYyxFQUFFLFVBQWtCO1FBQ2pFLE9BQU8sSUFBQSxjQUFPLEVBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxFQUFFO1lBQzVCLE1BQU0saUJBQWlCLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUMsSUFBSSxLQUFLLEtBQUssQ0FBQyxDQUFDO1lBQ3hGLE1BQU0sYUFBYSxHQUFHLGlCQUFpQixFQUFFLE9BQU8sQ0FBQztZQUVqRCxJQUFJLGFBQWEsSUFBSSxJQUFJLEVBQUUsQ0FBQztnQkFDMUIsT0FBTyxFQUFFLENBQUM7WUFD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O1FBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNYLElBQUEsZUFBSyxFQUFDLHlDQUF5QyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3RELENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUE1REQsNENBNERDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ2xpZW50UmVxdWVzdCB9IGZyb20gJ2h0dHAnO1xuaW1wb3J0ICogYXMgaHR0cHMgZnJvbSAnaHR0cHMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB0eXBlIHsgRW52aXJvbm1lbnQgfSBmcm9tICdAYXdzLWNkay9jeC1hcGknO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMtZXh0cmEnO1xuaW1wb3J0ICogYXMgc2VtdmVyIGZyb20gJ3NlbXZlcic7XG5pbXBvcnQgeyBkZWJ1ZywgcHJpbnQsIHdhcm5pbmcsIGVycm9yIH0gZnJvbSAnLi9sb2dnaW5nJztcbmltcG9ydCB7IENvbmZpZ3VyYXRpb24gfSBmcm9tICcuL3NldHRpbmdzJztcbmltcG9ydCB7IGxvYWRUcmVlRnJvbURpciwgc29tZSB9IGZyb20gJy4vdHJlZSc7XG5pbXBvcnQgeyBmbGF0TWFwIH0gZnJvbSAnLi91dGlsJztcbmltcG9ydCB7IGNka0NhY2hlRGlyIH0gZnJvbSAnLi91dGlsL2RpcmVjdG9yaWVzJztcbmltcG9ydCB7IHZlcnNpb25OdW1iZXIgfSBmcm9tICcuL3ZlcnNpb24nO1xuXG5jb25zdCBDQUNIRV9GSUxFX1BBVEggPSBwYXRoLmpvaW4oY2RrQ2FjaGVEaXIoKSwgJ25vdGljZXMuanNvbicpO1xuXG5leHBvcnQgaW50ZXJmYWNlIE5vdGljZXNQcm9wcyB7XG4gIC8qKlxuICAgKiBBIGBDb25maWd1cmF0aW9uYCBpbnN0YW5jZSBob2xkaW5nIENESyBjb250ZXh0IGFuZCBzZXR0aW5ncy5cbiAgICovXG4gIHJlYWRvbmx5IGNvbmZpZ3VyYXRpb246IENvbmZpZ3VyYXRpb247XG5cbiAgLyoqXG4gICAqIEluY2x1ZGUgbm90aWNlcyB0aGF0IGhhdmUgYWxyZWFkeSBiZWVuIGFja25vd2xlZGdlZC5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IGluY2x1ZGVBY2tub3dsZWRnZWQ/OiBib29sZWFuO1xuXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTm90aWNlc1ByaW50T3B0aW9ucyB7XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gYXBwZW5kIHRoZSB0b3RhbCBudW1iZXIgb2YgdW5hY2tub3dsZWRnZWQgbm90aWNlcyB0byB0aGUgZGlzcGxheS5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IHNob3dUb3RhbD86IGJvb2xlYW47XG5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBOb3RpY2VzUmVmcmVzaE9wdGlvbnMge1xuICAvKipcbiAgICogV2hldGhlciB0byBmb3JjZSBhIGNhY2hlIHJlZnJlc2ggcmVnYXJkbGVzcyBvZiBleHBpcmF0aW9uIHRpbWUuXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBmb3JjZT86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIERhdGEgc291cmNlIGZvciBmZXRjaCBub3RpY2VzIGZyb20uXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gV2Vic2l0ZU5vdGljZURhdGFTb3VyY2VcbiAgICovXG4gIHJlYWRvbmx5IGRhdGFTb3VyY2U/OiBOb3RpY2VEYXRhU291cmNlO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE5vdGljZXNGaWx0ZXJGaWx0ZXJPcHRpb25zIHtcbiAgcmVhZG9ubHkgZGF0YTogTm90aWNlW107XG4gIHJlYWRvbmx5IGNsaVZlcnNpb246IHN0cmluZztcbiAgcmVhZG9ubHkgb3V0RGlyOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGJvb3RzdHJhcHBlZEVudmlyb25tZW50czogQm9vdHN0cmFwcGVkRW52aXJvbm1lbnRbXTtcbn1cblxuZXhwb3J0IGNsYXNzIE5vdGljZXNGaWx0ZXIge1xuXG4gIHB1YmxpYyBzdGF0aWMgZmlsdGVyKG9wdGlvbnM6IE5vdGljZXNGaWx0ZXJGaWx0ZXJPcHRpb25zKTogRmlsdGVyZWROb3RpY2VbXSB7XG4gICAgcmV0dXJuIFtcbiAgICAgIC4uLnRoaXMuZmluZEZvckNsaVZlcnNpb24ob3B0aW9ucy5kYXRhLCBvcHRpb25zLmNsaVZlcnNpb24pLFxuICAgICAgLi4udGhpcy5maW5kRm9yRnJhbWV3b3JrVmVyc2lvbihvcHRpb25zLmRhdGEsIG9wdGlvbnMub3V0RGlyKSxcbiAgICAgIC4uLnRoaXMuZmluZEZvckJvb3RzdHJhcFZlcnNpb24ob3B0aW9ucy5kYXRhLCBvcHRpb25zLmJvb3RzdHJhcHBlZEVudmlyb25tZW50cyksXG4gICAgXTtcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIGZpbmRGb3JDbGlWZXJzaW9uKGRhdGE6IE5vdGljZVtdLCBjbGlWZXJzaW9uOiBzdHJpbmcpOiBGaWx0ZXJlZE5vdGljZVtdIHtcbiAgICByZXR1cm4gZmxhdE1hcChkYXRhLCBub3RpY2UgPT4ge1xuICAgICAgY29uc3QgYWZmZWN0ZWRDb21wb25lbnQgPSBub3RpY2UuY29tcG9uZW50cy5maW5kKGNvbXBvbmVudCA9PiBjb21wb25lbnQubmFtZSA9PT0gJ2NsaScpO1xuICAgICAgY29uc3QgYWZmZWN0ZWRSYW5nZSA9IGFmZmVjdGVkQ29tcG9uZW50Py52ZXJzaW9uO1xuXG4gICAgICBpZiAoYWZmZWN0ZWRSYW5nZSA9PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFzZW12ZXIuc2F0aXNmaWVzKGNsaVZlcnNpb24sIGFmZmVjdGVkUmFuZ2UpKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIFtuZXcgRmlsdGVyZWROb3RpY2Uobm90aWNlKV07XG4gICAgfSk7XG5cbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIGZpbmRGb3JGcmFtZXdvcmtWZXJzaW9uKGRhdGE6IE5vdGljZVtdLCBvdXREaXI6IHN0cmluZyk6IEZpbHRlcmVkTm90aWNlW10ge1xuICAgIGNvbnN0IHRyZWUgPSBsb2FkVHJlZUZyb21EaXIob3V0RGlyKTtcbiAgICByZXR1cm4gZmxhdE1hcChkYXRhLCBub3RpY2UgPT4ge1xuXG4gICAgICAvLyAgQSBtYXRjaCBoYXBwZW5zIHdoZW46XG4gICAgICAvL1xuICAgICAgLy8gIDEuIFRoZSB2ZXJzaW9uIG9mIHRoZSBub2RlIG1hdGNoZXMgdGhlIHZlcnNpb24gaW4gdGhlIG5vdGljZSwgaW50ZXJwcmV0ZWRcbiAgICAgIC8vICBhcyBhIHNlbXZlciByYW5nZS5cbiAgICAgIC8vXG4gICAgICAvLyAgQU5EXG4gICAgICAvL1xuICAgICAgLy8gIDIuIFRoZSBuYW1lIGluIHRoZSBub3RpY2UgaXMgYSBwcmVmaXggb2YgdGhlIG5vZGUgbmFtZSB3aGVuIHRoZSBxdWVyeSBlbmRzIGluICcuJyxcbiAgICAgIC8vICBvciB0aGUgdHdvIG5hbWVzIGFyZSBleGFjdGx5IHRoZSBzYW1lLCBvdGhlcndpc2UuXG5cbiAgICAgIGNvbnN0IG1hdGNoZWQgPSBzb21lKHRyZWUsIG5vZGUgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5yZXNvbHZlQWxpYXNlcyhub3RpY2UuY29tcG9uZW50cykuc29tZShjb21wb25lbnQgPT5cbiAgICAgICAgICBjb21wYXJlTmFtZXMoY29tcG9uZW50Lm5hbWUsIG5vZGUuY29uc3RydWN0SW5mbz8uZnFuKSAmJlxuICAgICAgICAgIGNvbXBhcmVWZXJzaW9ucyhjb21wb25lbnQudmVyc2lvbiwgbm9kZS5jb25zdHJ1Y3RJbmZvPy52ZXJzaW9uKSk7XG4gICAgICB9KTtcblxuICAgICAgaWYgKCFtYXRjaGVkKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIFtuZXcgRmlsdGVyZWROb3RpY2Uobm90aWNlKV07XG5cbiAgICAgIGZ1bmN0aW9uIGNvbXBhcmVOYW1lcyhwYXR0ZXJuOiBzdHJpbmcsIHRhcmdldDogc3RyaW5nIHwgdW5kZWZpbmVkKTogYm9vbGVhbiB7XG4gICAgICAgIGlmICh0YXJnZXQgPT0gbnVsbCkgeyByZXR1cm4gZmFsc2U7IH1cbiAgICAgICAgcmV0dXJuIHBhdHRlcm4uZW5kc1dpdGgoJy4nKSA/IHRhcmdldC5zdGFydHNXaXRoKHBhdHRlcm4pIDogcGF0dGVybiA9PT0gdGFyZ2V0O1xuICAgICAgfVxuXG4gICAgICBmdW5jdGlvbiBjb21wYXJlVmVyc2lvbnMocGF0dGVybjogc3RyaW5nLCB0YXJnZXQ6IHN0cmluZyB8IHVuZGVmaW5lZCk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gc2VtdmVyLnNhdGlzZmllcyh0YXJnZXQgPz8gJycsIHBhdHRlcm4pO1xuICAgICAgfVxuXG4gICAgfSk7XG5cbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIGZpbmRGb3JCb290c3RyYXBWZXJzaW9uKGRhdGE6IE5vdGljZVtdLCBib290c3RyYXBwZWRFbnZpcm9ubWVudHM6IEJvb3RzdHJhcHBlZEVudmlyb25tZW50W10pOiBGaWx0ZXJlZE5vdGljZVtdIHtcbiAgICByZXR1cm4gZmxhdE1hcChkYXRhLCBub3RpY2UgPT4ge1xuICAgICAgY29uc3QgYWZmZWN0ZWRDb21wb25lbnQgPSBub3RpY2UuY29tcG9uZW50cy5maW5kKGNvbXBvbmVudCA9PiBjb21wb25lbnQubmFtZSA9PT0gJ2Jvb3RzdHJhcCcpO1xuICAgICAgY29uc3QgYWZmZWN0ZWRSYW5nZSA9IGFmZmVjdGVkQ29tcG9uZW50Py52ZXJzaW9uO1xuXG4gICAgICBpZiAoYWZmZWN0ZWRSYW5nZSA9PSBudWxsKSB7XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgYWZmZWN0ZWQgPSBib290c3RyYXBwZWRFbnZpcm9ubWVudHMuZmlsdGVyKGkgPT4ge1xuXG4gICAgICAgIGNvbnN0IHNlbXZlckJvb3RzdHJhcFZlcnNpb24gPSBzZW12ZXIuY29lcmNlKGkuYm9vdHN0cmFwU3RhY2tWZXJzaW9uKTtcbiAgICAgICAgaWYgKCFzZW12ZXJCb290c3RyYXBWZXJzaW9uKSB7XG4gICAgICAgICAgLy8gd2UgZG9uJ3QgdGhyb3cgYmVjYXVzZSBub3RpY2VzIHNob3VsZCBuZXZlciBjcmFzaCB0aGUgY2xpLlxuICAgICAgICAgIHdhcm5pbmcoYFdoaWxlIGZpbHRlcmluZyBub3RpY2VzLCBjb3VsZCBub3QgY29lcmNlIGJvb3RzdHJhcCB2ZXJzaW9uICcke2kuYm9vdHN0cmFwU3RhY2tWZXJzaW9ufScgaW50byBzZW12ZXJgKTtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gc2VtdmVyLnNhdGlzZmllcyhzZW12ZXJCb290c3RyYXBWZXJzaW9uLCBhZmZlY3RlZFJhbmdlKTtcblxuICAgICAgfSk7XG5cbiAgICAgIGlmIChhZmZlY3RlZC5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBmaWx0ZXJlZCA9IG5ldyBGaWx0ZXJlZE5vdGljZShub3RpY2UpO1xuICAgICAgZmlsdGVyZWQuYWRkRHluYW1pY1ZhbHVlKCdFTlZJUk9OTUVOVFMnLCBhZmZlY3RlZC5tYXAocyA9PiBzLmVudmlyb25tZW50Lm5hbWUpLmpvaW4oJywnKSk7XG5cbiAgICAgIHJldHVybiBbZmlsdGVyZWRdO1xuXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyByZXNvbHZlQWxpYXNlcyhjb21wb25lbnRzOiBDb21wb25lbnRbXSk6IENvbXBvbmVudFtdIHtcbiAgICByZXR1cm4gZmxhdE1hcChjb21wb25lbnRzLCBjb21wb25lbnQgPT4ge1xuICAgICAgaWYgKGNvbXBvbmVudC5uYW1lID09PSAnZnJhbWV3b3JrJykge1xuICAgICAgICByZXR1cm4gW3tcbiAgICAgICAgICBuYW1lOiAnQGF3cy1jZGsvY29yZS4nLFxuICAgICAgICAgIHZlcnNpb246IGNvbXBvbmVudC52ZXJzaW9uLFxuICAgICAgICB9LCB7XG4gICAgICAgICAgbmFtZTogJ2F3cy1jZGstbGliLicsXG4gICAgICAgICAgdmVyc2lvbjogY29tcG9uZW50LnZlcnNpb24sXG4gICAgICAgIH1dO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIFtjb21wb25lbnRdO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbn1cblxuLyoqXG4gKiBJbmZvbXJhdGlvbiBhYm91dCBhIGJvb3RzdHJhcHBlZCBlbnZpcm9ubWVudC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBCb290c3RyYXBwZWRFbnZpcm9ubWVudCB7XG4gIHJlYWRvbmx5IGJvb3RzdHJhcFN0YWNrVmVyc2lvbjogbnVtYmVyO1xuICByZWFkb25seSBlbnZpcm9ubWVudDogRW52aXJvbm1lbnQ7XG59XG5cbi8qKlxuICogUHJvdmlkZXMgYWNjZXNzIHRvIG5vdGljZXMgdGhlIENMSSBjYW4gZGlzcGxheS5cbiAqL1xuZXhwb3J0IGNsYXNzIE5vdGljZXMge1xuXG4gIC8qKlxuICAgKiBDcmVhdGUgYW4gaW5zdGFuY2UuIE5vdGUgdGhhdCB0aGlzIHJlcGxhY2VzIHRoZSBzaW5nbGV0b24uXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGNyZWF0ZShwcm9wczogTm90aWNlc1Byb3BzKTogTm90aWNlcyB7XG4gICAgdGhpcy5faW5zdGFuY2UgPSBuZXcgTm90aWNlcyhwcm9wcyk7XG4gICAgcmV0dXJuIHRoaXMuX2luc3RhbmNlO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCB0aGUgc2luZ2xldG9uIGluc3RhbmNlLiBNYXkgcmV0dXJuIGB1bmRlZmluZWRgIGlmIGBjcmVhdGVgIGhhcyBub3QgYmVlbiBjYWxsZWQuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGdldCgpOiBOb3RpY2VzIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5faW5zdGFuY2U7XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyBfaW5zdGFuY2U6IE5vdGljZXMgfCB1bmRlZmluZWQ7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBjb25maWd1cmF0aW9uOiBDb25maWd1cmF0aW9uO1xuICBwcml2YXRlIHJlYWRvbmx5IGFja25vd2xlZGdlZElzc3VlTnVtYmVyczogU2V0PE51bWJlcj47XG4gIHByaXZhdGUgcmVhZG9ubHkgaW5jbHVkZUFja25vd2xlZ2RlZDogYm9vbGVhbjtcblxuICBwcml2YXRlIGRhdGE6IFNldDxOb3RpY2U+ID0gbmV3IFNldCgpO1xuXG4gIC8vIHNldHMgZG9uJ3QgZGVkdXBsaWNhdGUgaW50ZXJmYWNlcywgc28gd2UgdXNlIGEgbWFwLlxuICBwcml2YXRlIHJlYWRvbmx5IGJvb3RzdHJhcHBlZEVudmlyb25tZW50czogTWFwPHN0cmluZywgQm9vdHN0cmFwcGVkRW52aXJvbm1lbnQ+ID0gbmV3IE1hcCgpO1xuXG4gIHByaXZhdGUgY29uc3RydWN0b3IocHJvcHM6IE5vdGljZXNQcm9wcykge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IHByb3BzLmNvbmZpZ3VyYXRpb247XG4gICAgdGhpcy5hY2tub3dsZWRnZWRJc3N1ZU51bWJlcnMgPSBuZXcgU2V0KHRoaXMuY29uZmlndXJhdGlvbi5jb250ZXh0LmdldCgnYWNrbm93bGVkZ2VkLWlzc3VlLW51bWJlcnMnKSA/PyBbXSk7XG4gICAgdGhpcy5pbmNsdWRlQWNrbm93bGVnZGVkID0gcHJvcHMuaW5jbHVkZUFja25vd2xlZGdlZCA/PyBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYSBib290c3RyYXAgaW5mb3JtYXRpb24gdG8gZmlsdGVyIG9uLiBDYW4gaGF2ZSBtdWx0aXBsZSB2YWx1ZXNcbiAgICogaW4gY2FzZSBvZiBtdWx0aS1lbnZpcm9ubWVudCBkZXBsb3ltZW50cy5cbiAgICovXG4gIHB1YmxpYyBhZGRCb290c3RyYXBwZWRFbnZpcm9ubWVudChib290c3RyYXBwZWQ6IEJvb3RzdHJhcHBlZEVudmlyb25tZW50KSB7XG4gICAgY29uc3Qga2V5ID0gW1xuICAgICAgYm9vdHN0cmFwcGVkLmJvb3RzdHJhcFN0YWNrVmVyc2lvbixcbiAgICAgIGJvb3RzdHJhcHBlZC5lbnZpcm9ubWVudC5hY2NvdW50LFxuICAgICAgYm9vdHN0cmFwcGVkLmVudmlyb25tZW50LnJlZ2lvbixcbiAgICAgIGJvb3RzdHJhcHBlZC5lbnZpcm9ubWVudC5uYW1lLFxuICAgIF0uam9pbignOicpO1xuICAgIHRoaXMuYm9vdHN0cmFwcGVkRW52aXJvbm1lbnRzLnNldChrZXksIGJvb3RzdHJhcHBlZCk7XG4gIH1cblxuICAvKipcbiAgICogUmVmcmVzaCB0aGUgbGlzdCBvZiBub3RpY2VzIHRoaXMgaW5zdGFuY2UgaXMgYXdhcmUgb2YuXG4gICAqIFRvIG1ha2Ugc3VyZSB0aGlzIG5ldmVyIGNyYXNoZXMgdGhlIENMSSBwcm9jZXNzLCBhbGwgZmFpbHVyZXMgYXJlIGNhdWdodCBhbmRcbiAgICogc2xpdGVudGx5IGxvZ2dlZC5cbiAgICpcbiAgICogSWYgY29udGV4dCBpcyBjb25maWd1cmVkIHRvIG5vdCBkaXNwbGF5IG5vdGljZXMsIHRoaXMgd2lsbCBuby1vcC5cbiAgICovXG4gIHB1YmxpYyBhc3luYyByZWZyZXNoKG9wdGlvbnM6IE5vdGljZXNSZWZyZXNoT3B0aW9ucyA9IHt9KSB7XG5cbiAgICBpZiAoIXRoaXMuc2hvdWxkRGlzcGxheSgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRhdGFTb3VyY2UgPSBuZXcgQ2FjaGVkRGF0YVNvdXJjZShDQUNIRV9GSUxFX1BBVEgsIG9wdGlvbnMuZGF0YVNvdXJjZSA/PyBuZXcgV2Vic2l0ZU5vdGljZURhdGFTb3VyY2UoKSwgb3B0aW9ucy5mb3JjZSA/PyBmYWxzZSk7XG4gICAgICBjb25zdCBub3RpY2VzID0gYXdhaXQgZGF0YVNvdXJjZS5mZXRjaCgpO1xuICAgICAgdGhpcy5kYXRhID0gbmV3IFNldCh0aGlzLmluY2x1ZGVBY2tub3dsZWdkZWQgPyBub3RpY2VzIDogbm90aWNlcy5maWx0ZXIobiA9PiAhdGhpcy5hY2tub3dsZWRnZWRJc3N1ZU51bWJlcnMuaGFzKG4uaXNzdWVOdW1iZXIpKSk7XG4gICAgfSBjYXRjaCAoZTogYW55KSB7XG4gICAgICBkZWJ1ZyhgQ291bGQgbm90IHJlZnJlc2ggbm90aWNlczogJHtlfWApO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEaXNwbGF5IHRoZSByZWxldmFudCBub3RpY2VzICh1bmxlc3MgY29udGV4dCBkaWN0YXRlcyB3ZSBzaG91bGRuJ3QpLlxuICAgKi9cbiAgcHVibGljIGRpc3BsYXkob3B0aW9uczogTm90aWNlc1ByaW50T3B0aW9ucyA9IHt9KSB7XG5cbiAgICBpZiAoIXRoaXMuc2hvdWxkRGlzcGxheSgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZmlsdGVyZWROb3RpY2VzID0gTm90aWNlc0ZpbHRlci5maWx0ZXIoe1xuICAgICAgZGF0YTogQXJyYXkuZnJvbSh0aGlzLmRhdGEpLFxuICAgICAgY2xpVmVyc2lvbjogdmVyc2lvbk51bWJlcigpLFxuICAgICAgb3V0RGlyOiB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0dGluZ3MuZ2V0KFsnb3V0cHV0J10pID8/ICdjZGsub3V0JyxcbiAgICAgIGJvb3RzdHJhcHBlZEVudmlyb25tZW50czogQXJyYXkuZnJvbSh0aGlzLmJvb3RzdHJhcHBlZEVudmlyb25tZW50cy52YWx1ZXMoKSksXG4gICAgfSk7XG5cbiAgICBpZiAoZmlsdGVyZWROb3RpY2VzLmxlbmd0aCA+IDApIHtcbiAgICAgIHByaW50KCcnKTtcbiAgICAgIHByaW50KCdOT1RJQ0VTICAgICAgICAgKFdoYXRcXCdzIHRoaXM/IGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvYXdzLWNkay93aWtpL0NMSS1Ob3RpY2VzKScpO1xuICAgICAgcHJpbnQoJycpO1xuICAgICAgZm9yIChjb25zdCBmaWx0ZXJlZCBvZiBmaWx0ZXJlZE5vdGljZXMpIHtcbiAgICAgICAgY29uc3QgZm9ybWF0dGVkID0gZmlsdGVyZWQuZm9ybWF0KCk7XG4gICAgICAgIHN3aXRjaCAoZmlsdGVyZWQubm90aWNlLnNldmVyaXR5KSB7XG4gICAgICAgICAgY2FzZSAnd2FybmluZyc6XG4gICAgICAgICAgICB3YXJuaW5nKGZvcm1hdHRlZCk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICBjYXNlICdlcnJvcic6XG4gICAgICAgICAgICBlcnJvcihmb3JtYXR0ZWQpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgIHByaW50KGZvcm1hdHRlZCk7XG4gICAgICAgIH1cbiAgICAgICAgcHJpbnQoJycpO1xuICAgICAgfVxuICAgICAgcHJpbnQoYElmIHlvdSBkb27igJl0IHdhbnQgdG8gc2VlIGEgbm90aWNlIGFueW1vcmUsIHVzZSBcImNkayBhY2tub3dsZWRnZSA8aWQ+XCIuIEZvciBleGFtcGxlLCBcImNkayBhY2tub3dsZWRnZSAke2ZpbHRlcmVkTm90aWNlc1swXS5ub3RpY2UuaXNzdWVOdW1iZXJ9XCIuYCk7XG4gICAgfVxuXG4gICAgaWYgKG9wdGlvbnMuc2hvd1RvdGFsID8/IGZhbHNlKSB7XG4gICAgICBwcmludCgnJyk7XG4gICAgICBwcmludChgVGhlcmUgYXJlICR7ZmlsdGVyZWROb3RpY2VzLmxlbmd0aH0gdW5hY2tub3dsZWRnZWQgbm90aWNlKHMpLmApO1xuICAgIH1cblxuICB9XG5cbiAgLyoqXG4gICAqIERldGVybWluZSB3aGV0aGVyIG9yIG5vdCBub3RpY2VzIHNob3VsZCBiZSBkaXNwbGF5ZWQgYmFzZWQgb24gdGhlXG4gICAqIGNvbmZpZ3VyYXRpb24gcHJvdmlkZWQgYXQgaW5zdGFudGlhdGlvbiB0aW1lLlxuICAgKi9cbiAgcHJpdmF0ZSBzaG91bGREaXNwbGF5KCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLmNvbmZpZ3VyYXRpb24uc2V0dGluZ3MuZ2V0KFsnbm90aWNlcyddKSA/PyB0cnVlO1xuICB9XG5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBDb21wb25lbnQge1xuICBuYW1lOiBzdHJpbmc7XG4gIHZlcnNpb246IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBOb3RpY2Uge1xuICB0aXRsZTogc3RyaW5nO1xuICBpc3N1ZU51bWJlcjogbnVtYmVyO1xuICBvdmVydmlldzogc3RyaW5nO1xuICBjb21wb25lbnRzOiBDb21wb25lbnRbXTtcbiAgc2NoZW1hVmVyc2lvbjogc3RyaW5nO1xuICBzZXZlcml0eT86IHN0cmluZztcbn1cblxuLyoqXG4gKiBOb3RpY2UgYWZ0ZXIgcGFzc2luZyB0aGUgZmlsdGVyLiBBIGZpbHRlciBjYW4gYXVnbWVudCBhIG5vdGljZSB3aXRoXG4gKiBkeW5hbWljIHZhbHVlcyBhcyBpdCBoYXMgYWNjZXNzIHRvIHRoZSBkeW5hbWljIG1hdGNoaW5nIGRhdGEuXG4gKi9cbmV4cG9ydCBjbGFzcyBGaWx0ZXJlZE5vdGljZSB7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBkeW5hbWljVmFsdWVzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9ID0ge307XG5cbiAgcHVibGljIGNvbnN0cnVjdG9yKHB1YmxpYyByZWFkb25seSBub3RpY2U6IE5vdGljZSkge31cblxuICBwdWJsaWMgYWRkRHluYW1pY1ZhbHVlKGtleTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKSB7XG4gICAgdGhpcy5keW5hbWljVmFsdWVzW2B7cmVzb2x2ZToke2tleX19YF0gPSB2YWx1ZTtcbiAgfVxuXG4gIHB1YmxpYyBmb3JtYXQoKTogc3RyaW5nIHtcblxuICAgIGNvbnN0IGNvbXBvbmVudHNWYWx1ZSA9IHRoaXMubm90aWNlLmNvbXBvbmVudHMubWFwKGMgPT4gYCR7Yy5uYW1lfTogJHtjLnZlcnNpb259YCkuam9pbignLCAnKTtcbiAgICByZXR1cm4gdGhpcy5yZXNvbHZlRHluYW1pY1ZhbHVlcyhbXG4gICAgICBgJHt0aGlzLm5vdGljZS5pc3N1ZU51bWJlcn1cXHQke3RoaXMubm90aWNlLnRpdGxlfWAsXG4gICAgICB0aGlzLmZvcm1hdE92ZXJ2aWV3KCksXG4gICAgICBgXFx0QWZmZWN0ZWQgdmVyc2lvbnM6ICR7Y29tcG9uZW50c1ZhbHVlfWAsXG4gICAgICBgXFx0TW9yZSBpbmZvcm1hdGlvbiBhdDogaHR0cHM6Ly9naXRodWIuY29tL2F3cy9hd3MtY2RrL2lzc3Vlcy8ke3RoaXMubm90aWNlLmlzc3VlTnVtYmVyfWAsXG4gICAgXS5qb2luKCdcXG5cXG4nKSArICdcXG4nKTtcblxuICB9XG5cbiAgcHJpdmF0ZSBmb3JtYXRPdmVydmlldygpIHtcbiAgICBjb25zdCB3cmFwID0gKHM6IHN0cmluZykgPT4gcy5yZXBsYWNlKC8oPyFbXlxcbl17MSw2MH0kKShbXlxcbl17MSw2MH0pXFxzL2csICckMVxcbicpO1xuXG4gICAgY29uc3QgaGVhZGluZyA9ICdPdmVydmlldzogJztcbiAgICBjb25zdCBzZXBhcmF0b3IgPSBgXFxuXFx0JHsnICcucmVwZWF0KGhlYWRpbmcubGVuZ3RoKX1gO1xuICAgIGNvbnN0IGNvbnRlbnQgPSB3cmFwKHRoaXMubm90aWNlLm92ZXJ2aWV3KVxuICAgICAgLnNwbGl0KCdcXG4nKVxuICAgICAgLmpvaW4oc2VwYXJhdG9yKTtcblxuICAgIHJldHVybiAnXFx0JyArIGhlYWRpbmcgKyBjb250ZW50O1xuICB9XG5cbiAgcHJpdmF0ZSByZXNvbHZlRHluYW1pY1ZhbHVlcyhpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBwYXR0ZXJuID0gbmV3IFJlZ0V4cChPYmplY3Qua2V5cyh0aGlzLmR5bmFtaWNWYWx1ZXMpLmpvaW4oJ3wnKSwgJ2cnKTtcbiAgICByZXR1cm4gaW5wdXQucmVwbGFjZShwYXR0ZXJuLCAobWF0Y2hlZCkgPT4gdGhpcy5keW5hbWljVmFsdWVzW21hdGNoZWRdID8/IG1hdGNoZWQpO1xuICB9XG5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBOb3RpY2VEYXRhU291cmNlIHtcbiAgZmV0Y2goKTogUHJvbWlzZTxOb3RpY2VbXT47XG59XG5cbmV4cG9ydCBjbGFzcyBXZWJzaXRlTm90aWNlRGF0YVNvdXJjZSBpbXBsZW1lbnRzIE5vdGljZURhdGFTb3VyY2Uge1xuICBmZXRjaCgpOiBQcm9taXNlPE5vdGljZVtdPiB7XG4gICAgY29uc3QgdGltZW91dCA9IDMwMDA7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGxldCByZXE6IENsaWVudFJlcXVlc3QgfCB1bmRlZmluZWQ7XG5cbiAgICAgIGxldCB0aW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBpZiAocmVxKSB7XG4gICAgICAgICAgcmVxLmRlc3Ryb3kobmV3IEVycm9yKCdSZXF1ZXN0IHRpbWVkIG91dCcpKTtcbiAgICAgICAgfVxuICAgICAgfSwgdGltZW91dCk7XG5cbiAgICAgIHRpbWVyLnVucmVmKCk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJlcSA9IGh0dHBzLmdldCgnaHR0cHM6Ly9jbGkuY2RrLmRldi10b29scy5hd3MuZGV2L25vdGljZXMuanNvbicsXG4gICAgICAgICAgcmVzID0+IHtcbiAgICAgICAgICAgIGlmIChyZXMuc3RhdHVzQ29kZSA9PT0gMjAwKSB7XG4gICAgICAgICAgICAgIHJlcy5zZXRFbmNvZGluZygndXRmOCcpO1xuICAgICAgICAgICAgICBsZXQgcmF3RGF0YSA9ICcnO1xuICAgICAgICAgICAgICByZXMub24oJ2RhdGEnLCAoY2h1bmspID0+IHtcbiAgICAgICAgICAgICAgICByYXdEYXRhICs9IGNodW5rO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgcmVzLm9uKCdlbmQnLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBKU09OLnBhcnNlKHJhd0RhdGEpLm5vdGljZXMgYXMgTm90aWNlW107XG4gICAgICAgICAgICAgICAgICBpZiAoIWRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiJ25vdGljZXMnIGtleSBpcyBtaXNzaW5nXCIpO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgZGVidWcoJ05vdGljZXMgcmVmcmVzaGVkJyk7XG4gICAgICAgICAgICAgICAgICByZXNvbHZlKGRhdGEgPz8gW10pO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgRmFpbGVkIHRvIHBhcnNlIG5vdGljZXM6ICR7ZS5tZXNzYWdlfWApKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICByZXMub24oJ2Vycm9yJywgZSA9PiB7XG4gICAgICAgICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgRmFpbGVkIHRvIGZldGNoIG5vdGljZXM6ICR7ZS5tZXNzYWdlfWApKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICByZWplY3QobmV3IEVycm9yKGBGYWlsZWQgdG8gZmV0Y2ggbm90aWNlcy4gU3RhdHVzIGNvZGU6ICR7cmVzLnN0YXR1c0NvZGV9YCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICByZXEub24oJ2Vycm9yJywgcmVqZWN0KTtcbiAgICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgICByZWplY3QobmV3IEVycm9yKGBIVFRQUyAnZ2V0JyBjYWxsIHRocmV3IGFuIGVycm9yOiAke2UubWVzc2FnZX1gKSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuaW50ZXJmYWNlIENhY2hlZE5vdGljZXMge1xuICBleHBpcmF0aW9uOiBudW1iZXI7XG4gIG5vdGljZXM6IE5vdGljZVtdO1xufVxuXG5jb25zdCBUSU1FX1RPX0xJVkVfU1VDQ0VTUyA9IDYwICogNjAgKiAxMDAwOyAvLyAxIGhvdXJcbmNvbnN0IFRJTUVfVE9fTElWRV9FUlJPUiA9IDEgKiA2MCAqIDEwMDA7IC8vIDEgbWludXRlXG5cbmV4cG9ydCBjbGFzcyBDYWNoZWREYXRhU291cmNlIGltcGxlbWVudHMgTm90aWNlRGF0YVNvdXJjZSB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgZmlsZU5hbWU6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGRhdGFTb3VyY2U6IE5vdGljZURhdGFTb3VyY2UsXG4gICAgcHJpdmF0ZSByZWFkb25seSBza2lwQ2FjaGU/OiBib29sZWFuKSB7XG4gIH1cblxuICBhc3luYyBmZXRjaCgpOiBQcm9taXNlPE5vdGljZVtdPiB7XG4gICAgY29uc3QgY2FjaGVkRGF0YSA9IGF3YWl0IHRoaXMubG9hZCgpO1xuICAgIGNvbnN0IGRhdGEgPSBjYWNoZWREYXRhLm5vdGljZXM7XG4gICAgY29uc3QgZXhwaXJhdGlvbiA9IGNhY2hlZERhdGEuZXhwaXJhdGlvbiA/PyAwO1xuXG4gICAgaWYgKERhdGUubm93KCkgPiBleHBpcmF0aW9uIHx8IHRoaXMuc2tpcENhY2hlKSB7XG4gICAgICBjb25zdCBmcmVzaERhdGEgPSBhd2FpdCB0aGlzLmZldGNoSW5uZXIoKTtcbiAgICAgIGF3YWl0IHRoaXMuc2F2ZShmcmVzaERhdGEpO1xuICAgICAgcmV0dXJuIGZyZXNoRGF0YS5ub3RpY2VzO1xuICAgIH0gZWxzZSB7XG4gICAgICBkZWJ1ZyhgUmVhZGluZyBjYWNoZWQgbm90aWNlcyBmcm9tICR7dGhpcy5maWxlTmFtZX1gKTtcbiAgICAgIHJldHVybiBkYXRhO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hJbm5lcigpOiBQcm9taXNlPENhY2hlZE5vdGljZXM+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgZXhwaXJhdGlvbjogRGF0ZS5ub3coKSArIFRJTUVfVE9fTElWRV9TVUNDRVNTLFxuICAgICAgICBub3RpY2VzOiBhd2FpdCB0aGlzLmRhdGFTb3VyY2UuZmV0Y2goKSxcbiAgICAgIH07XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgZGVidWcoYENvdWxkIG5vdCByZWZyZXNoIG5vdGljZXM6ICR7ZX1gKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGV4cGlyYXRpb246IERhdGUubm93KCkgKyBUSU1FX1RPX0xJVkVfRVJST1IsXG4gICAgICAgIG5vdGljZXM6IFtdLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGxvYWQoKTogUHJvbWlzZTxDYWNoZWROb3RpY2VzPiB7XG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0ge1xuICAgICAgZXhwaXJhdGlvbjogMCxcbiAgICAgIG5vdGljZXM6IFtdLFxuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGZzLmV4aXN0c1N5bmModGhpcy5maWxlTmFtZSlcbiAgICAgICAgPyBhd2FpdCBmcy5yZWFkSlNPTih0aGlzLmZpbGVOYW1lKSBhcyBDYWNoZWROb3RpY2VzXG4gICAgICAgIDogZGVmYXVsdFZhbHVlO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGRlYnVnKGBGYWlsZWQgdG8gbG9hZCBub3RpY2VzIGZyb20gY2FjaGU6ICR7ZX1gKTtcbiAgICAgIHJldHVybiBkZWZhdWx0VmFsdWU7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzYXZlKGNhY2hlZDogQ2FjaGVkTm90aWNlcyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmcy53cml0ZUpTT04odGhpcy5maWxlTmFtZSwgY2FjaGVkKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBkZWJ1ZyhgRmFpbGVkIHRvIHN0b3JlIG5vdGljZXMgaW4gdGhlIGNhY2hlOiAke2V9YCk7XG4gICAgfVxuICB9XG59XG4iXX0=