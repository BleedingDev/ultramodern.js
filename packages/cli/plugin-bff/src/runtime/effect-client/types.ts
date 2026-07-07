// @effect-diagnostics processEnv:off strictBooleanExpressions:off
export type GeneratedEffectEndpoint = {
  apiId: string;
  group: string;
  endpoint: string;
  method: string;
  routePath: string;
  /** Per-endpoint operation contract hash (bff-core hash). */
  schemaHash: string;
  operationVersion: number;
};

export type GeneratedEffectBatchConfig = {
  enabled: boolean;
  endpoint: string;
  flushIntervalMs: number;
  maxBatchSize: number;
  maxBatchBytes: number;
  requestTimeoutMs: number;
  allowedMethods: string[];
};

export type GeneratedEffectClientConfig = {
  appNamespace: string;
  /** Cross-project producer id; absent for same-project clients. */
  requestId?: string;
  port: number;
  /** Resolve the port from process.env.PORT first (server bundles). */
  useEnvPort?: boolean;
  defaultOrigin: string;
  httpMethodDecider?: string;
  batch: GeneratedEffectBatchConfig;
};

export type EffectOperationDescriptor = {
  appNamespace: string;
  apiId: string;
  group: string;
  endpoint: string;
  operationId: string;
  routePath: string;
  method: string;
  operationVersion: number;
  schemaHash: string;
  version: number;
};

export type EffectClientOperation = (request?: unknown) => Promise<unknown>;
export type EffectClientGroup = Record<string, EffectClientOperation>;
export type EffectClient = Record<string, EffectClientGroup>;
export type EffectOperationManifest = Record<
  string,
  Record<string, EffectOperationDescriptor>
>;

export type EffectRequestContextInput = Record<string, unknown>;

export type EffectRequestContext = {
  headers: Record<string, string>;
} & Record<string, unknown>;

/** Structural slice of `@modern-js/create-request` the runtime relies on. */
export type EffectRequestRuntime = {
  createRequest: (options: {
    path: string;
    method: string;
    port: number | string;
    operationContext: Record<string, unknown>;
    httpMethodDecider: string;
    requestId?: string;
  }) => (...args: unknown[]) => Promise<unknown>;
  configure?: (options: Record<string, unknown>) => void;
  createRequestContextHeaders?: (
    input: EffectRequestContextInput,
  ) => Record<string, string>;
};

export type GeneratedEffectClientModule = {
  client: EffectClient;
  operationManifest: EffectOperationManifest;
  createEffectRequestContext: (
    requestContext: EffectRequestContextInput,
  ) => EffectRequestContext;
};
