import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tsgoInvocation from '../../../../../scripts/lib/tsgo-invocation.js';

const { createTsgoInvocation } = tsgoInvocation;
const require = createRequire(import.meta.url);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDirectory, '../..');
const packageJson = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf-8'),
);
const configExport = packageJson.exports?.['./config'];
const expectedExport = {
  types: './dist/types/config/public.d.ts',
  import: './dist/esm-node/config/public.mjs',
  require: './dist/cjs/config/public.js',
  default: './dist/cjs/config/public.js',
};
const expectedRuntimeExports = [
  'getBuildConfigEnvironment',
  'resolveEffectTsgoCompiler',
  'withBuildConfigEnvironment',
];
const deploymentTemplates = [
  'netlify-entry.cjs',
  'netlify-entry.mjs',
  'node-entry.cjs',
  'node-entry.mjs',
  'vercel-entry.cjs',
  'vercel-entry.mjs',
];

assert.deepEqual(configExport, expectedExport);
for (const format of ['cjs', 'esm-node']) {
  assert.deepEqual(
    readdirSync(
      join(packageRoot, 'dist', format, 'plugins/deploy/platforms/templates'),
    ).sort(),
    deploymentTemplates,
  );
}

try {
  const tsgo = createTsgoInvocation({
    args: ['-p', join(testDirectory, 'tsconfig.public-surface-consumer.json')],
    requireFrom: require,
  });
  execFileSync(tsgo.command, tsgo.argv, {
    cwd: packageRoot,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
} catch (error) {
  const output = [error?.message, error?.stdout, error?.stderr]
    .filter(Boolean)
    .map(value => value.toString())
    .join('\n');
  assert.fail(`Public config type consumer failed to compile.\n${output}`);
}

const cjsConfig = require('@modern-js/app-tools/config');
const esmConfig = await import('@modern-js/app-tools/config');
assert.deepEqual(Object.keys(cjsConfig).sort(), expectedRuntimeExports);
assert.deepEqual(Object.keys(esmConfig).sort(), expectedRuntimeExports);

const hookNames = [
  'run',
  'watchRun',
  'done',
  'afterDone',
  'failed',
  'shutdown',
  'watchClose',
];
const createCompiler = () => {
  const handlers = Object.fromEntries(hookNames.map(name => [name, []]));
  return {
    compiler: {
      hooks: Object.fromEntries(
        hookNames.map(name => [
          name,
          { tap: (_options, handler) => handlers[name].push(handler) },
        ]),
      ),
      watchMode: false,
    },
    call(name) {
      if (name === 'watchRun') {
        this.compiler.watchMode = true;
      } else if (name === 'run' || name === 'watchClose') {
        this.compiler.watchMode = false;
      }
      for (const handler of handlers[name]) {
        handler();
      }
    },
  };
};
const leaseName = 'ULTRAMODERN_CONFIG_CROSS_FORMAT_LEASE_TEST';
const originalLeaseValue = process.env[leaseName];

try {
  process.env[leaseName] = 'original';
  const cjsOwner = await cjsConfig.withBuildConfigEnvironment(
    leaseName,
    'leased',
    config => config,
  )({ plugins: [] });
  const esmOwner = await esmConfig.withBuildConfigEnvironment(
    leaseName,
    'leased',
    config => config,
  )({ plugins: [] });

  await assert.rejects(
    esmConfig.withBuildConfigEnvironment(
      leaseName,
      'conflict',
      config => config,
    )({ plugins: [] }),
    /already has an active lease for a different value/u,
  );

  const cjsCompiler = createCompiler();
  const esmCompiler = createCompiler();
  cjsOwner.plugins.at(-1).apply(cjsCompiler.compiler);
  esmOwner.plugins.at(-1).apply(esmCompiler.compiler);
  cjsCompiler.call('run');
  cjsCompiler.call('afterDone');
  assert.equal(process.env[leaseName], 'leased');
  esmCompiler.call('run');
  esmCompiler.call('afterDone');
  assert.equal(process.env[leaseName], 'original');
} finally {
  if (originalLeaseValue === undefined) {
    delete process.env[leaseName];
  } else {
    process.env[leaseName] = originalLeaseValue;
  }
}

console.log('Verified @modern-js/app-tools/config built public surface.');
