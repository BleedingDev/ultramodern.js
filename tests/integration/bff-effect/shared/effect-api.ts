import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  Schema,
} from '@modern-js/plugin-bff/effect-client';

export const bffEffectApi = HttpApi.make('BffEffectApi').add(
  HttpApiGroup.make('greetings')
    .add(
      HttpApiEndpoint.get('hello', '/hello', {
        success: Schema.Struct({
          message: Schema.String,
          runtime: Schema.Literal('effect'),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('userById', '/user/:id', {
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
      HttpApiEndpoint.post('echo', '/echo', {
        payload: Schema.Struct({
          text: Schema.String,
        }),
        success: Schema.Struct({
          echoed: Schema.String,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('managedFailure', '/managed', {
        success: Schema.Struct({
          message: Schema.String,
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get('traceRun', '/trace/run', {
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
      HttpApiEndpoint.get('traceSpans', '/trace/spans', {
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
      HttpApiEndpoint.post('traceReset', '/trace/reset', {
        success: Schema.Struct({
          ok: Schema.Boolean,
        }),
      }),
    ),
);
