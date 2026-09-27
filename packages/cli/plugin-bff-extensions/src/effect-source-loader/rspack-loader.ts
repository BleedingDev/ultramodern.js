import { realpathSync } from 'node:fs';
import type { Rspack } from '@rsbuild/core';
import {
  bundleEffectWorkerRuntimeSource,
  generateEffectWorkerRuntimeWrapper,
  resolveEffectEntryFile,
} from './index';

export interface EffectBffLoaderOptions {
  prefix: string;
  appDir: string;
  apiDir: string;
  effectEntry: string;
  requestId?: string;
}

export default async function loader(
  this: Rspack.LoaderContext<EffectBffLoaderOptions>,
  source: string,
) {
  this.cacheable();
  delete require.cache[this.resourcePath];
  const callback = this.async();
  try {
    const options = this.getOptions();
    const entry = resolveEffectEntryFile(options);
    if (!entry || realpathSync(entry) !== realpathSync(this.resourcePath))
      throw new Error(
        `Unexpected Effect BFF loader resource: ${this.resourcePath}`,
      );
    const query = new URLSearchParams(this.resourceQuery);
    if (query.has('modern-bff-runtime-source')) {
      const { transform } = await import('@swc/core');
      const transformed = await transform(source, {
        filename: this.resourcePath,
        sourceMaps: false,
        jsc: {
          parser: {
            syntax: 'typescript',
            tsx: /\.[jt]sx$/.test(this.resourcePath),
          },
          target: 'es2024',
        },
        module: { type: 'es6' },
      });
      callback(
        undefined,
        await bundleEffectWorkerRuntimeSource(
          transformed.code,
          this.resourcePath,
          this,
        ),
      );
    } else if (query.has('modern-bff-runtime')) {
      callback(
        undefined,
        await generateEffectWorkerRuntimeWrapper(
          this,
          options,
          this.resourcePath,
        ),
      );
    } else {
      throw new Error(
        'Effect BFF entries are server-only. Import the shared HttpApi contract and use HttpApiClient.make (or makeEffectHttpApiClient) for a fully inferred client.',
      );
    }
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}
