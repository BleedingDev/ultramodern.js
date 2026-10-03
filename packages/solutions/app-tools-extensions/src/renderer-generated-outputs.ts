import { createHash } from 'node:crypto';
import path from 'node:path';

export type RendererGeneratedOutputValue =
  | null
  | boolean
  | number
  | string
  | readonly RendererGeneratedOutputValue[]
  | { readonly [key: string]: RendererGeneratedOutputValue };

export interface RendererGeneratedOutputPath {
  readonly lexical: string;
  readonly canonical: string;
}

export interface RendererGeneratedOutputGeneration {
  readonly operationId: string;
  readonly compilerId: string;
  readonly generation: number;
  readonly revision: string;
}

/** The owner must obtain these values from the actual physical node. */
export interface RendererGeneratedOutputMetadata {
  readonly device: string;
  readonly inode: string;
  readonly [key: string]: RendererGeneratedOutputValue;
}

export type RendererGeneratedOutputNode = {
  readonly path: RendererGeneratedOutputPath;
} & (
  | { readonly kind: 'missing' }
  | {
      readonly kind: 'file';
      readonly byteDigest: string;
      readonly metadata: RendererGeneratedOutputMetadata;
    }
  | {
      readonly kind: 'directory';
      readonly entries: readonly {
        readonly name: string;
        readonly kind: 'file' | 'directory' | 'symlink';
      }[];
      readonly metadata: RendererGeneratedOutputMetadata;
    }
);

export interface RendererGeneratedOutputDestination {
  readonly path: RendererGeneratedOutputPath;
  readonly kind: 'file' | 'directory';
  readonly scope: 'exact' | 'subtree';
}

export interface RendererGeneratedOutputRegistrationInput {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly pathFlavor: 'posix' | 'win32';
  readonly producer: {
    readonly packageName: string;
    readonly version: string;
    readonly packageDirectory: string;
    readonly modulePath: string;
    readonly moduleDigest: string;
  };
  readonly consumer: {
    readonly id: string;
    readonly projectRoot: string;
  };
  readonly generation: RendererGeneratedOutputGeneration;
  readonly effectiveOptions: RendererGeneratedOutputValue;
  readonly context: RendererGeneratedOutputValue;
  /** Reservations constrain IO; only exact validated acknowledgements grant permission. */
  readonly destinations: readonly RendererGeneratedOutputDestination[];
  readonly authoredPaths: readonly RendererGeneratedOutputPath[];
  readonly protectedInputs: readonly {
    readonly observation:
      | 'content'
      | 'module'
      | 'metadata'
      | 'existence'
      | 'entry-kind'
      | 'directory';
    readonly node: RendererGeneratedOutputNode;
  }[];
}

export interface RendererGeneratedOutputRegistration
  extends RendererGeneratedOutputRegistrationInput {
  readonly registrationDigest: string;
}

export interface RendererGeneratedOutputOperation {
  readonly operation: 'write' | 'delete';
  readonly kind: 'file' | 'directory';
  readonly before: RendererGeneratedOutputNode;
  /** A surviving directory's effect from one actual native child IO call. */
  readonly cause?: {
    readonly operation: string;
    readonly paths: readonly RendererGeneratedOutputPath[];
  };
}

export interface RendererGeneratedOutputPlan {
  readonly registrationDigest: string;
  readonly planDigest: string;
  readonly operations: readonly RendererGeneratedOutputOperation[];
}

export interface RendererGeneratedOutputAcknowledgement
  extends RendererGeneratedOutputOperation {
  readonly after: RendererGeneratedOutputNode;
}

export type RendererGeneratedOutputCompletion =
  | { readonly status: 'failed'; readonly reason: string }
  | {
      readonly status: 'complete';
      readonly registrationDigest: string;
      readonly planDigest: string;
      readonly generation: RendererGeneratedOutputGeneration;
      readonly operations: readonly RendererGeneratedOutputAcknowledgement[];
    };

/** Fresh physical observations supplied by the owner after native completion. */
export interface RendererGeneratedOutputCurrentNodes {
  readonly generation: RendererGeneratedOutputGeneration;
  readonly nodes: readonly RendererGeneratedOutputNode[];
}

export interface RendererGeneratedOutputReceipt {
  readonly status: 'complete';
  readonly registrationDigest: string;
  readonly planDigest: string;
  readonly receiptDigest: string;
  readonly generation: RendererGeneratedOutputGeneration;
  readonly operations: readonly RendererGeneratedOutputAcknowledgement[];
  readonly nodes: readonly RendererGeneratedOutputNode[];
}

const registrations = new WeakSet<RendererGeneratedOutputRegistration>();
const plans = new WeakMap<
  RendererGeneratedOutputPlan,
  RendererGeneratedOutputRegistration
>();
const receipts = new WeakMap<
  RendererGeneratedOutputReceipt,
  RendererGeneratedOutputRegistration
>();
const sha256 = /^[a-f0-9]{64}$/u;

