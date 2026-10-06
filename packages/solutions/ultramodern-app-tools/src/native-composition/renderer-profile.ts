import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { RouterFramework } from '@modern-js/backend-federation-contracts';
import type { Renderer } from '@modern-js/renderer-core';
import {
  type FrameworkModule,
  projectInstalledRendererProfile,
  type RendererProfileMetadata,
} from './renderer-installed-profile';
import { resolveRendererRegistration } from './renderer-registration';
import type { RegisteredRenderer } from './renderer-selection-metadata';

export {
  type RegisteredRenderer,
  registeredRenderers,
} from './renderer-selection-metadata';

export interface RendererBuildProfile<TRenderer extends Renderer = Renderer> {
  renderer: TRenderer;
  status: 'stable' | 'preview';
  protocolVersion: 1;
  minimumNode: '26.7.0';
  hmr: {
    editedBoundary: 'may-reset';
    unaffectedComponents: 'preserved';
    document: 'preserved';
    roots: 'single';
    cleanup: 'exactly-once';
  };
  compiler: { name: string; version: string };
  hydration: { name: string; version: string };
  router: {
    name: string;
    version: string;
    coreName: string;
    coreVersion: string;
  };
  sourceExtensions: readonly string[];
  jsxImportSource: string;
  dependencies: Readonly<Record<string, string>>;
  capabilities: {
    worker: boolean;
    /**
     * `true`: Module Federation application SSR through the React MF plugin.
     * `'client'`: same-renderer federated components rendered on the client
     * from a native module-federation.config; never application SSR.
     */
    moduleFederation: boolean | 'client';
    rsc: boolean;
    ssg: boolean;
    i18n: boolean;
    svgComponent: boolean;
  };
}

/** Generation metadata does not resolve or evaluate optional framework peers. */
export function resolveCandidateRendererProfile(
  renderer: Renderer,
): RendererBuildProfile<RegisteredRenderer> {
  const registration = resolveRendererRegistration(renderer);
  const candidate = structuredClone(registration.candidateProfile);
  if (candidate.renderer !== registration.renderer)
    throw new Error(
      `Renderer profile ${candidate.renderer} conflicts with selected owner ${registration.renderer}`,
    );
  return { ...candidate, renderer: registration.renderer };
}

/** Resolve only the selected SDK owners through their public module specifiers. */
export function resolveRendererProfileMetadata(
  renderer: Renderer,
): RendererProfileMetadata<RegisteredRenderer> {
  const registration = resolveRendererRegistration(renderer);
  const candidate = resolveCandidateRendererProfile(registration.renderer);
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
    ...registration.frameworkModules.map(module => ({
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
    ...resolveRendererRegistration(renderer).routerFrameworks,
  ]);
}
