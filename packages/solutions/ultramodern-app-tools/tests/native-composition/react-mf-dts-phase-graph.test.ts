import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  RendererBuildIdentities,
  RendererGeneratedOutputIdentityLease,
} from '@modern-js/app-tools-extensions/renderer-build-identity';
import {
  assertRendererGeneratedOutputOperationsAllowed,
  assertRendererGeneratedOutputReceiptCurrent,
  immutableRendererGeneratedOutputRegistration,
  type RendererGeneratedOutputNode,
  type RendererGeneratedOutputReceipt,
  type RendererGeneratedOutputRegistration,
  rendererGeneratedOutputPermission,
  validateRendererGeneratedOutputReceipt,
} from '@modern-js/app-tools-extensions/renderer-generated-outputs';
import {
  createRsbuild,
  type RsbuildPluginAPI,
  type Rspack,
  rspack,
} from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  type ReactGeneratedOutputGeneration,
  ReactTypedCssPhase,
} from '../../src/native-composition/react-typed-css-phase';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';

const roots = new Set<string>();
const closes = new Set<() => Promise<void>>();
const releaseGates = new Set<() => void>();

afterEach(async () => {
  for (const release of releaseGates) release();
  releaseGates.clear();
  for (const close of closes) await close();
  closes.clear();
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  roots.clear();
});

const sha = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function failureSignal() {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  void promise.catch(() => {});
  return { promise, reject };
}

