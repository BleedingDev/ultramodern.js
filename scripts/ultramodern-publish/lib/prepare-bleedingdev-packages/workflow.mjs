import fs from 'node:fs';
import path from 'node:path';
import fsKit from '../../../lib/fs-kit.js';
import { repoRoot } from './constants.mjs';
import {
  collectModernPackages,
  enforceSingleVersionPolicy,
  rewritePackageJson,
  targetPackageName,
} from './rewrite.mjs';
import {
  generateSourceDeclarations,
  normalizeDeclaredTypePaths,
  validateStagedTypeFiles,
} from './types.mjs';
import { extractTarball, packSourcePackage, publishManifestPackages } from './registry.mjs';
import { validatePublishManifest } from './manifest.mjs';

const { readJsonFile, writeJsonFile } = fsKit;

function assertTrustedPublishContext() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error(
      'Publishing is only allowed from the GitHub Actions trusted publishing workflow. Run without --publish locally to prepare and validate packages.',
    );
  }

  if (process.env.GITHUB_REPOSITORY !== 'BleedingDev/ultramodern.js') {
    throw new Error(
      'Publishing is only allowed from BleedingDev/ultramodern.js.',
    );
  }

  if (process.env.GITHUB_REF !== 'refs/heads/main-ultramodern') {
    throw new Error(
      'Publishing is only allowed from refs/heads/main-ultramodern.',
    );
  }
}

async function prepareBleedingdevPackages(options) {

  if (options.publishExisting) {
    const manifest = readJsonFile(path.join(options.out, 'manifest.json'));
    if (manifest.version !== options.version) {
      throw new Error(
        `Publish manifest version ${manifest.version} does not match --version ${options.version}`,
      );
    }
    validatePublishManifest(manifest);
    assertTrustedPublishContext();
    await publishManifestPackages(manifest, options);
    return;
  }

  const { allPackages, packages, sourceNames, aliases } =
    collectModernPackages(options);
  enforceSingleVersionPolicy(options, packages, allPackages);
  const packDir = path.join(options.out, 'source-tarballs');
  const stageDir = path.join(options.out, 'packages');

  fs.rmSync(options.out, { recursive: true, force: true });
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: options.scope,
    prefix: options.prefix,
    version: options.version,
    dependencyVersion: options.dependencyVersion,
    tag: options.tag,
    aliases,
    packages: [],
  };

  for (const item of packages) {
    const sourceName = item.packageJson.name;
    const targetName = targetPackageName(sourceName, options);
    generateSourceDeclarations(item);
    const tarball = packSourcePackage(sourceName, packDir);
    const packageDir = extractTarball(
      tarball,
      path.join(stageDir, targetName.replaceAll('/', '__')),
    );
    const packageJsonPath = path.join(packageDir, 'package.json');
    const packageJson = readJsonFile(packageJsonPath);
    rewritePackageJson(packageJson, sourceName, options, sourceNames);
    normalizeDeclaredTypePaths(packageDir, packageJson);
    writeJsonFile(packageJsonPath, packageJson);
    validateStagedTypeFiles(packageDir, packageJson);

    manifest.packages.push({
      sourceName,
      targetName,
      version: options.version,
      packageDir: path.relative(repoRoot, packageDir),
    });
  }

  writeJsonFile(path.join(options.out, 'manifest.json'), manifest);
  validatePublishManifest(manifest);

  console.log(
    `Prepared ${manifest.packages.length} package(s) under ${path.relative(
      repoRoot,
      options.out,
    )}`,
  );

  if (!options.publish) {
    console.log(
      'Publish skipped. GitHub Actions trusted publishing is required for npm publish.',
    );
    return;
  }

  assertTrustedPublishContext();
  await publishManifestPackages(manifest, options);

}

export { prepareBleedingdevPackages };
