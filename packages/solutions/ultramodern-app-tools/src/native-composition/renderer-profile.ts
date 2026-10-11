import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { RouterFramework } from '@modern-js/backend-federation-contracts';
import type { Renderer } from '@modern-js/renderer-core';
import type { RendererBuildProfile } from '@modern-js/renderer-core/adapter';
import {
  type FrameworkModule,
  projectInstalledRendererProfile,
  type RendererProfileMetadata,
} from './renderer-installed-profile';
import {
  type RegisteredRenderer,
  resolveRendererAdapter,
} from './renderer-registration';

export {
  type RegisteredRenderer,
  registeredRenderers,
} from './renderer-registration';
export type { RendererBuildProfile };

/** The selected adapter's source profile, before installed versions are projected. */
export function resolveCandidateRendererProfile(
  renderer: Renderer,
): RendererBuildProfile<RegisteredRenderer> {
  const adapter = resolveRendererAdapter(renderer);
  return { ...structuredClone(adapter.profile), renderer: adapter.name };
}

/** Resolve only the selected SDK owners through their public module specifiers. */
export function resolveRendererProfileMetadata(
  renderer: Renderer,
): RendererProfileMetadata<RegisteredRenderer> {
  const adapter = resolveRendererAdapter(renderer);
  const candidate = resolveCandidateRendererProfile(adapter.name);
  const require = createRequire(import.meta.url);
  const modules: FrameworkModule[] = [
    {
      specifier: '@modern-js/ultramodern-app-tools',
      filename: fileURLToPath(import.meta.url),
    },
    {
      specifier: '@modern-js/renderer-core',
      filename: require.resolve('@modern-js/renderer-core/server'),
    },
    {
      specifier: '@modern-js/builder',
      filename: require.resolve('@modern-js/builder'),
    },
    ...(adapter.kind === 'native'
      ? [
          {
            specifier: adapter.runtime.bootstrap,
            request: adapter.runtime.manifest,
          },
        ]
      : adapter.frameworkModules
    ).map(module => ({
      specifier: module.specifier,
      filename: require.resolve(module.request),
    })),
  ];
  return projectInstalledRendererProfile(candidate, modules);
}

export function resolveRendererProfile(
  renderer: Renderer,
): RendererBuildProfile<RegisteredRenderer> {
  return resolveRendererProfileMetadata(renderer).profile;
}

/** Router admission follows the selected owner, including mixed React entries. */
export function resolveRendererRouterFrameworks(
  renderer: Renderer,
): readonly RouterFramework[] {
  return Object.freeze([
    ...resolveRendererAdapter(renderer).routerFrameworks,
  ] as RouterFramework[]);
}
