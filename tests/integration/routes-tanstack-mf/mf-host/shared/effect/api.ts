import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  Schema,
} from '@modern-js/plugin-bff/effect-client';

const traceSpanSchema = Schema.Struct({
  name: Schema.String,
  traceId: Schema.String,
  spanId: Schema.String,
  parentSpanId: Schema.optional(Schema.String),
});

export const hostEffectApi = HttpApi.make('HostEffectApi').add(
  HttpApiGroup.make('greetings')
    .add(
      HttpApiEndpoint.get('hello', '/effect/hello', {
        success: Schema.Struct({
          message: Schema.String,
          runtime: Schema.Literal('host'),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('traceRun', '/effect/trace/run', {
        headers: {
          traceparent: Schema.optional(Schema.String),
        },
        success: Schema.Struct({
          status: Schema.Literal('ok'),
          traceparent: Schema.optional(Schema.String),
          remoteStatus: Schema.Literal('ok'),
          locale: Schema.optional(Schema.String),
          remoteLocale: Schema.optional(Schema.String),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('traceSpans', '/effect/trace/spans', {
        query: {
          traceId: Schema.optional(Schema.String),
        },
        success: Schema.Struct({
          spans: Schema.Array(traceSpanSchema),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.post('traceReset', '/effect/trace/reset', {
        success: Schema.Struct({
          ok: Schema.Boolean,
        }),
      }),
    ),
);
