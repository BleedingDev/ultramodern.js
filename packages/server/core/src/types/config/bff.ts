import type { Options } from 'http-proxy-middleware';
import type { HttpMethodDecider } from '@modern-js/types';

export interface BffCrossProjectPolicyUserConfig {
  /**
   * Enable cross-project envelope and operation-context policy checks.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Require cross-project envelope header when policy is enabled.
   *
   * @default true
   */
  requireEnvelope?: boolean;
  /**
   * Require operation-context header when policy is enabled.
   *
   * @default true
   */
  requireOperationContext?: boolean;
  /**
   * Optional allowlist of producer namespaces derived from requestId.
   */
  allowedNamespaces?: string[];
  /**
   * HTTP status code used for denied requests.
   *
   * @default 403
   */
  denyStatus?: number;
}

export interface BffUserConfig {
  prefix?: string;
  proxy?: Record<string, Options>;
  httpMethodDecider?: HttpMethodDecider;
  enableHandleWeb?: boolean;
  crossProjectPolicy?: BffCrossProjectPolicyUserConfig;
}

export type BffNormalizedConfig = BffUserConfig;
