import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Keep generated handlers portable through a declared public import of this SDK owner. */
export function resolveSdkServerPlugin(
  appDirectory: string,
  subpath: 'server-plugin' | 'native-server-plugin',
  registrarUrl = import.meta.url,
): string {
  const label = subpath === 'server-plugin' ? 'React' : 'Native';
  const appManifestFile = path.join(appDirectory, 'package.json');
  const appManifest = JSON.parse(fs.readFileSync(appManifestFile, 'utf8'));
  let owner = path.dirname(fileURLToPath(registrarUrl));
  let ownerName: string;
  for (;;) {
    const manifestFile = path.join(owner, 'package.json');
    if (fs.existsSync(manifestFile)) {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      if (
        ![
          '@modern-js/ultramodern-app-tools',
          '@bleedingdev/modern-js-ultramodern-app-tools',
        ].includes(manifest.name) ||
        !manifest.exports?.[`./${subpath}`]
      )
        throw new Error(`${label} server registrar is not its owning package`);
      ownerName = manifest.name;
      break;
    }
    const parent = path.dirname(owner);
    if (parent === owner)
      throw new Error(`${label} server registrar has no owning package`);
    owner = parent;
  }
  const ownerRequire = createRequire(path.join(owner, 'package.json'));
  const ownerExport = fs.realpathSync(
    ownerRequire.resolve(`${ownerName}/${subpath}`),
  );
  const appRequire = createRequire(appManifestFile);
  const declared = {
    ...appManifest.dependencies,
    ...appManifest.devDependencies,
    ...appManifest.optionalDependencies,
  };
  for (const name of new Set(['@modern-js/ultramodern-app-tools', ownerName])) {
    if (typeof declared[name] !== 'string') continue;
    const specifier = `${name}/${subpath}`;
    if (fs.realpathSync(appRequire.resolve(specifier)) === ownerExport)
      return specifier;
  }
  throw new Error(
    `${label} server plugin has no declared application import of its SDK owner`,
  );
}
