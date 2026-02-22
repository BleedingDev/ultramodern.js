import { Rpc, RpcGroup, Schema } from '@modern-js/plugin-bff/effect-client';

export const bffRpcPing = Rpc.make('ping', {
  payload: Schema.Struct({
    name: Schema.String,
  }),
  success: Schema.Struct({
    message: Schema.String,
  }),
});

export const bffRpcGroup = RpcGroup.make(bffRpcPing);
