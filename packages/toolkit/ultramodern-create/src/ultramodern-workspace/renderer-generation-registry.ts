import type { RegisteredRenderer } from '@modern-js/ultramodern-app-tools';
import type { RendererGenerationAdapter } from './renderer-generation-profile';
import { octaneGeneration } from './renderer-templates/octane/generation';
import { reactGeneration } from './renderer-templates/react/generation';
import { solidGeneration } from './renderer-templates/solid/generation';

/** Generator callbacks must cover the SDK's admitted renderer catalogue. */
export const rendererGenerations = {
  react: reactGeneration,
  solid: solidGeneration,
  octane: octaneGeneration,
} satisfies Record<RegisteredRenderer, RendererGenerationAdapter>;
