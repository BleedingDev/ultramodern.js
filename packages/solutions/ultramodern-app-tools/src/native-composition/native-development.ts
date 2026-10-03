import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { RendererBuildIdentities } from '@modern-js/app-tools-extensions/renderer-build-identity';
import {
  assertRendererIdentity,
  type RendererIdentity,
} from '@modern-js/renderer-core/identity';
import { validateNativeClientAssetManifest } from '@modern-js/renderer-core/server';
import { mime } from '@modern-js/utils';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import {
  assertRendererBuildInputsUnchanged,
  RENDERER_BUILD_MANIFEST_FILE,
  RENDERER_DEVELOPMENT_DIRECTORY,
  type RendererDevelopmentBuildManifest,
  validateRendererDevelopmentBuildManifest,
} from './native-build-manifest';
import type { NativeDevelopmentSnapshot } from './native-server-plugin';
import type { RendererBuildProfile } from './renderer-profile';

export interface NativeDevelopmentOptions {
  readonly renderer: 'solid' | 'octane';
  readonly profile: RendererBuildProfile;
  readonly distDirectory: string;
  readonly getSessionIdentities: () => RendererBuildIdentities;
  readonly resolveWaveInputs: () => Promise<RendererBuildIdentities>;
}

export function nativeDevelopmentOutputDirectory(
  distDirectory: string,
  name: string,
): string {
  if (
    !name ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name === '.' ||
    name === '..' ||
    /^[a-z]:/iu.test(name) ||
    [
      'bundles',
      'compilations',
      RENDERER_BUILD_MANIFEST_FILE,
      '.native-development-owner.json',
    ].includes(name)
  )
    throw new Error(
      `Unsafe or conflicting native development environment name: ${name}`,
    );
  return path.join(
    distDirectory,
    RENDERER_DEVELOPMENT_DIRECTORY,
    name === 'server' ? 'bundles' : name,
  );
}

interface RetainedAsset {
  readonly bytes: Buffer;
  readonly digest: string;
  readonly contentType: string;
}

interface Wave {
  readonly epoch: number;
  readonly inputs: RendererBuildIdentities;
}

interface ReadyGeneration {
  readonly metadata: RendererDevelopmentBuildManifest;
  readonly entries: ReadonlyMap<string, NativeDevelopmentSnapshot>;
}

interface OwnedPath {
  readonly device: number;
  readonly inode: number;
  readonly digest?: string;
}

/** Compiler asset paths are relative names, not arbitrary filesystem inputs. */
function assetName(name: string): string {
  if (
    !name ||
    name.includes('\\') ||
    name.includes('\0') ||
    /[?#]/u.test(name) ||
    /^[a-z]:/iu.test(name) ||
    path.posix.isAbsolute(name) ||
    name.split('/').some(part => !part || part === '.' || part === '..')
  )
    throw new Error(`Unsafe native development compiler asset: ${name}`);
  return name;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function freezeJSON<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJSON(child);
    Object.freeze(value);
  }
  return value;
}

/** Read the actual compiler output filesystem. Disk is never a fallback. */
function emittedBytes(result: Rspack.Stats, name: string): Promise<Buffer> {
  assetName(name);
  if (!result.compilation.getAsset(name))
    throw new Error(`Native compilation did not emit ${name}`);
  const output = result.compilation.outputOptions.path;
  const filesystem = result.compilation.compiler.outputFileSystem;
  if (!output || !filesystem)
    throw new Error('Native development compilation has no output filesystem');
  return new Promise((resolve, reject) => {
    filesystem.readFile(path.join(output, name), (error, bytes) => {
      if (error) return reject(error);
      if (!bytes)
        return reject(new Error(`Missing emitted native asset ${name}`));
      resolve(Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(bytes));
    });
  });
}

async function safeDirectory(directory: string): Promise<void> {
  const parent = path.dirname(directory);
  if (parent !== directory) await safeDirectory(parent);
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(
        `Native development checkpoint directory conflicts: ${directory}`,
      );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error;
    await fs.mkdir(directory);
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(
        'Native development checkpoint directory changed during creation',
      );
  }
}

