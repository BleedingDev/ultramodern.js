import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  type ConfigSourceSnapshot,
  captureConfigSourceSnapshot,
} from './config-evaluator/source-snapshot';

/** Keep generated handlers portable through a declared public import of this SDK owner. */
export function resolveSdkServerPlugin(
  appDirectory: string,
  subpath: 'server-plugin' | 'native-server-plugin',
  registrarUrl = import.meta.url,
  snapshot?: ConfigSourceSnapshot,
): string {
  const label = subpath === 'server-plugin' ? 'React' : 'Native';
  const original =
    snapshot && new Map(snapshot.states.map(state => [state.path, state]));
  const assertOriginalDeclaration = (filename: string) => {
    if (!original) return;
    const current = captureConfigSourceSnapshot({
      sourceRoots: [],
      extraInputs: [filename],
    });
    if (
      current.states.some(
        state => !isDeepStrictEqual(state, original.get(state.path)),
      )
    )
      throw new Error(
        `${label} server plugin declaration changed after configuration load`,
      );
  };
  const appManifestFile = path.join(appDirectory, 'package.json');
  assertOriginalDeclaration(appManifestFile);
  const appManifest = JSON.parse(fs.readFileSync(appManifestFile, 'utf8'));
  assertOriginalDeclaration(appManifestFile);
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
    const slot = appRequire.resolve
      .paths(name)
      ?.map(directory => path.join(directory, name))
      .find(directory => fs.existsSync(directory));
    if (slot) assertOriginalDeclaration(path.join(slot, 'package.json'));
    const specifier = `${name}/${subpath}`;
    if (fs.realpathSync(appRequire.resolve(specifier)) === ownerExport)
      return specifier;
  }
  throw new Error(
    `${label} server plugin has no declared application import of its SDK owner`,
  );
}
