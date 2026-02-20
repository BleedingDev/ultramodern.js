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
  HttpApiGroup.make('greetings').add(
    HttpApiEndpoint.get('hello', '/effect/hello').addSuccess(
      Schema.Struct({
        message: Schema.String,
        runtime: Schema.Literal('effect'),
      }),
    ),
  ),
);
