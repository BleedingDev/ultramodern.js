import {
  Effect,
  HttpApiBuilder,
  Layer,
  defineEffectBff,
} from '@modern-js/plugin-bff/effect-server';
import { bffCrossProjectEffectApi } from '../../shared/effect/api';

const greetingsLayer = HttpApiBuilder.group(
  bffCrossProjectEffectApi,
  'greetings',
  handlers =>
    handlers.handle('hello', () =>
      Effect.succeed({
        message: 'Hello get bff-api-app effect',
        runtime: 'effect',
      }),
    ),
);

/** @type {any} */
export const api = bffCrossProjectEffectApi;

/** @type {any} */
export const layer = HttpApiBuilder.layer(bffCrossProjectEffectApi).pipe(
  Layer.provide(greetingsLayer),
);
// Keep a value export so the module shape aligns with other Effect entries.
defineEffectBff({ api, layer });
