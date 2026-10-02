import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyTestToolchain({
  nodeVersion = process.versions.node,
  pnpmVersion,
  miseConfig = readFileSync(
    new URL('../../.mise.toml', import.meta.url),
    'utf8',
  ),
  packageManager = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ).packageManager,
} = {}) {
  const sections = miseConfig.split(/^\s*\[([^\]]+)\]\s*$/mu);
  const section = sections.indexOf('tools');
  assert.ok(section > 0, 'Missing mise tools configuration');
  const tools = sections[section + 1];
  const pin = name => {
    const matches = [
      ...tools.matchAll(/^\s*(\w+)\s*=\s*"(\d+\.\d+\.\d+)"\s*$/gmu),
    ].filter(match => match[1] === name);
    assert.equal(matches.length, 1, `Expected one exact mise ${name} version`);
    return matches[0][2];
  };
  const node = pin('node');
  const pnpm = pin('pnpm');
  assert.equal(nodeVersion, node, `Expected the mise Node.js version ${node}`);
  assert.equal(
    packageManager,
    `pnpm@${pnpm}`,
    'mise and packageManager must agree',
  );
  assert.equal(
    pnpmVersion?.trim(),
    pnpm,
    `Expected the mise pnpm version ${pnpm}`,
  );
  return { node, pnpm };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const versions = verifyTestToolchain({ pnpmVersion: process.argv[2] });
  console.log(`Node.js ${versions.node}; pnpm ${versions.pnpm}`);
}
