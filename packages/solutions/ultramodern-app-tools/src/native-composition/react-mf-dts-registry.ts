import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  type ClientRequest,
  createServer,
  type IncomingMessage,
  request,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Socket } from 'node:net';
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
  type RendererGeneratedOutputCurrentNodes,
  type RendererGeneratedOutputGeneration,
  type RendererGeneratedOutputNode,
  type RendererGeneratedOutputOperation,
  type RendererGeneratedOutputPath,
  type RendererGeneratedOutputPlan,
  type RendererGeneratedOutputReceipt,
  type RendererGeneratedOutputRegistration,
  type RendererGeneratedOutputRegistrationInput,
  type RendererGeneratedOutputValue,
  rendererGeneratedOutputPermission,
  validateRendererGeneratedOutputReceipt,
} from '@modern-js/app-tools-extensions/renderer-generated-outputs';

export interface ReceiverBridge {
  readonly schemaVersion: 1;
  readonly url: string;
  readonly token: string;
}

export interface ReceiverSeed extends RendererGeneratedOutputGeneration {
  readonly schemaVersion: 1;
  readonly registrationId: string;
  readonly receiverBridge?: ReceiverBridge;
}

export interface ReceiverFrame extends RendererGeneratedOutputGeneration {
  readonly schemaVersion: 1;
  readonly registrationId: string;
  readonly frameId: string;
}

export interface ReceiverBeginDetails {
  readonly operation: 'consumeTypes' | 'updateTypes';
  readonly nativeOptions: RendererGeneratedOutputValue;
  readonly remoteAlias?: string;
  readonly update?: RendererGeneratedOutputValue;
  readonly receiverProcessId?: number;
}

export interface ReceiverStage {
  readonly stage: 'archive' | 'archives' | 'api';
  readonly outcome: 'complete' | 'failed' | 'skipped';
  readonly alias?: string;
  readonly requested?: boolean;
  readonly result?: RendererGeneratedOutputValue;
}

export interface ReceiverFailure {
  readonly operation: string;
  readonly reason: string;
  readonly code?: string;
  readonly path?: string;
}

export interface ReceiverTerminalEvidence {
  readonly status: 'complete' | 'failed';
  readonly frame: ReceiverFrame;
  readonly operations: readonly RendererGeneratedOutputAcknowledgement[];
  readonly nodes: readonly RendererGeneratedOutputNode[];
  readonly stages: readonly ReceiverStage[];
  readonly failures: readonly ReceiverFailure[];
}

export interface ReceiverContext {
  readonly frame: ReceiverFrame;
  readonly inheritedNodes: readonly RendererGeneratedOutputNode[];
  readonly sourceNamespaces?: ReceiverSourceNamespaces;
  beforeOperations(
    operations: readonly RendererGeneratedOutputOperation[],
  ): void;
  acknowledgeOperations(
    operations: readonly RendererGeneratedOutputAcknowledgement[],
  ): void;
  terminal(evidence: ReceiverTerminalEvidence): Promise<void>;
}

/** Owner callbacks must not await work or drains from their own registry. */
export interface ReceiverRegistryCallbacks {
  /** Only the trusted host may replace a configured seed with its live epoch. */
  readonly usePreparedGeneration?: boolean;
  /** Host-only graph ownership captured from the actual shared compiler phase. */
  graphEpoch?(
    registration: RendererGeneratedOutputRegistration,
    frame: ReceiverFrame,
  ): ReceiverGraphEpoch;
  sourceNamespaces?(
    registration: RendererGeneratedOutputRegistration,
  ): ReceiverSourceNamespaces;
  prepareRegistration(
    seed: ReceiverSeed,
    details: ReceiverBeginDetails,
    priorReceipts: readonly SelectedReceiverReceipt[],
  ): Promise<RendererGeneratedOutputRegistrationInput>;
  assertActive(frame: ReceiverFrame): void;
  /** The owning process must read the physical nodes again, after native IO. */
  observeCurrent(
    registration: RendererGeneratedOutputRegistration,
    expectedNodes: readonly RendererGeneratedOutputNode[],
  ): Promise<RendererGeneratedOutputCurrentNodes>;
  onStarted?(
    registration: RendererGeneratedOutputRegistration,
    frame: ReceiverFrame,
  ): void | Promise<void>;
  onCompleted?(
    registration: RendererGeneratedOutputRegistration,
    receipt: RendererGeneratedOutputReceipt,
    frame: ReceiverFrame,
  ): void | Promise<void>;
  onFailed?(frame: ReceiverFrame, error: Error): void | Promise<void>;
}

export interface ReceiverGraph {
  readonly authority: object;
  readonly cohort: object;
  readonly members: readonly {
    readonly compilerId: string;
    readonly registrationId: string;
  }[];
}

export interface ReceiverSourceNamespaces {
  readonly entries: readonly RendererGeneratedOutputPath[];
  readonly dirs: readonly RendererGeneratedOutputPath[];
}

export interface ReceiverWorkerWitness {
  readonly pid: number;
  readonly closed: Promise<void>;
}

export interface ReceiverGraphEpoch {
  readonly authority: object;
  readonly cohort: object;
  readonly operationId: string;
  readonly generation: number;
  readonly revision: string;
}

export interface ReceiverReceiptObservation {
  readonly receipt: RendererGeneratedOutputReceipt;
  readonly current: RendererGeneratedOutputCurrentNodes;
  readonly selectedNodes?: readonly RendererGeneratedOutputNode[];
}

export interface ReceiverReceiptLease {
  readonly revision: number;
  assertEpochCurrent(): void;
  assertCurrent(observations: readonly ReceiverReceiptObservation[]): void;
  permission(inputPath: string): RendererGeneratedOutputNode | undefined;
  withPublication<T>(callback: () => Promise<T>): Promise<T>;
  release(): void;
}

export interface ReceiverRegistry {
  /** Seal actual configured compiler enrollment once, before receiver IO. */
  sealReceiverGraph(graph: ReceiverGraph): void;
  /** Bind only a witness issued by the owning native worker creation hook. */
  bindReceiverWorker(
    compilerId: string,
    registrationId: string,
    witness: ReceiverWorkerWitness,
  ): void;
  receiverProcessId(frame: ReceiverFrame): number | undefined;
  begin(
    seed: ReceiverSeed,
    details: ReceiverBeginDetails,
  ): Promise<ReceiverContext>;
  openBridge(): Promise<ReceiverBridge>;
  closeGeneration(
    generation: RendererGeneratedOutputGeneration,
    reason?: string,
  ): void;
  assertReceiptCurrent(
    receipt: RendererGeneratedOutputReceipt,
    current: RendererGeneratedOutputCurrentNodes,
  ): void;
  permission(
    receipt: RendererGeneratedOutputReceipt,
    inputPath: string,
    current: RendererGeneratedOutputCurrentNodes,
  ): RendererGeneratedOutputNode | undefined;
  pinReceipts(
    observations: readonly ReceiverReceiptObservation[],
  ): ReceiverReceiptLease;
  waitForIdle(): Promise<void>;
  /** Drain actual IO lifetimes, including invalidated frames, without granting permissions. */
  waitForSettled(): Promise<void>;
  advanceGeneration(
    generation: RendererGeneratedOutputGeneration,
    registrationId: string,
  ): void;
  /** The owning host must have observed the receiver worker actually terminate. */
  confirmReceiverTerminated(frame: ReceiverFrame): void;
  /** Exact unfinished frames requiring genuine native completion or owning worker termination. */
  quarantinedFrames(origin?: 'direct' | 'bridge'): readonly ReceiverFrame[];
  completedReceipts(): readonly {
    readonly registration: RendererGeneratedOutputRegistration;
    readonly receipt: RendererGeneratedOutputReceipt;
    readonly frame: ReceiverFrame;
    readonly selectedNodes: readonly RendererGeneratedOutputNode[];
  }[];
  dispose(): Promise<void>;
}

type ReceiverEvent =
  | {
      readonly event: 'before';
      readonly sequence: number;
      readonly operations: readonly RendererGeneratedOutputOperation[];
      readonly previousPlanDigest?: string;
      readonly planDigest: string;
    }
  | {
      readonly event: 'acknowledge';
      readonly sequence: number;
      readonly operations: readonly RendererGeneratedOutputAcknowledgement[];
    };

interface ActiveReceiver {
  readonly origin: 'direct' | 'bridge';
  readonly receiverProcessId?: number;
  readonly worker?: ReceiverWorkerBinding;
  readonly frame: ReceiverFrame;
  readonly registration: RendererGeneratedOutputRegistration;
  readonly details: ReceiverBeginDetails;
  readonly context: ReceiverContext;
  readonly inheritedNodes: readonly RendererGeneratedOutputNode[];
  plan?: RendererGeneratedOutputPlan;
  acknowledgements: readonly RendererGeneratedOutputAcknowledgement[];
  status: 'active' | 'terminal' | 'failed';
  error?: Error;
}

interface ReceiverWorkerBinding {
  readonly registrationId: string;
  readonly cohort: object | undefined;
  readonly witness: ReceiverWorkerWitness;
  closed: boolean;
}