/** Inspect ordinary descriptors first; Proxy traps are outside this data contract. */
function immutableData<T>(input: T, ancestors = new Set<object>()): T {
  if (input === null || typeof input === 'string' || typeof input === 'boolean')
    return input;
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input !== 'object')
    throw new TypeError(
      'Generated output evidence must contain only finite JSON data.',
    );
  const prototype = Object.getPrototypeOf(input);
  if (
    Array.isArray(input)
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  )
    throw new TypeError('Generated output evidence must contain plain data.');
  if (ancestors.has(input))
    throw new TypeError('Generated output evidence must not be cyclic.');
  ancestors.add(input);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  for (const key of keys) {
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (
      typeof key !== 'string' ||
      !('value' in descriptor) ||
      (!descriptor.enumerable && !(Array.isArray(input) && key === 'length'))
    )
      throw new TypeError(
        'Generated output evidence must not contain accessors, symbols or hidden properties.',
      );
  }
  let copy: unknown;
  if (Array.isArray(input)) {
    const length = descriptors.length!.value as number;
    if (
      keys.length !== length + 1 ||
      Array.from({ length }, (_, index) => String(index)).some(
        key => !Object.hasOwn(descriptors, key),
      )
    )
      throw new TypeError(
        'Generated output evidence must contain dense arrays without custom properties.',
      );
    copy = Array.from({ length }, (_, index) =>
      immutableData(descriptors[String(index)]!.value, ancestors),
    );
  } else {
    const record: Record<string, unknown> = {};
    for (const key of keys as string[])
      Object.defineProperty(record, key, {
        value: immutableData(descriptors[key]!.value, ancestors),
        enumerable: true,
      });
    copy = record;
  }
  ancestors.delete(input);
  return Object.freeze(copy) as T;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      key =>
        `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}

const digest = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');
function fail(message: string): never {
  throw new Error(`Invalid generated output evidence: ${message}.`);
}
function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value)
    fail(`${name} must be a nonempty string`);
}
function hash(value: unknown, name: string): void {
  if (typeof value !== 'string' || !sha256.test(value))
    fail(`${name} must be a SHA-256 digest`);
}
function exactKeys(value: unknown, expected: readonly string[]): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    canonical(Object.keys(value).sort()) !== canonical([...expected].sort())
  )
    fail('fields must match the declared evidence structure');
}
const nativePath = (registration: RendererGeneratedOutputRegistrationInput) =>
  path[registration.pathFlavor];
function validatePath(
  value: RendererGeneratedOutputPath,
  registration: RendererGeneratedOutputRegistrationInput,
): void {
  exactKeys(value, ['lexical', 'canonical']);
  const api = nativePath(registration);
  for (const kind of ['lexical', 'canonical'] as const) {
    if (
      typeof value[kind] !== 'string' ||
      value[kind].includes('\0') ||
      !api.isAbsolute(value[kind])
    )
      fail(`${kind} path must be absolute and contain no NUL`);
  }
}
function same(
  a: string,
  b: string,
  registration: RendererGeneratedOutputRegistrationInput,
): boolean {
  return nativePath(registration).relative(a, b) === '';
}
function within(
  node: string,
  root: string,
  registration: RendererGeneratedOutputRegistrationInput,
): boolean {
  const api = nativePath(registration);
  const relative = api.relative(root, node);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${api.sep}`) &&
      !api.isAbsolute(relative))
  );
}
function aliases(
  a: RendererGeneratedOutputPath,
  b: RendererGeneratedOutputPath,
  registration: RendererGeneratedOutputRegistrationInput,
): boolean {
  return [a.lexical, a.canonical].some(left =>
    [b.lexical, b.canonical].some(right => same(left, right, registration)),
  );
}
function sameNodePath(
  a: RendererGeneratedOutputPath,
  b: RendererGeneratedOutputPath,
  registration: RendererGeneratedOutputRegistrationInput,
): boolean {
  return (
    same(a.lexical, b.lexical, registration) &&
    same(a.canonical, b.canonical, registration)
  );
}
function physicalAliases(
  a: RendererGeneratedOutputNode,
  b: RendererGeneratedOutputNode,
): boolean {
  return (
    a.kind !== 'missing' &&
    b.kind !== 'missing' &&
    a.metadata.device === b.metadata.device &&
    a.metadata.inode === b.metadata.inode
  );
}

function validateGeneration(value: RendererGeneratedOutputGeneration): void {
  exactKeys(value, ['operationId', 'compilerId', 'generation', 'revision']);
  text(value?.operationId, 'operationId');
  text(value.compilerId, 'compilerId');
  text(value.revision, 'revision');
  if (!Number.isSafeInteger(value.generation) || value.generation < 1)
    fail('generation must be a positive safe integer');
}
function validateNode(
  node: RendererGeneratedOutputNode,
  registration: RendererGeneratedOutputRegistrationInput,
): void {
  exactKeys(
    node,
    node?.kind === 'missing'
      ? ['path', 'kind']
      : node?.kind === 'file'
        ? ['path', 'kind', 'byteDigest', 'metadata']
        : ['path', 'kind', 'entries', 'metadata'],
  );
  validatePath(node?.path, registration);
  if (node.kind === 'missing') return;
  if (node.kind !== 'file' && node.kind !== 'directory')
    fail('node kind is unsupported');
  text(node.metadata?.device, 'node device');
  text(node.metadata.inode, 'node inode');
  if (node.kind === 'file') hash(node.byteDigest, 'file byte digest');
  else {
    if (!Array.isArray(node.entries)) fail('directory entries are required');
    const api = nativePath(registration);
    for (const [index, entry] of node.entries.entries()) {
      exactKeys(entry, ['name', 'kind']);
      if (typeof entry?.name !== 'string' || !entry.name)
        fail('directory entry name must be a nonempty string');
      if (
        entry.name === '.' ||
        entry.name === '..' ||
        entry.name.includes('\0') ||
        api.basename(entry.name) !== entry.name ||
        api.isAbsolute(entry.name) ||
        !['file', 'directory', 'symlink'].includes(entry.kind)
      )
        fail('directory entry is invalid');
      if (
        node.entries
          .slice(0, index)
          .some(prior => same(prior.name, entry.name, registration))
      )
        fail('directory entries overlap');
    }
  }
}
function assertRegistration(
  registration: RendererGeneratedOutputRegistration,
): void {
  if (!registrations.has(registration))
    fail('registration has not been validated');
}

