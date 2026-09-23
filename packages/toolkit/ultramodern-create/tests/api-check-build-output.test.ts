import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linkBuiltCodeTools } from './helpers/built-code-tools';

const checker = path.resolve(
  __dirname,
  '../../code-tools/bin/modern-api-check.mjs',
);
const invalidApi =
  'export const handler = () => new Response("invalid");\nexport const responseSchema = Schema.Unknown;\n';
const write = (root: string, relativePath: string, source: string) => {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
};
const check = (root: string) =>
  spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: root },
  });

test('API checker excludes only registered app Cloudflare output, not authored lookalikes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-api-build-output-'));
  try {
    linkBuiltCodeTools(path.join(root, 'node_modules'));
    write(
      root,
      'topology/reference-topology.json',
      JSON.stringify({
        schemaVersion: 1,
        shell: {
          id: 'shell-super-app',
          path: 'apps/shell-super-app',
          kind: 'shell',
        },
        verticals: [
          {
            id: 'catalog',
            path: 'verticals/catalog',
            kind: 'vertical',
            surfaceProfile: 'ui-only',
          },
        ],
      }),
    );
    write(
      root,
      'apps/shell-super-app/package.json',
      JSON.stringify({
        name: '@fixture/shell',
        exports: { './api/clients': './src/api/vertical-clients.ts' },
      }),
    );
    write(
      root,
      'verticals/catalog/package.json',
      JSON.stringify({ name: '@fixture/catalog' }),
    );
    for (const app of ['apps/shell-super-app', 'verticals/catalog']) {
      write(root, `${app}/dist-cloudflare/api/index.js`, invalidApi);
    }
    const positive = check(root);
    assert.equal(positive.status, 0, positive.stdout + positive.stderr);
    assert.match(positive.stdout, /API boundary check passed/u);

    for (const authored of [
      'verticals/catalog/api/authored.ts',
      'verticals/catalog/src/dist-cloudflare/api/authored.ts',
      'apps/shell-super-app/src/dist-cloudflare/api/authored.ts',
      'verticals/catalog/dist-cloudflare-lookalike/api/authored.ts',
      'packages/shared/dist-cloudflare/api/authored.ts',
      'apps/unregistered/dist-cloudflare/api/authored.ts',
    ]) {
      write(root, authored, invalidApi);
      const negative = check(root);
      assert.equal(negative.status, 1, negative.stdout + negative.stderr);
      assert.ok(
        negative.stderr.includes(
          `${authored}: must not hand-build Response objects`,
        ),
        negative.stderr,
      );
      assert.ok(
        negative.stderr.includes(
          `${authored}: must use concrete request, response and error schemas`,
        ),
        negative.stderr,
      );
      assert.ok(
        !negative.stderr.includes('dist-cloudflare/api/index.js:'),
        negative.stderr,
      );
      fs.rmSync(path.join(root, authored));
    }

    // Missing topology cannot promote a path into trusted generated output.
    fs.rmSync(path.join(root, 'topology/reference-topology.json'));
    const missingTopology = check(root);
    assert.equal(missingTopology.status, 2);
    assert.match(missingTopology.stderr, /reference-topology.json/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
