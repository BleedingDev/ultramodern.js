import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import type { OnAfterBuildFn, OnAfterDevCompileFn, RsbuildEntry, RsbuildPlugin, Rspack } from '@rsbuild/core';

const receiptName = 'native-compiler-observation.json';
const developmentDirectory = '.ultramodern-dev';

type DevelopmentObservation = {
  metadataFile: string;
  metadataSha256: string;
  devCompilation: {
    compilationHashes: Record<string, string>;
    generation: number;
    sourceInputDigest: string;
  };
};

type PluginObservation = {
  evidence: string;
  names: string[];
  plugins: {
    name: string;
    configuredClaim: {
      renderer: string;
      sourceExtensions: string[];
      transform: 'native';
      refresh: 'native';
      svg: 'url';
    } | null;
  }[];
  appliedOwnership: 'unavailable-public-api';
};

type CompiledModule = {
  identifier: string;
  resource: string | null;
  source: { path: string; sha256: string; size: number } | null;
  modules: CompiledModule[];
};

type CompiledModuleGraph = {
  evidence: 'stats.compilation.modules';
  name: string | null;
  compilationHash: string | null;
  modules: CompiledModule[];
  children: CompiledModuleGraph[];
  sha256: string;
};

type CompiledStylesheets = {
  evidence: 'stats.compilation.getAssets';
  compilationHash: string;
  outputPath: string;
  publicPath: string;
  assets: {
    file: string;
    sha256: string;
    size: number;
    source: { encoding: 'utf8' | 'base64'; bytes: string };
  }[];
  startupFiles: Record<string, string[]>;
  sha256: string;
};

export type NativeCompilerObservation = {
  schema: 'ultramodern-native-compiler-observation';
  version: 1;
  observer: {
    event: 'onAfterBuild' | 'onDevCompileDone';
    order: 'post';
    rsbuildVersion: string;
    sourceFile: string;
  };
  rootPath: string;
  distPath: string;
  configFile: string | null;
  configFileDependencies: string[];
  configuredPlugins: PluginObservation;
  environments: {
    name: string;
    target: string;
    mode: string;
    distPath: string;
    entry: Record<string, string[]>;
    configSourceEntry: Record<string, string[]>;
    compiledEntryNames: string[];
    compiledEntryFiles: Record<string, string[]>;
    compilationHash: string;
    hasErrors: false;
    errorCount: 0;
    configuredPlugins: PluginObservation;
    compiledModuleGraph: CompiledModuleGraph;
    compiledStylesheets?: CompiledStylesheets;
    nativeModuleManifests?: {
      file: string;
      sha256: string;
      size: number;
      source: string;
    }[];
  }[];
  sourceInventory: {
    path: string;
    sha256: string;
    size: number;
    roles: string[];
  }[];
  development?: DevelopmentObservation;
};

