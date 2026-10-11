export type ModuleFederationConfigInspection = {
  appDir: string;
  configPath: string;
  dts: {
    compilerInstance?: string;
    tsConfigPath?: string;
  };
  exposePaths: Record<string, string>;
  exposes: string[];
  hostOnlyNoExposes: boolean;
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
