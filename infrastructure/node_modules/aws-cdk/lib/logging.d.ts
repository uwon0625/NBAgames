/**
 * Available log levels in order of increasing verbosity.
 */
export declare enum LogLevel {
    ERROR = "error",
    WARN = "warn",
    INFO = "info",
    DEBUG = "debug",
    TRACE = "trace"
}
/**
 * Configuration options for a log entry.
 */
export interface LogEntry {
    level: LogLevel;
    message: string;
    timestamp?: boolean;
    prefix?: string;
    style?: ((str: string) => string);
    forceStdout?: boolean;
}
/**
 * Sets the current log level. Messages with a lower priority level will be filtered out.
 * @param level - The new log level to set
 */
export declare function setLogLevel(level: LogLevel): void;
/**
 * Sets whether the logger is running in CI mode.
 * In CI mode, all non-error output goes to stdout instead of stderr.
 * @param newCI - Whether CI mode should be enabled
 */
export declare function setCI(newCI: boolean): void;
/**
 * Executes a block of code with corked logging. All log messages during execution
 * are buffered and only written after the block completes.
 * @param block - Async function to execute with corked logging
 * @returns Promise that resolves with the block's return value
 */
export declare function withCorkedLogging<T>(block: () => Promise<T>): Promise<T>;
/**
 * Core logging function that handles all log output.
 * @param entry - LogEntry object or log level
 * @param fmt - Format string (when using with log level)
 * @param args - Format arguments (when using with log level)
 */
export declare function log(entry: LogEntry): void;
export declare function log(level: LogLevel, fmt: string, ...args: unknown[]): void;
export declare const error: (fmt: string, ...args: unknown[]) => void;
export declare const warning: (fmt: string, ...args: unknown[]) => void;
export declare const info: (fmt: string, ...args: unknown[]) => void;
export declare const print: (fmt: string, ...args: unknown[]) => void;
export declare const data: (fmt: string, ...args: unknown[]) => void;
export declare const debug: (fmt: string, ...args: unknown[]) => void;
export declare const trace: (fmt: string, ...args: unknown[]) => void;
export declare const success: (fmt: string, ...args: unknown[]) => void;
export declare const highlight: (fmt: string, ...args: unknown[]) => void;
/**
 * Creates a logging function that prepends a prefix to all messages.
 * @param prefixString - String to prepend to all messages
 * @param level - Log level to use (defaults to INFO)
 * @returns Logging function that accepts format string and arguments
 */
export declare function prefix(prefixString: string, level?: LogLevel): (fmt: string, ...args: unknown[]) => void;
