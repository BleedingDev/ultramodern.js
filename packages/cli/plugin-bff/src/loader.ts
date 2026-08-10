// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off
import { type GenClientOptions, generateClient } from '@modern-js/bff-core';
import type { HttpMethodDecider } from '@modern-js/types';
import { logger } from '@modern-js/utils';
import type { Rspack } from '@rsbuild/core';
import path from 'path';
import {
  generateEffectClientCode,
  resolveEffectEntryFile,
} from './utils/effectClientGenerator';

const EFFECT_BFF_WORKER_RUNTIME_QUERY = 'modern-bff-runtime';
const EFFECT_BFF_WORKER_RUNTIME_SOURCE_QUERY = 'modern-bff-runtime-source';

const createErrorModule = (message: string) =>
  `throw new Error(${JSON.stringify(message)});`;

export type APILoaderOptions = {
  prefix: string;
  appDir: string;
  apiDir: string;
  lambdaDir: string;
  existLambda: boolean;
  port: number;
  fetcher?: string;
  requestCreator?: string;
  target: string;
  httpMethodDecider?: HttpMethodDecider;
  bffRuntimeFramework?: 'hono' | 'effect';
  effectEntry?: string;
  effectDataPlatformBatch?: {
    enabled?: boolean;
    endpoint?: string;
    flushIntervalMs?: number;
    maxBatchSize?: number;
    maxBatchBytes?: number;
    requestTimeoutMs?: number;
    allowedMethods?: string[];
  };
};

async function transformEffectRuntimeSource(source: string, filename: string) {
  const swc = await import('@swc/core');
  const result = await swc.transform(source, {
    filename,
    sourceMaps: false,
    jsc: {
      parser: {
        syntax: 'typescript',
        tsx: filename.endsWith('.tsx') || filename.endsWith('.jsx'),
      },
      target: 'es2022',
    },
    module: {
      type: 'es6',
    },
  });

  return result.code;
}

function createEffectWorkerRuntimeWrapper(resourcePath: string) {
  const sourceRequest = `${resourcePath}?${EFFECT_BFF_WORKER_RUNTIME_SOURCE_QUERY}`;

  return `import * as effectBffModule from ${JSON.stringify(sourceRequest)};
import { createEffectBffEdgeDispatcher } from '@modern-js/plugin-bff/effect-edge';

export const __modern_create_effect_bff_dispatcher = options =>
  createEffectBffEdgeDispatcher({
    ...options,
    module: effectBffModule,
  });
`;
}

async function loader(
  this: Rspack.LoaderContext<APILoaderOptions>,
  source: string,
) {
  this.cacheable();

  const { resourcePath } = this;

  delete require.cache[resourcePath];

  const callback = this.async();

  const draftOptions = this.getOptions();
  const resourceQueries = new URLSearchParams(this.resourceQuery);
  const effectEntryFile = resolveEffectEntryFile({
    appDir: draftOptions.appDir,
    apiDir: draftOptions.apiDir,
    effectEntry: draftOptions.effectEntry,
  });

  if (
    draftOptions.bffRuntimeFramework === 'effect' &&
    effectEntryFile &&
    path.resolve(effectEntryFile) === path.resolve(resourcePath) &&
    resourceQueries.has(EFFECT_BFF_WORKER_RUNTIME_SOURCE_QUERY)
  ) {
    const code = await transformEffectRuntimeSource(source, resourcePath);
    callback(undefined, code);
    return;
  }

  if (
    draftOptions.bffRuntimeFramework === 'effect' &&
    effectEntryFile &&
    path.resolve(effectEntryFile) === path.resolve(resourcePath) &&
    resourceQueries.has(EFFECT_BFF_WORKER_RUNTIME_QUERY)
  ) {
    callback(undefined, createEffectWorkerRuntimeWrapper(resourcePath));
    return;
  }

  if (
    draftOptions.bffRuntimeFramework === 'effect' &&
    effectEntryFile &&
    path.resolve(effectEntryFile) === path.resolve(resourcePath)
  ) {
    const code = await generateEffectClientCode({
      appDir: draftOptions.appDir,
      apiDir: draftOptions.apiDir,
      resourcePath,
      prefix: (Array.isArray(draftOptions.prefix)
        ? draftOptions.prefix[0]
        : draftOptions.prefix) as string,
      port: Number(draftOptions.port),
      target: draftOptions.target,
      requestCreator: draftOptions.requestCreator,
      httpMethodDecider: draftOptions.httpMethodDecider,
      dataPlatformBatch: draftOptions.effectDataPlatformBatch,
      onDependency: dependency => this.addDependency(dependency),
    });

    if (code) {
      callback(undefined, code);
      return;
    }

    callback(
      undefined,
      createErrorModule(`Failed to generate Effect client for ${resourcePath}`),
    );
    return;
  }

  const warning = `The file ${resourcePath} is not allowed to be imported in src directory, only API definition files are allowed.`;

  if (!draftOptions.existLambda) {
    logger.warn(warning);
    callback(null, createErrorModule(warning));
    return;
  }

  const options: GenClientOptions = {
    prefix: (Array.isArray(draftOptions.prefix)
      ? draftOptions.prefix[0]
      : draftOptions.prefix) as string,
    appDir: draftOptions.appDir,
    apiDir: draftOptions.apiDir,
    lambdaDir: draftOptions.lambdaDir,
    target: draftOptions.target,
    port: Number(draftOptions.port),
    source,
    resourcePath,
    httpMethodDecider: draftOptions.httpMethodDecider,
  };

  const { lambdaDir } = draftOptions;
  if (!resourcePath.startsWith(lambdaDir)) {
    logger.warn(warning);
    callback(null, createErrorModule(warning));
    return;
  }

  if (draftOptions.fetcher) {
    options.fetcher = draftOptions.fetcher;
  }

  if (draftOptions.requestCreator) {
    options.requestCreator = draftOptions.requestCreator;
  }

  options.requireResolve = require.resolve;

  const result = await generateClient(options);

  if (result.isOk) {
    callback(undefined, result.value);
  } else {
    callback(undefined, createErrorModule(result.value));
  }
}

export default loader;