export interface SelectedReceiverReceipt {
  readonly frame: ReceiverFrame;
  readonly registration: RendererGeneratedOutputRegistration;
  readonly receipt: RendererGeneratedOutputReceipt;
  readonly selectedNodes: readonly RendererGeneratedOutputNode[];
}

const BODY_LIMIT = 2 * 1024 * 1024;
const REQUEST_TIMEOUT = 15_000;

function fail(reason: string): never {
  throw new Error(`Receiver DTS registry: ${reason}.`);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Capture only ordinary finite data, without evaluating getters or toJSON. */
function capture<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') fail('evidence must contain finite JSON data');
  if (ancestors.has(value)) fail('cyclic evidence is unsupported');
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  )
    fail('evidence must contain plain data');
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (
      typeof key !== 'string' ||
      !('value' in descriptor) ||
      (!descriptor.enumerable && !(array && key === 'length'))
    )
      fail('evidence must not contain accessors or hidden fields');
  }
  let result: unknown;
  if (array) {
    const length = descriptors.length!.value as number;
    if (
      Object.keys(descriptors).length !== length + 1 ||
      Array.from({ length }, (_, i) => String(i)).some(
        key => !Object.hasOwn(descriptors, key),
      )
    )
      fail('evidence arrays must be dense');
    result = Array.from({ length }, (_, i) =>
      capture(descriptors[String(i)]!.value, ancestors),
    );
  } else {
    result = Object.fromEntries(
      Object.keys(descriptors).map(key => [
        key,
        capture(descriptors[key]!.value, ancestors),
      ]),
    );
  }
  ancestors.delete(value);
  return Object.freeze(result) as T;
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

function keys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('evidence object is missing');
  const actual = Object.keys(value);
  if (
    required.some(key => !actual.includes(key)) ||
    actual.some(key => !required.includes(key) && !optional.includes(key))
  )
    fail('evidence fields do not match the declared contract');
}

function generation(
  value: RendererGeneratedOutputGeneration,
): RendererGeneratedOutputGeneration {
  for (const key of ['operationId', 'compilerId', 'revision'] as const)
    if (
      typeof value[key] !== 'string' ||
      !value[key] ||
      value[key].trim() !== value[key]
    )
      fail(`invalid ${key}`);
  if (!Number.isSafeInteger(value.generation) || value.generation < 1)
    fail('invalid generation');
  return Object.freeze({
    operationId: value.operationId,
    compilerId: value.compilerId,
    generation: value.generation,
    revision: value.revision,
  });
}

function seedInput(input: ReceiverSeed): ReceiverSeed {
  const seed = capture(input);
  keys(
    seed,
    [
      'schemaVersion',
      'registrationId',
      'operationId',
      'compilerId',
      'generation',
      'revision',
    ],
    ['receiverBridge'],
  );
  if (
    seed.schemaVersion !== 1 ||
    typeof seed.registrationId !== 'string' ||
    !seed.registrationId ||
    seed.registrationId.trim() !== seed.registrationId
  )
    fail('invalid registration seed');
  generation(seed);
  if (seed.receiverBridge) bridgeInput(seed.receiverBridge);
  return seed;
}

function detailsInput(input: ReceiverBeginDetails): ReceiverBeginDetails {
  const details = capture(input);
  keys(
    details,
    ['operation', 'nativeOptions'],
    ['remoteAlias', 'update', 'receiverProcessId'],
  );
  if (!['consumeTypes', 'updateTypes'].includes(details.operation))
    fail('unsupported native receiver operation');
  if (
    'remoteAlias' in details &&
    (typeof details.remoteAlias !== 'string' || !details.remoteAlias)
  )
    fail('invalid remote alias');
  if (
    'update' in details &&
    (details.operation !== 'updateTypes' ||
      !details.update ||
      typeof details.update !== 'object' ||
      Array.isArray(details.update))
  )
    fail('update options require an actual updateTypes request object');
  if (
    'receiverProcessId' in details &&
    (!Number.isSafeInteger(details.receiverProcessId) ||
      details.receiverProcessId! < 1)
  )
    fail('receiver process identity is invalid');
  return details;
}

function bridgeInput(input: ReceiverBridge): ReceiverBridge {
  const bridge = capture(input);
  keys(bridge, ['schemaVersion', 'url', 'token']);
  if (
    bridge.schemaVersion !== 1 ||
    typeof bridge.token !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(bridge.token)
  )
    fail('invalid bridge capability');
  let url: URL;
  try {
    url = new URL(bridge.url);
  } catch {
    return fail('invalid bridge URL');
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/receiver-dts' ||
    url.search ||
    url.hash
  )
    fail('bridge must use its literal loopback HTTP endpoint');
  return bridge;
}

function stagesComplete(evidence: ReceiverTerminalEvidence): void {
  if (evidence.status !== 'complete' || evidence.failures.length)
    fail('native receiver failed');
  if (!Array.isArray(evidence.stages)) fail('native stage evidence is missing');
  for (const stage of evidence.stages) {
    keys(stage, ['stage', 'outcome'], ['alias', 'requested', 'result']);
    if (stage.stage === 'archive') {
      const result = stage.result as
        | { kind?: string; alias?: string; destinationPath?: string }
        | undefined;
      if (
        stage.outcome !== 'complete' ||
        stage.requested !== true ||
        !stage.alias ||
        !result ||
        result.kind !== 'tuple' ||
        result.alias !== stage.alias ||
        typeof result.destinationPath !== 'string' ||
        !/^(?:\/|[A-Za-z]:[\\/])/u.test(result.destinationPath)
      )
        fail('archive did not return its actual receiver tuple');
      keys(result, ['kind', 'alias', 'destinationPath']);
    } else if (stage.stage === 'archives') {
      const result = stage.result as
        | { settled?: number; completed?: number; failed?: number }
        | undefined;
      if (
        stage.outcome !== 'complete' ||
        !result ||
        !Number.isSafeInteger(result.settled) ||
        result.settled! < 0 ||
        result.completed !== result.settled ||
        result.failed !== 0
      )
        fail('native archive aggregate did not complete');
      keys(result, ['settled', 'completed', 'failed']);
    } else if (stage.stage === 'api') {
      if (stage.requested === true) {
        if (stage.outcome !== 'complete' || typeof stage.result !== 'boolean')
          fail('requested API type receiver did not complete');
      } else if (
        stage.requested !== false ||
        stage.outcome !== 'skipped' ||
        stage.result !== 'not-requested'
      )
        fail('API receiver skip is unsupported');
    } else fail('unsupported native stage');
  }
  if (
    evidence.operations.length &&
    !evidence.stages.some(stage => stage.outcome === 'complete')
  )
    fail('writes require completed native receiver stages');
}

function terminalInput(
  input: ReceiverTerminalEvidence,
): ReceiverTerminalEvidence {
  const evidence = capture(input);
  keys(evidence, [
    'status',
    'frame',
    'operations',
    'nodes',
    'stages',
    'failures',
  ]);
  if (
    !['complete', 'failed'].includes(evidence.status) ||
    !Array.isArray(evidence.operations) ||
    !Array.isArray(evidence.nodes) ||
    !Array.isArray(evidence.stages) ||
    !Array.isArray(evidence.failures)
  )
    fail('terminal evidence is incomplete');
  for (const failure of evidence.failures) {
    keys(failure, ['operation', 'reason'], ['code', 'path']);
    if (
      typeof failure.operation !== 'string' ||
      !failure.operation ||
      typeof failure.reason !== 'string' ||
      !failure.reason
    )
      fail('invalid native failure evidence');
  }
  return evidence;
}

function assertAcknowledgements(
  plan: RendererGeneratedOutputPlan | undefined,
  previous: readonly RendererGeneratedOutputAcknowledgement[],
  batch: readonly RendererGeneratedOutputAcknowledgement[],
): readonly RendererGeneratedOutputAcknowledgement[] {
  if (
    !plan ||
    !Array.isArray(batch) ||
    batch.length === 0 ||
    previous.length + batch.length > plan.operations.length
  )
    fail('acknowledgement has no pending exact plan');
  for (const [index, acknowledgement] of batch.entries()) {
    keys(acknowledgement, ['operation', 'kind', 'before', 'after'], ['cause']);
    const { after: _after, ...operation } = acknowledgement;
    if (
      canonical(operation) !==
      canonical(plan.operations[previous.length + index])
    )
      fail('acknowledgements are partial, reordered or replayed');
  }
  return Object.freeze([...previous, ...batch]);
}

function normalizedPath(
  value: string,
  registration: RendererGeneratedOutputRegistration,
): string {
  const normalized = path[registration.pathFlavor].resolve(value);
  return registration.pathFlavor === 'win32'
    ? normalized.toLowerCase()
    : normalized;
}

function sourceNamespacesInput(
  registration: RendererGeneratedOutputRegistration,
  input: ReceiverSourceNamespaces,
): ReceiverSourceNamespaces {
  const policy = capture(input);
  keys(policy, ['entries', 'dirs']);
  const api = path[registration.pathFlavor];
  for (const paths of [policy.entries, policy.dirs]) {
    if (!Array.isArray(paths))
      fail('source namespaces must have exact path arrays');
    for (const pair of paths) {
      keys(pair, ['lexical', 'canonical']);
      if (
        typeof pair.lexical !== 'string' ||
        typeof pair.canonical !== 'string' ||
        !api.isAbsolute(pair.lexical) ||
        !api.isAbsolute(pair.canonical)
      )
        fail('source namespaces must contain absolute path pairs');
    }
  }
  return policy;
}

