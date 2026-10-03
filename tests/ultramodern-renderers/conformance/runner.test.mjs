import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  executeCommand,
  loadInstalledBuildManifest,
  publicExportCommand,
  publicPackageSpecifier,
  requiredExportProbes,
  runPackedConformance,
  validateConsumerSelection,
  writeReportAtomically,
} from '../../../scripts/ultramodern-renderers/acceptance/run.mjs';
import { nativeTypePrograms } from '../../../scripts/ultramodern-renderers/acceptance/type-programs.mjs';

const typecheckCommand = file => ({
  command: process.execPath,
  args: ['exec', 'tsc', '--project', file, '--noEmit'],
});

const unitNativeEntries = consumer => {
  if (consumer.renderer === 'react')
    return {
      browser: ['src/ssr.ts', 'src/csr.ts'],
      server: ['src/server-ssr.ts', 'src/server-csr.ts'],
    };
  const programs = nativeTypePrograms(consumer.renderer, ['ssr', 'csr']);
  return {
    browser: programs.browser.files,
    server: programs.server.files.slice(1),
  };
};

function unitConsumers(root) {
  return ['react', 'solid', 'octane'].flatMap(renderer =>
    ['generated', 'hand-authored'].map(kind => ({
      renderer,
      kind,
      consumerRoot: path.join(root, `${renderer}-${kind}`),
      typeProgramFile: 'tsconfig.strict.json',
      ...(renderer === 'react'
        ? {}
        : {
            hostTypeProgramFile: 'tsconfig.server.json',
          }),
      entryFiles: ['dist/client.js', 'dist/server.js'],
      exactPackages: { [`unit-only-${renderer}`]: '1.0.0' },
      nodeExecutable: process.execPath,
      packageManagerExecutable: process.execPath,
      profile: {
        minimumNode: process.versions.node,
        hmr: {
          editedBoundary: renderer === 'react' ? 'preserved' : 'may-reset',
          unaffectedComponents: 'preserved',
          document: 'preserved',
          roots: 'single',
          cleanup: 'exactly-once',
        },
      },
      commands: {
        typecheck:
          renderer === 'react'
            ? typecheckCommand('tsconfig.strict.json')
            : [
                typecheckCommand('tsconfig.strict.json'),
                typecheckCommand('tsconfig.server.json'),
              ],
        build: { command: process.execPath, args: ['--eval', ''] },
      },
      exportProbes: requiredExportProbes(renderer, kind),
      environments: Object.fromEntries(
        ['development', 'production'].map(environment => [
          environment,
          {
            baseUrl: 'http://127.0.0.1:1',
            probes: {},
            metadataFile: `${environment}/renderer-build.json`,
            identity: {
              renderer,
              appId: `unit-${renderer}`,
              entryName: renderer === 'react' ? 'main' : 'ssr',
              protocolVersion: 1,
              buildId: `unit-${kind}-${environment}`,
            },
            csrIdentity: {
              renderer,
              appId: `unit-${renderer}`,
              entryName: 'csr',
              protocolVersion: 1,
              buildId: `unit-${kind}-${environment}`,
            },
          },
        ]),
      ),
    })),
  );
}

