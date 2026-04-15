export type DevOptions = {
  entry?: string[] | boolean;
  config?: string;
  apiOnly?: boolean;
  analyze?: boolean;
};

export type BuildOptions = {
  config?: string;
  analyze?: boolean;
  watch?: boolean;
};

export type DeployOptions = {
  config?: string;
  skipBuild?: boolean;
};

export type StartOptions = {
  apiOnly?: boolean;
};

export type InspectOptions = {
  env: string;
  output: string;
  verbose?: boolean;
};

export type InfoOptions = {
  config?: string;
  json?: boolean;
};

export type RuntimeStatusOptions = {
  endpoint?: string;
  token?: string;
  tokenEnv?: string;
  headerName?: string;
  timeout?: string;
  json?: boolean;
};

export type RuntimeFallbackSignalOptions = {
  endpoint?: string;
  app: string;
  reason?: string;
  phase?: string;
  entry?: string;
  runtimeDigest?: string;
  metadata?: string;
  token?: string;
  tokenEnv?: string;
  headerName?: string;
  timeout?: string;
  json?: boolean;
};