/** Capture observations before the native producer can write any destination. */
export function immutableRendererGeneratedOutputRegistration(
  input: RendererGeneratedOutputRegistrationInput,
): RendererGeneratedOutputRegistration {
  const captured = immutableData(input);
  exactKeys(captured, [
    'schemaVersion',
    'id',
    'pathFlavor',
    'producer',
    'consumer',
    'generation',
    'effectiveOptions',
    'context',
    'destinations',
    'authoredPaths',
    'protectedInputs',
  ]);
  if (
    captured.schemaVersion !== 1 ||
    !['posix', 'win32'].includes(captured.pathFlavor)
  )
    fail('registration schema or path flavor is unsupported');
  text(captured.id, 'registration id');
  exactKeys(captured.producer, [
    'packageName',
    'version',
    'packageDirectory',
    'modulePath',
    'moduleDigest',
  ]);
  exactKeys(captured.consumer, ['id', 'projectRoot']);
  text(captured.producer?.packageName, 'producer package');
  text(captured.producer.version, 'producer version');
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(
      captured.producer.version,
    )
  )
    fail('producer version must be exact');
  hash(captured.producer.moduleDigest, 'producer module digest');
  const api = nativePath(captured);
  for (const value of [
    captured.producer.packageDirectory,
    captured.producer.modulePath,
    captured.consumer?.projectRoot,
  ])
    if (
      typeof value !== 'string' ||
      value.includes('\0') ||
      !api.isAbsolute(value)
    )
      fail('producer and consumer paths must be absolute');
  if (
    !within(
      captured.producer.modulePath,
      captured.producer.packageDirectory,
      captured,
    )
  )
    fail('producer module must belong to its physical package');
  text(captured.consumer.id, 'consumer id');
  validateGeneration(captured.generation);
  if (
    !Array.isArray(captured.destinations) ||
    captured.destinations.length === 0 ||
    !Array.isArray(captured.authoredPaths) ||
    !Array.isArray(captured.protectedInputs)
  )
    fail('destination and input observations are required');
  for (const destination of captured.destinations) {
    exactKeys(destination, ['path', 'kind', 'scope']);
    validatePath(destination.path, captured);
    if (
      !['file', 'directory'].includes(destination.kind) ||
      !['exact', 'subtree'].includes(destination.scope) ||
      (destination.scope === 'subtree' && destination.kind !== 'directory')
    )
      fail('destination scope is invalid');
  }
  for (const authored of captured.authoredPaths)
    validatePath(authored, captured);
  for (const input of captured.protectedInputs) {
    exactKeys(input, ['observation', 'node']);
    if (
      ![
        'content',
        'module',
        'metadata',
        'existence',
        'entry-kind',
        'directory',
      ].includes(input.observation)
    )
      fail('input observation kind is unsupported');
    validateNode(input.node, captured);
    if (
      (input.observation === 'content' || input.observation === 'module') &&
      input.node.kind !== 'file'
    )
      fail('content and module observations require a file');
    if (input.observation === 'directory' && input.node.kind !== 'directory')
      fail('directory observations require an enumeration');
  }
  const result = Object.freeze({
    ...captured,
    registrationDigest: digest(captured),
  });
  registrations.add(result);
  return result;
}

