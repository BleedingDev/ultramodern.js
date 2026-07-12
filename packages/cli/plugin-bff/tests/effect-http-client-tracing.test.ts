import * as OpenTelemetry from '@effect/opentelemetry';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { HttpClient, HttpClientRequest } from 'effect/unstable/http';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from 'effect/unstable/httpapi';
import { makeEffectHttpApiClient } from '../src/runtime/effect-client';

type TraceSpanProcessor = Exclude<
  OpenTelemetry.NodeSdk.Configuration['spanProcessor'],
  ReadonlyArray<unknown> | undefined
>;
type FinishedSpan = Parameters<TraceSpanProcessor['onEnd']>[0];

const TraceApi = HttpApi.make('TraceApi').add(
  HttpApiGroup.make('trace').add(
    HttpApiEndpoint.get('ping', '/ping', {
      success: Schema.Struct({ ok: Schema.Boolean }),
    }),
  ),
);

describe('makeEffectHttpApiClient tracing', () => {
  test('injects the emitted Effect client span instead of fabricated trace headers', async () => {
    const originalFetch = globalThis.fetch;
    const finishedSpans: FinishedSpan[] = [];
    let outgoingTraceparent: string | null = null;
    const fabricatedTraceparent =
      '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
    const spanProcessor: TraceSpanProcessor = {
      onStart: () => {},
      onEnd: span => {
        finishedSpans.push(span);
      },
      forceFlush: async () => {},
      shutdown: async () => {},
    };

    globalThis.fetch = async (_input, init) => {
      outgoingTraceparent = new Headers(init?.headers).get('traceparent');
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'content-type': 'application/json',
        },
      });
    };

    try {
      const program = Effect.gen(function* () {
        const client = yield* makeEffectHttpApiClient(TraceApi, {
          baseUrl: 'http://effect-client.test',
          requestContext: {
            traceparent: fabricatedTraceparent,
          },
          transformClient: client =>
            client.pipe(
              HttpClient.mapRequest(request =>
                HttpClientRequest.setHeader(
                  request,
                  'traceparent',
                  fabricatedTraceparent,
                ),
              ),
            ),
        });
        return yield* client.trace.ping();
      }).pipe(
        Effect.withSpan('plugin-bff.trace.parent', { kind: 'server' }),
        Effect.provide(
          OpenTelemetry.NodeSdk.layer(() => ({
            resource: {
              serviceName: 'plugin-bff-trace-test',
            },
            spanProcessor,
          })).pipe(Layer.orDie),
        ),
      );

      await expect(Effect.runPromise(program)).resolves.toEqual({ ok: true });

      const clientSpan = finishedSpans.find(
        span => span.name === 'http.client GET',
      );
      const parentSpan = finishedSpans.find(
        span => span.name === 'plugin-bff.trace.parent',
      );
      expect(clientSpan).toBeDefined();
      expect(parentSpan).toBeDefined();

      const clientContext = clientSpan!.spanContext();
      const parentContext = parentSpan!.spanContext();
      expect(outgoingTraceparent).toBe(
        `00-${clientContext.traceId}-${clientContext.spanId}-01`,
      );
      expect(outgoingTraceparent).not.toBe(fabricatedTraceparent);
      expect(clientSpan!.parentSpanContext).toMatchObject({
        spanId: parentContext.spanId,
        traceId: parentContext.traceId,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
