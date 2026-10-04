'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createRequire, syncBuiltinESMExports } = require('node:module');

const ownRequire = createRequire(__filename);
const EXTRA_OPTIONS_KEY = 'ultramodernReceiverDts';
const scopes = new AsyncLocalStorage();
const descriptors = new Map();
const original = new Map();
const observing = new AsyncLocalStorage();
let activeScopes = 0;
let activeReceivers = 0;
let installedRegistry;

function plainData(value, ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || ancestors.has(value))
    throw new TypeError('Receiver DTS frames must contain finite JSON data.');
  const prototype = Object.getPrototypeOf(value);
  if (
    Array.isArray(value)
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  )
    throw new TypeError('Receiver DTS frames must contain plain data.');
  ancestors.add(value);
  const properties = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(properties)) {
    const descriptor = properties[key];
    if (
      typeof key !== 'string' ||
      !('value' in descriptor) ||
      (!descriptor.enumerable && !(Array.isArray(value) && key === 'length'))
    )
      throw new TypeError(
        'Receiver DTS frames must not contain accessors or hidden properties.',
      );
    if (key !== 'length' || !Array.isArray(value))
      plainData(descriptor.value, ancestors);
  }
  if (
    Array.isArray(value) &&
    (Reflect.ownKeys(properties).length !== value.length + 1 ||
      Array.from({ length: value.length }, (_, i) => String(i)).some(
        key => !Object.hasOwn(properties, key),
      ))
  )
    throw new TypeError('Receiver DTS frames must contain dense arrays.');
  ancestors.delete(value);
}

function validateSeed(seed) {
  plainData(seed);
  if (
    !seed ||
    seed.schemaVersion !== 1 ||
    !['registrationId', 'operationId', 'compilerId', 'revision'].every(
      key => typeof seed[key] === 'string' && seed[key].length,
    ) ||
    !Number.isSafeInteger(seed.generation) ||
    seed.generation < 1
  )
    throw new TypeError('Receiver DTS registration seed is invalid.');
  return seed;
}

/** Native optional undefined properties retain defaults; wire evidence omits
 * only those own object keys, without invoking getters or toJSON methods. */
function receiverDetails(value, ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value))
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value))
    throw new TypeError(
      'Receiver DTS options must contain finite acyclic data.',
    );
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    array
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  )
    throw new TypeError('Receiver DTS options must contain plain data.');
  const properties = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(properties)) {
    const descriptor = properties[key];
    if (
      typeof key !== 'string' ||
      !('value' in descriptor) ||
      (!descriptor.enumerable && !(array && key === 'length'))
    )
      throw new TypeError(
        'Receiver DTS options must not contain accessors, symbols or hidden properties.',
      );
  }
  ancestors.add(value);
  let output;
  if (array) {
    const length = properties.length.value;
    if (
      Reflect.ownKeys(properties).length !== length + 1 ||
      Array.from({ length }, (_, i) => String(i)).some(
        key => !Object.hasOwn(properties, key),
      )
    )
      throw new TypeError('Receiver DTS option arrays must be dense.');
    output = Array.from({ length }, (_, i) =>
      receiverDetails(properties[String(i)].value, ancestors),
    );
  } else {
    output = {};
    for (const key of Object.keys(properties)) {
      if (properties[key].value === undefined) continue;
      Object.defineProperty(output, key, {
        value: receiverDetails(properties[key].value, ancestors),
        enumerable: true,
      });
    }
  }
  ancestors.delete(value);
  return output;
}

function configureReceiverRegistration(options, seed) {
  validateSeed(seed);
  return {
    ...options,
    extraOptions: {
      ...options.extraOptions,
      [EXTRA_OPTIONS_KEY]: JSON.parse(JSON.stringify(seed)),
    },
  };
}

/** Native plugins mutate option containers while applying. Keep those mutations
 * local to one compiler without serializing away native callback identities. */
function cloneNativeOptionContainers(value, copies = new Map()) {
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype &&
    prototype !== null &&
    prototype !== Array.prototype
  )
    return value;
  if (copies.has(value)) return copies.get(value);
  const copy = Array.isArray(value)
    ? new Array(value.length)
    : Object.create(prototype);
  copies.set(value, copy);
  const properties = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(properties)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = properties[key];
    Object.defineProperty(
      copy,
      key,
      'value' in descriptor
        ? {
            value: cloneNativeOptionContainers(descriptor.value, copies),
            enumerable: descriptor.enumerable,
            configurable: true,
            writable: true,
          }
        : descriptor,
    );
  }
  return copy;
}

/** The chain supplies its actual native constructor. Each application receives
 * a fresh instance and options; native shutdown continues to own its resources. */
function createIsolatedReactFederationPlugin(NativeConstructor) {
  if (typeof NativeConstructor !== 'function')
    throw new TypeError('Native MF plugin must be a constructor.');
  const states = new WeakMap();
  return class IsolatedReactFederationPlugin {
    constructor(...args) {
      const nativeArguments = cloneNativeOptionContainers(args);
      const initial = Reflect.construct(
        NativeConstructor,
        cloneNativeOptionContainers(nativeArguments),
      );
      if (typeof initial.apply !== 'function')
        throw new TypeError('Native MF plugin must implement apply.');
      states.set(this, { nativeArguments, initial });
      if ('name' in initial) this.name = initial.name;
    }

    apply(compiler) {
      const state = states.get(this);
      if (!state)
        throw new TypeError('Native MF plugin application has no owner.');
      const native =
        state.initial ??
        Reflect.construct(
          NativeConstructor,
          cloneNativeOptionContainers(state.nativeArguments),
        );
      state.initial = undefined;
      return Reflect.apply(native.apply, native, [compiler]);
    }
  };
}

