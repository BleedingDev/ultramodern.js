import { AsyncLocalStorage } from 'node:async_hooks';
import childProcess from 'node:child_process';
import { tracingChannel } from 'node:diagnostics_channel';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import moduleBuiltin, {
  createRequire,
  registerHooks,
  syncBuiltinESMExports,
} from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, types as utilTypes } from 'node:util';
import workerThreads from 'node:worker_threads';
import type { EffectCompilerSelection } from '@modern-js/app-tools-extensions/internal-effect-discovery';
import type { ConfigPackageMetadataRead } from '@modern-js/plugin/cli';
import type { OwningConfigNativeBinding } from './native-bootstrap';
import {
  assertConfigSourceSymlinkTraversal,
  type ConfigSourceSnapshot,
  resolveConfigSourcePhysicalPath,
} from './source-snapshot';

export type ObservedConfigSourceOperation =
  | 'content'
  | 'module'
  | 'metadata'
  | 'existence'
  | 'entry-kind'
  | 'directory';

export interface ObservedConfigSourceInput {
  readonly path: string;
  readonly canonicalPath: string;
  readonly operation: ObservedConfigSourceOperation;
  readonly existed: boolean;
}

export interface ObservedPackageMetadataInput {
  readonly path: string;
  readonly canonicalPath: string;
  readonly field: 'name' | 'type';
  readonly value: string;
}

/** Actual supported API observations, not an arbitrary native/OS read inventory. */
export interface ObservedConfigSourceInputs {
  readonly kind: 'observed-config-source-inputs';
  readonly version: 1;
  readonly observations: readonly ObservedConfigSourceInput[];
  readonly packageMetadata: readonly ObservedPackageMetadataInput[];
}

const originalLstat = fs.lstatSync;
const requireExtensions = createRequire(
  path.join(process.cwd(), 'package.json'),
).extensions;
const mapPrototype = Map.prototype;
const mapEntries = Map.prototype.entries;
const mapIteratorNext = new Map().entries().next;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const isMap = utilTypes.isMap;
const apply = Reflect.apply;
type RuntimeFunction = (this: unknown, ...args: unknown[]) => unknown;
const supportedOperations = new AsyncLocalStorage<boolean>();
let observing = false;
let activeReplacements: Map<RuntimeFunction, RuntimeFunction> | undefined;
// Both published module formats share builtins. The marker retains no original
// functions and only reapplies this slot's policy during its native invocation.
const observationLifetime = Symbol.for(
  'ultramodern.config-observation.lifetime',
);

function hasActiveObservation(value: unknown): value is RuntimeFunction {
  if (typeof value !== 'function') return false;
  const lifetime = Object.getOwnPropertyDescriptor(
    value,
    observationLifetime,
  )?.value;
  return lifetime?.isActive() === true;
}