async function developmentObservation(
  distPath: string,
  environments: NativeCompilerObservation['environments'],
): Promise<{
  renderer: 'react' | 'solid' | 'octane';
  development: DevelopmentObservation;
}> {
  const metadataFile = path.join(distPath, developmentDirectory, 'renderer-build.json');
  const bytes = await fs.readFile(metadataFile);
  const value: unknown = JSON.parse(bytes.toString('utf8'));
  if (
    !value ||
    typeof value !== 'object' ||
    !('schema' in value) ||
    value.schema !== 'ultramodern-renderer-build' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('cacheAllowed' in value) ||
    value.cacheAllowed !== false ||
    !('promotable' in value) ||
    value.promotable !== false ||
    !('profile' in value) ||
    !value.profile ||
    typeof value.profile !== 'object' ||
    !('renderer' in value.profile) ||
    (value.profile.renderer !== 'react' && value.profile.renderer !== 'solid' && value.profile.renderer !== 'octane') ||
    !('devCompilation' in value) ||
    !value.devCompilation ||
    typeof value.devCompilation !== 'object' ||
    Array.isArray(value.devCompilation)
  )
    throw new Error('Development observation requires the committed owning development metadata');
  const compilation = value.devCompilation;
  if (
    !isDeepStrictEqual(Object.keys(compilation).sort(), ['compilationHashes', 'generation', 'sourceInputDigest']) ||
    !('generation' in compilation) ||
    typeof compilation.generation !== 'number' ||
    !Number.isSafeInteger(compilation.generation) ||
    compilation.generation < 1 ||
    !('sourceInputDigest' in compilation) ||
    typeof compilation.sourceInputDigest !== 'string' ||
    !/^[a-f\d]{64}$/u.test(compilation.sourceInputDigest) ||
    !('compilationHashes' in compilation) ||
    !compilation.compilationHashes ||
    typeof compilation.compilationHashes !== 'object' ||
    Array.isArray(compilation.compilationHashes)
  )
    throw new Error('Development observation has malformed wave metadata');
  const hashes = Object.fromEntries(environments.map((environment) => [environment.name, environment.compilationHash]));
  if (
    Object.values(hashes).some((hash) => !/^[a-f\d]{1,64}$/u.test(hash)) ||
    !isDeepStrictEqual(compilation.compilationHashes, hashes)
  )
    throw new Error('Development observation compiler hashes differ from the committed wave');
  return {
    renderer: value.profile.renderer,
    development: {
      metadataFile,
      metadataSha256: createHash('sha256').update(bytes).digest('hex'),
      devCompilation: {
        compilationHashes: hashes,
        generation: compilation.generation,
        sourceInputDigest: compilation.sourceInputDigest,
      },
    },
  };
}

