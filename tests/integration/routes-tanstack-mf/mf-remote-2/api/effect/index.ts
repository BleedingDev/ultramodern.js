import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  Layer,
} from '@modern-js/plugin-bff/effect-server';
import { remoteTwoEffectApi } from '../../shared/effect/api';

const greetingsLayer = HttpApiBuilder.group(
  remoteTwoEffectApi,
  'greetings',
  (handlers: any) =>
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
