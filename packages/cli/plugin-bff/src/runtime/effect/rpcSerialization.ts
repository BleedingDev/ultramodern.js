import { RpcSerialization } from 'effect/unstable/rpc';

import type { EffectRpcSerialization } from './handler/types';

export function getRpcSerializationLayer(
  serialization: EffectRpcSerialization | undefined,
) {
  switch (serialization) {
    case 'ndjson':
      return RpcSerialization.layerNdjson;
    case 'jsonRpc':
      return RpcSerialization.layerJsonRpc();
    case 'ndJsonRpc':
      return RpcSerialization.layerNdJsonRpc();
    case 'msgPack':
      return RpcSerialization.layerMsgPack;
    default:
      return RpcSerialization.layerJsonRpc();
  }
}
