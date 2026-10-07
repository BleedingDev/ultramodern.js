import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import type { PolicyDefaultsOptions } from '@modern-js/app-tools-extensions/policy-defaults';
import type { RendererRegistration } from '../../native-composition/renderer-registration';
import { reactCandidateProfile } from './profile';

function compose(
  consumerPlugins: readonly CliPlugin<AppTools>[],
): CliPlugin<AppTools> {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifestFile = path.join(directory, 'package.json');
    if (existsSync(manifestFile)) {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      if (
        typeof manifest.name !== 'string' ||
        !manifest.exports?.['./react-composition']
      )
        throw new Error(
          'The owning UltraModern package must export its selected React composition',
        );
      const { composeReactRenderer } = createRequire(import.meta.url)(
        `${manifest.name}/react-composition`,
      ) as typeof import('../../native-composition/react-composition');
      return composeReactRenderer({ consumerPlugins });
    }
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error(
        'Cannot find the owning UltraModern package for React composition',
      );
    directory = parent;
  }
}

export const reactRendererRegistration = {
  renderer: 'react',
  kind: 'composed',
  candidateProfile: reactCandidateProfile,
  routerFrameworks: ['react-router', 'tanstack'],
  frameworkModules: [
    { specifier: '@modern-js/runtime', request: '@modern-js/runtime/cli' },
    {
      specifier: '@modern-js/runtime-renderer-extensions',
      request: '@modern-js/runtime-renderer-extensions',
    },
    {
      specifier: '@modern-js/i18n-integration',
      request: '@modern-js/i18n-integration',
    },
  ],
  supports: {
    reactCliPlugins: true,
    reactRuntimeDescriptors: true,
    reactCompiler: true,
    cssDeclarations: true,
  },
  compose,
} as const satisfies RendererRegistration;
