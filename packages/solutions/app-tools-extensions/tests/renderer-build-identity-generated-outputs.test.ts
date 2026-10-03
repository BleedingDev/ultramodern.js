import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, rs } from '@rstest/core';
import {
  type RendererBuildIdentityOptions,
  type RendererGeneratedOutputIdentityLease,
  resolveRendererBuildIdentities,
} from '../src/renderer-build-identity';
import {
  assertRendererGeneratedOutputOperationsAllowed,
  assertRendererGeneratedOutputReceiptCurrent,
  assertRendererGeneratedOutputReceiptNodesCurrent,
  immutableRendererGeneratedOutputRegistration,
  type RendererGeneratedOutputGeneration,
  type RendererGeneratedOutputNode,
  type RendererGeneratedOutputOperation,
  type RendererGeneratedOutputReceipt,
  type RendererGeneratedOutputRegistration,
  rendererGeneratedOutputPermission,
  validateRendererGeneratedOutputReceipt,
} from '../src/renderer-generated-outputs';

const temporaryRoots = new Set<string>();
const leases = new Set<RendererGeneratedOutputIdentityLease>();

afterEach(async () => {
  for (const lease of leases) lease.release();
  leases.clear();
  for (const root of temporaryRoots)
    await fs.rm(root, { recursive: true, force: true });
  temporaryRoots.clear();
});

const sha = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

async function write(file: string, bytes: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
}

async function fixture(): Promise<RendererBuildIdentityOptions> {
  const temporaryRoot = await fs.mkdtemp(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'renderer-generated-output-identity-',
    ),
  );
  temporaryRoots.add(temporaryRoot);
  const projectRoot = await fs.realpath(temporaryRoot);
  await write(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ name: '@demo/shop', version: '1.0.0' }),
  );
  await write(
    path.join(projectRoot, 'src', 'App.tsx'),
    'export default () => <main>native</main>;\n',
  );
  await write(
    path.join(projectRoot, 'modern.config.ts'),
    'export default { renderer: "solid" };\n',
  );
  for (const manifest of [
    {
      name: '@solidjs/compiler',
      version: '2.0.0-rc.13',
      dependencies: { '@babel/parser': '^8.0.6' },
    },
    {
      name: '@solidjs/web',
      version: '2.0.0-rc.13',
      dependencies: { 'solid-js': '2.0.0-rc.13' },
    },
    { name: 'solid-js', version: '2.0.0-rc.13' },
    {
      name: '@tanstack/solid-router',
      version: '2.0.0-rc.8',
      dependencies: { '@tanstack/router-core': '1.171.22' },
    },
    { name: '@tanstack/router-core', version: '1.171.22' },
    { name: '@babel/parser', version: '8.0.6' },
    { name: '@module-federation/dts-plugin', version: '2.9.1' },
  ]) {
    const directory = path.join(projectRoot, 'node_modules', manifest.name);
    await write(path.join(directory, 'package.json'), JSON.stringify(manifest));
    await write(
      path.join(directory, 'index.js'),
      `export const identity = ${JSON.stringify(`${manifest.name}@${manifest.version}`)};\n`,
    );
  }
  const profile: RendererBuildIdentityOptions['profile'] = {
    renderer: 'solid',
    protocolVersion: 1,
    compiler: { name: '@solidjs/compiler', version: '2.0.0-rc.13' },
    hydration: { name: '@solidjs/web', version: '2.0.0-rc.13' },
    router: {
      name: '@tanstack/solid-router',
      version: '2.0.0-rc.8',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.22',
    },
    dependencies: { 'solid-js': '2.0.0-rc.13' },
    sourceExtensions: ['.tsx', '.ts'],
    jsxImportSource: '@solidjs/web',
  };
  const provider = { framework: 'solid' as const, ...profile.router };
  return {
    projectRoot,
    renderer: 'solid',
    profile,
    routerBindings: {
      main: {
        owner: '@fixture/solid-native-router',
        evidence: 'file-routes',
        defaultProvider: provider,
        providers: [provider],
      },
    },
    entryNames: ['main'],
    mode: 'production',
    configuration: { renderer: 'solid', server: { ssr: true } },
  };
}

