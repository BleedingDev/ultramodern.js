import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import { createUltramodernReleaseEnvelopePlugin } from '@modern-js/app-tools-extensions/release-envelope/plugin';

// `deploy.node` comes from the UltraModern config types, not AppTools'.
export const ultramodernReleaseEnvelopePlugin = (): CliPlugin<AppTools> =>
  createUltramodernReleaseEnvelopePlugin() as unknown as CliPlugin<AppTools>;
