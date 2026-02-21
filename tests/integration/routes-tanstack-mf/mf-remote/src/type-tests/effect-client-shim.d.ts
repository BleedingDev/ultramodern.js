declare module '@modern-js/plugin-bff/effect-client' {
  type AnyFn = (...args: any[]) => any;

  export const HttpApi: {
    make: (name: string) => any;
  };
  export const HttpApiEndpoint: {
    get: (...args: any[]) => any;
    post: (...args: any[]) => any;
  };
  export const HttpApiGroup: {
    make: (name: string) => any;
  };
  export const Rpc: any;
  export const RpcGroup: any;
  export const makeEffectRpcClient: AnyFn;
  export const runEffectRequest: AnyFn;
  export const Schema: any;
}
