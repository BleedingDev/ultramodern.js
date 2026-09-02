import type { ModuleFederationValidationTarget } from './types';

export const moduleFederationConfigFile = 'module-federation.config.ts';
export const mfTypesArchives = {
  cloudflare: 'dist-cloudflare/@mf-types.zip',
  node: 'dist/@mf-types.zip',
} as const satisfies Record<ModuleFederationValidationTarget, string>;
export const generatedMetadataPaths = ['.modernjs/ultramodern.json'];
export const defaultAppRootDirs = ['apps', 'verticals'];
export const skippedScanDirs = new Set([
  '.git',
  '.modernjs',
  '.nx',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
]);
