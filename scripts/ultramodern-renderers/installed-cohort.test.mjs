import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkInstalledCohort } from './installed-cohort.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const packed = {
  'package.json': '{"name":"@bleedingdev/modern-js-runtime","version":"1.0.0"}',
  'dist/index.js': 'export const runtime = 1;\n',
};
const cohort = {
  artifacts: [
    {
      sourceName: '@modern-js/runtime',
      targetName: '@bleedingdev/modern-js-runtime',
      version: '1.0.0',
      files: Object.entries(packed).map(([file, text]) => ({
        path: file,
        size: text.length,
        sha256: sha256(text),
      })),
    },
  ],
};

function app(
  t,
  { link, spec = 'npm:@bleedingdev/modern-js-runtime@1.0.0' } = {},
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'installed-cohort-')),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installed = path.join(
    root,
    'node_modules/.pnpm/@bleedingdev+modern-js-runtime@1.0.0/node_modules/@bleedingdev/modern-js-runtime',
  );
  for (const [file, text] of Object.entries(packed)) {
    fs.mkdirSync(path.dirname(path.join(installed, file)), { recursive: true });
    fs.writeFileSync(path.join(installed, file), text);
  }
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      dependencies: { '@modern-js/runtime': spec },
    }),
  );
  fs.mkdirSync(path.join(root, 'node_modules/@modern-js'));
  fs.symlinkSync(
    link ?? installed,
    path.join(root, 'node_modules/@modern-js/runtime'),
  );
  return { root, installed };
}

test('accepts packages installed from the packed tarballs', t => {
  const { root } = app(t);
  assert.equal(checkInstalledCohort({ appRoot: root, cohort }), 2);
});

test('resolves the catalog specifiers the generator writes', t => {
  const { root } = app(t, { spec: 'catalog:ultramodern' });
  const workspace = path.join(root, 'pnpm-workspace.yaml');
  fs.writeFileSync(
    workspace,
    'catalogs:\n  ultramodern:\n    "@modern-js/runtime": "npm:@bleedingdev/modern-js-runtime@1.0.0"\n',
  );
  assert.equal(checkInstalledCohort({ appRoot: root, cohort }), 2);
  fs.writeFileSync(
    workspace,
    'catalogs:\n  ultramodern:\n    "@modern-js/runtime": "1.0.0"\n',
  );
  assert.throws(
    () => checkInstalledCohort({ appRoot: root, cohort }),
    /must depend on the packed cohort/u,
  );
});

test('rejects an installed file that differs from the tarball', t => {
  const { root, installed } = app(t);
  fs.appendFileSync(path.join(installed, 'dist/index.js'), '// patched\n');
  assert.throws(
    () => checkInstalledCohort({ appRoot: root, cohort }),
    /differs from its tarball at dist\/index\.js/u,
  );
});

test('rejects a workspace link', t => {
  const workspacePackage = fileURLToPath(
    new URL('../../packages/runtime/plugin-runtime', import.meta.url),
  );
  const { root } = app(t, { link: workspacePackage });
  assert.throws(
    () => checkInstalledCohort({ appRoot: root, cohort }),
    /is a workspace link/u,
  );
});