function observe(filename: string): RendererGeneratedOutputNode {
  const nodePath = {
    lexical: filename,
    canonical: path.join(
      fs.realpathSync(path.dirname(filename)),
      path.basename(filename),
    ),
  };
  let stat: fs.BigIntStats;
  try {
    stat = fs.lstatSync(filename, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { path: nodePath, kind: 'missing' };
    throw error;
  }
  if (!stat.isFile()) throw new Error('Expected a physical test output file.');
  return {
    path: nodePath,
    kind: 'file',
    byteDigest: sha(fs.readFileSync(filename)),
    metadata: {
      device: String(stat.dev),
      inode: String(stat.ino),
      size: String(stat.size),
      mtimeNs: String(stat.mtimeNs),
      ctimeNs: String(stat.ctimeNs),
    },
  };
}

type ReceiptBinding = {
  registration: RendererGeneratedOutputRegistration;
  receipt: RendererGeneratedOutputReceipt;
};

function acknowledged(
  root: string,
  compilerId: string,
  reservation: ReactGeneratedOutputGeneration,
): ReceiptBinding {
  reservation.assertCurrent();
  const packageDirectory = path.join(root, '.modern-js/test-receiver');
  const modulePath = path.join(packageDirectory, 'index.cjs');
  const output = path.join(root, '@mf-types', `${compilerId}.d.ts`);
  const registration = immutableRendererGeneratedOutputRegistration({
    schemaVersion: 1,
    id: `phase-graph-${compilerId}`,
    pathFlavor: 'posix',
    producer: {
      packageName: '@fixture/native-receiver',
      version: '1.0.0',
      packageDirectory,
      modulePath,
      moduleDigest: sha(fs.readFileSync(modulePath)),
    },
    consumer: { id: 'phase-graph', projectRoot: root },
    generation: {
      operationId: `phase-graph-${compilerId}-${reservation.generation}`,
      compilerId,
      generation: reservation.generation,
      revision: `receiver-${compilerId}-${reservation.generation}`,
    },
    effectiveOptions: { typesFolder: '@mf-types', consumeTypes: true },
    context: { mode: 'development' },
    destinations: [
      {
        path: {
          lexical: path.join(root, '@mf-types'),
          canonical: path.join(root, '@mf-types'),
        },
        scope: 'subtree',
        kind: 'directory',
      },
    ],
    authoredPaths: [],
    protectedInputs: [],
  });
  const operation = {
    operation: 'write' as const,
    kind: 'file' as const,
    before: observe(output),
  };
  const plan = assertRendererGeneratedOutputOperationsAllowed(registration, [
    operation,
  ]);
  fs.writeFileSync(output, `export type ${compilerId} = "generation-one";\n`);
  const after = observe(output);
  const receipt = validateRendererGeneratedOutputReceipt(
    registration,
    plan,
    {
      status: 'complete',
      registrationDigest: registration.registrationDigest,
      planDigest: plan.planDigest,
      generation: registration.generation,
      operations: [{ ...operation, after }],
    },
    {
      generation: registration.generation,
      nodes: [observe(output)],
    },
  );
  return { registration, receipt };
}

function identities(): RendererBuildIdentities {
  const profile = resolveRendererProfile('react');
  const provider = { ...profile.router, framework: 'react-router' as const };
  return {
    identities: {
      main: {
        renderer: 'react',
        appId: 'phase-graph',
        entryName: 'main',
        protocolVersion: 1,
        buildId: 'a'.repeat(64),
      },
    },
    buildMarker: 'a'.repeat(64),
    sourceRevision: 'workspace',
    inputDigest: 'b'.repeat(64),
    profileDigest: 'c'.repeat(64),
    compilerDigest: 'd'.repeat(64),
    frameworkCohortDigest: 'e'.repeat(64),
    cacheAllowed: false,
    promotable: false,
    routerBindings: {
      main: {
        owner: '@modern-js/plugin-router',
        evidence: 'owned-default',
        defaultProvider: provider,
        providers: [provider],
      },
    },
  };
}

async function harness(
  dependent: boolean,
  failedClient = false,
  fatalClient = false,
) {
  const root = fs.realpathSync(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'react-phase-graph-',
      ),
    ),
  );
  roots.add(root);
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '@mf-types'));
  fs.mkdirSync(path.join(root, '.modern-js/test-receiver'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"phase-graph"}');
  fs.writeFileSync(
    path.join(root, '.modern-js/test-receiver/index.cjs'),
    'module.exports = "controlled phase test producer";\n',
  );
  fs.writeFileSync(
    path.join(root, 'src/client.js'),
    failedClient
      ? 'export const broken = ;\n'
      : 'globalThis.clientPhase = 1;\n',
  );
  fs.writeFileSync(
    path.join(root, 'src/secondary.js'),
    'globalThis.secondaryPhase = 1;\n',
  );

  const secondaryGate = deferred();
  const secondaryFinishGate = deferred();
  const clientFatalGate = deferred();
  const nativeFailure = failureSignal();
  releaseGates.add(secondaryGate.resolve);
  releaseGates.add(secondaryFinishGate.resolve);
  releaseGates.add(clientFatalGate.resolve);
  const secondaryEntered = deferred();
  const secondaryBegan = deferred();
  const clientBegan = deferred();
  const clientFailed = deferred<Error>();
  const nativeDrained = deferred();
  const clientDone = deferred<Rspack.Stats>();
  const aggregateDone = deferred<Rspack.MultiStats>();
  const developmentSettled = deferred<Rspack.MultiStats>();
  const reservations = new Map<string, ReactGeneratedOutputGeneration>();
  const nativeCompilers = new Map<string, Rspack.Compiler>();
  const nativeWatchings = new Map<
    string,
    NonNullable<Rspack.Compiler['watching']>
  >();
  const nativeCompilations = new Map<string, Rspack.Compilation>();
  const graphChecks: Rspack.MultiStats[] = [];
  const generationBindings: ReactGeneratedOutputGeneration[] = [];
  const leases: RendererGeneratedOutputIdentityLease[] = [];
  const publicationLeases: RendererGeneratedOutputIdentityLease[] = [];
  const receipts: ReceiptBinding[] = [];
  let receiptRevision = 0;
  let finalizations = 0;
  let publications = 0;
  let released = 0;
  let shutdowns = 0;
  let finalLease: RendererGeneratedOutputIdentityLease | undefined;
  let finalizedStats: Rspack.Stats | Rspack.MultiStats | undefined;
  let readyState: 'pending' | 'ready' | 'failed' = 'pending';

  const phase = new ReactTypedCssPhase({
    appDirectory: root,
    internalDirectory: path.join(root, '.modern-js'),
    distDirectory: path.join(root, 'dist'),
    produceTypedCss: false,
    generatedOutputs: {
      waitForIdle: () => Promise.resolve(),
      bindGeneration(reservation) {
        generationBindings.push(reservation);
      },
      assertCompilerGraph(stats) {
        if (!('stats' in stats))
          throw new Error('Phase received one compiler instead of its graph.');
        expect(stats.stats).toHaveLength(2);
        expect(
          new Set(stats.stats.map(child => child.compilation.compiler)),
        ).toEqual(new Set(nativeCompilers.values()));
        for (const child of stats.stats) {
          const name = child.compilation.name;
          if (name !== 'client' && name !== 'secondary')
            throw new Error('Graph contains an unowned compiler name.');
          expect(child.compilation.compiler).toBe(nativeCompilers.get(name));
          expect(child.compilation).toBe(nativeCompilations.get(name));
        }
        graphChecks.push(stats);
      },
      async pinReceipts() {
        const pinnedRevision = receiptRevision;
        const pinnedReceipts = Object.freeze([...receipts]);
        let active = true;
        const lease: RendererGeneratedOutputIdentityLease = Object.freeze({
          revision: `host-receipts-${pinnedRevision}`,
          receipts: pinnedReceipts,
          assertEpochCurrent() {
            if (!active || pinnedRevision !== receiptRevision)
              throw new Error('Phase test receipt lease is stale.');
          },
          async assertCurrent() {
            if (!active || pinnedRevision !== receiptRevision)
              throw new Error('Phase test receipt lease is stale.');
            for (const binding of pinnedReceipts)
              assertRendererGeneratedOutputReceiptCurrent(
                binding.registration,
                binding.receipt,
                {
                  generation: binding.receipt.generation,
                  nodes: binding.receipt.nodes.map(node =>
                    observe(node.path.lexical),
                  ),
                },
              );
          },
          permission(filename: string) {
            if (!active || pinnedRevision !== receiptRevision)
              throw new Error('Phase test receipt lease is stale.');
            for (const binding of pinnedReceipts) {
              const permission = rendererGeneratedOutputPermission(
                binding.receipt,
                filename,
              );
              if (permission) return permission;
            }
            return undefined;
          },
          async withPublication<T>(callback: () => Promise<T>): Promise<T> {
            await lease.assertCurrent();
            publicationLeases.push(lease);
            const result = await callback();
            await lease.assertCurrent();
            return result;
          },
          release() {
            if (!active) return;
            active = false;
            released++;
          },
        });
        leases.push(lease);
        return lease;
      },
    },
    async finalize(stats, lease) {
      finalizations++;
      finalizedStats = stats;
      finalLease = lease;
      expect(lease).toBe(leases.at(-1));
      expect(lease?.receipts).toHaveLength(2);
      await lease?.assertCurrent();
      return identities();
    },
    async publishDevelopment(stats, resolved, assertCurrent) {
      publications++;
      assertCurrent();
      expect(stats).toBe(finalizedStats);
      expect(publicationLeases.at(-1)).toBe(finalLease);
      expect(resolved.identities.main?.buildId).toBe('a'.repeat(64));
      await finalLease?.assertCurrent();
    },
  });
  const ready = phase.resolveIdentities();
  void ready.then(
    () => {
      readyState = 'ready';
    },
    () => {
      readyState = 'failed';
    },
  );
  if (!failedClient && !fatalClient) void ready.catch(nativeFailure.reject);
  const observeNativeDrain = () => {
    if (
      nativeCompilers.size === 2 &&
      [...nativeCompilers].every(
        ([name, candidate]) =>
          !candidate.running &&
          !candidate.watching?.running &&
          !nativeWatchings.get(name)?.running,
      )
    )
      nativeDrained.resolve();
  };
  const rsbuild = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      mode: 'development',
      server: { host: '127.0.0.1', port: 0, printUrls: false },
      dev: { writeToDisk: false, hmr: false, liveReload: false },
      performance: { printFileSize: false, buildCache: false },
      plugins: [
        {
          name: 'test-native-phase-graph',
          setup(api: RsbuildPluginAPI) {
            phase.install(api);
            api.onDevCompileDone({
              order: 'post',
              handler: async ({ stats }) => {
                if (!('stats' in stats))
                  throw new Error(
                    'Expected a completed native compiler graph.',
                  );
                developmentSettled.resolve(stats);
              },
            });
            if (dependent)
              api.modifyRspackConfig((config, { environment }) => {
                if (environment.name === 'secondary')
                  config.dependencies = ['client'];
                return config;
              });
            api.onAfterCreateCompiler(({ compiler }) => {
              expect(api.context.action).toBe('dev');
              if (!('compilers' in compiler))
                throw new Error('Expected the actual two-web MultiCompiler.');
              expect(compiler.compilers).toHaveLength(2);
              compiler.hooks.done.tap(
                'test-phase-graph-aggregate-done',
                stats => aggregateDone.resolve(stats),
              );
              for (const candidate of compiler.compilers) {
                const name = candidate.options.name;
                if (name !== 'client' && name !== 'secondary')
                  throw new Error('Unexpected native compiler identity.');
                nativeCompilers.set(name, candidate);
                candidate.hooks.failed.tap(
                  'test-phase-graph-native-failure',
                  error => {
                    if (
                      name === 'client' &&
                      fatalClient &&
                      error.message.includes(
                        'Controlled fatal client processAssets failure.',
                      )
                    )
                      clientFailed.resolve(error);
                    else nativeFailure.reject(error);
                    observeNativeDrain();
                  },
                );
                candidate.hooks.afterDone.tap(
                  'test-phase-graph-native-drain',
                  observeNativeDrain,
                );
                candidate.hooks.watchClose.tap(
                  'test-phase-graph-native-drain',
                  observeNativeDrain,
                );
                candidate.hooks.shutdown.tap(
                  'test-phase-graph-native-shutdown',
                  () => {
                    shutdowns++;
                  },
                );
                candidate.hooks.thisCompilation.tap(
                  'test-phase-graph-begin',
                  compilation => {
                    nativeCompilations.set(name, compilation);
                    compilation.hooks.processAssets.tapPromise(
                      {
                        name: 'test-phase-graph-begin',
                        stage:
                          rspack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
                      },
                      async () => {
                        if (candidate.watching)
                          nativeWatchings.set(name, candidate.watching);
                        if (
                          name === 'secondary' &&
                          (failedClient || fatalClient)
                        ) {
                          secondaryEntered.resolve();
                          await secondaryGate.promise;
                        }
                        const reservation =
                          phase.reserveGeneratedOutputGeneration();
                        reservation.assertCurrent();
                        reservations.set(name, reservation);
                        expect(reservation.generation).toBe(1);
                        expect(
                          phase.shouldScheduleGeneratedOutputWatch(reservation),
                        ).toBe(false);
                        receipts.push(acknowledged(root, name, reservation));
                        receiptRevision++;
                        if (name === 'client' && fatalClient) {
                          clientBegan.resolve();
                          await clientFatalGate.promise;
                          throw new Error(
                            'Controlled fatal client processAssets failure.',
                          );
                        }
                        if (name === 'secondary') {
                          secondaryBegan.resolve();
                          if (fatalClient) await secondaryFinishGate.promise;
                          else if (!failedClient) {
                            secondaryEntered.resolve();
                            await secondaryGate.promise;
                          }
                        }
                      },
                    );
                  },
                );
                if (name === 'client')
                  candidate.hooks.done.tap(
                    'test-phase-graph-client-done',
                    stats => clientDone.resolve(stats),
                  );
              }
            });
          },
        },
      ],
      environments: {
        client: {
          source: { entry: { main: path.join(root, 'src/client.js') } },
          output: {
            target: 'web',
            distPath: { root: path.join(root, 'dist/client') },
            cleanDistPath: false,
          },
        },
        secondary: {
          source: { entry: { main: path.join(root, 'src/secondary.js') } },
          output: {
            target: 'web',
            distPath: { root: path.join(root, 'dist/secondary') },
            cleanDistPath: false,
          },
        },
      },
    },
  });
  const server = await rsbuild.createDevServer({ getPortSilently: true });
  closes.add(() => server.close());
  const listening = server.listen();
  void listening.catch(nativeFailure.reject);
  return {
    phase,
    ready,
    failure: nativeFailure.promise,
    listening,
    clientDone: clientDone.promise,
    clientBegan: clientBegan.promise,
    clientFailed: clientFailed.promise,
    nativeDrained: nativeDrained.promise,
    aggregateDone: aggregateDone.promise,
    developmentSettled: developmentSettled.promise,
    secondaryEntered: secondaryEntered.promise,
    secondaryBegan: secondaryBegan.promise,
    releaseSecondary: secondaryGate.resolve,
    releaseSecondaryFinish: secondaryFinishGate.resolve,
    releaseClientFatal: clientFatalGate.resolve,
    reservations,
    nativeCompilers,
    nativeWatchings,
    generationBindings,
    graphChecks,
    leases,
    publicationLeases,
    finalLease: () => finalLease,
    counts: () => ({ finalizations, publications, released, readyState }),
    shutdowns: () => shutdowns,
  };
}