/** Append each batch before native IO; a previous plan proves prior validation. */
export function assertRendererGeneratedOutputOperationsAllowed(
  registration: RendererGeneratedOutputRegistration,
  input: readonly RendererGeneratedOutputOperation[],
  previous?: RendererGeneratedOutputPlan,
): RendererGeneratedOutputPlan {
  assertRegistration(registration);
  if (previous && plans.get(previous) !== registration)
    fail('previous plan belongs to a different registration');
  const batch = immutableData(input);
  if (!Array.isArray(batch)) fail('an exact operation plan is required');
  const operations: readonly RendererGeneratedOutputOperation[] = Object.freeze(
    [...(previous?.operations ?? []), ...batch],
  );
  const api = nativePath(registration);
  for (const [index, operation] of operations.entries()) {
    exactKeys(operation, [
      'operation',
      'kind',
      'before',
      ...(operation.cause ? ['cause'] : []),
    ]);
    if (
      !['write', 'delete'].includes(operation.operation) ||
      !['file', 'directory'].includes(operation.kind)
    )
      fail('operation kind is unsupported');
    validateNode(operation.before, registration);
    if (
      operation.before.kind !== 'missing' &&
      operation.before.kind !== operation.kind
    )
      fail('operation changes a node type without an acknowledged deletion');
    if (operation.operation === 'delete' && operation.before.kind === 'missing')
      fail('a deletion requires an existing node');
    const node = operation.before.path;
    const causes: RendererGeneratedOutputOperation[] = [];
    if (operation.cause) {
      exactKeys(operation.cause, ['operation', 'paths']);
      text(operation.cause.operation, 'causal native operation');
      if (
        operation.operation !== 'write' ||
        operation.kind !== 'directory' ||
        operation.before.kind !== 'directory' ||
        !Array.isArray(operation.cause.paths) ||
        operation.cause.paths.length === 0
      )
        fail(
          'a causal directory effect requires an existing surviving directory',
        );
      for (const [causeIndex, causalPath] of operation.cause.paths.entries()) {
        validatePath(causalPath, registration);
        if (
          !same(api.dirname(causalPath.lexical), node.lexical, registration) ||
          !same(
            api.dirname(causalPath.canonical),
            node.canonical,
            registration,
          ) ||
          operation.cause.paths
            .slice(0, causeIndex)
            .some(prior => aliases(prior, causalPath, registration))
        )
          fail('directory effects require unique exact immediate children');
        const child = operations
          .slice(0, index)
          .findLast(prior =>
            sameNodePath(prior.before.path, causalPath, registration),
          );
        if (!child)
          fail('directory effect has no preceding planned native child IO');
        causes.push(child);
      }
    }
    const known = operations
      .slice(0, index)
      .filter(
        (prior, priorIndex) =>
          !operations
            .slice(priorIndex + 1, index)
            .some(later =>
              sameNodePath(prior.before.path, later.before.path, registration),
            ),
      );
    for (const child of known) {
      if (causes.includes(child) && operation.before.kind === 'directory') {
        assertDirectoryChild(
          registration,
          operation.before,
          child.before,
          true,
        );
        continue;
      }
      if (
        child.operation !== 'write' ||
        sameNodePath(child.before.path, node, registration)
      )
        continue;
      if (operation.before.kind !== 'directory') {
        if (
          within(child.before.path.lexical, node.lexical, registration) &&
          within(child.before.path.canonical, node.canonical, registration)
        )
          fail('pre-write non-directory snapshot contradicts its known child');
      } else
        assertDirectoryChild(
          registration,
          operation.before,
          { path: child.before.path, kind: child.kind },
          false,
        );
    }
    if (
      !registration.destinations.some(destination =>
        destination.scope === 'exact'
          ? sameNodePath(node, destination.path, registration) &&
            operation.kind === destination.kind
          : within(node.lexical, destination.path.lexical, registration) &&
            within(node.canonical, destination.path.canonical, registration) &&
            (!sameNodePath(node, destination.path, registration) ||
              operation.kind === 'directory'),
      )
    )
      fail('operation escapes its registered destination');
    if (
      registration.authoredPaths.some(authored =>
        [node.lexical, node.canonical].some(root =>
          [authored.lexical, authored.canonical].some(
            file =>
              within(file, root, registration) &&
              (!operation.cause ||
                same(file, root, registration) ||
                operation.cause.paths.some(child =>
                  [child.lexical, child.canonical].some(changed =>
                    within(file, changed, registration),
                  ),
                )),
          ),
        ),
      )
    )
      fail('operation changes an authored or tracked input ancestor');
    if (
      operations
        .slice(0, index)
        .some(
          prior =>
            aliases(prior.before.path, node, registration) &&
            !sameNodePath(prior.before.path, node, registration),
        )
    )
      fail('operation nodes have conflicting path aliases');
    for (const ancestor of operations.slice(0, index)) {
      if (
        sameNodePath(ancestor.before.path, node, registration) ||
        !within(node.lexical, ancestor.before.path.lexical, registration) ||
        !within(node.canonical, ancestor.before.path.canonical, registration)
      )
        continue;
      const latest = operations
        .slice(0, index)
        .findLast(prior =>
          sameNodePath(prior.before.path, ancestor.before.path, registration),
        )!;
      if (latest.operation === 'delete' || latest.kind !== 'directory')
        fail('operation has a deleted or non-directory ancestor');
    }
    for (const input of registration.protectedInputs) {
      const observed = input.node;
      if (
        physicalAliases(operation.before, observed) ||
        aliases(node, observed.path, registration)
      )
        fail('operation collides with an observed input');
      for (const target of [node.lexical, node.canonical]) {
        for (const read of [observed.path.lexical, observed.path.canonical]) {
          if (
            within(read, target, registration) &&
            (!operation.cause ||
              operation.cause.paths.some(child =>
                [child.lexical, child.canonical].some(changed =>
                  within(read, changed, registration),
                ),
              ))
          )
            fail('operation changes an observed input ancestor');
          if (
            observed.kind === 'directory' &&
            same(api.dirname(target), read, registration) &&
            (operation.operation === 'delete' ||
              operation.before.kind === 'missing')
          )
            fail('operation changes an observed directory enumeration');
        }
      }
    }
    if (
      operation.operation === 'delete' &&
      operation.before.kind === 'directory'
    ) {
      for (const entry of operation.before.entries) {
        const child = {
          lexical: api.join(node.lexical, entry.name),
          canonical: api.join(node.canonical, entry.name),
        };
        const latestChild = operations
          .slice(0, index)
          .findLast(candidate =>
            sameNodePath(candidate.before.path, child, registration),
          );
        if (latestChild?.operation !== 'delete')
          fail('directory deletion has an unacknowledged child');
      }
    }
  }
  const result = Object.freeze({
    registrationDigest: registration.registrationDigest,
    planDigest: digest({
      registrationDigest: registration.registrationDigest,
      operations,
    }),
    operations,
  });
  plans.set(result, registration);
  return result;
}

