import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const defaultAppDirs = [
  'verticals/commerce',
  'verticals/identity',
  'verticals/design-system',
];

const candidateDirs = process.argv.slice(2);
const appDirs = candidateDirs.length
  ? candidateDirs
  : fs.existsSync(path.join(root, 'module-federation.config.ts'))
    ? ['.']
    : defaultAppDirs;

for (const appDir of appDirs) {
  const configPath = path.join(root, appDir, 'module-federation.config.ts');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Missing Module Federation config: ${path.relative(root, configPath)}`,
    );
  }

  const config = fs.readFileSync(configPath, 'utf-8');
  if (!config.includes('exposes:') || config.includes('dts: false')) {
    continue;
  }

  const typesArchivePath = path.join(root, appDir, 'dist/@mf-types.zip');
  if (!fs.existsSync(typesArchivePath)) {
    throw new Error(
      `Missing Module Federation DTS archive: ${path.relative(root, typesArchivePath)}`,
    );
  }

  const stats = fs.statSync(typesArchivePath);
  if (stats.size === 0) {
    throw new Error(
      `Empty Module Federation DTS archive: ${path.relative(root, typesArchivePath)}`,
    );
  }
}