function withinRoot(rootPath: string, input: string): string {
  const absolute = path.resolve(rootPath, input);
  const relative = path.relative(rootPath, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Compiler observation source must be inside its consumer: ${input}`);
  }
  if (path.isAbsolute(relative)) {
    throw new Error(`Compiler observation source must be inside its consumer: ${input}`);
  }
  return absolute;
}

function entryRoots(entry: Readonly<RsbuildEntry> | undefined): Record<string, string[]> {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('Compiler observation requires actual final source entry maps');
  }
  const result = Object.fromEntries(
    Object.entries(entry).map(([name, description]) => {
      const imports = typeof description === 'string' || Array.isArray(description) ? description : description.import;
      const roots = typeof imports === 'string' ? [imports] : imports;
      if (!roots?.length || roots.some((root) => typeof root !== 'string' || !root)) {
        throw new Error(`Compiler observation requires file roots for entry ${name}`);
      }
      return [name, [...roots]];
    }),
  );
  if (!Object.keys(result).length) {
    throw new Error('Compiler observation requires nonempty final source entry maps');
  }
  return result;
}

async function pluginObservations(value: unknown): Promise<PluginObservation['plugins']> {
  const resolved = await value;
  if (!resolved) return [];
  if (Array.isArray(resolved)) {
    const plugins: PluginObservation['plugins'] = [];
    for (const plugin of resolved) plugins.push(...(await pluginObservations(plugin)));
    return plugins;
  }
  if (typeof resolved !== 'object' || !('name' in resolved) || typeof resolved.name !== 'string' || !resolved.name) {
    throw new Error('Compiler observation requires configured plugins with actual names');
  }
  const descriptor = Object.getOwnPropertyDescriptor(resolved, Symbol.for('ultramodern.renderer-compiler-claim'));
  const claim: unknown = descriptor?.enumerable && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  if (claim === undefined) return [{ name: resolved.name, configuredClaim: null }];
  if (
    !claim ||
    typeof claim !== 'object' ||
    !('renderer' in claim) ||
    typeof claim.renderer !== 'string' ||
    !claim.renderer ||
    !('sourceExtensions' in claim) ||
    !Array.isArray(claim.sourceExtensions) ||
    !claim.sourceExtensions.length ||
    claim.sourceExtensions.some((extension) => typeof extension !== 'string' || !extension) ||
    !('transform' in claim) ||
    claim.transform !== 'native' ||
    !('refresh' in claim) ||
    claim.refresh !== 'native' ||
    !('svg' in claim) ||
    claim.svg !== 'url'
  )
    throw new Error(`Compiler observation found an invalid configured claim on ${resolved.name}`);
  return [
    {
      name: resolved.name,
      configuredClaim: {
        renderer: claim.renderer,
        sourceExtensions: [...claim.sourceExtensions],
        transform: claim.transform,
        refresh: claim.refresh,
        svg: claim.svg,
      },
    },
  ];
}

async function configuredPlugins(value: unknown, evidence: string): Promise<PluginObservation> {
  const plugins = await pluginObservations(value);
  return {
    evidence,
    names: plugins.map((plugin) => plugin.name),
    plugins,
    appliedOwnership: 'unavailable-public-api',
  };
}

/** Preserve the complete final graph, including concatenation and child compilers. */
async function compiledModuleGraph(compilation: Rspack.Compilation): Promise<CompiledModuleGraph> {
  const sources = new Map<string, CompiledModule['source']>();
  const iterable = (value: unknown): value is Iterable<unknown> =>
    value !== null &&
    typeof value === 'object' &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === 'function';
  const compilationAncestry = new Set<Rspack.Compilation>();
  const snapshot = (current: Rspack.Compilation): CompiledModuleGraph => {
    if (compilationAncestry.has(current)) throw new Error('Compiler observation found a cyclic child compilation');
    compilationAncestry.add(current);
    if (!iterable(current.modules) || !Array.isArray(current.children))
      throw new Error('Compiler observation has no actual complete module graph');
    const ancestry = new Set<object>();
    const seen = new Set<object>();
    const modules = (inputs: Iterable<unknown>): CompiledModule[] => {
      const records: CompiledModule[] = [];
      for (const module of inputs) {
        if (
          !module ||
          typeof module !== 'object' ||
          !('identifier' in module) ||
          typeof module.identifier !== 'function'
        )
          throw new Error('Compiler observation found a malformed actual module');
        if (ancestry.has(module)) throw new Error('Compiler observation found a cyclic module graph');
        if (seen.has(module)) continue;
        seen.add(module);
        ancestry.add(module);
        const identifier = module.identifier();
        const resource: unknown = Reflect.get(module, 'resource');
        const nested: unknown = Reflect.get(module, 'modules');
        const rootModule: unknown = Reflect.get(module, 'rootModule');
        const resolved: unknown = Reflect.get(module, 'resourceResolveData');
        if (
          typeof identifier !== 'string' ||
          !identifier ||
          (resource !== undefined && resource !== null && typeof resource !== 'string')
        )
          throw new Error('Compiler observation found a malformed actual module');
        let source: CompiledModule['source'] = null;
        if (typeof resource === 'string' && !/^data:[^,]*,/u.test(resource)) {
          if (
            !resolved ||
            typeof resolved !== 'object' ||
            !('path' in resolved) ||
            typeof resolved.path !== 'string' ||
            !path.isAbsolute(resolved.path) ||
            resolved.path.includes('\0') ||
            !('resource' in resolved) ||
            resolved.resource !== resource
          )
            throw new Error('Compiler observation module resource has no actual physical resolver path');
          source = { path: resolved.path, sha256: '', size: 0 };
        }
        const children: unknown[] = [];
        if (rootModule !== undefined && rootModule !== null) children.push(rootModule);
        if (nested !== undefined && nested !== null) {
          if (!iterable(nested)) throw new Error('Compiler observation found malformed concatenated modules');
          for (const child of nested) children.push(child);
        }
        records.push({
          identifier,
          resource: typeof resource === 'string' ? resource : null,
          source,
          modules: modules(children),
        });
        ancestry.delete(module);
      }
      return records;
    };
    const graph: CompiledModuleGraph = {
      evidence: 'stats.compilation.modules',
      name: typeof current.name === 'string' ? current.name : null,
      compilationHash: typeof current.hash === 'string' ? current.hash : null,
      modules: modules(current.modules),
      children: current.children.map(snapshot),
      sha256: '',
    };
    compilationAncestry.delete(current);
    return graph;
  };
  const graph = snapshot(compilation);
  const signature = JSON.stringify(graph);
  const bind = async (current: CompiledModuleGraph): Promise<void> => {
    const visit = async (module: CompiledModule): Promise<void> => {
      if (module.source !== null) {
        // Keep the exact resource request above; query/fragment are not filenames.
        const requested = module.source?.path;
        if (!requested) throw new Error('Compiler observation lost its actual resolver path');
        const source = await fs.realpath(requested);
        if (!(await fs.lstat(source)).isFile())
          throw new Error('Compiler observation module resource is not an ordinary file');
        let record = sources.get(source);
        if (!record) {
          const bytes = await fs.readFile(source);
          record = {
            path: source,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            size: bytes.byteLength,
          };
          sources.set(source, record);
        }
        module.source = record;
      }
      for (const child of module.modules) await visit(child);
    };
    for (const module of current.modules) await visit(module);
    for (const child of current.children) await bind(child);
    const { sha256: _sha256, ...value } = current;
    current.sha256 = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  };
  await bind(graph);
  if (JSON.stringify(snapshot(compilation)) !== signature)
    throw new Error('Compiler observation module graph changed during capture');
  for (const source of sources.values()) {
    if (!source) throw new Error('Compiler observation lost a module source');
    const bytes = await fs.readFile(source.path);
    if (bytes.byteLength !== source.size || createHash('sha256').update(bytes).digest('hex') !== source.sha256)
      throw new Error('Compiler observation module source changed during capture');
  }
  return graph;
}

/** Actual emitted closure includes lazy stylesheets absent from entrypoint startup files. */
function compiledStylesheets(compilation: Rspack.Compilation): CompiledStylesheets {
  if (
    typeof compilation.getAssets !== 'function' ||
    !compilation.hash ||
    typeof compilation.outputOptions.path !== 'string' ||
    !path.isAbsolute(compilation.outputOptions.path) ||
    typeof compilation.outputOptions.publicPath !== 'string'
  )
    throw new Error('Compiler observation requires actual stylesheet output authority');
  const emitted = compilation.getAssets();
  if (!Array.isArray(emitted)) throw new Error('Compiler observation requires actual emitted stylesheet assets');
  const stylesheet = (file: string) => path.posix.extname(file).toLowerCase() === '.css';
  const names = new Set<string>();
  const assets: CompiledStylesheets['assets'] = [];
  for (const asset of emitted) {
    const file = asset.name;
    if (
      typeof file !== 'string' ||
      !file ||
      path.isAbsolute(file) ||
      file.includes('\\') ||
      file.includes('\0') ||
      path.posix.normalize(file) !== file ||
      file === '..' ||
      file.startsWith('../') ||
      names.has(file)
    )
      throw new Error('Compiler observation has malformed emitted asset names');
    names.add(file);
    if (!stylesheet(file)) continue;
    const emittedSource = asset.source.source();
    if (typeof emittedSource !== 'string' && !Buffer.isBuffer(emittedSource))
      throw new Error('Compiler observation stylesheet has no actual source bytes');
    const bytes = Buffer.from(emittedSource);
    const utf8 = bytes.toString('utf8');
    assets.push({
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
      source: Buffer.from(utf8).equals(bytes)
        ? { encoding: 'utf8', bytes: utf8 }
        : { encoding: 'base64', bytes: bytes.toString('base64') },
    });
  }
  assets.sort((a, b) => a.file.localeCompare(b.file));
  const startupFiles = Object.fromEntries(
    [...compilation.entrypoints]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, entrypoint]) => {
        const files = entrypoint.getFiles().filter(stylesheet);
        if (new Set(files).size !== files.length || files.some((file) => !names.has(file)))
          throw new Error('Compiler observation startup CSS is absent from actual emitted assets');
        return [name, files];
      }),
  );
  const value = {
    evidence: 'stats.compilation.getAssets' as const,
    compilationHash: compilation.hash,
    outputPath: compilation.outputOptions.path,
    publicPath: compilation.outputOptions.publicPath,
    assets,
    startupFiles,
  };
  return {
    ...value,
    sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  };
}

async function persistReceipt(distPath: string, observation: NativeCompilerObservation): Promise<void> {
  const output = path.join(distPath, receiptName);
  const digestOutput = `${output}.sha256`;
  const token = `${process.pid}.${randomUUID()}`;
  const temporary = `${output}.${token}.tmp`;
  const digestTemporary = `${digestOutput}.${token}.tmp`;
  const serialized = `${JSON.stringify(observation, null, 2)}\n`;
  const digest = `${createHash('sha256').update(serialized).digest('hex')}\n`;
  const owned: string[] = [];
  try {
    for (const [file, content] of [
      [temporary, serialized],
      [digestTemporary, digest],
    ]) {
      if (!file || content === undefined) throw new Error('Missing compiler observation output');
      const handle = await fs.open(file, 'wx');
      owned.push(file);
      try {
        await handle.writeFile(content);
      } finally {
        await handle.close();
      }
    }
    await fs.rename(temporary, output);
    await fs.rename(digestTemporary, digestOutput);
  } finally {
    await Promise.all(owned.map((file) => fs.rm(file, { force: true })));
  }
}

/** Same-build, read-only acceptance evidence. Configured names do not prove plugin apply ownership. */
export function observeNativeCompiler(): RsbuildPlugin {
  return {
    name: 'ultramodern-acceptance-observe-native-compiler',
    setup(api) {
      const capture = async (
        event: NativeCompilerObservation['observer']['event'],
        { stats, environments }: Pick<Parameters<OnAfterBuildFn>[0], 'stats' | 'environments'>,
      ) => {
        const isDevelopment = event === 'onDevCompileDone';
        if (!stats || stats.hasErrors()) {
          throw new Error('Compiler observation requires successful completed compiler stats');
        }
        const results = 'stats' in stats ? stats.stats : [stats];
        if (!results.length || !environments.client || !environments.server) {
          throw new Error('Compiler observation requires actual client and server environments');
        }
        const rootPath = await fs.realpath(api.context.rootPath);
        const contextDistPath = withinRoot(rootPath, api.context.distPath);
        let distPath = contextDistPath;
        let nativeDevelopmentLayout = false;
        if (isDevelopment) {
          const server = results.filter((result) => result.compilation.name === 'server');
          const client = results.filter((result) => result.compilation.name === 'client');
          const serverOutput = server[0]?.compilation.outputOptions.path;
          const clientOutput = client[0]?.compilation.outputOptions.path;
          if (
            server.length !== 1 ||
            client.length !== 1 ||
            !serverOutput ||
            !clientOutput ||
            !path.isAbsolute(serverOutput) ||
            !path.isAbsolute(clientOutput) ||
            serverOutput !== environments.server.distPath ||
            clientOutput !== environments.client.distPath ||
            path.basename(serverOutput) !== 'bundles' ||
            path.dirname(serverOutput) !== contextDistPath
          )
            throw new Error('Development observation requires the actual owning compiler output layout');
          if (clientOutput === contextDistPath) {
            // React keeps its compiler output at the application dist root.
            distPath = contextDistPath;
          } else if (
            path.basename(contextDistPath) === developmentDirectory &&
            clientOutput === path.join(contextDistPath, 'client')
          ) {
            // Native compilers share the isolated development root. Rsbuild
            // exposes that common parent, rather than the application dist.
            nativeDevelopmentLayout = true;
            distPath = withinRoot(rootPath, path.dirname(contextDistPath));
          } else {
            throw new Error('Development observation requires the declared React or native output layout');
          }
        }
        for (const directory of new Set([contextDistPath, distPath]))
          if ((await fs.realpath(directory)) !== directory || !(await fs.lstat(directory)).isDirectory())
            throw new Error('Compiler observation requires the actual consumer output directory');
        const observerSource = fileURLToPath(import.meta.url);
        const inventory = new Map<string, Set<string>>();
        const addSource = (input: string, role: string) => {
          const source = withinRoot(rootPath, input);
          const roles = inventory.get(source) ?? new Set<string>();
          roles.add(role);
          inventory.set(source, roles);
        };
        addSource(observerSource, 'executing-observer');
        addSource('observe-native-compiler.ts', 'fixture-observer');
        addSource('modern.config.ts', 'fixture-config');
        if (api.context.configFile) addSource(api.context.configFile, 'sdk-config');
        for (const source of api.context.configFileDependencies) addSource(source, 'sdk-config-dependency');

        const observedEnvironments: NativeCompilerObservation['environments'] = [];
        const stylesheetObservations: {
          compilation: Rspack.Compilation;
          value: CompiledStylesheets;
        }[] = [];
        const consumed = new Set<string>();
        for (const [name, environment] of Object.entries(environments).sort(([a], [b]) => a.localeCompare(b))) {
          if (name !== environment.name)
            throw new Error('Compiler observation environment name disagrees with its key');
          const matches = results.filter((result) => result.compilation.name === name);
          const result = matches[0];
          if (matches.length !== 1 || !result || consumed.has(name)) {
            throw new Error(`Compiler observation requires one actual compilation for ${name}`);
          }
          consumed.add(name);
          const compilation = result.compilation;
          if (
            result.hasErrors() ||
            compilation.errors.length ||
            !compilation.hash ||
            compilation.endTime === undefined
          ) {
            throw new Error(`Compiler observation requires a successful completed ${name} compilation`);
          }
          if (environment.config.mode !== (isDevelopment ? 'development' : 'production'))
            throw new Error('Compiler observation mode disagrees with its actual lifecycle event');
          const compiledEntryNames = [...compilation.entrypoints.keys()].sort();
          if (!compiledEntryNames.length)
            throw new Error(`Compiler observation requires compiled entrypoints for ${name}`);
          const compiledEntryFiles = Object.fromEntries(
            [...compilation.entrypoints].map(([entryName, entrypoint]) => {
              const files = entrypoint.getFiles();
              if (
                !files.length ||
                new Set(files).size !== files.length ||
                files.some((file) => typeof file !== 'string' || !file || !compilation.getAsset(file))
              )
                throw new Error(`Compiler observation requires actual emitted files for ${name}/${entryName}`);
              return [entryName, [...files]];
            }),
          );
          const entry = entryRoots(environment.entry);
          const configSourceEntry = entryRoots(environment.config.source.entry);
          for (const roots of Object.values(entry))
            for (const root of roots) addSource(root, `environment:${name}:entry`);
          for (const roots of Object.values(configSourceEntry))
            for (const root of roots) addSource(root, `environment:${name}:config-source-entry`);
          const nativeModuleManifests: NonNullable<
            NativeCompilerObservation['environments'][number]['nativeModuleManifests']
          > = [];
          const stylesheets = name === 'client' ? compiledStylesheets(compilation) : undefined;
          if (stylesheets) stylesheetObservations.push({ compilation, value: stylesheets });
          if (isDevelopment && name === 'client') {
            for (const entryName of Object.keys(entry)) {
              const file = `solid-module-manifest.${encodeURIComponent(entryName)}.json`;
              const asset = compilation.getAsset(file);
              if (!asset) continue;
              const emitted = asset.source.source();
              const bytes = typeof emitted === 'string' ? Buffer.from(emitted) : emitted;
              const source = bytes.toString('utf8');
              if (!Buffer.from(source).equals(bytes))
                throw new Error('Development native module manifest must be UTF-8 JSON bytes');
              const manifest: unknown = JSON.parse(source);
              if (
                !manifest ||
                typeof manifest !== 'object' ||
                !('modules' in manifest) ||
                !manifest.modules ||
                typeof manifest.modules !== 'object' ||
                Array.isArray(manifest.modules)
              )
                throw new Error('Development native module manifest is malformed');
              for (const [key, module] of Object.entries(manifest.modules)) {
                if (key === '_base') continue;
                if (
                  !module ||
                  typeof module !== 'object' ||
                  !('file' in module) ||
                  typeof module.file !== 'string' ||
                  !module.file ||
                  !compilation.getAsset(module.file)
                )
                  throw new Error('Development native module manifest references an absent actual compiler asset');
              }
              nativeModuleManifests.push({
                file,
                sha256: createHash('sha256').update(bytes).digest('hex'),
                size: bytes.byteLength,
                source,
              });
            }
          }
          observedEnvironments.push({
            name,
            target: environment.config.output.target,
            mode: environment.config.mode,
            distPath: environment.distPath,
            entry,
            configSourceEntry,
            compiledEntryNames,
            compiledEntryFiles,
            compilationHash: compilation.hash,
            hasErrors: false,
            errorCount: 0,
            compiledModuleGraph: await compiledModuleGraph(compilation),
            ...(stylesheets ? { compiledStylesheets: stylesheets } : {}),
            configuredPlugins: await configuredPlugins(environment.config.plugins, 'environment.config.plugins'),
            ...(isDevelopment ? { nativeModuleManifests } : {}),
          });
        }
        if (consumed.size !== results.length) throw new Error('Compiler observation found an unmatched compilation');
        const wave = isDevelopment ? await developmentObservation(distPath, observedEnvironments) : undefined;
        if (wave && (wave.renderer !== 'react') !== nativeDevelopmentLayout)
          throw new Error('Development observation renderer disagrees with the actual compiler output layout');
        const development = wave?.development;
        if (wave && wave.renderer !== 'react') {
          const server = observedEnvironments.find((environment) => environment.name === 'server');
          if (!server) throw new Error('Development observation requires its server environment');
          for (const roots of Object.values(server.entry)) {
            const generated = roots.filter((root) => path.basename(root) === 'index.server.ts');
            if (generated.length !== 1 || !generated[0])
              throw new Error('Development observation requires the actual generated native server root');
            addSource(path.join(path.dirname(generated[0]), 'routes.server.ts'), 'environment:server:route-ir');
          }
        }
        if (development) addSource(development.metadataFile, 'development-manifest');
        const sourceInventory: NativeCompilerObservation['sourceInventory'] = [];
        for (const [source, roles] of [...inventory].sort(([a], [b]) => a.localeCompare(b))) {
          const realSource = await fs.realpath(source);
          withinRoot(rootPath, realSource);
          if (!(await fs.stat(realSource)).isFile())
            throw new Error(`Compiler observation source is not a file: ${source}`);
          const bytes = await fs.readFile(realSource);
          sourceInventory.push({
            path: path.relative(rootPath, source).split(path.sep).join('/'),
            sha256: createHash('sha256').update(bytes).digest('hex'),
            size: bytes.byteLength,
            roles: [...roles].sort(),
          });
        }
        if (
          development &&
          createHash('sha256')
            .update(await fs.readFile(development.metadataFile))
            .digest('hex') !== development.metadataSha256
        )
          throw new Error('Development wave changed while its compiler observation was captured');
        for (const { compilation, value } of stylesheetObservations)
          if (!isDeepStrictEqual(compiledStylesheets(compilation), value))
            throw new Error('Compiler observation stylesheet closure changed during capture');
        await persistReceipt(isDevelopment ? path.join(distPath, developmentDirectory) : distPath, {
          schema: 'ultramodern-native-compiler-observation',
          version: 1,
          observer: {
            event,
            order: 'post',
            rsbuildVersion: api.context.version,
            sourceFile: observerSource,
          },
          rootPath,
          distPath,
          configFile: api.context.configFile ?? null,
          configFileDependencies: [...api.context.configFileDependencies],
          configuredPlugins: await configuredPlugins(
            api.getNormalizedConfig().plugins,
            'api.getNormalizedConfig().plugins',
          ),
          environments: observedEnvironments,
          sourceInventory,
          ...(development ? { development } : {}),
        });
      };
      const afterBuild: OnAfterBuildFn = (input) => capture('onAfterBuild', input);
      const afterDevelopment: OnAfterDevCompileFn = (input) => capture('onDevCompileDone', input);
      api.onAfterBuild({ order: 'post', handler: afterBuild });
      // Rsbuild 2.2.11 calls its pre/default/post callback groups serially and
      // awaits each. The owning native direct pre hook commits its checkpoint
      // before this direct post hook; CLI forwarding is not our authority.
      api.onDevCompileDone({ order: 'post', handler: afterDevelopment });
    },
  };
}
