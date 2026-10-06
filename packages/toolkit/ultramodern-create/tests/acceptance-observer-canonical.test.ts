import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatGeneratedSourceCandidates } from '../src/ultramodern-workspace/fs-io';

// Renderer acceptance overlays copy this observer into generated apps before
// the generator formats the workspace. The acceptance then requires the
// executing observer bytes to equal this source, so it must already be a
// fixed point of the generator's formatting.
const observer = path.resolve(
  __dirname,
  '../../../../tests/ultramodern-renderers/conformance/fixtures/observe-native-compiler.ts',
);

test('the acceptance compiler observer survives generated workspace formatting', () => {
  const source = fs.readFileSync(observer, 'utf8');
  const [formatted] = formatGeneratedSourceCandidates([
    ['apps/react-app/observe-native-compiler.ts', source],
  ]);
  assert.equal(formatted, source);
});