async function writeExclusive(
  directory: string,
  name: string,
  bytes: Buffer,
): Promise<void> {
  const filename = path.join(directory, assetName(name));
  await safeDirectory(path.dirname(filename));
  await fs.writeFile(filename, bytes, { flag: 'wx' });
  const stat = await fs.lstat(filename);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    sha256(await fs.readFile(filename)) !== sha256(bytes)
  )
    throw new Error(
      'Native development checkpoint bytes changed before validation',
    );
}

/** A session identity survives HMR; the compiler wave and its byte closure do not. */
export class NativeDevelopment {
  readonly plugin: RsbuildPlugin;
  private readonly directory: string;
  private readonly checkpointRoot: string;
  private readonly manifestFile: string;
  private readonly lockFile: string;
  private readonly lockBytes: Buffer;
  private lockOwner: OwnedPath | undefined;
  private checkpointOwner: OwnedPath | undefined;
  private manifestOwner: OwnedPath | undefined;
  private ownership: Promise<void> | undefined;
  private publicationClaimed = false;
  private epoch = 0;
  private generation = 0;
  private closed = false;
  private ready: ReadyGeneration | undefined;
  private failure: unknown;
  private failed = false;
  private wave: Wave | undefined;
  private readonly retained = new Map<string, RetainedAsset>();
  private readonly mutableClientAssets = new Set([
    'renderer-assets.json',
    'octane-client-build.json',
  ]);
  private readonly waiters = new Set<() => void>();
  private invalidation = Promise.resolve();
  private preparation: Promise<void> | undefined;
  private completion: Promise<void> | undefined;
  private devServerOrigin: string | undefined;

