"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginHost = exports.TESTING = void 0;
exports.markTesting = markTesting;
const util_1 = require("util");
const chalk = require("chalk");
const context_provider_plugin_1 = require("./context-provider-plugin");
const logging_1 = require("../../logging");
exports.TESTING = false;
function markTesting() {
    exports.TESTING = true;
}
/**
 * A utility to manage plug-ins.
 *
 */
class PluginHost {
    constructor() {
        /**
         * Access the currently registered CredentialProviderSources. New sources can
         * be registered using the +registerCredentialProviderSource+ method.
         */
        this.credentialProviderSources = new Array();
        this.contextProviderPlugins = {};
        if (!exports.TESTING && PluginHost.instance && PluginHost.instance !== this) {
            throw new Error('New instances of PluginHost must not be built. Use PluginHost.instance instead!');
        }
    }
    /**
     * Loads a plug-in into this PluginHost.
     *
     * @param moduleSpec the specification (path or name) of the plug-in module to be loaded.
     */
    load(moduleSpec) {
        try {
            /* eslint-disable @typescript-eslint/no-require-imports */
            const plugin = require(moduleSpec);
            /* eslint-enable */
            if (!isPlugin(plugin)) {
                (0, logging_1.error)(`Module ${chalk.green(moduleSpec)} is not a valid plug-in, or has an unsupported version.`);
                throw new Error(`Module ${moduleSpec} does not define a valid plug-in.`);
            }
            if (plugin.init) {
                plugin.init(this);
            }
        }
        catch (e) {
            (0, logging_1.error)(`Unable to load ${chalk.green(moduleSpec)}: ${e.stack}`);
            throw new Error(`Unable to load plug-in: ${moduleSpec}: ${e}`);
        }
        function isPlugin(x) {
            return x != null && x.version === '1';
        }
    }
    /**
     * Allows plug-ins to register new CredentialProviderSources.
     *
     * @param source a new CredentialProviderSource to register.
     */
    registerCredentialProviderSource(source) {
        // Forward to the right credentials-related plugin host
        this.credentialProviderSources.push(source);
    }
    /**
     * (EXPERIMENTAL) Allow plugins to register context providers
     *
     * Context providers are objects with the following method:
     *
     * ```ts
     *   getValue(args: {[key: string]: any}): Promise<any>;
     * ```
     *
     * Currently, they cannot reuse the CDK's authentication mechanisms, so they
     * must be prepared to either not make AWS calls or use their own source of
     * AWS credentials.
     *
     * This feature is experimental, and only intended to be used internally at Amazon
     * as a trial.
     *
     * After registering with 'my-plugin-name', the provider must be addressed as follows:
     *
     * ```ts
     * const value = ContextProvider.getValue(this, {
     *   providerName: 'plugin',
     *   props: {
     *     pluginName: 'my-plugin-name',
     *     myParameter1: 'xyz',
     *   },
     *   includeEnvironment: true | false,
     *   dummyValue: 'what-to-return-on-the-first-pass',
     * })
     * ```
     *
     * @experimental
     */
    registerContextProviderAlpha(pluginProviderName, provider) {
        if (!(0, context_provider_plugin_1.isContextProviderPlugin)(provider)) {
            throw new Error(`Object you gave me does not look like a ContextProviderPlugin: ${(0, util_1.inspect)(provider)}`);
        }
        this.contextProviderPlugins[pluginProviderName] = provider;
    }
}
exports.PluginHost = PluginHost;
PluginHost.instance = new PluginHost();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsicGx1Z2luLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQVNBLGtDQUVDO0FBWEQsK0JBQStCO0FBQy9CLCtCQUErQjtBQUUvQix1RUFBZ0c7QUFFaEcsMkNBQXNDO0FBRTNCLFFBQUEsT0FBTyxHQUFHLEtBQUssQ0FBQztBQUUzQixTQUFnQixXQUFXO0lBQ3pCLGVBQU8sR0FBRyxJQUFJLENBQUM7QUFDakIsQ0FBQztBQWlDRDs7O0dBR0c7QUFDSCxNQUFhLFVBQVU7SUFXckI7UUFSQTs7O1dBR0c7UUFDYSw4QkFBeUIsR0FBRyxJQUFJLEtBQUssRUFBNEIsQ0FBQztRQUVsRSwyQkFBc0IsR0FBMEMsRUFBRSxDQUFDO1FBR2pGLElBQUksQ0FBQyxlQUFPLElBQUksVUFBVSxDQUFDLFFBQVEsSUFBSSxVQUFVLENBQUMsUUFBUSxLQUFLLElBQUksRUFBRSxDQUFDO1lBQ3BFLE1BQU0sSUFBSSxLQUFLLENBQUMsaUZBQWlGLENBQUMsQ0FBQztRQUNyRyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxJQUFJLENBQUMsVUFBa0I7UUFDNUIsSUFBSSxDQUFDO1lBQ0gsMERBQTBEO1lBQzFELE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQztZQUNuQyxtQkFBbUI7WUFDbkIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO2dCQUN0QixJQUFBLGVBQUssRUFBQyxVQUFVLEtBQUssQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLHlEQUF5RCxDQUFDLENBQUM7Z0JBQ2xHLE1BQU0sSUFBSSxLQUFLLENBQUMsVUFBVSxVQUFVLG1DQUFtQyxDQUFDLENBQUM7WUFDM0UsQ0FBQztZQUNELElBQUksTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDO2dCQUNoQixNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3BCLENBQUM7UUFDSCxDQUFDO1FBQUMsT0FBTyxDQUFNLEVBQUUsQ0FBQztZQUNoQixJQUFBLGVBQUssRUFBQyxrQkFBa0IsS0FBSyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQztZQUMvRCxNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixVQUFVLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUNqRSxDQUFDO1FBRUQsU0FBUyxRQUFRLENBQUMsQ0FBTTtZQUN0QixPQUFPLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQyxDQUFDLE9BQU8sS0FBSyxHQUFHLENBQUM7UUFDeEMsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ0ksZ0NBQWdDLENBQUMsTUFBZ0M7UUFDdEUsdURBQXVEO1FBQ3ZELElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDOUMsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O09BK0JHO0lBQ0ksNEJBQTRCLENBQUMsa0JBQTBCLEVBQUUsUUFBK0I7UUFDN0YsSUFBSSxDQUFDLElBQUEsaURBQXVCLEVBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztZQUN2QyxNQUFNLElBQUksS0FBSyxDQUFDLGtFQUFrRSxJQUFBLGNBQU8sRUFBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDekcsQ0FBQztRQUNELElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLFFBQVEsQ0FBQztJQUM3RCxDQUFDOztBQTNGSCxnQ0E0RkM7QUEzRmUsbUJBQVEsR0FBRyxJQUFJLFVBQVUsRUFBRSxBQUFuQixDQUFvQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGluc3BlY3QgfSBmcm9tICd1dGlsJztcbmltcG9ydCAqIGFzIGNoYWxrIGZyb20gJ2NoYWxrJztcblxuaW1wb3J0IHsgdHlwZSBDb250ZXh0UHJvdmlkZXJQbHVnaW4sIGlzQ29udGV4dFByb3ZpZGVyUGx1Z2luIH0gZnJvbSAnLi9jb250ZXh0LXByb3ZpZGVyLXBsdWdpbic7XG5pbXBvcnQgdHlwZSB7IENyZWRlbnRpYWxQcm92aWRlclNvdXJjZSB9IGZyb20gJy4vY3JlZGVudGlhbC1wcm92aWRlci1zb3VyY2UnO1xuaW1wb3J0IHsgZXJyb3IgfSBmcm9tICcuLi8uLi9sb2dnaW5nJztcblxuZXhwb3J0IGxldCBURVNUSU5HID0gZmFsc2U7XG5cbmV4cG9ydCBmdW5jdGlvbiBtYXJrVGVzdGluZygpIHtcbiAgVEVTVElORyA9IHRydWU7XG59XG5cbi8qKlxuICogVGhlIGJhc2ljIGNvbnRyYWN0IGZvciBwbHVnLWlucyB0byBhZGhlcmUgdG86OlxuICpcbiAqICAgaW1wb3J0IHsgUGx1Z2luLCBQbHVnaW5Ib3N0IH0gZnJvbSAnYXdzLWNkayc7XG4gKiAgIGltcG9ydCB7IEN1c3RvbUNyZWRlbnRpYWxQcm92aWRlclNvdXJjZSB9IGZyb20gJy4vY3VzdG9tLWNyZWRlbnRpYWwtcHJvdmlkZXItc291cmNlJztcbiAqXG4gKiAgIGV4cG9ydCBkZWZhdWx0IGNsYXNzIEZvb0NES1BsdWdJbiBpbXBsZW1lbnRzIFBsdWdpbkhvc3Qge1xuICogICAgIHB1YmxpYyByZWFkb25seSB2ZXJzaW9uID0gJzEnO1xuICpcbiAqICAgICBwdWJsaWMgaW5pdChob3N0OiBQbHVnaW5Ib3N0KSB7XG4gKiAgICAgaG9zdC5yZWdpc3RlckNyZWRlbnRpYWxQcm92aWRlclNvdXJjZShuZXcgQ3VzdG9tQ3JlZGVudGlhbFByb3ZpZGVyU291cmNlKCkpO1xuICogICAgIH1cbiAqICAgfVxuICpcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBQbHVnaW4ge1xuICAvKipcbiAgICogVGhlIHZlcnNpb24gb2YgdGhlIHBsdWctaW4gaW50ZXJmYWNlIHVzZWQgYnkgdGhlIHBsdWctaW4uIFRoaXMgd2lsbCBiZSB1c2VkIGJ5XG4gICAqIHRoZSBwbHVnLWluIGhvc3QgdG8gaGFuZGxlIHZlcnNpb24gY2hhbmdlcy5cbiAgICovXG4gIHZlcnNpb246ICcxJztcblxuICAvKipcbiAgICogV2hlbiBkZWZpbmVkLCB0aGlzIGZ1bmN0aW9uIGlzIGludm9rZWQgcmlnaHQgYWZ0ZXIgdGhlIHBsdWctaW4gaGFzIGJlZW4gbG9hZGVkLFxuICAgKiBzbyB0aGF0IHRoZSBwbHVnLWluIGlzIGFibGUgdG8gaW5pdGlhbGl6ZSBpdHNlbGYuIEl0IG1heSBjYWxsIG1ldGhvZHMgb2YgdGhlXG4gICAqIGBgUGx1Z2luSG9zdGBgIGluc3RhbmNlIGl0IHJlY2VpdmVzIHRvIHJlZ2lzdGVyIG5ldyBgYENyZWRlbnRpYWxQcm92aWRlclNvdXJjZWBgXG4gICAqIGluc3RhbmNlcy5cbiAgICovXG4gIGluaXQ/OiAoaG9zdDogUGx1Z2luSG9zdCkgPT4gdm9pZDtcbn1cblxuLyoqXG4gKiBBIHV0aWxpdHkgdG8gbWFuYWdlIHBsdWctaW5zLlxuICpcbiAqL1xuZXhwb3J0IGNsYXNzIFBsdWdpbkhvc3Qge1xuICBwdWJsaWMgc3RhdGljIGluc3RhbmNlID0gbmV3IFBsdWdpbkhvc3QoKTtcblxuICAvKipcbiAgICogQWNjZXNzIHRoZSBjdXJyZW50bHkgcmVnaXN0ZXJlZCBDcmVkZW50aWFsUHJvdmlkZXJTb3VyY2VzLiBOZXcgc291cmNlcyBjYW5cbiAgICogYmUgcmVnaXN0ZXJlZCB1c2luZyB0aGUgK3JlZ2lzdGVyQ3JlZGVudGlhbFByb3ZpZGVyU291cmNlKyBtZXRob2QuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgY3JlZGVudGlhbFByb3ZpZGVyU291cmNlcyA9IG5ldyBBcnJheTxDcmVkZW50aWFsUHJvdmlkZXJTb3VyY2U+KCk7XG5cbiAgcHVibGljIHJlYWRvbmx5IGNvbnRleHRQcm92aWRlclBsdWdpbnM6IFJlY29yZDxzdHJpbmcsIENvbnRleHRQcm92aWRlclBsdWdpbj4gPSB7fTtcblxuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBpZiAoIVRFU1RJTkcgJiYgUGx1Z2luSG9zdC5pbnN0YW5jZSAmJiBQbHVnaW5Ib3N0Lmluc3RhbmNlICE9PSB0aGlzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ05ldyBpbnN0YW5jZXMgb2YgUGx1Z2luSG9zdCBtdXN0IG5vdCBiZSBidWlsdC4gVXNlIFBsdWdpbkhvc3QuaW5zdGFuY2UgaW5zdGVhZCEnKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9hZHMgYSBwbHVnLWluIGludG8gdGhpcyBQbHVnaW5Ib3N0LlxuICAgKlxuICAgKiBAcGFyYW0gbW9kdWxlU3BlYyB0aGUgc3BlY2lmaWNhdGlvbiAocGF0aCBvciBuYW1lKSBvZiB0aGUgcGx1Zy1pbiBtb2R1bGUgdG8gYmUgbG9hZGVkLlxuICAgKi9cbiAgcHVibGljIGxvYWQobW9kdWxlU3BlYzogc3RyaW5nKSB7XG4gICAgdHJ5IHtcbiAgICAgIC8qIGVzbGludC1kaXNhYmxlIEB0eXBlc2NyaXB0LWVzbGludC9uby1yZXF1aXJlLWltcG9ydHMgKi9cbiAgICAgIGNvbnN0IHBsdWdpbiA9IHJlcXVpcmUobW9kdWxlU3BlYyk7XG4gICAgICAvKiBlc2xpbnQtZW5hYmxlICovXG4gICAgICBpZiAoIWlzUGx1Z2luKHBsdWdpbikpIHtcbiAgICAgICAgZXJyb3IoYE1vZHVsZSAke2NoYWxrLmdyZWVuKG1vZHVsZVNwZWMpfSBpcyBub3QgYSB2YWxpZCBwbHVnLWluLCBvciBoYXMgYW4gdW5zdXBwb3J0ZWQgdmVyc2lvbi5gKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNb2R1bGUgJHttb2R1bGVTcGVjfSBkb2VzIG5vdCBkZWZpbmUgYSB2YWxpZCBwbHVnLWluLmApO1xuICAgICAgfVxuICAgICAgaWYgKHBsdWdpbi5pbml0KSB7XG4gICAgICAgIHBsdWdpbi5pbml0KHRoaXMpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGU6IGFueSkge1xuICAgICAgZXJyb3IoYFVuYWJsZSB0byBsb2FkICR7Y2hhbGsuZ3JlZW4obW9kdWxlU3BlYyl9OiAke2Uuc3RhY2t9YCk7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBsb2FkIHBsdWctaW46ICR7bW9kdWxlU3BlY306ICR7ZX1gKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpc1BsdWdpbih4OiBhbnkpOiB4IGlzIFBsdWdpbiB7XG4gICAgICByZXR1cm4geCAhPSBudWxsICYmIHgudmVyc2lvbiA9PT0gJzEnO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBbGxvd3MgcGx1Zy1pbnMgdG8gcmVnaXN0ZXIgbmV3IENyZWRlbnRpYWxQcm92aWRlclNvdXJjZXMuXG4gICAqXG4gICAqIEBwYXJhbSBzb3VyY2UgYSBuZXcgQ3JlZGVudGlhbFByb3ZpZGVyU291cmNlIHRvIHJlZ2lzdGVyLlxuICAgKi9cbiAgcHVibGljIHJlZ2lzdGVyQ3JlZGVudGlhbFByb3ZpZGVyU291cmNlKHNvdXJjZTogQ3JlZGVudGlhbFByb3ZpZGVyU291cmNlKSB7XG4gICAgLy8gRm9yd2FyZCB0byB0aGUgcmlnaHQgY3JlZGVudGlhbHMtcmVsYXRlZCBwbHVnaW4gaG9zdFxuICAgIHRoaXMuY3JlZGVudGlhbFByb3ZpZGVyU291cmNlcy5wdXNoKHNvdXJjZSk7XG4gIH1cblxuICAvKipcbiAgICogKEVYUEVSSU1FTlRBTCkgQWxsb3cgcGx1Z2lucyB0byByZWdpc3RlciBjb250ZXh0IHByb3ZpZGVyc1xuICAgKlxuICAgKiBDb250ZXh0IHByb3ZpZGVycyBhcmUgb2JqZWN0cyB3aXRoIHRoZSBmb2xsb3dpbmcgbWV0aG9kOlxuICAgKlxuICAgKiBgYGB0c1xuICAgKiAgIGdldFZhbHVlKGFyZ3M6IHtba2V5OiBzdHJpbmddOiBhbnl9KTogUHJvbWlzZTxhbnk+O1xuICAgKiBgYGBcbiAgICpcbiAgICogQ3VycmVudGx5LCB0aGV5IGNhbm5vdCByZXVzZSB0aGUgQ0RLJ3MgYXV0aGVudGljYXRpb24gbWVjaGFuaXNtcywgc28gdGhleVxuICAgKiBtdXN0IGJlIHByZXBhcmVkIHRvIGVpdGhlciBub3QgbWFrZSBBV1MgY2FsbHMgb3IgdXNlIHRoZWlyIG93biBzb3VyY2Ugb2ZcbiAgICogQVdTIGNyZWRlbnRpYWxzLlxuICAgKlxuICAgKiBUaGlzIGZlYXR1cmUgaXMgZXhwZXJpbWVudGFsLCBhbmQgb25seSBpbnRlbmRlZCB0byBiZSB1c2VkIGludGVybmFsbHkgYXQgQW1hem9uXG4gICAqIGFzIGEgdHJpYWwuXG4gICAqXG4gICAqIEFmdGVyIHJlZ2lzdGVyaW5nIHdpdGggJ215LXBsdWdpbi1uYW1lJywgdGhlIHByb3ZpZGVyIG11c3QgYmUgYWRkcmVzc2VkIGFzIGZvbGxvd3M6XG4gICAqXG4gICAqIGBgYHRzXG4gICAqIGNvbnN0IHZhbHVlID0gQ29udGV4dFByb3ZpZGVyLmdldFZhbHVlKHRoaXMsIHtcbiAgICogICBwcm92aWRlck5hbWU6ICdwbHVnaW4nLFxuICAgKiAgIHByb3BzOiB7XG4gICAqICAgICBwbHVnaW5OYW1lOiAnbXktcGx1Z2luLW5hbWUnLFxuICAgKiAgICAgbXlQYXJhbWV0ZXIxOiAneHl6JyxcbiAgICogICB9LFxuICAgKiAgIGluY2x1ZGVFbnZpcm9ubWVudDogdHJ1ZSB8IGZhbHNlLFxuICAgKiAgIGR1bW15VmFsdWU6ICd3aGF0LXRvLXJldHVybi1vbi10aGUtZmlyc3QtcGFzcycsXG4gICAqIH0pXG4gICAqIGBgYFxuICAgKlxuICAgKiBAZXhwZXJpbWVudGFsXG4gICAqL1xuICBwdWJsaWMgcmVnaXN0ZXJDb250ZXh0UHJvdmlkZXJBbHBoYShwbHVnaW5Qcm92aWRlck5hbWU6IHN0cmluZywgcHJvdmlkZXI6IENvbnRleHRQcm92aWRlclBsdWdpbikge1xuICAgIGlmICghaXNDb250ZXh0UHJvdmlkZXJQbHVnaW4ocHJvdmlkZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE9iamVjdCB5b3UgZ2F2ZSBtZSBkb2VzIG5vdCBsb29rIGxpa2UgYSBDb250ZXh0UHJvdmlkZXJQbHVnaW46ICR7aW5zcGVjdChwcm92aWRlcil9YCk7XG4gICAgfVxuICAgIHRoaXMuY29udGV4dFByb3ZpZGVyUGx1Z2luc1twbHVnaW5Qcm92aWRlck5hbWVdID0gcHJvdmlkZXI7XG4gIH1cbn1cbiJdfQ==