describe('React generated output phase across a native development graph', () => {
  it.each([
    false,
    true,
  ])('waits for both web compilers before finalizing and publishing, dependent=%s', async dependent => {
    const run = await harness(dependent);
    try {
      const [firstDone] = await Promise.race([
        Promise.all([run.clientDone, run.secondaryEntered]),
        run.failure,
      ]);
      expect(firstDone.hasErrors()).toBe(false);
      await new Promise<void>(resolve => setImmediate(resolve));
      const first = run.reservations.get('client');
      const second = run.reservations.get('secondary');
      expect(first?.generation).toBe(1);
      expect(second).toBe(first);
      expect(second?.snapshot).toBe(first?.snapshot);
      expect(run.generationBindings).toEqual([first]);
      expect(run.graphChecks).toHaveLength(0);
      expect(run.counts()).toEqual({
        finalizations: 0,
        publications: 0,
        released: 1,
        readyState: 'pending',
      });

      run.releaseSecondary();
      const [resolved, aggregate] = await Promise.race([
        Promise.all([
          run.ready,
          run.aggregateDone,
          run.listening,
          run.developmentSettled,
        ]),
        run.failure,
      ]);
      expect(aggregate.hasErrors()).toBe(false);
      expect(aggregate.stats).toHaveLength(2);
      expect(run.graphChecks.length).toBeGreaterThan(0);
      for (const stats of run.graphChecks)
        expect(stats.stats).toEqual(aggregate.stats);
      expect(resolved.identities.main?.buildId).toBe('a'.repeat(64));
      expect(run.finalLease()).toBe(run.leases[1]);
      expect(run.publicationLeases).toEqual([run.leases[1]]);
      expect(run.counts()).toEqual({
        finalizations: 1,
        publications: 1,
        released: 2,
        readyState: 'ready',
      });
    } finally {
      run.releaseSecondary();
    }
  });

  it('keeps the failed client wave active for a later secondary BEGIN until aggregate completion', async () => {
    const run = await harness(false, true);
    try {
      const [firstDone] = await Promise.race([
        Promise.all([run.clientDone, run.secondaryEntered]),
        run.failure,
      ]);
      expect(firstDone.hasErrors()).toBe(true);
      await expect(run.ready).rejects.toThrow('compilation failed');
      const first = run.reservations.get('client');
      expect(first?.generation).toBe(1);
      expect(run.phase.currentGeneratedOutputGeneration()).toBe(first);
      expect(run.counts().finalizations).toBe(0);
      expect(run.counts().publications).toBe(0);

      run.releaseSecondary();
      await Promise.race([run.secondaryBegan, run.failure]);
      expect(run.reservations.get('secondary')).toBe(first);
      expect(run.reservations.get('secondary')?.snapshot).toBe(first?.snapshot);
      const [aggregate] = await Promise.race([
        Promise.all([run.aggregateDone, run.listening, run.developmentSettled]),
        run.failure,
      ]);
      expect(aggregate.hasErrors()).toBe(true);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(run.graphChecks.length).toBeGreaterThan(0);
      expect(run.counts().finalizations).toBe(0);
      expect(run.counts().publications).toBe(0);
      expect(run.phase.reserveGeneratedOutputGeneration().generation).toBe(2);
    } finally {
      run.releaseSecondary();
    }
  });

  it('retains the fatal client generation while a real sibling is running and advances only after native drain', async () => {
    const run = await harness(false, false, true);
    try {
      await Promise.race([
        Promise.all([run.clientBegan, run.secondaryEntered]),
        run.failure,
      ]);
      const first = run.reservations.get('client');
      expect(first?.generation).toBe(1);
      const secondary = run.nativeCompilers.get('secondary');
      if (!secondary) throw new Error('Missing the actual secondary compiler.');
      const secondaryWatching = run.nativeWatchings.get('secondary');
      if (!secondaryWatching)
        throw new Error('Missing the actual secondary Watching object.');
      expect(secondaryWatching.running).toBe(true);

      run.releaseClientFatal();
      const fatal = await Promise.race([run.clientFailed, run.failure]);
      expect(fatal.message).toContain(
        'Controlled fatal client processAssets failure.',
      );
      await expect(run.ready).rejects.toThrow(
        'Controlled fatal client processAssets failure.',
      );
      expect({
        attached: secondary.watching === secondaryWatching,
        compilerRunning: secondary.running,
        watchingRunning: secondaryWatching.running,
      }).toEqual({
        attached: false,
        compilerRunning: true,
        watchingRunning: true,
      });
      expect(run.phase.currentGeneratedOutputGeneration()).toBe(first);

      run.releaseSecondary();
      await Promise.race([run.secondaryBegan, run.failure]);
      expect(run.reservations.get('secondary')).toBe(first);
      expect(run.reservations.get('secondary')?.snapshot).toBe(first?.snapshot);
      expect(secondaryWatching.running).toBe(true);
      expect(run.phase.currentGeneratedOutputGeneration()).toBe(first);
      expect(run.counts().finalizations).toBe(0);
      expect(run.counts().publications).toBe(0);

      run.releaseSecondaryFinish();
      await Promise.race([run.nativeDrained, run.failure]);
      await run.listening;
      expect(
        [...run.nativeCompilers].some(
          ([name, candidate]) =>
            candidate.running ||
            candidate.watching?.running ||
            run.nativeWatchings.get(name)?.running,
        ),
      ).toBe(false);
      expect(run.counts().finalizations).toBe(0);
      expect(run.counts().publications).toBe(0);
      if (run.shutdowns())
        expect(() => run.phase.reserveGeneratedOutputGeneration()).toThrow(
          'compiler closed',
        );
      else
        expect(run.phase.reserveGeneratedOutputGeneration().generation).toBe(2);
    } finally {
      run.releaseClientFatal();
      run.releaseSecondary();
      run.releaseSecondaryFinish();
    }
  });
});