  constructor(private readonly options: NativeDevelopmentOptions) {
    this.directory = path.join(
      options.distDirectory,
      RENDERER_DEVELOPMENT_DIRECTORY,
    );
    this.manifestFile = path.join(this.directory, RENDERER_BUILD_MANIFEST_FILE);
    this.lockFile = path.join(this.directory, '.native-development-owner.json');
    const session = randomUUID();
    this.lockBytes = Buffer.from(JSON.stringify({ session, pid: process.pid }));
    this.checkpointRoot = path.join(this.directory, 'compilations', session);
    this.plugin = {
      name: `ultramodern:${options.renderer}:development-authority`,
      setup: api => {
        api.modifyEnvironmentConfig((config, { name }) => {
          return {
            ...config,
            output: {
              ...config.output,
              distPath: {
                ...config.output.distPath,
                root: nativeDevelopmentOutputDirectory(
                  options.distDirectory,
                  name,
                ),
              },
              ...(name === 'client'
                ? {
                    filename: {
                      ...config.output?.filename,
                      js: '[name].[contenthash].js',
                      css: '[name].[contenthash].css',
                    },
                  }
                : {}),
            },
          };
        });
        api.modifyRspackConfig((config, { environment }) => {
          if (environment.name !== 'client') return;
          // A completed native generation owns every emitted client byte.
          // Source-on-demand proxies could activate a newer application under
          // an older document. Keep dynamic chunks and native lazy loading,
          // while compiling the selected client graph before publication.
          if (config.lazyCompilation)
            config.lazyCompilation = {
              ...(config.lazyCompilation === true
                ? {}
                : config.lazyCompilation),
              entries: false,
              imports: false,
            };
          config.output ??= {};
          config.output.filename = '[name].[contenthash].js';
          config.output.chunkFilename = '[name].[contenthash].js';
          config.output.cssFilename = '[name].[contenthash].css';
          config.output.cssChunkFilename = '[name].[contenthash].css';
        });
        api.modifyRsbuildConfig(config => {
          // This plugin is registered only by the actual native dev command.
          // The hook runs before Rsbuild fills mode from ambient NODE_ENV.
          if (config.mode && config.mode !== 'development')
            throw new Error(
              'Native dev cannot use an explicitly authored production compiler mode',
            );
          for (const environment of Object.values(config.environments ?? {}))
            if (
              'mode' in environment &&
              environment.mode !== undefined &&
              environment.mode !== 'development'
            )
              throw new Error(
                'Native dev cannot use an explicitly authored non-development environment mode',
              );
          config.mode = 'development';
          const previous = config.dev?.setupMiddlewares;
          const retain: NonNullable<
            NonNullable<typeof config.dev>['setupMiddlewares']
          > = middlewares => {
            middlewares.unshift((request, response, next) => {
              if (request.method !== 'GET' && request.method !== 'HEAD')
                return next();
              let pathname: string;
              try {
                pathname = new URL(
                  request.url ?? '/',
                  'http://native-dev.invalid',
                ).pathname;
              } catch {
                return next();
              }
              const asset = this.retained.get(pathname);
              if (!asset) return next();
              response.setHeader('Content-Type', asset.contentType);
              response.setHeader('Content-Length', asset.bytes.length);
              response.setHeader('Cache-Control', 'no-store');
              response.end(request.method === 'HEAD' ? undefined : asset.bytes);
            });
          };
          config.dev = {
            ...config.dev,
            setupMiddlewares: [
              retain,
              ...(Array.isArray(previous)
                ? previous
                : previous
                  ? [previous]
                  : []),
            ],
          };
        });
        api.onAfterCreateCompiler(({ compiler, environments }) => {
          if (api.context.action !== 'dev')
            throw new Error(
              'Native development authority requires the actual dev server lifecycle',
            );
          const devServer = api.context.devServer;
          if (!devServer)
            throw new Error(
              'Native development authority requires the actual dev server address',
            );
          const hostname =
            devServer.hostname === '0.0.0.0' ? 'localhost' : devServer.hostname;
          this.devServerOrigin = new URL(
            `${devServer.https ? 'https' : 'http'}://${hostname}:${devServer.port}`,
          ).origin;
          const compilers =
            'compilers' in compiler ? compiler.compilers : [compiler];
          for (const filename of Object.values(
            environments.client?.htmlPaths ?? {},
          ))
            this.mutableClientAssets.add(filename);
          for (const entryName of Object.keys(
            options.getSessionIdentities().identities,
          ))
            this.mutableClientAssets.add(
              `${options.renderer}-module-manifest.${encodeURIComponent(entryName)}.json`,
            );
          for (const candidate of compilers) {
            if (
              !candidate.options.name ||
              candidate.options.output.path !==
                nativeDevelopmentOutputDirectory(
                  options.distDirectory,
                  candidate.options.name,
                )
            )
              throw new Error(
                'Native development compiler output must remain in its isolated owning environment directory',
              );
            if (candidate.options.mode !== 'development')
              throw new Error(
                'Native development authority requires actual development compiler mode',
              );
            if (
              candidate.options.name === 'client' &&
              candidate.options.lazyCompilation &&
              (candidate.options.lazyCompilation.entries !== false ||
                candidate.options.lazyCompilation.imports !== false)
            )
              throw new Error(
                'Native development requires the complete selected client graph to compile before publication',
              );
            candidate.hooks.invalid.tap('UltraModernNativeDevelopment', () =>
              this.invalidate(),
            );
            candidate.hooks.failed.tap('UltraModernNativeDevelopment', error =>
              this.fail(error),
            );
          }
        });
        api.onBeforeDevCompile({
          order: 'pre',
          handler: async () => {
            let preparation = this.preparation;
            if (!preparation) {
              this.invalidate();
              preparation = this.prepareWave();
              this.preparation = preparation;
            }
            try {
              await preparation;
            } finally {
              if (this.preparation === preparation)
                this.preparation = undefined;
            }
          },
        });
        api.onDevCompileDone({
          order: 'pre',
          handler: async ({ stats }) => {
            const epoch = this.wave?.epoch ?? this.epoch;
            const completion = this.complete(stats);
            this.completion = completion;
            try {
              await completion;
            } catch (error) {
              if (this.closed || epoch !== this.epoch) return;
              this.fail(error);
              // Throwing from the done hook closes the native MultiCompiler watcher.
              api.logger.error(
                'Native development publication failed; requests remain unavailable.',
                error,
              );
            } finally {
              if (this.completion === completion) this.completion = undefined;
            }
          },
        });
        api.onCloseDevServer(() => this.close());
      },
    };
  }

