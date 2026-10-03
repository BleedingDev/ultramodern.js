import { execFileSync } from 'node:child_process';
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
} from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  type ReactGeneratedOutputGeneration,
  ReactTypedCssPhase,
} from '../../src/native-composition/react-typed-css-phase';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';

const roots: string[] = [];
const compilers: (Rspack.Compiler | Rspack.MultiCompiler)[] = [];
afterEach(async () => {
  for (const compiler of compilers.splice(0))
    await new Promise<void>((resolve, reject) =>
      compiler.close(error => (error ? reject(error) : resolve())),
    );
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

const sha = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
function observe(filename: string): RendererGeneratedOutputNode {
  const inputPath = { lexical: filename, canonical: filename };
  let stat: fs.BigIntStats;
  try {
    stat = fs.lstatSync(filename, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { path: inputPath, kind: 'missing' };
    throw error;
  }
  const metadata = {
    device: String(stat.dev),
    inode: String(stat.ino),
    mode: Number(stat.mode),
    uid: Number(stat.uid),
    gid: Number(stat.gid),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  };
  if (stat.isFile())
    return {
      path: inputPath,
      kind: 'file',
      byteDigest: sha(fs.readFileSync(filename)),
      metadata,
    };
  if (stat.isDirectory())
    return {
      path: inputPath,
      kind: 'directory',
      metadata,
      entries: fs.readdirSync(filename, { withFileTypes: true }).map(item => ({
        name: item.name,
        kind: item.isDirectory()
          ? 'directory'
          : item.isSymbolicLink()
            ? 'symlink'
            : 'file',
      })),
    };
  throw new Error('Test receipt does not support symlinks.');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-mf-phase-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '@mf-types'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"mf-phase"}');
  fs.writeFileSync(path.join(root, 'src/main.js'), 'globalThis.phase = 1;');
  return root;
}

function acknowledged(
  root: string,
  generation: number,
  filename: string,
  mutate: () => void,
  kind: 'file' | 'directory' = 'file',
) {
  const registration = immutableRendererGeneratedOutputRegistration({
    schemaVersion: 1,
    id: 'phase-test-receiver',
    pathFlavor: 'posix',
    producer: {
      packageName: '@module-federation/dts-plugin',
      version: '2.9.1',
      packageDirectory: '/phase-test-producer',
      modulePath: '/phase-test-producer/index.cjs',
      moduleDigest: sha('phase test producer'),
    },
    consumer: { id: 'phase-test', projectRoot: root },
    generation: {
      compilerId: 'client',
      generation,
      operationId: `phase-test-${generation}`,
      revision: `phase-test-${generation}`,
    },
    effectiveOptions: { consumeTypes: true, typesFolder: '@mf-types' },
    context: {},
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
    kind,
    before: observe(filename),
  };
  const plan = assertRendererGeneratedOutputOperationsAllowed(registration, [
    operation,
  ]);
  mutate();
  const after = observe(filename);
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
    { generation: registration.generation, nodes: [after] },
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
        appId: 'mf-phase',
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function harness(
  root: string,
  options: {
    idle?: Promise<void>;
    inputPaths?: readonly string[];
    finalize?: (
      lease: RendererGeneratedOutputIdentityLease | undefined,
    ) => Promise<void>;
    processAssets?: (phase: ReactTypedCssPhase) => void | Promise<void>;
  } = {},
) {
  let receipts: readonly {
    registration: RendererGeneratedOutputRegistration;
    receipt: RendererGeneratedOutputReceipt;
  }[] = [];
  let revision = 0;
  let released = 0;
  let finalizations = 0;
  let publications = 0;
  const bindings: ReactGeneratedOutputGeneration[] = [];
  const leases: RendererGeneratedOutputIdentityLease[] = [];
  const phase = new ReactTypedCssPhase({
    appDirectory: root,
    internalDirectory: path.join(root, '.modern-js'),
    distDirectory: path.join(root, 'dist'),
    produceTypedCss: false,
    inputPaths: options.inputPaths,
    generatedOutputs: {
      waitForIdle: () => options.idle ?? Promise.resolve(),
      bindGeneration: generation => {
        bindings.push(generation);
      },
      async pinReceipts() {
        const pinnedRevision = revision;
        const pinnedReceipts = Object.freeze([...receipts]);
        let active = true;
        const lease: RendererGeneratedOutputIdentityLease = Object.freeze({
          revision: String(pinnedRevision),
          receipts: pinnedReceipts,
          assertEpochCurrent() {
            if (!active || pinnedRevision !== revision)
              throw new Error('Test receiver lease changed.');
          },
          async assertCurrent() {
            if (!active || pinnedRevision !== revision)
              throw new Error('Test receiver lease changed.');
            for (const { registration, receipt } of pinnedReceipts)
              assertRendererGeneratedOutputReceiptCurrent(
                registration,
                receipt,
                {
                  generation: receipt.generation,
                  nodes: receipt.nodes.map(node => observe(node.path.lexical)),
                },
              );
          },
          permission(filename: string) {
            if (!active || pinnedRevision !== revision)
              throw new Error('Test receiver lease changed.');
            for (const { receipt } of pinnedReceipts) {
              const permission = rendererGeneratedOutputPermission(
                receipt,
                filename,
              );
              if (permission) return permission;
            }
            return undefined;
          },
          async withPublication<T>(callback: () => Promise<T>): Promise<T> {
            await lease.assertCurrent();
            const result = await callback();
            await lease.assertCurrent();
            return result;
          },
          release() {
            if (active) released++;
            active = false;
          },
        });
        leases.push(lease);
        return lease;
      },
    },
    async finalize(_stats, lease) {
      finalizations++;
      await options.finalize?.(lease);
      return identities();
    },
    async publishMetadata() {
      publications++;
    },
  });
  const rsbuild = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      mode: 'production',
      plugins: [
        {
          name: 'test-mf-receipt-phase',
          setup(api: RsbuildPluginAPI) {
            phase.install(api);
            if (options.processAssets)
              api.onAfterCreateCompiler(({ compiler }) => {
                for (const current of 'compilers' in compiler
                  ? compiler.compilers
                  : [compiler])
                  current.hooks.thisCompilation.tap(
                    'test-native-receiver-process-assets',
                    compilation => {
                      compilation.hooks.processAssets.tapPromise(
                        'test-native-receiver-process-assets',
                        async () => {
                          await options.processAssets?.(phase);
                        },
                      );
                    },
                  );
              });
          },
        },
      ],
      performance: { printFileSize: false, buildCache: false },
      environments: {
        client: {
          source: { entry: { main: path.join(root, 'src/main.js') } },
          output: {
            target: 'web',
            distPath: { root: path.join(root, 'dist') },
            cleanDistPath: false,
          },
        },
      },
    },
  });
  const compiler = await rsbuild.createCompiler();
  compilers.push(compiler);
  return {
    phase,
    bindings,
    leases,
    setReceipts(next: typeof receipts) {
      receipts = next;
      revision++;
    },
    revoke() {
      revision++;
    },
    counts: () => ({ released, finalizations, publications }),
    run: () =>
      new Promise<void>((resolve, reject) =>
        compiler.run((error, stats) => {
          if (error) reject(error);
          else if (!stats || stats.hasErrors())
            reject(new Error('Native phase test compilation failed.'));
          else resolve();
        }),
      ),
  };
}

describe('React receiver receipt phase integration', () => {
  it.each([
    { input: 'unrelated', reject: false },
    { input: 'consumed', reject: true },
  ])('scopes Git capture to the app and consumed shared inputs: $input', async ({
    input,
    reject,
  }) => {
    const workspace = fixture();
    const root = path.join(workspace, 'application');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"mf-phase"}');
    fs.writeFileSync(path.join(root, 'src/main.js'), 'globalThis.phase = 1;');
    const consumed = path.join(workspace, 'consumed.js');
    const unrelated = path.join(workspace, 'unrelated-package.js');
    fs.writeFileSync(consumed, 'export const value = 1;');
    fs.writeFileSync(unrelated, 'export const value = 1;');
    execFileSync('git', ['init', '--quiet'], { cwd: workspace });
    execFileSync('git', ['add', '.'], { cwd: workspace });
    const run = await harness(root, {
      inputPaths: [consumed],
      processAssets() {
        fs.writeFileSync(
          input === 'consumed' ? consumed : unrelated,
          'export const value = 2;',
        );
      },
    });
    const snapshot = run.phase.currentGeneratedOutputGeneration().snapshot;
    expect(snapshot.states.some(state => state.path === consumed)).toBe(true);
    expect(snapshot.states.some(state => state.path === unrelated)).toBe(false);
    if (reject) {
      await expect(run.run()).rejects.toThrow('authored inputs changed');
      expect(run.counts().publications).toBe(0);
    } else {
      await run.run();
      expect(run.counts().publications).toBe(1);
    }
  });

  it('reuses one pre-IO reservation and pins the same lease through finalization', async () => {
    const root = fixture();
    let finalizedLease: RendererGeneratedOutputIdentityLease | undefined;
    const run = await harness(root, {
      finalize: async lease => {
        finalizedLease = lease;
      },
    });
    const reserved = run.phase.reserveGeneratedOutputGeneration();
    expect(run.phase.reserveGeneratedOutputGeneration()).toBe(reserved);
    expect(run.phase.shouldScheduleGeneratedOutputWatch(reserved)).toBe(false);
    const filename = path.join(root, '@mf-types/remote.d.ts');
    run.setReceipts([
      acknowledged(root, reserved.generation, filename, () =>
        fs.writeFileSync(filename, 'export type Remote = string;'),
      ),
    ]);
    await run.run();
    await run.phase.resolveIdentities();
    expect(run.bindings[0]).toBe(reserved);
    expect(finalizedLease).toBe(run.leases[1]);
    expect(run.counts()).toEqual({
      released: 2,
      finalizations: 1,
      publications: 1,
    });
  });

  it('reuses the active native processAssets generation and pins its completed receiver revision', async () => {
    const root = fixture();
    let run: Awaited<ReturnType<typeof harness>>;
    let activeGeneration: ReactGeneratedOutputGeneration | undefined;
    let finalizedLease: RendererGeneratedOutputIdentityLease | undefined;
    run = await harness(root, {
      processAssets: async phase => {
        activeGeneration = phase.reserveGeneratedOutputGeneration();
        expect(activeGeneration).toBe(run.bindings[0]);
        expect(phase.shouldScheduleGeneratedOutputWatch(activeGeneration)).toBe(
          false,
        );
        const filename = path.join(root, '@mf-types/remote.d.ts');
        run.setReceipts([
          acknowledged(root, activeGeneration.generation, filename, () =>
            fs.writeFileSync(filename, 'export type Remote = string;'),
          ),
        ]);
        await Promise.resolve();
      },
      finalize: async lease => {
        finalizedLease = lease;
      },
    });
    await run.run();
    await run.phase.resolveIdentities();
    expect(activeGeneration?.generation).toBe(1);
    expect(run.leases[0].receipts).toHaveLength(0);
    expect(finalizedLease).toBe(run.leases[1]);
    expect(finalizedLease?.receipts).toHaveLength(1);
    expect(run.counts()).toEqual({
      released: 2,
      finalizations: 1,
      publications: 1,
    });
  });

  it('reserves the next baseline before writes after a completed phase', async () => {
    const root = fixture();
    const run = await harness(root);
    await run.run();
    const reserved = run.phase.reserveGeneratedOutputGeneration();
    expect(reserved.generation).toBe(2);
    expect(run.phase.shouldScheduleGeneratedOutputWatch(reserved)).toBe(true);
    const filename = path.join(root, '@mf-types/remote.d.ts');
    expect(
      reserved.snapshot.states.some(state => state.path === filename),
    ).toBe(false);
    run.setReceipts([
      acknowledged(root, reserved.generation, filename, () =>
        fs.writeFileSync(filename, 'export type Remote = number;'),
      ),
    ]);
    await run.run();
    await run.phase.resolveIdentities();
    expect(run.bindings[1]).toBe(reserved);
    expect(run.counts().publications).toBe(2);
  });

  it('fails an authored edit during pending IO and recovers on the next native hook after settlement', async () => {
    const root = fixture();
    const idle = deferred();
    const run = await harness(root, { idle: idle.promise });
    const reserved = run.phase.reserveGeneratedOutputGeneration();
    const first = run.run();
    fs.writeFileSync(path.join(root, 'src/main.js'), 'globalThis.phase = 2;');
    expect(run.phase.reserveGeneratedOutputGeneration()).toBe(reserved);
    const filename = path.join(root, '@mf-types/remote.d.ts');
    run.setReceipts([
      acknowledged(root, reserved.generation, filename, () =>
        fs.writeFileSync(filename, 'export type Remote = string;'),
      ),
    ]);
    idle.resolve();
    await expect(first).rejects.toThrow('authored inputs changed');
    expect(run.counts().publications).toBe(0);
    run.setReceipts([]);
    await run.run();
    await run.phase.resolveIdentities();
    expect(run.bindings[1].generation).toBe(2);
    expect(run.counts().publications).toBe(1);
  });

  it('releases preparation leases on a native compilation error and recovers', async () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'src/main.js'), 'export const broken = ;');
    const run = await harness(root);
    await expect(run.run()).rejects.toThrow();
    expect(run.counts().released).toBe(1);
    expect(run.counts().publications).toBe(0);
    fs.writeFileSync(path.join(root, 'src/main.js'), 'globalThis.phase = 2;');
    await run.run();
    await run.phase.resolveIdentities();
    expect(run.counts().released).toBe(3);
    expect(run.counts().publications).toBe(1);
  });

  it('keeps unacknowledged warm files as ordinary authored inputs', async () => {
    const root = fixture();
    const warm = path.join(root, '@mf-types/warm.d.ts');
    fs.writeFileSync(warm, 'export type Warm = string;');
    const run = await harness(root);
    const reserved = run.phase.reserveGeneratedOutputGeneration();
    const filename = path.join(root, '@mf-types/remote.d.ts');
    run.setReceipts([
      acknowledged(root, reserved.generation, filename, () =>
        fs.writeFileSync(filename, 'export type Remote = string;'),
      ),
    ]);
    fs.writeFileSync(warm, 'export type Warm = number;');
    await expect(run.run()).rejects.toThrow('authored inputs changed');
    expect(run.counts().publications).toBe(0);
  });

  it('does not grant descendant permissions from an acknowledged directory', async () => {
    const root = fixture();
    const run = await harness(root);
    const reserved = run.phase.reserveGeneratedOutputGeneration();
    const directory = path.join(root, '@mf-types/new-remote');
    run.setReceipts([
      acknowledged(
        root,
        reserved.generation,
        directory,
        () => fs.mkdirSync(directory),
        'directory',
      ),
    ]);
    fs.writeFileSync(
      path.join(directory, 'unknown.d.ts'),
      'export type Unknown = string;',
    );
    await expect(run.run()).rejects.toThrow();
    expect(run.counts().publications).toBe(0);
  });

  it('revokes publication when a new BEGIN reserves during an awaited finalizer', async () => {
    const root = fixture();
    let run: Awaited<ReturnType<typeof harness>>;
    run = await harness(root, {
      finalize: async () => {
        run.phase.reserveGeneratedOutputGeneration();
        run.revoke();
        await Promise.resolve();
      },
    });
    const ready = run.phase.resolveIdentities();
    await expect(run.run()).rejects.toThrow('no longer active');
    await expect(ready).rejects.toThrow('no longer active');
    expect(run.counts().publications).toBe(0);
    expect(run.counts().released).toBe(2);
  });
});