function nodeKey(
  node: RendererGeneratedOutputNode,
  registration: RendererGeneratedOutputRegistration,
): string {
  return canonical([
    normalizedPath(node.path.lexical, registration),
    normalizedPath(node.path.canonical, registration),
  ]);
}

function assertInheritedBefore(
  registration: RendererGeneratedOutputRegistration,
  inherited: readonly RendererGeneratedOutputNode[],
  previous: RendererGeneratedOutputPlan | undefined,
  acknowledgements: readonly RendererGeneratedOutputAcknowledgement[],
  operations: readonly RendererGeneratedOutputOperation[],
): void {
  for (const operation of operations) {
    const key = nodeKey(operation.before, registration);
    const aliases = [
      normalizedPath(operation.before.path.lexical, registration),
      normalizedPath(operation.before.path.canonical, registration),
    ];
    for (const node of inherited) {
      if (nodeKey(node, registration) === key) continue;
      const pathAlias = [node.path.lexical, node.path.canonical].some(value =>
        aliases.includes(normalizedPath(value, registration)),
      );
      const inodeAlias =
        node.kind !== 'missing' &&
        operation.before.kind !== 'missing' &&
        node.metadata.device === operation.before.metadata.device &&
        node.metadata.inode === operation.before.metadata.inode;
      if (pathAlias || inodeAlias)
        fail('native IO aliases a different previous generated node');
    }
    if (
      previous?.operations.some(
        prior => nodeKey(prior.before, registration) === key,
      )
    )
      continue;
    const prior = inherited.find(node => nodeKey(node, registration) === key);
    if (prior && canonical(prior) !== canonical(operation.before)) {
      if (!previous) fail('previous generated node changed before native IO');
      assertRendererGeneratedOutputInheritedNodeProgress(
        registration,
        prior,
        operation,
        previous,
        acknowledgements,
      );
    }
  }
}

