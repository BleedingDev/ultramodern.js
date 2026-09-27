import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSync } from 'esbuild';

const sourcePath = path.resolve(
  __dirname,
  '../../../app-tools/src/plugins/deploy/utils/index.ts',
);

describe('deploy utils', () => {
  it('resolves import-only exports from an unrelated cwd and names the base when a specifier is missing', () => {
    const consumerDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'app-tools-deploy-consumer-'),
    );
    const bundlePath = path.join(consumerDirectory, 'resolver.cjs');
    const utilsStubPath = path.join(consumerDirectory, 'modern-utils.mjs');
    const importOnlyDirectory = path.join(
      consumerDirectory,
      'node_modules/import-only',
    );

    fs.writeFileSync(
      utilsStubPath,
      `export const fs = { existsSync: () => false, readFile: async () => '' };
export const getMeta = name => name;
export const ROUTE_SPEC_FILE = 'route.json';
export const SERVER_DIR = 'server';
`,
    );
    fs.mkdirSync(importOnlyDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(importOnlyDirectory, 'package.json'),
      JSON.stringify({
        name: 'import-only',
        exports: { '.': { import: './index.mjs' } },
      }),
    );
    fs.writeFileSync(path.join(importOnlyDirectory, 'index.mjs'), 'export {};');

    try {
      // The published dist is CommonJS, so exercise the same module format.
      buildSync({
        alias: { '@modern-js/utils': utilsStubPath },
        bundle: true,
        define: {
          __dirname: JSON.stringify(path.dirname(sourcePath)),
        },
        entryPoints: [sourcePath],
        external: ['node:*'],
        format: 'cjs',
        outfile: bundlePath,
        platform: 'node',
      });

      const result = spawnSync(
        process.execPath,
        [
          '-e',
          `(async () => {
const { resolveESMDependency } = require(${JSON.stringify(bundlePath)});
const fromPackage = await resolveESMDependency('mlly');
if (!fromPackage.endsWith('/dist/index.mjs')) throw new Error(fromPackage);
const importOnly = await resolveESMDependency('import-only', process.cwd());
if (!importOnly.endsWith('/import-only/index.mjs')) throw new Error(importOnly);
try {
  await resolveESMDependency('@modern-js/definitely-not-a-package', process.cwd());
  throw new Error('missing specifier resolved');
} catch (error) {
  console.log(error.message);
}
})();`,
        ],
        { cwd: consumerDirectory, encoding: 'utf8' },
      );

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'Cannot resolve "@modern-js/definitely-not-a-package" with conditions [node, import, module, default] from ',
      );
      expect(result.stdout).toContain(
        `${path.basename(consumerDirectory)}/package.json: `,
      );
    } finally {
      fs.rmSync(consumerDirectory, { recursive: true, force: true });
    }
  });
});