function captureCurrentNodes(
  registration: RendererGeneratedOutputRegistration,
  input: RendererGeneratedOutputCurrentNodes,
): readonly RendererGeneratedOutputNode[] {
  const current = immutableData(input);
  exactKeys(current, ['generation', 'nodes']);
  validateGeneration(current.generation);
  if (canonical(current.generation) !== canonical(registration.generation))
    fail('current observation generation is stale');
  if (!Array.isArray(current.nodes))
    fail('current exact node observations are incomplete');
  const nodes: readonly RendererGeneratedOutputNode[] = current.nodes;
  for (const [index, node] of nodes.entries()) {
    validateNode(node, registration);
    if (
      nodes
        .slice(0, index)
        .some(
          prior =>
            aliases(prior.path, node.path, registration) ||
            physicalAliases(prior, node),
        )
    )
      fail('current node observations overlap');
    for (const other of nodes) {
      if (
        node !== other &&
        node.kind !== 'directory' &&
        other.kind !== 'missing' &&
        [node.path.lexical, node.path.canonical].some(root =>
          [other.path.lexical, other.path.canonical].some(child =>
            within(child, root, registration),
          ),
        )
      )
        fail('final node has an impossible non-directory ancestor');
      if (node.kind === 'directory' && node !== other)
        assertDirectoryChild(registration, node, other, true);
    }
  }
  return nodes;
}

function assertCurrent(
  registration: RendererGeneratedOutputRegistration,
  expected: readonly RendererGeneratedOutputNode[],
  input: RendererGeneratedOutputCurrentNodes,
): void {
  const nodes = captureCurrentNodes(registration, input);
  if (nodes.length !== expected.length)
    fail('current exact node observations are incomplete');
  for (const snapshot of expected) {
    const observed = nodes.find(node =>
      sameNodePath(node.path, snapshot.path, registration),
    );
    if (!observed || canonical(observed) !== canonical(snapshot))
      fail('generated node bytes, metadata or physical path changed');
  }
}

const childMutableMetadata = new Set([
  'size',
  'blocks',
  'nlink',
  'mtimeMs',
  'ctimeMs',
  'mtimeNs',
  'ctimeNs',
  'modifiedTime',
  'changeTime',
]);
function stableDirectoryMetadata(
  metadata: RendererGeneratedOutputMetadata,
): unknown {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !childMutableMetadata.has(key)),
  );
}

function assertDirectoryProgress(
  registration: RendererGeneratedOutputRegistration,
  snapshot: Extract<RendererGeneratedOutputNode, { kind: 'directory' }>,
  current: Extract<RendererGeneratedOutputNode, { kind: 'directory' }>,
  later: readonly RendererGeneratedOutputAcknowledgement[],
): void {
  const api = nativePath(registration);
  const descendants = later.filter(
    next =>
      within(next.after.path.lexical, snapshot.path.lexical, registration) &&
      within(next.after.path.canonical, snapshot.path.canonical, registration),
  );
  const changesParent = descendants.some(
    child =>
      same(
        api.dirname(child.after.path.lexical),
        snapshot.path.lexical,
        registration,
      ) &&
      same(
        api.dirname(child.after.path.canonical),
        snapshot.path.canonical,
        registration,
      ) &&
      (child.before.kind === 'missing' ||
        child.after.kind === 'missing' ||
        !physicalAliases(child.before, child.after)),
  );
  if (
    canonical(
      changesParent
        ? stableDirectoryMetadata(current.metadata)
        : current.metadata,
    ) !==
    canonical(
      changesParent
        ? stableDirectoryMetadata(snapshot.metadata)
        : snapshot.metadata,
    )
  )
    fail('generated directory stable metadata changed');
  const entries = [...snapshot.entries];
  for (const child of descendants) {
    if (
      !same(
        api.dirname(child.after.path.lexical),
        snapshot.path.lexical,
        registration,
      ) ||
      !same(
        api.dirname(child.after.path.canonical),
        snapshot.path.canonical,
        registration,
      )
    )
      continue;
    const name = api.basename(child.after.path.lexical);
    const index = entries.findIndex(entry =>
      same(entry.name, name, registration),
    );
    if (index >= 0) entries.splice(index, 1);
    if (child.after.kind !== 'missing')
      entries.push({ name, kind: child.after.kind });
  }
  if (
    entries.length !== current.entries.length ||
    entries.some(
      entry =>
        !current.entries.some(
          observed =>
            same(entry.name, observed.name, registration) &&
            entry.kind === observed.kind,
        ),
    )
  )
    fail('generated directory has an unacknowledged child change');
}

