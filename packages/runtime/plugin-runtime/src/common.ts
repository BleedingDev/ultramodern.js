export const isBrowser = () =>
  typeof window !== 'undefined' && window.name !== 'nodejs';

export type RuntimePlugin<Extends = unknown> = {
  name?: string;
  registryHooks?: Extends extends { extendHooks: infer Hooks }
    ? Hooks
    : Record<string, unknown>;
  setup?: (...args: any[]) => unknown;
  [key: string]: unknown;
};

export interface RuntimeConfig {
  plugins?: RuntimePlugin[];
  [key: string]: any;
}

export const JSX_SHELL_STREAM_END_MARK = '<!--<?- SHELL_STREAM_END ?>-->';
export const ESCAPED_SHELL_STREAM_END_MARK =
  '&lt;!--&lt;?- SHELL_STREAM_END ?&gt;--&gt;';
