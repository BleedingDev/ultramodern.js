import type { HttpMethodDecider } from '@modern-js/types';
import type {
  BffCrossProjectPolicyUserConfig,
  BffEffectUserConfig,
  BffRuntimeFramework,
} from './bffRuntime';

export type {
  BffCrossProjectPolicyUserConfig,
  BffEffectDataPlatformBatchUserConfig,
  BffEffectDataPlatformSelectionUserConfig,
  BffEffectDataPlatformUserConfig,
  BffEffectOpenApiUserConfig,
  BffEffectUserConfig,
  BffRuntimeFramework,
} from './bffRuntime';

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
