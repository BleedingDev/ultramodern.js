/**
 * Shell-free TS-Go package-bin resolution for fork-owned build verifiers.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');

const TSGO_PACKAGE_JSON = '@typescript/native-preview/package.json';

function resolveTsgoBin({ requireFrom }) {
  if (!requireFrom || typeof requireFrom.resolve !== 'function') {
    throw new Error('TS-Go resolution requires an explicit require origin');
  }

  const packageJsonPath = requireFrom.resolve(TSGO_PACKAGE_JSON);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const binEntry =
    typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.tsgo;

  return path.resolve(
    path.dirname(packageJsonPath),
    binEntry ?? 'bin/tsgo.js',
  );
}

function createTsgoInvocation({
  args = [],
  platform = process.platform,
  requireFrom,
} = {}) {
  if (!Array.isArray(args)) {
    throw new Error('TS-Go args must be an array');
  }

  const command = process.execPath;
  if (platform === 'win32' && /\.(?:bat|cmd)$/iu.test(command)) {
    throw new Error('TS-Go must run through Node, not a Windows command shim');
  }

  return {
    command,
    argv: [resolveTsgoBin({ requireFrom }), ...args],
    shell: false,
  };
}

module.exports = {
  createTsgoInvocation,
  resolveTsgoBin,
};
