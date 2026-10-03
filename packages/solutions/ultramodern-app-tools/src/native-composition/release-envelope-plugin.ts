import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import { resolveDeployTarget } from '@modern-js/app-tools-extensions/deploy-output/target';
import { createUltramodernReleaseEnvelopePlugin } from '@modern-js/app-tools-extensions/release-envelope/plugin';
import { type Renderer, resolveRenderer } from '@modern-js/renderer-core';
import { resolveRendererProfile } from './renderer-profile';

export const ultramodernReleaseEnvelopePlugin = (
  selectedRenderer?: Renderer,
): CliPlugin<AppTools> =>
  createUltramodernReleaseEnvelopePlugin({
    resolveDeployTarget,
    resolveRendererProfile: config => {
      const { renderer, protocolVersion, compiler, hydration, router } =
        resolveRendererProfile(
          resolveRenderer(
            selectedRenderer ?? (config as { renderer?: unknown }).renderer,
          ),
        );
      return { renderer, protocolVersion, compiler, hydration, router };
    },
  });