export function createReceiverRegistry(
  callbacks: ReceiverRegistryCallbacks,
): ReceiverRegistry {
  const active = new Map<string, ActiveReceiver>();
  const quarantined = new Map<string, ActiveReceiver>();
  const issued = new Map<
    RendererGeneratedOutputReceipt,
    { frame: ReceiverFrame; registration: RendererGeneratedOutputRegistration }
  >();
  const closed = new Set<string>();
  const latest = new Map<string, RendererGeneratedOutputGeneration>();
  const authorities = new Map<string, string>();
  const attempted = new Map<string, number>();
  const sockets = new Set<Socket>();
  const bridgeBegins = new Map<
    string,
    { frame?: ReceiverFrame; error?: Error; admitted?: boolean }
  >();
  const retiredBridgeBegins = new Set<string>();
  const retiredBridgeFrames = new Map<string, ReceiverFrame>();
  const failureReports = new Set<Promise<void>>();
  const failureNotifications = new Map<string, Promise<void>>();
  const workers = new Map<string, ReceiverWorkerBinding>();
  const frameLifetimes = new Map<string, ActiveReceiver>();
  const graphOwnerships = new WeakMap<
    RendererGeneratedOutputRegistration,
    ReceiverGraphEpoch
  >();
  const graphFrames = new Map<
    string,
    { readonly epoch: ReceiverGraphEpoch; readonly frame: ReceiverFrame }
  >();
  const closedGraphEpochs = new Set<string>();
  let receiverGraph: ReceiverGraph | undefined;
  let graphCurrent: ReceiverGraphEpoch | undefined;
  let graphGateFrameId: string | undefined;
  let hasBegun = false;
  let queuedGraphBegins = 0;
  let revision = 0;
  let disposed = false;
  let server: Server | undefined;
  let bridgePromise: Promise<ReceiverBridge> | undefined;
  let disposePromise: Promise<void> | undefined;
  let pendingBegins = 0;
  let pendingTerminals = 0;
  let publicationLocked = false;
  const publicationWaiters = new Set<{
    resolve(): void;
    reject(error: Error): void;
  }>();
  let lastFailure: Error | undefined;
  const idleWaiters = new Set<{
    resolve(): void;
    reject(error: Error): void;
  }>();
  const settledWaiters = new Set<{
    resolve(): void;
    reject(error: Error): void;
  }>();
  const generationKey = (value: RendererGeneratedOutputGeneration) =>
    canonical(generation(value));
  const graphEpochKey = (value: ReceiverGraphEpoch) =>
    canonical({
      operationId: value.operationId,
      generation: value.generation,
      revision: value.revision,
    });

  function sealReceiverGraph(input: ReceiverGraph): void {
    if (disposed) fail('registry is disposed');
    if (!callbacks.graphEpoch) fail('host graph ownership callback is missing');
    if (receiverGraph || hasBegun)
      fail('receiver graph enrollment is already sealed or started');
    keys(input, ['authority', 'cohort', 'members']);
    if (
      !input.authority ||
      typeof input.authority !== 'object' ||
      !input.cohort ||
      typeof input.cohort !== 'object'
    )
      fail('receiver graph requires opaque host authority and cohort');
    const members = capture(input.members);
    if (!Array.isArray(members) || members.length === 0)
      fail('receiver graph requires exact configured members');
    for (const [index, member] of members.entries()) {
      keys(member, ['compilerId', 'registrationId']);
      for (const value of [member.compilerId, member.registrationId])
        if (typeof value !== 'string' || !value || value.trim() !== value)
          fail('receiver graph member identity is invalid');
      if (
        members
          .slice(0, index)
          .some(
            prior =>
              prior.compilerId === member.compilerId ||
              prior.registrationId === member.registrationId,
          )
      )
        fail('receiver graph members must have unique owning identities');
    }
    receiverGraph = Object.freeze({
      authority: input.authority,
      cohort: input.cohort,
      members,
    });
  }

  function assertMember(compilerId: string, registrationId: string): void {
    if (!callbacks.graphEpoch) return;
    if (!receiverGraph) fail('receiver graph is not sealed');
    if (
      !receiverGraph.members.some(
        member =>
          member.compilerId === compilerId &&
          member.registrationId === registrationId,
      )
    )
      fail('receiver is not an enrolled graph member');
  }

  function bindReceiverWorker(
    compilerId: string,
    registrationId: string,
    witness: ReceiverWorkerWitness,
  ): void {
    if (disposed) fail('registry is disposed');
    assertMember(compilerId, registrationId);
    if (
      typeof compilerId !== 'string' ||
      !compilerId ||
      typeof registrationId !== 'string' ||
      !registrationId ||
      !Number.isSafeInteger(witness.pid) ||
      witness.pid < 1 ||
      !(witness.closed instanceof Promise)
    )
      fail('native receiver worker witness is invalid');
    const previous = workers.get(compilerId);
    if (previous && !previous.closed)
      fail('native receiver worker is still live for this compiler');
    if (previous?.witness === witness)
      fail('native receiver worker witness was already retired');
    const authority = authorities.get(compilerId);
    if (authority && authority !== registrationId)
      fail('native receiver worker registration authority changed');
    const binding: ReceiverWorkerBinding = {
      registrationId,
      cohort: receiverGraph?.cohort,
      witness,
      closed: false,
    };
    workers.set(compilerId, binding);
    void witness.closed.then(
      () => {
        binding.closed = true;
        for (const state of active.values())
          if (state.worker === binding)
            closeGeneration(
              state.frame,
              'native receiver worker terminated before completion',
            );
      },
      error => {
        for (const state of active.values())
          if (state.worker === binding)
            closeGeneration(state.frame, asError(error).message);
      },
    );
  }

  function receiverProcessId(frame: ReceiverFrame): number | undefined {
    if (disposed) fail('registry is disposed');
    const state = frameLifetimes.get(frame.frameId);
    if (!state || canonical(state.frame) !== canonical(capture(frame)))
      fail('receiver lifetime frame is unknown');
    return state.receiverProcessId;
  }

  function wakeBegins(): void {
    for (const waiter of publicationWaiters) waiter.resolve();
    publicationWaiters.clear();
  }

  function releaseGraphGate(frame: ReceiverFrame): void {
    if (graphGateFrameId !== frame.frameId) return;
    graphGateFrameId = undefined;
    wakeBegins();
  }

  function captureGraphEpoch(
    registration: RendererGeneratedOutputRegistration,
    frame: ReceiverFrame,
  ): void {
    if (!receiverGraph) return;
    const value = callbacks.graphEpoch!(registration, frame);
    keys(value, [
      'authority',
      'cohort',
      'operationId',
      'generation',
      'revision',
    ]);
    if (
      value.authority !== receiverGraph.authority ||
      value.cohort !== receiverGraph.cohort
    )
      fail('receiver graph authority or implementation cohort changed');
    const tuple = generation({ ...value, compilerId: frame.compilerId });
    const ownership: ReceiverGraphEpoch = Object.freeze({
      authority: value.authority,
      cohort: value.cohort,
      operationId: tuple.operationId,
      generation: tuple.generation,
      revision: tuple.revision,
    });
    const key = graphEpochKey(ownership);
    if (closedGraphEpochs.has(key)) fail('receiver graph epoch is closed');
    if (graphCurrent) {
      if (ownership.generation < graphCurrent.generation)
        fail('receiver graph epoch is stale');
      if (
        ownership.generation === graphCurrent.generation &&
        key !== graphEpochKey(graphCurrent)
      )
        fail('receiver graph epoch identity conflicts');
      if (ownership.generation > graphCurrent.generation) {
        if (active.size || quarantined.size || pendingTerminals)
          fail('previous graph receiver IO has not settled');
        closedGraphEpochs.add(graphEpochKey(graphCurrent));
        for (const owner of issued.values())
          closed.add(generationKey(owner.frame));
        issued.clear();
        lastFailure = undefined;
      } else if (lastFailure) throw lastFailure;
    }
    graphCurrent = ownership;
    graphOwnerships.set(registration, ownership);
    graphFrames.set(frame.frameId, { epoch: ownership, frame });
  }

  function assertOwner(frame: ReceiverFrame, checkLatest = true): void {
    if (disposed) fail('registry is disposed');
    if (closed.has(generationKey(frame))) fail('generation is closed');
    const graphOwner = graphFrames.get(frame.frameId)?.epoch;
    if (
      graphOwner &&
      (closedGraphEpochs.has(graphEpochKey(graphOwner)) ||
        !graphCurrent ||
        graphEpochKey(graphOwner) !== graphEpochKey(graphCurrent))
    )
      fail('receiver graph epoch is closed or superseded');
    const current = latest.get(frame.compilerId);
    if (
      checkLatest &&
      current &&
      generationKey(current) !== generationKey(frame)
    )
      fail('generation is superseded');
    callbacks.assertActive(frame);
  }

  function settleIdle(): void {
    if (
      !pendingBegins &&
      !pendingTerminals &&
      !active.size &&
      !quarantined.size &&
      !failureReports.size &&
      !publicationLocked &&
      !queuedGraphBegins
    ) {
      for (const waiter of settledWaiters) {
        if (disposed)
          waiter.reject(new Error('Receiver DTS registry is disposed.'));
        else waiter.resolve();
      }
      settledWaiters.clear();
    }
    if (
      pendingBegins ||
      pendingTerminals ||
      active.size ||
      failureReports.size ||
      (queuedGraphBegins && !lastFailure)
    )
      return;
    for (const waiter of idleWaiters) {
      if (disposed)
        waiter.reject(new Error('Receiver DTS registry is disposed.'));
      else if (lastFailure) waiter.reject(lastFailure);
      else waiter.resolve();
    }
    idleWaiters.clear();
  }

  function graphNativeScope(
    registration: RendererGeneratedOutputRegistration,
  ): string {
    return canonical({
      pathFlavor: registration.pathFlavor,
      producer: registration.producer,
      consumer: registration.consumer,
    });
  }

  function receiptScope(
    registration: RendererGeneratedOutputRegistration,
  ): string {
    const graphOwner = graphOwnerships.get(registration);
    if (graphOwner)
      return canonical({
        graphEpoch: graphEpochKey(graphOwner),
        nativeScope: graphNativeScope(registration),
      });
    return canonical({
      id: registration.id,
      pathFlavor: registration.pathFlavor,
      producer: registration.producer,
      consumer: registration.consumer,
      generation: registration.generation,
      destinations: registration.destinations,
      effectiveOptions: registration.effectiveOptions,
    });
  }

  function selectReceipts(candidate?: {
    frame: ReceiverFrame;
    registration: RendererGeneratedOutputRegistration;
    receipt: RendererGeneratedOutputReceipt;
  }): readonly SelectedReceiverReceipt[] {
    const records = [...issued].map(([receipt, owner]) => ({
      ...owner,
      receipt,
    }));
    if (candidate) records.push(candidate);
    const first = records[0];
    if (!first) return [];
    const scope = receiptScope(first.registration);
    const selected = new Map<
      string,
      {
        receipt: RendererGeneratedOutputReceipt;
        node: RendererGeneratedOutputNode;
      }
    >();
    for (const record of records) {
      assertOwner(record.frame);
      if (receiptScope(record.registration) !== scope)
        fail('receipts belong to different live registration owners or epochs');
      for (const node of record.receipt.nodes) {
        const key = nodeKey(node, record.registration);
        const aliases = [
          normalizedPath(node.path.lexical, record.registration),
          normalizedPath(node.path.canonical, record.registration),
        ];
        for (const [otherKey, prior] of selected) {
          if (otherKey === key) continue;
          if (
            [prior.node.path.lexical, prior.node.path.canonical].some(value =>
              aliases.includes(normalizedPath(value, record.registration)),
            )
          )
            fail('receipt nodes have conflicting path aliases');
        }
        selected.set(key, { receipt: record.receipt, node });
      }
    }
    const nodes = [...selected.values()].map(value => value.node);
    assertRendererGeneratedOutputNodesConsistent(first.registration, {
      generation: first.registration.generation,
      nodes,
    });
    return Object.freeze(
      records.map(record =>
        Object.freeze({
          ...record,
          selectedNodes: Object.freeze(
            [...selected.values()]
              .filter(value => value.receipt === record.receipt)
              .map(value => value.node),
          ),
        }),
      ),
    );
  }

  function assertSelectionCurrent(
    record: SelectedReceiverReceipt,
    current: RendererGeneratedOutputCurrentNodes,
    selection?: readonly RendererGeneratedOutputNode[],
  ): void {
    assertOwner(record.frame);
    if (selection && canonical(selection) !== canonical(record.selectedNodes))
      fail('receipt node selection changed');
    assertRendererGeneratedOutputReceiptNodesCurrent(
      record.registration,
      record.receipt,
      current,
    );
    if (
      current.nodes.length !== record.selectedNodes.length ||
      record.selectedNodes.some(
        expected =>
          !current.nodes.some(
            observed => canonical(expected) === canonical(observed),
          ),
      )
    )
      fail(
        'current observations do not cover the exact selected receipt nodes',
      );
  }

  async function observeSelections(
    records: readonly SelectedReceiverReceipt[],
    expectedRevision: number,
  ): Promise<void> {
    const nodes: RendererGeneratedOutputNode[] = [];
    for (const record of records) {
      const current = await callbacks.observeCurrent(
        record.registration,
        record.selectedNodes,
      );
      if (revision !== expectedRevision)
        fail('receipt revision changed during physical observation');
      assertSelectionCurrent(record, current);
      nodes.push(...current.nodes);
    }
    const first = records[0];
    if (first)
      assertRendererGeneratedOutputNodesConsistent(first.registration, {
        generation: first.registration.generation,
        nodes,
      });
  }

  function notifyFailure(frame: ReceiverFrame, error: Error): Promise<void> {
    const existing = failureNotifications.get(frame.frameId);
    if (existing) return existing;
    const reporting = Promise.resolve()
      .then(() => callbacks.onFailed?.(frame, error))
      .then(
        () => {},
        failure => {
          lastFailure = asError(failure);
        },
      )
      .finally(() => {
        failureReports.delete(reporting);
        settleIdle();
      });
    failureNotifications.set(frame.frameId, reporting);
    failureReports.add(reporting);
    return reporting;
  }

  function closeGeneration(
    value: RendererGeneratedOutputGeneration,
    reason = 'generation closed',
  ): void {
    const target = generationKey(value);
    const graphOwner = [...graphFrames.values()].find(
      owner => generationKey(owner.frame) === target,
    )?.epoch;
    const graphTarget = graphOwner && graphEpochKey(graphOwner);
    if (graphTarget) closedGraphEpochs.add(graphTarget);
    const belongs = (frame: ReceiverFrame) =>
      generationKey(frame) === target ||
      (graphTarget &&
        graphFrames.get(frame.frameId)?.epoch &&
        graphEpochKey(graphFrames.get(frame.frameId)!.epoch) === graphTarget);
    closed.add(target);
    revision++;
    for (const state of active.values())
      if (belongs(state.frame)) {
        active.delete(state.frame.frameId);
        quarantined.set(state.frame.frameId, state);
        state.status = 'failed';
        state.error = new Error(reason);
        lastFailure = state.error;
        void notifyFailure(state.frame, state.error);
      }
    for (const [receipt, owner] of issued)
      if (belongs(owner.frame)) issued.delete(receipt);
    settleIdle();
  }

  async function begin(
    rawSeed: ReceiverSeed,
    rawDetails: ReceiverBeginDetails,
    cancelled?: () => Error | undefined,
    admitted?: () => void,
    origin: 'direct' | 'bridge' = 'direct',
  ): Promise<ReceiverContext> {
    const seed = seedInput(rawSeed);
    const details = detailsInput(rawDetails);
    if (origin === 'bridge' && details.receiverProcessId === undefined)
      fail('authenticated bridge requires actual receiver process identity');
    assertMember(seed.compilerId, seed.registrationId);
    const graphQueued =
      !!receiverGraph && (publicationLocked || !!graphGateFrameId);
    if (graphQueued) queuedGraphBegins++;
    try {
      while (publicationLocked || graphGateFrameId) {
        await new Promise<void>((resolve, reject) =>
          publicationWaiters.add({ resolve, reject }),
        );
      }
    } finally {
      if (graphQueued) queuedGraphBegins--;
    }
    const cancellation = cancelled?.();
    if (cancellation) {
      settleIdle();
      throw cancellation;
    }
    if (disposed) fail('registry is disposed');
    if (quarantined.size)
      fail('quarantined receiver IO has not settled before registration');
    let frame: ReceiverFrame = Object.freeze({
      ...generation(seed),
      schemaVersion: 1,
      registrationId: seed.registrationId,
      frameId: randomBytes(16).toString('hex'),
    });
    hasBegun = true;
    if (receiverGraph) graphGateFrameId = frame.frameId;
    admitted?.();
    pendingBegins++;
    attempted.set(
      seed.compilerId,
      Math.max(attempted.get(seed.compilerId) ?? 0, seed.generation),
    );
    revision++;
    try {
      const priorReceipts = selectReceipts();
      const registration = immutableRendererGeneratedOutputRegistration(
        await callbacks.prepareRegistration(seed, details, priorReceipts),
      );
      if (
        registration.id !== seed.registrationId ||
        registration.generation.compilerId !== seed.compilerId ||
        (!callbacks.usePreparedGeneration &&
          canonical(registration.generation) !== canonical(generation(seed)))
      )
        fail('registration does not match the actual owning generation');
      if (callbacks.usePreparedGeneration)
        frame = Object.freeze({
          ...registration.generation,
          schemaVersion: 1,
          registrationId: registration.id,
          frameId: frame.frameId,
        });
      captureGraphEpoch(registration, frame);
      const authority = authorities.get(frame.compilerId);
      if (authority && authority !== frame.registrationId)
        fail('compiler registration authority changed');
      authorities.set(frame.compilerId, frame.registrationId);
      attempted.set(
        frame.compilerId,
        Math.max(attempted.get(frame.compilerId) ?? 0, frame.generation),
      );
      assertOwner(frame, false);
      const previous = latest.get(frame.compilerId);
      if (previous && frame.generation < previous.generation)
        fail('generation is stale');
      if (
        previous &&
        frame.generation === previous.generation &&
        generationKey(previous) !== generationKey(frame)
      )
        fail('compiler generation identity conflicts');
      if (previous && frame.generation > previous.generation) {
        if (
          [...active.values(), ...quarantined.values()].some(
            state => state.frame.compilerId === frame.compilerId,
          )
        )
          fail('previous compiler receiver IO has not settled');
        if (!receiverGraph) {
          closeGeneration(previous, 'compiler generation superseded');
          lastFailure = undefined;
        } else closed.add(generationKey(previous));
      }
      latest.set(frame.compilerId, generation(frame));
      assertOwner(frame);
      const inheritedReceipts = selectReceipts();
      if (
        inheritedReceipts.some(
          record =>
            receiptScope(record.registration) !== receiptScope(registration),
        )
      )
        fail('registration changed before coalesced native receiver IO');
      await observeSelections(inheritedReceipts, revision);
      assertOwner(frame);
      const inherited = new Map<string, RendererGeneratedOutputNode>();
      if (receiverGraph)
        for (const record of priorReceipts) {
          if (
            graphNativeScope(record.registration) !==
            graphNativeScope(registration)
          )
            fail('prior generated nodes changed physical graph ownership');
          for (const node of record.selectedNodes)
            inherited.set(nodeKey(node, registration), node);
        }
      for (const record of inheritedReceipts)
        for (const node of record.selectedNodes)
          inherited.set(nodeKey(node, registration), node);
      const inheritedNodes = Object.freeze([...inherited.values()]);
      if (receiverGraph && inheritedNodes.length) {
        const observedRevision = revision;
        const current = capture(
          await callbacks.observeCurrent(registration, inheritedNodes),
        );
        assertOwner(frame);
        if (revision !== observedRevision)
          fail('graph changed during inherited node observations');
        assertRendererGeneratedOutputNodesConsistent(registration, current);
        if (
          current.nodes.length !== inheritedNodes.length ||
          inheritedNodes.some(
            expected =>
              !current.nodes.some(
                node => canonical(node) === canonical(expected),
              ),
          )
        )
          fail('prior generated nodes changed before new graph receiver IO');
      }
      const sourceNamespaces = callbacks.sourceNamespaces
        ? sourceNamespacesInput(
            registration,
            callbacks.sourceNamespaces(registration),
          )
        : undefined;
      let state: ActiveReceiver;
      function assertFrame(): void {
        assertOwner(frame);
        if (active.get(frame.frameId) !== state || state.status !== 'active')
          throw (
            state.error ??
            new Error('Receiver DTS registry: frame is late or terminal.')
          );
      }
      function reject(error: unknown): never {
        state.status = 'failed';
        state.error = asError(error);
        throw state.error;
      }
      const context: ReceiverContext = Object.freeze({
        frame,
        inheritedNodes,
        ...(sourceNamespaces ? { sourceNamespaces } : {}),
        beforeOperations(
          rawOperations: readonly RendererGeneratedOutputOperation[],
        ) {
          try {
            assertFrame();
            if (
              state.plan &&
              state.acknowledgements.length !== state.plan.operations.length
            )
              fail('previous operations are not acknowledged');
            const operations = capture(rawOperations);
            if (!Array.isArray(operations) || operations.length === 0)
              fail('pre-write batch is empty');
            assertInheritedBefore(
              registration,
              inheritedNodes,
              state.plan,
              state.acknowledgements,
              operations,
            );
            state.plan = state.plan
              ? assertRendererGeneratedOutputNextOperationsCurrent(
                  registration,
                  state.plan,
                  state.acknowledgements,
                  operations,
                )
              : assertRendererGeneratedOutputOperationsAllowed(
                  registration,
                  operations,
                );
          } catch (error) {
            reject(error);
          }
        },
        acknowledgeOperations(
          rawOperations: readonly RendererGeneratedOutputAcknowledgement[],
        ) {
          try {
            assertFrame();
            state.acknowledgements = assertAcknowledgements(
              state.plan,
              state.acknowledgements,
              capture(rawOperations),
            );
            assertRendererGeneratedOutputAcknowledgementProgress(
              registration,
              state.plan!,
              state.acknowledgements,
            );
          } catch (error) {
            reject(error);
          }
        },
        async terminal(rawEvidence: ReceiverTerminalEvidence) {
          if (quarantined.get(frame.frameId) === state) {
            const evidence = terminalInput(rawEvidence);
            if (canonical(evidence.frame) !== canonical(frame))
              fail('late terminal belongs to another frame');
            quarantined.delete(frame.frameId);
            releaseGraphGate(frame);
            settleIdle();
            throw (
              state.error ??
              new Error(
                'Receiver DTS registry: generation closed before native completion.',
              )
            );
          }
          if (
            active.get(frame.frameId) !== state ||
            state.status === 'terminal'
          )
            fail('frame is unknown, late or already terminal');
          const priorError = state.error;
          state.status = 'terminal';
          active.delete(frame.frameId);
          pendingTerminals++;
          try {
            assertOwner(frame);
            const evidence = terminalInput(rawEvidence);
            if (canonical(evidence.frame) !== canonical(frame))
              fail('terminal evidence belongs to another frame');
            if (priorError) throw priorError;
            stagesComplete(evidence);
            if (
              canonical(evidence.operations) !==
              canonical(state.acknowledgements)
            )
              fail(
                'terminal does not match immediate ordered acknowledgements',
              );
            const plan =
              state.plan ??
              assertRendererGeneratedOutputOperationsAllowed(registration, []);
            const receipt = validateRendererGeneratedOutputReceipt(
              registration,
              plan,
              {
                status: 'complete',
                registrationDigest: registration.registrationDigest,
                planDigest: plan.planDigest,
                generation: registration.generation,
                operations: evidence.operations,
              },
              { generation: registration.generation, nodes: evidence.nodes },
            );
            const selection = selectReceipts({ frame, registration, receipt });
            await observeSelections(selection, revision);
            assertOwner(frame);
            try {
              await callbacks.onCompleted?.(registration, receipt, frame);
              assertOwner(frame);
              await observeSelections(
                selectReceipts({ frame, registration, receipt }),
                revision,
              );
              assertOwner(frame);
              issued.set(receipt, { frame, registration });
              revision++;
            } catch (error) {
              issued.delete(receipt);
              revision++;
              throw error;
            }
          } catch (error) {
            lastFailure = asError(error);
            closeGeneration(frame, asError(error).message);
            await notifyFailure(frame, asError(error));
            throw error;
          } finally {
            pendingTerminals--;
            releaseGraphGate(frame);
            settleIdle();
          }
        },
      });
      state = {
        origin,
        ...(origin === 'bridge'
          ? { receiverProcessId: details.receiverProcessId }
          : {}),
        frame,
        registration,
        details,
        context,
        inheritedNodes,
        acknowledgements: [],
        status: 'active',
        ...(origin === 'bridge' &&
        workers.get(frame.compilerId)?.registrationId ===
          frame.registrationId &&
        workers.get(frame.compilerId)?.witness.pid ===
          details.receiverProcessId &&
        workers.get(frame.compilerId)?.cohort === receiverGraph?.cohort &&
        !workers.get(frame.compilerId)!.closed
          ? { worker: workers.get(frame.compilerId) }
          : {}),
      };
      frameLifetimes.set(frame.frameId, state);
      active.set(frame.frameId, state);
      await callbacks.onStarted?.(registration, frame);
      assertFrame();
      return context;
    } catch (error) {
      lastFailure = asError(error);
      active.delete(frame.frameId);
      quarantined.delete(frame.frameId);
      closeGeneration(frame, asError(error).message);
      await notifyFailure(frame, asError(error));
      releaseGraphGate(frame);
      throw error;
    } finally {
      pendingBegins--;
      settleIdle();
    }
  }

  function assertReceiptCurrent(
    receipt: RendererGeneratedOutputReceipt,
    current: RendererGeneratedOutputCurrentNodes,
  ): void {
    if (lastFailure) throw lastFailure;
    if (
      pendingBegins ||
      pendingTerminals ||
      active.size ||
      quarantined.size ||
      failureReports.size ||
      (queuedGraphBegins && !publicationLocked)
    )
      fail('receiver operations are unfinished');
    const owner = selectReceipts().find(record => record.receipt === receipt);
    if (!owner) fail('receipt is not owned by this active registry');
    assertSelectionCurrent(owner, current);
  }

  function pinReceipts(
    observations: readonly ReceiverReceiptObservation[],
  ): ReceiverReceiptLease {
    if (disposed) fail('registry is disposed');
    if (lastFailure) throw lastFailure;
    if (
      pendingBegins ||
      pendingTerminals ||
      active.size ||
      quarantined.size ||
      failureReports.size ||
      (queuedGraphBegins && !publicationLocked)
    )
      fail('receiver operations are unfinished');
    const receipts = observations.map(observation => observation.receipt);
    if (new Set(receipts).size !== receipts.length)
      fail('receipt lease contains duplicates');
    for (const observation of observations)
      assertReceiptCurrent(observation.receipt, observation.current);
    const pinnedRevision = revision;
    const selected = new Map(
      selectReceipts().map(record => [record.receipt, record]),
    );
    for (const observation of observations) {
      const record = selected.get(observation.receipt)!;
      assertSelectionCurrent(
        record,
        observation.current,
        observation.selectedNodes,
      );
    }
    let released = false;
    function assertPinned(): void {
      if (lastFailure) throw lastFailure;
      if (
        released ||
        disposed ||
        revision !== pinnedRevision ||
        pendingBegins ||
        pendingTerminals ||
        active.size ||
        quarantined.size ||
        failureReports.size ||
        (queuedGraphBegins && !publicationLocked)
      )
        fail('receipt lease is released, disposed or changed');
      for (const receipt of receipts) {
        const owner = issued.get(receipt);
        if (!owner) fail('receipt lease is revoked');
        assertOwner(owner.frame);
      }
    }
    return Object.freeze({
      revision: pinnedRevision,
      assertEpochCurrent: assertPinned,
      assertCurrent(current: readonly ReceiverReceiptObservation[]) {
        assertPinned();
        if (
          current.length !== receipts.length ||
          current.some(
            (observation, index) => observation.receipt !== receipts[index],
          )
        )
          fail('receipt lease observations changed');
        for (const observation of current)
          assertSelectionCurrent(
            selected.get(observation.receipt)!,
            observation.current,
            observation.selectedNodes,
          );
        const first = current[0];
        if (first)
          assertRendererGeneratedOutputNodesConsistent(
            selected.get(first.receipt)!.registration,
            {
              generation: first.receipt.generation,
              nodes: current.flatMap(observation => observation.current.nodes),
            },
          );
      },
      permission(inputPath: string) {
        assertPinned();
        let found: RendererGeneratedOutputNode | undefined;
        for (const receipt of receipts) {
          const node = rendererGeneratedOutputPermission(receipt, inputPath);
          if (node && selected.get(receipt)!.selectedNodes.includes(node)) {
            if (found && canonical(found) !== canonical(node))
              fail('receipt permissions disagree about an exact node');
            found = node;
          }
        }
        return found;
      },
      async withPublication<T>(callback: () => Promise<T>): Promise<T> {
        assertPinned();
        if (publicationLocked)
          fail('another publication owns the receiver fence');
        publicationLocked = true;
        try {
          assertPinned();
          const result = await callback();
          assertPinned();
          return result;
        } finally {
          publicationLocked = false;
          wakeBegins();
          settleIdle();
        }
      },
      release() {
        released = true;
      },
    });
  }

  async function dispatch(
    raw: unknown,
    requestClosed?: () => boolean,
  ): Promise<unknown> {
    const body = capture(raw) as {
      action: string;
      beginId: string;
      reason: string;
      seed: ReceiverSeed;
      details: ReceiverBeginDetails;
      frame: ReceiverFrame;
      evidence: ReceiverTerminalEvidence;
      events: readonly ReceiverEvent[];
    };
    if (
      typeof body.beginId !== 'string' ||
      !/^[a-f0-9]{32}$/u.test(body.beginId)
    )
      fail('bridge begin identity is invalid');
    if (body.action === 'begin') {
      keys(body, ['action', 'beginId', 'seed', 'details']);
      if (
        bridgeBegins.has(body.beginId) ||
        retiredBridgeBegins.has(body.beginId)
      )
        fail('bridge begin identity was already used');
      const slot: { frame?: ReceiverFrame; error?: Error; admitted?: boolean } =
        {};
      bridgeBegins.set(body.beginId, slot);
      try {
        const context = await begin(
          body.seed,
          body.details,
          () =>
            slot.error ??
            (requestClosed?.()
              ? new Error('Receiver DTS bridge BEGIN request closed.')
              : undefined),
          () => {
            slot.admitted = true;
          },
          'bridge',
        );
        slot.frame = context.frame;
        if (!slot.error && requestClosed?.())
          slot.error = new Error('Receiver DTS bridge BEGIN request closed.');
        if (slot.error) {
          await abortBridgeBegin(body.beginId, slot.error);
          quarantined.delete(context.frame.frameId);
          releaseGraphGate(context.frame);
          settleIdle();
          throw slot.error;
        }
        const state = active.get(context.frame.frameId)!;
        const { registrationDigest: _digest, ...registration } =
          state.registration;
        return {
          frame: context.frame,
          registration,
          inheritedNodes: state.inheritedNodes,
          ...(state.context.sourceNamespaces
            ? { sourceNamespaces: state.context.sourceNamespaces }
            : {}),
        };
      } catch (error) {
        bridgeBegins.delete(body.beginId);
        retiredBridgeBegins.add(body.beginId);
        throw error;
      }
    }
    if (body.action === 'abort') {
      keys(body, ['action', 'beginId', 'reason']);
      if (
        typeof body.reason !== 'string' ||
        !body.reason ||
        body.reason.length > 512
      )
        fail('bridge abort reason is invalid');
      if (retiredBridgeBegins.has(body.beginId)) {
        const retired = retiredBridgeFrames.get(body.beginId);
        if (retired) {
          const graphOwner = graphFrames.get(retired.frameId)?.epoch;
          if (
            graphOwner &&
            (!graphCurrent ||
              graphEpochKey(graphOwner) !== graphEpochKey(graphCurrent))
          )
            return { status: 'aborted' };
          lastFailure = new Error(body.reason);
          closeGeneration(retired, body.reason);
          retiredBridgeFrames.delete(body.beginId);
        }
        return { status: 'aborted' };
      }
      if (!bridgeBegins.has(body.beginId)) {
        retiredBridgeBegins.add(body.beginId);
        return { status: 'aborted' };
      }
      await abortBridgeBegin(body.beginId, new Error(body.reason));
      return { status: 'aborted' };
    }
    if (body.action !== 'terminal') fail('unsupported bridge action');
    keys(body, ['action', 'beginId', 'frame', 'evidence', 'events']);
    const slot = bridgeBegins.get(body.beginId);
    if (!slot?.frame || canonical(slot.frame) !== canonical(body.frame))
      fail('bridge terminal belongs to another begin');
    const late = quarantined.get(body.frame?.frameId);
    if (late && canonical(late.frame) === canonical(body.frame)) {
      try {
        await late.context.terminal(body.evidence);
      } finally {
        if (!quarantined.has(late.frame.frameId)) {
          bridgeBegins.delete(body.beginId);
          retiredBridgeBegins.add(body.beginId);
        }
      }
    }
    const state = active.get(body.frame?.frameId);
    if (
      !state ||
      canonical(state.frame) !== canonical(body.frame) ||
      state.status !== 'active'
    )
      fail('bridge frame is unknown, late or terminal');
    try {
      if (!Array.isArray(body.events))
        fail('bridge pre-write provenance is missing');
      for (const [sequence, event] of body.events.entries()) {
        if (event.sequence !== sequence)
          fail('bridge provenance is reordered or replayed');
        if (event.event === 'before') {
          keys(
            event,
            ['event', 'sequence', 'operations', 'planDigest'],
            ['previousPlanDigest'],
          );
          if (event.previousPlanDigest !== state.plan?.planDigest)
            fail('bridge plan chain has a stale predecessor');
          state.context.beforeOperations(event.operations);
          if (event.planDigest !== state.plan!.planDigest)
            fail('bridge plan digest changed');
        } else if (event.event === 'acknowledge') {
          keys(event, ['event', 'sequence', 'operations']);
          state.context.acknowledgeOperations(event.operations);
        } else fail('unsupported bridge provenance event');
      }
      await state.context.terminal(body.evidence);
      return { status: 'accepted' };
    } catch (error) {
      if (active.has(state.frame.frameId)) {
        lastFailure = asError(error);
        closeGeneration(state.frame, asError(error).message);
        try {
          await state.context.terminal(body.evidence);
        } catch {
          // Malformed terminal markers retain quarantine until genuine completion or worker termination.
        }
        await notifyFailure(state.frame, asError(error));
      }
      settleIdle();
      throw error;
    } finally {
      if (!quarantined.has(state.frame.frameId)) {
        bridgeBegins.delete(body.beginId);
        retiredBridgeBegins.add(body.beginId);
        retiredBridgeFrames.set(body.beginId, state.frame);
      }
    }
  }

  async function abortBridgeBegin(
    beginId: string,
    error: Error,
  ): Promise<void> {
    const slot = bridgeBegins.get(beginId);
    if (!slot) return;
    slot.error = error;
    if (!slot.admitted && !slot.frame) return;
    lastFailure = error;
    revision++;
    if (slot.frame) {
      closeGeneration(slot.frame, error.message);
    }
    settleIdle();
  }

  function advanceGeneration(
    value: RendererGeneratedOutputGeneration,
    registrationId: string,
  ): void {
    if (disposed) fail('registry is disposed');
    assertMember(value.compilerId, registrationId);
    if (publicationLocked)
      fail('publication owns the receiver generation fence');
    if (
      pendingBegins ||
      pendingTerminals ||
      active.size ||
      quarantined.size ||
      failureReports.size ||
      queuedGraphBegins
    )
      fail('receiver IO has not settled before compiler advancement');
    if (
      typeof registrationId !== 'string' ||
      !registrationId ||
      registrationId.trim() !== registrationId
    )
      fail('compiler registration authority is missing');
    const authority = authorities.get(value.compilerId);
    if (authority && authority !== registrationId)
      fail('compiler registration authority changed');
    const next = generation(capture(value));
    const previous = latest.get(next.compilerId);
    if (
      next.generation <=
      Math.max(previous?.generation ?? 0, attempted.get(next.compilerId) ?? 0)
    )
      fail('compiler advancement requires a strictly newer generation');
    const frame: ReceiverFrame = Object.freeze({
      ...next,
      schemaVersion: 1,
      registrationId,
      frameId: randomBytes(16).toString('hex'),
    });
    assertOwner(frame, false);
    if (previous) closeGeneration(previous, 'compiler generation superseded');
    if (lastFailure) issued.clear();
    latest.set(next.compilerId, next);
    authorities.set(next.compilerId, registrationId);
    attempted.set(next.compilerId, next.generation);
    lastFailure = undefined;
    revision++;
  }

  function confirmReceiverTerminated(frame: ReceiverFrame): void {
    const state = quarantined.get(frame.frameId);
    if (!state || canonical(state.frame) !== canonical(capture(frame)))
      fail('terminated receiver frame is unknown');
    if (state.origin !== 'bridge')
      fail('direct receiver IO requires its actual terminal');
    if (!state.worker || !state.worker.closed)
      fail('exact native receiver worker termination is unproven');
    quarantined.delete(frame.frameId);
    releaseGraphGate(frame);
    for (const [beginId, slot] of bridgeBegins) {
      if (slot.frame?.frameId === frame.frameId) {
        bridgeBegins.delete(beginId);
        retiredBridgeBegins.add(beginId);
      }
    }
    settleIdle();
  }

  function openBridge(): Promise<ReceiverBridge> {
    if (disposed)
      return Promise.reject(new Error('Receiver DTS registry is disposed.'));
    if (bridgePromise) return bridgePromise;
    const token = randomBytes(32).toString('hex');
    bridgePromise = new Promise<ReceiverBridge>((resolve, reject) => {
      const listener = createServer((req, res) => {
        void serve(req, res, token, dispatch, () => disposed);
      });
      server = listener;
      listener.on('connection', socket => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
      });
      listener.requestTimeout = REQUEST_TIMEOUT;
      listener.headersTimeout = REQUEST_TIMEOUT;
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', () => {
        if (disposed) {
          listener.close();
          reject(new Error('Receiver DTS registry is disposed.'));
          return;
        }
        const address = listener.address();
        if (!address || typeof address === 'string') {
          listener.close();
          reject(new Error('Receiver DTS bridge has no loopback address.'));
          return;
        }
        resolve(
          Object.freeze({
            schemaVersion: 1,
            url: `http://127.0.0.1:${address.port}/receiver-dts`,
            token,
          }),
        );
      });
    });
    return bridgePromise;
  }

  async function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    disposed = true;
    graphGateFrameId = undefined;
    publicationLocked = false;
    for (const waiter of publicationWaiters)
      waiter.reject(new Error('Receiver DTS registry is disposed.'));
    publicationWaiters.clear();
    for (const waiter of [...idleWaiters, ...settledWaiters])
      waiter.reject(new Error('Receiver DTS registry is disposed.'));
    idleWaiters.clear();
    settledWaiters.clear();
    revision++;
    issued.clear();
    const unfinished = [...active.values()];
    active.clear();
    quarantined.clear();
    for (const slot of bridgeBegins.values())
      slot.error = new Error(
        'Receiver DTS registry disposed before bridge completion.',
      );
    bridgeBegins.clear();
    retiredBridgeBegins.clear();
    retiredBridgeFrames.clear();
    latest.clear();
    authorities.clear();
    attempted.clear();
    closed.clear();
    graphFrames.clear();
    closedGraphEpochs.clear();
    graphCurrent = undefined;
    workers.clear();
    frameLifetimes.clear();
    disposePromise = (async () => {
      for (const state of unfinished) {
        state.status = 'failed';
        state.error = new Error(
          'Receiver DTS registry disposed before native completion.',
        );
      }
      const closing = server
        ? new Promise<void>(resolve => {
            server!.close(() => resolve());
            for (const socket of sockets) socket.destroy();
          })
        : Promise.resolve();
      await Promise.allSettled(
        unfinished.map(state => notifyFailure(state.frame, state.error!)),
      );
      await Promise.allSettled(failureReports);
      await closing;
      server = undefined;
      sockets.clear();
      settleIdle();
    })();
    return disposePromise;
  }

  return Object.freeze({
    sealReceiverGraph,
    bindReceiverWorker,
    receiverProcessId,
    begin(seed: ReceiverSeed, details: ReceiverBeginDetails) {
      return begin(seed, details);
    },
    openBridge,
    closeGeneration,
    advanceGeneration,
    confirmReceiverTerminated,
    quarantinedFrames(origin?: 'direct' | 'bridge') {
      if (disposed) fail('registry is disposed');
      if (origin !== undefined && origin !== 'direct' && origin !== 'bridge')
        fail('receiver lifetime origin is invalid');
      return Object.freeze(
        [...quarantined.values()]
          .filter(state => origin === undefined || state.origin === origin)
          .map(state => state.frame),
      );
    },
    assertReceiptCurrent,
    pinReceipts,
    waitForIdle() {
      if (disposed)
        return Promise.reject(new Error('Receiver DTS registry is disposed.'));
      if (
        !pendingBegins &&
        !pendingTerminals &&
        !active.size &&
        !failureReports.size &&
        (!queuedGraphBegins || lastFailure)
      )
        return lastFailure ? Promise.reject(lastFailure) : Promise.resolve();
      return new Promise<void>((resolve, reject) =>
        idleWaiters.add({ resolve, reject }),
      );
    },
    waitForSettled() {
      if (disposed)
        return Promise.reject(new Error('Receiver DTS registry is disposed.'));
      if (
        !pendingBegins &&
        !pendingTerminals &&
        !active.size &&
        !quarantined.size &&
        !failureReports.size &&
        !publicationLocked &&
        !queuedGraphBegins
      )
        return Promise.resolve();
      return new Promise<void>((resolve, reject) =>
        settledWaiters.add({ resolve, reject }),
      );
    },
    completedReceipts() {
      if (disposed) fail('registry is disposed');
      if (lastFailure) throw lastFailure;
      if (
        pendingBegins ||
        pendingTerminals ||
        active.size ||
        quarantined.size ||
        failureReports.size ||
        queuedGraphBegins
      )
        fail('receiver operations are unfinished');
      return selectReceipts();
    },
    permission(
      receipt: RendererGeneratedOutputReceipt,
      inputPath: string,
      current: RendererGeneratedOutputCurrentNodes,
    ) {
      assertReceiptCurrent(receipt, current);
      const node = rendererGeneratedOutputPermission(receipt, inputPath);
      return node &&
        selectReceipts()
          .find(record => record.receipt === receipt)!
          .selectedNodes.includes(node)
        ? node
        : undefined;
    },
    dispose,
  });
}

