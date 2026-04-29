import { randomBytes } from 'node:crypto';
import { createRequestContextHeaders } from '@modern-js/plugin-bff/client';
import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  HttpTraceContext,
  Layer,
  OpenTelemetry,
  Option,
} from '@modern-js/plugin-bff/effect-server';
import { hostEffectApi } from '../../shared/effect/api';

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

type ParsedTraceparent = {
  traceId: string;
  spanId: string;
};

type TraceHeaders = Record<string, string | undefined>;
type TraceHandlerArgs = {
  headers: TraceHeaders;
  request: {
    headers: TraceHeaders;
  };
};
type TraceQueryArgs = {
  query: {
    traceId?: string;
  };
};

const traceSpans: TraceSpanSnapshot[] = [];
const remoteOrigin = process.env.MF_REMOTE_ORIGIN ?? 'http://localhost:3010';

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

function parseTraceparent(
  traceparent: string | undefined,
): ParsedTraceparent | undefined {
  if (!traceparent) {
    return undefined;
  }
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/i.exec(
    traceparent,
  );
  if (!match) {
    return undefined;
  }
  const [, traceId, spanId] = match;
  if (!traceId || !spanId) {
    return undefined;
  }
  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
  };
}

function createSpanId() {
  return randomBytes(8).toString('hex');
}

function getTraceSpans(traceId?: string) {
  if (!traceId) {
    return [...traceSpans];
  }
  return traceSpans.filter(span => span.traceId === traceId);
}

function toTraceparentHeader(span: {
  traceId: string;
  spanId: string;
  sampled: boolean;
}) {
  return `00-${span.traceId}-${span.spanId}-${span.sampled ? '01' : '00'}`;
}

const traceSpanProcessor: TraceSpanProcessor = {
  onStart: () => {},
  onEnd: (span: FinishedSpan) => {
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
  hostEffectApi,
  'greetings',
  (handlers: any) => {
    const handledHello = handlers.handle('hello', () =>
      Effect.succeed({
        message: 'Hello from host Effect API',
        runtime: 'host' as const,
      }),
    );

    const handledTraceRun = handledHello.handle(
      'traceRun',
      ({ headers, request }: TraceHandlerArgs) => {
        const incomingTrace = parseTraceparent(headers.traceparent);
        const locale = request.headers['accept-language'] ?? undefined;
        const parentSpan = Option.match(HttpTraceContext.w3c(request.headers), {
          onNone: () => undefined,
          onSome: (value: unknown) => value,
        });

        return Effect.gen(function* () {
          const syntheticHostRunSpanId = createSpanId();
          const syntheticHostRemoteCallSpanId = createSpanId();
          if (incomingTrace) {
            traceSpans.push({
              name: 'mf.host.trace.run',
              traceId: incomingTrace.traceId,
              spanId: syntheticHostRunSpanId,
              parentSpanId: incomingTrace.spanId,
            });
            traceSpans.push({
              name: 'mf.host.trace.remote.call',
              traceId: incomingTrace.traceId,
              spanId: syntheticHostRemoteCallSpanId,
              parentSpanId: syntheticHostRunSpanId,
            });
          }

          const remoteResponse = yield* Effect.gen(function* () {
            const currentSpan = yield* Effect.option(Effect.currentSpan);
            const traceparent = Option.match(currentSpan, {
              onNone: () => headers.traceparent,
              onSome: (span: {
                traceId: string;
                spanId: string;
                sampled: boolean;
              }) => toTraceparentHeader(span),
            });
            const syntheticTraceparent = incomingTrace
              ? `00-${incomingTrace.traceId}-${syntheticHostRemoteCallSpanId}-01`
              : undefined;
            const requestHeaders = createRequestContextHeaders({
              locale,
              traceparent: syntheticTraceparent || traceparent,
            });

            return yield* Effect.promise(() =>
              fetch(`${remoteOrigin}/remote-api/effect/trace/child`, {
                method: 'GET',
                headers: requestHeaders,
              }),
            );
          }).pipe(
            Effect.withSpan('mf.host.trace.remote.call', {
              kind: 'client',
            }),
          );

          if (!remoteResponse.ok) {
            yield* Effect.dieMessage(
              `Remote trace call failed with status ${remoteResponse.status}`,
            );
          }

          const remoteBody = yield* Effect.promise(
            () =>
              remoteResponse.json() as Promise<{
                status?: 'ok';
                locale?: string;
              }>,
          );
          const remoteStatus = remoteBody.status ?? 'ok';
          const remoteLocale = remoteBody.locale;

          return {
            status: 'ok' as const,
            traceparent: headers.traceparent,
            remoteStatus,
            ...(locale ? { locale } : {}),
            ...(remoteLocale ? { remoteLocale } : {}),
          };
        }).pipe(
          Effect.withSpan('mf.host.trace.run', {
            parent: parentSpan,
            kind: 'server',
          }),
        );
      },
    );

    const handledTraceSpans = handledTraceRun.handle(
      'traceSpans',
      ({ query }: TraceQueryArgs) =>
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

const layer = HttpApiBuilder.layer(hostEffectApi).pipe(
  Layer.provide(greetingsLayer),
  Layer.provide(
    OpenTelemetry.NodeSdk.layer(() => ({
      spanProcessor: traceSpanProcessor,
      resource: {
        serviceName: 'modernjs-mf-host-tests',
      },
    })),
  ),
);

export default defineEffectBff({
  api: hostEffectApi,
  layer,
});
