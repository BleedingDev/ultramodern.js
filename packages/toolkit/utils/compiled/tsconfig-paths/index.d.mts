/**
 * A function that json from a file
 */
interface ReadJsonSync {
    (packageJsonPath: string): any | undefined;
}
interface FileExistsSync {
    (name: string): boolean;
}
interface FileExistsAsync {
    (path: string, callback: (err?: Error, exists?: boolean) => void): void;
}
interface ReadJsonAsyncCallback {
    (err?: Error, content?: any): void;
}
interface ReadJsonAsync {
    (path: string, callback: ReadJsonAsyncCallback): void;
}

interface MappingEntry {
    readonly pattern: string;
    readonly paths: ReadonlyArray<string>;
}

/**
 * Function that can match a path
 */
interface MatchPath {
    (requestedModule: string, readJson?: ReadJsonSync, fileExists?: (name: string) => boolean, extensions?: ReadonlyArray<string>): string | undefined;
}
/**
 * Creates a function that can resolve paths according to tsconfig paths property.
 *
 * @param absoluteBaseUrl Absolute version of baseUrl as specified in tsconfig.
 * @param paths The paths as specified in tsconfig.
 * @param mainFields A list of package.json field names to try when resolving module files. Select a nested field using an array of field names.
 * @param addMatchAll Add a match-all "*" rule if none is present
 * @returns a function that can resolve paths.
 */
declare function createMatchPath(absoluteBaseUrl: string, paths: {
    [key: string]: Array<string>;
}, mainFields?: (string | string[])[], addMatchAll?: boolean): MatchPath;
/**
 * Finds a path from tsconfig that matches a module load request.
 *
 * @param absolutePathMappings The paths to try as specified in tsconfig but resolved to absolute form.
 * @param requestedModule The required module name.
 * @param readJson Function that can read json from a path (useful for testing).
 * @param fileExists Function that checks for existence of a file at a path (useful for testing).
 * @param extensions File extensions to probe for (useful for testing).
 * @param mainFields A list of package.json field names to try when resolving module files. Select a nested field using an array of field names.
 * @returns the found path, or undefined if no path was found.
 */
declare function matchFromAbsolutePaths(absolutePathMappings: ReadonlyArray<MappingEntry>, requestedModule: string, readJson?: ReadJsonSync, fileExists?: FileExistsSync, extensions?: Array<string>, mainFields?: (string | string[])[]): string | undefined;

/**
 * Function that can match a path async
 */
interface MatchPathAsync {
    (requestedModule: string, readJson: ReadJsonAsync | undefined, fileExists: FileExistsAsync | undefined, extensions: ReadonlyArray<string> | undefined, callback: MatchPathAsyncCallback): void;
}
interface MatchPathAsyncCallback {
    (err?: Error, path?: string): void;
}
/**
 * See the sync version for docs.
 */
declare function createMatchPathAsync(absoluteBaseUrl: string, paths: {
    [key: string]: Array<string>;
}, mainFields?: (string | string[])[], addMatchAll?: boolean): MatchPathAsync;
/**
 * See the sync version for docs.
 */
declare function matchFromAbsolutePathsAsync(absolutePathMappings: ReadonlyArray<MappingEntry>, requestedModule: string, readJson: ReadJsonAsync | undefined, fileExists: FileExistsAsync | undefined, extensions: readonly string[] | undefined, callback: MatchPathAsyncCallback, mainFields?: (string | string[])[]): void;

interface ExplicitParams {
    baseUrl: string;
    paths: {
        [key: string]: Array<string>;
    };
    mainFields?: (string | string[])[];
    addMatchAll?: boolean;
}
interface ConfigLoaderSuccessResult {
    resultType: "success";
    configFileAbsolutePath: string;
    baseUrl?: string;
    absoluteBaseUrl: string;
    paths: {
        [key: string]: Array<string>;
    };
    mainFields?: (string | string[])[];
    addMatchAll?: boolean;
}
interface ConfigLoaderFailResult {
    resultType: "failed";
    message: string;
}
declare type ConfigLoaderResult = ConfigLoaderSuccessResult | ConfigLoaderFailResult;
declare function loadConfig(cwd?: string): ConfigLoaderResult;

interface RegisterParams extends ExplicitParams {
    /**
     * Defaults to `--project` CLI flag or `process.cwd()`
     */
    cwd?: string;
}
/**
 * Installs a custom module load function that can adhere to paths in tsconfig.
 * Returns a function to undo paths registration.
 */
declare function register(params?: RegisterParams): () => void;

export { createMatchPath, createMatchPathAsync, loadConfig, matchFromAbsolutePaths, matchFromAbsolutePathsAsync, register };
export type { ConfigLoaderFailResult, ConfigLoaderResult, ConfigLoaderSuccessResult, FileExistsAsync, FileExistsSync, MatchPath, MatchPathAsync, ReadJsonAsync, ReadJsonSync };
