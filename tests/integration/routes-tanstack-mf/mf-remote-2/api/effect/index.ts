import { defineEffectBff } from '@modern-js/bff-effect/effect';
import * as Effect from 'effect/Effect';
import { HttpApiBuilder } from 'effect/http-api';
import * as Layer from 'effect/Layer';
import { remoteTwoEffectApi } from '../../shared/effect/api';

const greetingsLayer = HttpApiBuilder.group(
  remoteTwoEffectApi,
  'greetings',
  handlers =>
    handlers.handle('hello', () =>
      Effect.succeed({
        message: 'Hello from remote2 Effect API',
        runtime: 'remote2' as const,
      }),
    ),
);

const layer = HttpApiBuilder.layer(remoteTwoEffectApi).pipe(
  Layer.provide(greetingsLayer),
);

export default defineEffectBff({
  api: remoteTwoEffectApi,
  layer,
});
