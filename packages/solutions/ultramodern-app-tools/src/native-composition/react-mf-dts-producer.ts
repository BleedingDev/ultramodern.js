import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  RendererGeneratedOutputDestination,
  RendererGeneratedOutputPath,
  RendererGeneratedOutputRegistrationInput,
  RendererGeneratedOutputValue,
} from '@modern-js/app-tools-extensions/renderer-generated-outputs';
import type { ReceiverBeginDetails } from './react-mf-dts-registry';
import { readRendererFrameworkPackage } from './renderer-installed-profile';

const CORE = '@module-federation/dts-plugin/core';
const PRIVATE_RECEIVER_OPTIONS = 'ultramodernReceiverDts';
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** One canonical CJS implementation is shared by source, CJS and ESM hosts. */
export function resolveReactReceiverImplementation(
  registrarUrl: string = import.meta.url,
): string {
  return createRequire(registrarUrl).resolve(
    process.env.MODERN_LIB_FORMAT === 'esm'
      ? '../../cjs/native-composition/react-mf-dts-implementation.cjs'
      : './react-mf-dts-implementation.cjs',
  );
}

/** Follow the public constructor shared by native MF's client and SSR plugins. */
export function resolveNativeReactReceiverCore(appDirectory: string): string {
  const appRequire = createRequire(path.join(appDirectory, 'package.json'));
  const mfRequire = createRequire(
    appRequire.resolve('@module-federation/modern-js-v3/ssr-plugin'),
  );
  const enhancedRequire = createRequire(
    mfRequire.resolve('@module-federation/enhanced/rspack'),
  );
  const rspackRequire = createRequire(
    enhancedRequire.resolve('@module-federation/rspack/plugin'),
  );
  return fs.realpathSync(rspackRequire.resolve(CORE));
}

function packageCodeDigest(directory: string): string {
  const inputs: [string, string][] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(
          `The native DTS package has an unbound code alias: ${filename}`,
        );
      if (entry.isDirectory()) visit(filename);
      else if (entry.isFile())
        inputs.push([
          path.relative(directory, filename).split(path.sep).join('/'),
          createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),
        ]);
      else
        throw new Error(
          `The native DTS package has unsupported code: ${filename}`,
        );
    }
  };
  inputs.push([
    'package.json',
    createHash('sha256')
      .update(fs.readFileSync(path.join(directory, 'package.json')))
      .digest('hex'),
  ]);
  visit(path.join(directory, 'dist'));
  inputs.sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
}

/** Compare the actual DTS owner selected by native MF with the adapter's owner. */
export async function resolveReactReceiverProducer(options: {
  readonly appDirectory: string;
  readonly implementationPath: string;
}): Promise<RendererGeneratedOutputRegistrationInput['producer']> {
  const ownRequire = createRequire(options.implementationPath);
  const ownCore = fs.realpathSync(ownRequire.resolve(CORE));
  const nativeCore = resolveNativeReactReceiverCore(options.appDirectory);
  const ownOwner = readRendererFrameworkPackage({
    specifier: CORE,
    filename: ownCore,
  });
  const nativeOwner = readRendererFrameworkPackage({
    specifier: CORE,
    filename: nativeCore,
  });
  if (
    ownCore !== nativeCore ||
    ownOwner.directory !== nativeOwner.directory ||
    ownOwner.name !== nativeOwner.name ||
    ownOwner.version !== nativeOwner.version
  )
    throw new Error(
      'The owning receiver and native MF select different DTS package cohorts',
    );
  const implementation: unknown = ownRequire(options.implementationPath);
  if (typeof implementation !== 'function')
    throw new Error(
      'The owning receiver has no native-compatible public constructor',
    );
  const methods = Object.getOwnPropertyDescriptors(implementation);
  const ownerMethod: unknown = methods.nativeDtsOwner?.value;
  const modulesMethod: unknown = methods.nativeDtsModules?.value;
  if (typeof ownerMethod !== 'function' || typeof modulesMethod !== 'function')
    throw new Error('The owning receiver has no loaded native DTS provenance');
  const loadedOwner: unknown = Reflect.apply(ownerMethod, implementation, []);
  const loadedModules: unknown = Reflect.apply(
    modulesMethod,
    implementation,
    [],
  );
  if (
    !record(loadedOwner) ||
    loadedOwner.packageName !== ownOwner.name ||
    loadedOwner.version !== ownOwner.version ||
    loadedOwner.packageDirectory !== ownOwner.directory ||
    loadedOwner.modulePath !== ownCore ||
    loadedOwner.moduleDigest !==
      createHash('sha256').update(fs.readFileSync(ownCore)).digest('hex') ||
    !Array.isArray(loadedModules) ||
    loadedModules.length === 0
  )
    throw new Error(
      'The loaded receiver DTS owner differs from the native MF cohort',
    );
  for (const module of loadedModules) {
    if (
      !record(module) ||
      typeof module.modulePath !== 'string' ||
      typeof module.moduleDigest !== 'string'
    )
      throw new Error('The loaded receiver DTS module evidence is invalid');
    const relative = path.relative(ownOwner.directory, module.modulePath);
    if (
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      fs.realpathSync(module.modulePath) !== module.modulePath ||
      createHash('sha256')
        .update(fs.readFileSync(module.modulePath))
        .digest('hex') !== module.moduleDigest
    )
      throw new Error(
        'The loaded receiver DTS module bytes differ from their physical owner',
      );
  }
  const digest = packageCodeDigest(ownOwner.directory);
  return Object.freeze({
    packageName: ownOwner.name,
    version: ownOwner.version,
    packageDirectory: ownOwner.directory,
    modulePath: ownCore,
    moduleDigest: digest,
  });
}

