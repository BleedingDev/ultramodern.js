export const moduleFederationConfigFile = 'module-federation.config.ts';
export const mfTypesArchive = 'dist/@mf-types.zip';
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
