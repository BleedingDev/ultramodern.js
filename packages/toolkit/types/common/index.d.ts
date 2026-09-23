export type InternalPlugins = Record<
  string,
  string | { path: string; forced?: boolean }
>;

export type ServerPlugin = {
  /** The plugin package.json's name  */
  name: string;

  options?: Record<string, any>;
  /** Module specifiers loaded dynamically by this plugin in a Node deployment. */
  includeEntries?: string[];
};

export type SSRMode = 'string' | 'stream' | false;

/**
 * Request-scoped diagnostics callbacks. They are declared here, not in a
 * server or solution package, so the runtime can type its own SSR context
 * without depending on either.
 */
export type OnError = (err: unknown, key?: string) => void;

export type OnTiming = (name: string, dur: number) => void;
