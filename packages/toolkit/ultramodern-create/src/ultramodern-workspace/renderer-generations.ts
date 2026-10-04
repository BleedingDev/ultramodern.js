import type { RegisteredRenderer } from '@modern-js/ultramodern-app-tools';
import type { RendererGenerationAdapter } from './renderer-generation-profile';
import { rendererGenerations } from './renderer-generation-registry';

export function resolveRendererGenerationAdapter(
  renderer: RegisteredRenderer,
): RendererGenerationAdapter {
  if (!Object.hasOwn(rendererGenerations, renderer)) {
    throw new Error(`Renderer ${renderer} has no registered generation owner.`);
  }
  const generation = rendererGenerations[renderer];
  if (generation.renderer !== renderer) {
    throw new Error(
      `Renderer ${renderer} generation owner has a different identity.`,
    );
  }
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
