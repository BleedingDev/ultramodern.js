import {
  assertRendererIdentity,
  type RendererIdentity,
} from '@modern-js/renderer-core/identity';
import { rstest } from '@rstest/core';
import type {
  NativeCompilerArtifactContext,
  NativeCompilerArtifacts,
} from '../../src/native-composition/compiler-artifacts';

/** One replacement compiler ABI exercised by build, development and serving. */
export function createReplacementCompilerArtifacts(
  validatedManifest?: unknown,
) {
  return {
    routerFrameworks: ['replacement'],
    clientManifestFile: rstest.fn(
      (entryName: string) => `compiled-artifacts/${entryName}.replacement.json`,
    ),
    validateClientManifest: rstest.fn(
      async (
        value: unknown,
        expectedIdentity: RendererIdentity,
        context: NativeCompilerArtifactContext,
      ) => {
        if (
          !value ||
          typeof value !== 'object' ||
          !('abi' in value) ||
          value.abi !== 'replacement-compiler/v1' ||
          !('build' in value) ||
          !value.build ||
          typeof value.build !== 'object' ||
          !('identity' in value.build) ||
          !value.build.identity ||
          typeof value.build.identity !== 'object' ||
          !('hydrationBuildId' in value.build) ||
          typeof value.build.hydrationBuildId !== 'string' ||
          !value.build.hydrationBuildId.trim()
        )
          throw new Error('Replacement compiler ABI mismatch.');
        assertRendererIdentity(
          value.build.identity as RendererIdentity,
          expectedIdentity,
        );
        const expectedHydration =
          context.compilationHash ?? context.hydrationBuildId;
        if (context.development && !expectedHydration?.trim())
          throw new Error(
            'Replacement development snapshot has no hydration build.',
          );
        if (
          expectedHydration !== undefined &&
          expectedHydration !== value.build.hydrationBuildId
        )
          throw new Error(
            'Replacement hydration build differs from its compiler manifest.',
          );
        return {
          nativeManifest:
            validatedManifest === undefined ? value : validatedManifest,
          hydrationBuildId: value.build.hydrationBuildId,
        };
      },
    ),
    isMutableDevelopmentAsset: rstest.fn(
      (filename: string, entryNames: readonly string[]) =>
        filename === 'compiled-artifacts/current.json' ||
        entryNames.some(
          entryName =>
            filename === `compiled-artifacts/${entryName}.replacement.json`,
        ),
    ),
  } satisfies NativeCompilerArtifacts;
}
