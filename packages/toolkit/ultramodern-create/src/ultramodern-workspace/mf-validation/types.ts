export type JsonRecord = Record<string, unknown>;

export type ModuleFederationConfigInspection = {
  appDir: string;
  configPath: string;
  dts: {
    compilerInstance?: string;
    tsConfigPath?: string;
  };
  exposes: string[];
  hostOnlyNoExposes: boolean;
};

export type ModuleFederationDiscoveredConfig = {
  appDir: string;
  configPath: string;
};

export type ModuleFederationValidationResult = {
  configCount: number;
  exposedAppCount: number;
  hostOnlyAppCount: number;
  apps: ModuleFederationConfigInspection[];
};

export type ModuleFederationValidationOptions = {
  workspaceRoot: string;
  appDirs?: string[];
};

export type BalancedBlock = {
  inner: string;
  suffix: string;
};

export type LocatedObjectLiteral = {
  end: number;
  source: string;
  start: number;
};

export type ParsedObjectLiteral = {
  hasSpread: boolean;
  properties: Map<string, string>;
};