async function unitInstalledConsumers(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'ultramodern-acceptance-unit-')),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const consumers = unitConsumers(root);
  const admittedProfiles = Object.fromEntries(
    consumers
      .filter(consumer => consumer.kind === 'generated')
      .map(consumer => [
        consumer.renderer,
        { renderer: consumer.renderer, ...structuredClone(consumer.profile) },
      ]),
  );
  for (const consumer of consumers) {
    await fs.mkdir(consumer.consumerRoot);
    if (consumer.renderer === 'react') {
      await fs.writeFile(
        path.join(consumer.consumerRoot, consumer.typeProgramFile),
        JSON.stringify({
          compilerOptions: {
            types: ['react'],
            strict: true,
            skipLibCheck: false,
          },
          include: ['src', 'node_modules/.modern-js'],
          exclude: [],
        }),
      );
      for (const relative of [
        ...unitNativeEntries(consumer).browser,
        ...unitNativeEntries(consumer).server,
      ]) {
        await fs.mkdir(
          path.dirname(path.join(consumer.consumerRoot, relative)),
          { recursive: true },
        );
        await fs.writeFile(
          path.join(consumer.consumerRoot, relative),
          'export {};',
        );
      }
    } else {
      const programs = nativeTypePrograms(consumer.renderer, ['ssr', 'csr']);
      for (const [role, file] of [
        ['browser', consumer.typeProgramFile],
        ['server', consumer.hostTypeProgramFile],
      ]) {
        await fs.writeFile(
          path.join(consumer.consumerRoot, file),
          JSON.stringify(programs[role]),
        );
        for (const source of unitNativeEntries(consumer)[role]) {
          const absolute = path.join(consumer.consumerRoot, source);
          await fs.mkdir(path.dirname(absolute), { recursive: true });
          await fs.writeFile(absolute, 'export {};');
        }
      }
    }
    await fs.copyFile(
      new URL('./fixtures/observe-native-compiler.ts', import.meta.url),
      path.join(consumer.consumerRoot, 'observe-native-compiler.ts'),
    );
    await fs.writeFile(
      path.join(consumer.consumerRoot, 'modern.config.ts'),
      'export default {};',
    );
    for (const host of Object.values(consumer.environments)) {
      await fs.mkdir(
        path.dirname(path.join(consumer.consumerRoot, host.metadataFile)),
        { recursive: true },
      );
      await fs.writeFile(
        path.join(consumer.consumerRoot, host.metadataFile),
        JSON.stringify({
          schema: 'ultramodern-renderer-build',
          version: 1,
          profile: admittedProfiles[consumer.renderer],
          identities: {
            [host.identity.entryName]: host.identity,
            [host.csrIdentity.entryName]: host.csrIdentity,
          },
          buildMarker: host.identity.buildId,
          sourceRevision: 'f'.repeat(40),
          inputDigest: '1'.repeat(64),
          profileDigest: '2'.repeat(64),
          compilerDigest: '3'.repeat(64),
          frameworkCohortDigest: '4'.repeat(64),
          cacheAllowed: false,
          promotable: false,
        }),
      );
    }
  }
  const commands = [];
  const dependencies = {
    loadDataResponseReader: async () => async () => ({
      kind: 'success',
      status: 200,
      value: {},
    }),
    auditReleaseArtifacts: async () => ({
      sourceRevision: 'a'.repeat(40),
      manifestSha256: 'c'.repeat(64),
      cohortDigest: 'd'.repeat(64),
      artifacts: [{ sha256: 'b'.repeat(64) }],
    }),
    auditInstalledConsumer: async () => ({ closure: [] }),
    loadRendererProfile: async ({ renderer }) => admittedProfiles[renderer],
    loadBuildManifest: async ({ metadata }) => {
      assert.equal(metadata.schema, 'ultramodern-renderer-build');
      assert.equal(metadata.version, 1);
      return metadata;
    },
    executeCommand: async (command, cwd) => {
      commands.push(command);
      const consumer = consumers.find(
        value => value.commands.build === command,
      );
      if (consumer) {
        assert.equal(cwd, consumer.consumerRoot);
        const observer = await import(
          pathToFileURL(
            path.join(consumer.consumerRoot, 'observe-native-compiler.ts'),
          )
        );
        const distPath = path.dirname(
          path.join(
            consumer.consumerRoot,
            consumer.environments.production.metadataFile,
          ),
        );
        const owner = { name: `unit-${consumer.renderer}-configured-owner` };
        Object.defineProperty(
          owner,
          Symbol.for('ultramodern.renderer-compiler-claim'),
          {
            enumerable: true,
            value: {
              renderer: consumer.renderer,
              sourceExtensions: ['.tsx'],
              transform: 'native',
              refresh: 'native',
              svg: 'url',
            },
          },
        );
        const entryMaps = unitNativeEntries(consumer);
        const environments = Object.fromEntries(
          ['client', 'server'].map(name => {
            const role = name === 'client' ? 'browser' : 'server';
            const entry = Object.fromEntries(
              [consumer.environments.production.identity.entryName, 'csr'].map(
                (entry, index) => [
                  entry,
                  [path.join(consumer.consumerRoot, entryMaps[role][index])],
                ],
              ),
            );
            return [
              name,
              {
                name,
                entry,
                distPath,
                config: {
                  mode: 'production',
                  output: { target: role === 'browser' ? 'web' : 'node' },
                  source: { entry },
                  plugins: [],
                },
              },
            ];
          }),
        );
        let handler;
        observer.observeNativeCompiler().setup({
          context: {
            rootPath: consumer.consumerRoot,
            distPath,
            version: '2.2.9',
            configFile: null,
            configFileDependencies: [],
          },
          getNormalizedConfig: () => ({ plugins: [owner] }),
          onAfterBuild: value => {
            handler = value.handler;
          },
          // This controlled fixture executes only the production observer.
          onDevCompileDone: () => {},
        });
        await handler({
          environments,
          stats: {
            hasErrors: () => false,
            stats: Object.values(environments).map(environment => ({
              hasErrors: () => false,
              compilation: {
                name: environment.name,
                hash: 'unit-only-compiler-hash',
                endTime: 1,
                errors: [],
                modules: new Set(
                  Object.values(environment.entry)
                    .flat()
                    .map(resource => ({
                      identifier: () => resource,
                      resource,
                      resourceResolveData: { path: resource, resource },
                    })),
                ),
                children: [],
                entrypoints: new Map(
                  Object.keys(environment.entry).map(name => [
                    name,
                    { getFiles: () => [`${name}.js`] },
                  ]),
                ),
                getAsset: name => ({ name }),
              },
            })),
          },
        });
      }
      return { exitCode: 0 };
    },
    probeHttp: async () => [],
  };
  return {
    root,
    consumers,
    commands,
    dependencies,
    config: { manifestPath: '/unit-only-manifest.json', consumers },
  };
}

async function unitSupplementalEvidencePaths(root, browserEvidence = []) {
  const paths = {
    browserEvidencePath: path.join(root, 'unit-browser-evidence.json'),
    capabilitiesPath: path.join(root, 'unit-platform-evidence.json'),
  };
  await Promise.all([
    writeReportAtomically(paths.browserEvidencePath, browserEvidence),
    writeReportAtomically(paths.capabilitiesPath, []),
  ]);
  return paths;
}

