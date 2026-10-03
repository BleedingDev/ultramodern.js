import type { EncodedSignalValue } from './signals/types.js';
export interface IndependentHydrateCapture {
    readonly name: string;
    readonly type: 'json';
}
export interface IndependentHydrateManifestTemplate {
    readonly version: 1;
    readonly boundaryId: string;
    readonly exportName: string;
    readonly captureSchema: readonly IndependentHydrateCapture[];
    readonly hookSeed: number;
    readonly idSeed: number;
    readonly signalSites: readonly string[];
    readonly parentDependencies: false;
}
export interface IndependentHydrateBuildRecord {
    readonly moduleId: string;
    readonly styles: readonly string[];
}
/** Compiler proof plus request-specific encoded captures for one island. */
export interface IndependentHydrateManifest extends IndependentHydrateManifestTemplate {
    readonly buildId: string;
    /** Per-render instance boundary, not the compiler template lookup key. */
    readonly boundaryId: string;
    readonly moduleId: string;
    readonly captures: readonly EncodedSignalValue[];
    readonly styles: readonly string[];
}
export declare function isIndependentHydrateManifest(value: unknown): value is IndependentHydrateManifest;
export declare function createIndependentHydrateManifest(template: IndependentHydrateManifestTemplate, values: readonly unknown[], instanceBoundaryId: string, buildId: string, build: IndependentHydrateBuildRecord): IndependentHydrateManifest;
export declare function serializeIndependentHydrateManifest(manifest: IndependentHydrateManifest): string;
