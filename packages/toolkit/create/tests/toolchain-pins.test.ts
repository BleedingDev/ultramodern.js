import assert from 'node:assert/strict';
import { updateRootPackageToolchain } from '../src/ultramodern-tooling/commands/migrate-strict-effect/toolchain-pins';

test('root migration removes retired TS6 tooling without dropping consumer dependencies', () => {
  const packageJson = {
    devDependencies: {
      '@typescript/typescript6': '6.0.2',
      'consumer-owned-tool': '1.2.3',
    },
    engines: {
      consumer: 'preserved',
    },
  };

  updateRootPackageToolchain(packageJson);

  assert.deepEqual(packageJson.devDependencies, {
    '@typescript/native': 'npm:typescript@7.0.2',
    'consumer-owned-tool': '1.2.3',
    miniflare: '4.20260708.1',
  });
  assert.equal(packageJson.engines.consumer, 'preserved');
  assert.equal(typeof packageJson.engines.node, 'string');
  assert.equal(typeof packageJson.engines.pnpm, 'string');
  assert.match(packageJson.packageManager, /^pnpm@/u);
});
