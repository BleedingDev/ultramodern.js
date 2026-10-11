import {
  extractHttpApiFromModule,
  type HttpApiLike,
  type HttpApiReflect,
} from '@modern-js/bff-effect/effect';
import { HttpApi } from 'effect/http-api';
import { loadEffectSourceModule } from './loader';

type HttpApiRuntime = {
  isHttpApi: (value: unknown) => boolean;
  reflect: HttpApiReflect;
};

export function getHttpApiRuntime(): Promise<HttpApiRuntime> {
  return Promise.resolve({
    isHttpApi: HttpApi.isHttpApi,
    reflect: (api, handlers) => {
      if (!HttpApi.isHttpApi(api)) {
        throw new TypeError('[BFF][Effect] Expected an HttpApi contract.');
      }
      HttpApi.reflect(api, {
        onGroup: handlers.onGroup ?? (() => {}),
        onEndpoint: handlers.onEndpoint,
      });
    },
  });
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
