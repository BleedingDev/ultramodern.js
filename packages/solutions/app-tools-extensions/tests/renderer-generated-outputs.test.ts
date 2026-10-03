import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  assertRendererGeneratedOutputAcknowledgementProgress,
  assertRendererGeneratedOutputInheritedNodeProgress,
  assertRendererGeneratedOutputNextOperationsCurrent,
  assertRendererGeneratedOutputNodesConsistent,
  assertRendererGeneratedOutputOperationsAllowed,
  assertRendererGeneratedOutputReceiptCurrent,
  assertRendererGeneratedOutputReceiptNodesCurrent,
  immutableRendererGeneratedOutputRegistration,
  type RendererGeneratedOutputAcknowledgement,
  type RendererGeneratedOutputCompletion,
  type RendererGeneratedOutputNode,
  type RendererGeneratedOutputOperation,
  type RendererGeneratedOutputPath,
  type RendererGeneratedOutputRegistration,
  type RendererGeneratedOutputRegistrationInput,
  rendererGeneratedOutputPermission,
  validateRendererGeneratedOutputReceipt,
} from '../src/renderer-generated-outputs';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const pair = (
  lexical: string,
  canonical = lexical,
): RendererGeneratedOutputPath => ({ lexical, canonical });
const destination = (
  lexical: string,
  canonical = lexical,
  scope: 'exact' | 'subtree' = 'subtree',
  kind: 'file' | 'directory' = 'directory',
) => ({ path: pair(lexical, canonical), scope, kind });
const missing = (
  value: string,
  canonical = value,
): Extract<RendererGeneratedOutputNode, { kind: 'missing' }> => ({
  path: pair(value, canonical),
  kind: 'missing',
});
const metadata = (value: string) => ({
  device: '42',
  inode: sha(value),
  size: 12,
  modifiedTime: 1234,
});
const file = (
  value: string,
  content = 'generated',
  canonical = value,
): Extract<RendererGeneratedOutputNode, { kind: 'file' }> => ({
  path: pair(value, canonical),
  kind: 'file',
  byteDigest: sha(content),
  metadata: metadata(canonical),
});
const directory = (
  value: string,
  entries: readonly {
    name: string;
    kind: 'file' | 'directory' | 'symlink';
  }[] = [],
): Extract<RendererGeneratedOutputNode, { kind: 'directory' }> => ({
  path: pair(value),
  kind: 'directory',
  entries,
  metadata: metadata(value),
});

function input(
  overrides: Partial<RendererGeneratedOutputRegistrationInput> = {},
): RendererGeneratedOutputRegistrationInput {
  return {
    schemaVersion: 1,
    id: 'native-types',
    pathFlavor: 'posix',
    producer: {
      packageName: '@module-federation/dts-plugin',
      version: '2.9.1',
      packageDirectory: '/packages/dts-plugin',
      modulePath: '/packages/dts-plugin/dist/index.js',
      moduleDigest: sha('physical module'),
    },
    consumer: { id: 'app-host', projectRoot: '/app' },
    generation: {
      operationId: 'consume-native-types',
      compilerId: 'client',
      generation: 1,
      revision: 'native-compile-1',
    },
    effectiveOptions: { typesFolder: '@mf-types', consumeTypes: true },
    context: { mode: 'development', remotes: ['remote'] },
    destinations: [destination('/app/@mf-types')],
    authoredPaths: [pair('/app/src/App.tsx')],
    protectedInputs: [],
    ...overrides,
  };
}

const register = (
  overrides: Partial<RendererGeneratedOutputRegistrationInput> = {},
) => immutableRendererGeneratedOutputRegistration(input(overrides));
const write = (
  before: RendererGeneratedOutputNode,
): RendererGeneratedOutputOperation => ({
  operation: 'write',
  kind: 'file',
  before,
});
const deletion = (
  before: RendererGeneratedOutputNode,
): RendererGeneratedOutputOperation => ({
  operation: 'delete',
  kind: before.kind === 'directory' ? 'directory' : 'file',
  before,
});

function complete(
  registration: RendererGeneratedOutputRegistration,
  operations: readonly RendererGeneratedOutputAcknowledgement[],
) {
  const plan = assertRendererGeneratedOutputOperationsAllowed(
    registration,
    operations.map(({ after: _after, ...operation }) => operation),
  );
  const completion: RendererGeneratedOutputCompletion = {
    status: 'complete',
    registrationDigest: registration.registrationDigest,
    planDigest: plan.planDigest,
    generation: registration.generation,
    operations,
  };
  const nodes = operations
    .filter(
      (operation, index) =>
        !operations
          .slice(index + 1)
          .some(
            later => later.after.path.lexical === operation.after.path.lexical,
          ),
    )
    .map(operation => operation.after);
  const current = { generation: registration.generation, nodes };
  const receipt = validateRendererGeneratedOutputReceipt(
    registration,
    plan,
    completion,
    current,
  );
  return { plan, completion, current, receipt };
}

