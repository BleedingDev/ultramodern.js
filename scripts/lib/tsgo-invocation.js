/**
 * Shell-free stable native TypeScript resolution for fork-owned build verifiers.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');

const TYPESCRIPT_PACKAGE_JSON = 'typescript/package.json';

function resolveTsgoBin({ requireFrom }) {
  if (!requireFrom || typeof requireFrom.resolve !== 'function') {
    throw new Error('TypeScript resolution requires an explicit require origin');
  }

  const packageJsonPath = requireFrom.resolve(TYPESCRIPT_PACKAGE_JSON);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (packageJson.version !== '7.0.2') {
    throw new Error(
      `Native TypeScript 7.0.2 is required; found ${packageJson.version}`,
    );
  }
  const binEntry =
    typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.tsc;

  if (typeof binEntry !== 'string' || !binEntry.trim()) {
    throw new Error('The stable TypeScript package does not expose its tsc CLI');
  }

  return path.resolve(
    path.dirname(packageJsonPath),
    binEntry,
  );
}

function createTsgoInvocation({
  args = [],
  platform = process.platform,
  requireFrom,
} = {}) {
  if (!Array.isArray(args)) {
    throw new Error('TypeScript args must be an array');
  }

  const command = process.execPath;
  if (platform === 'win32' && /\.(?:bat|cmd)$/iu.test(command)) {
    throw new Error('TypeScript must run through Node, not a Windows command shim');
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
