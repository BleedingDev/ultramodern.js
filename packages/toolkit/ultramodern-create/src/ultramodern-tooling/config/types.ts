import type {
  ResolvedPackageSource,
  VerticalPreset,
  WorkspaceApi,
  WorkspaceApp,
  WorkspaceDeliveryUnitKind,
} from '../../ultramodern-workspace/types';

export type UltramodernToolingConfigApp = {
  id: string;
  kind: WorkspaceApp['kind'];
  path: string;
  package?: string;
  packageSuffix?: string;
  displayName?: string;
  domain?: string;
  surfaceProfile?: VerticalPreset;
  deliveryUnitKind?: WorkspaceDeliveryUnitKind;
  deliveryUnit?: WorkspaceApp['deliveryUnit'];
  port?: number;
  portEnv?: string;
  moduleFederation?: {
    role?: 'host' | 'remote';
    name?: string;
    exposes?: string[];
    exposePaths?: Record<string, string>;
    verticalRefs?: string[];
    hostOnly?: boolean;
    noExposes?: boolean;
  };
  api?: WorkspaceApi;
};

export type UltramodernToolingConfig = {
  workspace: {
    packageScope: string;
  };
  packageSource?: ResolvedPackageSource;
  features: {
    tailwind: boolean;
  };
  inheritedWorkspaceDependencies: Record<string, string>;
  topology: {
    apps: UltramodernToolingConfigApp[];
  };
};
