// Consumer: prepare-bleedingdev-packages.mjs release staging and publish orchestration.
import fs from 'node:fs';
import path from 'node:path';
import fsKit from '../../../lib/fs-kit.js';
import {
  repoRoot,
  sidecarAliasConsumerTargetName,
  sidecarStagingDirectory,
  trustedPublishRef,
  trustedPublishRepository,
} from './constants.mjs';
import {
  collectSidecarPackages,
  stageSidecarPackage,
  validateAliasConsistency,
  writeSidecarStagingManifest,
} from './sidecars.mjs';
import {
  collectModernPackages,
  enforceSingleVersionPolicy,
  rewritePackageJson,
  targetPackageName,
} from './rewrite.mjs';
import {
  normalizeDeclaredTypePaths,
  validateStagedTypeFiles,
} from './types.mjs';
import { validatePublishManifest } from './manifest.mjs';
import {
  createReleaseArtifacts,
  resolveSourceIdentity,
  verifyReleaseArtifacts,
} from './release-artifacts.mjs';
import {
  extractTarball,
  packSourcePackage,
  publishManifestPackages,
} from './registry.mjs';
import { assertCleanCommittedSource } from '../release-source-state.mjs';
import { resolveOwnedPreparationOutput } from './options.mjs';

const { readJsonFile, writeJsonFile } = fsKit;

function assertTrustedPublishContext() {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error(
      'Publishing is only allowed from the GitHub Actions trusted publishing workflow. Run without --publish locally to prepare and validate packages.',
    );
  }

  if (process.env.GITHUB_REPOSITORY !== trustedPublishRepository) {
    throw new Error(
      `Publishing is only allowed from ${trustedPublishRepository}.`,
    );
  }

  if (process.env.GITHUB_REF !== trustedPublishRef) {
    throw new Error(
      `Publishing is only allowed from ${trustedPublishRef}.`,
    );
  }
}

async function prepareBleedingdevPackages(options) {
  if (!options.publishExisting) {
    options.out = resolveOwnedPreparationOutput(options.out);
  }

  const sourceCommit = assertCleanCommittedSource(repoRoot);

  if (options.publishExisting) {
    const { allPackages, aliases, packages, sourceNames } =
      collectModernPackages(options);
    enforceSingleVersionPolicy(options, packages, allPackages);
    assertCleanCommittedSource(repoRoot, { expectedCommit: sourceCommit });
    const source = { ...resolveSourceIdentity(), commit: sourceCommit };
    const releaseArtifacts = verifyReleaseArtifacts(options.out, {
      aliases,
      source,
      sourceNames: [...sourceNames],
      tag: options.tag,
      version: options.version,
    });
    assertTrustedPublishContext();
    await publishManifestPackages(releaseArtifacts, options);
    return;
  }

  const { allPackages, packages, sourceNames, aliases } =
    collectModernPackages(options);
  enforceSingleVersionPolicy(options, packages, allPackages);
  const packDir = path.join(options.out, 'source-tarballs');
  const stageDir = path.join(options.out, 'packages');
  // Read the sidecar roots before the output directory is recreated so an
  // invalid sidecar fails the run before anything is staged.
  const sidecars = options.includeSidecars
    ? collectSidecarPackages(repoRoot)
    : [];

  options.out = resolveOwnedPreparationOutput(options.out);
  fs.rmSync(options.out, { recursive: true, force: true });
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const stagedSidecars = [];
  if (options.includeSidecars) {
    const sidecarStageDir = path.join(options.out, sidecarStagingDirectory);
    fs.mkdirSync(sidecarStageDir, { recursive: true });
    for (const sidecar of sidecars) {
      stagedSidecars.push(stageSidecarPackage(sidecar, sidecarStageDir));
    }
  }

  const stagingManifest = {
    aliases,
    packages: [],
  };
  const stagedManifests = [];

  for (const item of packages) {
    const sourceName = item.packageJson.name;
    const targetName = targetPackageName(sourceName, options);
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

    stagedManifests.push({ name: targetName, packageJson });
    stagingManifest.packages.push({
      sourceName,
      targetName,
      version: options.version,
      packageDir: path.relative(repoRoot, packageDir),
    });
  }

  if (options.includeSidecars) {
    validateAliasConsistency(stagedManifests, stagedSidecars, {
      cohortTargetNames: new Set(Object.values(aliases)),
    });
    const { manifest: sidecarManifest, manifestPath } =
      writeSidecarStagingManifest(options.out, stagedSidecars, {
        publishBefore: sidecarAliasConsumerTargetName,
      });
    console.log(
      [
        `Staged ${sidecarManifest.packages.length} version-preserving sidecar package(s): ${sidecarManifest.packages
          .map(item => `${item.name}@${item.version}`)
          .join(', ')}`,
        `Publish order recorded in ${path.relative(repoRoot, manifestPath)}; these must reach npm before ${sidecarAliasConsumerTargetName}.`,
      ].join('\n'),
    );
  }

  validatePublishManifest(stagingManifest);
  assertCleanCommittedSource(repoRoot, { expectedCommit: sourceCommit });
  const releaseArtifacts = createReleaseArtifacts({
    aliases,
    outDir: options.out,
    packages: stagingManifest.packages,
    source: { ...resolveSourceIdentity(), commit: sourceCommit },
    tag: options.tag,
    version: options.version,
  });

  console.log(
    `Prepared ${releaseArtifacts.manifest.packages.length} immutable package artifact(s) under ${path.relative(repoRoot, options.out)}`,
  );

  if (!options.publish) {
    console.log(
      'Publish skipped. GitHub Actions trusted publishing is required for npm publish.',
    );
    return;
  }

  assertTrustedPublishContext();
  await publishManifestPackages(releaseArtifacts, options);
}

export { prepareBleedingdevPackages };