function installReceiverRegistry(registry) {
  if (!registry || typeof registry.begin !== 'function')
    throw new TypeError('Receiver DTS registry must implement begin.');
  if (installedRegistry || activeReceivers)
    throw new Error('Receiver DTS registry is already installed or active.');
  installedRegistry = registry;
  let restored = false;
  return () => {
    if (restored) return;
    if (activeReceivers)
      throw new Error('Receiver DTS registry still has active operations.');
    if (installedRegistry !== registry)
      throw new Error('Receiver DTS registry changed before restoration.');
    installedRegistry = undefined;
    restored = true;
  };
}

function rawCall(name, ...args) {
  const fn = original.get(`fs:${name}`)?.fn || fs[name];
  return observing.run(true, () => fn.apply(fs, args));
}

function failure(scope, operation, error, filename) {
  const record = {
    operation,
    reason: error instanceof Error ? error.message : String(error),
  };
  if (error && typeof error.code === 'string') record.code = error.code;
  if (filename) record.path = filename;
  scope.failures.push(record);
}

function filename(value) {
  if (typeof value !== 'string' || !value || value.includes('\0'))
    throw new TypeError('Receiver DTS native paths must be nonempty strings.');
  return path.resolve(value);
}

function statMetadata(stat) {
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    mode: Number(stat.mode),
    uid: Number(stat.uid),
    gid: Number(stat.gid),
    size: Number(stat.size),
    nlink: Number(stat.nlink),
    blocks: Number(stat.blocks),
    birthtimeNs: String(stat.birthtimeNs),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  };
}

function missing(error) {
  return error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function identity(stat) {
  return `${stat.dev}:${stat.ino}`;
}

/** Never follow an output symlink, including during recursive deletion. */
function pathState(scope, lexical) {
  const parents = [];
  let current = lexical;
  const tail = [];
  let canonical;
  while (true) {
    try {
      const stat = rawCall('lstatSync', current, { bigint: true });
      if (stat.isSymbolicLink())
        throw new Error(`Receiver DTS output traverses a symlink: ${current}`);
      if (!canonical)
        canonical = path.join(
          rawCall('realpathSync', current),
          ...tail.reverse(),
        );
      if (stat.isDirectory()) {
        const entry = {
          lexical: current,
          canonical: rawCall('realpathSync', current),
          identity: identity(stat),
        };
        const expected = scope.ancestors.get(current);
        if (
          expected &&
          (expected.identity !== entry.identity ||
            expected.canonical !== entry.canonical)
        )
          throw new Error(`Receiver DTS output ancestor changed: ${current}`);
        parents.push(entry);
      }
    } catch (error) {
      if (!missing(error)) throw error;
      if (!canonical) tail.push(path.basename(current));
    }
    if (current === scope.context || path.dirname(current) === current) break;
    current = path.dirname(current);
  }
  if (!canonical)
    throw new Error(`Receiver DTS output has no physical ancestor: ${lexical}`);
  return { path: { lexical, canonical }, parents };
}

function readNode(scope, lexical) {
  const state = pathState(scope, lexical);
  let stat;
  try {
    stat = rawCall('lstatSync', lexical, { bigint: true });
  } catch (error) {
    if (!missing(error)) throw error;
    return {
      node: { path: state.path, kind: 'missing' },
      parents: state.parents,
    };
  }
  if (stat.isFile()) {
    const fd = rawCall(
      'openSync',
      lexical,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const before = rawCall('fstatSync', fd, { bigint: true });
      if (!before.isFile() || identity(before) !== identity(stat))
        throw new Error(`Receiver DTS file changed before reading: ${lexical}`);
      const byteDigest = createHash('sha256')
        .update(rawCall('readFileSync', fd))
        .digest('hex');
      const after = rawCall('fstatSync', fd, { bigint: true });
      const named = rawCall('lstatSync', lexical, { bigint: true });
      if (
        identity(before) !== identity(named) ||
        before.ctimeNs !== after.ctimeNs ||
        before.size !== after.size ||
        before.mode !== after.mode ||
        after.ctimeNs !== named.ctimeNs
      )
        throw new Error(`Receiver DTS file changed while reading: ${lexical}`);
      return {
        node: {
          path: state.path,
          kind: 'file',
          byteDigest,
          metadata: statMetadata(after),
        },
        parents: state.parents,
      };
    } finally {
      rawCall('closeSync', fd);
    }
  }
  if (!stat.isDirectory())
    throw new Error(
      `Receiver DTS output is not a regular file or directory: ${lexical}`,
    );
  const entries = rawCall('readdirSync', lexical)
    .sort()
    .map(name => {
      const child = rawCall('lstatSync', path.join(lexical, name), {
        bigint: true,
      });
      const kind = child.isFile()
        ? 'file'
        : child.isDirectory()
          ? 'directory'
          : child.isSymbolicLink()
            ? 'symlink'
            : undefined;
      if (!kind)
        throw new Error(
          `Receiver DTS directory has an unsupported child: ${lexical}`,
        );
      return { name, kind };
    });
  const after = rawCall('lstatSync', lexical, { bigint: true });
  if (
    identity(stat) !== identity(after) ||
    stat.ctimeNs !== after.ctimeNs ||
    stat.mtimeNs !== after.mtimeNs
  )
    throw new Error(`Receiver DTS directory changed while reading: ${lexical}`);
  return {
    node: {
      path: state.path,
      kind: 'directory',
      entries,
      metadata: statMetadata(after),
    },
    parents: state.parents,
  };
}

function remember(scope, state) {
  for (const parent of state.parents)
    scope.ancestors.set(parent.lexical, parent);
}

function checkParents(parents) {
  for (const parent of parents) {
    const stat = rawCall('lstatSync', parent.lexical, { bigint: true });
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      identity(stat) !== parent.identity ||
      rawCall('realpathSync', parent.lexical) !== parent.canonical
    )
      throw new Error(
        `Receiver DTS output ancestor changed before native IO: ${parent.lexical}`,
      );
  }
}