function finiteOptions(
  value: unknown,
  ancestors = new Set<object>(),
  location: readonly string[] = [],
): RendererGeneratedOutputValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || ancestors.has(value))
    throw new Error(
      'Native receiver options must contain finite serializable data',
    );
  const array = Array.isArray(value);
  if (
    array
      ? Object.getPrototypeOf(value) !== Array.prototype
      : ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Native receiver options must contain plain data');
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as keyof typeof descriptors]!;
    if (
      typeof key !== 'string' ||
      !('value' in descriptor) ||
      (!descriptor.enumerable && !(array && key === 'length'))
    )
      throw new Error(
        'Native receiver options cannot contain accessors or hidden fields',
      );
  }
  let result: RendererGeneratedOutputValue;
  if (array) {
    const length: unknown = descriptors.length?.value;
    if (
      !Number.isSafeInteger(length) ||
      typeof length !== 'number' ||
      length < 0 ||
      Object.keys(descriptors).length !== length + 1
    )
      throw new Error('Native receiver option arrays must be dense');
    result = Object.freeze(
      Array.from({ length }, (_, index) => {
        const descriptor = descriptors[String(index)];
        if (!descriptor)
          throw new Error('Native receiver option arrays must be dense');
        return finiteOptions(descriptor.value, ancestors, [
          ...location,
          String(index),
        ]);
      }),
    );
  } else {
    result = Object.freeze(
      Object.fromEntries(
        Object.entries(descriptors)
          .filter(
            ([key, descriptor]) =>
              descriptor.value !== undefined &&
              !(
                key === PRIVATE_RECEIVER_OPTIONS &&
                [
                  'extraOptions',
                  'host.moduleFederationConfig.dts.extraOptions',
                  'remote.moduleFederationConfig.dts.extraOptions',
                ].includes(location.join('.'))
              ),
          )
          .map(([key, descriptor]) => [
            key,
            finiteOptions(descriptor.value, ancestors, [...location, key]),
          ]),
      ),
    );
  }
  ancestors.delete(value);
  return result;
}

/** Preserve a missing lexical path while resolving only its live ancestors. */
export function receiverOutputPath(
  filename: string,
  context?: string,
): RendererGeneratedOutputPath {
  const lexical = path.resolve(filename);
  let parent = lexical;
  const suffix: string[] = [];
  let canonical: string | undefined;
  for (;;) {
    try {
      const stat = fs.lstatSync(parent);
      if (stat.isSymbolicLink())
        throw new Error(
          `A native receiver destination crosses an unbound alias: ${parent}`,
        );
      canonical ??= path.join(fs.realpathSync(parent), ...suffix);
    } catch (error) {
      if (!record(error) || error.code !== 'ENOENT') throw error;
      if (!canonical) suffix.unshift(path.basename(parent));
    }
    const next = path.dirname(parent);
    if (parent === context || next === parent) {
      if (!canonical)
        throw new Error(
          'A native receiver destination has no physical ancestor',
        );
      return Object.freeze({ lexical, canonical });
    }
    parent = next;
  }
}

function alias(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    path.isAbsolute(value) ||
    /[\\\0]/u.test(value) ||
    value.split('/').some(part => !part || part === '.' || part === '..')
  )
    throw new Error(
      'A native receiver remote must have one exact relative destination alias',
    );
  return value;
}

