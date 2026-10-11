import { defineEffectBff } from '@modern-js/bff-effect/effect';
import * as Effect from 'effect/Effect';
import { HttpApiBuilder } from 'effect/http-api';
import * as Layer from 'effect/Layer';
import { bffCrossProjectEffectApi } from '../../shared/effect/api';

const greetingsLayer = HttpApiBuilder.group(
  bffCrossProjectEffectApi,
  'greetings',
  handlers =>
    handlers
      .handle('hello', () =>
        Effect.succeed({
          message: 'Hello get bff-api-app effect',
          runtime: 'effect',
        }),
      )
      .handle('traceHeader', ({ headers }) =>
        Effect.succeed({
          runtime: 'effect',
          traceparent: headers.traceparent,
          locale: headers['accept-language'],
        }),
      ),
);

export const api = bffCrossProjectEffectApi;

export const layer = HttpApiBuilder.layer(bffCrossProjectEffectApi).pipe(
  Layer.provide(greetingsLayer),
);
export default defineEffectBff({ api, layer });
