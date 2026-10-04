import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import http from 'node:http';
import { createRequire, registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  assertRendererGeneratedOutputAcknowledgementProgress,
  assertRendererGeneratedOutputNextOperationsCurrent,
  assertRendererGeneratedOutputOperationsAllowed,
  assertRendererGeneratedOutputReceiptCurrent,
  assertRendererGeneratedOutputReceiptNodesCurrent,
  immutableRendererGeneratedOutputRegistration,
  type RendererGeneratedOutputAcknowledgement,
  type RendererGeneratedOutputCurrentNodes,
  type RendererGeneratedOutputGeneration,
  type RendererGeneratedOutputNode,
  type RendererGeneratedOutputOperation,
  type RendererGeneratedOutputPlan,
  type RendererGeneratedOutputReceipt,
  type RendererGeneratedOutputRegistration,
  rendererGeneratedOutputPermission,
  validateRendererGeneratedOutputReceipt,
} from '../../../app-tools-extensions/src/renderer-generated-outputs';

interface Seed extends RendererGeneratedOutputGeneration {
  schemaVersion: 1;
  registrationId: string;
}
interface Frame extends Seed {
  frameId: string;
}
interface Evidence {
  status: 'complete' | 'failed';
  frame: Frame;
  operations: RendererGeneratedOutputAcknowledgement[];
  nodes: RendererGeneratedOutputNode[];
  stages: {
    stage: string;
    outcome: string;
    requested?: boolean;
    result: unknown;
  }[];
  failures: {
    operation: string;
    reason: string;
    path?: string;
    code?: string;
  }[];
}
interface BeginDetails {
  operation: string;
  receiverProcessId: number;
  nativeOptions: unknown;
  remoteAlias?: string;
  update?: unknown;
}
interface NativeOptions {
  host: {
    context: string;
    moduleFederationConfig: { name: string; remotes: Record<string, string> };
    typesFolder: string;
    remoteTypesFolder: string;
    deleteTypesFolder: boolean;
    maxRetries: number;
    timeout: number;
    abortOnError: boolean;
    consumeAPITypes: boolean;
    remoteTypeUrls: Record<
      string,
      { alias: string; zip: string; api?: string }
    >;
  };
  extraOptions?: Record<string, unknown>;
}
interface Manager {
  options: NativeOptions;
  remoteAliasMap: Record<
    string,
    {
      name: string;
      alias: string;
      zipUrl?: string;
      apiTypeUrl?: string;
      url?: string;
    }
  >;
  consumeTypes(): Promise<void>;
  updateTypes(options: {
    updateMode: string;
    remoteName: string;
    remoteTarPath: string;
    remoteInfo?: { name: string; url: string; alias?: string };
    once?: boolean;
  }): Promise<void>;
}
interface Adapter {
  new (options: NativeOptions): Manager;
  prototype: Manager;
  nativeDtsOwner(): RendererGeneratedOutputRegistration['producer'];
  nativeDtsModules(): readonly { modulePath: string; moduleDigest: string }[];
  configureReceiverRegistration(
    options: NativeOptions,
    seed: Seed,
  ): NativeOptions;
  installReceiverRegistry(registry: {
    begin(
      seed: Seed,
      details: BeginDetails,
    ): Promise<{
      frame: Frame;
      sourceNamespaces?: {
        entries: { lexical: string; canonical: string }[];
        dirs: { lexical: string; canonical: string }[];
      };
      beforeOperations(operations: RendererGeneratedOutputOperation[]): void;
      acknowledgeOperations(
        operations: RendererGeneratedOutputAcknowledgement[],
      ): void;
      terminal(evidence: Evidence): Promise<void>;
    }>;
  }): () => void;
  observeReceiverNodes(
    registration: {
      consumer: { projectRoot: string };
      generation: RendererGeneratedOutputGeneration;
    },
    expectedNodes: readonly RendererGeneratedOutputNode[],
  ): RendererGeneratedOutputCurrentNodes;
}

const repositoryRoot = path.resolve(__dirname, '../../../../..');
const applicationRequire = createRequire(
  path.join(
    repositoryRoot,
    'tests/integration/routes-tanstack-mf/mf-remote/package.json',
  ),
);
const nativeRequire = createRequire(
  applicationRequire.resolve('@module-federation/modern-js-v3/ssr-plugin'),
);
const corePath = nativeRequire.resolve('@module-federation/dts-plugin/core');
const adapterPath = path.resolve(
  __dirname,
  '../../src/native-composition/react-mf-dts-implementation.cjs',
);
const sourceRequire = createRequire(adapterPath);
// Before the normal producer installs the newly declared direct dependency,
// resolve the real public core from the MF anchor. An existing own dependency
// always uses native resolution and must pass the physical cohort assertions.
let sourceResolution: ReturnType<typeof registerHooks> | undefined;
try {
  sourceRequire.resolve('@module-federation/dts-plugin/core');
} catch (error) {
  if (
    !(error instanceof Error) ||
    !('code' in error) ||
    error.code !== 'MODULE_NOT_FOUND'
  )
    throw error;
  sourceResolution = registerHooks({
    resolve(specifier, context, next) {
      if (
        specifier === '@module-federation/dts-plugin/core' &&
        context.parentURL === pathToFileURL(adapterPath).href
      )
        return { url: pathToFileURL(corePath).href, shortCircuit: true };
      return next(specifier, context);
    },
  });
}
let AdapterConstructor: Adapter;
try {
  AdapterConstructor = sourceRequire(adapterPath) as Adapter;
} finally {
  sourceResolution?.deregister();
}
const AdmZip = nativeRequire('adm-zip') as new () => {
  addFile(name: string, value: Buffer): void;
  toBuffer(): Buffer;
};
const roots: string[] = [];
const restores: (() => void)[] = [];
const servers: http.Server[] = [];
const priorDebug = process.env.FEDERATION_DEBUG;

afterEach(async () => {
  for (const restore of restores.splice(0).reverse()) restore();
  for (const server of servers.splice(0))
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
  if (priorDebug === undefined) delete process.env.FEDERATION_DEBUG;
  else process.env.FEDERATION_DEBUG = priorDebug;
});

const seed: Seed = {
  schemaVersion: 1,
  registrationId: 'native-receiver',
  operationId: 'native-operation',
  compilerId: 'native-client',
  generation: 1,
  revision: 'native-source',
};
const absolute = (lexical: string) => ({ lexical, canonical: lexical });
const digest = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');

