import { compatibleRequire, upath as path } from '@modern-js/utils';
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

function isHttpApiRuntime(value: unknown): value is HttpApiRuntime {
  return (
    isRecord(value) &&
    typeof value.isHttpApi === 'function' &&
    typeof value.reflect === 'function'
  );
}

export function getHttpApiRuntime(): Promise<HttpApiRuntime> {
  if (httpApiRuntimePromise === undefined) {
    httpApiRuntimePromise = compatibleRequire('effect/unstable/httpapi', false)
      .catch(error => {
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
        return compatibleRequire(effectHttpApiRuntimePath, false);
      })
      .then(mod => {
        if (isRecord(mod) && isHttpApiRuntime(mod.HttpApi)) {
          return mod.HttpApi;
        }
        throw new Error(
          '[BFF][Effect] Unable to resolve HttpApi runtime from effect/unstable/httpapi.',
        );
      });
  }

  return httpApiRuntimePromise;
}

export function loadEffectApi(options: {
  appDir: string;
  resourcePath: string;
  onDependency?: (dependency: string) => void;
}): Promise<HttpApiLike | null> {
  return getHttpApiRuntime().then(httpApiRuntime =>
    loadEffectSourceModule(options).then(mod =>
      extractHttpApiFromModule(mod, httpApiRuntime.isHttpApi),
    ),
  );
}
