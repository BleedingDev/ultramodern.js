import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type RendererRouterBindings,
  validateRendererRouterBindings,
} from '@modern-js/backend-federation-contracts';
import type { Renderer } from '@modern-js/renderer-core';
import type { ObservedConfigSourceInputs } from './config-evaluator/observed-inputs';
import {
  assertConfigSourceSnapshotUnchanged,
  type ConfigSourceSnapshot,
  captureConfigSourceSnapshot,
} from './config-evaluator/source-snapshot';
import type {
  ConfigEvaluatorRequest,
  ConfigEvaluatorResult,
} from './config-evaluator/types';

export type {
  ObservedConfigSourceInput,
  ObservedConfigSourceInputs,
  ObservedConfigSourceOperation,
  ObservedPackageMetadataInput,
} from './config-evaluator/observed-inputs';

export {
  assertConfigSourceSnapshotUnchanged,
  CONFIG_SOURCE_SNAPSHOT_EXCLUSIONS,
  type ConfigSourceSnapshot,
  type ConfigSourceState,
  captureConfigSourceSnapshot,
} from './config-evaluator/source-snapshot';

export interface LoadUltramodernConfigSnapshotOptions {
  appDirectory: string;
  configFile?: string;
  env: string;
  command: string;
  /** Installed package roots belonging to the caller's framework cohort. */
  dependencyRoots?: readonly string[];
  /** Authored source trees; dependency and build directories are excluded. */
  sourceRoots?: readonly string[];
  /** Shared transaction inputs, including paths which do not yet exist. */
  extraInputs?: readonly string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface UltramodernConfigSnapshot {
  renderer: Renderer;
  entries: readonly { entryName: string; isMainEntry: boolean }[];
  primaryEntryName: string;
  routerBindings: RendererRouterBindings;
  consumedSourceInputs: ObservedConfigSourceInputs;
  sourceSnapshot: ConfigSourceSnapshot;
  assertUnchanged(): void;
}

function findFrameworkRoot(moduleFile: string): {
  directory: string;
  name: string;
} {
  let directory = path.dirname(moduleFile);
  for (;;) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (
        typeof value.name === 'string' &&
        value.name.length > 0 &&
        value.exports?.['./config-evaluator'] &&
        value.exports?.['./config-evaluator-worker']
      ) {
        return { directory, name: value.name };
      }
      throw new Error(
        `Invalid owning UltraModern evaluator package: ${manifest}`,
      );
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(
        'Cannot find the installed UltraModern evaluator package',
      );
    }
    directory = parent;
  }
}

function isResult(value: unknown): value is ConfigEvaluatorResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as ConfigEvaluatorResult;
  return (
    ['react', 'solid', 'octane'].includes(result.renderer) &&
    typeof result.primaryEntryName === 'string' &&
    result.primaryEntryName.length > 0 &&
    Array.isArray(result.entries) &&
    result.entries.length > 0 &&
    result.entries.every(
      entry =>
        typeof entry?.entryName === 'string' &&
        entry.entryName.length > 0 &&
        typeof entry.isMainEntry === 'boolean',
    ) &&
    new Set(result.entries.map(entry => entry.entryName)).size ===
      result.entries.length &&
    result.entries.some(entry => entry.entryName === result.primaryEntryName) &&
    isObservedInputs(result.consumedSourceInputs) &&
    result.routerBindings !== undefined &&
    validateRendererRouterBindings(
      result.routerBindings,
      result.entries.map(entry => entry.entryName),
      'routerBindings',
      result.renderer,
    ).ok
  );
}

