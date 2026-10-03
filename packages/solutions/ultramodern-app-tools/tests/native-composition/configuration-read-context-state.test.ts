import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from '@rstest/core';

it('shares the physical state across CJS and ESM and isolates other package copies', () => {
  const stateFile = createRequire(import.meta.url).resolve(
    '../../src/native-composition/configuration-read-context-state.cjs',
  );
  const root = fs.mkdtempSync(
    path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-context-state-'),
  );
  const aliasFile = path.join(root, 'state-alias.cjs');
  const otherCopy = path.join(root, 'other-package-state.cjs');
  fs.symlinkSync(stateFile, aliasFile);
  fs.copyFileSync(stateFile, otherCopy);
  try {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require = createRequire(import.meta.url);
const state = require(${JSON.stringify(stateFile)});
const esm = await import(pathToFileURL(${JSON.stringify(aliasFile)}).href);
const separate = require(${JSON.stringify(otherCopy)});
assert.equal(esm.default, state);
assert.ok(Object.isFrozen(state));
for (const name of ['inputs', 'snapshots', 'nodes']) {
  assert.ok(state[name] instanceof WeakMap);
  assert.equal(esm.default[name], state[name]);
  assert.notEqual(separate[name], state[name]);
}
const hooks = {};
const inputs = Object.freeze({kind:'observed-config-source-inputs',version:1,observations:Object.freeze([]),packageMetadata:Object.freeze([])});
const snapshot = Object.freeze({original:true});
const nodes = Object.freeze([]);
state.inputs.set(hooks, inputs);
state.snapshots.set(inputs, snapshot);
state.nodes.set(inputs, nodes);
assert.equal(esm.default.inputs.get(hooks), inputs);
assert.equal(esm.default.snapshots.get(inputs), snapshot);
assert.equal(esm.default.nodes.get(inputs), nodes);
assert.equal(separate.inputs.get(hooks), undefined);
assert.equal(separate.snapshots.get(inputs), undefined);
assert.equal(separate.nodes.get(inputs), undefined);
`,
      ],
      { encoding: 'utf8' },
    );
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
