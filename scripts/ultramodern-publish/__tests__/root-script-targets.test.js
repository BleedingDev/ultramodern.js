const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../../..');
const rootPackage = require(path.join(repoRoot, 'package.json'));

test('root node script entrypoints exist', () => {
  const missingTargets = [];
  const directNodeTarget =
    /(?:^|(?:&&|;|\|\|)\s*)node\s+((?:\.\/)?scripts\/[^\s;&|]+)/gu;

  for (const [scriptName, command] of Object.entries(rootPackage.scripts)) {
    for (const match of command.matchAll(directNodeTarget)) {
      const target = path.resolve(repoRoot, match[1]);
      if (!fs.existsSync(target)) {
        missingTargets.push(`${scriptName}: ${match[1]}`);
      }
    }
  }

  assert.deepEqual(missingTargets, []);
});
