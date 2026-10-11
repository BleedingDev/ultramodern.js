import { fork } from 'node:child_process';
import fs from 'node:fs';
import { createRequire, isBuiltin, registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { RendererRouterBindings } from '@modern-js/backend-federation-contracts';
import type { Renderer } from '@modern-js/renderer-core';
import { loadEnv } from '@rsbuild/core';
import {
  loadUltramodernConfigFile,
  resolveUltramodernEntryIdentities,
} from './config';

export interface UltramodernConfigMetadata {
  renderer: Renderer;
  entries: readonly { entryName: string; isMainEntry: boolean }[];
  primaryEntryName: string;
  routerBindings: RendererRouterBindings;
}

export interface LoadUltramodernConfigMetadataOptions {
  appDirectory: string;
  configFile?: string;
  env: string;
  command: string;
  /** Authored files under this root may use the fallbacks; default: the app. */
  sourceRoot?: string;
  /**
   * The app may be a staged copy of another workspace without its installed
   * packages. Imports the copy cannot resolve are resolved from the same
   * location in the original workspace.
   */
  stagedWorkspace?: { root: string; originalRoot: string };
  /** Packages whose dependencies satisfy imports the app has not installed. */
  fallbackPackageRoots?: readonly string[];
}

function inside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

function isMissingModule(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND';
}

/**
 * Resolve bare imports of authored app files that are not installed yet.
 * Installed packages keep Node's normal resolution.
 */
function registerFallbackResolution(
  sourceRoot: string,
  options: LoadUltramodernConfigMetadataOptions,
) {
  const packageRoots = options.fallbackPackageRoots ?? [];
  const staged = options.stagedWorkspace;
  if (!packageRoots.length && !staged) return undefined;
  let resolving = false;
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        const parentURL = context.parentURL;
        if (
          resolving ||
          !isMissingModule(error) ||
          !parentURL?.startsWith('file:') ||
          specifier.startsWith('.') ||
          specifier.includes(':') ||
          path.isAbsolute(specifier) ||
          isBuiltin(specifier)
        )
          throw error;
        const parent = fileURLToPath(parentURL);
        if (
          parent.split(path.sep).includes('node_modules') ||
          !inside(sourceRoot, parent)
        )
          throw error;
        const anchors = [
          ...(staged && inside(staged.root, parent)
            ? [
                path.join(
                  staged.originalRoot,
                  path.relative(staged.root, parent),
                ),
              ]
            : []),
          ...packageRoots.map(root => path.join(root, 'package.json')),
        ];
        const esm =
          context.conditions.includes('import') &&
          !context.conditions.includes('require');
        resolving = true;
        try {
          for (const anchor of anchors) {
            try {
              if (esm)
                return nextResolve(specifier, {
                  ...context,
                  parentURL: pathToFileURL(anchor).href,
                });
              return {
                url: pathToFileURL(createRequire(anchor).resolve(specifier))
                  .href,
                shortCircuit: true,
              };
            } catch (fallbackError) {
              if (!isMissingModule(fallbackError)) throw fallbackError;
            }
          }
        } finally {
          resolving = false;
        }
        throw error;
      }
    },
  });
}

/** Read an app's metadata in this process; the app must be the working directory. */
export async function readUltramodernConfigMetadata(
  options: LoadUltramodernConfigMetadataOptions,
): Promise<UltramodernConfigMetadata> {
  const appDirectory = path.resolve(options.appDirectory);
  const env = loadEnv({
    cwd: appDirectory,
    mode: process.env.MODERN_ENV || options.env,
    prefixes: ['MODERN_'],
  });
  const hooks = registerFallbackResolution(
    path.resolve(options.sourceRoot ?? appDirectory),
    options,
  );
  try {
    const loaded = await loadUltramodernConfigFile({
      appDirectory,
      configFile: options.configFile,
      env: options.env,
      command: options.command,
    });
    const resolution = await resolveUltramodernEntryIdentities({
      appDirectory,
      config: loaded.config,
      command: options.command,
      configFile: loaded.configFile,
    });
    return { renderer: loaded.config.renderer!, ...resolution };
  } finally {
    hooks?.deregister();
    env.cleanup();
  }
}

function workerFile(): string {
  let directory = path.dirname(
    process.env.MODERN_LIB_FORMAT === 'esm'
      ? fileURLToPath(import.meta.url)
      : __filename,
  );
  while (!fs.existsSync(path.join(directory, 'package.json'))) {
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error('Cannot find the UltraModern app tools package root');
    directory = parent;
  }
  return path.join(
    directory,
    'dist/cjs/native-composition/config-metadata-worker.js',
  );
}

/**
 * Load an app's modern.config and read its renderer and entries, the way the
 * Modern CLI would for that app. Each load runs in its own short-lived Node
 * process: config plugins keep per-process state such as the working
 * directory captured when they are first imported.
 */
export function loadUltramodernConfigMetadata(
  options: LoadUltramodernConfigMetadataOptions,
): Promise<UltramodernConfigMetadata> {
  const appDirectory = path.resolve(options.appDirectory);
  return new Promise((resolve, reject) => {
    const child = fork(workerFile(), [], {
      cwd: appDirectory,
      execArgv: [],
      env: { ...process.env, NODE_ENV: options.env },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-65536);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    let message: ConfigMetadataMessage | undefined;
    child.once('message', value => {
      message = value as ConfigMetadataMessage;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (message && 'result' in message) resolve(message.result);
      else if (message) {
        const error = new Error(message.error.message);
        error.stack = message.error.stack;
        reject(error);
      } else
        reject(
          new Error(
            `Loading ${appDirectory}/modern.config exited (${signal ?? code}) without a result.${output ? `\n${output}` : ''}`,
          ),
        );
    });
    child.send({ ...options, appDirectory });
  });
}

export type ConfigMetadataMessage =
  | { result: UltramodernConfigMetadata }
  | { error: { message: string; stack?: string } };