function read(root: string, lexical: string) {
  return AdapterConstructor.observeReceiverNodes(
    { consumer: { projectRoot: root }, generation: seed },
    [{ path: absolute(lexical), kind: 'missing' }],
  ).nodes[0]!;
}

function zip(entries: [string, string][]) {
  const archive = new AdmZip();
  for (const [name, content] of entries)
    archive.addFile(name, Buffer.from(content));
  return archive.toBuffer();
}

async function fixture(
  options: {
    deleteTypesFolder?: boolean;
    api?: boolean;
    seedStale?: boolean;
  } = {},
) {
  delete process.env.FEDERATION_DEBUG;
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-native-dts-')),
  );
  roots.push(root);
  let archive = zip([
    ['App.d.ts', 'export declare const App: string;\n'],
    ['compiled-types/src/page.d.ts', 'export type Page = string;\n'],
  ]);
  let apiStatus = 200;
  const requests: string[] = [];
  let archiveGate: { entered(): void; released: Promise<void> } | undefined;
  const server = http.createServer((request, response) => {
    requests.push(request.url || '');
    if (request.url === '/types.zip' || request.url === '/@mf-types.zip') {
      const send = () => {
        response.setHeader('content-type', 'application/zip');
        response.end(archive);
      };
      if (archiveGate) {
        const gate = archiveGate;
        archiveGate = undefined;
        gate.entered();
        void gate.released.then(send);
      } else send();
    } else if (
      request.url === '/api.d.ts' ||
      request.url === '/@mf-types.d.ts'
    ) {
      response.statusCode = apiStatus;
      response.end(
        'export type Remote = typeof import("REMOTE_ALIAS_IDENTIFIER/App");\n',
      );
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Native DTS loopback server has no TCP address.');
  const base = `http://127.0.0.1:${address.port}`;
  if (options.seedStale !== false) {
    fs.mkdirSync(path.join(root, '@mf-types/remote/stale/nested'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, '@mf-types/remote/stale/nested/old.d.ts'),
      'old',
    );
  }
  const nativeOptions: NativeOptions = {
    host: {
      context: root,
      moduleFederationConfig: { name: 'private-host', remotes: {} },
      typesFolder: '@mf-types',
      remoteTypesFolder: '@mf-types',
      deleteTypesFolder: options.deleteTypesFolder ?? true,
      maxRetries: 1,
      timeout: 2000,
      abortOnError: false,
      consumeAPITypes: true,
      remoteTypeUrls: {
        'private-remote': {
          alias: 'remote',
          zip: `${base}/types.zip`,
          ...(options.api === false ? {} : { api: `${base}/api.d.ts` }),
        },
      },
    },
  };
  return {
    root,
    base,
    nativeOptions,
    requests,
    manager: new AdapterConstructor(
      AdapterConstructor.configureReceiverRegistration(nativeOptions, seed),
    ),
    setArchive(value: Buffer) {
      archive = value;
    },
    setAPIStatus(value: number) {
      apiStatus = value;
    },
    holdNextArchive() {
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>(resolve => {
        entered = resolve;
      });
      const released = new Promise<void>(resolve => {
        release = resolve;
      });
      archiveGate = { entered, released };
      return { started, release };
    },
  };
}

function policy(
  root: string,
  options: {
    authored?: string[];
    allowUnchanged?: boolean;
    before?: (operations: RendererGeneratedOutputOperation[]) => void;
    terminal?: () => Promise<void>;
    aliases?: string[];
    details?: (details: BeginDetails) => void;
    begin?: () => Promise<void>;
    sourceNamespaces?: {
      entries: { lexical: string; canonical: string }[];
      dirs: { lexical: string; canonical: string }[];
    };
  } = {},
) {
  const evidence: Evidence[] = [];
  const receipts: RendererGeneratedOutputReceipt[] = [];
  const registrations: RendererGeneratedOutputRegistration[] = [];
  let generation = 0;
  const restore = AdapterConstructor.installReceiverRegistry({
    async begin(input, details) {
      options.details?.(details);
      const frame: Frame = {
        ...input,
        generation: ++generation,
        frameId: `frame-${generation}`,
      };
      const registration = immutableRendererGeneratedOutputRegistration({
        schemaVersion: 1,
        id: input.registrationId,
        pathFlavor: process.platform === 'win32' ? 'win32' : 'posix',
        producer: AdapterConstructor.nativeDtsOwner(),
        consumer: { id: 'native-host', projectRoot: root },
        generation: {
          operationId: frame.operationId,
          compilerId: frame.compilerId,
          generation: frame.generation,
          revision: frame.revision,
        },
        effectiveOptions: { typesFolder: '@mf-types' },
        context: {},
        destinations: [
          { path: absolute(root), kind: 'directory', scope: 'exact' },
          {
            path: absolute(path.join(root, '@mf-types')),
            kind: 'directory',
            scope: 'exact',
          },
          ...(options.aliases ?? ['remote']).map(remoteAlias => ({
            path: absolute(path.join(root, '@mf-types', remoteAlias)),
            kind: 'directory' as const,
            scope: 'subtree' as const,
          })),
          ...[
            ...new Set(
              (options.aliases ?? ['remote']).flatMap(remoteAlias => {
                const parents: string[] = [];
                let current = path.dirname(remoteAlias);
                while (current !== '.') {
                  parents.push(path.join(root, '@mf-types', current));
                  current = path.dirname(current);
                }
                return parents;
              }),
            ),
          ].map(parent => ({
            path: absolute(parent),
            kind: 'directory' as const,
            scope: 'exact' as const,
          })),
          {
            path: absolute(path.join(root, '@mf-types/index.d.ts')),
            kind: 'file',
            scope: 'exact',
          },
        ],
        authoredPaths: (options.authored ?? []).map(absolute),
        protectedInputs: [],
      });
      registrations.push(registration);
      let plan: RendererGeneratedOutputPlan | undefined;
      let acknowledgements: RendererGeneratedOutputAcknowledgement[] = [];
      await options.begin?.();
      return {
        frame,
        ...(options.sourceNamespaces
          ? { sourceNamespaces: options.sourceNamespaces }
          : {}),
        beforeOperations(operations) {
          plan = plan
            ? assertRendererGeneratedOutputNextOperationsCurrent(
                registration,
                plan,
                acknowledgements,
                operations,
              )
            : assertRendererGeneratedOutputOperationsAllowed(
                registration,
                operations,
              );
          options.before?.(operations);
        },
        acknowledgeOperations(operations) {
          if (!plan) throw new Error('Native acknowledgement has no IO plan.');
          const next = [...acknowledgements, ...operations];
          assertRendererGeneratedOutputAcknowledgementProgress(
            registration,
            plan,
            next,
          );
          acknowledgements = next;
        },
        async terminal(result) {
          evidence.push(result);
          await options.terminal?.();
          if (result.status === 'failed') return;
          if (!plan && options.allowUnchanged) {
            expect(result.operations).toEqual([]);
            expect(result.nodes).toEqual([]);
            return;
          }
          if (!plan)
            throw new Error('This fixture expected genuine native IO.');
          const current = AdapterConstructor.observeReceiverNodes(
            registration,
            result.nodes,
          );
          receipts.push(
            validateRendererGeneratedOutputReceipt(
              registration,
              plan,
              {
                status: 'complete',
                registrationDigest: registration.registrationDigest,
                planDigest: plan.planDigest,
                generation: registration.generation,
                operations: result.operations,
              },
              current,
            ),
          );
        },
      };
    },
  });
  restores.push(restore);
  return { evidence, receipts, registrations };
}

describe('native receiver DTS IO', () => {
  it('preserves protected golden bytes and metadata on genuine unchanged native materialization', async () => {
    const app = await fixture();
    const initial = policy(app.root);
    await app.manager.consumeTypes();
    const originalNodes = initial.evidence[0]!.nodes.filter(
      node => node.kind !== 'missing',
    );
    const before = AdapterConstructor.observeReceiverNodes(
      { consumer: { projectRoot: app.root }, generation: seed },
      originalNodes,
    );
    restores.pop()!();
    const goldens = before.nodes
      .filter(node => node.kind === 'file')
      .map(node => node.path.lexical);
    const sink = policy(app.root, {
      authored: goldens,
      allowUnchanged: true,
    });
    await app.manager.consumeTypes();
    expect(app.requests.filter(url => url === '/types.zip')).toHaveLength(2);
    expect(app.requests.filter(url => url === '/api.d.ts')).toHaveLength(2);
    expect(sink.evidence).toHaveLength(1);
    expect(sink.evidence[0]!.status).toBe('complete');
    expect(sink.evidence[0]!.operations).toEqual([]);
    expect(sink.evidence[0]!.nodes).toEqual([]);
    expect(sink.receipts).toEqual([]);
    expect(
      AdapterConstructor.observeReceiverNodes(
        { consumer: { projectRoot: app.root }, generation: seed },
        before.nodes,
      ),
    ).toEqual(before);
  });

  it('rejects changed authentic archive content before touching protected goldens', async () => {
    const app = await fixture();
    const initial = policy(app.root);
    await app.manager.consumeTypes();
    const before = AdapterConstructor.observeReceiverNodes(
      { consumer: { projectRoot: app.root }, generation: seed },
      initial.evidence[0]!.nodes.filter(node => node.kind !== 'missing'),
    );
    restores.pop()!();
    const sink = policy(app.root, {
      authored: before.nodes
        .filter(node => node.kind === 'file')
        .map(node => node.path.lexical),
    });
    app.setArchive(
      zip([
        ['App.d.ts', 'export declare const App: number;\n'],
        ['compiled-types/src/page.d.ts', 'export type Page = string;\n'],
      ]),
    );
    await expect(app.manager.consumeTypes()).rejects.toThrow(
      'Native receiver DTS generation failed',
    );
    expect(sink.evidence[0]!.status).toBe('failed');
    expect(
      sink.evidence[0]!.failures.some(failure =>
        failure.reason.includes('authored or tracked input'),
      ),
    ).toBe(true);
    expect(sink.evidence[0]!.operations).toEqual([]);
    expect(sink.receipts).toEqual([]);
    expect(
      AdapterConstructor.observeReceiverNodes(
        { consumer: { projectRoot: app.root }, generation: seed },
        before.nodes,
      ),
    ).toEqual(before);
  });

  it('binds the actual public constructor and native package code closure', () => {
    const native = nativeRequire('@module-federation/dts-plugin/core') as {
      DTSManager: { prototype: unknown };
    };
    expect(Object.getPrototypeOf(AdapterConstructor.prototype)).toBe(
      native.DTSManager.prototype,
    );
    const owner = AdapterConstructor.nativeDtsOwner();
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(owner.packageDirectory, 'package.json'),
        'utf8',
      ),
    ) as { name: string; version: string };
    expect(owner.packageName).toBe(manifest.name);
    expect(owner.version).toBe(manifest.version);
    expect(owner.modulePath).toBe(fs.realpathSync(corePath));
    const modules = AdapterConstructor.nativeDtsModules();
    expect(modules.length).toBeGreaterThan(1);
    for (const module of modules)
      expect(module.moduleDigest).toBe(
        digest(fs.readFileSync(module.modulePath)),
      );
  });

  it('omits only optional undefined wire keys while native options retain defaults', async () => {
    const app = await fixture();
    Object.defineProperty(app.nativeOptions.host, 'ignoredUndefined', {
      value: undefined,
      enumerable: true,
    });
    const manager = new AdapterConstructor(
      AdapterConstructor.configureReceiverRegistration(app.nativeOptions, seed),
    );
    let capturedDetails: unknown;
    const sink = policy(app.root, {
      details: value => {
        capturedDetails = value;
      },
      terminal: async () => {
        expect(sink.evidence[0]!.failures).toEqual([]);
      },
    });
    await manager.consumeTypes();
    expect(manager.options.host).toHaveProperty('ignoredUndefined', undefined);
    expect(capturedDetails).not.toHaveProperty(
      'nativeOptions.host.ignoredUndefined',
    );
    expect(sink.receipts).toHaveLength(1);
  });

  it('receipts first-time native container creation and each exact causal parent effect', async () => {
    const app = await fixture({ seedStale: false });
    const configured = app.nativeOptions.host.remoteTypeUrls['private-remote']!;
    configured.alias = '@scope/remote';
    const manager = new AdapterConstructor(
      AdapterConstructor.configureReceiverRegistration(app.nativeOptions, seed),
    );
    const sink = policy(app.root, { aliases: ['@scope/remote'] });
    await manager.consumeTypes();
    expect(sink.receipts).toHaveLength(1);
    const receipt = sink.receipts[0]!;
    for (const parent of [
      app.root,
      path.join(app.root, '@mf-types'),
      path.join(app.root, '@mf-types/@scope'),
    ]) {
      expect(rendererGeneratedOutputPermission(receipt, parent)?.kind).toBe(
        'directory',
      );
      expect(receipt.operations).toContainEqual(
        expect.objectContaining({
          operation: 'write',
          kind: 'directory',
          before: expect.objectContaining({ path: absolute(parent) }),
          cause: expect.objectContaining({ operation: 'mkdirSync' }),
        }),
      );
    }
    expect(
      rendererGeneratedOutputPermission(
        receipt,
        path.join(app.root, '@mf-types/@scope/remote/App.d.ts'),
      )?.kind,
    ).toBe('file');
    expect(
      rendererGeneratedOutputPermission(
        receipt,
        path.join(app.root, 'unwritten-sibling'),
      ),
    ).toBeUndefined();
  });

  it('rejects an option accessor before registry binding or native IO without invoking it', async () => {
    const app = await fixture();
    let calls = 0;
    Object.defineProperty(app.manager.options, 'unsupportedAccessor', {
      enumerable: true,
      get() {
        calls++;
        return 'hidden';
      },
    });
    const sink = policy(app.root);
    await expect(app.manager.consumeTypes()).rejects.toThrow('accessors');
    expect(calls).toBe(0);
    expect(sink.evidence).toHaveLength(0);
    expect(
      fs.readFileSync(
        path.join(app.root, '@mf-types/remote/stale/nested/old.d.ts'),
        'utf8',
      ),
    ).toBe('old');
  });

  it('rejects update accessors before reading their values or opening a receiver frame', async () => {
    const app = await fixture();
    const update = {
      updateMode: 'PASSIVE',
      remoteName: 'private-remote',
      remoteTarPath: `${app.base}/types.zip`,
    };
    let calls = 0;
    Object.defineProperty(update, 'remoteName', {
      enumerable: true,
      get() {
        calls++;
        return 'private-remote';
      },
    });
    const sink = policy(app.root);
    await expect(app.manager.updateTypes(update)).rejects.toThrow('accessors');
    expect(calls).toBe(0);
    expect(sink.evidence).toHaveLength(0);
    expect(
      fs.readFileSync(
        path.join(app.root, '@mf-types/remote/stale/nested/old.d.ts'),
        'utf8',
      ),
    ).toBe('old');
  });

  it('preserves genuine native allSettled results and IO for two remotes', async () => {
    const app = await fixture();
    app.nativeOptions.host.remoteTypeUrls['private-remote-2'] = {
      alias: 'remote2',
      zip: `${app.base}/types.zip`,
      api: `${app.base}/api.d.ts`,
    };
    fs.mkdirSync(path.join(app.root, '@mf-types/remote2/stale'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(app.root, '@mf-types/remote2/stale/old.d.ts'),
      'old2',
    );
    const manager = new AdapterConstructor(
      AdapterConstructor.configureReceiverRegistration(app.nativeOptions, seed),
    );
    const sink = policy(app.root, { aliases: ['remote', 'remote2'] });
    await manager.consumeTypes();
    expect(sink.receipts).toHaveLength(1);
    expect(
      sink.evidence[0]!.stages.find(stage => stage.stage === 'archives')
        ?.result,
    ).toEqual({ settled: 2, completed: 2, failed: 0 });
    for (const remoteAlias of ['remote', 'remote2']) {
      expect(
        rendererGeneratedOutputPermission(
          sink.receipts[0]!,
          path.join(app.root, '@mf-types', remoteAlias, 'App.d.ts'),
        )?.kind,
      ).toBe('file');
      expect(
        fs.readFileSync(
          path.join(app.root, '@mf-types', remoteAlias, 'apis.d.ts'),
          'utf8',
        ),
      ).toContain(`${remoteAlias}/App`);
    }
    expect(
      fs.readFileSync(path.join(app.root, '@mf-types/index.d.ts'), 'utf8'),
    ).toContain('remote2');
  });

  it('awaits actual extraction, exact rm, ZIP fd writes, API/index, and terminal policy', async () => {
    const app = await fixture();
    let terminalFinished = false;
    const sink = policy(app.root, {
      terminal: async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        terminalFinished = true;
      },
    });
    const originalOpen = fs.openSync;
    const originalRemove = fsPromises.rm;
    const control = new Promise<void>(resolve =>
      setTimeout(() => {
        fs.writeFileSync(path.join(app.root, 'outside-als.txt'), 'outside');
        resolve();
      }, 0),
    );
    await app.manager.consumeTypes();
    await control;
    expect(terminalFinished).toBe(true);
    expect(fs.openSync).toBe(originalOpen);
    expect(fsPromises.rm).toBe(originalRemove);
    expect(sink.receipts).toHaveLength(1);
    const receipt = sink.receipts[0]!;
    expect(
      receipt.operations.some(
        operation =>
          operation.operation === 'delete' &&
          operation.before.path.lexical.endsWith('old.d.ts'),
      ),
    ).toBe(true);
    expect(
      receipt.operations.filter(
        operation =>
          operation.operation === 'write' &&
          operation.before.path.lexical.endsWith('/App.d.ts'),
      ).length,
    ).toBeGreaterThanOrEqual(4);
    for (const name of [
      'remote/App.d.ts',
      'remote/compiled-types/src/page.d.ts',
      'remote/apis.d.ts',
      'index.d.ts',
    ])
      expect(
        rendererGeneratedOutputPermission(
          receipt,
          path.join(app.root, '@mf-types', name),
        )?.kind,
      ).toBe('file');
    expect(
      rendererGeneratedOutputPermission(
        receipt,
        path.join(app.root, 'outside-als.txt'),
      ),
    ).toBeUndefined();
    expect(
      sink.evidence[0]!.stages.some(
        stage => stage.stage === 'api' && stage.result === false,
      ),
    ).toBe(true);
  });

  it('materializes a changed archive and preserves its unchanged index in a fresh update generation', async () => {
    const app = await fixture();
    const details: BeginDetails[] = [];
    const update = {
      updateMode: 'PASSIVE',
      remoteName: 'private-remote',
      remoteTarPath: `${app.base}/types.zip`,
    };
    const sink = policy(app.root, {
      details: value => {
        details.push(value);
        if (value.operation === 'updateTypes')
          update.remoteTarPath = `${app.base}/not-the-captured-request.zip`;
      },
    });
    await app.manager.consumeTypes();
    const apiDigest = digest(
      fs.readFileSync(path.join(app.root, '@mf-types/remote/apis.d.ts')),
    );
    const indexPath = path.join(app.root, '@mf-types/index.d.ts');
    const originalIndex = read(app.root, indexPath);
    app.setArchive(
      zip([
        ['App.d.ts', 'export declare const App: number;\n'],
        ['Widget.d.ts', 'export declare const Widget: boolean;\n'],
      ]),
    );
    await app.manager.updateTypes(update);
    expect(details[1]).toMatchObject({
      operation: 'updateTypes',
      remoteAlias: 'remote',
      update: {
        updateMode: 'PASSIVE',
        remoteName: 'private-remote',
        remoteTarPath: `${app.base}/types.zip`,
      },
    });
    expect(sink.receipts).toHaveLength(2);
    expect(sink.receipts[1]!.generation.generation).toBe(2);
    expect(
      sink.evidence[1]!.stages.some(
        stage => stage.stage === 'api' && stage.result === true,
      ),
    ).toBe(true);
    expect(
      sink.receipts[1]!.operations.some(
        operation =>
          operation.operation === 'write' &&
          operation.before.path.lexical ===
            path.join(app.root, '@mf-types/remote/apis.d.ts'),
      ),
    ).toBe(true);
    expect(
      sink.receipts[1]!.operations.some(
        operation =>
          operation.operation === 'write' &&
          operation.before.path.lexical === indexPath,
      ),
    ).toBe(false);
    expect(
      rendererGeneratedOutputPermission(sink.receipts[1]!, indexPath),
    ).toBeUndefined();
    expect(read(app.root, indexPath)).toEqual(originalIndex);
    expect(
      fs.readFileSync(path.join(app.root, '@mf-types/remote/App.d.ts'), 'utf8'),
    ).toBe('export declare const App: number;\n');
    expect(
      digest(
        fs.readFileSync(path.join(app.root, '@mf-types/remote/apis.d.ts')),
      ),
    ).toBe(apiDigest);
    expect(
      fs.existsSync(
        path.join(app.root, '@mf-types/remote/compiled-types/src/page.d.ts'),
      ),
    ).toBe(false);
  });

  it('preserves genuine dynamic update aliases, cached once no-op, and cached native output selection', async () => {
    const app = await fixture();
    const details: BeginDetails[] = [];
    const sink = policy(app.root, {
      aliases: ['@scope/dynamic'],
      details: value => details.push(value),
    });
    const update = {
      updateMode: 'PASSIVE',
      remoteName: 'dynamic-remote',
      remoteTarPath: '',
      remoteInfo: {
        name: 'dynamic-remote',
        alias: '@scope/dynamic',
        url: `${app.base}/entry.js`,
      },
      once: true,
    };
    await app.manager.updateTypes(update);
    expect(details[0]).toMatchObject({
      operation: 'updateTypes',
      remoteAlias: '@scope/dynamic',
      update,
    });
    expect(sink.receipts).toHaveLength(1);
    const originalReceipt = sink.receipts[0]!;
    const originalRegistration = sink.registrations[0]!;
    const appDeclaration = path.join(
      app.root,
      '@mf-types/@scope/dynamic/App.d.ts',
    );
    const originalApp = rendererGeneratedOutputPermission(
      originalReceipt,
      appDeclaration,
    );
    expect(originalApp?.kind).toBe('file');
    expect(
      app.requests.filter(request => request === '/@mf-types.zip'),
    ).toHaveLength(1);
    expect(
      fs.readFileSync(
        path.join(app.root, '@mf-types/@scope/dynamic/apis.d.ts'),
        'utf8',
      ),
    ).toContain('@scope/dynamic/App');
    const afterFirst = [...app.requests];
    await app.manager.updateTypes(update);
    expect(app.requests).toEqual(afterFirst);
    expect(sink.receipts).toHaveLength(1);
    expect(details).toHaveLength(1);
    await app.manager.updateTypes({
      ...update,
      once: false,
      remoteInfo: {
        ...update.remoteInfo,
        alias: '@scope/ignored-new-alias',
        url: `${app.base}/ignored-new-entry.js`,
      },
    });
    expect(details[1]?.remoteAlias).toBe('@scope/dynamic');
    expect(sink.receipts).toHaveLength(2);
    expect(
      app.requests.filter(request => request === '/@mf-types.zip'),
    ).toHaveLength(2);
    expect(
      fs.existsSync(path.join(app.root, '@mf-types/@scope/ignored-new-alias')),
    ).toBe(false);
    expect(
      rendererGeneratedOutputPermission(sink.receipts[1]!, appDeclaration),
    ).toBeUndefined();
    assertRendererGeneratedOutputReceiptNodesCurrent(
      originalRegistration,
      originalReceipt,
      AdapterConstructor.observeReceiverNodes(originalRegistration, [
        originalApp!,
      ]),
    );
    expect(
      rendererGeneratedOutputPermission(originalReceipt, appDeclaration),
    ).toBe(originalApp);
  });

  it.each([
    'alias',
    'zipUrl',
    'options',
  ] as const)('rejects changed native %s after BEGIN before delegation or IO', async mutation => {
    const app = await fixture();
    const sink = policy(app.root, {
      details: value => {
        if (value.operation !== 'updateTypes') return;
        if (mutation === 'options') app.manager.options.host.timeout++;
        else
          app.manager.remoteAliasMap.remote![mutation] =
            mutation === 'alias'
              ? 'changed-alias'
              : `${app.base}/changed-cache.zip`;
      },
    });
    await app.manager.consumeTypes();
    const requests = [...app.requests];
    const target = path.join(app.root, '@mf-types/remote/App.d.ts');
    const before = read(app.root, target);
    await expect(
      app.manager.updateTypes({
        updateMode: 'PASSIVE',
        remoteName: 'private-remote',
        remoteTarPath: `${app.base}/types.zip`,
      }),
    ).rejects.toThrow('Native receiver DTS generation failed');
    expect(app.requests).toEqual(requests);
    expect(read(app.root, target)).toEqual(before);
    expect(sink.receipts).toHaveLength(1);
    expect(sink.evidence).toHaveLength(2);
    expect(sink.evidence[1]!.status).toBe('failed');
    expect(sink.evidence[1]!.operations).toEqual([]);
    expect(
      sink.evidence[1]!.failures.some(item =>
        /changed while awaiting BEGIN/u.test(item.reason),
      ),
    ).toBe(true);
  });

  it('rejects a swallowed malformed ZIP before native deletion', async () => {
    const app = await fixture();
    const sink = policy(app.root);
    const before = [
      '@mf-types/remote',
      '@mf-types/remote/stale',
      '@mf-types/remote/stale/nested',
      '@mf-types/remote/stale/nested/old.d.ts',
    ].map(relative => read(app.root, path.join(app.root, relative)));
    app.setArchive(Buffer.from('not a ZIP archive'));
    await expect(app.manager.consumeTypes()).rejects.toThrow(
      'Native receiver DTS generation failed',
    );
    expect(sink.receipts).toHaveLength(0);
    expect(sink.evidence[0]!.status).toBe('failed');
    expect(
      sink.evidence[0]!.operations.some(
        operation => operation.operation === 'delete',
      ),
    ).toBe(false);
    expect(
      AdapterConstructor.observeReceiverNodes(
        { consumer: { projectRoot: app.root }, generation: seed },
        before,
      ).nodes,
    ).toEqual(before);
  });

  it('retains partial native writes without issuing a receipt', async () => {
    const app = await fixture({ deleteTypesFolder: false });
    fs.writeFileSync(
      path.join(app.root, '@mf-types/remote/z-blocked'),
      'blocking file',
    );
    app.setArchive(
      zip([
        ['a-good.d.ts', 'export declare const good: string;\n'],
        ['z-blocked/late.d.ts', 'export declare const late: string;\n'],
      ]),
    );
    const sink = policy(app.root);
    await expect(app.manager.consumeTypes()).rejects.toThrow(
      'Native receiver DTS generation failed',
    );
    expect(
      fs.readFileSync(
        path.join(app.root, '@mf-types/remote/a-good.d.ts'),
        'utf8',
      ),
    ).toContain('good');
    expect(
      sink.evidence[0]!.operations.some(operation =>
        operation.after.path.lexical.endsWith('a-good.d.ts'),
      ),
    ).toBe(true);
    expect(sink.evidence[0]!.failures.length).toBeGreaterThan(0);
    expect(sink.receipts).toHaveLength(0);
  });

  it('rejects a requested API failure that the native manager swallows', async () => {
    const app = await fixture();
    app.setAPIStatus(500);
    const sink = policy(app.root);
    const rejection: unknown = await app.manager.consumeTypes().then(
      () => undefined,
      error => error,
    );
    expect(rejection).toBeInstanceOf(AggregateError);
    if (!(rejection instanceof AggregateError))
      throw new Error('Expected the real native HTTP API failure.');
    const apiPath = path.join(app.root, '@mf-types/remote/apis.d.ts');
    const nativeReason = 'Request failed with status 500';
    expect(rejection.message).toContain(nativeReason);
    expect(rejection.message).toContain(JSON.stringify(apiPath));
    expect(
      rejection.errors.some(
        error => error instanceof Error && error.message === nativeReason,
      ),
    ).toBe(true);
    expect(sink.evidence).toHaveLength(1);
    expect(sink.evidence[0]!.status).toBe('failed');
    expect(sink.evidence[0]!.failures).toContainEqual({
      operation: 'api',
      reason: nativeReason,
      path: apiPath,
    });
    expect(
      sink.evidence[0]!.failures.find(item => item.operation === 'api'),
    ).not.toHaveProperty('code');
    expect(
      sink.evidence[0]!.stages.some(
        stage =>
          stage.stage === 'api' &&
          stage.requested &&
          stage.outcome === 'failed',
      ),
    ).toBe(true);
    expect(sink.receipts).toHaveLength(0);
  });

  it.each([
    '127.0.0.1',
    'localhost',
  ] as const)('retains a genuine native API %s connection-refused error and its target path', async apiHost => {
    const native = sourceRequire('@module-federation/dts-plugin/core') as {
      DTSManager: { prototype: { reportTypesApiError?: unknown } };
    };
    expect(AdapterConstructor.nativeDtsOwner().modulePath).toBe(
      fs.realpathSync(
        sourceRequire.resolve('@module-federation/dts-plugin/core'),
      ),
    );
    expect(Object.getPrototypeOf(AdapterConstructor.prototype)).toBe(
      native.DTSManager.prototype,
    );
    expect(typeof native.DTSManager.prototype.reportTypesApiError).toBe(
      'function',
    );
    const app = await fixture();
    const closedServer = http.createServer();
    await new Promise<void>(resolve =>
      closedServer.listen(0, '127.0.0.1', resolve),
    );
    try {
      const address = closedServer.address();
      if (!address || typeof address === 'string')
        throw new Error('The reserved API endpoint has no TCP address.');
      const apiUrl = `http://${apiHost}:${address.port}/api.d.ts`;
      await new Promise<void>((resolve, reject) =>
        closedServer.close(error => (error ? reject(error) : resolve())),
      );
      const nativeOptions: NativeOptions = {
        ...app.nativeOptions,
        host: {
          ...app.nativeOptions.host,
          remoteTypeUrls: {
            'private-remote': {
              ...app.nativeOptions.host.remoteTypeUrls['private-remote']!,
              api: apiUrl,
            },
          },
        },
      };
      const manager = new AdapterConstructor(
        AdapterConstructor.configureReceiverRegistration(nativeOptions, seed),
      );
      const sink = policy(app.root);
      const rejection: unknown = await manager.consumeTypes().then(
        () => undefined,
        error => error,
      );
      expect(rejection).toBeInstanceOf(AggregateError);
      if (!(rejection instanceof AggregateError))
        throw new Error('Expected the real native API connection failure.');
      const apiPath = path.join(app.root, '@mf-types/remote/apis.d.ts');
      const networkReason =
        apiHost === 'localhost'
          ? ''
          : `connect ECONNREFUSED 127.0.0.1:${address.port}`;
      expect(rejection.message).toContain('fetch failed');
      expect(rejection.message).toContain('ECONNREFUSED');
      expect(rejection.message).toContain(JSON.stringify(apiPath));
      expect(
        rejection.errors.some(
          error => error instanceof Error && error.message === 'fetch failed',
        ),
      ).toBe(true);
      expect(rejection.errors).toContainEqual(
        expect.objectContaining({
          operation: 'api',
          message: networkReason,
          code: 'ECONNREFUSED',
          path: apiPath,
        }),
      );
      expect(sink.evidence).toHaveLength(1);
      expect(sink.evidence[0]!.status).toBe('failed');
      expect(sink.evidence[0]!.failures).toContainEqual({
        operation: 'api',
        reason: 'fetch failed',
        path: apiPath,
      });
      expect(
        sink.evidence[0]!.failures.find(
          item => item.operation === 'api' && item.reason === 'fetch failed',
        ),
      ).not.toHaveProperty('code');
      expect(sink.evidence[0]!.failures).toContainEqual({
        operation: 'api',
        reason: networkReason,
        code: 'ECONNREFUSED',
        path: apiPath,
      });
      expect(
        sink.evidence[0]!.stages.some(
          stage =>
            stage.stage === 'api' &&
            stage.requested &&
            stage.outcome === 'failed',
        ),
      ).toBe(true);
      expect(app.requests.filter(url => url === '/types.zip')).toHaveLength(1);
      expect(
        fs.readFileSync(
          path.join(app.root, '@mf-types/remote/App.d.ts'),
          'utf8',
        ),
      ).toContain('export declare const App: string;');
      expect(fs.existsSync(apiPath)).toBe(false);
      expect(sink.receipts).toHaveLength(0);
    } finally {
      if (closedServer.listening)
        await new Promise<void>((resolve, reject) =>
          closedServer.close(error => (error ? reject(error) : resolve())),
        );
    }
  });

  it('accepts native undefined API result only when no API was requested', async () => {
    const app = await fixture({ api: false });
    const sink = policy(app.root);
    await app.manager.consumeTypes();
    expect(
      sink.evidence[0]!.stages.some(
        stage =>
          stage.stage === 'api' &&
          !stage.requested &&
          stage.outcome === 'skipped',
      ),
    ).toBe(true);
    expect(sink.receipts).toHaveLength(1);
  });

  it('blocks authored declaration deletion and replacement before native IO', async () => {
    const app = await fixture();
    const authored = path.join(app.root, '@mf-types/remote/App.d.ts');
    fs.writeFileSync(authored, 'authored declaration');
    const before = [
      '@mf-types/remote',
      '@mf-types/remote/App.d.ts',
      '@mf-types/remote/stale',
      '@mf-types/remote/stale/nested',
      '@mf-types/remote/stale/nested/old.d.ts',
    ].map(relative => read(app.root, path.join(app.root, relative)));
    const sink = policy(app.root, { authored: [authored] });
    await expect(app.manager.consumeTypes()).rejects.toThrow(
      'Native receiver DTS generation failed',
    );
    expect(fs.readFileSync(authored, 'utf8')).toBe('authored declaration');
    expect(
      fs.readFileSync(
        path.join(app.root, '@mf-types/remote/stale/nested/old.d.ts'),
        'utf8',
      ),
    ).toBe('old');
    expect(sink.receipts).toHaveLength(0);
    expect(sink.evidence).toHaveLength(1);
    expect(sink.evidence[0]!.status).toBe('failed');
    expect(sink.evidence[0]!.operations).toEqual([]);
    expect(
      sink.evidence[0]!.failures.some(failure =>
        failure.reason.includes('authored or tracked input'),
      ),
    ).toBe(true);
    expect(
      AdapterConstructor.observeReceiverNodes(
        { consumer: { projectRoot: app.root }, generation: seed },
        before,
      ).nodes,
    ).toEqual(before);
  });

  it('protects a new nongit source target created while receiver BEGIN is held', async () => {
    const app = await fixture({ seedStale: false });
    const alias = path.join(app.root, '@mf-types/remote');
    const authored = path.join(alias, 'authored.d.ts');
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    const released = new Promise<void>(resolve => {
      release = resolve;
    });
    const sink = policy(app.root, {
      sourceNamespaces: { entries: [], dirs: [absolute(alias)] },
      async begin() {
        started();
        await released;
      },
      details(details) {
        expect(details.receiverProcessId).toBe(process.pid);
      },
    });
    const pending = app.manager.consumeTypes();
    await entered;
    fs.mkdirSync(alias, { recursive: true });
    fs.writeFileSync(authored, 'export type Authored = "retained";\n');
    release();
    await expect(pending).rejects.toThrow(
      'Native receiver DTS generation failed',
    );
    expect(fs.readFileSync(authored, 'utf8')).toBe(
      'export type Authored = "retained";\n',
    );
    expect(sink.receipts).toHaveLength(0);
    expect(sink.evidence).toHaveLength(1);
    expect(sink.evidence[0]!.status).toBe('failed');
    expect(
      sink.evidence[0]!.failures.some(failure =>
        failure.reason.includes('unacknowledged authored source'),
      ),
    ).toBe(true);
    expect(
      sink.evidence[0]!.operations.some(
        operation =>
          operation.operation === 'delete' &&
          [alias, authored].includes(operation.before.path.lexical),
      ),
    ).toBe(false);
  });

  it('rejects symlink traversal before recursive removal or extraction', async () => {
    const app = await fixture();
    const target = path.join(app.root, 'authored');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep.d.ts'), 'keep');
    fs.symlinkSync(
      target,
      path.join(app.root, '@mf-types/remote/alias'),
      'dir',
    );
    const sink = policy(app.root);
    await expect(app.manager.consumeTypes()).rejects.toThrow(
      'Native receiver DTS generation failed',
    );
    expect(fs.readFileSync(path.join(target, 'keep.d.ts'), 'utf8')).toBe(
      'keep',
    );
    expect(
      sink.evidence[0]!.operations.some(
        operation => operation.operation === 'delete',
      ),
    ).toBe(false);
    expect(sink.receipts).toHaveLength(0);
  });

  it('checks live ancestor identity again after prewrite policy', async () => {
    const app = await fixture();
    const target = path.join(app.root, 'outside');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep.d.ts'), 'keep');
    let changed = false;
    const sink = policy(app.root, {
      before: () => {
        if (changed) return;
        changed = true;
        fs.renameSync(
          path.join(app.root, '@mf-types/remote'),
          path.join(app.root, '@mf-types/previous-remote'),
        );
        fs.symlinkSync(target, path.join(app.root, '@mf-types/remote'), 'dir');
      },
    });
    await expect(app.manager.consumeTypes()).rejects.toThrow(
      'Native receiver DTS generation failed',
    );
    expect(fs.readFileSync(path.join(target, 'keep.d.ts'), 'utf8')).toBe(
      'keep',
    );
    expect(sink.receipts).toHaveLength(0);
  });

  it('freshly observes receipt nodes and detects a later file replacement', async () => {
    const app = await fixture();
    const sink = policy(app.root);
    await app.manager.consumeTypes();
    const receipt = sink.receipts[0]!;
    const target = path.join(app.root, '@mf-types/remote/App.d.ts');
    const previous = receipt.nodes.find(node => node.path.lexical === target)!;
    fs.writeFileSync(target, 'later mutation');
    const current = read(app.root, target);
    expect(current).not.toEqual(previous);
    if (current.kind !== 'file')
      throw new Error('Native output is not a file.');
    expect(current.byteDigest).toBe(digest('later mutation'));
    const registration = sink.registrations[0]!;
    expect(() =>
      assertRendererGeneratedOutputReceiptCurrent(
        registration,
        receipt,
        AdapterConstructor.observeReceiverNodes(registration, receipt.nodes),
      ),
    ).toThrow();
  });

  it('cannot issue a success receipt when observer restoration fails', async () => {
    const app = await fixture();
    const originalWrite = fs.writeFileSync;
    let replaced = false;
    const sink = policy(app.root, {
      before: () => {
        if (replaced) return;
        replaced = true;
        const observedWrite = fs.writeFileSync;
        fs.writeFileSync = (file, data, options) =>
          observedWrite(file, data, options);
      },
    });
    try {
      await expect(app.manager.consumeTypes()).rejects.toThrow(
        'Native receiver DTS generation failed',
      );
      expect(sink.evidence[0]!.status).toBe('failed');
      expect(
        sink.evidence[0]!.failures.some(
          item => item.operation === 'restoreWrappers',
        ),
      ).toBe(true);
      expect(sink.receipts).toHaveLength(0);
    } finally {
      fs.writeFileSync = originalWrite;
    }
  });

  it('checks observer ownership before a terminal while another real receiver frame remains active', async () => {
    const app = await fixture();
    const originalWrite = fs.writeFileSync;
    let replaced = false;
    const sink = policy(app.root, {
      before: () => {
        if (replaced) return;
        replaced = true;
        const observedWrite = fs.writeFileSync;
        fs.writeFileSync = (file, data, options) =>
          observedWrite(file, data, options);
      },
    });
    const gate = app.holdNextArchive();
    const pending = app.manager.consumeTypes().then(
      () => undefined,
      error => error,
    );
    try {
      await gate.started;
      await expect(app.manager.consumeTypes()).rejects.toThrow(
        'Native receiver DTS generation failed',
      );
      expect(sink.evidence).toHaveLength(1);
      expect(
        sink.evidence[0]!.failures.some(
          item => item.operation === 'restoreWrappers',
        ),
      ).toBe(true);
      expect(sink.receipts).toHaveLength(0);
      gate.release();
      expect(await pending).toBeInstanceOf(AggregateError);
      expect(sink.evidence).toHaveLength(2);
      expect(sink.evidence.every(item => item.status === 'failed')).toBe(true);
    } finally {
      gate.release();
      await pending;
      fs.writeFileSync = originalWrite;
    }
  });

  it('sends failed terminal evidence even when native descriptor cleanup fails', async () => {
    const app = await fixture();
    const terminalError = new Error('terminal rejected the failed native IO');
    const sink = policy(app.root, {
      terminal: async () => {
        throw terminalError;
      },
    });
    const originalOpen = fs.openSync;
    const originalClose = fs.closeSync;
    let nativeDescriptor: number | undefined;
    let nativeDescriptorPath: string | undefined;
    let failedCloses = 0;
    const nativeReason = `injected native close failure ${'x'.repeat(100_000)} end-of-original-native-reason`;
    fs.openSync = (file, flags, mode) => {
      const fd = originalOpen(file, flags, mode);
      if (flags === 'w') {
        nativeDescriptor = fd;
        nativeDescriptorPath = String(file);
      }
      return fd;
    };
    fs.closeSync = fd => {
      if (fd === nativeDescriptor && failedCloses < 2) {
        failedCloses++;
        throw Object.assign(new Error(nativeReason), {
          code: 'EIO',
        });
      }
      originalClose(fd);
    };
    try {
      const rejection: unknown = await app.manager.consumeTypes().then(
        () => undefined,
        error => error,
      );
      expect(rejection).toBeInstanceOf(AggregateError);
      if (!(rejection instanceof AggregateError))
        throw new Error('Expected retained native IO and terminal errors.');
      expect(rejection.errors).toContain(terminalError);
      expect(
        rejection.errors.some(
          error =>
            error instanceof Error &&
            error.message.includes('injected native close failure'),
        ),
      ).toBe(true);
      expect(rejection.message).toContain(
        'Native receiver DTS generation failed',
      );
      expect(rejection.message).toContain('closeSync');
      expect(rejection.message).toContain('injected native close failure');
      expect(rejection.message).toContain('EIO');
      if (nativeDescriptorPath === undefined)
        throw new Error('Native extraction did not open its descriptor.');
      expect(rejection.message).toContain(JSON.stringify(nativeDescriptorPath));
      expect(rejection.message.length).toBeLessThan(nativeReason.length);
      expect(rejection.message).not.toContain('end-of-original-native-reason');
      expect(failedCloses).toBe(2);
      expect(sink.evidence).toHaveLength(1);
      expect(sink.evidence[0]!.status).toBe('failed');
      expect(sink.evidence[0]!.failures).toContainEqual({
        operation: 'closeSync',
        reason: nativeReason,
        path: nativeDescriptorPath,
        code: 'EIO',
      });
      expect(sink.receipts).toHaveLength(0);
    } finally {
      fs.openSync = originalOpen;
      fs.closeSync = originalClose;
      if (nativeDescriptor !== undefined) originalClose(nativeDescriptor);
    }
  });

  it('retains terminal rejection identity after successful genuine native IO', async () => {
    const app = await fixture();
    const terminalError = new Error('terminal rejected the complete native IO');
    const sink = policy(app.root, {
      terminal: async () => {
        throw terminalError;
      },
    });
    const rejection: unknown = await app.manager.consumeTypes().then(
      () => undefined,
      error => error,
    );
    expect(rejection).toBe(terminalError);
    expect(sink.evidence).toHaveLength(1);
    expect(sink.evidence[0]!.status).toBe('complete');
    expect(sink.evidence[0]!.failures).toEqual([]);
    expect(sink.evidence[0]!.operations.length).toBeGreaterThan(0);
    expect(sink.receipts).toHaveLength(0);
  });
});
