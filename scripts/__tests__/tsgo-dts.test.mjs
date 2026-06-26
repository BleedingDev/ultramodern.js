import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../tsgo-dts.mjs';

test('tsgo-dts main-module guard matches Windows script paths', () => {
  assert.equal(
    isMainModule({
      argv: ['node', 'C:\\a\\modernjs\\scripts\\tsgo-dts.mjs'],
      moduleUrl: 'file:///C:/a/modernjs/scripts/tsgo-dts.mjs',
      resolvePath: win32.resolve,
      urlToPath: url => fileURLToPath(url, { windows: true }),
    }),
    true,
  );
});

test('tsgo-dts main-module guard ignores imported modules', () => {
  assert.equal(
    isMainModule({
      argv: ['node', '/repo/scripts/other.mjs'],
      moduleUrl: 'file:///repo/scripts/tsgo-dts.mjs',
    }),
    false,
  );
});
