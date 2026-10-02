import type { ModuleFederationConfigInspection } from '@modern-js/app-tools-extensions/module-federation-config';

export type JsonRecord = Record<string, unknown>;

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

export type ModuleFederationValidationTarget = 'cloudflare' | 'node';

export type ModuleFederationValidationOptions = {
  workspaceRoot: string;
  appDirs?: string[];
  target?: ModuleFederationValidationTarget;
};
