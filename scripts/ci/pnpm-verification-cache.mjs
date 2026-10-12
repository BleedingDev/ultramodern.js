import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTestToolchain } from './check-test-toolchain.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const inputs = [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.mise.toml',
];
const operatingSystems = { linux: 'Linux', win32: 'Windows', darwin: 'macOS' };

export function verificationCacheIdentity({
  cacheDirectory,
  pnpmVersion,
  nodeVersion = process.versions.node,
  platform = process.platform,
  architecture = process.arch,
  read = name => readFileSync(path.join(root, name)),
} = {}) {
  assert.ok(
    operatingSystems[platform],
    'Unsupported verification cache platform',
  );
  assert.match(architecture, /^[a-z0-9]+$/u, 'Invalid runner architecture');
  assert.equal(typeof cacheDirectory, 'string', 'Missing pnpm cache directory');
  assert.ok(
    cacheDirectory.length > 0 && !/[\r\n\0]/u.test(cacheDirectory),
    'Invalid pnpm cache directory',
  );
  const paths = platform === 'win32' ? path.win32 : path.posix;
  assert.ok(
    paths.isAbsolute(cacheDirectory),
    'pnpm cache directory must be absolute',
  );
  const versions = verifyTestToolchain({
    nodeVersion,
    pnpmVersion,
    miseConfig: read('.mise.toml').toString(),
    packageManager: JSON.parse(read('package.json').toString()).packageManager,
  });
  const digest = createHash('sha256');
  for (const name of inputs) {
    const content = read(name);
    digest.update(JSON.stringify([name, Buffer.byteLength(content)]));
    digest.update(content);
  }
  return {
    key: `pnpm-verification-v1-${operatingSystems[platform]}-${architecture}-node${versions.node}-pnpm${versions.pnpm}-${digest.digest('hex')}`,
    path: paths.join(cacheDirectory, 'lockfile-verified.jsonl'),
  };
}

export function requireTrustedVerificationSeed(env = process.env) {
  assert.equal(
    env.GITHUB_REF,
    'refs/heads/main-ultramodern',
    'Verification caches are seeded only on main-ultramodern',
  );
  assert.ok(
    ['push', 'schedule', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME),
    'Untrusted verification seed event',
  );
  assert.equal(
    env.GITHUB_WORKFLOW_REF,
    `${env.GITHUB_REPOSITORY}/.github/workflows/ci-cache.yml@refs/heads/main-ultramodern`,
    'Verification seeds require the default-branch cache workflow',
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [mode, pnpmVersion, cacheDirectory] = process.argv.slice(2);
  assert.ok(['identify', 'seed'].includes(mode), 'Expected identify or seed');
  const identity = verificationCacheIdentity({ pnpmVersion, cacheDirectory });
  if (mode === 'seed') {
    requireTrustedVerificationSeed();
    const file = lstatSync(identity.path);
    assert.ok(
      file.isFile() && !file.isSymbolicLink(),
      'Missing regular pnpm verification result after install',
    );
  }
  assert.ok(process.env.GITHUB_OUTPUT, 'Missing GitHub step output file');
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `key=${identity.key}\npath=${identity.path}\n`,
  );
}
