#!/usr/bin/env node
// Consumer: publish-bleedingdev.yml ERP acceptance browser smoke.
//
// The smoke runtime is installed outside the workspace from the exact
// `browserSmokePlaywrightPackage` specifier, so this entry only supplies that
// runtime's directory and version. scripts/lib/browser-provisioning.js owns
// the cache key, the cache path and the install, exactly as for workspace
// runtimes.
//
//   --resolve                  pure for an exact specifier: installs nothing
//   --install --version <v>    materializes the runtime, then installs browsers
import { parseArgs } from 'node:util';
import provisioning from '../lib/browser-provisioning.js';
import { ensureBrowserSmokeRuntime } from './published-create-proof/browser-smoke.mjs';
import { browserSmokePlaywrightPackage } from './published-create-proof/constants.mjs';

const exactPlaywrightSpec = /^playwright@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u;

function resolveSmokeVersion() {
  const exact = exactPlaywrightSpec.exec(browserSmokePlaywrightPackage);
  return exact
    ? exact[1]
    : provisioning.resolvePlaywrightVersion(ensureBrowserSmokeRuntime());
}

try {
  const { values } = parseArgs({
    options: {
      install: { type: 'boolean' },
      resolve: { type: 'boolean' },
      version: { type: 'string' },
    },
    strict: true,
  });
  if (Boolean(values.install) === Boolean(values.resolve)) {
    throw new Error('Pass exactly one of --resolve or --install');
  }
  if (values.resolve) {
    if (values.version !== undefined) {
      throw new Error('--version applies only to --install');
    }
    provisioning.writeGithubOutputs(
      provisioning.resolveBrowserOutputs(resolveSmokeVersion()),
    );
  } else {
    if (values.version === undefined) {
      throw new Error(
        '--install requires --version <playwright version> from the matching --resolve step',
      );
    }
    provisioning.installBrowsers({
      runtimeDirs: [ensureBrowserSmokeRuntime()],
      version: values.version,
    });
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
}
