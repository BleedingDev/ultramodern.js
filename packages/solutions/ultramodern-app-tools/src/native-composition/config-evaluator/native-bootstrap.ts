import fs from 'node:fs';
import { createRequire, findPackageJSON } from 'node:module';
import { pathToFileURL } from 'node:url';
import { types as utilTypes } from 'node:util';

const realpathCaches = new WeakSet<object>();
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const apply = Reflect.apply;
let initialized: OwningConfigNativeBinding | undefined;

export interface OwningConfigNativeBinding {
  readonly bindingURL: string;
  readonly ownerURL: string;
  readonly isRealpathCache: (value: object) => boolean;
}

/** Initialize only the declared framework's fixed release reader before authors. */
export async function initializeOwningReleaseIdentity(): Promise<void> {
  const owningModule =
    process.env.MODERN_LIB_FORMAT === 'cjs' ? __filename : import.meta.url;
  // Config loaders can cross formats. Both owning entries must retain their
  // native Git reader before observation updates the shared builtin exports.
  createRequire(owningModule)(
    '@modern-js/app-tools-extensions/release-identity',
  );
  await import('@modern-js/app-tools-extensions/release-identity');
}

/** Internal fixed framework initialization; never accepts an authored callback. */
export function initializeOwningConfigNativeBinding(): OwningConfigNativeBinding {
  for (const name of [
    'RSPACK_BINDING',
    'NAPI_RS_NATIVE_LIBRARY_PATH',
    'NAPI_RS_FORCE_WASI',
  ]) {
    if (process.env[name]) {
      throw new Error(
        `UltraModern config evaluator does not support native binding override ${name}`,
      );
    }
  }
  if ('webcontainer' in process.versions) {
    throw new Error(
      'UltraModern config evaluator does not support WebContainer native binding discovery',
    );
  }
  if (initialized) return initialized;
  const descriptor = Object.getOwnPropertyDescriptor(fs, 'realpathSync')!;
  const original = fs.realpathSync;
  const capture = function (this: unknown, ...args: unknown[]) {
    const options = args[1];
    if (options && typeof options === 'object' && !utilTypes.isProxy(options)) {
      for (const key of Object.getOwnPropertySymbols(options)) {
        const value = Object.getOwnPropertyDescriptor(options, key)?.value;
        if (
          value &&
          typeof value === 'object' &&
          utilTypes.isMap(value) &&
          !utilTypes.isProxy(value) &&
          Reflect.ownKeys(value).length === 0
        ) {
          const prototype = Object.getPrototypeOf(value);
          if (
            prototype &&
            Object.isFrozen(prototype) &&
            Object.getPrototypeOf(prototype) === null
          ) {
            apply(weakSetAdd, realpathCaches, [value]);
          }
        }
      }
    }
    return Reflect.apply(original, this, args);
  };
  Object.defineProperties(capture, Object.getOwnPropertyDescriptors(original));
  Object.defineProperty(fs, 'realpathSync', { ...descriptor, value: capture });
  try {
    // The declaring module fixes this installed cohort; callers cannot select
    // another package through a require anchor or expand the cache grant.
    const owningModule =
      process.env.MODERN_LIB_FORMAT === 'cjs' ? __filename : import.meta.url;
    // Node's public package lookup uses a distinct ESM resolver cache. Capture
    // its exact instance using only this fixed declaring file, before authors.
    findPackageJSON(owningModule, owningModule);
    const owningRequire = createRequire(owningModule);
    const rsbuildRequire = createRequire(
      owningRequire.resolve('@rsbuild/core/package.json'),
    );
    const rspackRequire = createRequire(
      rsbuildRequire.resolve('@rspack/core/package.json'),
    );
    // Initialize only the declared native binding. Rsbuild/Rspack/config helper
    // modules remain unevaluated until filesystem observation is installed.
    rspackRequire('@rspack/binding');
    initialized = Object.freeze({
      bindingURL: pathToFileURL(rspackRequire.resolve('@rspack/binding')).href,
      ownerURL: pathToFileURL(rspackRequire.resolve('@rspack/core')).href,
      isRealpathCache: (value: object) =>
        apply(weakSetHas, realpathCaches, [value]),
    });
    return initialized;
  } finally {
    Object.defineProperty(fs, 'realpathSync', descriptor);
  }
}
