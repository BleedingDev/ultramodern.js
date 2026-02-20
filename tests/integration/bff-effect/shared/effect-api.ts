import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  Schema,
} from '@modern-js/plugin-bff/effect-client';

export const bffEffectApi = HttpApi.make('BffEffectApi').add(
  HttpApiGroup.make('greetings')
    .add(
      HttpApiEndpoint.get('hello', '/effect/hello', {
        success: Schema.Struct({
          message: Schema.String,
          runtime: Schema.Literal('effect'),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('userById', '/effect/user/:id', {
        params: {
          id: Schema.String,
        },
        query: {
          source: Schema.optional(Schema.String),
        },
        success: Schema.Struct({
          id: Schema.String,
          source: Schema.String,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.post('echo', '/effect/echo', {
        payload: Schema.Struct({
          text: Schema.String,
        }),
        success: Schema.Struct({
          echoed: Schema.String,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('managedFailure', '/effect/managed', {
        success: Schema.Struct({
          message: Schema.String,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('traceRun', '/effect/trace/run', {
        headers: {
          traceparent: Schema.optional(Schema.String),
        },
        success: Schema.Struct({
          status: Schema.String,
          traceparent: Schema.optional(Schema.String),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('traceSpans', '/effect/trace/spans', {
        query: {
          traceId: Schema.optional(Schema.String),
        },
        success: Schema.Struct({
          spans: Schema.Array(
            Schema.Struct({
              name: Schema.String,
              traceId: Schema.String,
              spanId: Schema.String,
              parentSpanId: Schema.optional(Schema.String),
            }),
          ),
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
