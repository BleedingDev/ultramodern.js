import fs from 'node:fs';
import path from 'node:path';
import type { RendererFrameworkPackageBinding } from '@modern-js/app-tools-extensions/renderer-build-identity';
import type { Renderer } from '@modern-js/renderer-core';
import semver from '@modern-js/utils/semver';
import type { RendererBuildProfile } from './renderer-profile';

export interface FrameworkModule {
  readonly specifier: string;
  readonly filename: string;
}

export interface RendererProfileMetadata<
  TRenderer extends Renderer = Renderer,
> {
  readonly profile: RendererBuildProfile<TRenderer>;
  readonly frameworkPackages: readonly RendererFrameworkPackageBinding[];
}

/** Read the physical owner of a resolved public module, including npm aliases. */
export function readRendererFrameworkPackage(
  module: FrameworkModule,
): RendererFrameworkPackageBinding {
  let directory = path.dirname(fs.realpathSync(module.filename));
  for (;;) {
    const manifestFile = path.join(directory, 'package.json');
    if (fs.existsSync(manifestFile)) {
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const formatMarker =
        manifest &&
        typeof manifest === 'object' &&
        !Array.isArray(manifest) &&
        Object.keys(manifest).length === 1 &&
        (manifest.type === 'module' || manifest.type === 'commonjs');
      if (!formatMarker) {
        if (
          !manifest ||
          typeof manifest !== 'object' ||
          Array.isArray(manifest) ||
          typeof manifest.name !== 'string' ||
          !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(
            manifest.name,
          ) ||
          typeof manifest.version !== 'string' ||
          !semver.valid(manifest.version)
        )
          throw new Error(
            `Invalid installed framework manifest for ${module.specifier}: ${manifestFile}`,
          );
        return Object.freeze({
          specifier: module.specifier,
          name: manifest.name,
          version: manifest.version,
          directory,
        });
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error(
        `The public framework module ${module.specifier} has no owning package manifest`,
      );
    directory = parent;
  }
}

/** Native upstream pins stay fixed; selected framework identities are installed facts. */
export function projectInstalledRendererProfile<TRenderer extends Renderer>(
  candidate: RendererBuildProfile<TRenderer>,
  modules: readonly FrameworkModule[],
): RendererProfileMetadata<TRenderer> {
  const frameworkPackages = modules.map(readRendererFrameworkPackage);
  const dependencies = { ...candidate.dependencies };
  let router = { ...candidate.router };
  for (const owner of frameworkPackages) {
    if (Object.hasOwn(dependencies, owner.specifier))
      dependencies[owner.specifier] = owner.version;
    if (router.name === owner.specifier)
      router = { ...router, name: owner.name, version: owner.version };
  }
  return Object.freeze({
    profile: {
      ...candidate,
      dependencies: Object.freeze(dependencies),
      router: Object.freeze(router),
    },
    frameworkPackages: Object.freeze(frameworkPackages),
  });
}
