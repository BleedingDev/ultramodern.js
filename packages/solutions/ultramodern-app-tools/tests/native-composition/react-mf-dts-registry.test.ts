import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertRendererGeneratedOutputOperationsAllowed,
  immutableRendererGeneratedOutputRegistration,
  type RendererGeneratedOutputAcknowledgement,
  type RendererGeneratedOutputCurrentNodes,
  type RendererGeneratedOutputNode,
  type RendererGeneratedOutputReceipt,
  type RendererGeneratedOutputRegistration,
  type RendererGeneratedOutputRegistrationInput,
  rendererGeneratedOutputPermission,
} from '@modern-js/app-tools-extensions/renderer-generated-outputs';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  createReceiverBridgeRegistry,
  createReceiverRegistry,
  type ReceiverBridge,
  type ReceiverContext,
  type ReceiverFrame,
  type ReceiverGraphEpoch,
  type ReceiverRegistry,
  type ReceiverSeed,
  type ReceiverSourceNamespaces,
  type ReceiverTerminalEvidence,
  type SelectedReceiverReceipt,
} from '../../src/native-composition/react-mf-dts-registry';

const roots: string[] = [];
const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closes.splice(0).map(close => close()));
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

const digest = (input: string | Buffer) =>
  createHash('sha256').update(input).digest('hex');

function node(file: string): RendererGeneratedOutputNode {
  const lexical = path.resolve(file);
  let canonical = lexical;
  try {
    canonical = fs.realpathSync.native(lexical);
  } catch {
    let ancestor = path.dirname(lexical);
    const segments = [path.basename(lexical)];
    while (!fs.existsSync(ancestor)) {
      segments.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
    canonical = path.join(fs.realpathSync.native(ancestor), ...segments);
  }
  const destination = { lexical, canonical };
  if (!fs.existsSync(lexical)) return { path: destination, kind: 'missing' };
  const stat = fs.statSync(lexical, { bigint: true });
  const metadata = {
    device: String(stat.dev),
    inode: String(stat.ino),
    mode: String(stat.mode),
    size: String(stat.size),
  };
  if (stat.isFile())
    return {
      path: destination,
      kind: 'file',
      byteDigest: digest(fs.readFileSync(lexical)),
      metadata,
    };
  return {
    path: destination,
    kind: 'directory',
    metadata,
    entries: fs.readdirSync(lexical, { withFileTypes: true }).map(entry => ({
      name: entry.name,
      kind: entry.isSymbolicLink()
        ? ('symlink' as const)
        : entry.isDirectory()
          ? ('directory' as const)
          : ('file' as const),
    })),
  };
}

function fixture(
  options: {
    prepare?: (
      input: RendererGeneratedOutputRegistrationInput,
      priorReceipts: readonly SelectedReceiverReceipt[],
    ) => Promise<RendererGeneratedOutputRegistrationInput>;
    graph?: boolean;
    sourceNamespaces?: (
      registration: RendererGeneratedOutputRegistration,
    ) => ReceiverSourceNamespaces;
    usePreparedGeneration?: boolean;
    started?: (
      registration: RendererGeneratedOutputRegistration,
      frame: ReceiverFrame,
    ) => void | Promise<void>;
    completed?: (
      registration: RendererGeneratedOutputRegistration,
      receipt: RendererGeneratedOutputReceipt,
      frame: ReceiverFrame,
    ) => void | Promise<void>;
  } = {},
) {
  const root = fs.mkdtempSync(
    path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'receiver-registry-'),
  );
  roots.push(root);
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'types'));
  const authored = path.join(root, 'src', 'authored.ts');
  const modulePath = path.join(root, 'receiver.cjs');
  const destination = path.join(root, 'types', 'remote.d.ts');
  fs.writeFileSync(authored, 'export const authored = true;\n');
  fs.writeFileSync(modulePath, 'module.exports = {};\n');
  const seed: ReceiverSeed = {
    schemaVersion: 1,
    registrationId: 'receiver-registration',
    operationId: 'build-operation',
    compilerId: 'native-compiler',
    generation: 1,
    revision: 'configuration-revision-1',
  };
  const secondSeed: ReceiverSeed = {
    ...seed,
    compilerId: 'second-web-compiler',
    registrationId: 'second-web-registration',
  };
  const graph = {
    authority: Object.freeze({ host: 'graph-authority' }),
    cohort: Object.freeze({ native: 'receiver-cohort' }),
    members: [seed, secondSeed].map(member => ({
      compilerId: member.compilerId,
      registrationId: member.registrationId,
    })),
  };
  let graphEpoch: ReceiverGraphEpoch = {
    authority: graph.authority,
    cohort: graph.cohort,
    operationId: 'build-operation',
    generation: 1,
    revision: 'shared-graph-revision',
  };
  const completed: {
    registration: RendererGeneratedOutputRegistration;
    receipt: RendererGeneratedOutputReceipt;
  }[] = [];
  const failures: Error[] = [];
  const starts: string[] = [];
  let observeCalls = 0;
  let preparedGeneration = 1;
  let registrationOverride: Partial<RendererGeneratedOutputRegistrationInput> =
    {};
  function input(value = seed): RendererGeneratedOutputRegistrationInput {
    return {
      schemaVersion: 1,
      id: value.registrationId,
      pathFlavor: 'posix',
      producer: {
        packageName: '@module-federation/dts-plugin',
        version: '0.23.0',
        packageDirectory: root,
        modulePath,
        moduleDigest: digest(fs.readFileSync(modulePath)),
      },
      consumer: { id: 'native-host', projectRoot: root },
      generation: {
        operationId: value.operationId,
        compilerId: value.compilerId,
        generation: options.usePreparedGeneration
          ? preparedGeneration
          : value.generation,
        revision: value.revision,
      },
      effectiveOptions: { consumeTypes: true },
      context: { operation: 'consumeTypes' },
      destinations: [
        { path: node(destination).path, kind: 'file', scope: 'exact' },
      ],
      authoredPaths: [node(authored).path],
      protectedInputs: [
        { observation: 'content', node: node(authored) },
        { observation: 'module', node: node(modulePath) },
      ],
      ...registrationOverride,
    };
  }
  const registry = createReceiverRegistry({
    usePreparedGeneration: options.usePreparedGeneration,
    ...(options.graph ? { graphEpoch: () => graphEpoch } : {}),
    ...(options.sourceNamespaces
      ? { sourceNamespaces: options.sourceNamespaces }
      : {}),
    async prepareRegistration(value, _details, priorReceipts) {
      const registration = input(value);
      return options.prepare
        ? options.prepare(registration, priorReceipts)
        : registration;
    },
    assertActive() {},
    async observeCurrent(registration, expected) {
      observeCalls++;
      return {
        generation: registration.generation,
        nodes: expected.map(snapshot => node(snapshot.path.lexical)),
      };
    },
    onStarted(_registration, frame) {
      starts.push(frame.frameId);
      return options.started?.(_registration, frame);
    },
    onCompleted(registration, receipt, frame) {
      completed.push({ registration, receipt });
      return options.completed?.(registration, receipt, frame);
    },
    onFailed(_frame, error) {
      failures.push(error);
    },
  });
  closes.push(() => registry.dispose());
  return {
    root,
    authored,
    destination,
    modulePath,
    seed,
    secondSeed,
    graph,
    input,
    registry,
    completed,
    failures,
    starts,
    setRegistration(value: Partial<RendererGeneratedOutputRegistrationInput>) {
      registrationOverride = value;
    },
    setPreparedGeneration(value: number) {
      preparedGeneration = value;
    },
    setGraphEpoch(value: Partial<ReceiverGraphEpoch>) {
      graphEpoch = { ...graphEpoch, ...value };
    },
    observeCalls: () => observeCalls,
    current(
      receipt: RendererGeneratedOutputReceipt,
    ): RendererGeneratedOutputCurrentNodes {
      return {
        generation: receipt.generation,
        nodes: receipt.nodes.map(snapshot => node(snapshot.path.lexical)),
      };
    },
  };
}

const details = {
  operation: 'consumeTypes' as const,
  nativeOptions: { consumeTypes: true },
  receiverProcessId: process.pid,
};

