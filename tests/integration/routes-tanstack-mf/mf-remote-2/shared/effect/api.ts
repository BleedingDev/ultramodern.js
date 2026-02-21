import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  Schema,
} from '@modern-js/plugin-bff/effect-client';

export const remoteTwoEffectApi = HttpApi.make('RemoteTwoEffectApi').add(
  HttpApiGroup.make('greetings').add(
    HttpApiEndpoint.get('hello', '/effect/hello', {
      success: Schema.Struct({
        message: Schema.String,
        runtime: Schema.Literal('remote2'),
      }),
    }),
  ),
);
