declare module '@modern-js/plugin-bff/effect-client' {
  type AnyFn = (...args: any[]) => any;

  export const HttpApi: {
    make: (name: string) => any;
  };
  export const HttpApiEndpoint: {
    get: (name: string) => (input: TemplateStringsArray) => {
      addSuccess: AnyFn;
    };
    post: (name: string) => (input: TemplateStringsArray) => {
      addSuccess: AnyFn;
    };
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
