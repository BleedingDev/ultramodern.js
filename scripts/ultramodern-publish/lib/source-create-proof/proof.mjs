import path from 'node:path';
import fsKit from '../../../lib/fs-kit.js';
import { readReleaseManifest } from './release-manifest.mjs';

const { writeJsonFile } = fsKit;

function validateSourceProof({ manifestPath, outPath, now = Date }) {
  const release = readReleaseManifest({ manifestPath });
  const proof = {
    schema: 'bleedingdev.ultramodern.exact-artifact-proof',
    schemaVersion: 2,
    generatedAt: new now().toISOString(),
    gate: 'strict-release-artifacts',
    passed: true,
    manifest: {
      path: release.manifestPath,
      sha256: release.manifestSha256,
      cohortDigest: release.cohortDigest,
    },
    source: { ...release.source },
    release: { ...release.release },
    cohort: {
      aliases: { ...release.aliases },
      packageCount: release.packages.length,
      publishOrder: [...release.publishOrder],
    },
    createPackageProof: {
      ...release.packageChecks.create,
      runtimeProof: {
        owner: 'run-release-acceptance',
        requiredResult: 'native-create',
      },
    },
    packages: release.packages.map(item => {
      const checks = release.packageChecks.packages.find(
        candidate => candidate.sourceName === item.sourceName,
      );
      return {
        sourceName: item.sourceName,
        targetName: item.targetName,
        version: item.version,
        tarballPath: item.tarballPath,
        sha256: item.sha256,
        shasum: item.shasum,
        integrity: item.integrity,
        internalDependencyChecks: checks.internalDependencyChecks,
      };
    }),
  };
  writeJsonFile(path.resolve(outPath), proof);
  return proof;
}

function errorProof({ manifestPath, error, now = Date }) {
  return {
    schema: 'bleedingdev.ultramodern.exact-artifact-proof',
    schemaVersion: 2,
    generatedAt: new now().toISOString(),
    gate: 'strict-release-artifacts',
    passed: false,
    manifestPath: path.resolve(manifestPath),
    error: error instanceof Error ? error.message : String(error),
  };
}

export { errorProof, validateSourceProof };