  private notify(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  private async verifyOwned(
    filename: string,
    owner: OwnedPath,
    directory = false,
  ): Promise<void> {
    const stat = await fs.lstat(filename);
    if (
      stat.isSymbolicLink() ||
      stat.dev !== owner.device ||
      stat.ino !== owner.inode ||
      (directory ? !stat.isDirectory() : !stat.isFile()) ||
      (owner.digest && sha256(await fs.readFile(filename)) !== owner.digest)
    )
      throw new Error(
        `Native development owned path was replaced or changed: ${filename}`,
      );
  }

  private ensureOwnership(): Promise<void> {
    return (this.ownership ??= (async () => {
      await safeDirectory(this.directory);
      const lock = await fs.open(this.lockFile, 'wx').catch(cause => {
        throw new Error(
          `Native development output is already claimed: ${this.lockFile}. Stop the existing dev session or clear its stale owned outputs explicitly.`,
          { cause },
        );
      });
      try {
        const stat = await lock.stat();
        this.lockOwner = {
          device: stat.dev,
          inode: stat.ino,
        };
        await lock.writeFile(this.lockBytes);
        this.lockOwner = {
          ...this.lockOwner,
          digest: sha256(this.lockBytes),
        };
      } finally {
        await lock.close();
      }
      const existing = await fs.lstat(this.manifestFile).catch(error => {
        if (error?.code === 'ENOENT') return undefined;
        throw error;
      });
      if (existing)
        throw new Error(
          `Native development metadata already exists and is not owned by this session: ${this.manifestFile}`,
        );
      this.publicationClaimed = true;
      await safeDirectory(path.dirname(this.checkpointRoot));
      await fs.mkdir(this.checkpointRoot);
      const checkpoint = await fs.lstat(this.checkpointRoot);
      this.checkpointOwner = { device: checkpoint.dev, inode: checkpoint.ino };
    })());
  }

  private async removeOwnedManifest(): Promise<void> {
    if (!this.publicationClaimed) return;
    const existing = await fs.lstat(this.manifestFile).catch(error => {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!existing) {
      this.manifestOwner = undefined;
      return;
    }
    if (!this.manifestOwner)
      throw new Error(
        `Native development metadata conflicts with a foreign file: ${this.manifestFile}`,
      );
    await this.verifyOwned(this.manifestFile, this.manifestOwner);
    await fs.unlink(this.manifestFile);
    this.manifestOwner = undefined;
  }

  private assertCurrent(epoch: number): void {
    if (this.closed || epoch !== this.epoch)
      throw new Error('Native development compilation is no longer active');
  }

  private async prepareWave(): Promise<void> {
    for (;;) {
      if (this.closed) return;
      if (this.failed) throw this.failure;
      const epoch = this.epoch;
      try {
        await this.invalidation;
        if (this.closed) return;
        if (epoch !== this.epoch) continue;
        const inputs = await this.options.resolveWaveInputs();
        if (this.closed) return;
        // Each child can invalidate the shared MultiCompiler preparation.
        // Discard superseded inputs before any compiler starts its next wave.
        if (epoch !== this.epoch) continue;
        this.assertSessionGraph(inputs);
        this.wave = { epoch, inputs };
        return;
      } catch (error) {
        if (this.closed) return;
        if (epoch !== this.epoch) continue;
        this.fail(error);
        throw error;
      }
    }
  }

  private assertSessionGraph(inputs: RendererBuildIdentities): void {
    const session = this.options.getSessionIdentities();
    if (
      inputs.cacheAllowed ||
      inputs.promotable ||
      session.cacheAllowed ||
      session.promotable
    )
      throw new Error('Native development inputs cannot be cached or promoted');
    for (const key of [
      'profileDigest',
      'compilerDigest',
      'frameworkCohortDigest',
      'routerBindings',
    ] as const)
      if (!isDeepStrictEqual(inputs[key], session[key]))
        throw new Error(
          `Native development ${key} changed; restart the owning CLI graph`,
        );
    if (
      !isDeepStrictEqual(
        Object.keys(inputs.identities).sort(),
        Object.keys(session.identities).sort(),
      )
    )
      throw new Error(
        'Native development entry registry changed; restart the owning CLI graph',
      );
  }

  private invalidate(): void {
    if (this.closed) return;
    this.epoch++;
    this.ready = undefined;
    this.failure = undefined;
    this.failed = false;
    this.wave = undefined;
    const epoch = this.epoch;
    this.invalidation = this.invalidation
      .catch(() => {})
      .then(async () => {
        await this.ensureOwnership();
        await this.verifyOwned(this.lockFile, this.lockOwner!);
        await this.removeOwnedManifest();
      });
    this.invalidation.catch(error => {
      if (!this.closed && epoch === this.epoch) this.fail(error);
    });
  }

  private fail(error: unknown): void {
    if (this.closed) return;
    this.epoch++;
    this.ready = undefined;
    this.failure = error;
    this.failed = true;
    this.wave = undefined;
    this.invalidation = this.invalidation
      .catch(() => {})
      .then(async () => {
        await this.removeOwnedManifest();
      });
    this.invalidation.catch(() => {});
    this.notify();
  }

  async resolveSnapshot(
    identity: RendererIdentity,
    signal: AbortSignal,
  ): Promise<NativeDevelopmentSnapshot> {
    for (;;) {
      if (signal.aborted)
        throw signal.reason ?? new Error('Native development request aborted');
      if (this.closed) throw new Error('Native development compiler is closed');
      if (this.failed) throw this.failure;
      if (this.ready) {
        const snapshot = this.ready.entries.get(identity.entryName);
        if (!snapshot)
          throw new Error(
            `Native development has no entry ${identity.entryName}`,
          );
        assertRendererIdentity(snapshot.manifest.rendererIdentity, identity);
        return snapshot;
      }
      await new Promise<void>((resolve, reject) => {
        const resumed = () => {
          signal.removeEventListener('abort', aborted);
          resolve();
        };
        const aborted = () => {
          this.waiters.delete(resumed);
          reject(
            signal.reason ?? new Error('Native development request aborted'),
          );
        };
        this.waiters.add(resumed);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
      });
    }
  }

  private async complete(
    stats: Rspack.Stats | Rspack.MultiStats,
  ): Promise<void> {
    const wave = this.wave;
    if (!wave)
      throw new Error('Native development completion has no owning input wave');
    this.assertCurrent(wave.epoch);
    if (stats.hasErrors())
      throw new Error('Native development compilation failed');
    const results = 'stats' in stats ? stats.stats : [stats];
    const names = results.map(result => result.compilation.name);
    if (names.some(name => !name) || new Set(names).size !== names.length)
      throw new Error(
        'Native development requires unique actual compiler names',
      );
    const client = results.find(result => result.compilation.name === 'client');
    const server = results.find(result => result.compilation.name === 'server');
    if (
      !client ||
      !server ||
      !client.compilation.hash ||
      !server.compilation.hash
    )
      throw new Error(
        'Native development requires completed client and server compilations',
      );
    if (
      client.compilation.compiler.options.mode !== 'development' ||
      server.compilation.compiler.options.mode !== 'development'
    )
      throw new Error(
        'Native development cannot publish a production compilation',
      );
    const session = this.options.getSessionIdentities();
    await this.verifyOwned(this.lockFile, this.lockOwner!);
    await this.verifyOwned(this.checkpointRoot, this.checkpointOwner!, true);
    const generation = this.generation + 1;
    const checkpoint = path.join(
      this.checkpointRoot,
      `${generation}-${wave.epoch}-${server.compilation.hash}`,
    );
    await safeDirectory(path.dirname(checkpoint));
    await fs.mkdir(checkpoint);
    const serverRoot = path.join(checkpoint, 'server');
    const serverAssets = server.compilation.getAssets();
    if (!serverAssets.some(asset => asset.name === 'package.json'))
      throw new Error(
        'Native development requires the actual emitted server package format',
      );
    for (const asset of serverAssets)
      await writeExclusive(
        serverRoot,
        asset.name,
        await emittedBytes(server, asset.name),
      );
    const clientRoot = path.join(checkpoint, 'client');
    const retained = new Map<string, RetainedAsset>();
    const publicPath = client.compilation.outputOptions.publicPath;
    if (
      typeof publicPath !== 'string' ||
      publicPath === 'auto' ||
      publicPath.startsWith('//') ||
      /[?#\\\0]/u.test(publicPath)
    )
      throw new Error(
        'Native development immutable assets require an owning dev-server publicPath',
      );
    const prefix = new URL(publicPath, 'http://native-dev.invalid');
    if (
      prefix.username ||
      prefix.password ||
      (publicPath.startsWith('/')
        ? prefix.origin !== 'http://native-dev.invalid'
        : !/^https?:\/\//u.test(publicPath) ||
          prefix.origin !== this.devServerOrigin)
    )
      throw new Error(
        'Native development immutable assets must use the actual owning dev server origin',
      );
    for (const asset of client.compilation.getAssets()) {
      const bytes = await emittedBytes(client, asset.name);
      await writeExclusive(clientRoot, asset.name, bytes);
      // Exclude actual compiler document/manifest endpoints, retaining opaque
      // JSON/HTML resources just like the rest of the emitted client closure.
      if (
        this.mutableClientAssets.has(asset.name) ||
        asset.info.hotModuleReplacement
      )
        continue;
      const pathname = new URL(
        `${publicPath.endsWith('/') ? publicPath : `${publicPath}/`}${assetName(asset.name)}`,
        'http://native-dev.invalid',
      ).pathname;
      const digest = sha256(bytes);
      const previous = retained.get(pathname) ?? this.retained.get(pathname);
      if (previous && previous.digest !== digest)
        throw new Error(
          `Native development immutable asset filename conflicts: ${pathname}`,
        );
      retained.set(pathname, {
        bytes,
        digest,
        contentType: mime.contentType(asset.name) || 'application/octet-stream',
      });
    }
    const assets = JSON.parse(
      (await emittedBytes(client, 'renderer-assets.json')).toString(),
    );
    const entries = new Map<string, NativeDevelopmentSnapshot>();
    for (const [entryName, identity] of Object.entries(session.identities)) {
      const nativeManifest = JSON.parse(
        (
          await emittedBytes(
            client,
            `${this.options.renderer}-module-manifest.${encodeURIComponent(entryName)}.json`,
          )
        ).toString(),
      );
      if (this.options.renderer === 'solid')
        (
          await import('@modern-js/renderer-solid/manifest')
        ).validateSolidModuleManifest(nativeManifest, identity);
      else
        (
          await import('@modern-js/renderer-octane/manifest')
        ).validateOctaneModuleManifest(
          nativeManifest,
          identity,
          client.compilation.hash,
        );
      const chunk = server.compilation.entrypoints
        .get(entryName)
        ?.getEntrypointChunk();
      const files = chunk
        ? [...chunk.files].filter(filename => /\.[cm]?js$/u.test(filename))
        : [];
      if (files.length !== 1)
        throw new Error(
          `Native development entry ${entryName} requires one actual emitted server module`,
        );
      const loaded = await import(
        pathToFileURL(path.join(serverRoot, assetName(files[0]))).href
      );
      const exported = loaded.rendererIdentity ? loaded : loaded.default;
      assertRendererIdentity(exported?.rendererIdentity, identity);
      if (
        typeof exported?.nativeRequestHandler !== 'function' ||
        typeof exported?.nativeCSRRequestHandler !== 'function'
      )
        throw new Error(
          `Native development entry ${entryName} is missing its native transport handlers`,
        );
      entries.set(
        entryName,
        Object.freeze({
          manifest: Object.freeze({
            rendererIdentity: Object.freeze({ ...exported.rendererIdentity }),
            nativeRequestHandler: exported.nativeRequestHandler,
            nativeCSRRequestHandler: exported.nativeCSRRequestHandler,
            ...(typeof exported.nativeMatchRouteIds === 'function'
              ? { nativeMatchRouteIds: exported.nativeMatchRouteIds }
              : {}),
          }),
          assets: validateNativeClientAssetManifest(assets, identity),
          nativeManifest: freezeJSON(nativeManifest),
          ...(this.options.renderer === 'octane'
            ? { hydrationBuildId: client.compilation.hash }
            : {}),
        }),
      );
    }
    const completed = await this.options.resolveWaveInputs();
    this.assertCurrent(wave.epoch);
    this.assertSessionGraph(completed);
    assertRendererBuildInputsUnchanged(wave.inputs, completed);
    const metadata = validateRendererDevelopmentBuildManifest(
      {
        ...session,
        schema: 'ultramodern-renderer-build',
        version: 1,
        profile: this.options.profile,
        devCompilation: {
          compilationHashes: Object.fromEntries(
            results.map(result => {
              if (!result.compilation.name || !result.compilation.hash)
                throw new Error(
                  'Native development requires every actual named compiler hash',
                );
              return [result.compilation.name, result.compilation.hash];
            }),
          ),
          generation,
          sourceInputDigest: completed.inputDigest,
        },
      },
      this.options.profile,
    );
    // Serialize publication with invalidation/close so a stale in-flight rename
    // cannot resurrect metadata after a newer wave removed it.
    this.invalidation = this.invalidation.then(async () => {
      this.assertCurrent(wave.epoch);
      await this.verifyOwned(this.lockFile, this.lockOwner!);
      await this.verifyOwned(this.checkpointRoot, this.checkpointOwner!, true);
      const temporary = `${this.manifestFile}.${randomUUID()}.tmp`;
      let temporaryOwner: OwnedPath | undefined;
      const bytes = Buffer.from(JSON.stringify(metadata));
      try {
        const file = await fs.open(temporary, 'wx');
        try {
          const stat = await file.stat();
          temporaryOwner = { device: stat.dev, inode: stat.ino };
          await file.writeFile(bytes);
          temporaryOwner = { ...temporaryOwner, digest: sha256(bytes) };
        } finally {
          await file.close();
        }
        this.assertCurrent(wave.epoch);
        await this.verifyOwned(temporary, temporaryOwner);
        // Same-directory hard-link publication is atomic and refuses an
        // existing target. A foreign file created mid-wave is never replaced.
        await fs.link(temporary, this.manifestFile);
        this.manifestOwner = temporaryOwner;
        await this.verifyOwned(this.manifestFile, this.manifestOwner);
        this.assertCurrent(wave.epoch);
        for (const [url, asset] of retained) this.retained.set(url, asset);
        this.generation = generation;
        this.ready = { metadata, entries };
        this.notify();
      } finally {
        if (temporaryOwner) {
          await this.verifyOwned(temporary, temporaryOwner);
          await fs.unlink(temporary);
        }
      }
    });
    await this.invalidation;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.epoch++;
    this.ready = undefined;
    this.notify();
    await this.preparation?.catch(() => {});
    await this.completion?.catch(() => {});
    await this.invalidation.catch(() => {});
    await this.ownership?.catch(() => {});
    const cleanupErrors: unknown[] = [];
    try {
      await this.removeOwnedManifest();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (this.checkpointOwner) {
      try {
        await this.verifyOwned(this.checkpointRoot, this.checkpointOwner, true);
        await fs.rm(this.checkpointRoot, { recursive: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (this.lockOwner) {
      try {
        await this.verifyOwned(this.lockFile, this.lockOwner);
        await fs.unlink(this.lockFile);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    this.retained.clear();
    if (cleanupErrors.length)
      throw new AggregateError(
        cleanupErrors,
        'Native development cleanup refused changed owned outputs',
      );
  }
}
