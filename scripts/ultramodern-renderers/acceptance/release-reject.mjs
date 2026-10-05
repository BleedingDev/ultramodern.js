import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atomicJson,
  readEvidence,
  sourceEvidence,
} from './release-support.mjs';
import { publicPackageSpecifier } from './run.mjs';

// A fresh process per operation prevents configuration/global state from one
// rejection affecting another. No installed plugin or configuration is edited.
export async function runNegativeProbe(input) {
  let assertionCount = 0;
  const check = new Proxy(assert, {
    apply(target, receiver, args) {
      const value = Reflect.apply(target, receiver, args);
      assertionCount += 1;
      return value;
    },
    get(target, property) {
      const value = Reflect.get(target, property);
      return typeof value === 'function'
        ? (...args) => {
            const result = Reflect.apply(value, target, args);
            assertionCount += 1;
            return result;
          }
        : value;
    },
  });
  const { applicationRoot, renderer, kind, capability, binding } = input;
  check(['solid', 'octane'].includes(renderer));
  check(['generated', 'hand-authored'].includes(kind));
  check(['worker', 'module-federation', 'rsc'].includes(capability));
  const require = createRequire(path.join(applicationRoot, 'package.json'));
  const specifier = publicPackageSpecifier(
    '@modern-js/ultramodern-app-tools',
    kind,
  );
  const entry = require.resolve(specifier);
  const owner = require(specifier);
  check.equal(typeof owner.defineConfig, 'function');
  check.equal(typeof owner.resolveUltramodernEntryIdentities, 'function');
  let setupCalls = 0;
  const observer = {
    name: `@ultramodern-proof/c2-${renderer}-${capability}-setup-observer`,
    setup() {
      setupCalls += 1;
    },
  };
  const triggers = {
    worker: { deploy: { worker: { ssr: true } } },
    'module-federation': { server: { ssr: { moduleFederationAppSSR: true } } },
    rsc: { server: { rsc: true } },
  };
  const config = owner.defineConfig({
    renderer,
    source: { entriesDir: './src' },
    plugins: [observer],
    ...triggers[capability],
  });
  let failure;
  try {
    await owner.resolveUltramodernEntryIdentities({
      appDirectory: applicationRoot,
      config,
      command: 'build',
      configFile: input.configFile,
    });
  } catch (error) {
    failure = error;
  }
  check(
    failure instanceof Error,
    'Selected installed public API must reject the unsupported operation',
  );
  check.match(failure.message, /^unsupported-renderer-capability: renderer /u);
  check(failure.message.includes(`renderer ${renderer} `));
  const requested = {
    worker: 'worker',
    'module-federation': 'Module Federation application SSR',
    rsc: 'React Server Components',
  }[capability];
  check(failure.message.includes(requested));
  check.equal(
    setupCalls,
    0,
    'The real guard must reject before the registered post-guard setup observer',
  );
  // The registered guard orders every selected renderer plugin and every
  // consumer plugin after itself. We leave that actual graph untouched.
  const flatten = plugins =>
    plugins.flatMap(plugin => [plugin, ...flatten(plugin.usePlugins ?? [])]);
  const graph = flatten(config.plugins);
  const guards = graph.filter(
    plugin => plugin.name === '@modern-js/renderer-selection',
  );
  check.equal(guards.length, 1);
  const guarded = graph.filter(
    plugin =>
      plugin !== guards[0] &&
      plugin.name !== '@modern-js/ultramodern-app-tools',
  );
  check(guarded.length > 1);
  check(
    guarded.every(plugin => guards[0].post.includes(plugin.name)),
    'All real selected plugins must follow the rejecting guard',
  );
  return {
    schema: 'bleedingdev.ultramodern.c2-native-capability-rejection',
    schemaVersion: 1,
    status: 'passed',
    ...binding,
    renderer,
    kind,
    capability,
    applicationRoot,
    publicOperation: 'resolveUltramodernEntryIdentities',
    publicSpecifier: specifier,
    installedEntry: sourceEvidence(entry),
    diagnostic: failure.message,
    diagnosticCode: 'unsupported-renderer-capability',
    beforeRendererSetup: true,
    setupObserverCalls: setupCalls,
    guardedPluginNames: guarded.map(plugin => plugin.name),
    assertionCount,
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    assert.equal(
      process.argv.length,
      4,
      'Expected input JSON path and output JSON path',
    );
    const input = readEvidence(process.argv[2]).value;
    const evidence = await runNegativeProbe(input);
    atomicJson(process.argv[3], evidence);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