/** Register native configured aliases, the API index, and exact directory effects. */
export async function resolveReactReceiverDestinations(
  details: ReceiverBeginDetails,
): Promise<{
  readonly effectiveOptions: RendererGeneratedOutputValue;
  readonly context: RendererGeneratedOutputValue;
  readonly destinations: readonly RendererGeneratedOutputDestination[];
}> {
  const effectiveOptions = finiteOptions(details.nativeOptions);
  if (!record(effectiveOptions) || !record(effectiveOptions.host))
    throw new Error(
      'The receiver operation has no effective native host options',
    );
  const host = effectiveOptions.host;
  if (typeof host.context !== 'string' || !path.isAbsolute(host.context))
    throw new Error(
      'The receiver operation has no absolute native host context',
    );
  if (!record(host.moduleFederationConfig))
    throw new Error(
      'The receiver operation has no effective native MF options',
    );
  const context = path.resolve(host.context);
  const typesFolder =
    host.typesFolder === undefined ? '@mf-types' : host.typesFolder;
  if (
    typeof typesFolder !== 'string' ||
    !typesFolder ||
    typesFolder.includes('\0')
  )
    throw new Error('The native receiver types folder is invalid');
  const typesDirectory = path.resolve(context, typesFolder);
  const implementationPath = fs.realpathSync(
    resolveReactReceiverImplementation(),
  );
  const implementationOwner = readRendererFrameworkPackage({
    specifier: 'native-receiver-implementation',
    filename: implementationPath,
  });
  const nativeRequire = createRequire(resolveNativeReactReceiverCore(context));
  const managers: unknown = nativeRequire('@module-federation/managers');
  if (
    !record(managers) ||
    !record(managers.utils) ||
    typeof managers.utils.parseOptions !== 'function'
  )
    throw new Error('The native MF remote option parser is unavailable');
  const parsed: unknown = Reflect.apply(
    managers.utils.parseOptions,
    undefined,
    [
      host.moduleFederationConfig.remotes ?? {},
      (_item: unknown, key: unknown) => ({ key }),
      (_item: unknown, key: unknown) => ({ key }),
    ],
  );
  if (!Array.isArray(parsed))
    throw new Error(
      'The native MF remote option parser returned invalid aliases',
    );
  const aliases = new Set<string>();
  for (const entry of parsed) {
    if (!Array.isArray(entry) || !record(entry[1]))
      throw new Error('The native MF remote aliases are invalid');
    aliases.add(alias(entry[1].key));
  }
  if (host.remoteTypeUrls !== undefined) {
    if (!record(host.remoteTypeUrls))
      throw new Error(
        'Native remote type URL callbacks must finish before receiver IO',
      );
    for (const [remoteName, info] of Object.entries(host.remoteTypeUrls)) {
      if (!record(info))
        throw new Error('The native remote type URL options are invalid');
      aliases.add(alias(info.alias ?? remoteName));
    }
  }
  let nativeUpdate: RendererGeneratedOutputValue | undefined;
  if (details.operation === 'updateTypes') {
    nativeUpdate = finiteOptions(details.update);
    if (!record(nativeUpdate) || typeof nativeUpdate.remoteName !== 'string')
      throw new Error('The native receiver update has no exact remote request');
    const selectedAlias = alias(details.remoteAlias);
    if (!aliases.has(selectedAlias) && !record(nativeUpdate.remoteInfo))
      throw new Error('The native receiver update has no selected remote info');
    // The native cache can retain a different alias from a later request. The
    // trusted adapter reports the actual branch before native IO, not a union
    // of guessed names from the new request.
    aliases.clear();
    aliases.add(selectedAlias);
  } else if (details.operation !== 'consumeTypes')
    throw new Error('The native receiver operation is unsupported');
  const destinations: RendererGeneratedOutputDestination[] = [...aliases]
    .sort()
    .map(name => ({
      path: receiverOutputPath(path.join(typesDirectory, name), context),
      kind: 'directory',
      scope: 'subtree',
    }));
  const directoryPaths = new Set<string>([typesDirectory]);
  for (const name of aliases) {
    let parent = path.dirname(path.join(typesDirectory, name));
    while (parent !== typesDirectory) {
      directoryPaths.add(parent);
      const next = path.dirname(parent);
      if (next === parent)
        throw new Error('The native remote alias escapes its types folder');
      parent = next;
    }
  }
  destinations.push({
    path: receiverOutputPath(path.join(typesDirectory, 'index.d.ts'), context),
    kind: 'file',
    scope: 'exact',
  });
  for (const initial of [...directoryPaths]) {
    let directory = initial;
    for (;;) {
      directoryPaths.add(directory);
      if (directory === context || fs.existsSync(directory)) break;
      const parent = path.dirname(directory);
      if (parent === directory)
        throw new Error(
          'The native receiver folder has no live owning directory',
        );
      directory = parent;
    }
  }
  for (const directory of [...directoryPaths].sort())
    destinations.push({
      path: receiverOutputPath(directory, context),
      kind: 'directory',
      scope: 'exact',
    });
  return Object.freeze({
    effectiveOptions,
    context: Object.freeze({
      operation: details.operation,
      nativeContext: context,
      ...(nativeUpdate !== undefined
        ? {
            nativeUpdate: Object.freeze({
              request: nativeUpdate,
              remoteAlias: details.remoteAlias!,
            }),
          }
        : {}),
      implementation: Object.freeze({
        packageName: implementationOwner.name,
        version: implementationOwner.version,
        packageDirectory: implementationOwner.directory,
        modulePath: implementationPath,
        moduleDigest: createHash('sha256')
          .update(fs.readFileSync(implementationPath))
          .digest('hex'),
      }),
    }),
    destinations: Object.freeze(
      destinations.map(destination => Object.freeze(destination)),
    ),
  });
}
