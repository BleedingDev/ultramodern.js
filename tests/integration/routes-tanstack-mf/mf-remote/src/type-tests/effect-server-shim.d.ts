declare module '@modern-js/plugin-bff/effect-server' {
  type AnyFn = (...args: any[]) => any;

  type HandlerCollection = {
    handle: (name: string, handler: (args: any) => any) => HandlerCollection;
  };

  export const Effect: {
    succeed: AnyFn;
    gen: AnyFn;
    withSpan: AnyFn;
    sync: AnyFn;
    promise: AnyFn;
    dieMessage: AnyFn;
  };

  export const HttpTraceContext: {
    w3c: AnyFn;
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

  export const Option: {
    match: <TResult>(
      value: unknown,
      options: {
        onNone: () => TResult;
        onSome: (value: any) => TResult;
      },
    ) => TResult;
    getOrUndefined: AnyFn;
  };

  export const OpenTelemetry: {
    NodeSdk: {
      layer: AnyFn;
    };
  };

  export namespace OpenTelemetry {
    namespace NodeSdk {
      interface SpanProcessor {
        onStart: (span: any) => void;
        onEnd: (span: any) => void;
        forceFlush: () => Promise<void>;
        shutdown: () => Promise<void>;
      }

      interface Configuration {
        spanProcessor?: SpanProcessor | ReadonlyArray<SpanProcessor>;
      }
    }
  }

  export function defineEffectBff(input: any): any;
}
