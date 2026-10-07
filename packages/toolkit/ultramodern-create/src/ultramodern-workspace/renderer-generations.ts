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
import {
  MODULE_FEDERATION_NODE_VERSION,
  MODULE_FEDERATION_VERSION,
  TYPESCRIPT_VERSION,
  ULTRAMODERN_PACKAGE_PINS,
} from './versions';

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
      const federation =
        create.templates?.federation === true &&
        selected.capabilities.moduleFederation === true;
      return createRendererGenerationProfile(
        renderer,
        selected,
        {
          ...packages,
          frameworkDependencies: [
            ...packages.frameworkDependencies,
            ...(federation ? ['@modern-js/federation-runtime'] : []),
          ],
          dependencies: {
            ...packages.dependencies,
            ...(federation
              ? {
                  '@module-federation/enhanced': MODULE_FEDERATION_VERSION,
                  '@module-federation/node': MODULE_FEDERATION_NODE_VERSION,
                  '@module-federation/runtime':
                    ULTRAMODERN_PACKAGE_PINS.appDependencies[
                      '@module-federation/runtime'
                    ],
                }
              : {}),
          },
          ...(tsconfig ? { tsconfig: tsconfig as JsonObject } : {}),
        },
        create.templates,
      );
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