test('supplemental callback receives detached deeply frozen authority after every build and HTTP probe', async t => {
  const { root, commands, config, consumers, dependencies } =
    await unitInstalledConsumers(t);
  const paths = await unitSupplementalEvidencePaths(root);
  const artifactAuthority = await dependencies.auditReleaseArtifacts();
  dependencies.auditReleaseArtifacts = async () => artifactAuthority;
  const events = [];
  const execute = dependencies.executeCommand;
  dependencies.executeCommand = async (command, cwd) => {
    const result = await execute(command, cwd);
    if (consumers.some(consumer => consumer.commands.build === command))
      events.push('build');
    return result;
  };
  const observations = { assertionCount: 1, cases: [{ status: 200 }] };
  dependencies.probeHttp = async () => {
    events.push('http');
    return [{ dimension: 'ssr', observations }];
  };
  let calls = 0;
  dependencies.provideSupplementalEvidence = async snapshot => {
    calls += 1;
    assert.equal(events.filter(value => value === 'build').length, 6);
    assert.equal(events.filter(value => value === 'http').length, 12);
    assert.equal(snapshot.consumers.length, 6);
    assert.equal(snapshot.evidence.length, 12);
    assert.equal(snapshot.identity.sourceRevision, 'a'.repeat(40));
    assert.match(snapshot.identity.profileDigest, /^[a-f\d]{64}$/u);
    assert.deepEqual(snapshot.identity.artifactDigests, ['b'.repeat(64)]);
    assert.equal(
      Object.keys(snapshot.identity.applicationIdentities).length,
      24,
    );
    for (const consumer of consumers)
      for (const [environment, host] of Object.entries(consumer.environments))
        for (const [mode, identity] of [
          ['ssr', host.identity],
          ['csr', host.csrIdentity],
        ]) {
          const key = `${consumer.renderer}:${consumer.kind}:${environment}:${mode}`;
          assert.deepEqual(
            snapshot.identity.applicationIdentities[key],
            identity,
          );
          assert.notEqual(
            snapshot.identity.applicationIdentities[key],
            identity,
          );
        }
    assert.notEqual(snapshot.artifacts, artifactAuthority);
    assert.notEqual(snapshot.artifacts.artifacts, artifactAuthority.artifacts);
    assert.notEqual(snapshot.evidence[0].observations, observations);
    const pending = [snapshot];
    const visited = new Set();
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object' || visited.has(value)) continue;
      visited.add(value);
      assert.ok(Object.isFrozen(value));
      pending.push(...Object.values(value));
    }
    const firstIdentity = Object.values(
      snapshot.identity.applicationIdentities,
    )[0];
    for (const mutate of [
      () => {
        snapshot.identity.sourceRevision = 'f'.repeat(40);
      },
      () => {
        firstIdentity.buildId = 'forged';
      },
      () => {
        snapshot.artifacts.artifacts[0].sha256 = 'f'.repeat(64);
      },
      () => snapshot.consumers[0].commands.push({ phase: 'forged' }),
      () => snapshot.evidence[0].observations.cases.push({ status: 500 }),
    ])
      assert.throws(mutate, TypeError);
    events.push('callback');
    return paths;
  };
  // Controlled fixture lacks browser proof; callback input cannot certify it.
  await assert.rejects(
    runPackedConformance(config, dependencies),
    /Native browser public exports were not executed/u,
  );
  assert.equal(calls, 1);
  assert.equal(events.at(-1), 'callback');
  const installs = commands.filter(command => command.args[0] === 'install');
  assert.equal(installs.length, 6);
  for (const command of installs)
    for (const argument of [
      '--ignore-scripts=false',
      '--config.engineStrict=true',
      '--config.packageImportMethod=clone-or-copy',
    ])
      assert.ok(command.args.includes(argument), argument);
  for (const consumer of consumers)
    assert.equal(
      commands.filter(command => command === consumer.commands.build).length,
      1,
    );
  assert.equal(artifactAuthority.artifacts[0].sha256, 'b'.repeat(64));
});

test('supplemental callback accepts its two existing absolute paths and preserves evidence parsing', async t => {
  for (const malformed of ['browserEvidencePath', 'capabilitiesPath']) {
    const { root, config, dependencies } = await unitInstalledConsumers(t);
    const paths = await unitSupplementalEvidencePaths(root);
    await fs.writeFile(paths[malformed], '{');
    config.browserEvidencePath = path.join(root, 'unused-config-browser.json');
    config.capabilitiesPath = path.join(root, 'unused-config-platform.json');
    dependencies.provideSupplementalEvidence = async () => paths;
    await assert.rejects(
      runPackedConformance(config, dependencies),
      SyntaxError,
    );
  }
});

test('supplemental callback rejects extra authority and path fields or nonabsolute paths', async t => {
  for (const injection of [
    'identity',
    'receipt',
    'profileDigest',
    'evidence',
    'metadataPath',
    'relative-browser',
    'missing-platform',
  ]) {
    const { root, commands, consumers, config, dependencies } =
      await unitInstalledConsumers(t);
    const paths = await unitSupplementalEvidencePaths(root);
    const value = { ...paths };
    if (injection === 'relative-browser')
      value.browserEvidencePath = 'browser.json';
    else if (injection === 'missing-platform') delete value.capabilitiesPath;
    else
      value[injection] =
        injection === 'metadataPath' ? paths.capabilitiesPath : {};
    dependencies.provideSupplementalEvidence = async () => value;
    await assert.rejects(
      runPackedConformance(config, dependencies),
      /only the two existing absolute evidence paths/u,
    );
    for (const consumer of consumers)
      assert.equal(
        commands.filter(command => command === consumer.commands.build).length,
        1,
      );
  }
});

test('supplemental callback cannot substitute nonexistent absolute evidence paths', async t => {
  const { root, config, dependencies } = await unitInstalledConsumers(t);
  const paths = await unitSupplementalEvidencePaths(root);
  await fs.rm(paths.capabilitiesPath);
  dependencies.provideSupplementalEvidence = async () => paths;
  await assert.rejects(runPackedConformance(config, dependencies), error => {
    assert.equal(error.code, 'ENOENT');
    assert.equal(error.path, paths.capabilitiesPath);
    return true;
  });
});