async function serve(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  dispatch: (body: unknown, requestClosed?: () => boolean) => Promise<unknown>,
  isDisposed: () => boolean,
): Promise<void> {
  let requestClosed = false;
  res.once('close', () => {
    if (!res.writableEnded) requestClosed = true;
  });
  const provided = req.headers.authorization;
  const expected = `Bearer ${token}`;
  if (
    typeof provided !== 'string' ||
    Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    res.writeHead(401).end();
    req.resume();
    return;
  }
  if (isDisposed()) {
    res.writeHead(410).end();
    req.resume();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/receiver-dts') {
    res.writeHead(404).end();
    req.resume();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > BODY_LIMIT) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(buffer);
    }
    const result = await dispatch(
      JSON.parse(Buffer.concat(chunks).toString('utf8')),
      () => requestClosed,
    );
    if (!res.destroyed && !isDisposed())
      res
        .writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        })
        .end(JSON.stringify(result));
  } catch {
    if (!res.destroyed)
      res
        .writeHead(400, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        })
        .end(
          JSON.stringify({
            error: 'Receiver DTS bridge rejected the request.',
          }),
        );
  }
}

/** Child-side policy stays synchronous. Only begin and terminal use transport. */
export function createReceiverBridgeRegistry(
  rawBridge: ReceiverBridge,
): Pick<ReceiverRegistry, 'begin' | 'dispose'> {
  const bridge = bridgeInput(rawBridge);
  const requests = new Set<ClientRequest>();
  const liveBegins = new Set<string>();
  let disposed = false;
  let disposePromise: Promise<void> | undefined;
  function post(body: unknown, afterDispose = false): Promise<unknown> {
    if (disposed && !afterDispose)
      return Promise.reject(
        new Error('Receiver DTS bridge client is disposed.'),
      );
    const bytes = Buffer.from(JSON.stringify(capture(body)));
    if (bytes.length > BODY_LIMIT)
      return Promise.reject(
        new Error('Receiver DTS bridge evidence is too large.'),
      );
    return new Promise((resolve, reject) => {
      const req = request(
        bridge.url,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bridge.token}`,
            'content-type': 'application/json',
            'content-length': bytes.length,
          },
          agent: false,
        },
        res => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > BODY_LIMIT)
              req.destroy(
                new Error('Receiver DTS bridge response is too large.'),
              );
            else chunks.push(chunk);
          });
          res.once('error', reject);
          res.once('end', () => {
            if (res.statusCode !== 200) {
              reject(
                new Error(
                  `Receiver DTS bridge rejected the operation (${res.statusCode ?? 'missing status'}).`,
                ),
              );
              return;
            }
            try {
              resolve(
                capture(JSON.parse(Buffer.concat(chunks).toString('utf8'))),
              );
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      requests.add(req);
      req.once('close', () => requests.delete(req));
      req.once('error', reject);
      req.setTimeout(REQUEST_TIMEOUT, () =>
        req.destroy(new Error('Receiver DTS bridge request timed out.')),
      );
      req.end(bytes);
    });
  }
  async function abort(beginId: string): Promise<void> {
    if (!liveBegins.has(beginId)) return;
    try {
      await post(
        {
          action: 'abort',
          beginId,
          reason:
            'Receiver DTS child did not complete its registered operation.',
        },
        true,
      );
    } finally {
      liveBegins.delete(beginId);
    }
  }
  return Object.freeze({
    async begin(
      rawSeed: ReceiverSeed,
      rawDetails: ReceiverBeginDetails,
    ): Promise<ReceiverContext> {
      const seed = seedInput(rawSeed);
      const details = detailsInput({
        ...capture(rawDetails),
        receiverProcessId: process.pid,
      });
      if (disposed) fail('bridge client is disposed');
      const beginId = randomBytes(16).toString('hex');
      liveBegins.add(beginId);
      try {
        const response = (await post({
          action: 'begin',
          beginId,
          seed,
          details,
        })) as {
          frame: ReceiverFrame;
          registration: RendererGeneratedOutputRegistrationInput;
          inheritedNodes: readonly RendererGeneratedOutputNode[];
          sourceNamespaces?: ReceiverSourceNamespaces;
        };
        if (disposed) fail('bridge client is disposed');
        keys(
          response,
          ['frame', 'registration', 'inheritedNodes'],
          ['sourceNamespaces'],
        );
        keys(response.frame, [
          'schemaVersion',
          'registrationId',
          'operationId',
          'compilerId',
          'generation',
          'revision',
          'frameId',
        ]);
        if (
          response.frame.schemaVersion !== 1 ||
          response.frame.registrationId !== seed.registrationId ||
          response.frame.compilerId !== seed.compilerId ||
          typeof response.frame.frameId !== 'string' ||
          !/^[a-f0-9]{32}$/u.test(response.frame.frameId)
        )
          fail('bridge returned a mismatched frame');
        const registration = immutableRendererGeneratedOutputRegistration(
          response.registration,
        );
        if (
          registration.id !== seed.registrationId ||
          canonical(registration.generation) !==
            canonical(generation(response.frame))
        )
          fail('bridge returned a mismatched registration');
        const frame = capture(response.frame);
        const inheritedNodes = capture(response.inheritedNodes);
        const sourceNamespaces = response.sourceNamespaces
          ? sourceNamespacesInput(registration, response.sourceNamespaces)
          : undefined;
        assertRendererGeneratedOutputNodesConsistent(registration, {
          generation: registration.generation,
          nodes: inheritedNodes,
        });
        const events: ReceiverEvent[] = [];
        let plan: RendererGeneratedOutputPlan | undefined;
        let acknowledgements: readonly RendererGeneratedOutputAcknowledgement[] =
          [];
        let terminal = false;
        let failure: Error | undefined;
        function assertContext(): void {
          if (disposed || terminal)
            fail('bridge frame is disposed or terminal');
          if (failure) throw failure;
        }
        return Object.freeze({
          frame,
          inheritedNodes,
          ...(sourceNamespaces ? { sourceNamespaces } : {}),
          beforeOperations(
            rawOperations: readonly RendererGeneratedOutputOperation[],
          ) {
            try {
              assertContext();
              if (plan && acknowledgements.length !== plan.operations.length)
                fail('previous operations are not acknowledged');
              const operations = capture(rawOperations);
              if (!Array.isArray(operations) || !operations.length)
                fail('pre-write batch is empty');
              assertInheritedBefore(
                registration,
                inheritedNodes,
                plan,
                acknowledgements,
                operations,
              );
              const previousPlanDigest = plan?.planDigest;
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
              events.push(
                Object.freeze({
                  event: 'before',
                  sequence: events.length,
                  operations,
                  ...(previousPlanDigest ? { previousPlanDigest } : {}),
                  planDigest: plan.planDigest,
                }),
              );
            } catch (error) {
              failure = asError(error);
              throw failure;
            }
          },
          acknowledgeOperations(
            rawOperations: readonly RendererGeneratedOutputAcknowledgement[],
          ) {
            try {
              assertContext();
              const operations = capture(rawOperations);
              acknowledgements = assertAcknowledgements(
                plan,
                acknowledgements,
                operations,
              );
              assertRendererGeneratedOutputAcknowledgementProgress(
                registration,
                plan!,
                acknowledgements,
              );
              events.push(
                Object.freeze({
                  event: 'acknowledge',
                  sequence: events.length,
                  operations,
                }),
              );
            } catch (error) {
              failure = asError(error);
              throw failure;
            }
          },
          async terminal(rawEvidence: ReceiverTerminalEvidence) {
            if (disposed || terminal)
              fail('bridge frame is disposed or terminal');
            terminal = true;
            try {
              const evidence = terminalInput(rawEvidence);
              if (canonical(evidence.frame) !== canonical(frame))
                fail('bridge terminal belongs to another frame');
              if (
                canonical(evidence.operations) !== canonical(acknowledgements)
              )
                fail('bridge terminal differs from immediate acknowledgements');
              const result = await post({
                action: 'terminal',
                beginId,
                frame,
                evidence: failure
                  ? {
                      ...evidence,
                      status: 'failed',
                      failures: [
                        ...evidence.failures,
                        {
                          operation: details.operation,
                          reason: failure.message,
                        },
                      ],
                    }
                  : evidence,
                events,
              });
              keys(result, ['status']);
              if ((result as { status: string }).status !== 'accepted')
                fail('bridge terminal was not accepted');
              liveBegins.delete(beginId);
              if (failure) throw failure;
            } catch (error) {
              await abort(beginId).catch(() => {});
              throw error;
            }
          },
        });
      } catch (error) {
        await abort(beginId).catch(() => {});
        throw error;
      }
    },
    dispose() {
      if (disposePromise) return disposePromise;
      disposed = true;
      disposePromise = (async () => {
        for (const req of requests)
          req.destroy(new Error('Receiver DTS bridge client disposed.'));
        requests.clear();
        await Promise.allSettled(
          [...liveBegins].map(beginId => abort(beginId)),
        );
        liveBegins.clear();
      })();
      return disposePromise;
    },
  });
}