function inside(boundary: string, filename: string): boolean {
  const relative = path.relative(boundary, filename);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function sourcePath(snapshot: ConfigSourceSnapshot, filename: string): boolean {
  const canonical = resolveConfigSourcePhysicalPath(filename);
  if (
    !snapshot.coverage.some(
      boundary =>
        canonical === boundary.path ||
        (boundary.recursive && inside(boundary.path, canonical)),
    )
  )
    return false;
  const states = new Set(snapshot.states.map(state => state.path));
  for (let current = filename; ; current = path.dirname(current)) {
    if (snapshot.coverage.some(boundary => current === boundary.path)) break;
    if (
      snapshot.exclusions.includes(path.basename(current)) &&
      !states.has(current)
    )
      return false;
    const parent = path.dirname(current);
    if (parent === current) break;
  }
  return true;
}

function filename(value: unknown): string | undefined {
  if (typeof value === 'string')
    return path.isAbsolute(value)
      ? value
      : `${process.cwd()}${path.sep}${value}`;
  if (Buffer.isBuffer(value)) return filename(value.toString());
  if (value instanceof URL) return fileURLToPath(value);
  return undefined;
}

function missing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

/** Owns process-local wrappers only for the short-lived evaluator's authority phase. */
export async function observeConfigSourceInputs<T>(
  snapshot: ConfigSourceSnapshot,
  evaluate: (packageMetadataRead: ConfigPackageMetadataRead) => Promise<T>,
  isInstalledDependency: (filename: string) => boolean = filename =>
    filename.split(path.sep).includes('node_modules'),
  compilerSelection?: {
    selections: readonly EffectCompilerSelection[];
    install(
      validator: (selection: EffectCompilerSelection) => void,
    ): () => void;
  },
  nativeBinding?: OwningConfigNativeBinding,
): Promise<{ value: T; consumedSourceInputs: ObservedConfigSourceInputs }> {
  if (observing)
    throw new Error('Config source observation already has an owner');
  if (hasActiveObservation(fs.readFileSync))
    throw new Error('Config source observation already has an owner');
  observing = true;
  const replacements = new Map<RuntimeFunction, RuntimeFunction>();
  activeReplacements = replacements;
  const observations = new Map<string, ObservedConfigSourceInput>();
  const packageMetadata = new Map<string, ObservedPackageMetadataInput>();
  const packageDiscoveryReads = new AsyncLocalStorage<boolean>();
  const entryPathReads = new AsyncLocalStorage<boolean>();
  let metadataReadActive = true;
  const restores: Array<() => void> = [];
  let failure: Error | undefined;
  let completion: { value: T } | undefined;
  let evaluationError: unknown;
  const unsupported = (operation: string): never => {
    const error = new Error(
      `Unsupported config source observation: ${operation}. Use supported path-based filesystem reads; native/private/subprocess source reads cannot be observed safely.`,
    );
    failure ??= error;
    throw error;
  };
  function packageMetadataRead<T>(
    manifestFile: string,
    field: 'name' | 'type',
    read: () => T,
  ): T;
  function packageMetadataRead(
    manifestFile: string,
    field: 'name' | 'type',
    read: () => unknown,
  ): unknown {
    if (!metadataReadActive) return read();
    const lexical = filename(manifestFile);
    if (
      !lexical ||
      path.basename(lexical) !== 'package.json' ||
      !['name', 'type'].includes(field)
    )
      return unsupported(
        'automatic package metadata read outside package.json',
      );
    const canonicalPath = supportedOperations.run(true, () => {
      assertConfigSourceSymlinkTraversal(snapshot, lexical);
      if (!sourcePath(snapshot, lexical))
        return unsupported(
          `uncovered automatic package metadata read ${lexical}`,
        );
      return resolveConfigSourcePhysicalPath(lexical);
    });
    // Only the original native manifest reader runs in this scope. Authored
    // callbacks and subsequent imports/reads retain their full observations.
    const record = (originalValue: unknown) => {
      const value =
        field === 'type'
          ? originalValue
          : originalValue &&
              typeof originalValue === 'object' &&
              'name' in originalValue
            ? originalValue.name
            : undefined;
      if (typeof value !== 'string' || value.length === 0)
        return unsupported(
          `invalid automatic package ${field} read ${lexical}`,
        );
      const key = `${field}:${lexical}`;
      const previous = packageMetadata.get(key);
      if (
        previous &&
        (previous.canonicalPath !== canonicalPath || previous.value !== value)
      )
        return unsupported(
          `automatic package ${field} changed during load ${lexical}`,
        );
      packageMetadata.set(
        key,
        Object.freeze({ path: lexical, canonicalPath, field, value }),
      );
      return originalValue;
    };
    const originalValue = supportedOperations.run(true, read);
    return utilTypes.isPromise(originalValue)
      ? originalValue.then(record)
      : record(originalValue);
  }
  const remember = (
    input: unknown,
    operation: ObservedConfigSourceOperation,
    existed: boolean,
  ) => {
    if (!metadataReadActive || supportedOperations.getStore()) return;
    const lexical = filename(input);
    if (!lexical)
      return unsupported(
        `${operation} through an untracked file descriptor or handle`,
      );
    supportedOperations.run(true, () => {
      // The established installed dependency namespace is outside authored
      // snapshot coverage; its canonical source load is observed separately.
      if (
        lexical.split(path.sep).includes('node_modules') &&
        !lexical.split(path.sep).includes('..') &&
        isInstalledDependency(lexical)
      )
        return;
      const physical = resolveConfigSourcePhysicalPath(lexical);
      const covered = snapshot.coverage.some(
        boundary =>
          physical === boundary.path ||
          (boundary.recursive && inside(boundary.path, physical)),
      );
      if (covered) {
        try {
          assertConfigSourceSymlinkTraversal(snapshot, lexical);
        } catch (error) {
          return unsupported(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      if (!sourcePath(snapshot, lexical) && !sourcePath(snapshot, physical)) {
        if (!covered && !isInstalledDependency(physical)) {
          return unsupported(
            `uncovered source path ${lexical}; add its authored root to sourceRoots`,
          );
        }
        return;
      }
      const canonicalPath = physical;
      if (
        path.normalize(lexical) !== lexical &&
        resolveConfigSourcePhysicalPath(path.normalize(lexical)) !==
          canonicalPath
      ) {
        return unsupported(
          `filesystem path normalization crosses symlink ancestors: ${lexical}`,
        );
      }
      const key = `${lexical}\0${operation}`;
      const previous = observations.get(key);
      if (
        previous &&
        (previous.existed !== existed ||
          previous.canonicalPath !== canonicalPath)
      ) {
        failure ??= new Error(
          `Config source input changed during observation: ${lexical}`,
        );
      }
      observations.set(
        key,
        Object.freeze({ path: lexical, canonicalPath, operation, existed }),
      );
    });
  };
  // Observe Node's finite CJS search in precedence order; native nextResolve
  // still decides the result. Stop at its first current file candidate so
  // unrelated lower-priority files are not claimed as consumed inputs.
  const cjsFileCandidate = (
    requested: string,
    trailingSlash: boolean,
  ): string | undefined => {
    const extensions = Object.keys(requireExtensions);
    const probe = (candidate: string): fs.Stats | undefined => {
      supportedOperations.run(true, () => {
        const physical = resolveConfigSourcePhysicalPath(candidate);
        const lexicalCovered = snapshot.coverage.some(
          boundary =>
            candidate === boundary.path ||
            (boundary.recursive && inside(boundary.path, candidate)),
        );
        const installedCandidate =
          candidate.split(path.sep).includes('node_modules') &&
          isInstalledDependency(candidate) &&
          isInstalledDependency(physical);
        if (lexicalCovered && !installedCandidate) {
          try {
            assertConfigSourceSymlinkTraversal(snapshot, candidate);
          } catch (error) {
            unsupported(error instanceof Error ? error.message : String(error));
          }
        }
        if (
          !sourcePath(snapshot, candidate) &&
          !isInstalledDependency(physical)
        )
          unsupported(`uncovered CJS source candidate ${candidate}`);
      });
      const stat = supportedOperations.run(true, () =>
        fs.statSync(candidate, { throwIfNoEntry: false }),
      );
      remember(candidate, 'metadata', stat !== undefined);
      return stat;
    };
    const file = (candidate: string): string | undefined => {
      if (!probe(candidate)?.isFile()) return undefined;
      return supportedOperations.run(true, () =>
        resolveConfigSourcePhysicalPath(candidate),
      );
    };
    const withExtensions = (candidate: string): string | undefined => {
      for (const extension of extensions) {
        const selected = file(`${candidate}${extension}`);
        if (selected) return selected;
      }
      return undefined;
    };
    const stat = probe(requested);
    if (!trailingSlash) {
      if (stat?.isFile())
        return supportedOperations.run(true, () =>
          resolveConfigSourcePhysicalPath(requested),
        );
      const selected = withExtensions(requested);
      if (selected) return selected;
    }
    if (!stat?.isDirectory()) return undefined;
    const manifest = path.join(requested, 'package.json');
    const manifestStat = probe(manifest);
    remember(manifest, 'content', manifestStat !== undefined);
    if (manifestStat?.isFile()) {
      const source = supportedOperations.run(true, () =>
        fs.readFileSync(manifest, 'utf8'),
      );
      let metadata: unknown;
      try {
        metadata = JSON.parse(source.replace(/^\uFEFF/u, ''));
      } catch {
        // Preserve the native resolver's original malformed-manifest error.
        return undefined;
      }
      if (
        metadata &&
        typeof metadata === 'object' &&
        'main' in metadata &&
        typeof metadata.main === 'string' &&
        metadata.main
      ) {
        const main = path.resolve(requested, metadata.main);
        const selected =
          file(main) ||
          withExtensions(main) ||
          withExtensions(path.join(main, 'index'));
        if (selected) return selected;
      }
    }
    return withExtensions(path.join(requested, 'index'));
  };
  function resolutionRead<T>(
    manifestFile: string,
    operation: 'cache' | 'name' | 'type' | 'content',
    read: () => T,
  ): T {
    if (!metadataReadActive) return read();
    const lexical = filename(manifestFile);
    if (
      !lexical ||
      path.basename(lexical) !== 'package.json' ||
      !['cache', 'name', 'type', 'content'].includes(operation)
    )
      return unsupported('invalid original package resolver read');
    const installed = supportedOperations.run(true, () =>
      isInstalledDependency(lexical),
    );
    if (installed) return supportedOperations.run(true, read);
    supportedOperations.run(true, () => {
      assertConfigSourceSymlinkTraversal(snapshot, lexical);
      if (!sourcePath(snapshot, lexical))
        return unsupported(`uncovered package resolver read ${lexical}`);
    });
    const value = supportedOperations.run(true, read);
    if (
      !value ||
      typeof value !== 'object' ||
      !('exists' in value) ||
      typeof value.exists !== 'boolean' ||
      !('pjsonPath' in value) ||
      value.pjsonPath !== lexical
    )
      return unsupported(`invalid original package resolver cache ${lexical}`);
    if (!value.exists) {
      remember(lexical, 'metadata', false);
    } else if (operation === 'cache') {
      // A present parsed cache is attested by its consuming native branch.
      // Recording a file stat here would also protect its entire contents.
    } else if (
      operation === 'name' &&
      'name' in value &&
      typeof value.name === 'string' &&
      value.name.length > 0
    ) {
      packageMetadataRead(lexical, 'name', () => value);
    } else if (
      operation === 'type' &&
      'type' in value &&
      (value.type === 'commonjs' || value.type === 'module')
    ) {
      const moduleType = value.type;
      packageMetadataRead(lexical, 'type', () => moduleType);
    } else {
      // main/exports/imports and absent or invalid semantic fields retain the
      // ordinary complete manifest guard, including native cache hits.
      remember(lexical, 'content', value.exists);
    }
    return value;
  }
  Object.defineProperty(packageMetadataRead, 'resolutionRead', {
    value: resolutionRead,
  });
  Object.defineProperty(packageMetadataRead, 'packageDiscoveryRead', {
    value: <T>(read: () => T): T =>
      metadataReadActive ? packageDiscoveryReads.run(true, read) : read(),
  });
  Object.defineProperty(packageMetadataRead, 'entryPathRead', {
    value: <T>(read: () => T): T =>
      metadataReadActive ? entryPathReads.run(true, read) : read(),
  });
  const replace = (
    target: object,
    name: string,
    replacement: (original: RuntimeFunction) => RuntimeFunction,
    currentTarget: () => object = () => target,
  ) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const original: RuntimeFunction = descriptor.value;
    const nativeInvocation = new AsyncLocalStorage<boolean>();
    const observed = replacement(function (this: unknown, ...args: unknown[]) {
      return nativeInvocation.run(true, () => apply(original, this, args));
    });
    // Libraries such as graceful-fs retain copies of these functions. Their
    // lifetime may exceed this capture, but a later capture still owns policy.
    const wrapped = function (this: unknown, ...args: unknown[]) {
      let current = metadataReadActive
        ? observed
        : activeReplacements?.get(original);
      if (!current) {
        const live = Object.getOwnPropertyDescriptor(
          currentTarget(),
          name,
        )?.value;
        const lifetime =
          live !== wrapped && hasActiveObservation(live)
            ? Object.getOwnPropertyDescriptor(live, observationLifetime)?.value
            : undefined;
        // Re-entering the external wrapper would recurse. The current owner
        // must still validate and observe the retained call's actual arguments.
        if (lifetime?.isNativeInvocation())
          return lifetime.applyNativePolicy(original, this, args);
        current = lifetime ? live : original;
      }
      if (current === undefined) current = original;
      return new.target
        ? Reflect.construct(current, args, new.target)
        : apply(current, this, args);
    };
    replacements.set(original, wrapped);
    const functionDescriptors = Object.getOwnPropertyDescriptors(
      descriptor.value,
    );
    Reflect.deleteProperty(functionDescriptors, observationLifetime);
    if (target === fs && name === 'exists') {
      const custom = Object.getOwnPropertyDescriptor(
        descriptor.value,
        promisify.custom,
      );
      if (custom) {
        Reflect.set(functionDescriptors, promisify.custom, {
          ...custom,
          value: (input: fs.PathLike) =>
            new Promise<boolean>(resolve => wrapped.call(fs, input, resolve)),
        });
      }
    }
    Object.defineProperties(wrapped, functionDescriptors);
    Object.defineProperty(wrapped, observationLifetime, {
      value: Object.freeze({
        isActive: () => metadataReadActive,
        isNativeInvocation: () =>
          nativeInvocation.getStore() === true &&
          supportedOperations.getStore() === true,
        applyNativePolicy: (
          native: RuntimeFunction,
          receiver: unknown,
          args: unknown[],
        ) => {
          if (
            !metadataReadActive ||
            nativeInvocation.getStore() !== true ||
            supportedOperations.getStore() !== true
          )
            return unsupported('unrelated native observation policy');
          return supportedOperations.run(false, () =>
            apply(replacement(native), receiver, args),
          );
        },
      }),
    });
    Object.defineProperty(target, name, { ...descriptor, value: wrapped });
    restores.push(() => {
      if (Object.getOwnPropertyDescriptor(target, name)?.value !== wrapped) {
        failure ??= new Error(
          `Config source observer lost ownership of ${name}`,
        );
      }
      Object.defineProperty(target, name, descriptor);
    });
  };
  const validateArguments = (args: readonly unknown[]) => {
    const seen = new Set<object>();
    const validate = (argument: unknown, nested = false): void => {
      if (typeof argument === 'function' && nested)
        unsupported('filesystem options containing callbacks');
      if (
        argument &&
        typeof argument === 'object' &&
        utilTypes.isProxy(argument)
      )
        unsupported('filesystem options containing proxies');
      if (!argument || typeof argument !== 'object' || seen.has(argument))
        return;
      seen.add(argument);
      const prototype = Object.getPrototypeOf(argument);
      const owningCache = nativeBinding?.isRealpathCache(argument) === true;
      const builtinMap =
        isMap(argument) && (owningCache || prototype === mapPrototype);
      if (
        owningCache &&
        (!builtinMap || Reflect.ownKeys(argument).length !== 0)
      )
        unsupported('filesystem realpath cache with unexpected properties');
      if (builtinMap) {
        if (
          Object.getOwnPropertyDescriptor(prototype, 'get')?.value !== mapGet ||
          Object.getOwnPropertyDescriptor(prototype, 'set')?.value !== mapSet
        )
          unsupported('filesystem options with altered Map methods');
        const entries = apply(mapEntries, argument, []);
        for (
          let entry = apply(mapIteratorNext, entries, []);
          !entry.done;
          entry = apply(mapIteratorNext, entries, [])
        ) {
          const key = entry.value[0];
          const value = entry.value[1];
          if (
            owningCache &&
            (typeof key !== 'string' || typeof value !== 'string')
          )
            unsupported('filesystem realpath cache must contain string paths');
          validate(key, true);
          validate(value, true);
        }
      }
      const builtinPath =
        (Buffer.isBuffer(argument) && prototype === Buffer.prototype) ||
        (argument instanceof URL && prototype === URL.prototype);
      if (
        !builtinPath &&
        !builtinMap &&
        prototype !== Object.prototype &&
        prototype !== null
      ) {
        unsupported('filesystem options with a custom prototype');
      }
      for (const key of Reflect.ownKeys(argument)) {
        const descriptor = Object.getOwnPropertyDescriptor(argument, key);
        if (!descriptor) continue;
        if ('get' in descriptor || 'set' in descriptor)
          unsupported('filesystem options containing accessors');
        if (typeof descriptor.value === 'function')
          unsupported('filesystem options containing callbacks');
        if (!builtinPath) validate(descriptor.value, true);
      }
    };
    for (const argument of args) validate(argument);
  };
  const operations = {
    readFile: 'content',
    access: 'metadata',
    stat: 'metadata',
    lstat: 'metadata',
    readlink: 'metadata',
    realpath: 'metadata',
    readdir: 'directory',
    opendir: 'directory',
  } as const;
  try {
    // Node's public require trace also encloses successful cache hits, which
    // bypass module resolve/load hooks. Native automatic metadata thunks keep
    // their existing scoped evidence; authored JSON imports retain full proof.
    const requireTrace = tracingChannel('module.require');
    const requireHandlers = {
      end(context: unknown) {
        if (supportedOperations.getStore()) return;
        try {
          if (
            !context ||
            typeof context !== 'object' ||
            !Object.hasOwn(context, 'result') ||
            !('id' in context) ||
            typeof context.id !== 'string' ||
            path.extname(context.id) !== '.json'
          )
            return;
          const requested = path.isAbsolute(context.id)
            ? context.id
            : context.id.startsWith('.') &&
                'parentFilename' in context &&
                typeof context.parentFilename === 'string' &&
                path.isAbsolute(context.parentFilename)
              ? `${path.dirname(context.parentFilename)}${path.sep}${context.id}`
              : undefined;
          if (requested) remember(requested, 'module', true);
        } catch (error) {
          // Diagnostics subscribers must not throw: Node would rethrow outside
          // the authority lifecycle rather than letting cleanup run normally.
          failure ??= error instanceof Error ? error : new Error(String(error));
        }
      },
    };
    requireTrace.subscribe(requireHandlers);
    restores.push(() => requireTrace.unsubscribe(requireHandlers));
    for (const [name, operation] of Object.entries(operations)) {
      const successfulExistence = (value: unknown) =>
        name === 'stat' || name === 'lstat' ? value !== undefined : true;
      replace(
        fs,
        `${name}Sync`,
        original =>
          function (this: unknown, ...args: unknown[]) {
            if (supportedOperations.getStore())
              return original.apply(this, args);
            validateArguments(args);
            const selectedOperation =
              name === 'stat' && entryPathReads.getStore()
                ? 'entry-kind'
                : operation;
            try {
              const value = supportedOperations.run(true, () =>
                original.apply(this, args),
              );
              remember(args[0], selectedOperation, successfulExistence(value));
              return value;
            } catch (error) {
              if (missing(error)) remember(args[0], selectedOperation, false);
              throw error;
            }
          },
      );
      replace(
        fs,
        name,
        original =>
          function (this: unknown, ...args: unknown[]) {
            if (supportedOperations.getStore())
              return original.apply(this, args);
            validateArguments(args);
            const callback = args.at(-1);
            if (typeof callback !== 'function')
              return original.apply(this, args);
            const input = filename(args[0]);
            const selectedOperation =
              name === 'stat' && entryPathReads.getStore()
                ? 'entry-kind'
                : operation;
            args[args.length - 1] = (...result: unknown[]) =>
              entryPathReads.run(false, () =>
                supportedOperations.run(false, () => {
                  if (!result[0] || missing(result[0]))
                    remember(
                      input,
                      selectedOperation,
                      !result[0] && successfulExistence(result[1]),
                    );
                  return callback(...result);
                }),
              );
            return supportedOperations.run(true, () =>
              original.apply(this, args),
            );
          },
      );
      replace(
        fsPromises,
        name,
        original =>
          async function (this: unknown, ...args: unknown[]) {
            if (supportedOperations.getStore())
              return original.apply(this, args);
            validateArguments(args);
            const input = filename(args[0]);
            const selectedOperation =
              name === 'stat' && entryPathReads.getStore()
                ? 'entry-kind'
                : operation;
            try {
              const value = await supportedOperations.run(true, () =>
                original.apply(this, args),
              );
              remember(input, selectedOperation, successfulExistence(value));
              return value;
            } catch (error) {
              if (missing(error)) remember(input, selectedOperation, false);
              throw error;
            }
          },
      );
    }
    // Native realpath entry points and exists' custom promisifier are separate
    // public functions; preserve their real behavior while observing the path.
    for (const name of ['realpathSync', 'realpath'] as const) {
      replace(
        fs[name],
        'native',
        original =>
          function (this: unknown, ...args: unknown[]) {
            if (supportedOperations.getStore())
              return original.apply(this, args);
            validateArguments(args);
            if (name === 'realpathSync') {
              try {
                const result = supportedOperations.run(true, () =>
                  original.apply(this, args),
                );
                remember(args[0], 'metadata', true);
                return result;
              } catch (error) {
                if (missing(error)) remember(args[0], 'metadata', false);
                throw error;
              }
            }
            const callback = args.at(-1);
            if (typeof callback !== 'function')
              return original.apply(this, args);
            args[args.length - 1] = (...result: unknown[]) =>
              supportedOperations.run(false, () => {
                if (!result[0] || missing(result[0]))
                  remember(args[0], 'metadata', !result[0]);
                return callback(...result);
              });
            return supportedOperations.run(true, () =>
              original.apply(this, args),
            );
          },
        () => fs[name],
      );
    }
    replace(
      fs,
      'exists',
      original =>
        function (this: unknown, ...args: unknown[]) {
          if (supportedOperations.getStore()) return original.apply(this, args);
          validateArguments(args);
          const callback = args.at(-1);
          if (typeof callback !== 'function') return original.apply(this, args);
          args[args.length - 1] = (exists: boolean) =>
            supportedOperations.run(false, () => {
              remember(args[0], 'metadata', exists);
              return callback(exists);
            });
          return supportedOperations.run(true, () =>
            original.apply(this, args),
          );
        },
    );
    replace(
      fs,
      'existsSync',
      original =>
        function (this: unknown, ...args: unknown[]) {
          if (supportedOperations.getStore()) return original.apply(this, args);
          validateArguments(args);
          const value = supportedOperations.run(true, () =>
            original.apply(this, args),
          );
          const lexical = filename(args[0]);
          const operation = entryPathReads.getStore()
            ? 'entry-kind'
            : packageDiscoveryReads.getStore() &&
                lexical &&
                path.basename(lexical) === 'package.json'
              ? 'existence'
              : 'metadata';
          remember(args[0], operation, value === true);
          return value;
        },
    );
    for (const name of [
      'open',
      'openSync',
      'read',
      'readSync',
      'readv',
      'readvSync',
      'createReadStream',
      'copyFile',
      'copyFileSync',
      'cp',
      'cpSync',
      'glob',
      'globSync',
      'openAsBlob',
      'fstat',
      'fstatSync',
      'statfs',
      'statfsSync',
      'watch',
      'watchFile',
    ]) {
      replace(
        fs,
        name,
        original =>
          function (this: unknown, ...args: unknown[]) {
            if (supportedOperations.getStore())
              return original.apply(this, args);
            if (
              name.startsWith('open') &&
              typeof args[1] === 'string' &&
              !args[1].includes('r') &&
              !args[1].includes('+')
            ) {
              return original.apply(this, args);
            }
            return unsupported(`fs.${name}`);
          },
      );
    }
    for (const operation of ['copyFile', 'cp', 'glob', 'statfs', 'watch']) {
      replace(
        fsPromises,
        operation,
        () =>
          function () {
            return unsupported(`fs.promises.${operation}`);
          },
      );
    }
    replace(
      workerThreads,
      'Worker',
      () =>
        function () {
          return unsupported('worker_threads.Worker');
        },
    );
    replace(
      fsPromises,
      'open',
      original =>
        function (this: unknown, ...args: unknown[]) {
          if (supportedOperations.getStore()) return original.apply(this, args);
          return unsupported('fs.promises.open');
        },
    );
    for (const name of [
      'exec',
      'execFile',
      'execSync',
      'execFileSync',
      'spawn',
      'spawnSync',
      'fork',
    ]) {
      replace(
        childProcess,
        name,
        original =>
          function (this: unknown, ...args: unknown[]) {
            return unsupported(`child_process.${name}`);
          },
      );
    }
    replace(
      process,
      'binding',
      original =>
        function (this: unknown, ...args: unknown[]) {
          if (supportedOperations.getStore()) return original.apply(this, args);
          return unsupported(`process.binding(${String(args[0])})`);
        },
    );
    replace(
      process,
      'dlopen',
      original =>
        function (this: unknown, ...args: unknown[]) {
          if (supportedOperations.getStore()) return original.apply(this, args);
          return unsupported('process.dlopen');
        },
    );
    if (compilerSelection) {
      restores.push(
        compilerSelection.install(selection => {
          const origin = filename(selection.from);
          if (
            !origin ||
            !supportedOperations.run(true, () =>
              sourcePath(snapshot, origin),
            ) ||
            !compilerSelection.selections.some(
              allowed =>
                allowed.cliPath === selection.cliPath &&
                allowed.backendManifest === selection.backendManifest &&
                allowed.nativePlatformManifest ===
                  selection.nativePlatformManifest &&
                allowed.effectPlatformManifest ===
                  selection.effectPlatformManifest &&
                allowed.compilerPath === selection.compilerPath &&
                allowed.nativeCompilerDigest ===
                  selection.nativeCompilerDigest &&
                allowed.compilerDigest === selection.compilerDigest,
            )
          )
            return unsupported(
              'Effect selection outside the original authored origin or selected installed cohort',
            );
          try {
            supportedOperations.run(true, () =>
              assertConfigSourceSymlinkTraversal(snapshot, origin),
            );
          } catch (error) {
            return unsupported(
              error instanceof Error ? error.message : String(error),
            );
          }
        }),
      );
    }
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        const explicit =
          specifier.startsWith('.') ||
          specifier.startsWith('/') ||
          specifier.startsWith('file:');
        const nativeImport =
          context.conditions.includes('import') &&
          !context.conditions.includes('require');
        const rawRequested = !explicit
          ? undefined
          : nativeImport && context.parentURL?.startsWith('file:')
            ? fileURLToPath(new URL(specifier, context.parentURL))
            : specifier.startsWith('file:')
              ? fileURLToPath(specifier)
              : path.isAbsolute(specifier)
                ? specifier
                : context.parentURL?.startsWith('file:')
                  ? `${path.dirname(fileURLToPath(context.parentURL))}${path.sep}${specifier}`
                  : undefined;
        // CJS _findPath applies path.resolve before any filesystem candidate
        // search. ESM URL resolution and raw filesystem reads retain their
        // distinct symlink/.. semantics.
        const requested =
          rawRequested && !nativeImport
            ? path.resolve(rawRequested)
            : rawRequested;
        const trailingSlash =
          specifier.endsWith(path.sep) ||
          specifier.endsWith(`${path.sep}.`) ||
          specifier.endsWith(`${path.sep}..`) ||
          specifier === '.' ||
          specifier === '..';
        try {
          const authoredCjsRequest =
            requested &&
            !nativeImport &&
            supportedOperations.run(true, () =>
              sourcePath(snapshot, requested),
            );
          const cjsCandidate = authoredCjsRequest
            ? cjsFileCandidate(requested, trailingSlash)
            : undefined;
          const result = supportedOperations.run(true, () =>
            nextResolve(specifier, context),
          );
          if (
            nativeBinding &&
            result.url.startsWith('file:') &&
            fileURLToPath(result.url) ===
              fileURLToPath(nativeBinding.bindingURL) &&
            context.parentURL !== nativeBinding.ownerURL
          ) {
            return unsupported(`native binding module ${result.url}`);
          }
          if (
            result.url.startsWith('file:') &&
            path.extname(fileURLToPath(result.url)) === '.node'
          ) {
            return unsupported(`native module ${result.url}`);
          }
          if (requested && result.url.startsWith('file:')) {
            const resolved = fileURLToPath(result.url);
            const covered = snapshot.coverage.some(
              boundary =>
                resolved === boundary.path ||
                (boundary.recursive && inside(boundary.path, resolved)),
            );
            const installedRequest =
              requested.split(path.sep).includes('node_modules') &&
              isInstalledDependency(requested) &&
              isInstalledDependency(resolved);
            if (authoredCjsRequest) {
              const currentCandidate = cjsFileCandidate(
                requested,
                trailingSlash,
              );
              if (cjsCandidate !== resolved || currentCandidate !== resolved)
                return unsupported(
                  `CJS source candidates changed during resolution: ${requested}`,
                );
              remember(resolved, 'module', true);
            }
            if (covered && !installedRequest) {
              try {
                supportedOperations.run(true, () =>
                  assertConfigSourceSymlinkTraversal(snapshot, requested),
                );
              } catch (error) {
                return unsupported(
                  error instanceof Error ? error.message : String(error),
                );
              }
              // Native resolution canonicalizes successful symlink requests.
              // Retain the actual explicit request before the load URL loses it.
              let exists = true;
              try {
                originalLstat(requested);
              } catch (error) {
                if (missing(error)) exists = false;
                else throw error;
              }
              if (
                !exists &&
                !supportedOperations.run(true, () =>
                  sourcePath(snapshot, requested),
                )
              ) {
                return unsupported(
                  `unbounded source request resolved through implicit Node candidates: ${requested}`,
                );
              }
              if (exists) remember(requested, 'module', true);
            }
          }
          return result;
        } catch (error) {
          const failedModule =
            error &&
            typeof error === 'object' &&
            'code' in error &&
            [
              'MODULE_NOT_FOUND',
              'ERR_MODULE_NOT_FOUND',
              'ERR_UNSUPPORTED_DIR_IMPORT',
            ].includes(String(error.code));
          if (failedModule && explicit) {
            if (!requested || !path.extname(requested)) {
              return unsupported(
                `unresolved extensionless source import ${specifier}`,
              );
            }
            let exists = true;
            try {
              originalLstat(requested);
            } catch (presenceError) {
              if (missing(presenceError)) exists = false;
              else throw presenceError;
            }
            if (exists)
              return unsupported(
                `unresolved installed source target ${requested}`,
              );
            remember(requested, 'metadata', false);
          }
          throw error;
        }
      },
      load(url, context, nextLoad) {
        const result = supportedOperations.run(true, () =>
          nextLoad(url, context),
        );
        if (url.startsWith('file:')) {
          if (result.format === 'addon')
            return unsupported(`native module ${url}`);
          let exists = true;
          try {
            originalLstat(fileURLToPath(url));
          } catch (error) {
            if (missing(error)) exists = false;
            else throw error;
          }
          remember(new URL(url), 'module', exists);
        }
        return result;
      },
    });
    restores.push(() => hooks.deregister());
    for (const name of ['registerHooks', 'register']) {
      replace(
        moduleBuiltin,
        name,
        () =>
          function () {
            return unsupported(`module.${name}`);
          },
      );
    }
    syncBuiltinESMExports();
    completion = { value: await evaluate(packageMetadataRead) };
  } catch (error) {
    evaluationError = error;
  } finally {
    metadataReadActive = false;
    replacements.clear();
    activeReplacements = undefined;
    for (const restore of restores.reverse()) {
      try {
        restore();
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error(String(error));
      }
    }
    syncBuiltinESMExports();
    observing = false;
  }
  if (evaluationError !== undefined) throw evaluationError;
  if (failure) throw failure;
  if (!completion)
    throw new Error('Config source observation did not complete');
  const consumedSourceInputs: ObservedConfigSourceInputs = Object.freeze({
    kind: 'observed-config-source-inputs',
    version: 1,
    observations: Object.freeze(
      [...observations.values()].sort(
        (a, b) =>
          a.path.localeCompare(b.path) ||
          a.operation.localeCompare(b.operation),
      ),
    ),
    packageMetadata: Object.freeze(
      [...packageMetadata.values()].sort(
        (a, b) =>
          a.path.localeCompare(b.path) || a.field.localeCompare(b.field),
      ),
    ),
  });
  return { value: completion.value, consumedSourceInputs };
}