test('supplemental callback failure propagates once without repeating any consumer build', async t => {
  const { commands, consumers, config, dependencies } =
    await unitInstalledConsumers(t);
  const failure = new Error('unit-only supplemental observer failed');
  let calls = 0;
  let httpCalls = 0;
  dependencies.probeHttp = async () => {
    httpCalls += 1;
    return [];
  };
  dependencies.provideSupplementalEvidence = async () => {
    calls += 1;
    assert.equal(httpCalls, 12);
    throw failure;
  };
  await assert.rejects(runPackedConformance(config, dependencies), error => {
    assert.equal(error, failure);
    return true;
  });
  assert.equal(calls, 1);
  for (const consumer of consumers)
    assert.equal(
      commands.filter(command => command === consumer.commands.build).length,
      1,
    );
});

test('supplemental callback evidence still fails exact candidate and application build validation', async t => {
  for (const stale of ['candidate', 'application']) {
    const { root, consumers, config, dependencies } =
      await unitInstalledConsumers(t);
    for (const consumer of consumers)
      for (const [environment, host] of Object.entries(consumer.environments)) {
        const buildId = createHash('sha256')
          .update(`${consumer.renderer}:${consumer.kind}:${environment}`)
          .digest('hex');
        host.identity.buildId = buildId;
        host.csrIdentity.buildId = buildId;
        const file = path.join(consumer.consumerRoot, host.metadataFile);
        const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
        metadata.buildMarker = buildId;
        metadata.identities[host.identity.entryName] = host.identity;
        metadata.identities[host.csrIdentity.entryName] = host.csrIdentity;
        await fs.writeFile(file, JSON.stringify(metadata));
      }
    dependencies.probeHttp = async ({ renderer }) =>
      renderer === 'react'
        ? []
        : [{ dimension: 'rsc', observations: { cases: [{ status: 400 }] } }];
    dependencies.provideSupplementalEvidence = async snapshot => {
      // Synthetic CSR rows exercise rejection only; they are no browser proof.
      const rows = snapshot.consumers.flatMap(consumer =>
        ['development', 'production'].map(environment => ({
          ...snapshot.identity,
          caseId: `${consumer.renderer}:${consumer.kind}:${environment}:csr`,
          producer: 'browser-test',
          observations: {
            rendererIdentity:
              snapshot.identity.applicationIdentities[
                `${consumer.renderer}:${consumer.kind}:${environment}:csr`
              ],
            consoleErrors: [],
            serverMarkerCount: 0,
            clientMarkerCount: 1,
            bootstrapCount: 1,
            publicExports: consumer.deferredBrowserExports.map(probe => ({
              specifier: probe.specifier,
              exports: [...probe.exports],
              executed: true,
              condition: 'browser',
            })),
          },
        })),
      );
      if (stale === 'candidate') rows[0].sourceRevision = 'f'.repeat(40);
      else
        rows[0].observations.rendererIdentity = {
          ...rows[0].observations.rendererIdentity,
          buildId: 'f'.repeat(64),
        };
      return unitSupplementalEvidencePaths(root, rows);
    };
    await assert.rejects(
      runPackedConformance(config, dependencies),
      stale === 'candidate' ? /exact candidate/u : /actual application build/u,
    );
  }
});

test('selection requires generated and hand-authored consumers for every renderer', () => {
  const consumers = unitConsumers('/unit-only-consumer');
  assert.equal(validateConsumerSelection(consumers).length, 6);
  assert.throws(
    () => validateConsumerSelection(consumers.slice(1)),
    /one generated and one hand-authored/,
  );
  consumers[1].kind = 'generated';
  assert.throws(() => validateConsumerSelection(consumers), /duplicate/);
});

test('atomic reports preserve pre-existing temp files and retire only a newly opened temp', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'renderer-report-owner-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const out = path.join(root, 'receipt.json');
  const temporary = `${out}.${process.pid}.tmp`;
  await fs.writeFile(out, 'prior-report');
  await fs.writeFile(temporary, 'another-owner');
  await assert.rejects(writeReportAtomically(out, { status: 'unit-only' }), {
    code: 'EEXIST',
  });
  assert.equal(await fs.readFile(temporary, 'utf8'), 'another-owner');
  assert.equal(await fs.readFile(out, 'utf8'), 'prior-report');
  await fs.rm(temporary);
  await writeReportAtomically(out, { status: 'unit-only' });
  assert.deepEqual(JSON.parse(await fs.readFile(out, 'utf8')), {
    status: 'unit-only',
  });
  await assert.rejects(fs.stat(temporary), { code: 'ENOENT' });
});

test('generated catalog aliases and authored mapped names keep their actual public resolution', () => {
  assert.equal(
    publicPackageSpecifier('@modern-js/renderer-solid', 'generated'),
    '@modern-js/renderer-solid',
  );
  assert.equal(
    publicPackageSpecifier('@modern-js/renderer-solid', 'hand-authored'),
    '@bleedingdev/modern-js-renderer-solid',
  );
  for (const renderer of ['react', 'solid', 'octane']) {
    assert.ok(
      requiredExportProbes(renderer, 'generated').every(probe =>
        probe.specifier.startsWith('@modern-js/'),
      ),
    );
    assert.ok(
      requiredExportProbes(renderer, 'hand-authored').every(probe =>
        probe.specifier.startsWith('@bleedingdev/'),
      ),
    );
  }
  const consumers = unitConsumers('/unit-only-consumer');
  consumers[0].exportProbes = requiredExportProbes('react', 'hand-authored');
  assert.throws(
    () => validateConsumerSelection(consumers),
    /public defineConfig/u,
  );
});

