import type { HttpMethodDecider } from '@modern-js/types';

export type BffRuntimeFramework = 'hono' | 'effect';

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

export type BffEffectOpenApiUserConfig =
  | boolean
  | {
      path?: string;
    };

export interface BffEffectDataPlatformSelectionUserConfig {
  maxDepth?: number;
  maxFields?: number;
  allowedLeafPaths?: string[];
}

export interface BffEffectDataPlatformBatchUserConfig {
  enabled?: boolean;
  endpoint?: `/${string}`;
  maxBatchSize?: number;
  maxBatchBytes?: number;
  flushIntervalMs?: number;
  maxConcurrency?: number;
  requestTimeoutMs?: number;
  allowedMethods?: string[];
}

export interface BffEffectDataPlatformUserConfig {
  enabled?: boolean;
  requireEnvelope?: boolean;
  envelopeHeader?: string;
  expectedNamespace?: string;
  validateOrigin?: boolean;
  requireTraceContext?: boolean;
  selection?: BffEffectDataPlatformSelectionUserConfig;
  batch?: BffEffectDataPlatformBatchUserConfig;
}

export interface BffEffectUserConfig {
  entry?: string;
  openapi?: BffEffectOpenApiUserConfig;
  dataPlatform?: BffEffectDataPlatformUserConfig;
}

export interface BffUserConfig {
  prefix?: string | string[];
  httpMethodDecider?: HttpMethodDecider;
  enableHandleWeb?: boolean;
  /**
   * Enables cross-project BFF SDK generation for producer apps.
   */
  crossProject?: boolean;
  /**
   * Internal marker injected by generated cross-project SDK plugins.
   */
  isCrossProjectServer?: boolean;
  /**
   * Logical producer ID forwarded to generated clients and runtime contracts.
   */
  requestId?: string;
  /**
   * Legacy request runtime import path. Internal/compatibility usage.
   */
  runtimeCreateRequest?: string;
  /**
   * Custom request creator import path for generated BFF clients.
   */
  requestCreator?: string;
  /**
   * Legacy custom fetcher import path for generated BFF clients.
   */
  fetcher?: string;
  /**
   * Selects the BFF runtime implementation.
   *
   * - `effect`: only `api/effect/index` is served.
   * - `hono`: only `api/lambda/**` handlers are served.
   *
   * @default 'effect'
   */
  runtimeFramework?: BffRuntimeFramework;
  /**
   * Effect runtime configuration. Only applies when `runtimeFramework: 'effect'`.
   */
  effect?: BffEffectUserConfig;
  crossProjectPolicy?: BffCrossProjectPolicyUserConfig;
}

export type BffNormalizedConfig = BffUserConfig;
