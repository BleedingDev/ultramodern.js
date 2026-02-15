import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  Schema,
} from '@modern-js/plugin-bff/effect-client';

export const bffEffectApi = HttpApi.make('BffEffectApi').add(
  HttpApiGroup.make('greetings')
    .add(
      HttpApiEndpoint.get('hello')`/effect/hello`.addSuccess(
        Schema.Struct({
          message: Schema.String,
          runtime: Schema.Literal('effect'),
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get(
        'userById',
      )`/effect/user/${HttpApiSchema.param('id', Schema.String)}`
        .setUrlParams(
          Schema.Struct({
            source: Schema.optional(Schema.String),
          }),
        )
        .addSuccess(
          Schema.Struct({
            id: Schema.String,
            source: Schema.String,
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post('echo')`/effect/echo`
        .setPayload(
          Schema.Struct({
            text: Schema.String,
          }),
        )
        .addSuccess(
          Schema.Struct({
            echoed: Schema.String,
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get('managedFailure')`/effect/managed`.addSuccess(
        Schema.Struct({
          message: Schema.String,
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get('traceRun')`/effect/trace/run`
        .setHeaders(
          Schema.Struct({
            traceparent: Schema.optional(Schema.String),
          }),
        )
        .addSuccess(
          Schema.Struct({
            status: Schema.String,
            traceparent: Schema.optional(Schema.String),
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get('traceSpans')`/effect/trace/spans`
        .setUrlParams(
          Schema.Struct({
            traceId: Schema.optional(Schema.String),
          }),
        )
        .addSuccess(
          Schema.Struct({
            spans: Schema.Array(
              Schema.Struct({
                name: Schema.String,
                traceId: Schema.String,
                spanId: Schema.String,
                parentSpanId: Schema.optional(Schema.String),
              }),
            ),
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post('traceReset')`/effect/trace/reset`.addSuccess(
        Schema.Struct({
          ok: Schema.Boolean,
        }),
      ),
    ),
);
