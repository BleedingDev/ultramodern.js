import { AsyncLocalStorage } from 'node:async_hooks';
import childProcess from 'node:child_process';
import { tracingChannel } from 'node:diagnostics_channel';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import moduleBuiltin, {
  registerHooks,
  syncBuiltinESMExports,
} from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, types as utilTypes } from 'node:util';
import workerThreads from 'node:worker_threads';
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
  compilerDiscovery?: {
    installations: readonly { cliPath: string; backendDirectory: string }[];
    install(
      observer: (
        installation: {
          from: string;
          cliPath: string;
          backendDirectory: string;
        },
        invoke: () => string,
      ) => string,
    ): () => void;
  },
  nativeBinding?: OwningConfigNativeBinding,
): Promise<{ value: T; consumedSourceInputs: ObservedConfigSourceInputs }> {
  if (observing)
    throw new Error('Config source observation already has an owner');
  observing = true;
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
    if (supportedOperations.getStore()) return;
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
  ) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const wrapped = replacement(descriptor.value);
    const functionDescriptors = Object.getOwnPropertyDescriptors(
      descriptor.value,
    );
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
    if (compilerDiscovery) {
      restores.push(
        compilerDiscovery.install((installation, invoke) => {
          const origin = filename(installation.from);
          if (
            !origin ||
            !sourcePath(snapshot, origin) ||
            !compilerDiscovery.installations.some(
              allowed =>
                allowed.cliPath === installation.cliPath &&
                allowed.backendDirectory === installation.backendDirectory,
            )
          )
            return unsupported(
              'Effect discovery outside the original authored origin or selected installed cohort',
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
          return supportedOperations.run(true, invoke);
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
        const requested = !explicit
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
        try {
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
              !requested.split(path.sep).includes('..') &&
              isInstalledDependency(requested);
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