function assertDirectoryChild(
  registration: RendererGeneratedOutputRegistration,
  parent: Extract<RendererGeneratedOutputNode, { kind: 'directory' }>,
  child: Pick<RendererGeneratedOutputNode, 'path' | 'kind'>,
  exactMissing: boolean,
): void {
  if (sameNodePath(parent.path, child.path, registration)) return;
  const api = nativePath(registration);
  for (const kind of ['lexical', 'canonical'] as const) {
    if (
      !within(child.path[kind], parent.path[kind], registration) ||
      same(child.path[kind], parent.path[kind], registration)
    )
      continue;
    const components = api
      .relative(parent.path[kind], child.path[kind])
      .split(api.sep);
    const entry = parent.entries.find(entry =>
      same(entry.name, components[0]!, registration),
    );
    if (child.kind === 'missing') {
      if (exactMissing && components.length === 1 && entry !== undefined)
        fail('directory enumeration contradicts its known child');
    } else if (
      components.length === 1
        ? entry?.kind !== child.kind
        : entry?.kind !== 'directory' && entry?.kind !== 'symlink'
    )
      fail('directory enumeration contradicts its known child or descendant');
  }
}

function assertKnownChildren(
  registration: RendererGeneratedOutputRegistration,
  snapshot: RendererGeneratedOutputNode,
  previous: readonly RendererGeneratedOutputAcknowledgement[],
  immediateAfter: boolean,
): void {
  const latest = previous.filter(
    (operation, index) =>
      !previous
        .slice(index + 1)
        .some(later =>
          sameNodePath(operation.after.path, later.after.path, registration),
        ),
  );
  for (const operation of latest) {
    const child = operation.after;
    if (sameNodePath(child.path, snapshot.path, registration)) continue;
    if (snapshot.kind !== 'directory') {
      if (
        child.kind !== 'missing' &&
        within(child.path.lexical, snapshot.path.lexical, registration) &&
        within(child.path.canonical, snapshot.path.canonical, registration)
      )
        fail('immediate non-directory node contradicts its live child');
      continue;
    }
    assertDirectoryChild(registration, snapshot, child, immediateAfter);
  }
}

function finalNodes(
  registration: RendererGeneratedOutputRegistration,
  operations: readonly RendererGeneratedOutputAcknowledgement[],
  input: RendererGeneratedOutputCurrentNodes,
): readonly RendererGeneratedOutputNode[] {
  const nodes = captureCurrentNodes(registration, input);
  const finalOperations = operations.filter(
    (operation, index) =>
      !operations
        .slice(index + 1)
        .some(later =>
          sameNodePath(operation.after.path, later.after.path, registration),
        ),
  );
  if (nodes.length !== finalOperations.length)
    fail('current exact node observations are incomplete');
  for (const operation of finalOperations) {
    const currentNode = nodes.find(node =>
      sameNodePath(node.path, operation.after.path, registration),
    );
    if (!currentNode) fail('current exact node observations are incomplete');
    if (
      operation.after.kind !== 'directory' ||
      currentNode.kind !== 'directory'
    ) {
      if (canonical(currentNode) !== canonical(operation.after))
        fail('generated node bytes, metadata or physical path changed');
      continue;
    }
    assertDirectoryProgress(
      registration,
      operation.after,
      currentNode,
      operations.slice(operations.indexOf(operation) + 1),
    );
  }
  return nodes;
}