function isObservedInputs(value: unknown): value is ObservedConfigSourceInputs {
  if (!value || typeof value !== 'object') return false;
  const inputs = value as ObservedConfigSourceInputs;
  return (
    inputs.kind === 'observed-config-source-inputs' &&
    inputs.version === 1 &&
    Array.isArray(inputs.observations) &&
    Array.isArray(inputs.packageMetadata) &&
    new Set(
      inputs.packageMetadata.map(input => `${input?.field}:${input?.path}`),
    ).size === inputs.packageMetadata.length &&
    inputs.packageMetadata.every(
      input =>
        input &&
        typeof input === 'object' &&
        Object.keys(input).length === 4 &&
        ['path', 'canonicalPath', 'field', 'value'].every(key =>
          Object.hasOwn(input, key),
        ) &&
        typeof input.path === 'string' &&
        path.isAbsolute(input.path) &&
        path.normalize(input.path) === input.path &&
        path.basename(input.path) === 'package.json' &&
        typeof input.canonicalPath === 'string' &&
        path.isAbsolute(input.canonicalPath) &&
        path.normalize(input.canonicalPath) === input.canonicalPath &&
        ['name', 'type'].includes(input.field) &&
        typeof input.value === 'string' &&
        input.value.length > 0 &&
        inputs.packageMetadata.every(
          other =>
            other?.canonicalPath !== input.canonicalPath ||
            other?.field !== input.field ||
            other?.value === input.value,
        ),
    ) &&
    inputs.observations.every(
      observation =>
        observation &&
        typeof observation === 'object' &&
        typeof observation.path === 'string' &&
        path.isAbsolute(observation.path) &&
        typeof observation.canonicalPath === 'string' &&
        path.isAbsolute(observation.canonicalPath) &&
        [
          'content',
          'module',
          'metadata',
          'existence',
          'entry-kind',
          'directory',
        ].includes(observation.operation) &&
        (observation.operation !== 'existence' ||
          path.basename(observation.path) === 'package.json') &&
        typeof observation.existed === 'boolean',
    )
  );
}

function isSerializedError(value: unknown): value is {
  name: string;
  message: string;
  stack?: string;
  code?: string;
} {
  if (!value || typeof value !== 'object') return false;
  const error = value as Record<string, unknown>;
  return (
    typeof error.name === 'string' &&
    typeof error.message === 'string' &&
    (error.stack === undefined || typeof error.stack === 'string') &&
    (error.code === undefined || typeof error.code === 'string')
  );
}

