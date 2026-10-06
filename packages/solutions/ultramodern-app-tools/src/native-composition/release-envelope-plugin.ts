import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import {
  createUltramodernReleaseEnvelopePlugin,
  type ReleaseEnvelopeConfig,
} from '@modern-js/app-tools-extensions/release-envelope/plugin';
import { type Renderer, resolveRenderer } from '@modern-js/renderer-core';
import { resolveRendererProfile } from './renderer-profile';

// `deploy.node` and `renderer` come from the UltraModern config types, not
// AppTools'.
export const ultramodernReleaseEnvelopePlugin = (
  selectedRenderer?: Renderer,
): CliPlugin<AppTools> =>
  createUltramodernReleaseEnvelopePlugin<
    ReleaseEnvelopeConfig & { renderer?: unknown }
  >({
    resolveRendererProfile: config => {
      const { renderer, protocolVersion, compiler, hydration, router } =
        resolveRendererProfile(
          resolveRenderer(selectedRenderer ?? config.renderer),
        );
      return { renderer, protocolVersion, compiler, hydration, router };
    },
  }) as unknown as CliPlugin<AppTools>;