function ownedBridgeWorker() {
  const worker = spawn(
    process.execPath,
    [
      '-e',
      `
    const { randomBytes } = require('node:crypto');
    const beginId = randomBytes(16).toString('hex');
    let input, frame;
    async function post(body) {
      return fetch(input.bridge.url, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + input.bridge.token, 'content-type': 'application/json' },
        body: JSON.stringify({ beginId, ...body }),
      });
    }
    process.on('message', async message => {
      try {
        if (message.action === 'begin') {
          input = message;
          const response = await post({ action: 'begin', seed: input.seed,
            details: { ...input.details, receiverProcessId: process.pid } });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'BEGIN rejected');
          frame = result.frame;
          process.send({ frame });
        } else if (message.action === 'terminal') {
          const response = await post({ action: 'terminal', frame,
            evidence: { status: 'failed', frame, operations: [], nodes: [], stages: [], failures: [] }, events: [] });
          process.send({ status: response.status });
        }
      } catch (error) { process.send({ error: error.message }); }
    });
  `,
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  worker.stderr?.resume();
  let launchError: Error | undefined;
  worker.on('error', error => {
    launchError = error;
  });
  const closed = new Promise<void>(resolve =>
    worker.once('close', () => resolve()),
  );
  const witness = Object.freeze({ pid: worker.pid!, closed });
  async function stop() {
    if (worker.exitCode === null && worker.signalCode === null)
      worker.kill('SIGTERM');
    await closed;
  }
  closes.push(stop);
  function request(
    input: object,
  ): Promise<{ frame?: ReceiverFrame; status?: number }> {
    if (launchError) return Promise.reject(launchError);
    if (worker.exitCode !== null || worker.signalCode !== null)
      return Promise.reject(new Error('Owned receiver child already exited.'));
    return new Promise((resolve, reject) => {
      function cleanup() {
        worker.off('message', received);
        worker.off('error', failed);
        worker.off('close', exited);
      }
      function received(message: unknown) {
        cleanup();
        const result = message as {
          frame?: ReceiverFrame;
          status?: number;
          error?: string;
        };
        if (result.error) reject(new Error(result.error));
        else resolve(result);
      }
      function failed(error: Error) {
        cleanup();
        reject(error);
      }
      function exited() {
        failed(new Error('Owned receiver child exited before responding.'));
      }
      worker.once('message', received);
      worker.once('error', failed);
      worker.once('close', exited);
      worker.send(input, error => {
        if (error) failed(error);
      });
    });
  }
  return {
    witness,
    stop,
    async begin(bridge: ReceiverBridge, seed: ReceiverSeed) {
      return (await request({ action: 'begin', bridge, seed, details })).frame!;
    },
    async terminal() {
      return (await request({ action: 'terminal' })).status!;
    },
  };
}

function write(
  context: ReceiverContext,
  destination: string,
  bytes = 'export type Remote = string;\n',
): RendererGeneratedOutputAcknowledgement {
  const operation = {
    operation: 'write' as const,
    kind: 'file' as const,
    before: node(destination),
  };
  context.beforeOperations([operation]);
  fs.writeFileSync(destination, bytes);
  const acknowledgement = { ...operation, after: node(destination) };
  context.acknowledgeOperations([acknowledgement]);
  return acknowledgement;
}

function terminal(
  context: ReceiverContext,
  operations: readonly RendererGeneratedOutputAcknowledgement[],
): ReceiverTerminalEvidence {
  return {
    status: 'complete',
    frame: context.frame,
    operations,
    nodes: operations.map(operation => node(operation.after.path.lexical)),
    stages: [
      {
        stage: 'api',
        alias: 'remote',
        requested: true,
        outcome: 'complete',
        result: false,
      },
    ],
    failures: [],
  };
}

async function completed(
  f: ReturnType<typeof fixture>,
  registry: Pick<ReceiverRegistry, 'begin'> = f.registry,
) {
  const context = await registry.begin(f.seed, details);
  const operation = write(context, f.destination);
  await context.terminal(terminal(context, [operation]));
  return { context, operation, ...f.completed.at(-1)! };
}

function observations(f: ReturnType<typeof fixture>) {
  return f.registry.completedReceipts().map(record => ({
    receipt: record.receipt,
    selectedNodes: record.selectedNodes,
    current: {
      generation: record.receipt.generation,
      nodes: record.selectedNodes.map(snapshot => node(snapshot.path.lexical)),
    },
  }));
}

async function twoRemotes(
  f: ReturnType<typeof fixture>,
  includeDirectory = false,
) {
  const second = path.join(f.root, 'types', 'second.d.ts');
  const directory = path.dirname(f.destination);
  f.setRegistration({
    destinations: [
      { path: node(directory).path, kind: 'directory', scope: 'subtree' },
    ],
  });
  const context = await f.registry.begin(f.seed, details);
  const operations: RendererGeneratedOutputAcknowledgement[] = [];
  if (includeDirectory) {
    const operation = {
      operation: 'write' as const,
      kind: 'directory' as const,
      before: node(directory),
    };
    context.beforeOperations([operation]);
    fs.mkdirSync(directory, { recursive: true });
    const acknowledgement = { ...operation, after: node(directory) };
    context.acknowledgeOperations([acknowledgement]);
    operations.push(acknowledgement);
  }
  operations.push(write(context, f.destination, 'first remote\n'));
  operations.push(write(context, second, 'second remote\n'));
  await context.terminal(terminal(context, operations));
  return { second, context, receipt: f.completed.at(-1)!.receipt };
}

describe('native receiver DTS registry', () => {
  it('issues the host-branded exact receipt only after fresh owner observations', async () => {
    const f = fixture();
    const result = await completed(f);
    expect(f.observeCalls()).toBe(2);
    expect(f.starts).toEqual([result.context.frame.frameId]);
    expect(
      f.registry.permission(
        result.receipt,
        f.destination,
        f.current(result.receipt),
      )?.kind,
    ).toBe('file');
    expect(
      f.registry.permission(
        result.receipt,
        `${f.destination}/unacknowledged`,
        f.current(result.receipt),
      ),
    ).toBeUndefined();
    expect(() =>
      rendererGeneratedOutputPermission(
        JSON.parse(JSON.stringify(result.receipt)),
        f.destination,
      ),
    ).toThrow('validated');
    expect(() =>
      f.registry.assertReceiptCurrent(
        JSON.parse(JSON.stringify(result.receipt)),
        f.current(result.receipt),
      ),
    ).toThrow('owned');
    await f.registry.waitForIdle();
    expect(f.registry.completedReceipts()[0]?.receipt).toBe(result.receipt);
  });

  it('rejects authored lexical, canonical and physical inode collisions before IO', async () => {
    for (const collision of ['lexical', 'canonical', 'inode'] as const) {
      const f = fixture();
      let target = f.destination;
      if (collision === 'lexical') target = f.authored;
      if (collision === 'canonical') fs.symlinkSync(f.authored, target);
      if (collision === 'inode') fs.linkSync(f.authored, target);
      f.setRegistration({
        destinations: [
          { path: node(target).path, kind: 'file', scope: 'exact' },
        ],
      });
      const context = await f.registry.begin(f.seed, details);
      expect(() =>
        context.beforeOperations([
          { operation: 'write', kind: 'file', before: node(target) },
        ]),
      ).toThrow(/input|authored/u);
      expect(fs.readFileSync(f.authored, 'utf8')).toBe(
        'export const authored = true;\n',
      );
      expect(f.completed).toHaveLength(0);
    }
  });

  it('rejects a changed repeated node before another write', async () => {
    const f = fixture();
    const context = await f.registry.begin(f.seed, details);
    write(context, f.destination);
    fs.writeFileSync(f.destination, 'external edit\n');
    expect(() =>
      context.beforeOperations([
        { operation: 'write', kind: 'file', before: node(f.destination) },
      ]),
    ).toThrow(/changed|discontinuous|continuity/u);
    expect(fs.readFileSync(f.destination, 'utf8')).toBe('external edit\n');
  });

  it('rejects a partial terminal and revokes every receipt in the failed generation', async () => {
    const f = fixture();
    const prior = await completed(f);
    const context = await f.registry.begin(f.seed, details);
    write(context, f.destination, 'new type\n');
    await expect(context.terminal(terminal(context, []))).rejects.toThrow(
      'acknowledgements',
    );
    expect(() =>
      f.registry.assertReceiptCurrent(prior.receipt, f.current(prior.receipt)),
    ).toThrow('acknowledgements');
    await expect(f.registry.waitForIdle()).rejects.toThrow('acknowledgements');
  });

  it('rejects reordered acknowledgements immediately', async () => {
    const f = fixture();
    const second = path.join(f.root, 'types', 'second.d.ts');
    f.setRegistration({
      destinations: [
        {
          path: node(path.dirname(f.destination)).path,
          kind: 'directory',
          scope: 'subtree',
        },
      ],
    });
    const context = await f.registry.begin(f.seed, details);
    const firstOperation = {
      operation: 'write' as const,
      kind: 'file' as const,
      before: node(f.destination),
    };
    const secondOperation = {
      operation: 'write' as const,
      kind: 'file' as const,
      before: node(second),
    };
    context.beforeOperations([firstOperation, secondOperation]);
    fs.writeFileSync(second, 'second\n');
    expect(() =>
      context.acknowledgeOperations([
        { ...secondOperation, after: node(second) },
      ]),
    ).toThrow('reordered');
  });

  it('rejects undefined requested API outcomes and failed settled archive stages', async () => {
    for (const stage of [
      {
        stage: 'api' as const,
        alias: 'remote',
        requested: true,
        outcome: 'complete' as const,
        result: 'undefined',
      },
      {
        stage: 'archives' as const,
        outcome: 'complete' as const,
        result: { settled: 1, completed: 0, failed: 1 },
      },
    ]) {
      const f = fixture();
      const context = await f.registry.begin(f.seed, details);
      const operation = write(context, f.destination);
      await expect(
        context.terminal({
          ...terminal(context, [operation]),
          stages: [stage],
        }),
      ).rejects.toThrow(/did not complete/u);
      expect(f.completed).toHaveLength(0);
    }
  });

  it('rejects child final snapshots whose physical bytes changed before host observation', async () => {
    const f = fixture();
    const context = await f.registry.begin(f.seed, details);
    const operation = write(context, f.destination);
    const evidence = terminal(context, [operation]);
    fs.writeFileSync(f.destination, 'changed after child snapshot\n');
    await expect(context.terminal(evidence)).rejects.toThrow('changed');
    expect(f.observeCalls()).toBe(1);
    expect(f.completed).toHaveLength(0);
  });

  it('consumes terminal once and rejects cross-frame replay', async () => {
    const f = fixture();
    const context = await f.registry.begin(f.seed, details);
    const other = await f.registry.begin(f.seed, details);
    expect(context.frame.frameId).not.toBe(other.frame.frameId);
    await expect(
      context.terminal({ ...terminal(context, []), frame: other.frame }),
    ).rejects.toThrow('another frame');
    await expect(context.terminal(terminal(context, []))).rejects.toThrow(
      /unknown|late|terminal/u,
    );
    expect(f.completed).toHaveLength(0);
  });

  it('invalidates a pinned revision before a second operation can write', async () => {
    const f = fixture();
    const prior = await completed(f);
    const observation = {
      receipt: prior.receipt,
      current: f.current(prior.receipt),
    };
    const lease = f.registry.pinReceipts([observation]);
    lease.assertEpochCurrent();
    expect(lease.permission(f.destination)?.kind).toBe('file');
    const beginning = f.registry.begin(f.seed, details);
    expect(() => lease.assertEpochCurrent()).toThrow('changed');
    expect(() => lease.permission(f.destination)).toThrow('changed');
    expect(() => f.registry.pinReceipts([observation])).toThrow('unfinished');
    const context = await beginning;
    const operation = write(context, f.destination, 'second completion\n');
    await context.terminal(terminal(context, [operation]));
    expect(() => lease.assertCurrent([observation])).toThrow('changed');
    const receipt = f.completed.at(-1)!.receipt;
    const current = f.current(receipt);
    const fresh = f.registry.pinReceipts([{ receipt, current }]);
    fresh.assertEpochCurrent();
    fresh.assertCurrent([{ receipt, current }]);
    fresh.release();
    expect(() => fresh.assertEpochCurrent()).toThrow('released');
    expect(() => fresh.permission(f.destination)).toThrow('released');
  });

  it('supports a trusted host prepared epoch and revokes the prior generation', async () => {
    const f = fixture({ usePreparedGeneration: true });
    const prior = await completed(f);
    f.setPreparedGeneration(2);
    const next = await f.registry.begin(f.seed, details);
    expect(next.frame.generation).toBe(2);
    const operation = write(next, f.destination, 'new generation\n');
    await next.terminal(terminal(next, [operation]));
    expect(() =>
      f.registry.assertReceiptCurrent(prior.receipt, f.current(prior.receipt)),
    ).toThrow('owned');
    f.registry.closeGeneration(next.frame);
    expect(f.registry.completedReceipts()).toHaveLength(0);
    await expect(f.registry.begin(f.seed, details)).rejects.toThrow('closed');
  });

  it('keeps strict seed generations and prevents disposal races during prepare', async () => {
    let finish!: (input: RendererGeneratedOutputRegistrationInput) => void;
    let captured!: RendererGeneratedOutputRegistrationInput;
    const f = fixture({
      prepare: input =>
        new Promise(resolve => {
          captured = input;
          finish = resolve;
        }),
    });
    const beginning = f.registry.begin(f.seed, details);
    await f.registry.dispose();
    finish(captured);
    await expect(beginning).rejects.toThrow('disposed');
    expect(f.completed).toHaveLength(0);
    expect(f.failures).toHaveLength(1);
    const strict = fixture({
      prepare: async input => ({
        ...input,
        generation: { ...input.generation, generation: 2 },
      }),
    });
    await expect(strict.registry.begin(strict.seed, details)).rejects.toThrow(
      'owning generation',
    );
  });

  it('waits through all active terminals and allows a genuine no-op to grant no permission', async () => {
    const f = fixture();
    const first = await f.registry.begin(f.seed, details);
    const second = await f.registry.begin(f.seed, details);
    let idle = false;
    const waiting = f.registry.waitForIdle().then(() => {
      idle = true;
    });
    await first.terminal({ ...terminal(first, []), stages: [] });
    expect(idle).toBe(false);
    await second.terminal({ ...terminal(second, []), stages: [] });
    await waiting;
    expect(f.completed).toHaveLength(2);
    const receipt = f.completed[0]!.receipt;
    expect(
      f.registry.permission(receipt, f.destination, f.current(receipt)),
    ).toBeUndefined();
  });

  it.each([
    'direct',
    'bridge',
  ] as const)('retains same-live-epoch cached %s ownership through an empty completion without new acknowledgements', async transport => {
    const f = fixture({ graph: true });
    f.registry.sealReceiverGraph(f.graph);
    const receiver =
      transport === 'bridge'
        ? createReceiverBridgeRegistry(await f.registry.openBridge())
        : f.registry;
    if (transport === 'bridge') closes.push(() => receiver.dispose());
    const first = await completed(f, receiver);
    const original = rendererGeneratedOutputPermission(
      first.receipt,
      f.destination,
    )!;
    const before = node(f.destination);
    const context = await receiver.begin(f.seed, details);
    expect(context.inheritedNodes).toEqual([original]);
    await context.terminal({ ...terminal(context, []), stages: [] });
    expect(node(f.destination)).toEqual(before);
    const records = f.registry.completedReceipts();
    expect(records).toHaveLength(2);
    expect(records[0]!.receipt).toBe(first.receipt);
    expect(records[0]!.selectedNodes).toEqual([original]);
    const latest = records[1]!.receipt;
    expect(latest.generation).toEqual(first.receipt.generation);
    expect(latest.nodes).toEqual([]);
    expect(latest.operations).toEqual([]);
    expect(
      rendererGeneratedOutputPermission(latest, f.destination),
    ).toBeUndefined();
    const current = observations(f);
    const lease = f.registry.pinReceipts(current);
    lease.assertCurrent(current);
    expect(lease.permission(f.destination)).toBe(original);
    expect(
      lease.permission(path.join(path.dirname(f.destination), 'other.d.ts')),
    ).toBeUndefined();
    lease.release();
  });

  it.each([
    'direct',
    'bridge',
  ] as const)('rejects same-live-epoch cached %s byte or metadata drift before admission and fresh pinning', async transport => {
    for (const drift of ['bytes', 'metadata'] as const) {
      for (const checkpoint of ['admission', 'pin'] as const) {
        const f = fixture({ graph: true });
        f.registry.sealReceiverGraph(f.graph);
        const receiver =
          transport === 'bridge'
            ? createReceiverBridgeRegistry(await f.registry.openBridge())
            : f.registry;
        if (transport === 'bridge') closes.push(() => receiver.dispose());
        const first = await completed(f, receiver);
        if (checkpoint === 'pin') {
          const context = await receiver.begin(f.seed, details);
          await context.terminal({ ...terminal(context, []), stages: [] });
        }
        const original = node(f.destination);
        if (drift === 'bytes')
          fs.writeFileSync(f.destination, 'external cached declaration\n');
        else fs.chmodSync(f.destination, 0o600);
        const changed = node(f.destination);
        if (original.kind !== 'file' || changed.kind !== 'file')
          throw new Error('Cached declaration must remain a file.');
        expect(changed).not.toEqual(original);
        if (drift === 'metadata') {
          expect(changed.byteDigest).toBe(original.byteDigest);
          expect(changed.metadata.mode).not.toBe(original.metadata.mode);
        }
        if (checkpoint === 'admission') {
          await expect(receiver.begin(f.seed, details)).rejects.toThrow(
            transport === 'bridge'
              ? 'Receiver DTS bridge rejected the operation (400).'
              : /changed|unchanged exact member/u,
          );
          expect(f.failures.at(-1)?.message).toMatch(
            /changed|unchanged exact member/u,
          );
        } else
          expect(() => f.registry.pinReceipts(observations(f))).toThrow(
            /changed|unchanged exact member/u,
          );
        expect(node(f.destination)).toEqual(changed);
        expect(
          rendererGeneratedOutputPermission(first.receipt, f.destination),
        ).toEqual(original);
      }
    }
  });

  it('replays real loopback child pre-write evidence into a host-owned receipt', async () => {
    const f = fixture();
    const bridge = await f.registry.openBridge();
    expect(new URL(bridge.url).hostname).toBe('127.0.0.1');
    const child = createReceiverBridgeRegistry(bridge);
    closes.push(() => child.dispose());
    const result = await completed(f, child);
    expect(
      f.registry.permission(
        result.receipt,
        f.destination,
        f.current(result.receipt),
      )?.kind,
    ).toBe('file');
    expect(f.observeCalls()).toBe(2);
    await expect(
      result.context.terminal(terminal(result.context, [result.operation])),
    ).rejects.toThrow('terminal');
    await f.registry.dispose();
    expect(() =>
      f.registry.assertReceiptCurrent(
        result.receipt,
        f.current(result.receipt),
      ),
    ).toThrow('owned');
    await expect(fetch(bridge.url)).rejects.toThrow();
  });

  it('rejects wrong capabilities, terminal replay and missing pre-write provenance over TCP', async () => {
    const f = fixture();
    const bridge = await f.registry.openBridge();
    const send = (body: unknown, token = bridge.token) =>
      fetch(bridge.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ beginId: '9'.repeat(32), ...(body as object) }),
      });
    expect(
      (await send({ action: 'begin', seed: f.seed, details }, '0'.repeat(64)))
        .status,
    ).toBe(401);
    expect(f.starts).toHaveLength(0);
    const beginResponse = await send({
      action: 'begin',
      seed: f.seed,
      details,
    });
    const response = (await beginResponse.json()) as {
      frame: ReceiverContext['frame'];
      registration: RendererGeneratedOutputRegistrationInput;
    };
    const registration = immutableRendererGeneratedOutputRegistration(
      response.registration,
    );
    const operation = {
      operation: 'write' as const,
      kind: 'file' as const,
      before: node(f.destination),
    };
    const plan = assertRendererGeneratedOutputOperationsAllowed(registration, [
      operation,
    ]);
    fs.writeFileSync(f.destination, 'untrusted missing provenance\n');
    const acknowledgement = { ...operation, after: node(f.destination) };
    const evidence = {
      status: 'complete',
      frame: response.frame,
      operations: [acknowledgement],
      nodes: [acknowledgement.after],
      stages: [
        { stage: 'api', requested: true, outcome: 'complete', result: true },
      ],
      failures: [],
    };
    const rejected = await send({
      action: 'terminal',
      frame: response.frame,
      evidence,
      events: [
        {
          event: 'before',
          sequence: 0,
          operations: [operation],
          planDigest: plan.planDigest,
        },
      ],
    });
    expect(rejected.status).toBe(400);
    expect(f.completed).toHaveLength(0);
    expect(
      (
        await send({
          action: 'terminal',
          frame: response.frame,
          evidence,
          events: [],
        })
      ).status,
    ).toBe(400);
  });

  it('rejects non-loopback transports and closes its owned listener idempotently', async () => {
    expect(() =>
      createReceiverBridgeRegistry({
        schemaVersion: 1,
        url: 'https://example.com/receiver-dts',
        token: '1'.repeat(64),
      }),
    ).toThrow('loopback');
    const f = fixture();
    const bridge = await f.registry.openBridge();
    const context = await f.registry.begin(f.seed, details);
    await Promise.all([f.registry.dispose(), f.registry.dispose()]);
    expect(f.failures).toHaveLength(1);
    expect(() =>
      context.beforeOperations([
        { operation: 'write', kind: 'file', before: node(f.destination) },
      ]),
    ).toThrow('disposed');
    await expect(context.terminal(terminal(context, []))).rejects.toThrow(
      /unknown|late/u,
    );
    await expect(f.registry.openBridge()).rejects.toThrow('disposed');
    await expect(fetch(bridge.url)).rejects.toThrow();
  });

  it('aborts the host frame when local child terminal evidence is malformed', async () => {
    const f = fixture();
    const child = createReceiverBridgeRegistry(await f.registry.openBridge());
    closes.push(() => child.dispose());
    const context = await child.begin(f.seed, details);
    const operation = write(context, f.destination);
    await expect(
      context.terminal({
        ...terminal(context, [operation]),
        frame: { ...context.frame, frameId: '0'.repeat(32) },
      }),
    ).rejects.toThrow('another frame');
    await expect(f.registry.waitForIdle()).rejects.toThrow('did not complete');
    expect(f.completed).toHaveLength(0);
    expect(f.failures).toHaveLength(1);
  });

  it('aborts unfinished host frames when the child client is disposed', async () => {
    const f = fixture();
    const child = createReceiverBridgeRegistry(await f.registry.openBridge());
    closes.push(() => child.dispose());
    const context = await child.begin(f.seed, details);
    await child.dispose();
    await expect(f.registry.waitForIdle()).rejects.toThrow('did not complete');
    expect(() =>
      context.beforeOperations([
        { operation: 'write', kind: 'file', before: node(f.destination) },
      ]),
    ).toThrow('disposed');
    expect(f.failures).toHaveLength(1);
  });

  it('cancels a pending host BEGIN even before its frame response exists', async () => {
    let finish!: (input: RendererGeneratedOutputRegistrationInput) => void;
    let captured!: RendererGeneratedOutputRegistrationInput;
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => {
      signalStarted = resolve;
    });
    const f = fixture({
      prepare: input =>
        new Promise(resolve => {
          captured = input;
          finish = resolve;
          signalStarted();
        }),
    });
    const child = createReceiverBridgeRegistry(await f.registry.openBridge());
    closes.push(() => child.dispose());
    const beginning = child.begin(f.seed, details);
    void beginning.catch(() => {});
    await started;
    await child.dispose();
    finish(captured);
    await expect(beginning).rejects.toThrow(/disposed|rejected/u);
    await expect(f.registry.waitForIdle()).rejects.toThrow('did not complete');
    expect(f.completed).toHaveLength(0);
    expect(f.failures).toHaveLength(1);
  });

  it('blocks later-generation receipts after a failed static-seed prepare', async () => {
    let throwOnPrepare = false;
    const f = fixture({
      usePreparedGeneration: true,
      prepare: async input => {
        if (throwOnPrepare) throw new Error('actual generation prepare failed');
        return input;
      },
    });
    f.setPreparedGeneration(2);
    const prior = await completed(f);
    const observation = {
      receipt: prior.receipt,
      current: f.current(prior.receipt),
    };
    const lease = f.registry.pinReceipts([observation]);
    throwOnPrepare = true;
    await expect(f.registry.begin(f.seed, details)).rejects.toThrow(
      'actual generation prepare failed',
    );
    expect(() => lease.permission(f.destination)).toThrow(
      'actual generation prepare failed',
    );
    expect(() =>
      f.registry.assertReceiptCurrent(prior.receipt, observation.current),
    ).toThrow('actual generation prepare failed');
    expect(() => f.registry.completedReceipts()).toThrow(
      'actual generation prepare failed',
    );
  });

  it('closes an abandoned generation without waiting for an unreachable terminal', async () => {
    const f = fixture();
    const context = await f.registry.begin(f.seed, details);
    const waiting = f.registry.waitForIdle();
    f.registry.closeGeneration(context.frame, 'owned receiver worker exited');
    await expect(waiting).rejects.toThrow('owned receiver worker exited');
    expect(f.failures).toHaveLength(1);
    await expect(context.terminal(terminal(context, []))).rejects.toThrow(
      /exited|late/u,
    );
    expect(f.failures).toHaveLength(1);
  });

  it('keeps closed IO quarantined until its genuine native terminal arrives', async () => {
    const f = fixture();
    const context = await f.registry.begin(f.seed, details);
    f.registry.closeGeneration(context.frame, 'native receiver failed wave');
    await expect(f.registry.waitForIdle()).rejects.toThrow('failed wave');
    let settled = false;
    const drain = f.registry.waitForSettled().then(() => {
      settled = true;
    });
    expect(settled).toBe(false);
    const next = { ...f.seed, generation: 2 };
    expect(() =>
      f.registry.advanceGeneration(next, f.seed.registrationId),
    ).toThrow('not settled');
    await expect(context.terminal(terminal(context, []))).rejects.toThrow(
      'failed wave',
    );
    await drain;
    f.registry.advanceGeneration(next, f.seed.registrationId);
    await f.registry.waitForIdle();
    expect(f.registry.completedReceipts()).toHaveLength(0);
  });

  it('requires the owning host to confirm a specific receiver termination before recovery', async () => {
    const f = fixture();
    const worker = ownedBridgeWorker();
    f.registry.bindReceiverWorker(
      f.seed.compilerId,
      f.seed.registrationId,
      worker.witness,
    );
    const frame = await worker.begin(await f.registry.openBridge(), f.seed);
    expect(f.registry.quarantinedFrames()).toHaveLength(0);
    f.registry.closeGeneration(frame, 'worker unreachable');
    const unfinished = f.registry.quarantinedFrames();
    expect(unfinished).toEqual([frame]);
    expect(Object.isFrozen(unfinished)).toBe(true);
    expect(Object.isFrozen(unfinished[0])).toBe(true);
    expect(f.registry.receiverProcessId(frame)).toBe(worker.witness.pid);
    await expect(f.registry.waitForIdle()).rejects.toThrow('unreachable');
    expect(() =>
      f.registry.confirmReceiverTerminated({
        ...frame,
        frameId: '0'.repeat(32),
      }),
    ).toThrow('unknown');
    expect(() => f.registry.confirmReceiverTerminated(frame)).toThrow(
      'unproven',
    );
    await worker.stop();
    f.registry.confirmReceiverTerminated(frame);
    expect(f.registry.quarantinedFrames()).toHaveLength(0);
    await f.registry.waitForSettled();
    const next = { ...f.seed, generation: 2 };
    expect(() => f.registry.advanceGeneration(next, 'wrong-authority')).toThrow(
      'authority',
    );
    f.registry.advanceGeneration(next, f.seed.registrationId);
    expect(() =>
      f.registry.advanceGeneration(next, f.seed.registrationId),
    ).toThrow('newer');
    expect(f.failures).toHaveLength(1);
  });

  it('drains failed BEGIN without granting permission, then accepts a validated newer watch epoch', async () => {
    let failPrepare = true;
    const f = fixture({
      usePreparedGeneration: true,
      prepare: async input => {
        if (failPrepare) throw new Error('failed pre-IO registration');
        return input;
      },
    });
    await expect(f.registry.begin(f.seed, details)).rejects.toThrow(
      'failed pre-IO',
    );
    await f.registry.waitForSettled();
    await expect(f.registry.waitForIdle()).rejects.toThrow('failed pre-IO');
    const next = { ...f.seed, generation: 2 };
    f.registry.advanceGeneration(next, f.seed.registrationId);
    failPrepare = false;
    f.setPreparedGeneration(2);
    const context = await f.registry.begin(f.seed, details);
    const operation = write(context, f.destination);
    await context.terminal(terminal(context, [operation]));
    await f.registry.waitForIdle();
    expect(f.registry.completedReceipts()).toHaveLength(1);
  });

  it('accepts a genuine late bridge terminal after abort without restoring permission', async () => {
    const f = fixture();
    const bridge = await f.registry.openBridge();
    const beginId = '8'.repeat(32);
    const send = (body: object) =>
      fetch(bridge.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bridge.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ beginId, ...body }),
      });
    const response = (await (
      await send({ action: 'begin', seed: f.seed, details })
    ).json()) as { frame: ReceiverFrame };
    expect(
      (
        await send({
          action: 'abort',
          reason: 'receiver transport interrupted',
        })
      ).status,
    ).toBe(200);
    await expect(f.registry.waitForIdle()).rejects.toThrow('interrupted');
    let settled = false;
    const drain = f.registry.waitForSettled().then(() => {
      settled = true;
    });
    expect(settled).toBe(false);
    const evidence = {
      status: 'failed',
      frame: response.frame,
      operations: [],
      nodes: [],
      stages: [],
      failures: [
        {
          operation: 'consumeTypes',
          reason: 'native receiver finished after cancellation',
        },
      ],
    };
    expect(
      (
        await send({
          action: 'terminal',
          frame: response.frame,
          evidence,
          events: [],
        })
      ).status,
    ).toBe(400);
    await drain;
    expect(f.completed).toHaveLength(0);
    expect(f.failures).toHaveLength(1);
  });

  it('reports failure once when a generation closes while onStarted awaits', async () => {
    let finish!: () => void;
    let startedFrame!: ReceiverFrame;
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => {
      signalStarted = resolve;
    });
    const f = fixture({
      started: async (_registration, frame) => {
        startedFrame = frame;
        signalStarted();
        await new Promise<void>(resolve => {
          finish = resolve;
        });
      },
    });
    const beginning = f.registry.begin(f.seed, details);
    void beginning.catch(() => {});
    await started;
    f.registry.closeGeneration(
      startedFrame,
      'generation closed before native context exposure',
    );
    finish();
    await expect(beginning).rejects.toThrow('closed');
    await f.registry.waitForSettled();
    expect(f.failures).toHaveLength(1);
  });

  it('keeps untouched earlier nodes when a later same-wave receipt rewrites either remote', async () => {
    for (const reverse of [false, true]) {
      const f = fixture();
      const first = await twoRemotes(f);
      const rewritten = reverse ? first.second : f.destination;
      const untouched = reverse ? f.destination : first.second;
      const context = await f.registry.begin(f.seed, {
        operation: 'updateTypes',
        nativeOptions: details.nativeOptions,
        update: { remoteName: 'remote' },
        remoteAlias: 'remote',
      });
      const operation = write(context, rewritten, 'updated remote\n');
      await context.terminal(terminal(context, [operation]));
      const records = f.registry.completedReceipts();
      expect(records).toHaveLength(2);
      expect(records[0]!.receipt).toBe(first.receipt);
      expect(first.receipt.nodes).toHaveLength(2);
      expect(
        records[0]!.selectedNodes.map(snapshot => snapshot.path.lexical),
      ).toEqual([untouched]);
      expect(
        records[1]!.selectedNodes.map(snapshot => snapshot.path.lexical),
      ).toEqual([rewritten]);
      const lease = f.registry.pinReceipts(observations(f));
      expect(lease.permission(rewritten)).toEqual(node(rewritten));
      expect(lease.permission(untouched)).toEqual(node(untouched));
      lease.assertCurrent(observations(f));
      expect(() =>
        f.registry.pinReceipts([
          {
            receipt: { ...first.receipt, nodes: records[0]!.selectedNodes },
            current: {
              generation: first.receipt.generation,
              nodes: records[0]!.selectedNodes,
            },
          },
        ]),
      ).toThrow('owned');
    }
  });

  it('rejects edits to earlier selected nodes before exposing another native IO context', async () => {
    const f = fixture();
    const first = await twoRemotes(f);
    fs.writeFileSync(first.second, 'unacknowledged external edit\n');
    await expect(f.registry.begin(f.seed, details)).rejects.toThrow('changed');
    expect(f.starts).toHaveLength(1);
    expect(fs.readFileSync(first.second, 'utf8')).toBe(
      'unacknowledged external edit\n',
    );
  });

  it('rejects a stale inherited before snapshot in the child before native overwrite', async () => {
    const f = fixture();
    await twoRemotes(f);
    const child = createReceiverBridgeRegistry(await f.registry.openBridge());
    closes.push(() => child.dispose());
    const context = await child.begin(f.seed, details);
    fs.writeFileSync(f.destination, 'external edit after BEGIN\n');
    expect(() =>
      context.beforeOperations([
        { operation: 'write', kind: 'file', before: node(f.destination) },
      ]),
    ).toThrow('changed before native IO');
    expect(fs.readFileSync(f.destination, 'utf8')).toBe(
      'external edit after BEGIN\n',
    );
    await expect(
      context.terminal({ ...terminal(context, []), status: 'failed' }),
    ).rejects.toThrow('rejected');
    await f.registry.waitForSettled();
  });

  it('rejects a prior generated directory whose enumeration changed without acknowledgements', async () => {
    const f = fixture();
    await twoRemotes(f, true);
    const extra = path.join(f.root, 'types', 'unacknowledged.d.ts');
    fs.writeFileSync(extra, 'unacknowledged child\n');
    await expect(f.registry.begin(f.seed, details)).rejects.toThrow('changed');
    expect(f.starts).toHaveLength(1);
  });

  it('accepts first inherited parent progress from an acknowledged native removal before recreation', async () => {
    for (const bridge of [false, true]) {
      const f = fixture();
      const first = await twoRemotes(f, true);
      const receiver = bridge
        ? createReceiverBridgeRegistry(await f.registry.openBridge())
        : f.registry;
      if (bridge) closes.push(() => receiver.dispose());
      const context = await receiver.begin(f.seed, details);
      const removal = {
        operation: 'delete' as const,
        kind: 'file' as const,
        before: node(f.destination),
      };
      context.beforeOperations([removal]);
      fs.rmSync(f.destination);
      const removed = { ...removal, after: node(f.destination) };
      context.acknowledgeOperations([removed]);
      const child = {
        operation: 'write' as const,
        kind: 'file' as const,
        before: node(f.destination),
      };
      const directory = path.dirname(f.destination);
      const parent = {
        operation: 'write' as const,
        kind: 'directory' as const,
        before: node(directory),
        cause: { operation: 'writeFileSync', paths: [child.before.path] },
      };
      context.beforeOperations([child, parent]);
      fs.writeFileSync(f.destination, 'recreated remote\n');
      const written = { ...child, after: node(f.destination) };
      const changedParent = { ...parent, after: node(directory) };
      context.acknowledgeOperations([written, changedParent]);
      await context.terminal({
        ...terminal(context, [removed, written, changedParent]),
        nodes: [node(f.destination), node(directory)],
      });
      const lease = f.registry.pinReceipts(observations(f));
      expect(lease.permission(f.destination)?.kind).toBe('file');
      expect(lease.permission(first.second)?.kind).toBe('file');
      expect(lease.permission(directory)?.kind).toBe('directory');
    }
  });

  it('rejects unacknowledged siblings and parent metadata alongside otherwise genuine inherited progress', async () => {
    for (const mutation of ['sibling', 'metadata']) {
      const f = fixture();
      await twoRemotes(f, true);
      const context = await f.registry.begin(f.seed, details);
      const removal = {
        operation: 'delete' as const,
        kind: 'file' as const,
        before: node(f.destination),
      };
      context.beforeOperations([removal]);
      fs.rmSync(f.destination);
      context.acknowledgeOperations([
        { ...removal, after: node(f.destination) },
      ]);
      const directory = path.dirname(f.destination);
      if (mutation === 'sibling')
        fs.writeFileSync(path.join(directory, 'external.d.ts'), 'external\n');
      else fs.chmodSync(directory, 0o700);
      expect(() =>
        context.beforeOperations([
          {
            operation: 'write',
            kind: 'directory',
            before: node(directory),
          },
        ]),
      ).toThrow(/metadata|directory|child/u);
    }
  });

  it('lets a genuine deletion tombstone supersede an older live node while keeping the other remote', async () => {
    const f = fixture();
    const first = await twoRemotes(f);
    const context = await f.registry.begin(f.seed, details);
    const operation = {
      operation: 'delete' as const,
      kind: 'file' as const,
      before: node(f.destination),
    };
    context.beforeOperations([operation]);
    fs.unlinkSync(f.destination);
    const acknowledgement = { ...operation, after: node(f.destination) };
    context.acknowledgeOperations([acknowledgement]);
    await context.terminal(terminal(context, [acknowledgement]));
    const lease = f.registry.pinReceipts(observations(f));
    expect(lease.permission(f.destination)?.kind).toBe('missing');
    expect(lease.permission(first.second)?.kind).toBe('file');
  });

  it('rejects changed producer ownership and inherited canonical or inode aliases before IO', async () => {
    const owner = fixture();
    await twoRemotes(owner);
    const registration = owner.input();
    owner.setRegistration({
      ...registration,
      producer: { ...registration.producer, moduleDigest: 'a'.repeat(64) },
    });
    await expect(owner.registry.begin(owner.seed, details)).rejects.toThrow(
      'registration changed',
    );
    for (const alias of ['canonical', 'inode']) {
      const f = fixture();
      const first = await twoRemotes(f);
      const context = await f.registry.begin(f.seed, details);
      fs.unlinkSync(f.destination);
      if (alias === 'canonical') fs.symlinkSync(first.second, f.destination);
      else fs.linkSync(first.second, f.destination);
      expect(() =>
        context.beforeOperations([
          { operation: 'write', kind: 'file', before: node(f.destination) },
        ]),
      ).toThrow(/aliases|changed/u);
      expect(fs.readFileSync(first.second, 'utf8')).toBe('second remote\n');
    }
  });

  it('holds queued native BEGIN before preparation and revision changes until publication releases', async () => {
    const f = fixture();
    await completed(f);
    const current = observations(f);
    const lease = f.registry.pinReceipts(current);
    let release!: () => void;
    const publication = lease.withPublication(async () => {
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return 'published';
    });
    const beginning = f.registry.begin(f.seed, details);
    expect(f.starts).toHaveLength(1);
    lease.assertCurrent(current);
    expect(() =>
      f.registry.advanceGeneration(
        { ...f.seed, generation: 2 },
        f.seed.registrationId,
      ),
    ).toThrow('fence');
    release();
    expect(await publication).toBe('published');
    const context = await beginning;
    expect(f.starts).toHaveLength(2);
    expect(() => lease.permission(f.destination)).toThrow('changed');
    await context.terminal({ ...terminal(context, []), stages: [] });
  });

  it('never starts a cancelled authenticated queued BEGIN after the publication fence releases', async () => {
    const f = fixture();
    await completed(f);
    const current = observations(f);
    const lease = f.registry.pinReceipts(current);
    const child = createReceiverBridgeRegistry(await f.registry.openBridge());
    closes.push(() => child.dispose());
    let release!: () => void;
    const publication = lease.withPublication(async () => {
      await new Promise<void>(resolve => {
        release = resolve;
      });
    });
    const beginning = child.begin(f.seed, details);
    void beginning.catch(() => {});
    await child.dispose();
    lease.assertCurrent(current);
    release();
    await publication;
    await expect(beginning).rejects.toThrow(/disposed|rejected/u);
    await f.registry.waitForIdle();
    expect(f.starts).toHaveLength(1);
    expect(f.failures).toHaveLength(0);
  });

  it('releases the publication fence on commit failure', async () => {
    const f = fixture();
    await completed(f);
    const lease = f.registry.pinReceipts(observations(f));
    await expect(
      lease.withPublication(async () => {
        throw new Error('metadata commit failed');
      }),
    ).rejects.toThrow('commit failed');
    const context = await f.registry.begin(f.seed, details);
    expect(f.starts).toHaveLength(2);
    await context.terminal({ ...terminal(context, []), stages: [] });
  });

  it('rejects a callback-delayed older terminal after another receiver completes an overwrite', async () => {
    let release!: () => void;
    let entered!: () => void;
    let calls = 0;
    const callbackStarted = new Promise<void>(resolve => {
      entered = resolve;
    });
    const f = fixture({
      async completed() {
        if (++calls !== 1) return;
        entered();
        await new Promise<void>(resolve => {
          release = resolve;
        });
      },
    });
    const first = await f.registry.begin(f.seed, details);
    const firstOperation = write(first, f.destination, 'older receiver\n');
    const firstTerminal = first.terminal(terminal(first, [firstOperation]));
    void firstTerminal.catch(() => {});
    await callbackStarted;
    const second = await f.registry.begin(f.seed, details);
    const secondOperation = write(second, f.destination, 'newer receiver\n');
    await second.terminal(terminal(second, [secondOperation]));
    release();
    await expect(firstTerminal).rejects.toThrow('changed');
    await expect(f.registry.waitForIdle()).rejects.toThrow('changed');
    expect(fs.readFileSync(f.destination, 'utf8')).toBe('newer receiver\n');
    expect(() => f.registry.completedReceipts()).toThrow('changed');
  });

  it('rejects publication success if its owning generation closes during the commit callback', async () => {
    const f = fixture();
    const result = await completed(f);
    const lease = f.registry.pinReceipts(observations(f));
    let release!: () => void;
    const publication = lease.withPublication(async () => {
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return 'stale publication';
    });
    void publication.catch(() => {});
    f.registry.closeGeneration(result.context.frame, 'compiler closed');
    release();
    await expect(publication).rejects.toThrow('changed');
    await f.registry.waitForSettled();
    expect(() => lease.permission(f.destination)).toThrow('changed');
    await expect(f.registry.begin(f.seed, details)).rejects.toThrow('closed');
  });

  it('requires sealed exact host graph enrollment before preparation and preserves the sealed member set', async () => {
    let prepares = 0;
    const f = fixture({
      graph: true,
      prepare: async input => {
        prepares++;
        return input;
      },
    });
    await expect(f.registry.begin(f.seed, details)).rejects.toThrow(
      'not sealed',
    );
    f.registry.sealReceiverGraph(f.graph);
    expect(() => f.registry.sealReceiverGraph(f.graph)).toThrow('sealed');
    f.graph.members.push({
      compilerId: 'late-compiler',
      registrationId: 'late-registration',
    });
    for (const seed of [
      {
        ...f.seed,
        compilerId: 'late-compiler',
        registrationId: 'late-registration',
      },
      { ...f.seed, registrationId: f.secondSeed.registrationId },
    ])
      await expect(f.registry.begin(seed, details)).rejects.toThrow('enrolled');
    expect(prepares).toBe(0);
    await completed(f);
    expect(prepares).toBe(1);
  });

  it('serializes enrolled compiler IO and combines distinct registrations with their original destination limits', async () => {
    const priors: (readonly SelectedReceiverReceipt[])[] = [];
    const f = fixture({
      graph: true,
      prepare: async (input, priorReceipts) => {
        priors.push(priorReceipts);
        return input;
      },
    });
    f.registry.sealReceiverGraph(f.graph);
    const first = await f.registry.begin(f.seed, details);
    const firstOperation = write(first, f.destination, 'first web remote\n');
    const secondPath = path.join(f.root, 'types', 'second-web.d.ts');
    f.setRegistration({
      destinations: [
        { path: node(secondPath).path, kind: 'file', scope: 'exact' },
      ],
      effectiveOptions: { consumeTypes: true, compilerName: 'second-web' },
    });
    const beginning = f.registry.begin(f.secondSeed, details);
    let drained = false;
    const drain = f.registry.waitForSettled().then(() => {
      drained = true;
    });
    expect(f.starts).toHaveLength(1);
    expect(priors).toHaveLength(1);
    await first.terminal(terminal(first, [firstOperation]));
    const second = await beginning;
    expect(drained).toBe(false);
    expect(priors).toHaveLength(2);
    expect(priors[1]![0]!.receipt).toBe(f.completed[0]!.receipt);
    expect(Object.isFrozen(priors[1])).toBe(true);
    expect(priors[1]![0]!.selectedNodes).toEqual([firstOperation.after]);
    expect(() =>
      second.beforeOperations([
        { operation: 'write', kind: 'file', before: node(f.destination) },
      ]),
    ).toThrow('registered destination');
    await expect(second.terminal(terminal(second, []))).rejects.toThrow(
      'registered destination',
    );
    await drain;

    const valid = fixture({ graph: true });
    valid.registry.sealReceiverGraph(valid.graph);
    const initial = await completed(valid);
    const other = path.join(valid.root, 'types', 'other-web.d.ts');
    valid.setRegistration({
      destinations: [{ path: node(other).path, kind: 'file', scope: 'exact' }],
      effectiveOptions: { consumeTypes: true, compilerName: 'other-web' },
    });
    const next = await valid.registry.begin(valid.secondSeed, details);
    const nextOperation = write(next, other, 'second web remote\n');
    await next.terminal(terminal(next, [nextOperation]));
    const records = valid.registry.completedReceipts();
    expect(records).toHaveLength(2);
    expect(records[0]!.receipt).toBe(initial.receipt);
    expect(records[0]!.registration.id).not.toBe(records[1]!.registration.id);
    const lease = valid.registry.pinReceipts(observations(valid));
    expect(lease.permission(valid.destination)?.kind).toBe('file');
    expect(lease.permission(other)?.kind).toBe('file');
  });

  it('orders shared alias overwrite after the prior terminal callback and keeps whole member receipts', async () => {
    let release!: () => void;
    let entered!: () => void;
    let completions = 0;
    const callbackEntered = new Promise<void>(resolve => {
      entered = resolve;
    });
    const f = fixture({
      graph: true,
      async completed() {
        if (++completions !== 1) return;
        entered();
        await new Promise<void>(resolve => {
          release = resolve;
        });
      },
    });
    f.registry.sealReceiverGraph(f.graph);
    const first = await f.registry.begin(f.seed, details);
    const firstOperation = write(
      first,
      f.destination,
      'first physical bytes\n',
    );
    const finishing = first.terminal(terminal(first, [firstOperation]));
    await callbackEntered;
    const beginning = f.registry.begin(f.secondSeed, details);
    expect(f.starts).toHaveLength(1);
    expect(fs.readFileSync(f.destination, 'utf8')).toBe(
      'first physical bytes\n',
    );
    release();
    await finishing;
    const second = await beginning;
    const secondOperation = write(
      second,
      f.destination,
      'second physical bytes\n',
    );
    await second.terminal(terminal(second, [secondOperation]));
    const records = f.registry.completedReceipts();
    expect(records[0]!.receipt.nodes).toEqual([firstOperation.after]);
    expect(records[0]!.selectedNodes).toHaveLength(0);
    expect(records[1]!.selectedNodes).toEqual([secondOperation.after]);
    const lease = f.registry.pinReceipts(observations(f));
    expect(lease.permission(f.destination)?.kind).toBe('file');
  });

  it('rejects cross-graph authority, implementation cohort and physical producer substitutions before IO', async () => {
    for (const mismatch of ['authority', 'cohort', 'producer']) {
      const f = fixture({ graph: true });
      f.registry.sealReceiverGraph(f.graph);
      await completed(f);
      if (mismatch === 'producer') {
        const producer = f.input().producer;
        f.setRegistration({
          producer: { ...producer, moduleDigest: 'f'.repeat(64) },
        });
      } else f.setGraphEpoch({ [mismatch]: Object.freeze({}) });
      await expect(f.registry.begin(f.secondSeed, details)).rejects.toThrow(
        /authority|cohort|registration changed/u,
      );
      expect(f.starts).toHaveLength(1);
      expect(() => f.registry.completedReceipts()).toThrow();
    }
  });

  it('holds all graph recovery behind quarantined IO and rejects sibling reuse of a failed epoch', async () => {
    const f = fixture({ graph: true, usePreparedGeneration: true });
    f.registry.sealReceiverGraph(f.graph);
    const first = await completed(f);
    const second = await f.registry.begin(f.secondSeed, details);
    const queued = f.registry.begin(f.seed, details);
    void queued.catch(() => {});
    f.registry.closeGeneration(second.frame, 'shared graph failed');
    await expect(f.registry.waitForIdle()).rejects.toThrow(
      'shared graph failed',
    );
    expect(() =>
      f.registry.permission(
        first.receipt,
        f.destination,
        f.current(first.receipt),
      ),
    ).toThrow('shared graph failed');
    expect(f.starts).toHaveLength(2);
    await expect(second.terminal(terminal(second, []))).rejects.toThrow(
      'shared graph failed',
    );
    await expect(queued).rejects.toThrow(/closed|failed/u);
    await f.registry.waitForSettled();
    expect(f.starts).toHaveLength(2);
    f.setPreparedGeneration(2);
    f.setGraphEpoch({ generation: 2 });
    const recovered = await f.registry.begin(f.seed, details);
    const operation = write(
      recovered,
      f.destination,
      'recovered shared epoch\n',
    );
    await recovered.terminal(terminal(recovered, [operation]));
    await f.registry.waitForIdle();
    expect(f.registry.completedReceipts()).toHaveLength(1);
  });

  it('rejects stale or conflicting shared graph epochs while independent graphs can run in parallel', async () => {
    for (const mismatch of ['stale', 'conflict']) {
      const f = fixture({ graph: true });
      f.registry.sealReceiverGraph(f.graph);
      f.setGraphEpoch({ generation: 2 });
      await completed(f);
      f.setGraphEpoch(
        mismatch === 'stale'
          ? { generation: 1 }
          : { revision: 'conflicting-revision' },
      );
      await expect(f.registry.begin(f.secondSeed, details)).rejects.toThrow(
        /stale|conflict/u,
      );
      expect(f.starts).toHaveLength(1);
    }
    const first = fixture({ graph: true });
    const second = fixture({ graph: true });
    first.registry.sealReceiverGraph(first.graph);
    second.registry.sealReceiverGraph(second.graph);
    const contexts = await Promise.all([
      first.registry.begin(first.seed, details),
      second.registry.begin(second.seed, details),
    ]);
    expect(first.starts).toHaveLength(1);
    expect(second.starts).toHaveLength(1);
    await Promise.all(
      contexts.map(context => context.terminal(terminal(context, []))),
    );
  });

  it('cancels authenticated queued graph admission without changing prior receipts or later starting native IO', async () => {
    const f = fixture({ graph: true });
    f.registry.sealReceiverGraph(f.graph);
    const first = await f.registry.begin(f.seed, details);
    const operation = write(first, f.destination);
    const child = createReceiverBridgeRegistry(await f.registry.openBridge());
    closes.push(() => child.dispose());
    const beginning = child.begin(f.secondSeed, details);
    void beginning.catch(() => {});
    await child.dispose();
    await first.terminal(terminal(first, [operation]));
    await expect(beginning).rejects.toThrow(/disposed|rejected/u);
    await f.registry.waitForSettled();
    expect(f.starts).toHaveLength(1);
    expect(f.failures).toHaveLength(0);
    expect(f.registry.completedReceipts()).toHaveLength(1);
  });

  it('keeps graph publication pinned while a queued member is cancelled and cancels queued admission on shutdown', async () => {
    const f = fixture({ graph: true });
    f.registry.sealReceiverGraph(f.graph);
    await completed(f);
    const current = observations(f);
    const lease = f.registry.pinReceipts(current);
    let release!: () => void;
    const publication = lease.withPublication(async () => {
      await new Promise<void>(resolve => {
        release = resolve;
      });
      return 'published';
    });
    const child = createReceiverBridgeRegistry(await f.registry.openBridge());
    closes.push(() => child.dispose());
    const beginning = child.begin(f.secondSeed, details);
    void beginning.catch(() => {});
    await child.dispose();
    lease.assertCurrent(current);
    release();
    expect(await publication).toBe('published');
    await expect(beginning).rejects.toThrow(/disposed|rejected/u);
    await f.registry.waitForSettled();
    expect(f.starts).toHaveLength(1);

    const active = await f.registry.begin(f.seed, details);
    const queued = f.registry.begin(f.secondSeed, details);
    void queued.catch(() => {});
    await f.registry.dispose();
    await expect(queued).rejects.toThrow('disposed');
    expect(f.starts).toHaveLength(2);
    await expect(active.terminal(terminal(active, []))).rejects.toThrow(
      /late|unknown|terminal/u,
    );
  });

  it('records lifetime origin only from host admission and keeps direct IO separate from receiver workers', async () => {
    const direct = fixture();
    const context = await Reflect.apply(
      direct.registry.begin,
      direct.registry,
      [direct.seed, details, undefined, undefined, 'bridge'],
    );
    direct.registry.closeGeneration(
      context.frame,
      'direct receiver still runs',
    );
    expect(direct.registry.quarantinedFrames('direct')).toEqual([
      context.frame,
    ]);
    expect(direct.registry.quarantinedFrames('bridge')).toHaveLength(0);
    expect(direct.registry.receiverProcessId(context.frame)).toBeUndefined();
    expect(() =>
      direct.registry.confirmReceiverTerminated(context.frame),
    ).toThrow('actual terminal');
    await expect(context.terminal(terminal(context, []))).rejects.toThrow(
      'still runs',
    );
    await direct.registry.waitForSettled();

    const remote = fixture();
    const child = createReceiverBridgeRegistry(
      await remote.registry.openBridge(),
    );
    closes.push(() => child.dispose());
    await expect(
      Reflect.apply(child.begin, child, [
        remote.seed,
        { ...details, origin: 'bridge' },
      ]),
    ).rejects.toThrow('declared contract');
    const worker = await child.begin(remote.seed, details);
    remote.registry.closeGeneration(worker.frame, 'owning child closed');
    expect(remote.registry.quarantinedFrames('direct')).toHaveLength(0);
    expect(remote.registry.quarantinedFrames('bridge')).toEqual([worker.frame]);
    expect(remote.registry.receiverProcessId(worker.frame)).toBe(process.pid);
    expect(() =>
      remote.registry.confirmReceiverTerminated(worker.frame),
    ).toThrow('unproven');
    await expect(
      worker.terminal({ ...terminal(worker, []), status: 'failed' }),
    ).rejects.toThrow('rejected');
    await remote.registry.waitForSettled();
    expect(remote.registry.quarantinedFrames()).toHaveLength(0);
  });

  it('keeps retired bridge aborts and terminals in their original graph epoch', async () => {
    const f = fixture({ graph: true, usePreparedGeneration: true });
    f.registry.sealReceiverGraph(f.graph);
    const bridge = await f.registry.openBridge();
    const beginId = 'b'.repeat(32);
    const send = (body: object) =>
      fetch(bridge.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bridge.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ beginId, ...body }),
      });
    const response = await send({ action: 'begin', seed: f.seed, details });
    expect(response.status).toBe(200);
    const { frame } = (await response.json()) as { frame: ReceiverFrame };
    const evidence = {
      status: 'complete',
      frame,
      operations: [],
      nodes: [],
      stages: [],
      failures: [],
    };
    expect(
      (await send({ action: 'terminal', frame, evidence, events: [] })).status,
    ).toBe(200);
    f.setPreparedGeneration(2);
    f.setGraphEpoch({ generation: 2 });
    await completed(f);
    const current = observations(f);
    const lease = f.registry.pinReceipts(current);
    expect(
      (await send({ action: 'abort', reason: 'late old worker cancellation' }))
        .status,
    ).toBe(200);
    expect(
      (await send({ action: 'terminal', frame, evidence, events: [] })).status,
    ).toBe(400);
    lease.assertCurrent(current);
    expect(lease.permission(f.destination)?.kind).toBe('file');
    await f.registry.waitForIdle();
  });

  it('transports frozen host source namespaces and prior physical nodes without carrying old epoch permissions', async () => {
    for (const bridge of [false, true]) {
      const f = fixture({
        graph: true,
        usePreparedGeneration: true,
        sourceNamespaces(registration) {
          const root = registration.consumer.projectRoot;
          return {
            entries: [node(path.join(root, 'src', 'authored.ts')).path],
            dirs: [node(path.join(root, 'src')).path],
          };
        },
      });
      f.registry.sealReceiverGraph(f.graph);
      const previous = await completed(f);
      f.setPreparedGeneration(2);
      f.setGraphEpoch({ generation: 2 });
      const receiver = bridge
        ? createReceiverBridgeRegistry(await f.registry.openBridge())
        : f.registry;
      if (bridge) closes.push(() => receiver.dispose());
      const context = await receiver.begin(f.secondSeed, details);
      expect(context.inheritedNodes).toEqual(previous.receipt.nodes);
      expect(context.sourceNamespaces).toEqual({
        entries: [node(f.authored).path],
        dirs: [node(path.join(f.root, 'src')).path],
      });
      expect(Object.isFrozen(context.inheritedNodes)).toBe(true);
      expect(Object.isFrozen(context.sourceNamespaces)).toBe(true);
      expect(Object.isFrozen(context.sourceNamespaces!.dirs[0])).toBe(true);
      await context.terminal({ ...terminal(context, []), stages: [] });
      const records = f.registry.completedReceipts();
      expect(records).toHaveLength(1);
      expect(records[0]!.receipt.nodes).toHaveLength(0);
      expect(
        f.registry.pinReceipts(observations(f)).permission(f.destination),
      ).toBeUndefined();
      expect(() =>
        f.registry.permission(
          previous.receipt,
          f.destination,
          f.current(previous.receipt),
        ),
      ).toThrow('not owned');
    }
  });

  it('drains malformed bridge provenance only with an exact native terminal marker and releases its graph admission', async () => {
    for (const marker of ['complete', 'partial']) {
      const f = fixture({ graph: true, usePreparedGeneration: true });
      f.registry.sealReceiverGraph(f.graph);
      const bridge = await f.registry.openBridge();
      const beginId = 'c'.repeat(32);
      const send = (body: object) =>
        fetch(bridge.url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bridge.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ beginId, ...body }),
        });
      const response = await send({ action: 'begin', seed: f.seed, details });
      const { frame } = (await response.json()) as { frame: ReceiverFrame };
      const evidence = {
        status: 'complete',
        frame,
        operations: [],
        nodes: [],
        stages: [],
        failures: [],
      };
      const rejected = await send({
        action: 'terminal',
        frame,
        evidence:
          marker === 'complete' ? evidence : { status: 'complete', frame },
        events: [{ event: 'acknowledge', sequence: 0, operations: [] }],
      });
      expect(rejected.status).toBe(400);
      f.setPreparedGeneration(2);
      f.setGraphEpoch({ generation: 2 });
      const beginning = f.registry.begin(f.secondSeed, details);
      if (marker === 'partial') {
        expect(f.registry.quarantinedFrames('bridge')).toEqual([frame]);
        expect(f.starts).toHaveLength(1);
        const late = await send({
          action: 'terminal',
          frame,
          evidence,
          events: [],
        });
        expect(late.status).toBe(400);
      } else expect(f.registry.quarantinedFrames()).toHaveLength(0);
      const next = await beginning;
      expect(f.starts).toHaveLength(2);
      await next.terminal({ ...terminal(next, []), stages: [] });
      await f.registry.waitForSettled();
      await f.registry.waitForIdle();
    }
  });

  it('confirms only the bound actual child after its exact close while another cloned-seed child remains live', async () => {
    const f = fixture();
    const bridge = await f.registry.openBridge();
    const first = ownedBridgeWorker();
    const second = ownedBridgeWorker();
    f.registry.bindReceiverWorker(
      f.seed.compilerId,
      f.seed.registrationId,
      first.witness,
    );
    expect(() =>
      f.registry.bindReceiverWorker(
        f.seed.compilerId,
        f.seed.registrationId,
        second.witness,
      ),
    ).toThrow('still live');
    const [firstFrame, secondFrame] = await Promise.all([
      first.begin(bridge, f.seed),
      second.begin(bridge, f.seed),
    ]);
    expect(first.witness.pid).not.toBe(second.witness.pid);
    expect(f.registry.receiverProcessId(firstFrame)).toBe(first.witness.pid);
    expect(f.registry.receiverProcessId(secondFrame)).toBe(second.witness.pid);
    f.registry.closeGeneration(firstFrame, 'same-seed receiver cancellation');
    expect(f.registry.quarantinedFrames('bridge')).toHaveLength(2);
    expect(() => f.registry.confirmReceiverTerminated(firstFrame)).toThrow(
      'unproven',
    );
    await first.stop();
    f.registry.confirmReceiverTerminated(firstFrame);
    expect(f.registry.quarantinedFrames('bridge')).toEqual([secondFrame]);
    expect(() => f.registry.confirmReceiverTerminated(secondFrame)).toThrow(
      'unproven',
    );
    let secondClosed = false;
    void second.witness.closed.then(() => {
      secondClosed = true;
    });
    let settled = false;
    const drain = f.registry.waitForSettled().then(() => {
      settled = true;
    });
    void drain.catch(() => {});
    expect(secondClosed).toBe(false);
    expect(settled).toBe(false);
    expect(await second.terminal()).toBe(400);
    await drain;
    expect(secondClosed).toBe(false);
    expect(f.registry.quarantinedFrames()).toHaveLength(0);
    await second.stop();
  });
});

import { spawn } from 'node:child_process';