function checkedAcknowledgements(
  registration: RendererGeneratedOutputRegistration,
  plan: RendererGeneratedOutputPlan,
  input: readonly RendererGeneratedOutputAcknowledgement[],
): readonly RendererGeneratedOutputAcknowledgement[] {
  assertRegistration(registration);
  if (plans.get(plan) !== registration)
    fail('operation plan belongs to a different registration');
  const captured = immutableData(input);
  if (!Array.isArray(captured) || captured.length > plan.operations.length)
    fail('acknowledgements must be an ordered plan prefix');
  const acknowledgements: readonly RendererGeneratedOutputAcknowledgement[] =
    captured;
  for (const [index, acknowledgement] of acknowledgements.entries()) {
    exactKeys(acknowledgement, [
      'operation',
      'kind',
      'before',
      'after',
      ...(acknowledgement.cause ? ['cause'] : []),
    ]);
    const expected = plan.operations[index]!;
    if (
      canonical({
        operation: acknowledgement.operation,
        kind: acknowledgement.kind,
        before: acknowledgement.before,
        ...(acknowledgement.cause ? { cause: acknowledgement.cause } : {}),
      }) !== canonical(expected)
    )
      fail('acknowledgement does not match the pre-write plan');
    validateNode(acknowledgement.after, registration);
    const causePaths = acknowledgement.cause?.paths ?? [];
    const caused = causePaths.map(causalPath => {
      const child = acknowledgements
        .slice(0, index)
        .findLast(prior =>
          sameNodePath(prior.after.path, causalPath, registration),
        );
      if (!child)
        fail('directory effect has no completed preceding native child IO');
      return child;
    });
    assertKnownChildren(
      registration,
      acknowledgement.before,
      acknowledgements.slice(0, index).filter(prior => !caused.includes(prior)),
      false,
    );
    if (caused.length && acknowledgement.before.kind === 'directory')
      for (const child of caused)
        assertDirectoryChild(
          registration,
          acknowledgement.before,
          child.before,
          true,
        );
    assertKnownChildren(
      registration,
      acknowledgement.after,
      acknowledgements.slice(0, index),
      true,
    );
    if (
      !same(
        acknowledgement.before.path.lexical,
        acknowledgement.after.path.lexical,
        registration,
      ) ||
      !same(
        acknowledgement.before.path.canonical,
        acknowledgement.after.path.canonical,
        registration,
      )
    )
      fail('acknowledgement changes its lexical or physical destination');
    if (
      acknowledgement.after.kind !==
      (acknowledgement.operation === 'delete'
        ? 'missing'
        : acknowledgement.kind)
    )
      fail('acknowledgement does not prove its operation completed');
    if (
      registration.protectedInputs.some(input =>
        physicalAliases(acknowledgement.after, input.node),
      )
    )
      fail('generated output aliases an observed input physical node');
    if (
      acknowledgement.operation === 'write' &&
      acknowledgement.before.kind === 'missing' &&
      acknowledgement.after.kind === 'directory' &&
      acknowledgement.after.entries.length !== 0
    )
      fail('new directory has unacknowledged children');
    if (
      acknowledgement.operation === 'write' &&
      acknowledgement.before.kind === 'directory' &&
      acknowledgement.after.kind === 'directory'
    ) {
      if (!physicalAliases(acknowledgement.before, acknowledgement.after))
        fail('directory replacement requires an exact deletion');
      if (acknowledgement.cause) {
        assertDirectoryProgress(
          registration,
          acknowledgement.before,
          acknowledgement.after,
          caused,
        );
      } else {
        const afterEntries = acknowledgement.after.entries;
        if (
          acknowledgement.before.entries.length !== afterEntries.length ||
          acknowledgement.before.entries.some(
            entry =>
              !afterEntries.some(
                after =>
                  same(entry.name, after.name, registration) &&
                  entry.kind === after.kind,
              ),
          )
        )
          fail('directory write changes an unacknowledged child');
      }
    }
    const previous = acknowledgements
      .slice(0, index)
      .findLast(prior =>
        sameNodePath(
          prior.after.path,
          acknowledgement.before.path,
          registration,
        ),
      );
    if (previous) {
      if (
        previous.after.kind === 'directory' &&
        acknowledgement.before.kind === 'directory'
      )
        assertDirectoryProgress(
          registration,
          previous.after,
          acknowledgement.before,
          acknowledgements
            .slice(acknowledgements.indexOf(previous) + 1, index)
            .filter(prior => !caused.includes(prior)),
        );
      else if (canonical(previous.after) !== canonical(acknowledgement.before))
        fail('ordered operations have a discontinuous node state');
    }
  }
  return acknowledgements;
}

/** Validate completed progress without granting a terminal receipt. */
export function assertRendererGeneratedOutputAcknowledgementProgress(
  registration: RendererGeneratedOutputRegistration,
  plan: RendererGeneratedOutputPlan,
  acknowledgements: readonly RendererGeneratedOutputAcknowledgement[],
): void {
  checkedAcknowledgements(registration, plan, acknowledgements);
}

/** Check an inherited exact node after already acknowledged native child IO. */
export function assertRendererGeneratedOutputInheritedNodeProgress(
  registration: RendererGeneratedOutputRegistration,
  inherited: RendererGeneratedOutputNode,
  operation: RendererGeneratedOutputOperation,
  plan: RendererGeneratedOutputPlan,
  input: readonly RendererGeneratedOutputAcknowledgement[],
): void {
  const original = immutableData(inherited);
  const next = immutableData(operation);
  validateNode(original, registration);
  validateNode(next.before, registration);
  if (!sameNodePath(original.path, next.before.path, registration))
    fail('inherited progress changes its exact node path');
  const acknowledgements = checkedAcknowledgements(registration, plan, input);
  if (acknowledgements.length !== plan.operations.length)
    fail('inherited progress requires completed preceding native IO');
  if (original.kind !== 'directory' || next.before.kind !== 'directory') {
    if (canonical(original) !== canonical(next.before))
      fail('previous generated node changed before native IO');
    return;
  }
  // This is a pre-IO batch: all acknowledgements precede its child operations.
  assertDirectoryProgress(
    registration,
    original,
    next.before,
    acknowledgements,
  );
}

