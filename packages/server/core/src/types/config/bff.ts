import type { BffRuntimeFramework } from '@modern-js/plugin/server';
import type { HttpMethodDecider } from '@modern-js/types/server';

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
  /** Node module exporting a generated-client transform. */
  clientCodegenPlugin?: string;
  /**
   * Legacy custom fetcher import path for generated BFF clients.
   */
  fetcher?: string;
  /** Selects a registered BFF runtime implementation. */
  runtimeFramework?: BffRuntimeFramework;
}

export type BffNormalizedConfig = BffUserConfig;