function evaluateInChild(
  workerFile: string,
  request: ConfigEvaluatorRequest,
  timeoutMs: number,
  environment: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<ConfigEvaluatorResult> {
  return new Promise((resolve, reject) => {
    const child = fork(workerFile, [], {
      cwd: request.options.appDirectory,
      execArgv: [],
      env: environment,
      serialization: 'json',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      signal,
    });
    let result: ConfigEvaluatorResult | undefined;
    let failure: Error | undefined;
    let diagnostics = '';
    let forceExit: ReturnType<typeof setTimeout> | undefined;
    const terminate = (error: Error) => {
      failure ??= error;
      child.kill('SIGTERM');
      forceExit ??= setTimeout(() => child.kill('SIGKILL'), 1000);
      forceExit.unref();
    };
    const timeout = setTimeout(
      () =>
        terminate(
          new Error(`UltraModern config evaluation exceeded ${timeoutMs}ms`),
        ),
      timeoutMs,
    );
    timeout.unref();
    const collect = (chunk: Buffer) => {
      diagnostics = `${diagnostics}${chunk.toString()}`.slice(-65536);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', error => terminate(error));
    child.on('message', (value: unknown) => {
      const message =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)
          : undefined;
      if (message?.kind === 'error' && isSerializedError(message.error)) {
        const error = new Error(message.error.message);
        error.name = message.error.name;
        if (message.error.stack) error.stack = message.error.stack;
        if (message.error.code) {
          Object.assign(error, { code: message.error.code });
        }
        terminate(error);
      } else if (message?.kind === 'result' && isResult(message.result)) {
        if (result) {
          terminate(
            new Error('UltraModern config evaluator sent duplicate results'),
          );
        } else {
          result = message.result;
        }
      } else {
        terminate(
          new Error('UltraModern config evaluator sent invalid metadata'),
        );
      }
    });
    child.once('close', (code, childSignal) => {
      clearTimeout(timeout);
      if (forceExit) clearTimeout(forceExit);
      if (failure) {
        reject(failure);
      } else if (code !== 0 || childSignal || !result) {
        reject(
          new Error(
            `UltraModern config evaluator exited without metadata (${childSignal ?? code}).${diagnostics ? `\n${diagnostics}` : ''}`,
          ),
        );
      } else {
        resolve(result);
      }
    });
    child.send(request, error => {
      if (error) terminate(error);
    });
  });
}

/**
 * Evaluate original config and entry hooks once in the owning framework process.
 * Only metadata crosses IPC; the child exits before this function returns.
 * The snapshot proves unchanged declared sources, not a complete import readset.
 */
export async function loadUltramodernConfigSnapshot(
  options: LoadUltramodernConfigSnapshotOptions,
): Promise<UltramodernConfigSnapshot> {
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: options.env,
    // This short-lived source evaluation has no shared transpile output cache.
    // Jiti still reads and transforms the original files under observation.
    JITI_FS_CACHE: 'false',
  };
  if (childEnvironment.NODE_OPTIONS) {
    throw new Error(
      'UltraModern config evaluator does not support nonempty NODE_OPTIONS; invoke it from a clean Node process',
    );
  }
  const timeoutMs = options.timeoutMs ?? 120000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
    throw new Error(
      'Config evaluation timeoutMs must be between 1 and 2147483647',
    );
  }
  options.signal?.throwIfAborted();
  const appDirectory = path.resolve(options.appDirectory);
  // The CommonJS owning loader retains its existing Jiti evaluation semantics.
  const moduleFile =
    process.env.MODERN_LIB_FORMAT === 'esm'
      ? fileURLToPath(import.meta.url)
      : __filename;
  const requireFrom = createRequire(moduleFile);
  const framework = findFrameworkRoot(moduleFile);
  const workerFile = requireFrom.resolve(
    `${framework.name}/config-evaluator-worker`,
  );
  const frameworkRoot = framework.directory;
  const dependencyRoots = [
    ...new Set([
      ...(options.dependencyRoots ?? []).map(root => path.resolve(root)),
      frameworkRoot,
    ]),
  ];
  const configFile = options.configFile
    ? path.resolve(appDirectory, options.configFile)
    : undefined;
  const sourceRoots = [
    ...new Set([
      appDirectory,
      ...(options.sourceRoots ?? []).map(root => path.resolve(root)),
      ...(configFile ? [path.dirname(configFile)] : []),
    ]),
  ];
  const sourceSnapshot = captureConfigSourceSnapshot({
    sourceRoots,
    extraInputs: [
      ...(options.extraInputs ?? []).map(input => path.resolve(input)),
      ...dependencyRoots.map(root => path.join(root, 'package.json')),
    ],
  });
  const result = await evaluateInChild(
    workerFile,
    {
      kind: 'evaluate',
      options: {
        appDirectory,
        configFile,
        env: options.env,
        command: options.command,
        sourceRoots,
        dependencyRoots,
        sourceSnapshot,
      },
    },
    timeoutMs,
    childEnvironment,
    options.signal,
  );
  assertConfigSourceSnapshotUnchanged(sourceSnapshot);
  for (const input of result.consumedSourceInputs.packageMetadata) {
    const original = sourceSnapshot.states.find(
      state =>
        state.kind === 'file' &&
        (state.path === input.canonicalPath ||
          state.resolvedPath === input.canonicalPath),
    );
    const content = fs.readFileSync(input.canonicalPath);
    if (
      original?.kind !== 'file' ||
      createHash('sha256').update(content).digest('hex') !== original.sha256
    )
      throw new Error(
        `Automatic package metadata changed from its captured source: ${input.path}`,
      );
    const manifest: unknown = JSON.parse(content.toString('utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
      throw new Error(
        `Invalid automatic package metadata source: ${input.path}`,
      );
    const effective =
      input.field === 'name'
        ? 'name' in manifest
          ? manifest.name
          : undefined
        : ('type' in manifest ? manifest.type : undefined) || 'commonjs';
    if (effective !== input.value)
      throw new Error(
        `Automatic package ${input.field} disagrees with its captured source: ${input.path}`,
      );
  }
  const consumedSourceInputs: ObservedConfigSourceInputs = Object.freeze({
    kind: 'observed-config-source-inputs',
    version: 1,
    observations: Object.freeze(
      result.consumedSourceInputs.observations.map(input =>
        Object.freeze({ ...input }),
      ),
    ),
    packageMetadata: Object.freeze(
      result.consumedSourceInputs.packageMetadata.map(input =>
        Object.freeze({ ...input }),
      ),
    ),
  });
  return {
    ...result,
    consumedSourceInputs,
    sourceSnapshot,
    assertUnchanged: () => assertConfigSourceSnapshotUnchanged(sourceSnapshot),
  };
}
