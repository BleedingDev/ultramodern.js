import type { RouterFramework } from '@modern-js/backend-federation-contracts';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';

export interface NativeCompilerArtifactContext {
  /** Hash from the completed client compiler, when validating emitted output. */
  readonly compilationHash?: string;
  /** Hydration identity retained with a development snapshot. */
  readonly hydrationBuildId?: string;
  readonly development?: boolean;
}

export interface ValidatedNativeCompilerArtifact {
  readonly nativeManifest: unknown;
  /** Optional compiler-owned hydration and document cache identity. */
  readonly hydrationBuildId?: string;
}

/** The selected compiler owns its artifact ABI; lifecycle consumers keep it opaque. */
export interface NativeCompilerArtifacts {
  readonly routerFrameworks: readonly RouterFramework[];
  clientManifestFile(entryName: string): string;
  validateClientManifest(
    value: unknown,
    identity: RendererIdentity,
    context: NativeCompilerArtifactContext,
  ): Promise<ValidatedNativeCompilerArtifact>;
  isMutableDevelopmentAsset(
    filename: string,
    entryNames: readonly string[],
  ): boolean;
}