test('selection rejects absent type, compiler, tuple, minimum-engine and public API proofs', () => {
  for (const field of [
    'commands',
    'exactPackages',
    'entryFiles',
    'exportProbes',
    'nodeExecutable',
    'typeProgramFile',
  ]) {
    const consumers = unitConsumers('/unit-only-consumer');
    delete consumers[0][field];
    assert.throws(
      () => validateConsumerSelection(consumers),
      /requires|must execute/,
    );
  }
  const consumers = unitConsumers('/unit-only-consumer');
  consumers[0].exportProbes = [
    { specifier: 'unit-only-renderer', exports: ['mountApplication'] },
  ];
  assert.throws(
    () => validateConsumerSelection(consumers),
    /public defineConfig/,
  );
  for (const field of ['hostTypeProgramFile']) {
    const native = unitConsumers('/unit-only-consumer');
    delete native.find(consumer => consumer.renderer === 'solid')[field];
    assert.throws(() => validateConsumerSelection(native), /requires/);
  }
  const guessed = unitConsumers('/unit-only-consumer');
  guessed.find(consumer => consumer.renderer === 'solid').nativeTypeEntries = {
    browser: ['guessed'],
    server: ['guessed'],
  };
  assert.throws(
    () => validateConsumerSelection(guessed),
    /actual build observation/,
  );
});

test('selection rejects reused roots and inconsistent admitted profiles', () => {
  const shared = unitConsumers('/unit-only-consumer');
  shared[1].consumerRoot = shared[0].consumerRoot;
  assert.throws(() => validateConsumerSelection(shared), /separate roots/);
  for (const field of ['exactPackages', 'profile']) {
    const consumers = unitConsumers('/unit-only-consumer');
    if (field === 'exactPackages')
      consumers[1][field]['unit-only-react'] = '2.0.0';
    else consumers[1][field].minimumNode = '0.0.1';
    assert.throws(
      () => validateConsumerSelection(consumers),
      /same admitted profile/,
    );
  }
});

test('consumer commands run one combined build and reject obsolete split rebuild fields', () => {
  for (const field of ['buildClient', 'buildServer']) {
    const consumers = unitConsumers('/unit-only-consumer');
    consumers[0].commands[field] = consumers[0].commands.build;
    assert.throws(
      () => validateConsumerSelection(consumers),
      /exactly typecheck and one combined build/u,
    );
  }
});

test('runtime role labels cannot replace mapped public native API assertions', () => {
  for (const renderer of ['react', 'solid', 'octane']) {
    for (const role of ['client-runtime', 'server-runtime', 'router']) {
      for (const field of ['specifier', 'exports']) {
        const consumers = unitConsumers('/unit-only-consumer');
        const probe = consumers
          .find(value => value.renderer === renderer)
          .exportProbes.find(value => value.role === role);
        probe[field] = field === 'exports' ? [] : 'unrelated-package';
        assert.throws(
          () => validateConsumerSelection(consumers),
          /module and its native exports/,
        );
      }
    }
  }
});

test('public export probes use argv and preserve literal module names', () => {
  const probe = publicExportCommand({
    specifier: 'literal`$(name)',
    exports: ['defineConfig'],
    conditions: ['node', 'development'],
  });
  assert.equal(probe.command, process.execPath);
  assert.deepEqual(probe.args.slice(0, 2), [
    '--conditions=node',
    '--conditions=development',
  ]);
  assert.match(probe.args.at(-1), /literal`\$\(name\)/);
  assert.throws(
    () =>
      publicExportCommand({
        specifier: 'x',
        exports: ['x'],
        conditions: ['bad=condition'],
      }),
    /Invalid export condition/,
  );
});

test('public configuration probing invokes defineConfig and rejects an uncomposed renderer', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ultramodern-config-probe-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const moduleFile = path.join(root, 'unit.mjs');
  await fs.writeFile(
    moduleFile,
    'export const defineConfig = config => ({...config, plugins: []});',
  );
  await assert.rejects(
    executeCommand(
      publicExportCommand({
        specifier: new URL(`file://${moduleFile}`).href,
        role: 'configuration',
        renderer: 'solid',
        exports: ['defineConfig'],
      }),
      root,
    ),
    /did not compose/,
  );
});

test('build metadata uses the installed public owning validator and selected profile', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ultramodern-metadata-owner-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ownerRoot = path.join(
    root,
    'node_modules/@bleedingdev/modern-js-ultramodern-app-tools',
  );
  await fs.mkdir(ownerRoot, { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    '{"name":"unit-only-consumer"}',
  );
  await fs.writeFile(
    path.join(ownerRoot, 'package.json'),
    '{"name":"@bleedingdev/modern-js-ultramodern-app-tools","main":"index.cjs"}',
  );
  await fs.writeFile(
    path.join(ownerRoot, 'index.cjs'),
    'exports.resolveRendererProfile = renderer => ({renderer, compiler:"installed-owner"}); exports.validateRendererBuildManifest = (metadata, profile) => { if(metadata.schema !== "ultramodern-renderer-build") throw new Error("old synthetic metadata rejected"); return {...metadata, selectedProfile:profile}; }; exports.validateRendererDevelopmentBuildManifest = (metadata, profile) => { if (!metadata.devCompilation || metadata.promotable !== false) throw new Error("real development compilation required"); return {...metadata, selectedProfile:profile, owningDevelopmentValidator:true}; };',
  );
  const result = await loadInstalledBuildManifest({
    applicationRoot: root,
    renderer: 'solid',
    metadata: { schema: 'ultramodern-renderer-build' },
  });
  assert.deepEqual(result.selectedProfile, {
    renderer: 'solid',
    compiler: 'installed-owner',
  });
  await assert.rejects(
    loadInstalledBuildManifest({
      applicationRoot: root,
      renderer: 'solid',
      metadata: { schemaVersion: 1, rendererIdentity: {} },
    }),
    /synthetic metadata rejected/,
  );
  const development = await loadInstalledBuildManifest({
    applicationRoot: root,
    renderer: 'solid',
    environment: 'development',
    metadata: { devCompilation: { generation: 1 }, promotable: false },
  });
  assert.equal(development.owningDevelopmentValidator, true);
  assert.deepEqual(development.selectedProfile, result.selectedProfile);
  await assert.rejects(
    loadInstalledBuildManifest({
      applicationRoot: root,
      renderer: 'solid',
      environment: 'development',
      metadata: { schema: 'ultramodern-renderer-build' },
    }),
    /real development compilation required/,
  );
});

