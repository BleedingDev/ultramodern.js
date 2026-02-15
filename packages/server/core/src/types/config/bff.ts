import type { HttpMethodDecider } from '@modern-js/types';

export interface BffEffectUserConfig {
  /**
   * Data platform validation configuration for Effect runtime.
   */
  dataPlatform?: {
    /**
     * Enable request envelope validation for Effect HttpApi requests.
     * @default true
     */
    enabled?: boolean;
    /**
     * Require every HttpApi request to include an envelope header.
     * @default false
     */
    requireEnvelope?: boolean;
    /**
     * Envelope header name.
     * @default "x-modernjs-data-envelope"
     */
    envelopeHeader?: string;
    /**
     * Optional namespace assertion for request envelope validation.
     */
    expectedNamespace?: string;
    /**
     * Validate envelope origin against the incoming request origin.
     * @default true
     */
    validateOrigin?: boolean;
    /**
     * Require trace context inside request envelope.
     * @default false
     */
    requireTraceContext?: boolean;
    /**
     * Selection plan constraints for server-side validation.
     */
    selection?: {
      maxDepth?: number;
      maxFields?: number;
      allowedLeafPaths?: string[];
    };
    /**
     * Network batching gateway configuration for Effect runtime.
     */
    batch?: {
      /**
       * Enable batch endpoint handling.
       * @default true
       */
      enabled?: boolean;
      /**
       * Batch endpoint path mounted under bff.prefix.
       * @default "/_data/batch"
       */
      endpoint?: `/${string}`;
      /**
       * Maximum accepted items in a single batch call.
       * @default 16
       */
      maxBatchSize?: number;
      /**
       * Maximum serialized payload bytes for one batch call.
       * @default 65536
       */
      maxBatchBytes?: number;
      /**
       * Client-side micro-batch flush window in milliseconds.
       * Forwarded to generated Effect client transport.
       * @default 8
       */
      flushIntervalMs?: number;
      /**
       * Maximum internal per-item dispatch concurrency.
       * @default 4
       */
      maxConcurrency?: number;
      /**
       * Per-item timeout in milliseconds.
       * @default 10000
       */
      requestTimeoutMs?: number;
      /**
       * Allowed HTTP methods for batch dispatch.
       * @default ["GET"]
       */
      allowedMethods?: string[];
    };
  };
  /**
   * Path to the Effect BFF entry module.
   * - Relative paths are resolved from project root.
   * - Defaults to `<apiDirectory>/effect/index`.
   */
  entry?: string;
  /**
   * Enable OpenAPI endpoint generation for Effect HttpApi runtime.
   */
  openapi?:
    | boolean
    | {
        path?: string;
      };
}

export interface BffUserConfig {
  prefix?: string;
  httpMethodDecider?: HttpMethodDecider;
  enableHandleWeb?: boolean;
  crossProject?: boolean;
  /**
   * @internal
   * Runtime create-request import for generated BFF client.
   */
  runtimeCreateRequest?: string;
  /**
   * @internal
   * Custom request creator module for generated BFF client.
   */
  requestCreator?: string;
  /**
   * @internal
   * Marker used by cross-project BFF runtime wiring.
   */
  isCrossProjectServer?: boolean;
  runtimeFramework?: 'hono' | 'effect';
  effect?: BffEffectUserConfig;
}

export type BffNormalizedConfig = BffUserConfig;
