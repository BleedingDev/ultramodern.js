import type { BffUserConfig } from '@modern-js/server-core';
import type { ServerPlugin } from '@modern-js/types';
import type { CloudflareDeployConfig } from '../config';

export interface CloudflareAppContext {
  apiOnly: boolean;
  appDirectory: string;
  distDirectory: string;
  serverPlugins: ServerPlugin[];
}

export interface CloudflareModernConfig {
  bff?: BffUserConfig;
  deploy?: CloudflareDeployConfig;
}

export interface CloudflarePresetApi {
  isPluginExists(name: string): boolean;
}

export type CloudflareDeployPreset = {
  prepare?: () => Promise<void>;
  writeOutput?: () => Promise<void>;
  genEntry?: () => Promise<void>;
  end?: () => Promise<void>;
};

export type CreateCloudflarePreset = (params: {
  appContext: CloudflareAppContext;
  modernConfig: CloudflareModernConfig;
  api: CloudflarePresetApi;
  needModernServer?: boolean;
}) => CloudflareDeployPreset;