test('command evidence comes from a real successful child', async () => {
  const result = await executeCommand(
    {
      command: process.execPath,
      args: ['--eval', 'process.stdout.write("observed-output")'],
    },
    process.cwd(),
    { timeoutMs: 5_000 },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(
    result.stdoutSha256,
    createHash('sha256').update('observed-output').digest('hex'),
  );
});

test('failed and timed-out children cannot become successful command evidence', async () => {
  await assert.rejects(
    executeCommand(
      { command: process.execPath, args: ['--eval', 'process.exit(7)'] },
      process.cwd(),
      { timeoutMs: 5_000 },
    ),
    /failed \(7\)/,
  );
  await assert.rejects(
    executeCommand(
      {
        command: process.execPath,
        args: [
          '--eval',
          'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)',
        ],
      },
      process.cwd(),
      { timeoutMs: 200 },
    ),
    /timeout/,
  );
});

test('a successful parent cannot leave an inherited-stdio descendant running', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ultramodern-command-child-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pidFile = path.join(root, 'child-pid');
  const source = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['--eval','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']}); fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); child.unref();`;
  await assert.rejects(
    executeCommand(
      { command: process.execPath, args: ['--eval', source] },
      root,
      { timeoutMs: 3_000 },
    ),
    /timeout/,
  );
  const childPid = Number(await fs.readFile(pidFile, 'utf8'));
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
});

test('interruption rejects evidence even when the child handles termination with exit zero', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ultramodern-command-interrupt-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ready = path.join(root, 'ready');
  const source = `const fs=require('node:fs'); process.on('SIGTERM',()=>process.exit(0)); fs.writeFileSync(${JSON.stringify(ready)},'ready'); setInterval(()=>{},1000);`;
  const pending = executeCommand(
    { command: process.execPath, args: ['--eval', source] },
    root,
    { timeoutMs: 5_000 },
  );
  const rejection = assert.rejects(pending, /interrupted/);
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    if (
      await fs.access(ready).then(
        () => true,
        () => false,
      )
    )
      break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await fs.access(ready);
  process.emit('SIGTERM');
  await rejection;
});

test('real overlapping and aliased consumer roots fail before any install or build', async t => {
  for (const mode of ['overlap', 'symlink']) {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ultramodern-consumer-isolation-'),
    );
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const consumers = unitConsumers(root);
    for (const consumer of consumers) await fs.mkdir(consumer.consumerRoot);
    if (mode === 'overlap') {
      consumers[1].consumerRoot = path.join(
        consumers[0].consumerRoot,
        'nested',
      );
      await fs.mkdir(consumers[1].consumerRoot);
    } else {
      const alias = path.join(root, 'alias');
      await fs.symlink(consumers[0].consumerRoot, alias);
      consumers[1].consumerRoot = alias;
    }
    let commandCalls = 0;
    await assert.rejects(
      runPackedConformance(
        { manifestPath: '/unit-only-manifest.json', consumers },
        {
          auditReleaseArtifacts: async () => ({
            sourceRevision: 'a'.repeat(40),
            artifacts: [],
          }),
          executeCommand: async () => {
            commandCalls++;
          },
        },
      ),
      /non-overlapping real roots/,
    );
    assert.equal(commandCalls, 0);
  }
});

test('unit pipeline never claims conformance without browser and platform evidence', async t => {
  const { commands, config, dependencies } = await unitInstalledConsumers(t);
  const report = await runPackedConformance(config, dependencies);
  assert.equal(report.status, 'awaiting-browser-and-platform-evidence');
  assert.equal(report.receipt, undefined);
  assert.equal(report.consumers.length, 6);
  assert.equal(report.identity.sourceRevision, 'a'.repeat(40));
  assert.equal(
    report.consumers[0].buildProvenance.production.sourceRevision,
    'f'.repeat(40),
  );
  assert.equal(
    report.consumers[0].buildProvenance.production.frameworkCohortDigest,
    '4'.repeat(64),
  );
  const expectedCommands = config.consumers.reduce(
    (count, consumer) =>
      count +
      2 +
      Object.keys(consumer.commands).length +
      (consumer.renderer === 'react' ? 0 : 1) +
      consumer.exportProbes.filter(
        probe => probe.role !== 'client-runtime' && probe.role !== 'router',
      ).length,
    0,
  );
  assert.equal(commands.length, expectedCommands);
  for (const consumer of report.consumers.filter(
    consumer => consumer.renderer !== 'react',
  )) {
    assert.deepEqual(consumer.typeProgram.explicitAmbientTypes, []);
    assert.deepEqual(consumer.hostTypeProgram.explicitAmbientTypes, ['node']);
    assert.deepEqual(
      consumer.commands
        .filter(command => command.phase === 'typecheck')
        .map(command => command.role),
      ['browser', 'server'],
    );
  }
  assert.equal(
    commands.filter(command =>
      command.args.includes('--config.engineStrict=true'),
    ).length,
    6,
  );
});

test('common auditor omits foreign native proof fields and binds Octane production proofs to actual entry identities', async t => {
  const { config, dependencies, consumers } = await unitInstalledConsumers(t);
  for (const consumer of consumers.filter(
    value => value.renderer === 'octane',
  )) {
    const host = consumer.environments.production;
    host.nativeCompilerManifests = [host.identity, host.csrIdentity].map(
      value => ({
        entryName: value.entryName,
        manifestPath: `production/unit-${value.entryName}-compiler.json`,
      }),
    );
  }
  const observed = [];
  dependencies.auditInstalledConsumer = async options => {
    observed.push(options);
    if (options.renderer !== 'octane')
      assert.equal(Object.hasOwn(options, 'nativeCompilerManifests'), false);
    else {
      assert.equal(options.nativeCompilerManifests.length, 2);
      const host = consumers.find(
        value => value.consumerRoot === options.consumerRoot,
      ).environments.production;
      assert.deepEqual(
        options.nativeCompilerManifests.map(value => value.rendererIdentity),
        [host.identity, host.csrIdentity],
      );
      assert.ok(
        options.nativeCompilerManifests.every(value =>
          value.manifestPath.startsWith('production/'),
        ),
      );
    }
    return { closure: [] };
  };
  const report = await runPackedConformance(config, dependencies);
  assert.equal(report.status, 'awaiting-browser-and-platform-evidence');
  assert.equal(observed.length, 6);
});

test('physical compiler proofs cannot relabel memory-only development or a foreign renderer', async t => {
  for (const renderer of ['react', 'solid', 'octane']) {
    const { config, dependencies, consumers } = await unitInstalledConsumers(t);
    const consumer = consumers.find(value => value.renderer === renderer);
    const environment = renderer === 'octane' ? 'development' : 'production';
    const host = consumer.environments[environment];
    host.nativeCompilerManifests = [
      {
        entryName: host.identity.entryName,
        manifestPath: 'production/unit-compiler.json',
      },
    ];
    await assert.rejects(
      runPackedConformance(config, dependencies),
      /only.*Octane production build/u,
    );
  }
});

test('native observer decoding uses the installed protocol and authoritative route and build identity', async t => {
  const { config, consumers, dependencies } = await unitInstalledConsumers(t);
  for (const consumer of consumers)
    for (const host of Object.values(consumer.environments))
      host.probes.controlRouteId = 'unit-only-native-control';
  let decoded = 0;
  dependencies.loadDataResponseReader =
    async () => async (response, binding, signal) => {
      assert.ok(response instanceof Response);
      assert.equal(binding.routeId, 'unit-only-native-control');
      assert.ok(['loader', 'action'].includes(binding.operation));
      assert.ok(signal instanceof AbortSignal);
      assert.ok(
        consumers.some(consumer =>
          Object.values(consumer.environments).some(
            host =>
              JSON.stringify(host.identity) ===
              JSON.stringify(binding.identity),
          ),
        ),
      );
      decoded += 1;
      return { kind: 'success', status: 200, value: { activeRequests: 1 } };
    };
  dependencies.probeHttp = async ({ renderer, decodeControlResponse }) => {
    if (renderer === 'react') assert.equal(decodeControlResponse, undefined);
    else
      for (const method of ['GET', 'POST'])
        assert.deepEqual(
          await decodeControlResponse(new Response('unit-only-wire'), {
            method,
            signal: new AbortController().signal,
          }),
          { activeRequests: 1 },
        );
    return [];
  };
  const report = await runPackedConformance(config, dependencies);
  assert.equal(decoded, 16);
  assert.equal(report.status, 'awaiting-browser-and-platform-evidence');
});

test('native observer decoding rejects non-success or unapproved data without JSON fallback', async t => {
  for (const outcome of [
    { kind: 'error', status: 422, value: {} },
    { kind: 'success', status: 200, value: [] },
    { kind: 'success', status: 200, value: null },
  ]) {
    const { config, consumers, dependencies } = await unitInstalledConsumers(t);
    for (const consumer of consumers)
      for (const host of Object.values(consumer.environments))
        host.probes.controlRouteId = 'unit-only-native-control';
    dependencies.loadDataResponseReader = async () => async () => outcome;
    dependencies.probeHttp = async ({ decodeControlResponse }) => {
      if (decodeControlResponse)
        await decodeControlResponse(Response.json({ activeRequests: 1 }), {
          method: 'GET',
          signal: new AbortController().signal,
        });
      return [];
    };
    await assert.rejects(
      runPackedConformance(config, dependencies),
      /approved successful observer data/u,
    );
  }
});

test('a stale host identity cannot be relabeled as the actual built consumer', async t => {
  const { config, consumers, dependencies } = await unitInstalledConsumers(t);
  consumers[0].environments.production.identity.buildId = 'stale-host';
  await assert.rejects(
    runPackedConformance(config, dependencies),
    /host identity does not match/,
  );
});

test('CSR proof requires a distinct authoritative built entry identity', async t => {
  const { config, consumers, dependencies } = await unitInstalledConsumers(t);
  consumers[0].environments.development.csrIdentity =
    consumers[0].environments.development.identity;
  await assert.rejects(
    runPackedConformance(config, dependencies),
    /distinct actual built entry/u,
  );
});

test('configuration cannot claim a newer minimum Node or substitute native HMR semantics', async t => {
  for (const field of ['minimumNode', 'hmr']) {
    const { config, consumers, dependencies, commands } =
      await unitInstalledConsumers(t);
    for (const consumer of consumers.filter(
      value => value.renderer === 'react',
    )) {
      if (field === 'minimumNode') consumer.profile.minimumNode = '999.0.0';
      else consumer.profile.hmr.editedBoundary = 'may-reset';
    }
    await assert.rejects(
      runPackedConformance(config, dependencies),
      /installed admitted renderer profile/,
    );
    assert.equal(commands.length, 0);
  }
});

test('native type checking requires separate strict browser and Node-host programs with actual roots', async t => {
  for (const mode of [
    'ambient',
    'different-program',
    'duplicate-project',
    'override-types',
    'disable-strict',
    'host-ambient',
    'missing-host-command',
    'wrong-generated-root',
    'combined-browser-glob',
  ]) {
    const { config, consumers, dependencies } = await unitInstalledConsumers(t);
    const consumer = consumers.find(value => value.renderer === 'solid');
    const command = consumer.commands.typecheck[0];
    if (mode === 'ambient')
      await fs.writeFile(
        path.join(consumer.consumerRoot, consumer.typeProgramFile),
        '{"compilerOptions":{"types":["react"]}}',
      );
    else if (mode === 'different-program') command.args = ['exec', 'tsc'];
    else if (mode === 'duplicate-project')
      command.args.push('--project', 'other.json');
    else if (mode === 'override-types') command.args.push('--types', 'react');
    else if (mode === 'disable-strict') command.args.push('--strict=false');
    else if (mode === 'missing-host-command') consumer.commands.typecheck.pop();
    else {
      const programFile =
        mode === 'host-ambient'
          ? consumer.hostTypeProgramFile
          : consumer.typeProgramFile;
      const absolute = path.join(consumer.consumerRoot, programFile);
      const program = JSON.parse(await fs.readFile(absolute, 'utf8'));
      if (mode === 'host-ambient')
        program.compilerOptions.types = ['node', 'react'];
      else if (mode === 'wrong-generated-root')
        program.files = unitNativeEntries(consumer).server;
      else program.include = ['src', 'node_modules/.modern-js'];
      await fs.writeFile(absolute, JSON.stringify(program));
    }
    await assert.rejects(
      runPackedConformance(config, dependencies),
      /types: \[\]|actual recorded type program|browser and Node-host typecheck/,
    );
  }
});

test('the single build precedes final checks and rejects authored or generated source drift', async t => {
  for (const mode of [
    'build-source',
    'build-program',
    'check-source',
    'check-generated',
  ]) {
    const { config, consumers, dependencies } = await unitInstalledConsumers(t);
    const consumer = consumers.find(value => value.renderer === 'solid');
    const source = path.join(consumer.consumerRoot, 'src/owner.ts');
    const actualRoot = await fs.realpath(consumer.consumerRoot);
    await fs.mkdir(path.dirname(source));
    await fs.writeFile(source, 'export const owner = 1;');
    const originalRun = dependencies.executeCommand;
    let built = false;
    dependencies.executeCommand = async (command, cwd) => {
      const result = await originalRun(command, cwd);
      if (cwd !== actualRoot) return result;
      if (command === consumer.commands.build) {
        assert.equal(built, false);
        built = true;
        if (mode === 'build-source')
          await fs.writeFile(source, 'changed authored input');
        if (mode === 'build-program')
          await fs.appendFile(
            path.join(consumer.consumerRoot, consumer.typeProgramFile),
            '\n',
          );
      }
      if (consumer.commands.typecheck.includes(command)) {
        assert.equal(built, true);
        if (mode === 'check-source')
          await fs.writeFile(source, 'changed authored input');
        if (mode === 'check-generated')
          await fs.writeFile(
            path.join(
              consumer.consumerRoot,
              unitNativeEntries(consumer).browser[0],
            ),
            'changed final generated source',
          );
      }
      return result;
    };
    await assert.rejects(runPackedConformance(config, dependencies), /drifted/);
  }
});

test('all six consumer metadata byte graphs contribute to the final profile binding', async t => {
  const { config, consumers, dependencies } = await unitInstalledConsumers(t);
  const before = await runPackedConformance(config, dependencies);
  const file = path.join(
    consumers[5].consumerRoot,
    consumers[5].environments.production.metadataFile,
  );
  const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
  metadata.compilerDigest = '9'.repeat(64);
  await fs.writeFile(file, JSON.stringify(metadata));
  const after = await runPackedConformance(config, dependencies);
  assert.notEqual(before.identity.profileDigest, after.identity.profileDigest);
});

test('checks pin the actual nested type program bytes throughout the checker invocation', async t => {
  const { config, consumers, dependencies } = await unitInstalledConsumers(t);
  const consumer = consumers.find(value => value.renderer === 'solid');
  const source = path.join(consumer.consumerRoot, consumer.typeProgramFile);
  const nested = path.join(consumer.consumerRoot, 'type-programs/browser.json');
  const program = JSON.parse(await fs.readFile(source));
  program.files = program.files.map(file => `../${file}`);
  program.extends = '../tsconfig.json';
  await fs.mkdir(path.dirname(nested));
  await fs.writeFile(nested, JSON.stringify(program));
  consumer.typeProgramFile = 'type-programs/browser.json';
  consumer.commands.typecheck[0].args = [
    'exec',
    'tsc',
    '--project',
    consumer.typeProgramFile,
    '--noEmit',
  ];
  const run = dependencies.executeCommand;
  dependencies.executeCommand = async (command, cwd) => {
    const result = await run(command, cwd);
    if (command === consumer.commands.typecheck[0])
      await fs.appendFile(nested, '\n');
    return result;
  };
  await assert.rejects(
    runPackedConformance(config, dependencies),
    /Validated type program drifted/,
  );
});
