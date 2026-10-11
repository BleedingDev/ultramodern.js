import type {
  DevServerHttpsOptions,
  ExposeServerApis,
  RequestHandler,
} from '@modern-js/types/server';

export type { DevServerHttpsOptions };

type StaticOrigin =
  | boolean
  | string
  | RegExp
  | Array<boolean | string | RegExp>;

type CustomOrigin = (
  requestOrigin: string | undefined,
  callback: (err: Error | null, origin?: StaticOrigin) => void,
) => void;

export interface CorsOptions {
  /**
   * @default '*''
   */
  origin?: StaticOrigin | CustomOrigin | undefined;
}

export interface DevServerConfig {
  /**
   * Configure CORS for the dev server.
   * - object: enable CORS with the specified options.
   * - true: enable CORS with default options (allow all origins, not recommended).
   * - false: disable CORS.
   * @default
   * ```js
   * { origin: defaultAllowedOrigins }
   * ```
   * where `defaultAllowedOrigins` includes:
   * - `localhost`
   * - `127.0.0.1`
   *
   * @link https://github.com/expressjs/cors
   */
  cors?: boolean | CorsOptions;
}

export type DevServerOptions = {
  /** Provides the ability to execute a custom function and apply custom middlewares */
  setupMiddlewares?: Array<
    (
      /** Order: `devServer.before` => `unshift` => internal middlewares => `push` => `devServer.after` */
      middlewares: {
        /** Use the `unshift` method if you want to run a middleware before all other middlewares */
        unshift: (...handlers: RequestHandler[]) => void;
        /** Use the `push` method if you want to run a middleware after all other middlewares */
        push: (...handlers: RequestHandler[]) => void;
      },
      server: ExposeServerApis,
    ) => void
  >;
  /** Whether to enable hot reload. */
  https?: DevServerHttpsOptions;
  /** Dev server specific options. */
  server?: DevServerConfig;
};

// Modern consumes this field separately from Rsbuild's setupMiddlewares.
export type SetupMiddlewares = DevServerOptions['setupMiddlewares'];
