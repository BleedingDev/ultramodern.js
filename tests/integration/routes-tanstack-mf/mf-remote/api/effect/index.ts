import {
  Effect,
  HttpApiBuilder,
  HttpTraceContext,
  Layer,
  OpenTelemetry,
  Option,
  defineEffectBff,
} from '@modern-js/plugin-bff/effect-server';
import { remoteEffectApi } from '../../shared/effect/api';

type TraceSpanProcessor = Exclude<
  OpenTelemetry.NodeSdk.Configuration['spanProcessor'],
  ReadonlyArray<unknown> | undefined
>;

type FinishedSpan = Parameters<TraceSpanProcessor['onEnd']>[0];

type TraceSpanSnapshot = {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
};

const traceSpans: TraceSpanSnapshot[] = [];

function toSpanSnapshot(span: FinishedSpan): TraceSpanSnapshot {
  const spanContext = span.spanContext();
  const parentSpanId = span.parentSpanContext?.spanId;
  return {
    name: span.name,
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
  };
}

function getTraceSpans(traceId?: string) {
  if (!traceId) {
    return [...traceSpans];
  }
  return traceSpans.filter(span => span.traceId === traceId);
}

const traceSpanProcessor: TraceSpanProcessor = {
  onStart: () => {},
  onEnd: span => {
    traceSpans.push(toSpanSnapshot(span));
  },
  forceFlush: async () => {
    await Promise.resolve();
  },
  shutdown: async () => {
    await Promise.resolve();
  },
};

const greetingsLayer = HttpApiBuilder.group(
  remoteEffectApi,
  'greetings',
  handlers => {
    const handledHello = handlers.handle('hello', () =>
      Effect.succeed({
        message: 'Hello from remote Effect API',
        runtime: 'remote' as const,
      }),
    );

    const handledTraceChild = handledHello.handle(
      'traceChild',
      ({ headers, request }) => {
        const parentSpan = Option.match(HttpTraceContext.w3c(request.headers), {
          onNone: () => undefined,
          onSome: value => value,
        });
        return Effect.gen(function* () {
          yield* Effect.succeed('ok').pipe(
            Effect.withSpan('mf.remote.trace.db.query', {
              attributes: {
                'db.system': 'effect-test',
                'db.operation': 'select',
              },
              kind: 'client',
            }),
          );
          return {
            status: 'ok' as const,
            traceparent: headers.traceparent,
          };
        }).pipe(
          Effect.withSpan('mf.remote.trace.run', {
            parent: parentSpan,
            kind: 'server',
          }),
        );
      },
    );

    const handledTraceSpans = handledTraceChild.handle(
      'traceSpans',
      ({ query }) =>
        Effect.succeed({
          spans: getTraceSpans(query.traceId),
        }),
    );

    return handledTraceSpans.handle('traceReset', () =>
      Effect.sync(() => {
        traceSpans.length = 0;
        return {
          ok: true,
        };
      }),
    );
  },
);

const layer = HttpApiBuilder.layer(remoteEffectApi).pipe(
  Layer.provide(greetingsLayer),
  Layer.provide(
    OpenTelemetry.NodeSdk.layer(() => ({
      spanProcessor: traceSpanProcessor,
      resource: {
        serviceName: 'modernjs-mf-remote-tests',
      },
    })),
  ),
);

export default defineEffectBff({
  api: remoteEffectApi,
  layer,
});
