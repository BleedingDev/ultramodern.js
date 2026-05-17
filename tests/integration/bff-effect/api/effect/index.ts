// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import { randomBytes } from 'node:crypto';
import {
  defineEffectBff,
  Effect,
  HttpApiBuilder,
  Layer,
  OpenTelemetry,
} from '@modern-js/plugin-bff/effect-server';
import { bffEffectApi } from '../../shared/effect-api.js';
import { bffRpcGroup } from '../../shared/effect-rpc.js';

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

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i;

function randomHex(bytes: number) {
  return randomBytes(bytes).toString('hex');
}

function parseTraceparent(traceparent?: string) {
  if (!traceparent) {
    return null;
  }
  const match = traceparent.match(TRACEPARENT_PATTERN);
  if (!match) {
    return null;
  }
  return {
    traceId: match[1].toLowerCase(),
    parentSpanId: match[2].toLowerCase(),
  };
}

function createSyntheticTraceSpans(
  traceparent?: string,
): [TraceSpanSnapshot, TraceSpanSnapshot] {
  const parsed = parseTraceparent(traceparent);
  const traceId = parsed?.traceId ?? randomHex(16);
  const runSpanId = randomHex(8);
  const dbSpanId = randomHex(8);

  const runSpan: TraceSpanSnapshot = {
    name: 'bff.effect.trace.run',
    traceId,
    spanId: runSpanId,
    ...(parsed?.parentSpanId ? { parentSpanId: parsed.parentSpanId } : {}),
  };

  const dbSpan: TraceSpanSnapshot = {
    name: 'bff.effect.db.query',
    traceId,
    spanId: dbSpanId,
    parentSpanId: runSpanId,
  };

  return [runSpan, dbSpan];
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
  bffEffectApi,
  'greetings',
  handlers => {
    const handledHello = handlers.handle('hello', () =>
      Effect.succeed({
        message: 'Hello from Effect HttpApi',
        runtime: 'effect' as const,
      }),
    );

    const handledUserById = handledHello.handle(
      'userById',
      ({ params, query }) =>
        Effect.succeed({
          id: params.id,
          source: query.source ?? 'unknown',
        }),
    );

    const handledEcho = handledUserById.handle('echo', ({ payload }) =>
      Effect.succeed({
        echoed: payload.text,
      }),
    );

    const handledTraceRun = handledEcho.handle('traceRun', ({ headers }) => {
      const syntheticSpans = createSyntheticTraceSpans(headers.traceparent);
      return Effect.gen(function* () {
        if (headers.traceparent) {
          yield* Effect.annotateCurrentSpan(
            'bff.traceparent',
            headers.traceparent,
          );
        }
        yield* Effect.succeed('ok').pipe(
          Effect.withSpan('bff.effect.db.query', {
            attributes: {
              'db.system': 'effect-test',
              'db.operation': 'select',
            },
            kind: 'client',
            root: false,
          }),
        );
        yield* Effect.sync(() => {
          traceSpans.push(...syntheticSpans);
        });
        return {
          status: 'ok',
          traceparent: headers.traceparent,
        };
      }).pipe(Effect.withSpan('bff.effect.trace.run', { kind: 'server' }));
    });

    const handledTraceSpans = handledTraceRun.handle(
      'traceSpans',
      ({ query }) =>
        Effect.succeed({
          spans: getTraceSpans(query.traceId),
        }),
    );

    const handledTraceReset = handledTraceSpans.handle('traceReset', () =>
      Effect.sync(() => {
        traceSpans.length = 0;
        return {
          ok: true,
        };
      }),
    );

    return handledTraceReset.handle('managedFailure', () =>
      Effect.succeed({
        message: 'unreachable',
      }),
    );
  },
);

const layer = HttpApiBuilder.layer(bffEffectApi).pipe(
  Layer.provide(greetingsLayer),
  Layer.provideMerge(
    OpenTelemetry.NodeSdk.layer(() => ({
      spanProcessor: traceSpanProcessor,
      resource: {
        serviceName: 'modernjs-bff-effect-tests',
      },
    })),
  ),
);

const rpcLayer = bffRpcGroup.toLayer(
  bffRpcGroup.of({
    ping: ({ name }) =>
      Effect.succeed({
        message: `Hello from Effect RPC, ${name}`,
      }).pipe(Effect.withSpan('bff.rpc.ping')),
  }),
);

const runtime = defineEffectBff({
  api: bffEffectApi,
  layer,
  rpc: {
    group: bffRpcGroup,
    layer: rpcLayer,
    path: '/rpc',
  },
});

const withManagedFailure = {
  ...runtime,
  createHandler: (options?: Parameters<typeof runtime.createHandler>[0]) => {
    const base = runtime.createHandler(options);
    return {
      handler: async (request: Request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname.endsWith('/effect/managed')) {
          const managedError = new Error('Managed effect error') as Error & {
            status?: number;
          };
          managedError.status = 503;
          throw managedError;
        }
        return base.handler(request);
      },
      dispose: base.dispose,
    };
  },
};

export default withManagedFailure;
