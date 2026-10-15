/** Context passed to function items of a server `source.globalVars` chain. */
export interface ServerGlobalVarsContext {
  env: string;
  target: 'web' | 'node' | 'web-worker';
}

export type ServerGlobalVars = Record<string, unknown>;

type ServerGlobalVarsChainItem =
  | ServerGlobalVars
  | ((
      config: ServerGlobalVars,
      context: ServerGlobalVarsContext,
    ) => ServerGlobalVars | void);

/** Source options that server code reads from the application config. */
export interface ServerSourceConfigExtension {
  /**
   * Compile-time constants replaced in server code, such as BFF handlers.
   * Server code resolves the chain with `{ env: 'server', target: 'node' }`.
   */
  globalVars?: ServerGlobalVarsChainItem | ServerGlobalVarsChainItem[];
}
