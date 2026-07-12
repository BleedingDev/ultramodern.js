import type { UltramodernBridgeConfig } from '../../ultramodern-workspace/bridge-config';
import type {
  ResolvedPackageSource,
  VerticalPreset,
  WorkspaceApi,
  WorkspaceApp,
  WorkspaceDeliveryUnitKind,
} from '../../ultramodern-workspace/types';

export type UltramodernToolingConfigSource = 'compact';

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
  schemaVersion: number;
  profile?: string;
  source: UltramodernToolingConfigSource;
  sourcePath: string;
  workspace: {
    packageScope: string;
  };
  packageSource?: ResolvedPackageSource;
  features: {
    tailwind: boolean;
  };
  bridge?: UltramodernBridgeConfig;
  topology: {
    apps: UltramodernToolingConfigApp[];
  };
};
