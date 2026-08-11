import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  Layer,
} from '@modern-js/plugin-bff/effect-edge';
import { remoteEffectApi } from '../../shared/effect/api';

const greetingsLayer = HttpApiBuilder.group(
  remoteEffectApi,
  'greetings',
  handlers =>
    handlers
      .handle('hello', () =>
        Effect.succeed({
          message: 'Hello from remote Effect API',
          runtime: 'remote' as const,
        }),
      )
      .handle('traceChild', ({ headers, request }) => {
        const locale = request.headers['accept-language'];
        return Effect.succeed({
          status: 'ok' as const,
          traceparent: headers.traceparent,
          ...(typeof locale === 'string' && locale.length > 0
            ? { locale }
            : {}),
        });
      })
      .handle('traceSpans', () => Effect.succeed({ spans: [] }))
      .handle('traceReset', () => Effect.succeed({ ok: true })),
);

const layer = HttpApiBuilder.layer(remoteEffectApi).pipe(
  Layer.provide(greetingsLayer),
);

export default defineEffectBff({
  api: remoteEffectApi,
  layer,
});