describe('native renderer generated output evidence', () => {
  it('checks a selected exact subset without treating obsolete nodes as current', () => {
    const registration = register();
    const first = file('/app/@mf-types/alpha.d.ts', 'first');
    const untouched = file('/app/@mf-types/beta.d.ts', 'untouched');
    const { receipt } = complete(registration, [
      { ...write(missing(first.path.lexical)), after: first },
      { ...write(missing(untouched.path.lexical)), after: untouched },
    ]);
    expect(() =>
      assertRendererGeneratedOutputReceiptNodesCurrent(registration, receipt, {
        generation: registration.generation,
        nodes: [untouched],
      }),
    ).not.toThrow();
    expect(receipt.nodes).toHaveLength(2);
    expect(() =>
      assertRendererGeneratedOutputReceiptCurrent(registration, receipt, {
        generation: registration.generation,
        nodes: [untouched],
      }),
    ).toThrow('incomplete');
    expect(() =>
      assertRendererGeneratedOutputReceiptNodesCurrent(registration, receipt, {
        generation: registration.generation,
        nodes: [file(untouched.path.lexical, 'unacknowledged')],
      }),
    ).toThrow('unchanged exact member');
  });

  it('never grants membership to a copied receipt, unknown node or stale epoch', () => {
    const registration = register();
    const node = file('/app/@mf-types/alpha.d.ts');
    const { receipt, current } = complete(registration, [
      { ...write(missing(node.path.lexical)), after: node },
    ]);
    expect(() =>
      assertRendererGeneratedOutputReceiptNodesCurrent(
        registration,
        { ...receipt },
        current,
      ),
    ).toThrow('not been validated');
    expect(() =>
      assertRendererGeneratedOutputReceiptNodesCurrent(registration, receipt, {
        ...current,
        nodes: [file('/app/@mf-types/unknown.d.ts')],
      }),
    ).toThrow('unchanged exact member');
    expect(() =>
      assertRendererGeneratedOutputReceiptNodesCurrent(registration, receipt, {
        ...current,
        generation: { ...registration.generation, generation: 2 },
      }),
    ).toThrow('stale');
    expect(() =>
      assertRendererGeneratedOutputReceiptNodesCurrent(
        register(),
        receipt,
        current,
      ),
    ).toThrow('not been validated');
  });

  it('checks the combined graph for conflicting parents, aliases and physical nodes', () => {
    const registration = register();
    const parent = directory('/app/@mf-types', [
      { name: 'alpha.d.ts', kind: 'file' },
    ]);
    const child = file('/app/@mf-types/alpha.d.ts');
    expect(() =>
      assertRendererGeneratedOutputNodesConsistent(registration, {
        generation: registration.generation,
        nodes: [parent, child],
      }),
    ).not.toThrow();
    expect(() =>
      assertRendererGeneratedOutputNodesConsistent(registration, {
        generation: registration.generation,
        nodes: [parent, missing(child.path.lexical)],
      }),
    ).toThrow('contradicts');
    expect(() =>
      assertRendererGeneratedOutputNodesConsistent(registration, {
        generation: registration.generation,
        nodes: [child, { ...child, path: pair('/app/@mf-types/other.d.ts') }],
      }),
    ).toThrow('overlap');
    expect(() =>
      assertRendererGeneratedOutputNodesConsistent(registration, {
        generation: registration.generation,
        nodes: [
          child,
          file('/app/@mf-types/alias.d.ts', 'generated', child.path.canonical),
        ],
      }),
    ).toThrow('non-directory ancestor');
  });

  it('acknowledges a surviving parent only as an exact native child-create effect', () => {
    const registration = register();
    const before = missing('/app/@mf-types/alpha.d.ts');
    const child = file(before.path.lexical);
    const parentBefore = directory('/app/@mf-types');
    const parentAfter = directory('/app/@mf-types', [
      { name: 'alpha.d.ts', kind: 'file' },
    ]);
    const effect = {
      operation: 'write',
      kind: 'directory',
      before: parentBefore,
      cause: { operation: 'openSync', paths: [before.path] },
    } as const;
    const { receipt, current } = complete(registration, [
      { ...write(before), after: child },
      { ...effect, after: parentAfter },
    ]);
    assertRendererGeneratedOutputReceiptCurrent(registration, receipt, current);
    expect(
      rendererGeneratedOutputPermission(receipt, parentAfter.path.lexical),
    ).toEqual(parentAfter);
    expect(
      rendererGeneratedOutputPermission(receipt, '/app/@mf-types/unknown'),
    ).toBeUndefined();
  });

  it('acknowledges native rm parent effects without crediting an unrelated sibling', () => {
    const registration = register();
    const child = file('/app/@mf-types/alpha.d.ts');
    const parentBefore = directory('/app/@mf-types', [
      { name: 'alpha.d.ts', kind: 'file' },
    ]);
    const effect = {
      operation: 'write',
      kind: 'directory',
      before: parentBefore,
      cause: { operation: 'rm', paths: [child.path] },
    } as const;
    const removed = { ...deletion(child), after: missing(child.path.lexical) };
    expect(() =>
      complete(registration, [
        removed,
        { ...effect, after: directory('/app/@mf-types') },
      ]),
    ).not.toThrow();
    expect(() =>
      complete(registration, [
        removed,
        {
          ...effect,
          after: directory('/app/@mf-types', [
            { name: 'unknown.d.ts', kind: 'file' },
          ]),
        },
      ]),
    ).toThrow('unacknowledged');
  });

  it('rejects a fabricated causal child, replaced parent or unbound directory effect', () => {
    const registration = register();
    const parentBefore = directory('/app/@mf-types');
    const effect = {
      operation: 'write',
      kind: 'directory',
      before: parentBefore,
      cause: {
        operation: 'openSync',
        paths: [pair('/app/@mf-types/alpha.d.ts')],
      },
    } as const;
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, [effect]),
    ).toThrow('preceding planned');
    const childBefore = missing('/app/@mf-types/alpha.d.ts');
    const childAfter = file(childBefore.path.lexical);
    const parentAfter = directory('/app/@mf-types', [
      { name: 'alpha.d.ts', kind: 'file' },
    ]);
    expect(() =>
      complete(registration, [
        { ...write(childBefore), after: childAfter },
        {
          ...effect,
          after: {
            ...parentAfter,
            metadata: { device: '42', inode: 'replaced' },
          },
        },
      ]),
    ).toThrow('replacement');
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, [
        write(childBefore),
        {
          ...effect,
          cause: {
            operation: 'openSync',
            paths: [pair('/app/unknown/alpha.d.ts')],
          },
        },
      ]),
    ).toThrow('immediate');
  });

  it('allows a cold exact child effect without changing authored siblings or observed parents', () => {
    const root = directory('/app', [
      { name: 'package.json', kind: 'file' },
      { name: 'src', kind: 'directory' },
    ]);
    const childBefore = missing('/app/@mf-types');
    const childAfter = directory('/app/@mf-types');
    const operations = [
      {
        operation: 'write',
        kind: 'directory',
        before: childBefore,
        after: childAfter,
      },
      {
        operation: 'write',
        kind: 'directory',
        before: root,
        cause: { operation: 'mkdirSync', paths: [childBefore.path] },
        after: directory('/app', [
          ...root.entries,
          { name: '@mf-types', kind: 'directory' },
        ]),
      },
    ] as const;
    const options = {
      destinations: [
        destination('/app/@mf-types'),
        destination('/app', '/app', 'exact'),
      ],
      authoredPaths: [pair('/app/package.json'), pair('/app/src/App.tsx')],
      protectedInputs: [
        { observation: 'content', node: file('/app/package.json') },
      ],
    } as const;
    const registration = register(options);
    const { receipt } = complete(registration, operations);
    expect(
      rendererGeneratedOutputPermission(receipt, '/app/src/App.tsx'),
    ).toBeUndefined();
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, [
        { operation: 'write', kind: 'directory', before: root },
      ]),
    ).toThrow('authored or tracked input ancestor');
    for (const observation of ['directory', 'metadata', 'existence'] as const)
      expect(() =>
        complete(
          register({
            ...options,
            protectedInputs: [{ observation, node: root }],
          }),
          operations,
        ),
      ).toThrow('observed');
    expect(() =>
      complete(registration, [
        operations[0],
        {
          ...operations[1],
          after: directory('/app', [{ name: '@mf-types', kind: 'directory' }]),
        },
      ]),
    ).toThrow('unacknowledged');
  });

  it('preserves exact parent continuity across native remove and recreate batches', () => {
    const registration = register();
    const name = '/app/@mf-types/remote';
    const child = directory(name);
    const original = directory('/app/@mf-types', [
      { name: 'remote', kind: 'directory' },
    ]);
    const removed = { ...deletion(child), after: missing(name) };
    const afterRemove = directory('/app/@mf-types');
    const removeEffect = {
      operation: 'write',
      kind: 'directory',
      before: original,
      cause: { operation: 'rm', paths: [child.path] },
      after: afterRemove,
    } as const;
    const recreated = {
      operation: 'write',
      kind: 'directory',
      before: missing(name),
      after: child,
    } as const;
    const createEffect = {
      operation: 'write',
      kind: 'directory',
      before: afterRemove,
      cause: { operation: 'mkdirSync', paths: [child.path] },
      after: original,
    } as const;
    expect(() =>
      complete(registration, [removed, removeEffect, recreated, createEffect]),
    ).not.toThrow();
    const acknowledgements = [removed, removeEffect];
    const plan = assertRendererGeneratedOutputOperationsAllowed(
      registration,
      acknowledgements.map(({ after: _after, ...operation }) => operation),
    );
    expect(() =>
      assertRendererGeneratedOutputInheritedNodeProgress(
        registration,
        original,
        createEffect,
        plan,
        acknowledgements,
      ),
    ).not.toThrow();
    for (const before of [
      directory('/app/@mf-types', [{ name: 'unknown', kind: 'file' }]),
      {
        ...afterRemove,
        metadata: { ...metadata('/app/@mf-types'), inode: 'replacement' },
      },
    ])
      expect(() =>
        assertRendererGeneratedOutputInheritedNodeProgress(
          registration,
          original,
          { ...createEffect, before },
          plan,
          acknowledgements,
        ),
      ).toThrow();
    expect(() =>
      assertRendererGeneratedOutputInheritedNodeProgress(
        registration,
        original,
        createEffect,
        { ...plan },
        acknowledgements,
      ),
    ).toThrow('different registration');
    expect(() =>
      assertRendererGeneratedOutputInheritedNodeProgress(
        registration,
        original,
        createEffect,
        plan,
        acknowledgements.slice(0, 1),
      ),
    ).toThrow('completed preceding');
  });
  it('detaches and freezes producer, options, input, plan and receipt values', () => {
    const authored = { ...input(), effectiveOptions: { consumeTypes: true } };
    const registration = immutableRendererGeneratedOutputRegistration(authored);
    const before = missing('/app/@mf-types/remote.d.ts');
    const after = file('/app/@mf-types/remote.d.ts');
    const acknowledgements = [{ ...write(before), after }];
    const { receipt, plan, current } = complete(registration, acknowledgements);
    const previousDigest = registration.registrationDigest;
    authored.effectiveOptions.consumeTypes = false;
    acknowledgements.length = 0;
    expect(registration.registrationDigest).toBe(previousDigest);
    expect(registration.effectiveOptions).toEqual({ consumeTypes: true });
    for (const value of [
      registration,
      registration.producer,
      registration.effectiveOptions,
      registration.protectedInputs,
      plan,
      plan.operations,
      receipt,
      receipt.operations,
      receipt.operations[0]?.after,
    ])
      expect(Object.isFrozen(value)).toBe(true);
    assertRendererGeneratedOutputReceiptCurrent(registration, receipt, current);
  });

  it('binds all physical producer, consumer, option and generation fields', () => {
    const original = register();
    for (const change of [
      { id: 'other' },
      { producer: { ...original.producer, version: '2.9.2' } },
      {
        producer: {
          ...original.producer,
          moduleDigest: sha('other physical bytes'),
        },
      },
      { consumer: { ...original.consumer, id: 'other-host' } },
      { effectiveOptions: { consumeTypes: false } },
      { context: { mode: 'production' } },
      { generation: { ...original.generation, compilerId: 'server' } },
      { generation: { ...original.generation, generation: 2 } },
      { generation: { ...original.generation, revision: 'native-compile-2' } },
    ])
      expect(register(change).registrationDigest).not.toBe(
        original.registrationDigest,
      );
    expect(() =>
      register({ producer: { ...original.producer, version: '^2.9.1' } }),
    ).toThrow('version must be exact');
    expect(() =>
      register({
        producer: { ...original.producer, modulePath: '/other/index.js' },
      }),
    ).toThrow('physical package');
    expect(() =>
      register({ generation: { ...original.generation, generation: 0 } }),
    ).toThrow('positive safe integer');
  });

  it('does not invoke own or nested array getters', () => {
    let calls = 0;
    const accessor = {
      get unsafe() {
        calls++;
        return 'executed';
      },
    };
    const array = [1];
    Object.defineProperty(array, '0', {
      enumerable: true,
      get() {
        calls++;
        return 1;
      },
    });
    for (const value of [accessor, array])
      expect(() => register({ effectiveOptions: value })).toThrow('accessors');
    const topLevel = input();
    Object.defineProperty(topLevel, 'producer', {
      enumerable: true,
      get() {
        calls++;
        return {};
      },
    });
    expect(() =>
      immutableRendererGeneratedOutputRegistration(topLevel),
    ).toThrow('accessors');
    expect(calls).toBe(0);
  });

  it('requires explicit effective options and context, allowing explicit null', () => {
    const { effectiveOptions: _options, ...withoutOptions } = input();
    const { context: _context, ...withoutContext } = input();
    for (const value of [withoutOptions, withoutContext])
      expect(() =>
        immutableRendererGeneratedOutputRegistration(
          value as RendererGeneratedOutputRegistrationInput,
        ),
      ).toThrow('declared evidence structure');
    expect(
      register({ effectiveOptions: null, context: null }).context,
    ).toBeNull();
  });

  it('rejects unsupported, sparse, symbolic, hidden, cyclic and rich data', () => {
    const sparse = new Array(2);
    const custom = Object.assign([1], { extra: 2 });
    const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
    const symbolic = { [Symbol('hidden')]: 1 };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const values = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      () => true,
      new Date(),
      new Map(),
      /rich/u,
      sparse,
      custom,
      hidden,
      symbolic,
      cyclic,
      Object.create({ inherited: true }),
      Object.create(Array.prototype),
    ];
    for (const value of values)
      expect(() =>
        register({
          effectiveOptions:
            value as RendererGeneratedOutputRegistrationInput['effectiveOptions'],
        }),
      ).toThrow();
  });

  it('handles an own __proto__ data key without changing prototypes', () => {
    const options = JSON.parse(
      '{"__proto__":{"polluted":true},"enabled":true}',
    );
    const registration = register({ effectiveOptions: options });
    expect(Object.getPrototypeOf(registration.effectiveOptions)).toBe(
      Object.prototype,
    );
    expect(
      Object.hasOwn(registration.effectiveOptions as object, '__proto__'),
    ).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('permissions acknowledge only exact nodes, including deleted nodes', () => {
    const registration = register();
    const dir = directory('/app/@mf-types/remote', [
      { name: 'warm.d.ts', kind: 'file' },
    ]);
    const { receipt } = complete(registration, [
      {
        operation: 'write',
        kind: 'directory',
        before: dir,
        after: dir,
      },
      {
        ...write(missing('/app/@mf-types/new.d.ts')),
        after: file('/app/@mf-types/new.d.ts'),
      },
      {
        ...deletion(file('/app/@mf-types/deleted.d.ts')),
        after: missing('/app/@mf-types/deleted.d.ts'),
      },
    ]);
    expect(
      rendererGeneratedOutputPermission(receipt, '/app/@mf-types/remote'),
    ).toBeDefined();
    expect(
      rendererGeneratedOutputPermission(receipt, '/app/@mf-types/new.d.ts'),
    ).toBeDefined();
    expect(
      rendererGeneratedOutputPermission(receipt, '/app/@mf-types/deleted.d.ts')
        ?.kind,
    ).toBe('missing');
    expect(
      rendererGeneratedOutputPermission(
        receipt,
        '/app/@mf-types/remote/warm.d.ts',
      ),
    ).toBeUndefined();
    expect(
      rendererGeneratedOutputPermission(
        receipt,
        '/app/@mf-types/new.d.ts/unknown',
      ),
    ).toBeUndefined();
    expect(
      rendererGeneratedOutputPermission(
        receipt,
        '/app/@mf-types/old-warm.d.ts',
      ),
    ).toBeUndefined();
  });

  it('preserves ordered repeated writes and deletion/recreation, with unique final observations', () => {
    const registration = register();
    const name = '/app/@mf-types/repeated';
    const first = file(name, 'first');
    const second = file(name, 'second');
    const gone = missing(name);
    const final = directory(name);
    const { receipt, current } = complete(registration, [
      { ...write(missing(name)), after: first },
      { ...write(first), after: second },
      { ...deletion(second), after: gone },
      { operation: 'write', kind: 'directory', before: gone, after: final },
    ]);
    expect(receipt.operations).toHaveLength(4);
    expect(current.nodes).toHaveLength(1);
    expect(rendererGeneratedOutputPermission(receipt, name)?.kind).toBe(
      'directory',
    );
    const invalid = [
      { ...write(missing(name)), after: first },
      { ...write(file(name, 'unobserved transition')), after: second },
    ];
    expect(() => complete(registration, invalid)).toThrow('discontinuous');
  });

  it('rejects output type changes, missing deletions and lexical or canonical escapes before writing', () => {
    const registration = register();
    for (const operation of [
      write(directory('/app/@mf-types/dir')),
      deletion(missing('/app/@mf-types/absent')),
      write(missing('/app/@mf-types-other/out.d.ts')),
      write(missing('/app/@mf-types/out.d.ts', '/outside/out.d.ts')),
    ])
      expect(() =>
        assertRendererGeneratedOutputOperationsAllowed(registration, [
          operation,
        ]),
      ).toThrow();
  });

  it('allows only the selected alias subtree, exact host index and exact ancestor nodes', () => {
    const root = '/app/@mf-types';
    const registration = register({
      destinations: [
        destination(`${root}/remote`),
        destination(
          `${root}/index.d.ts`,
          `${root}/index.d.ts`,
          'exact',
          'file',
        ),
        destination(root, root, 'exact', 'directory'),
      ],
    });
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, [
        { operation: 'write', kind: 'directory', before: missing(root) },
      ]),
    ).not.toThrow();
    for (const name of [`${root}/remote/types.d.ts`, `${root}/index.d.ts`])
      expect(() =>
        assertRendererGeneratedOutputOperationsAllowed(registration, [
          write(missing(name)),
        ]),
      ).not.toThrow();
    for (const name of [
      `${root}/sibling.d.ts`,
      `${root}/index.d.ts/child`,
      `${root}/other/types.d.ts`,
    ])
      expect(() =>
        assertRendererGeneratedOutputOperationsAllowed(registration, [
          write(missing(name)),
        ]),
      ).toThrow('escapes');
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, [
        write(missing(root)),
      ]),
    ).toThrow('escapes');
    const authoredRoot = register({
      destinations: [destination('/app', '/app', 'exact', 'directory')],
    });
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(authoredRoot, [
        deletion(directory('/app')),
      ]),
    ).toThrow('authored or tracked');
  });

  it('appends validated batches before IO and preserves immediate directory acknowledgements', () => {
    const registration = register();
    const root = '/app/@mf-types/remote';
    const child = `${root}/types.d.ts`;
    const mkdir = {
      operation: 'write' as const,
      kind: 'directory' as const,
      before: missing(root),
    };
    const created = directory(root);
    const childWrite = write(missing(child));
    const generated = file(child);
    const first = assertRendererGeneratedOutputOperationsAllowed(registration, [
      mkdir,
    ]);
    const second = assertRendererGeneratedOutputOperationsAllowed(
      registration,
      [childWrite],
      first,
    );
    const updated = {
      ...directory(root, [{ name: 'types.d.ts', kind: 'file' }]),
      metadata: { ...metadata(root), modifiedTime: 2345 },
    };
    const repeatMkdir = {
      operation: 'write' as const,
      kind: 'directory' as const,
      before: updated,
    };
    const plan = assertRendererGeneratedOutputOperationsAllowed(
      registration,
      [repeatMkdir],
      second,
    );
    const operations = [
      { ...mkdir, after: created },
      { ...childWrite, after: generated },
      { ...repeatMkdir, after: updated },
    ];
    const completion = {
      status: 'complete' as const,
      registrationDigest: registration.registrationDigest,
      planDigest: plan.planDigest,
      generation: registration.generation,
      operations,
    };
    const current = {
      generation: registration.generation,
      nodes: [updated, generated],
    };
    const receipt = validateRendererGeneratedOutputReceipt(
      registration,
      plan,
      completion,
      current,
    );
    expect(plan.operations).toHaveLength(3);
    expect(receipt.operations[0]?.after).toEqual(created);
    expect(receipt.nodes).toEqual([updated, generated]);
    expect(rendererGeneratedOutputPermission(receipt, root)).toEqual(updated);
    assertRendererGeneratedOutputReceiptCurrent(registration, receipt, current);
    const noRepeatedMkdir = {
      ...completion,
      planDigest: second.planDigest,
      operations: operations.slice(0, 2),
    };
    expect(
      validateRendererGeneratedOutputReceipt(
        registration,
        second,
        noRepeatedMkdir,
        current,
      ).nodes,
    ).toEqual([updated, generated]);
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(register(), [], plan),
    ).toThrow('different registration');
  });

  it('rejects contradictory final directory listings and exact child states', () => {
    const registration = register();
    const root = '/app/@mf-types/remote';
    const child = `${root}/types.d.ts`;
    const mkdir = {
      operation: 'write' as const,
      kind: 'directory' as const,
      before: missing(root),
    };
    const childWrite = write(missing(child));
    const plan = assertRendererGeneratedOutputOperationsAllowed(registration, [
      mkdir,
      childWrite,
    ]);
    const operations = [
      { ...mkdir, after: directory(root) },
      { ...childWrite, after: file(child) },
    ];
    const completion = {
      status: 'complete' as const,
      registrationDigest: registration.registrationDigest,
      planDigest: plan.planDigest,
      generation: registration.generation,
      operations,
    };
    expect(() =>
      validateRendererGeneratedOutputReceipt(registration, plan, completion, {
        generation: registration.generation,
        nodes: [directory(root), file(child)],
      }),
    ).toThrow('contradicts');
  });

  it('validates ordered acknowledgement prefixes without minting incomplete receipts', () => {
    const registration = register();
    const first = {
      ...write(missing('/app/@mf-types/a.d.ts')),
      after: file('/app/@mf-types/a.d.ts'),
    };
    const second = {
      ...write(missing('/app/@mf-types/b.d.ts')),
      after: file('/app/@mf-types/b.d.ts'),
    };
    const plan = assertRendererGeneratedOutputOperationsAllowed(
      registration,
      [first, second].map(({ after: _after, ...operation }) => operation),
    );
    for (const prefix of [[], [first], [first, second]])
      expect(() =>
        assertRendererGeneratedOutputAcknowledgementProgress(
          registration,
          plan,
          prefix,
        ),
      ).not.toThrow();
    for (const wrong of [
      [second],
      [first, second, second],
      [{ ...first, after: missing('/app/@mf-types/a.d.ts') }],
    ])
      expect(() =>
        assertRendererGeneratedOutputAcknowledgementProgress(
          registration,
          plan,
          wrong,
        ),
      ).toThrow();
    expect(() =>
      assertRendererGeneratedOutputAcknowledgementProgress(
        registration,
        { ...plan },
        [first],
      ),
    ).toThrow('different registration');
    expect(() =>
      validateRendererGeneratedOutputReceipt(
        registration,
        plan,
        {
          status: 'complete',
          registrationDigest: registration.registrationDigest,
          planDigest: plan.planDigest,
          generation: registration.generation,
          operations: [first],
        },
        { generation: registration.generation, nodes: [first.after] },
      ),
    ).toThrow('partial');
  });

  it('rejects stale bytes and metadata before the next native operation', () => {
    const registration = register();
    const name = '/app/@mf-types/a.d.ts';
    const first = { ...write(missing(name)), after: file(name, 'first') };
    const plan = assertRendererGeneratedOutputOperationsAllowed(registration, [
      write(first.before),
    ]);
    for (const stale of [
      file(name, 'foreign bytes'),
      {
        ...file(name, 'first'),
        metadata: { ...metadata(name), inode: 'replacement' },
      },
    ])
      expect(() =>
        assertRendererGeneratedOutputNextOperationsCurrent(
          registration,
          plan,
          [first],
          [write(stale)],
        ),
      ).toThrow('next operation');
    const next = assertRendererGeneratedOutputNextOperationsCurrent(
      registration,
      plan,
      [first],
      [write(first.after)],
    );
    expect(next.operations).toHaveLength(2);
  });

  it('permits independent pending IO while blocking overlapping next nodes', () => {
    const registration = register();
    const first = write(missing('/app/@mf-types/a.d.ts'));
    const plan = assertRendererGeneratedOutputOperationsAllowed(registration, [
      first,
    ]);
    expect(
      assertRendererGeneratedOutputNextOperationsCurrent(
        registration,
        plan,
        [],
        [write(missing('/app/@mf-types/b.d.ts'))],
      ).operations,
    ).toHaveLength(2);
    expect(() =>
      assertRendererGeneratedOutputNextOperationsCurrent(
        registration,
        plan,
        [],
        [first],
      ),
    ).toThrow('unacknowledged native IO');
    expect(() =>
      assertRendererGeneratedOutputNextOperationsCurrent(
        registration,
        plan,
        [],
        [deletion(directory('/app/@mf-types'))],
      ),
    ).toThrow('unacknowledged native IO');
  });

  it('checks next directory before-states against genuine child progress and static metadata', () => {
    const registration = register();
    const root = '/app/@mf-types/remote';
    const child = `${root}/types.d.ts`;
    const original = {
      ...directory(root),
      metadata: { ...metadata(root), mode: 0o755 },
    };
    const first = {
      operation: 'write' as const,
      kind: 'directory' as const,
      before: missing(root),
      after: original,
    };
    const second = { ...write(missing(child)), after: file(child) };
    const acknowledgements = [first, second];
    const plan = assertRendererGeneratedOutputOperationsAllowed(
      registration,
      acknowledgements.map(({ after: _after, ...operation }) => operation),
    );
    const updated = {
      ...directory(root, [{ name: 'types.d.ts', kind: 'file' }]),
      metadata: { ...original.metadata, modifiedTime: 2345 },
    };
    const operation = {
      operation: 'write' as const,
      kind: 'directory' as const,
      before: updated,
    };
    expect(
      assertRendererGeneratedOutputNextOperationsCurrent(
        registration,
        plan,
        acknowledgements,
        [operation],
      ).operations,
    ).toHaveLength(3);
    expect(() =>
      assertRendererGeneratedOutputNextOperationsCurrent(
        registration,
        plan,
        acknowledgements,
        [
          {
            ...operation,
            before: {
              ...updated,
              metadata: { ...updated.metadata, mode: 0o700 },
            },
          },
        ],
      ),
    ).toThrow('stable metadata');
    expect(() =>
      assertRendererGeneratedOutputNextOperationsCurrent(
        registration,
        plan,
        acknowledgements,
        [{ ...operation, before: original }],
      ),
    ).toThrow('known child');
  });

  it('rejects a reappeared deleted child in the next fresh directory batch', () => {
    const registration = register();
    const root = '/app/@mf-types/remote';
    const child = `${root}/types.d.ts`;
    const removal = { ...deletion(file(child)), after: missing(child) };
    const plan = assertRendererGeneratedOutputOperationsAllowed(registration, [
      deletion(file(child)),
    ]);
    const foreign = directory(root, [{ name: 'types.d.ts', kind: 'file' }]);
    expect(() =>
      assertRendererGeneratedOutputNextOperationsCurrent(
        registration,
        plan,
        [removal],
        [deletion(foreign)],
      ),
    ).toThrow('known child');
    expect(
      assertRendererGeneratedOutputNextOperationsCurrent(
        registration,
        plan,
        [removal],
        [deletion(directory(root))],
      ).operations,
    ).toHaveLength(2);
  });

  it('requires a newly created directory acknowledgement to have no unacknowledged children', () => {
    const registration = register();
    const root = '/app/@mf-types/new';
    expect(() =>
      complete(registration, [
        {
          operation: 'write',
          kind: 'directory',
          before: missing(root),
          after: directory(root, [
            { name: 'unacknowledged.d.ts', kind: 'file' },
          ]),
        },
      ]),
    ).toThrow('new directory has unacknowledged children');
  });

  it('preserves static directory metadata while admitting genuine child effects', () => {
    const registration = register();
    const root = '/app/@mf-types/remote';
    const child = `${root}/types.d.ts`;
    const initial = {
      ...directory(root),
      metadata: {
        ...metadata(root),
        mode: 0o755,
        uid: 501,
        gid: 20,
        birthtimeMs: 123,
        mtimeNs: '123000000',
        ctimeNs: '123000001',
        birthtimeNs: '123000002',
      },
    };
    const operations = [
      {
        operation: 'write' as const,
        kind: 'directory' as const,
        before: missing(root),
        after: initial,
      },
      { ...write(missing(child)), after: file(child) },
    ];
    const plan = assertRendererGeneratedOutputOperationsAllowed(
      registration,
      operations.map(({ after: _after, ...operation }) => operation),
    );
    const completion = {
      status: 'complete' as const,
      registrationDigest: registration.registrationDigest,
      planDigest: plan.planDigest,
      generation: registration.generation,
      operations,
    };
    const final = {
      ...directory(root, [{ name: 'types.d.ts', kind: 'file' }]),
      metadata: {
        ...initial.metadata,
        modifiedTime: 5678,
        size: 24,
        mtimeNs: '456000000',
        ctimeNs: '456000001',
      },
    };
    const current = {
      generation: registration.generation,
      nodes: [final, file(child)],
    };
    expect(
      validateRendererGeneratedOutputReceipt(
        registration,
        plan,
        completion,
        current,
      ).nodes,
    ).toEqual(current.nodes);
    for (const changed of [
      { mode: 0o700 },
      { uid: 0 },
      { gid: 0 },
      { birthtimeMs: 999 },
      { birthtimeNs: '999000002' },
    ])
      expect(() =>
        validateRendererGeneratedOutputReceipt(registration, plan, completion, {
          ...current,
          nodes: [
            { ...final, metadata: { ...final.metadata, ...changed } },
            file(child),
          ],
        }),
      ).toThrow('stable metadata');
  });

  it('requires ancestor listings to admit deeper descendants without granting intermediate permissions', () => {
    const registration = register();
    const root = '/app/@mf-types/remote';
    const child = `${root}/warm/types.d.ts`;
    const empty = directory(root);
    expect(() =>
      complete(registration, [
        {
          operation: 'write',
          kind: 'directory',
          before: missing(root),
          after: empty,
        },
        { ...write(missing(child)), after: file(child) },
      ]),
    ).toThrow('descendant');
    const existing = directory(root, [{ name: 'warm', kind: 'directory' }]);
    const { receipt } = complete(registration, [
      {
        operation: 'write',
        kind: 'directory',
        before: existing,
        after: existing,
      },
      { ...write(missing(child)), after: file(child) },
    ]);
    expect(rendererGeneratedOutputPermission(receipt, child)?.kind).toBe(
      'file',
    );
    expect(
      rendererGeneratedOutputPermission(receipt, `${root}/warm`),
    ).toBeUndefined();
    expect(
      rendererGeneratedOutputPermission(receipt, `${root}/warm/old.d.ts`),
    ).toBeUndefined();
  });

  it('checks canonical descendant components as well as their lexical spelling', () => {
    const registration = register({
      destinations: [destination('/app/@mf-types', '/real/types')],
    });
    const root = {
      ...directory('/app/@mf-types', [{ name: 'warm', kind: 'directory' }]),
      path: pair('/app/@mf-types', '/real/types'),
    };
    const before = missing(
      '/app/@mf-types/warm/types.d.ts',
      '/real/types/hidden/types.d.ts',
    );
    const after = file(
      '/app/@mf-types/warm/types.d.ts',
      'generated',
      '/real/types/hidden/types.d.ts',
    );
    expect(() =>
      complete(registration, [
        { operation: 'write', kind: 'directory', before: root, after: root },
        { ...write(before), after },
      ]),
    ).toThrow('descendant');
  });

  it('does not absorb foreign ancestor metadata changes from deeper descendant writes', () => {
    const registration = register();
    const root = '/app/@mf-types/remote';
    const before = directory(root, [{ name: 'warm', kind: 'directory' }]);
    const child = `${root}/warm/new.d.ts`;
    const operations = [
      {
        operation: 'write' as const,
        kind: 'directory' as const,
        before,
        after: before,
      },
      { ...write(missing(child)), after: file(child) },
    ];
    const plan = assertRendererGeneratedOutputOperationsAllowed(
      registration,
      operations.map(({ after: _after, ...operation }) => operation),
    );
    const completion = {
      status: 'complete' as const,
      registrationDigest: registration.registrationDigest,
      planDigest: plan.planDigest,
      generation: registration.generation,
      operations,
    };
    const foreign = {
      ...before,
      metadata: { ...metadata(root), modifiedTime: 9999 },
    };
    expect(() =>
      validateRendererGeneratedOutputReceipt(registration, plan, completion, {
        generation: registration.generation,
        nodes: [foreign, file(child)],
      }),
    ).toThrow('stable metadata');
  });

  it('rejects contradictory immediate directory acknowledgements before later recreation can hide them', () => {
    const registration = register();
    const root = '/app/@mf-types/remote';
    const child = `${root}/types.d.ts`;
    const created = file(child);
    const operations = [
      { ...write(missing(child)), after: created },
      { ...deletion(directory(root)), after: missing(root) },
      {
        operation: 'write' as const,
        kind: 'directory' as const,
        before: missing(root),
        after: directory(root),
      },
      { ...deletion(created), after: missing(child) },
    ];
    expect(() => complete(registration, operations)).toThrow('known child');
  });

  it('accepts native POSIX directory entry names containing trailing spaces', () => {
    const registration = register();
    const root = '/app/@mf-types/remote';
    const name = 'name with spaces ';
    const after = directory(root, [{ name, kind: 'file' }]);
    const { receipt } = complete(registration, [
      { operation: 'write', kind: 'directory', before: after, after },
      { ...write(file(`${root}/${name}`)), after: file(`${root}/${name}`) },
    ]);
    expect(
      rendererGeneratedOutputPermission(receipt, `${root}/${name}`)?.kind,
    ).toBe('file');
  });

  it('rejects a parent deletion after a child was recreated and later child operations under deleted parents', () => {
    const registration = register();
    const root = '/app/@mf-types/remote';
    const child = `${root}/types.d.ts`;
    const operations = [
      deletion(file(child, 'first')),
      write(missing(child)),
      deletion(directory(root, [{ name: 'types.d.ts', kind: 'file' }])),
    ];
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, operations),
    ).toThrow('unacknowledged child');
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, [
        deletion(directory(root)),
        deletion(file(child)),
      ]),
    ).toThrow('deleted or non-directory ancestor');
  });

  it('rejects conflicting aliases, even when their claimed kinds differ', () => {
    const registration = register({
      destinations: [destination('/app/@mf-types', '/real/types')],
    });
    const operations = [
      write(missing('/app/@mf-types/a', '/real/types/a')),
      {
        operation: 'write' as const,
        kind: 'directory' as const,
        before: missing('/app/@mf-types/b', '/real/types/a'),
      },
    ];
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, operations),
    ).toThrow('conflicting path aliases');
  });

  it('reserves destinations containing authored files without admitting mutations in either spelling', () => {
    for (const authored of [
      pair('/app/@mf-types/authored.d.ts'),
      pair('/elsewhere/authored.d.ts', '/real/types/authored.d.ts'),
    ]) {
      const registration = register({
        destinations: [destination('/app/@mf-types', '/real/types')],
        authoredPaths: [authored],
      });
      expect(registration.authoredPaths).toEqual([authored]);
      expect(Object.isFrozen(registration.authoredPaths[0])).toBe(true);
      const golden = file(
        '/app/@mf-types/authored.d.ts',
        'golden',
        '/real/types/authored.d.ts',
      );
      const root = {
        ...directory('/app/@mf-types', [
          { name: 'authored.d.ts', kind: 'file' },
        ]),
        path: pair('/app/@mf-types', '/real/types'),
      };
      for (const operation of [
        write(golden),
        deletion(golden),
        { operation: 'write', kind: 'directory', before: root } as const,
        deletion(root),
      ])
        expect(() =>
          assertRendererGeneratedOutputOperationsAllowed(registration, [
            operation,
          ]),
        ).toThrow('authored or tracked');
    }
  });

  it('keeps reserved goldens ordinary inputs when a different exact node is acknowledged', () => {
    const golden = file('/app/@mf-types/remote/golden.d.ts', 'golden');
    const registration = register({
      authoredPaths: [golden.path],
      protectedInputs: [{ observation: 'content', node: golden }],
    });
    expect(registration.protectedInputs[0]?.node).toEqual(golden);
    expect(Object.isFrozen(registration.protectedInputs[0]?.node)).toBe(true);
    const generated = file('/app/@mf-types/remote/generated.d.ts');
    const { receipt, plan, completion } = complete(registration, [
      { ...write(missing(generated.path.lexical)), after: generated },
    ]);
    expect(
      rendererGeneratedOutputPermission(receipt, golden.path.lexical),
    ).toBeUndefined();
    expect(
      rendererGeneratedOutputPermission(receipt, '/app/@mf-types/remote'),
    ).toBeUndefined();
    expect(() =>
      rendererGeneratedOutputPermission(
        registration as unknown as typeof receipt,
        golden.path.lexical,
      ),
    ).toThrow('receipt has not been validated');
    expect(() =>
      validateRendererGeneratedOutputReceipt(registration, plan, completion, {
        generation: registration.generation,
        nodes: [generated, golden],
      }),
    ).toThrow('current exact node observations are incomplete');
    expect(() =>
      complete(registration, [{ ...write(golden), after: golden }]),
    ).toThrow('authored or tracked');
    expect(() =>
      complete(registration, [
        { ...deletion(golden), after: missing(golden.path.lexical) },
      ]),
    ).toThrow('authored or tracked');
    const emptyPlan = assertRendererGeneratedOutputOperationsAllowed(
      registration,
      [],
    );
    expect(() =>
      validateRendererGeneratedOutputReceipt(
        registration,
        emptyPlan,
        {
          status: 'complete',
          registrationDigest: registration.registrationDigest,
          planDigest: emptyPlan.planDigest,
          generation: registration.generation,
          operations: [],
        },
        { generation: registration.generation, nodes: [golden] },
      ),
    ).toThrow('current exact node observations are incomplete');
  });

  it('rejects reserved protected child IO before admitting its causal parent effect', () => {
    const golden = file('/app/@mf-types/remote/golden.d.ts', 'golden');
    const root = directory('/app/@mf-types/remote', [
      { name: 'golden.d.ts', kind: 'file' },
    ]);
    for (const registration of [
      register({ authoredPaths: [golden.path] }),
      register({ protectedInputs: [{ observation: 'content', node: golden }] }),
    ]) {
      for (const child of [write(golden), deletion(golden)]) {
        const parent: RendererGeneratedOutputOperation = {
          operation: 'write',
          kind: 'directory',
          before: root,
          cause: { operation: 'native-child-io', paths: [golden.path] },
        };
        expect(() =>
          assertRendererGeneratedOutputOperationsAllowed(registration, [
            child,
            parent,
          ]),
        ).toThrow();
      }
    }
  });

  it('cannot acknowledge a protected reserved file through another admitted path', () => {
    const golden = file('/app/@mf-types/remote/golden.d.ts', 'golden');
    const registration = register({
      protectedInputs: [{ observation: 'content', node: golden }],
    });
    const generated = file('/app/@mf-types/remote/generated.d.ts');
    const { plan, completion } = complete(registration, [
      { ...write(missing(generated.path.lexical)), after: generated },
    ]);
    expect(() =>
      validateRendererGeneratedOutputReceipt(
        registration,
        plan,
        {
          ...completion,
          operations: [{ ...write(golden), after: golden }],
        },
        { generation: registration.generation, nodes: [golden] },
      ),
    ).toThrow('acknowledgement does not match the pre-write plan');
    expect(() =>
      complete(registration, [{ ...write(golden), after: golden }]),
    ).toThrow('observed input');
  });

  it.each([
    'content',
    'module',
    'metadata',
    'existence',
    'entry-kind',
  ] as const)('protects %s input path, physical alias and ancestor', observation => {
    const consumed = file(
      '/app/@mf-types/config.json',
      'consumed',
      '/physical/types/config.json',
    );
    const registration = register({
      destinations: [destination('/app/@mf-types', '/physical/types')],
      protectedInputs: [{ observation, node: consumed }],
    });
    const hardLink = {
      ...file(
        '/app/@mf-types/hardlink.json',
        'consumed',
        '/physical/types/hardlink.json',
      ),
      metadata: metadata('/physical/types/config.json'),
    };
    for (const before of [
      consumed,
      file(
        '/app/@mf-types/alias.json',
        'consumed',
        '/physical/types/config.json',
      ),
      hardLink,
      {
        ...directory('/app/@mf-types'),
        path: pair('/app/@mf-types', '/physical/types'),
      },
    ])
      expect(() =>
        assertRendererGeneratedOutputOperationsAllowed(registration, [
          before.kind === 'directory' ? deletion(before) : write(before),
        ]),
      ).toThrow('observed input');
  });

  it('rejects a generated post-write physical alias of a protected input', () => {
    const consumed = file('/app/config.json', 'consumed');
    const registration = register({
      protectedInputs: [{ observation: 'content', node: consumed }],
    });
    const after = {
      ...file('/app/@mf-types/linked.d.ts', 'consumed'),
      metadata: metadata('/app/config.json'),
    };
    expect(() =>
      complete(registration, [
        { ...write(missing('/app/@mf-types/linked.d.ts')), after },
      ]),
    ).toThrow('observed input physical');
  });

  it('rejects impossible final file ancestors and repeated physical identities', () => {
    const registration = register();
    const parent = '/app/@mf-types/a';
    expect(() =>
      complete(registration, [
        { ...write(missing(parent)), after: file(parent) },
        { ...write(missing(`${parent}/b`)), after: file(`${parent}/b`) },
      ]),
    ).toThrow('non-directory ancestor');
    const alias = { ...file('/app/@mf-types/b'), metadata: metadata(parent) };
    expect(() =>
      complete(registration, [
        { ...write(missing(parent)), after: file(parent) },
        { ...write(missing('/app/@mf-types/b')), after: alias },
      ]),
    ).toThrow('overlap');
  });

  it('rejects unacknowledged child loss or replacement through a directory write', () => {
    const registration = register();
    const before = directory('/app/@mf-types/remote', [
      { name: 'child.d.ts', kind: 'file' },
    ]);
    const after = directory('/app/@mf-types/remote');
    expect(() =>
      complete(registration, [
        { operation: 'write', kind: 'directory', before, after },
      ]),
    ).toThrow('unacknowledged child');
    const replaced = {
      ...after,
      metadata: {
        ...metadata('/app/@mf-types/remote'),
        inode: 'replacement-directory',
      },
    };
    expect(() =>
      complete(registration, [
        { operation: 'write', kind: 'directory', before, after: replaced },
      ]),
    ).toThrow('exact deletion');
  });

  it('protects missing observations before writes or parent creation', () => {
    const registration = register({
      protectedInputs: [
        {
          observation: 'existence',
          node: missing('/app/@mf-types/new/config.json'),
        },
      ],
    });
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, [
        write(missing('/app/@mf-types/new/config.json')),
      ]),
    ).toThrow('observed input');
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, [
        {
          operation: 'write',
          kind: 'directory',
          before: missing('/app/@mf-types/new'),
        },
      ]),
    ).toThrow('ancestor');
  });

  it('protects a consumed directory enumeration against direct child creation and deletion', () => {
    const observed = directory('/app/@mf-types', [
      { name: 'existing.d.ts', kind: 'file' },
    ]);
    const registration = register({
      protectedInputs: [{ observation: 'directory', node: observed }],
    });
    for (const operation of [
      write(missing('/app/@mf-types/new.d.ts')),
      deletion(file('/app/@mf-types/existing.d.ts')),
    ])
      expect(() =>
        assertRendererGeneratedOutputOperationsAllowed(registration, [
          operation,
        ]),
      ).toThrow('enumeration');
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, [
        write(file('/app/@mf-types/existing.d.ts')),
      ]),
    ).not.toThrow();
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, [
        write(missing('/app/@mf-types/nested/new.d.ts')),
      ]),
    ).not.toThrow();
  });

  it('requires each directory deletion child to have an earlier exact acknowledgement', () => {
    const registration = register();
    const root = directory('/app/@mf-types/remove', [
      { name: 'child.d.ts', kind: 'file' },
    ]);
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(registration, [
        deletion(root),
      ]),
    ).toThrow('unacknowledged child');
    const operations = [
      {
        ...deletion(file('/app/@mf-types/remove/child.d.ts')),
        after: missing('/app/@mf-types/remove/child.d.ts'),
      },
      { ...deletion(root), after: missing('/app/@mf-types/remove') },
    ];
    expect(complete(registration, operations).receipt.operations).toHaveLength(
      2,
    );
    expect(() =>
      assertRendererGeneratedOutputOperationsAllowed(
        registration,
        operations
          .slice()
          .reverse()
          .map(({ after: _after, ...operation }) => operation),
      ),
    ).toThrow('unacknowledged child');
  });

  it('rejects failed, partial, void and fabricated completion evidence', () => {
    const registration = register();
    const operation = {
      ...write(missing('/app/@mf-types/new.d.ts')),
      after: file('/app/@mf-types/new.d.ts'),
    };
    const { plan, completion, current } = complete(registration, [operation]);
    for (const bad of [
      undefined,
      { status: 'failed', reason: 'native extraction failed' },
      { ...completion, operations: [] },
      {
        ...completion,
        operations: [
          { ...operation, after: missing('/app/@mf-types/new.d.ts') },
        ],
      },
    ])
      expect(() =>
        validateRendererGeneratedOutputReceipt(
          registration,
          plan,
          bad as RendererGeneratedOutputCompletion,
          current,
        ),
      ).toThrow();
  });

  it('rejects stale producer/options/operation/revision binding and copied plans or receipts', () => {
    const registration = register();
    const operation = {
      ...write(missing('/app/@mf-types/new.d.ts')),
      after: file('/app/@mf-types/new.d.ts'),
    };
    const { plan, completion, current, receipt } = complete(registration, [
      operation,
    ]);
    for (const bad of [
      { ...completion, registrationDigest: sha('different binding') },
      { ...completion, planDigest: sha('other plan') },
      {
        ...completion,
        generation: { ...registration.generation, revision: 'next' },
      },
    ])
      expect(() =>
        validateRendererGeneratedOutputReceipt(
          registration,
          plan,
          bad as RendererGeneratedOutputCompletion,
          current,
        ),
      ).toThrow('stale');
    expect(() =>
      validateRendererGeneratedOutputReceipt(
        registration,
        { ...plan },
        completion,
        current,
      ),
    ).toThrow('different registration');
    for (const copy of [{ ...receipt }, JSON.parse(JSON.stringify(receipt))]) {
      expect(() =>
        assertRendererGeneratedOutputReceiptCurrent(
          registration,
          copy,
          current,
        ),
      ).toThrow('not been validated');
      expect(() =>
        rendererGeneratedOutputPermission(copy, '/app/@mf-types/new.d.ts'),
      ).toThrow('not been validated');
    }
    const repeatedTextualIds = register();
    expect(repeatedTextualIds.registrationDigest).toBe(
      registration.registrationDigest,
    );
    expect(() =>
      assertRendererGeneratedOutputReceiptCurrent(
        repeatedTextualIds,
        receipt,
        current,
      ),
    ).toThrow('not been validated');
  });

  it('requires fresh final byte digests, metadata, path binding, complete nodes and generation', () => {
    const registration = register();
    const name = '/app/@mf-types/new.d.ts';
    const { receipt, current } = complete(registration, [
      { ...write(missing(name)), after: file(name) },
    ]);
    for (const nodes of [
      [],
      [file(name, 'changed')],
      [
        {
          ...file(name),
          metadata: { ...metadata(name), inode: 'replacement' },
        },
      ],
      [file(name, 'generated', '/other/new.d.ts')],
      [file(name), file(name)],
    ])
      expect(() =>
        assertRendererGeneratedOutputReceiptCurrent(registration, receipt, {
          ...current,
          nodes,
        }),
      ).toThrow();
    expect(() =>
      assertRendererGeneratedOutputReceiptCurrent(registration, receipt, {
        ...current,
        generation: { ...registration.generation, generation: 2 },
      }),
    ).toThrow('stale');
  });

  it('checks POSIX and Win32 destination containment with the native path oracle', () => {
    for (const [flavor, root, candidates] of [
      [
        'posix',
        '/types/İ',
        [
          '/types/İ/a.d.ts',
          '/types/İ/../other/a.d.ts',
          '/types/İ-other/a',
          '/types/İ/İ/a',
          '/types/İ/name with spaces ',
        ],
      ],
      [
        'win32',
        'C:\\types\\İ',
        [
          'C:\\types\\İ\\a.d.ts',
          'c:\\TYPES\\İ\\İ\\a.d.ts',
          'C:\\types\\İ-other\\a',
          'D:\\types\\İ\\a',
          'C:\\types\\İ\\..\\other\\a',
        ],
      ],
      [
        'win32',
        '\\\\server\\share\\types',
        [
          '\\\\server\\share\\types\\a',
          '\\\\SERVER\\SHARE\\TYPES\\a',
          '\\\\server\\other\\types\\a',
        ],
      ],
    ] as const) {
      const api = path[flavor];
      const packageRoot =
        flavor === 'posix'
          ? '/packages/dts-plugin'
          : 'C:\\packages\\dts-plugin';
      const registration = register({
        pathFlavor: flavor,
        destinations: [destination(root)],
        authoredPaths: [],
        consumer: {
          id: 'app',
          projectRoot: flavor === 'posix' ? '/app' : 'C:\\app',
        },
        producer: {
          ...input().producer,
          packageDirectory: packageRoot,
          modulePath: api.join(packageRoot, 'index.js'),
        },
      });
      for (const candidate of candidates) {
        const relative = api.relative(root, candidate);
        const expected =
          relative === '' ||
          (relative !== '..' &&
            !relative.startsWith(`..${api.sep}`) &&
            !api.isAbsolute(relative));
        const action = () =>
          assertRendererGeneratedOutputOperationsAllowed(registration, [
            write(missing(candidate)),
          ]);
        if (expected) expect(action).not.toThrow();
        else expect(action).toThrow('escapes');
      }
    }
  });
});
