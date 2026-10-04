import { isDeepStrictEqual } from 'node:util';
import type {
  FinalizedRendererBuildOutput,
  RendererBuildOutputContext,
} from '@modern-js/app-tools-extensions/release-envelope/renderer-output-stamp';
import type { Renderer } from '@modern-js/renderer-core';
import { readRendererBuildManifest } from './native-build-manifest';
import {
  resolveRendererProfile,
  resolveRendererRouterFrameworks,
} from './renderer-profile';

/** Project only the finalized compiler-owned manifest into release metadata. */
export const createRendererBuildOutputResolver =
  (renderer: Renderer) =>
  async (
    context: RendererBuildOutputContext,
  ): Promise<FinalizedRendererBuildOutput> => {
    const manifest = await readRendererBuildManifest(
      context.distDirectory,
      resolveRendererProfile(renderer),
      { routerFrameworks: resolveRendererRouterFrameworks(renderer) },
    );
    const actualEntries = context.entrypoints.map(entry => entry.entryName);
    if (
      !actualEntries.length ||
      new Set(actualEntries).size !== actualEntries.length ||
      !isDeepStrictEqual(
        [...actualEntries].sort(),
        Object.keys(manifest.identities).sort(),
      )
    ) {
      throw new Error(
        'Finalized renderer manifest entries must exactly match the actual application entries.',
      );
    }
    const primary =
      context.entrypoints.find(entry => entry.isMainEntry) ??
      context.entrypoints[0];
    if (
      !primary ||
      context.entrypoints.filter(entry => entry.isMainEntry).length > 1
    )
      throw new Error(
        'Finalized renderer output requires one actual primary application entry.',
      );
    const identity = manifest.identities[primary.entryName];
    if (!identity)
      throw new Error(
        'Finalized renderer output has no primary application identity.',
      );
    const {
      renderer: selected,
      protocolVersion,
      compiler,
      hydration,
      router,
    } = manifest.profile;
    return Object.freeze({
      buildMarker: manifest.buildMarker,
      sourceRevision: manifest.sourceRevision,
      ui: Object.freeze({
        rendererIdentity: identity,
        rendererProfile: Object.freeze({
          renderer: selected,
          protocolVersion,
          compiler,
          hydration,
          router,
        }),
        routerBindings: manifest.routerBindings,
      }),
    });
  };
