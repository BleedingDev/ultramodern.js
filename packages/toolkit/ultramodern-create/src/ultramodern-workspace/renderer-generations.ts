import {
  type RegisteredRenderer,
  registeredRenderers,
  resolveRendererAdapter,
} from '@modern-js/ultramodern-app-tools';
import {
  createRendererGenerationProfile,
  type RendererGenerationAdapter,
} from './renderer-generation-profile';
import { reactGeneration } from './renderer-templates/react/generation';
import type { JsonObject } from './types';
import { TYPESCRIPT_VERSION } from './versions';

/** Composed renderers generate from this package's own templates. */
const composedGenerations: Readonly<
  Partial<Record<RegisteredRenderer, RendererGenerationAdapter>>
> = { react: reactGeneration };

const nativeGenerations = new Map<
  RegisteredRenderer,
  RendererGenerationAdapter
>();

/** Native renderers generate from their adapter's create support. */
export function resolveRendererGenerationAdapter(
  renderer: RegisteredRenderer,
): RendererGenerationAdapter {
  const cached = nativeGenerations.get(renderer);
  if (cached) return cached;
  const adapter = resolveRendererAdapter(renderer);
  if (adapter.kind === 'composed') {
    const generation = composedGenerations[renderer];
    if (!generation)
      throw new Error(
        `Renderer ${renderer} has no registered generation owner.`,
      );
    return generation;
  }
  const create = adapter.create;
  if (!create)
    throw new Error(`Renderer ${renderer} has no registered generation owner.`);
  const generation: RendererGenerationAdapter = {
    renderer,
    kind: 'native',
    createProfile: selected => {
      const { tsconfig, ...packages } = create.dependencies(selected, {
        typescriptVersion: TYPESCRIPT_VERSION,
      });
      return createRendererGenerationProfile(renderer, selected, {
        ...packages,
        frameworkDependencies: [...packages.frameworkDependencies],
        ...(tsconfig ? { tsconfig: tsconfig as JsonObject } : {}),
      });
    },
    generateAppSources: create.generateAppSources,
  };
  nativeGenerations.set(renderer, generation);
  return generation;
}

export function hasNativeAppGeneration(
  renderer: RegisteredRenderer | 'none' | undefined,
): boolean {
  return (
    renderer !== undefined &&
    renderer !== 'none' &&
    resolveRendererGenerationAdapter(renderer).kind === 'native'
  );
}

/** Whether `name` is the framework package that owns a native renderer. */
export function isNativeRendererPackage(name: string): boolean {
  return registeredRenderers.some(renderer => {
    const adapter = resolveRendererAdapter(renderer);
    return adapter.kind === 'native' && adapter.runtime.bootstrap === name;
  });
}
