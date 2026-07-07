import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  Schema,
} from '@modern-js/plugin-bff/effect-client';

/** @type {any} */
export const bffCrossProjectEffectApi = HttpApi.make(
  'CrossProjectEffectApi',
).add(
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
      HttpApiEndpoint.get('traceHeader', '/effect/trace-header', {
        headers: {
          traceparent: Schema.optional(Schema.String),
          'accept-language': Schema.optional(Schema.String),
        },
        success: Schema.Struct({
          runtime: Schema.Literal('effect'),
          locale: Schema.optional(Schema.String),
          traceparent: Schema.optional(Schema.String),
        }),
      }),
    ),
);