/** Validate fresh next-node states before native IO, retaining the plan chain. */
export function assertRendererGeneratedOutputNextOperationsCurrent(
  registration: RendererGeneratedOutputRegistration,
  previousPlan: RendererGeneratedOutputPlan,
  input: readonly RendererGeneratedOutputAcknowledgement[],
  batch: readonly RendererGeneratedOutputOperation[],
): RendererGeneratedOutputPlan {
  const acknowledgements = checkedAcknowledgements(
    registration,
    previousPlan,
    input,
  );
  const captured = immutableData(batch);
  if (!Array.isArray(captured))
    fail('an exact next operation batch is required');
  for (const operation of captured) {
    validateNode(operation.before, registration);
    for (const pending of previousPlan.operations.slice(
      acknowledgements.length,
    )) {
      const overlaps = [
        operation.before.path.lexical,
        operation.before.path.canonical,
      ].some(left =>
        [pending.before.path.lexical, pending.before.path.canonical].some(
          right =>
            within(left, right, registration) ||
            within(right, left, registration),
        ),
      );
      if (overlaps || physicalAliases(operation.before, pending.before))
        fail('next operation overlaps unacknowledged native IO');
    }
    assertKnownChildren(registration, operation.before, acknowledgements, true);
    const previous = acknowledgements.findLast(prior =>
      sameNodePath(prior.after.path, operation.before.path, registration),
    );
    if (!previous) continue;
    if (
      previous.after.kind === 'directory' &&
      operation.before.kind === 'directory'
    )
      assertDirectoryProgress(
        registration,
        previous.after,
        operation.before,
        acknowledgements.slice(acknowledgements.indexOf(previous) + 1),
      );
    else if (canonical(previous.after) !== canonical(operation.before))
      fail('next operation bytes, metadata or physical path changed');
  }
  return assertRendererGeneratedOutputOperationsAllowed(
    registration,
    captured,
    previousPlan,
  );
}

/** Native completion and fresh observations are evidence, never Promise<void>. */
export function validateRendererGeneratedOutputReceipt(
  registration: RendererGeneratedOutputRegistration,
  plan: RendererGeneratedOutputPlan,
  input: RendererGeneratedOutputCompletion,
  current: RendererGeneratedOutputCurrentNodes,
): RendererGeneratedOutputReceipt {
  assertRegistration(registration);
  if (plans.get(plan) !== registration)
    fail('operation plan belongs to a different registration');
  const completion = immutableData(input);
  if (completion.status !== 'complete')
    fail('native producer did not complete successfully');
  exactKeys(completion, [
    'status',
    'registrationDigest',
    'planDigest',
    'generation',
    'operations',
  ]);
  validateGeneration(completion.generation);
  if (
    completion.registrationDigest !== registration.registrationDigest ||
    completion.planDigest !== plan.planDigest ||
    canonical(completion.generation) !== canonical(registration.generation)
  )
    fail('producer, options, consumer, generation or plan binding is stale');
  if (
    !Array.isArray(completion.operations) ||
    completion.operations.length !== plan.operations.length
  )
    fail('native completion is partial');
  checkedAcknowledgements(registration, plan, completion.operations);
  const nodes = finalNodes(registration, completion.operations, current);
  const result = Object.freeze({
    ...completion,
    nodes,
    receiptDigest: digest({ ...completion, nodes }),
  });
  receipts.set(result, registration);
  return result;
}

/** Use the same validated receipt at final identity and permission consumption. */
export function assertRendererGeneratedOutputReceiptCurrent(
  registration: RendererGeneratedOutputRegistration,
  receipt: RendererGeneratedOutputReceipt,
  current: RendererGeneratedOutputCurrentNodes,
): void {
  assertRegistration(registration);
  if (receipts.get(receipt) !== registration)
    fail('receipt has not been validated for this registration');
  assertCurrent(registration, receipt.nodes, current);
}

/** Validate selected exact nodes while retaining the whole original receipt. */
export function assertRendererGeneratedOutputReceiptNodesCurrent(
  registration: RendererGeneratedOutputRegistration,
  receipt: RendererGeneratedOutputReceipt,
  currentSelected: RendererGeneratedOutputCurrentNodes,
): void {
  assertRegistration(registration);
  if (receipts.get(receipt) !== registration)
    fail('receipt has not been validated for this registration');
  const selected = captureCurrentNodes(registration, currentSelected);
  for (const node of selected) {
    const original = receipt.nodes.find(expected =>
      sameNodePath(node.path, expected.path, registration),
    );
    if (!original || canonical(original) !== canonical(node))
      fail('selected node is not an unchanged exact member of its receipt');
  }
}

/** Check one host-selected current graph without minting a receipt or permission. */
export function assertRendererGeneratedOutputNodesConsistent(
  registration: RendererGeneratedOutputRegistration,
  current: RendererGeneratedOutputCurrentNodes,
): void {
  assertRegistration(registration);
  captureCurrentNodes(registration, current);
}

/** Exact acknowledged nodes only; unacknowledged descendants remain inputs. */
export function rendererGeneratedOutputPermission(
  receipt: RendererGeneratedOutputReceipt,
  inputPath: string,
): RendererGeneratedOutputNode | undefined {
  const registration = receipts.get(receipt);
  if (!registration) fail('receipt has not been validated');
  if (
    typeof inputPath !== 'string' ||
    !nativePath(registration).isAbsolute(inputPath)
  )
    fail('permission requires an absolute node path');
  return receipt.nodes.find(
    node =>
      same(inputPath, node.path.lexical, registration) ||
      same(inputPath, node.path.canonical, registration),
  );
}
