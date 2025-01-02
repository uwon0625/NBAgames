import type { CliConfig, DynamicResult } from '@aws-cdk/yargs-gen';
/**
 * Source of truth for all CDK CLI commands. `yargs-gen` translates this into the `yargs` definition
 * in `lib/parse-command-line-arguments.ts`.
 */
export declare function makeConfig(): CliConfig;
/**
 * Informs the code library, `@aws-cdk/yargs-gen`, that
 * this value references an entity not defined in this configuration file.
 */
export declare class DynamicValue {
    /**
     * Instructs `yargs-gen` to retrieve this value from the parameter with passed name.
     */
    static fromParameter(parameterName: string): DynamicResult;
    static fromInline(f: () => any): DynamicResult;
}
