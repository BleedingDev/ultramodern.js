declare module '@modern-js/plugin-bff/effect-server' {
  type AnyFn = (...args: any[]) => any;

  type HandlerCollection = {
    handle: (name: string, handler: (args: any) => any) => HandlerCollection;
  };

  export const Effect: {
    succeed: AnyFn;
  };
  export const HttpApiBuilder: {
    group: (
      api: any,
      groupName: string,
      setup: (handlers: HandlerCollection) => HandlerCollection,
    ) => any;
    layer: (api: any) => {
      pipe: AnyFn;
    };
    api: (api: any) => {
      pipe: AnyFn;
    };
  };
  export const Layer: {
    provide: AnyFn;
  };

  export function defineEffectBff(input: any): any;
}