function synchronous(callback, value) {
  const result = observing.run(true, () => callback(value));
  if (result && typeof result.then === 'function')
    throw new Error(
      'Receiver DTS prewrite and acknowledgement callbacks must be synchronous.',
    );
}

function assertAuthoredTarget(scope, node) {
  const policy = scope.callbacks.sourceNamespaces;
  if (!policy || node.kind === 'missing') return;
  plainData(policy);
  const names = [node.path.lexical, node.path.canonical];
  const within = (name, root) => {
    const relative = path.relative(root, name);
    return (
      relative === '' ||
      (relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  };
  const belongs =
    policy.entries.some(entry =>
      names.some(name =>
        [entry.lexical, entry.canonical].some(
          root => path.relative(root, name) === '',
        ),
      ),
    ) ||
    policy.dirs.some(directory =>
      names.some(name =>
        [directory.lexical, directory.canonical].some(root =>
          within(name, root),
        ),
      ),
    );
  if (!belongs) return;
  const samePath = prior =>
    path.relative(prior.path.lexical, node.path.lexical) === '' &&
    path.relative(prior.path.canonical, node.path.canonical) === '';
  const preceding = scope.operations.findLast(operation =>
    samePath(operation.after),
  )?.after;
  plainData(scope.callbacks.inheritedNodes ?? []);
  const inherited = scope.callbacks.inheritedNodes?.find(samePath);
  if (JSON.stringify(preceding ?? inherited) !== JSON.stringify(node))
    throw new Error(
      `Receiver DTS native IO targets an unacknowledged authored source: ${node.path.lexical}`,
    );
}

function plan(scope, operations) {
  for (const operation of operations) {
    // Existing parent metadata effects are validated against their exact
    // children; they do not make unchanged authored siblings write targets.
    if (!operation.cause) assertAuthoredTarget(scope, operation.before);
    scope.paths.add(operation.before.path.lexical);
  }
  synchronous(scope.callbacks.beforeOperations, operations);
}

function acknowledge(scope, operations) {
  scope.operations.push(...operations);
  synchronous(scope.callbacks.acknowledgeOperations, operations);
}

function parentEffect(scope, target, operation) {
  const parent = path.dirname(target);
  if (parent === target) return undefined;
  const state = readNode(scope, parent);
  if (state.node.kind !== 'directory') return undefined;
  remember(scope, state);
  return {
    operation: {
      operation: 'write',
      kind: 'directory',
      before: state.node,
      cause: {
        operation,
        paths: [pathState(scope, target).path],
      },
    },
    parents: state.parents,
  };
}

function parentAcknowledgement(scope, effect) {
  if (!effect) return [];
  const after = readNode(scope, effect.operation.before.path.lexical);
  if (after.node.kind !== 'directory')
    throw new Error(
      'Receiver DTS native IO replaced its surviving parent directory.',
    );
  remember(scope, after);
  return [{ ...effect.operation, after: after.node }];
}

function checkEffect(scope, effect) {
  if (!effect) return;
  checkParents(effect.parents);
  if (
    JSON.stringify(
      readNode(scope, effect.operation.before.path.lexical).node,
    ) !== JSON.stringify(effect.operation.before)
  )
    throw new Error(
      'Receiver DTS causal parent effect changed before native IO.',
    );
}

function writeOperation(scope, name, target, kind, call) {
  let before;
  try {
    before = readNode(scope, target);
    if (before.node.kind !== 'missing' && before.node.kind !== kind)
      throw new Error(
        `Receiver DTS native ${name} targets the wrong node kind: ${target}`,
      );
    remember(scope, before);
    const operation = { operation: 'write', kind, before: before.node };
    const effect =
      before.node.kind === 'missing'
        ? parentEffect(scope, target, name)
        : undefined;
    plan(scope, [operation, ...(effect ? [effect.operation] : [])]);
    checkParents(before.parents);
    checkEffect(scope, effect);
    if (
      JSON.stringify(readNode(scope, target).node) !==
      JSON.stringify(before.node)
    )
      throw new Error(
        `Receiver DTS output changed before native ${name}: ${target}`,
      );
    assertAuthoredTarget(scope, before.node);
    let result;
    try {
      result = call();
    } catch (error) {
      const after = readNode(scope, target);
      if (JSON.stringify(after.node) !== JSON.stringify(before.node))
        acknowledge(scope, [
          { ...operation, after: after.node },
          ...parentAcknowledgement(scope, effect),
        ]);
      throw error;
    }
    const after = readNode(scope, target);
    if (after.node.kind !== kind)
      throw new Error(
        `Receiver DTS native ${name} did not produce its expected node: ${target}`,
      );
    remember(scope, after);
    acknowledge(scope, [
      { ...operation, after: after.node },
      ...parentAcknowledgement(scope, effect),
    ]);
    return result;
  } catch (error) {
    failure(scope, name, error, target);
    throw error;
  }
}

function deletionIntent(scope, target) {
  const state = readNode(scope, target);
  if (state.node.kind === 'missing') return [];
  remember(scope, state);
  const intent = [];
  if (state.node.kind === 'directory') {
    for (const entry of state.node.entries) {
      if (entry.kind === 'symlink')
        throw new Error(
          `Receiver DTS removal contains a symlink: ${path.join(target, entry.name)}`,
        );
      intent.push(...deletionIntent(scope, path.join(target, entry.name)));
    }
  }
  intent.push({
    operation: {
      operation: 'delete',
      kind: state.node.kind,
      before: state.node,
    },
    parents: state.parents,
  });
  return intent;
}

async function removeOperation(scope, target, options, call) {
  let intent = [];
  try {
    if (
      !options ||
      options.recursive !== true ||
      options.force !== true ||
      Object.keys(options).some(key => key !== 'recursive' && key !== 'force')
    )
      throw new Error(
        'Receiver DTS only observes its audited recursive forced removal.',
      );
    intent = deletionIntent(scope, target);
    const effect = intent.length
      ? parentEffect(scope, target, 'rm')
      : undefined;
    if (intent.length)
      plan(scope, [
        ...intent.map(entry => entry.operation),
        ...(effect ? [effect.operation] : []),
      ]);
    for (const entry of intent) {
      checkParents(entry.parents);
      if (
        JSON.stringify(
          readNode(scope, entry.operation.before.path.lexical).node,
        ) !== JSON.stringify(entry.operation.before)
      )
        throw new Error(
          'Receiver DTS removal intent changed before native IO.',
        );
    }
    checkEffect(scope, effect);
    for (const entry of intent)
      assertAuthoredTarget(scope, entry.operation.before);
    // Native rm owns its internal leaf operations; this scope credits its exact
    // prevalidated intent and checks every node, rather than inventing unlink calls.
    await observing.run(true, call);
    for (const key of scope.ancestors.keys())
      if (key === target || key.startsWith(`${target}${path.sep}`))
        scope.ancestors.delete(key);
    const acknowledgements = intent.map(entry => {
      const after = readNode(scope, entry.operation.before.path.lexical);
      if (after.node.kind !== 'missing')
        throw new Error(
          'Receiver DTS native removal did not remove its entire intent.',
        );
      remember(scope, after);
      return { ...entry.operation, after: after.node };
    });
    if (acknowledgements.length)
      acknowledge(scope, [
        ...acknowledgements,
        ...parentAcknowledgement(scope, effect),
      ]);
  } catch (error) {
    failure(scope, 'rm', error, target);
    throw error;
  }
}

function installWrapper(object, namespace, name, handler) {
  if (typeof object[name] !== 'function') return;
  const fn = object[name];
  const wrapper = function (...args) {
    const scope = scopes.getStore();
    if (!scope || observing.getStore()) return fn.apply(this, args);
    try {
      return handler(scope, args, () => fn.apply(this, args));
    } catch (error) {
      failure(scope, name, error);
      throw error;
    }
  };
  original.set(`${namespace}:${name}`, { object, name, fn, wrapper });
  object[name] = wrapper;
}

function installWrappers() {
  if (activeScopes++) return;
  const unsupported = name => scope => {
    const error = new Error(
      `Receiver DTS invoked unsupported native IO: ${name}`,
    );
    failure(scope, name, error);
    throw error;
  };
  const unsupportedNames = [
    'appendFile',
    'appendFileSync',
    'copyFile',
    'copyFileSync',
    'cp',
    'cpSync',
    'link',
    'linkSync',
    'symlink',
    'symlinkSync',
    'rename',
    'renameSync',
    'truncate',
    'truncateSync',
    'ftruncate',
    'ftruncateSync',
    'chown',
    'chownSync',
    'fchown',
    'fchownSync',
    'lchown',
    'lchownSync',
    'lchmod',
    'lchmodSync',
    'chmod',
    'fchmod',
    'fchmodSync',
    'utimes',
    'futimes',
    'futimesSync',
    'lutimes',
    'lutimesSync',
    'unlink',
    'unlinkSync',
    'rmdir',
    'rmdirSync',
    'rm',
    'rmSync',
    'mkdir',
    'mkdtemp',
    'mkdtempSync',
    'write',
    'writev',
    'writevSync',
    'writeFile',
    'createWriteStream',
  ];
  for (const name of unsupportedNames)
    installWrapper(fs, 'fs', name, unsupported(name));
  for (const name of [
    'appendFile',
    'copyFile',
    'cp',
    'link',
    'symlink',
    'rename',
    'truncate',
    'chown',
    'lchown',
    'chmod',
    'utimes',
    'lutimes',
    'unlink',
    'rmdir',
    'mkdir',
    'mkdtemp',
    'writeFile',
    'open',
  ])
    installWrapper(
      fsPromises,
      'promises',
      name,
      unsupported(`promises.${name}`),
    );
  installWrapper(fs, 'fs', 'mkdirSync', (scope, args, call) => {
    if (args[1] && typeof args[1] === 'object' && args[1].recursive)
      return unsupported('recursive mkdirSync')(scope);
    return writeOperation(
      scope,
      'mkdirSync',
      filename(args[0]),
      'directory',
      call,
    );
  });
  for (const name of ['writeFileSync', 'chmodSync', 'utimesSync'])
    installWrapper(fs, 'fs', name, (scope, args, call) => {
      const target = filename(args[0]);
      const kind =
        name === 'writeFileSync' ? 'file' : readNode(scope, target).node.kind;
      if (kind !== 'file' && kind !== 'directory')
        return unsupported(`${name} on a missing node`)(scope);
      return writeOperation(scope, name, target, kind, call);
    });
  installWrapper(fs, 'fs', 'openSync', (scope, args, call) => {
    const flags = args[1];
    const writes =
      typeof flags === 'number'
        ? Boolean(
            flags &
              (fs.constants.O_WRONLY |
                fs.constants.O_RDWR |
                fs.constants.O_CREAT |
                fs.constants.O_TRUNC |
                fs.constants.O_APPEND),
          )
        : typeof flags === 'string' && /[wa+]/u.test(flags);
    if (!writes) return call();
    if (flags !== 'w') return unsupported('openSync flags')(scope);
    const target = filename(args[0]);
    return writeOperation(scope, 'openSync', target, 'file', () => {
      const fd = call();
      descriptors.set(fd, {
        scope,
        target,
        identity: identity(rawCall('fstatSync', fd, { bigint: true })),
      });
      return fd;
    });
  });
  installWrapper(fs, 'fs', 'writeSync', (scope, args, call) => {
    const descriptor = descriptors.get(args[0]);
    if (
      !descriptor ||
      descriptor.scope !== scope ||
      identity(rawCall('fstatSync', args[0], { bigint: true })) !==
        descriptor.identity ||
      identity(rawCall('lstatSync', descriptor.target, { bigint: true })) !==
        descriptor.identity
    )
      return unsupported('writeSync on an unregistered or replaced descriptor')(
        scope,
      );
    return writeOperation(scope, 'writeSync', descriptor.target, 'file', call);
  });
  installWrapper(fs, 'fs', 'closeSync', (scope, args, call) => {
    const descriptor = descriptors.get(args[0]);
    if (descriptor && descriptor.scope !== scope)
      return unsupported('closeSync across receiver scopes')(scope);
    const result = call();
    descriptors.delete(args[0]);
    return result;
  });
  installWrapper(fsPromises, 'promises', 'rm', (scope, args, call) =>
    removeOperation(scope, filename(args[0]), args[1], call),
  );
  syncBuiltinESMExports();
}

function restoreWrappers() {
  const remaining = --activeScopes;
  const changed = [];
  for (const { object, name, fn, wrapper } of original.values()) {
    if (object[name] === wrapper) {
      if (!remaining) object[name] = fn;
    } else changed.push(name);
  }
  if (!remaining) {
    original.clear();
    syncBuiltinESMExports();
  }
  if (changed.length)
    throw new Error(
      `Receiver DTS filesystem observers changed while active: ${changed.join(', ')}`,
    );
}

function alias(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.isAbsolute(value) ||
    value.split('/').some(part => !part || part === '.' || part === '..')
  )
    throw new Error('Receiver DTS native remote alias is unsupported.');
  return value;
}

// Require the public native constructor through this artifact's own package.
let DTSManager;
let retrieveHostConfig;
installWrappers();
try {
  ({ DTSManager, retrieveHostConfig } = ownRequire(
    '@module-federation/dts-plugin/core',
  ));
} finally {
  restoreWrappers();
}

const nativeCorePath = ownRequire.resolve('@module-federation/dts-plugin/core');
const NativeAdmZip = createRequire(nativeCorePath)('adm-zip');
let nativePackageDirectory = path.dirname(nativeCorePath);
let nativePackageManifest;
while (true) {
  try {
    const manifest = JSON.parse(
      rawCall(
        'readFileSync',
        path.join(nativePackageDirectory, 'package.json'),
        'utf8',
      ),
    );
    if (manifest.name !== undefined || manifest.version !== undefined) {
      if (
        typeof manifest.name !== 'string' ||
        !manifest.name ||
        typeof manifest.version !== 'string' ||
        !manifest.version
      )
        throw new Error(
          'Receiver DTS actual package manifest has an invalid name or version.',
        );
      nativePackageManifest = manifest;
      break;
    }
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const parent = path.dirname(nativePackageDirectory);
  if (parent === nativePackageDirectory)
    throw new Error('Receiver DTS public core has no owning package manifest.');
  nativePackageDirectory = parent;
}
const loadedNativeModules = [];
const visitedNativeModules = new Set();
function captureNativeModule(module) {
  if (
    !module ||
    visitedNativeModules.has(module.filename) ||
    !module.filename ||
    !module.filename.startsWith(`${nativePackageDirectory}${path.sep}`)
  )
    return;
  visitedNativeModules.add(module.filename);
  loadedNativeModules.push(
    Object.freeze({
      modulePath: rawCall('realpathSync', module.filename),
      moduleDigest: createHash('sha256')
        .update(rawCall('readFileSync', module.filename))
        .digest('hex'),
    }),
  );
  for (const child of module.children) captureNativeModule(child);
}
captureNativeModule(ownRequire.cache[nativeCorePath]);
loadedNativeModules.push(
  Object.freeze({
    modulePath: rawCall(
      'realpathSync',
      path.join(nativePackageDirectory, 'package.json'),
    ),
    moduleDigest: createHash('sha256')
      .update(
        rawCall(
          'readFileSync',
          path.join(nativePackageDirectory, 'package.json'),
        ),
      )
      .digest('hex'),
  }),
);
const nativeOwner = Object.freeze({
  packageName: nativePackageManifest.name,
  version: nativePackageManifest.version,
  packageDirectory: rawCall('realpathSync', nativePackageDirectory),
  modulePath: rawCall('realpathSync', nativeCorePath),
  moduleDigest: createHash('sha256')
    .update(rawCall('readFileSync', nativeCorePath))
    .digest('hex'),
});

function nativeDtsOwner() {
  for (const module of loadedNativeModules) {
    if (
      createHash('sha256')
        .update(rawCall('readFileSync', module.modulePath))
        .digest('hex') !== module.moduleDigest
    )
      throw new Error(
        `Receiver DTS loaded native module changed: ${module.modulePath}`,
      );
  }
  return nativeOwner;
}

function nativeDtsModules() {
  nativeDtsOwner();
  return Object.freeze([...loadedNativeModules]);
}

function observeReceiverNodes(registration, expectedNodes) {
  plainData(expectedNodes);
  const scope = {
    context: path.resolve(registration.consumer.projectRoot),
    ancestors: new Map(),
  };
  const nodes = expectedNodes.map(expected => {
    const node = readNode(scope, filename(expected.path.lexical)).node;
    if (node.path.canonical !== expected.path.canonical)
      throw new Error(
        `Receiver DTS output physical path changed: ${node.path.lexical}`,
      );
    return node;
  });
  return { generation: registration.generation, nodes };
}

function receiverUpdateChoice(manager, update) {
  receiverDetails(manager.options);
  if (
    update.updateMode === 'POSITIVE' &&
    update.remoteName === manager.options?.host?.moduleFederationConfig?.name
  )
    return { kind: 'producer' };
  if (!manager.options.host) return { kind: 'none' };
  const { mapRemotesToDownload } = retrieveHostConfig(manager.options.host);
  const loaded = Object.values(manager.remoteAliasMap).find(
    info => info.name === update.remoteName,
  );
  const configured = Object.values(mapRemotesToDownload).find(
    info => info.name === update.remoteName,
  );
  let kind;
  let remoteInfo;
  if (loaded) {
    kind = 'loaded';
    remoteInfo = loaded;
  } else if (configured) {
    kind = 'configured';
    remoteInfo = manager.remoteAliasMap[configured.alias] || configured;
  } else if (update.remoteInfo) {
    const cached = manager.updatedRemoteInfos[update.remoteInfo.name];
    if (cached && update.once) return { kind: 'none' };
    kind = cached ? 'cached-dynamic' : 'dynamic';
    remoteInfo = cached || {
      ...update.remoteInfo,
      alias: update.remoteInfo.alias || update.remoteInfo.name,
    };
  } else return { kind: 'none' };
  const selected = receiverDetails(remoteInfo);
  return { kind, remoteAlias: alias(selected.alias), remoteInfo: selected };
}

class NativeReceiverDTSManager extends DTSManager {
  prepareTypeFile(filePath, content) {
    const scope = scopes.getStore();
    if (!scope)
      throw new Error(
        'Receiver DTS materialization has no registered operation scope.',
      );
    const target = filename(filePath);
    const before = readNode(scope, target);
    if (before.node.kind !== 'file') return 'write';
    const bytes = typeof content === 'string' ? Buffer.from(content) : content;
    if (!Buffer.isBuffer(bytes))
      throw new TypeError(
        'Receiver DTS file materialization requires complete bytes.',
      );
    if (
      before.node.byteDigest !==
      createHash('sha256').update(bytes).digest('hex')
    )
      return 'write';
    checkParents(before.parents);
    if (
      JSON.stringify(readNode(scope, target).node) !==
      JSON.stringify(before.node)
    )
      throw new Error(
        'Receiver DTS unchanged file changed during materialization.',
      );
    return 'unchanged';
  }

  prepareTypesArchive(hostOptions, remoteInfo, destinationPath, archiveBuffer) {
    const scope = scopes.getStore();
    if (!scope)
      throw new Error(
        'Receiver DTS archive materialization has no registered operation scope.',
      );
    const remoteAlias = alias(remoteInfo.alias);
    const target = filename(destinationPath);
    if (
      target !==
      path.resolve(hostOptions.context, hostOptions.typesFolder, remoteAlias)
    )
      throw new Error(
        'Receiver DTS archive materialization changed its destination.',
      );
    if (!Buffer.isBuffer(archiveBuffer))
      throw new TypeError(
        'Receiver DTS archive materialization requires authentic bytes.',
      );
    const expected = new Map([['', { kind: 'directory' }]]);
    const entryPaths = new Set();
    const archive = new NativeAdmZip(archiveBuffer);
    for (const entry of archive.getEntries()) {
      const name = entry.entryName;
      if (
        typeof name !== 'string' ||
        !name ||
        name.includes('\\') ||
        name.includes('\0') ||
        path.isAbsolute(name)
      )
        throw new Error(
          'Receiver DTS archive contains an unsupported entry path.',
        );
      const parts = name.split('/');
      if (entry.isDirectory && parts.at(-1) === '') parts.pop();
      if (
        !parts.length ||
        parts.some(part => !part || part === '.' || part === '..')
      )
        throw new Error(
          'Receiver DTS archive contains an unsupported entry path.',
        );
      const relative = parts.join('/');
      if (entryPaths.has(relative))
        throw new Error('Receiver DTS archive contains duplicate entry paths.');
      entryPaths.add(relative);
      const kind = entry.isDirectory ? 'directory' : 'file';
      const value =
        kind === 'file'
          ? {
              kind,
              byteDigest: createHash('sha256')
                .update(entry.getData())
                .digest('hex'),
            }
          : { kind };
      const prior = expected.get(relative);
      if (prior && (prior.kind !== 'directory' || kind !== 'directory'))
        throw new Error(
          'Receiver DTS archive contains conflicting entry paths.',
        );
      expected.set(relative, value);
      for (let length = 1; length < parts.length; length++) {
        const parent = parts.slice(0, length).join('/');
        const priorParent = expected.get(parent);
        if (priorParent && priorParent.kind !== 'directory')
          throw new Error(
            'Receiver DTS archive contains conflicting ancestor paths.',
          );
        expected.set(parent, { kind: 'directory' });
      }
    }
    const intent = deletionIntent(scope, target);
    if (!intent.length) return 'write';
    const actual = new Map();
    for (const item of intent) {
      const relative = path
        .relative(target, item.operation.before.path.lexical)
        .split(path.sep)
        .join('/');
      // Native API consumption owns this separate complete-content write after
      // the archive. It is never granted archive output permission.
      if (
        relative === 'apis.d.ts' &&
        hostOptions.consumeAPITypes &&
        remoteInfo.apiTypeUrl &&
        !expected.has(relative)
      ) {
        if (item.operation.before.kind !== 'file') return 'write';
        continue;
      }
      actual.set(relative, item.operation.before);
    }
    if (actual.size !== expected.size) return 'write';
    for (const [relative, value] of expected) {
      const node = actual.get(relative);
      if (
        !node ||
        node.kind !== value.kind ||
        (node.kind === 'file' && node.byteDigest !== value.byteDigest)
      )
        return 'write';
    }
    for (const item of intent) {
      checkParents(item.parents);
      if (
        JSON.stringify(
          readNode(scope, item.operation.before.path.lexical).node,
        ) !== JSON.stringify(item.operation.before)
      )
        throw new Error(
          'Receiver DTS unchanged archive target changed during materialization.',
        );
    }
    return 'unchanged';
  }

  async receiverOperation(operation, details, invoke) {
    nativeDtsOwner();
    const seed = validateSeed(this.options.extraOptions?.[EXTRA_OPTIONS_KEY]);
    const localRegistry = installedRegistry;
    const registry =
      localRegistry ||
      (seed.receiverBridge &&
        ownRequire('./react-mf-dts-registry.js').createReceiverBridgeRegistry(
          seed.receiverBridge,
        ));
    if (!registry)
      throw new Error(
        'Receiver DTS has no registered host policy or worker bridge.',
      );
    activeReceivers++;
    try {
      const beginDetails = receiverDetails({
        operation,
        receiverProcessId: process.pid,
        nativeOptions: this.options,
        ...(typeof details === 'function' ? details() : details),
      });
      const callbacks = await registry.begin(seed, beginDetails);
      plainData(callbacks.frame);
      if (
        !callbacks.frame ||
        !['beforeOperations', 'acknowledgeOperations', 'terminal'].every(
          key => typeof callbacks[key] === 'function',
        )
      )
        throw new Error(
          'Receiver DTS registry returned an incomplete operation frame.',
        );
      const scope = {
        callbacks,
        context: path.resolve(
          beginDetails.nativeOptions.host?.context || process.cwd(),
        ),
        ancestors: new Map(),
        paths: new Set(),
        operations: [],
        stages: [],
        failures: [],
      };
      let result;
      let released = false;
      installWrappers();
      try {
        try {
          result = await scopes.run(scope, () => {
            if (
              JSON.stringify(receiverDetails(this.options)) !==
              JSON.stringify(beginDetails.nativeOptions)
            )
              throw new Error(
                'Receiver DTS native options changed while awaiting BEGIN.',
              );
            return invoke();
          });
        } catch (error) {
          failure(scope, operation, error);
        }
        for (const [fd, descriptor] of descriptors)
          if (descriptor.scope === scope) {
            failure(
              scope,
              'closeSync',
              new Error(
                'Receiver DTS native operation left a descriptor open.',
              ),
              descriptor.target,
            );
            try {
              rawCall('closeSync', fd);
            } catch (error) {
              failure(scope, 'closeSync', error, descriptor.target);
            } finally {
              descriptors.delete(fd);
            }
          }
        let nodes = [];
        try {
          checkParents([...scope.ancestors.values()]);
          nodes = [...scope.paths]
            .sort()
            .map(target => readNode(scope, target).node);
        } catch (error) {
          failure(scope, 'finalNodes', error);
        }
        try {
          restoreWrappers();
        } catch (error) {
          failure(scope, 'restoreWrappers', error);
        } finally {
          released = true;
        }
        const failures = Object.freeze(
          scope.failures.map(item => Object.freeze({ ...item })),
        );
        const evidence = {
          status: failures.length ? 'failed' : 'complete',
          frame: callbacks.frame,
          operations: scope.operations,
          nodes,
          stages: scope.stages,
          failures,
        };
        let terminalRejected = false;
        let terminalError;
        try {
          await callbacks.terminal(evidence);
        } catch (error) {
          terminalRejected = true;
          terminalError = error;
        }
        if (failures.length) {
          const bounded = value =>
            value.length > 512 ? `${value.slice(0, 512)}…` : value;
          const details = failures.slice(0, 8).map(item => {
            const fields = [`operation=${bounded(item.operation)}`];
            if (item.code) fields.push(`code=${bounded(item.code)}`);
            if (item.path)
              fields.push(`path=${JSON.stringify(bounded(item.path))}`);
            return `${fields.join('; ')}: ${bounded(item.reason)}`;
          });
          if (failures.length > details.length)
            details.push(
              `${failures.length - details.length} more native failures`,
            );
          const terminalReason =
            terminalRejected && terminalError instanceof Error
              ? ` ${bounded(terminalError.message)}`
              : '';
          throw new AggregateError(
            [
              ...(terminalRejected ? [terminalError] : []),
              ...failures.map(item =>
                Object.assign(new Error(item.reason), {
                  operation: item.operation,
                  ...(item.code ? { code: item.code } : {}),
                  ...(item.path ? { path: item.path } : {}),
                }),
              ),
            ],
            `Native receiver DTS generation failed.${terminalReason}\n${details.join('\n')}`,
            terminalRejected ? { cause: terminalError } : undefined,
          );
        }
        if (terminalRejected) throw terminalError;
        return result;
      } finally {
        if (!released) restoreWrappers();
      }
    } finally {
      activeReceivers--;
      if (!localRegistry) await registry.dispose();
    }
  }

  consumeTypes() {
    return this.receiverOperation('consumeTypes', {}, () =>
      super.consumeTypes(),
    );
  }

  async updateTypes(options) {
    const update = receiverDetails(options);
    // Keep native self-generation outside receiver observation, including its
    // POSITIVE/undefined-name branch. Its TypeScript/RPC child IO is not credited.
    const initial = receiverUpdateChoice(this, update);
    if (initial.kind === 'producer' || initial.kind === 'none')
      return scopes.run(undefined, () => super.updateTypes(update));
    let selected;
    return this.receiverOperation(
      'updateTypes',
      () => {
        selected = receiverUpdateChoice(this, update);
        if (!selected.remoteAlias)
          throw new Error('Receiver DTS update choice changed before BEGIN.');
        return { update, remoteAlias: selected.remoteAlias };
      },
      () => {
        if (
          JSON.stringify(receiverUpdateChoice(this, update)) !==
          JSON.stringify(selected)
        )
          throw new Error(
            'Receiver DTS native update choice changed while awaiting BEGIN.',
          );
        return super.updateTypes(update);
      },
    );
  }

  async consumeTargetRemotes(hostOptions, remoteInfo) {
    const scope = scopes.getStore();
    if (!scope)
      throw new Error(
        'Receiver DTS archive consumption has no registered operation scope.',
      );
    // Native allSettled still owns every remote result. A frame's actual archive
    // calls run in order so a later plan cannot overtake an awaited rm batch.
    const previous = scope.archiveTail || Promise.resolve();
    let release;
    scope.archiveTail = new Promise(resolve => {
      release = resolve;
    });
    await previous;
    let remoteAlias;
    try {
      remoteAlias = alias(remoteInfo.alias);
      const value = await super.consumeTargetRemotes(hostOptions, remoteInfo);
      const expected = path.resolve(
        hostOptions.context,
        hostOptions.typesFolder,
        remoteAlias,
      );
      const valid =
        Array.isArray(value) &&
        value.length === 2 &&
        value[0] === remoteAlias &&
        value[1] === expected;
      scope.stages.push({
        stage: 'archive',
        alias: remoteAlias,
        outcome: valid ? 'complete' : 'failed',
        requested: true,
        result: valid
          ? { kind: 'tuple', alias: remoteAlias, destinationPath: expected }
          : { kind: value === undefined ? 'undefined' : 'invalid-tuple' },
      });
      if (!valid)
        failure(
          scope,
          'archive',
          new Error(
            'Native receiver DTS archive did not acknowledge a completed extraction.',
          ),
        );
      return value;
    } catch (error) {
      const stage = {
        stage: 'archive',
        outcome: 'failed',
        requested: true,
        result: { kind: 'rejected' },
      };
      if (remoteAlias) stage.alias = remoteAlias;
      scope.stages.push(stage);
      failure(scope, 'archive', error);
      throw error;
    } finally {
      release();
    }
  }

  async consumeArchiveTypes(options) {
    const scope = scopes.getStore();
    if (!scope)
      throw new Error(
        'Receiver DTS archive aggregate has no registered operation scope.',
      );
    const value = await super.consumeArchiveTypes(options);
    const settled = value.downloadPromisesResult.length;
    const completed = value.downloadPromisesResult.filter(
      result =>
        result.status === 'fulfilled' &&
        Array.isArray(result.value) &&
        result.value.length === 2,
    ).length;
    const failed = settled - completed;
    scope.stages.push({
      stage: 'archives',
      outcome: failed ? 'failed' : 'complete',
      result: { settled, completed, failed },
    });
    if (failed)
      failure(
        scope,
        'archives',
        new Error(
          'Native receiver DTS archive settlement contains a failed extraction.',
        ),
      );
    return value;
  }

  consumeAPITypes(hostOptions) {
    const scope = scopes.getStore();
    if (!scope)
      throw new Error(
        'Receiver DTS API index has no registered operation scope.',
      );
    try {
      return super.consumeAPITypes(hostOptions);
    } catch (error) {
      failure(scope, 'apiIndex', error);
      throw error;
    }
  }

  async downloadAPITypes(remoteInfo, destinationPath, hostOptions) {
    const scope = scopes.getStore();
    if (!scope)
      throw new Error(
        'Receiver DTS API consumption has no registered operation scope.',
      );
    const remoteAlias = alias(remoteInfo.alias);
    const requested = Boolean(remoteInfo.apiTypeUrl);
    try {
      const value = await super.downloadAPITypes(
        remoteInfo,
        destinationPath,
        hostOptions,
      );
      const valid = value === false || value === true;
      const outcome = !requested ? 'skipped' : valid ? 'complete' : 'failed';
      scope.stages.push({
        stage: 'api',
        alias: remoteAlias,
        requested,
        outcome,
        result: valid ? value : requested ? 'undefined' : 'not-requested',
      });
      if (requested && !valid)
        failure(
          scope,
          'api',
          new Error(
            'Native receiver DTS requested API types were not acknowledged.',
          ),
        );
      return value;
    } catch (error) {
      scope.stages.push({
        stage: 'api',
        alias: remoteAlias,
        requested,
        outcome: 'failed',
        result: 'rejected',
      });
      failure(scope, 'api', error);
      throw error;
    }
  }
}

module.exports = NativeReceiverDTSManager;
module.exports.EXTRA_OPTIONS_KEY = EXTRA_OPTIONS_KEY;
module.exports.installReceiverRegistry = installReceiverRegistry;
module.exports.configureReceiverRegistration = configureReceiverRegistration;
module.exports.createIsolatedReactFederationPlugin =
  createIsolatedReactFederationPlugin;
module.exports.observeReceiverNodes = observeReceiverNodes;
module.exports.nativeDtsOwner = nativeDtsOwner;
module.exports.nativeDtsModules = nativeDtsModules;
