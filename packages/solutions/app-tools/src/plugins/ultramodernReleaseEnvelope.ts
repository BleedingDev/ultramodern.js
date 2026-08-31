import { createUltramodernReleaseEnvelopePlugin } from '@modern-js/app-tools-extensions/release-envelope/plugin';
import type { AppTools, CliPlugin } from '../types';
import { resolveDeployTarget } from './deploy';

export default (): CliPlugin<AppTools> =>
  createUltramodernReleaseEnvelopePlugin({
    resolveDeployTarget,
  });
