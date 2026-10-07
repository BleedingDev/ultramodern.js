import { createRequire } from 'node:module';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import type { PolicyDefaultsOptions } from '@modern-js/app-tools-extensions/policy-defaults';
import type { Renderer } from '@modern-js/renderer-core';
import type {
  ComposedRendererAdapter,
  NativeRendererAdapter,
} from '@modern-js/renderer-core/adapter';
import { reactRendererAdapter } from '../renderers/react/adapter';

export type ComposedUltramodernRendererAdapter = ComposedRendererAdapter<
  Renderer,
  CliPlugin<AppTools>,
  PolicyDefaultsOptions
>;

export type UltramodernRendererAdapter =
  | NativeRendererAdapter
  | ComposedUltramodernRendererAdapter;

export type RegisteredRenderer = 'react' | 'solid' | 'octane';

const requireAdapter = createRequire(import.meta.url);

/**
 * Renderer adapters by name. Native adapters live in their renderer package's
 * build-only `./plugin` entry and load only when selected. Loading is
 * synchronous (`require` of ESM) because configuration, metadata and
 * scaffolding read renderer profiles synchronously.
 */
const rendererAdapters: Readonly<
  Record<RegisteredRenderer, () => UltramodernRendererAdapter>
> = {
  react: () => reactRendererAdapter,
  solid: () =>
    requireAdapter('@modern-js/renderer-solid/plugin').rendererAdapter,
  octane: () =>
    requireAdapter('@modern-js/renderer-octane/plugin').rendererAdapter,
};

export const registeredRenderers = Object.freeze(
  Object.keys(rendererAdapters) as RegisteredRenderer[],
);

const loadedAdapters = new Map<
  RegisteredRenderer,
  UltramodernRendererAdapter
>();

/** Application admission is finite even though transport identities are generic. */
export function resolveRendererAdapter(
  value: unknown = 'react',
): UltramodernRendererAdapter & { readonly name: RegisteredRenderer } {
  const renderer = registeredRenderers.find(name => name === value);
  if (!renderer)
    throw new Error(`Unsupported UltraModern renderer: ${String(value)}`);
  let adapter = loadedAdapters.get(renderer);
  if (!adapter) {
    adapter = rendererAdapters[renderer]();
    if (adapter?.name !== renderer || adapter.profile?.renderer !== renderer)
      throw new Error(
        `The ${renderer} renderer package exports no matching renderer adapter`,
      );
    loadedAdapters.set(renderer, adapter);
  }
  return adapter as UltramodernRendererAdapter & {
    readonly name: RegisteredRenderer;
  };
}

export function resolveNativeRendererAdapter(
  renderer: Renderer,
): NativeRendererAdapter {
  const adapter = resolveRendererAdapter(renderer);
  if (adapter.kind !== 'native')
    throw new Error(
      `Unsupported UltraModern native renderer: ${String(renderer)}`,
    );
  return adapter;
}

/** Every adapter whose renderer package is installed, without failing on the rest. */
export function resolveInstalledRendererAdapters(): UltramodernRendererAdapter[] {
  return registeredRenderers.flatMap(renderer => {
    try {
      return [resolveRendererAdapter(renderer)];
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'MODULE_NOT_FOUND')
        return [];
      throw error;
    }
  });
}

/** The infrastructure plugin that owns a native renderer's entries. */
export function nativeInfrastructurePluginName(renderer: Renderer): string {
  return `@modern-js/renderer-${renderer}-infrastructure`;
}
