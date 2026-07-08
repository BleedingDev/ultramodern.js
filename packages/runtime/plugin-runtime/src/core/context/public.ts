import { createContext, useContext } from 'react';

type RuntimeRequest = Record<string, unknown>;

type RuntimeResponse = Record<string, unknown>;

export type RequestContext = {
  request: RuntimeRequest;
  response: RuntimeResponse;
};

export interface TRuntimeContext {
  initialData?: Record<string, unknown>;
  isBrowser: boolean;
  routes?: unknown[];
  requestContext: RequestContext;
  /**
   * @deprecated Use `requestContext` instead
   */
  context: RequestContext;
  [key: string]: unknown;
}

export const RuntimeContext = createContext<TRuntimeContext>({} as any);

/**
 * deprecated, use RuntimeContext instead
 */
export const ReactRuntimeContext = RuntimeContext;

/**
 * @deprecated use use(RuntimeContext) instead
 */
export const useRuntimeContext = (): TRuntimeContext =>
  useContext(RuntimeContext);