/** The test host observes actual paths, bytes and stable physical metadata. */
async function observe(file: string): Promise<RendererGeneratedOutputNode> {
  const lexical = path.resolve(file);
  const canonical = path.join(
    await fs.realpath(path.dirname(lexical)),
    path.basename(lexical),
  );
  const nodePath = { lexical, canonical };
  try {
    const stat = await fs.lstat(lexical, { bigint: true });
    if (!stat.isFile())
      throw new Error(`Expected a physical generated file: ${lexical}`);
    return {
      path: nodePath,
      kind: 'file',
      byteDigest: sha(await fs.readFile(lexical)),
      metadata: {
        device: String(stat.dev),
        inode: String(stat.ino),
        size: String(stat.size),
        mtimeNs: String(stat.mtimeNs),
        ctimeNs: String(stat.ctimeNs),
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { path: nodePath, kind: 'missing' };
  }
}

async function registration(
  options: RendererBuildIdentityOptions,
  generation: RendererGeneratedOutputGeneration,
): Promise<RendererGeneratedOutputRegistration> {
  const directory = path.join(options.projectRoot, '@mf-types');
  await fs.mkdir(directory, { recursive: true });
  const packageDirectory = await fs.realpath(
    path.join(
      options.projectRoot,
      'node_modules/@module-federation/dts-plugin',
    ),
  );
  const modulePath = path.join(packageDirectory, 'index.js');
  const authored = await observe(path.join(options.projectRoot, 'src/App.tsx'));
  return immutableRendererGeneratedOutputRegistration({
    schemaVersion: 1,
    id: 'native-consumed-types',
    pathFlavor: 'posix',
    producer: {
      packageName: '@module-federation/dts-plugin',
      version: '2.9.1',
      packageDirectory,
      modulePath,
      moduleDigest: sha(await fs.readFile(modulePath)),
    },
    consumer: { id: '@demo/shop', projectRoot: options.projectRoot },
    generation,
    effectiveOptions: { consumeTypes: true, typesFolder: '@mf-types' },
    context: { mode: 'production', renderer: 'solid' },
    destinations: [
      {
        path: { lexical: directory, canonical: await fs.realpath(directory) },
        kind: 'directory',
        scope: 'subtree',
      },
    ],
    authoredPaths: [authored.path],
    protectedInputs: [{ observation: 'content', node: authored }],
  });
}

const generation = (number: number): RendererGeneratedOutputGeneration => ({
  operationId: `consume-types-${number}`,
  compilerId: 'client',
  generation: number,
  revision: `native-compile-${number}`,
});

async function generatedReceipt(
  options: RendererBuildIdentityOptions,
  number: number,
  operation: 'write' | 'delete',
  mutate: (file: string) => Promise<void>,
) {
  const registered = await registration(options, generation(number));
  const file = path.join(options.projectRoot, '@mf-types/remote.d.ts');
  const planned: RendererGeneratedOutputOperation = {
    operation,
    kind: 'file',
    before: await observe(file),
  };
  const plan = assertRendererGeneratedOutputOperationsAllowed(registered, [
    planned,
  ]);
  await mutate(file);
  const after = await observe(file);
  const receipt = validateRendererGeneratedOutputReceipt(
    registered,
    plan,
    {
      status: 'complete',
      registrationDigest: registered.registrationDigest,
      planDigest: plan.planDigest,
      generation: registered.generation,
      operations: [{ ...planned, after }],
    },
    {
      generation: registered.generation,
      nodes: [await observe(file)],
    },
  );
  return { registration: registered, receipt };
}

type ReceiptBinding = {
  registration: RendererGeneratedOutputRegistration;
  receipt: RendererGeneratedOutputReceipt;
};

function lease(
  binding: ReceiptBinding,
  beforeObservation?: (checks: number) => Promise<void>,
) {
  let active = true;
  let checks = 0;
  let epochChecks = 0;
  let releases = 0;
  const pinned: RendererGeneratedOutputIdentityLease = Object.freeze({
    revision: binding.registration.generation.revision,
    receipts: Object.freeze([Object.freeze(binding)]),
    assertEpochCurrent() {
      epochChecks++;
      if (!active) throw new Error('Generated output lease has been released.');
    },
    async assertCurrent() {
      if (!active) throw new Error('Generated output lease has been released.');
      checks++;
      await beforeObservation?.(checks);
      assertRendererGeneratedOutputReceiptCurrent(
        binding.registration,
        binding.receipt,
        {
          generation: binding.registration.generation,
          nodes: await Promise.all(
            binding.receipt.nodes.map(node => observe(node.path.lexical)),
          ),
        },
      );
    },
    permission(inputPath: string) {
      if (!active) throw new Error('Generated output lease has been released.');
      return rendererGeneratedOutputPermission(binding.receipt, inputPath);
    },
    async withPublication<T>(callback: () => Promise<T>): Promise<T> {
      await pinned.assertCurrent();
      const result = await callback();
      await pinned.assertCurrent();
      return result;
    },
    release() {
      if (!active) return;
      active = false;
      releases++;
      leases.delete(pinned);
    },
  });
  leases.add(pinned);
  return {
    pinned,
    checks: () => checks,
    epochChecks: () => epochChecks,
    releases: () => releases,
  };
}

async function generatedFilesReceipt(
  options: RendererBuildIdentityOptions,
  number: number,
  files: readonly { name: string; bytes: string }[],
): Promise<ReceiptBinding> {
  const registered = await registration(options, generation(number));
  const operations: RendererGeneratedOutputOperation[] = await Promise.all(
    files.map(async file => ({
      operation: 'write' as const,
      kind: 'file' as const,
      before: await observe(
        path.join(options.projectRoot, '@mf-types', file.name),
      ),
    })),
  );
  const plan = assertRendererGeneratedOutputOperationsAllowed(
    registered,
    operations,
  );
  const acknowledgements = [];
  for (const [index, file] of files.entries()) {
    const output = path.join(options.projectRoot, '@mf-types', file.name);
    await write(output, file.bytes);
    acknowledgements.push({
      ...operations[index]!,
      after: await observe(output),
    });
  }
  const receipt = validateRendererGeneratedOutputReceipt(
    registered,
    plan,
    {
      status: 'complete',
      registrationDigest: registered.registrationDigest,
      planDigest: plan.planDigest,
      generation: registered.generation,
      operations: acknowledgements,
    },
    {
      generation: registered.generation,
      nodes: await Promise.all(
        files.map(file =>
          observe(path.join(options.projectRoot, '@mf-types', file.name)),
        ),
      ),
    },
  );
  return { registration: registered, receipt };
}

function overlayLease(
  bindings: readonly ReceiptBinding[],
  beforeObservation?: (checks: number) => Promise<void>,
) {
  let active = true;
  let checks = 0;
  let releases = 0;
  let currentRevision = 'host-overlay-2';
  const selected = new Map<
    string,
    { binding: ReceiptBinding; node: RendererGeneratedOutputNode }
  >();
  for (const binding of bindings)
    for (const node of binding.receipt.nodes)
      selected.set(node.path.lexical, { binding, node });
  const assertRevision = () => {
    if (!active) throw new Error('Generated output lease has been released.');
    if (currentRevision !== pinned.revision)
      throw new Error('Generated output lease revision is stale.');
  };
  const pinned: RendererGeneratedOutputIdentityLease = Object.freeze({
    revision: currentRevision,
    receipts: Object.freeze(bindings.map(binding => Object.freeze(binding))),
    assertEpochCurrent: assertRevision,
    async assertCurrent() {
      assertRevision();
      checks++;
      await beforeObservation?.(checks);
      assertRevision();
      for (const binding of bindings) {
        const members = [...selected.values()].filter(
          member => member.binding === binding,
        );
        assertRendererGeneratedOutputReceiptNodesCurrent(
          binding.registration,
          binding.receipt,
          {
            generation: binding.receipt.generation,
            nodes: await Promise.all(
              members.map(member => observe(member.node.path.lexical)),
            ),
          },
        );
        assertRevision();
      }
    },
    permission(inputPath: string) {
      assertRevision();
      const member = [...selected.values()].find(
        value =>
          value.node.path.lexical === inputPath ||
          value.node.path.canonical === inputPath,
      );
      return member
        ? rendererGeneratedOutputPermission(member.binding.receipt, inputPath)
        : undefined;
    },
    async withPublication<T>(callback: () => Promise<T>): Promise<T> {
      await pinned.assertCurrent();
      const result = await callback();
      await pinned.assertCurrent();
      return result;
    },
    release() {
      if (!active) return;
      active = false;
      releases++;
      leases.delete(pinned);
    },
  });
  leases.add(pinned);
  return {
    pinned,
    checks: () => checks,
    releases: () => releases,
    changeRevision: (revision: string) => {
      currentRevision = revision;
    },
  };
}

async function identify(
  options: RendererBuildIdentityOptions,
  pinned: RendererGeneratedOutputIdentityLease,
) {
  try {
    return await resolveRendererBuildIdentities({
      ...options,
      generatedOutputs: pinned,
    });
  } finally {
    pinned.release();
  }
}

function pauseFileRead(file: string) {
  const original = fs.readFile.bind(fs);
  let readReached!: () => void;
  const reached = new Promise<void>(resolve => {
    readReached = resolve;
  });
  let resume!: () => void;
  const gate = new Promise<void>(resolve => {
    resume = resolve;
  });
  let paused = false;
  const spy = rs.spyOn(fs, 'readFile').mockImplementation(((
    ...args: Parameters<typeof fs.readFile>
  ) => {
    const pending = original(...args);
    if (args[0] !== file || paused) return pending;
    paused = true;
    return pending.then(async bytes => {
      readReached();
      await gate;
      return bytes;
    });
  }) as typeof fs.readFile);
  return { reached, resume, restore: () => spy.mockRestore() };
}

describe('renderer identity with acknowledged generated outputs', () => {
  it('fully validates the pinned filesystem twice across a larger identity read', async () => {
    const options = await fixture();
    for (let index = 0; index < 40; index++)
      await write(
        path.join(options.projectRoot, 'src', `input-${index}.ts`),
        `export const input = ${index};\n`,
      );
    const binding = await generatedReceipt(options, 1, 'write', file =>
      write(file, 'export type Remote = "acknowledged";\n'),
    );
    const currentLease = lease(binding);
    await identify(options, currentLease.pinned);
    expect(currentLease.checks()).toBe(2);
    expect(currentLease.epochChecks()).toBeGreaterThan(40 * 6);
    expect(currentLease.releases()).toBe(1);
  });

  it('rejects same-size authored source mutation during its physical read with restored mtime', async () => {
    const options = await fixture();
    const binding = await generatedReceipt(options, 1, 'write', file =>
      write(file, 'export type Remote = "acknowledged";\n'),
    );
    const currentLease = lease(binding);
    const file = path.join(options.projectRoot, 'src', 'App.tsx');
    const originalStat = await fs.stat(file);
    const gate = pauseFileRead(file);
    const pending = identify(options, currentLease.pinned);
    try {
      await Promise.race([
        gate.reached,
        pending.then(() => {
          throw new Error('Identity completed before the physical read gate');
        }),
      ]);
      await write(file, 'export default () => <main>unsafe</main>;\n');
      await fs.utimes(
        file,
        originalStat.atimeMs / 1000,
        originalStat.mtimeMs / 1000,
      );
      expect((await fs.stat(file)).size).toBe(originalStat.size);
    } finally {
      gate.resume();
      try {
        await expect(pending).rejects.toThrow(
          'Renderer identity input changed while being read',
        );
      } finally {
        gate.restore();
      }
    }
    expect(currentLease.releases()).toBe(1);
  });

  it('rejects an actual pinned revision change across an asynchronous filesystem read', async () => {
    const options = await fixture();
    const binding = await generatedReceipt(options, 1, 'write', file =>
      write(file, 'export type Remote = "acknowledged";\n'),
    );
    const overlay = overlayLease([binding]);
    const gate = pauseFileRead(path.join(options.projectRoot, 'package.json'));
    const pending = identify(options, overlay.pinned);
    try {
      await Promise.race([
        gate.reached,
        pending.then(() => {
          throw new Error('Identity completed before the physical read gate');
        }),
      ]);
      overlay.changeRevision('host-overlay-3');
    } finally {
      gate.resume();
      try {
        await expect(pending).rejects.toThrow(
          'Generated output lease revision is stale.',
        );
      } finally {
        gate.restore();
      }
    }
    expect(overlay.checks()).toBe(1);
    expect(overlay.releases()).toBe(1);
  });

  it('changes the final identity when acknowledged generated bytes change', async () => {
    const options = await fixture();
    const first = await generatedReceipt(options, 1, 'write', file =>
      write(file, 'export type Remote = "first";\n'),
    );
    const firstLease = lease(first);
    const before = await identify(options, firstLease.pinned);
    const second = await generatedReceipt(options, 2, 'write', file =>
      write(file, 'export type Remote = "final";\n'),
    );
    const secondLease = lease(second);
    const after = await identify(options, secondLease.pinned);

    expect(after.inputDigest).not.toBe(before.inputDigest);
    expect(after.identities.main?.buildId).not.toBe(
      before.identities.main?.buildId,
    );
    expect(firstLease.releases()).toBe(1);
    expect(secondLease.releases()).toBe(1);
  });

  it('binds an acknowledged deletion to the final digest through its missing node', async () => {
    const options = await fixture();
    await write(
      path.join(options.projectRoot, '@mf-types/remote.d.ts'),
      'export type Remote = "obsolete";\n',
    );
    const deleted = await generatedReceipt(options, 2, 'delete', file =>
      fs.unlink(file),
    );
    expect(deleted.receipt.nodes[0]?.kind).toBe('missing');
    expect(
      rendererGeneratedOutputPermission(
        deleted.receipt,
        path.join(options.projectRoot, '@mf-types/remote.d.ts'),
      )?.kind,
    ).toBe('missing');
    const deletedLease = lease(deleted);
    const acknowledged = await identify(options, deletedLease.pinned);

    const emptyPlan = assertRendererGeneratedOutputOperationsAllowed(
      deleted.registration,
      [],
    );
    const emptyReceipt = validateRendererGeneratedOutputReceipt(
      deleted.registration,
      emptyPlan,
      {
        status: 'complete',
        registrationDigest: deleted.registration.registrationDigest,
        planDigest: emptyPlan.planDigest,
        generation: deleted.registration.generation,
        operations: [],
      },
      { generation: deleted.registration.generation, nodes: [] },
    );
    const emptyLease = lease({
      registration: deleted.registration,
      receipt: emptyReceipt,
    });
    const unacknowledged = await identify(options, emptyLease.pinned);

    expect(acknowledged.inputDigest).not.toBe(unacknowledged.inputDigest);
    expect(acknowledged.identities.main?.buildId).not.toBe(
      unacknowledged.identities.main?.buildId,
    );
    expect(deletedLease.releases()).toBe(1);
    expect(emptyLease.releases()).toBe(1);
  });

  it('keeps equal final bytes stable across operation, generation, revision and physical replacement', async () => {
    const options = await fixture();
    const bytes = 'export type Remote = "stable";\n';
    const first = await generatedReceipt(options, 1, 'write', file =>
      write(file, bytes),
    );
    const firstLease = lease(first);
    const before = await identify(options, firstLease.pinned);
    const second = await generatedReceipt(options, 7, 'write', async file => {
      const replacement = path.join(options.projectRoot, 'replacement.d.ts');
      await write(replacement, bytes);
      await fs.rename(replacement, file);
    });
    const firstNode = first.receipt.nodes[0];
    const secondNode = second.receipt.nodes[0];
    if (firstNode?.kind !== 'file' || secondNode?.kind !== 'file')
      throw new Error('Expected acknowledged files in both generations.');
    expect(second.registration.generation.operationId).not.toBe(
      first.registration.generation.operationId,
    );
    expect(second.registration.generation.generation).not.toBe(
      first.registration.generation.generation,
    );
    expect(second.registration.generation.revision).not.toBe(
      first.registration.generation.revision,
    );
    expect(secondNode.metadata.inode).not.toBe(firstNode.metadata.inode);
    expect(secondNode.metadata.ctimeNs).not.toBe(firstNode.metadata.ctimeNs);
    expect(second.receipt.receiptDigest).not.toBe(first.receipt.receiptDigest);
    const secondLease = lease(second);
    const after = await identify(options, secondLease.pinned);

    expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.identities.main?.buildId).toBe(
      before.identities.main?.buildId,
    );
    expect(firstLease.releases()).toBe(1);
    expect(secondLease.releases()).toBe(1);
  });

  it('keeps an unknown warm file under a registered destination as an ordinary input', async () => {
    const options = await fixture();
    const warmFile = path.join(options.projectRoot, '@mf-types/unknown.d.ts');
    await write(warmFile, 'export type Warm = "first";\n');
    const binding = await generatedReceipt(options, 1, 'write', file =>
      write(file, 'export type Remote = "acknowledged";\n'),
    );
    const firstLease = lease(binding);
    expect(firstLease.pinned.permission(warmFile)).toBeUndefined();
    const before = await identify(options, firstLease.pinned);
    await write(warmFile, 'export type Warm = "changed";\n');
    const secondLease = lease(binding);
    expect(secondLease.pinned.permission(warmFile)).toBeUndefined();
    const after = await identify(options, secondLease.pinned);

    expect(after.inputDigest).not.toBe(before.inputDigest);
    expect(after.identities.main?.buildId).not.toBe(
      before.identities.main?.buildId,
    );
    expect(firstLease.releases()).toBe(1);
    expect(secondLease.releases()).toBe(1);
  });

  it('rejects a stale receipt while an asynchronous identity read is in flight', async () => {
    const options = await fixture();
    const binding = await generatedReceipt(options, 1, 'write', file =>
      write(file, 'export type Remote = "acknowledged";\n'),
    );
    let readReached!: () => void;
    const readBoundary = new Promise<void>(resolve => {
      readReached = resolve;
    });
    let resumeRead!: () => void;
    const readGate = new Promise<void>(resolve => {
      resumeRead = resolve;
    });
    const currentLease = lease(binding, async checks => {
      // Full filesystem validation closes the asynchronous identity transaction.
      if (checks !== 2) return;
      readReached();
      await readGate;
    });
    const pending = identify(options, currentLease.pinned);
    const settled = pending.then(
      () => 'settled' as const,
      () => 'settled' as const,
    );
    try {
      const reached = await Promise.race([
        readBoundary.then(() => 'boundary' as const),
        settled,
      ]);
      if (reached !== 'boundary')
        throw new Error(
          'Identity settled before the asynchronous read boundary.',
        );
      await write(
        path.join(options.projectRoot, '@mf-types/remote.d.ts'),
        'export type Remote = "stale";\n',
      );
    } finally {
      resumeRead();
      await expect(pending).rejects.toThrow(
        'generated node bytes, metadata or physical path changed',
      );
    }
    expect(currentLease.checks()).toBe(2);
    expect(currentLease.releases()).toBe(1);
  });

  it('rejects a fabricated clone of a validated receipt', async () => {
    const options = await fixture();
    const binding = await generatedReceipt(options, 1, 'write', file =>
      write(file, 'export type Remote = "acknowledged";\n'),
    );
    const clonedReceipt = structuredClone(binding.receipt);
    expect(clonedReceipt).toEqual(binding.receipt);
    const clonedLease = lease({
      registration: binding.registration,
      receipt: clonedReceipt,
    });

    await expect(identify(options, clonedLease.pinned)).rejects.toThrow(
      'receipt has not been validated for this registration',
    );
    expect(clonedLease.releases()).toBe(1);
  });

  it('uses the selected final nodes across whole receipts without hashing operation history', async () => {
    const options = await fixture();
    const x = path.join(options.projectRoot, '@mf-types/x.d.ts');
    const y = path.join(options.projectRoot, '@mf-types/y.d.ts');
    const first = await generatedFilesReceipt(options, 1, [
      { name: 'x.d.ts', bytes: 'export type X = "first";\n' },
      { name: 'y.d.ts', bytes: 'export type Y = "stable";\n' },
    ]);
    const second = await generatedFilesReceipt(options, 2, [
      { name: 'x.d.ts', bytes: 'export type X = "final";\n' },
    ]);
    const overlay = overlayLease([first, second]);
    expect(overlay.pinned.receipts).toHaveLength(2);
    expect(overlay.pinned.receipts[0]?.receipt).toBe(first.receipt);
    expect(overlay.pinned.receipts[1]?.receipt).toBe(second.receipt);
    expect(overlay.pinned.permission(x)).toBe(second.receipt.nodes[0]);
    expect(overlay.pinned.permission(y)).toBe(first.receipt.nodes[1]);
    const currentFirstNodes = await Promise.all([observe(x), observe(y)]);
    expect(() =>
      assertRendererGeneratedOutputReceiptCurrent(
        first.registration,
        first.receipt,
        { generation: first.receipt.generation, nodes: currentFirstNodes },
      ),
    ).toThrow('generated node bytes, metadata or physical path changed');
    const overlaid = await identify(options, overlay.pinned);

    await Promise.all([fs.unlink(x), fs.unlink(y)]);
    // The single receipt lists x,y, opposite the overlay's selected y,x order.
    const current = await generatedFilesReceipt(options, 9, [
      { name: 'x.d.ts', bytes: 'export type X = "final";\n' },
      { name: 'y.d.ts', bytes: 'export type Y = "stable";\n' },
    ]);
    expect(current.registration.producer).toEqual(first.registration.producer);
    expect(current.registration.effectiveOptions).toEqual(
      first.registration.effectiveOptions,
    );
    expect(current.registration.destinations).toEqual(
      first.registration.destinations,
    );
    const currentLease = lease(current);
    const singleReceipt = await identify(options, currentLease.pinned);

    expect(overlaid.inputDigest).toBe(singleReceipt.inputDigest);
    expect(overlaid.identities.main?.buildId).toBe(
      singleReceipt.identities.main?.buildId,
    );
    expect(overlay.releases()).toBe(1);
    expect(currentLease.releases()).toBe(1);
  });

  it('rejects an overlay revision change during an awaited identity read', async () => {
    const options = await fixture();
    const first = await generatedFilesReceipt(options, 1, [
      { name: 'x.d.ts', bytes: 'export type X = "first";\n' },
      { name: 'y.d.ts', bytes: 'export type Y = "stable";\n' },
    ]);
    const second = await generatedFilesReceipt(options, 2, [
      { name: 'x.d.ts', bytes: 'export type X = "final";\n' },
    ]);
    let readReached!: () => void;
    const readBoundary = new Promise<void>(resolve => {
      readReached = resolve;
    });
    let resumeRead!: () => void;
    const readGate = new Promise<void>(resolve => {
      resumeRead = resolve;
    });
    const overlay = overlayLease([first, second], async checks => {
      if (checks !== 2) return;
      readReached();
      await readGate;
    });
    const pending = identify(options, overlay.pinned);
    const settled = pending.then(
      () => 'settled' as const,
      () => 'settled' as const,
    );
    try {
      const reached = await Promise.race([
        readBoundary.then(() => 'boundary' as const),
        settled,
      ]);
      if (reached !== 'boundary')
        throw new Error(
          'Identity settled before the asynchronous read boundary.',
        );
      overlay.changeRevision('host-overlay-3');
      expect(overlay.pinned.revision).toBe('host-overlay-2');
    } finally {
      resumeRead();
      await expect(pending).rejects.toThrow(
        'Generated output lease revision is stale.',
      );
    }
    expect(overlay.checks()).toBe(2);
    expect(overlay.releases()).toBe(1);
  });
});
