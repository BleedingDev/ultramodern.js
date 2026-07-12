import { compatibleRequire } from '@modern-js/utils';
import path from 'path';
import {
  extractHttpApiFromModule,
  type HttpApiLike,
  type HttpApiReflect,
} from '../../runtime/effect/endpoint-contracts';
import { loadEffectSourceModule } from '../effectSourceLoader';

type HttpApiRuntime = {
  isHttpApi: (value: unknown) => boolean;
  reflect: HttpApiReflect;
};

let httpApiRuntimePromise: Promise<HttpApiRuntime> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function getHttpApiRuntime(): Promise<HttpApiRuntime> {
  if (!httpApiRuntimePromise) {
    httpApiRuntimePromise = (async () => {
      let mod: unknown;
      try {
        mod = await compatibleRequire('effect/unstable/httpapi', false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("Cannot find module 'effect/unstable/httpapi'")) {
          throw error;
        }
        // Fallback for CJS paths where the effect package does not expose a require condition.
        const effectPackageJson = require.resolve('effect/package.json');
        const effectHttpApiRuntimePath = path.join(
          path.dirname(effectPackageJson),
          'dist',
          'unstable',
          'httpapi',
          'index.js',
        );
        mod = await compatibleRequire(effectHttpApiRuntimePath, false);
      }

      if (isRecord(mod) && isRecord(mod.HttpApi)) {
        const maybeHttpApi = mod.HttpApi as Partial<HttpApiRuntime>;
        if (
          typeof maybeHttpApi.isHttpApi === 'function' &&
          typeof maybeHttpApi.reflect === 'function'
        ) {
          return maybeHttpApi as HttpApiRuntime;
        }
      }
      throw new Error(
        '[BFF][Effect] Unable to resolve HttpApi runtime from effect/unstable/httpapi.',
      );
    })();
  }

  return httpApiRuntimePromise;
}

export async function loadEffectApi(options: {
  appDir: string;
  resourcePath: string;
  onDependency?: (dependency: string) => void;
}): Promise<HttpApiLike | null> {
  const httpApiRuntime = await getHttpApiRuntime();
  const mod = await loadEffectSourceModule(options);
  return extractHttpApiFromModule(mod, httpApiRuntime.isHttpApi);
}
