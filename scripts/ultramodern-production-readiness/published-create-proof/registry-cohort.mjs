import fs from 'node:fs';
import path from 'node:path';
import { computeTarballDigests } from '../../ultramodern-publish/lib/source-create-proof/release-manifest.mjs';
import { run } from './process.mjs';

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(
      `${label} did not return valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, found ${actual}`);
  }
}

function verifyRegistryCohort({
  release,
  registryUrl,
  env = {},
  workDir,
  runImpl = run,
}) {
  const results = [];
  const downloadsDir = path.join(workDir, 'registry-downloads');
  fs.mkdirSync(downloadsDir, { recursive: true });

  for (const item of release.packages) {
    const specifier = `${item.targetName}@${item.version}`;
    const packageDir = path.join(downloadsDir, item.sha256.slice(0, 16));
    fs.mkdirSync(packageDir, { recursive: true });
    const packOutput = runImpl(
      'npm',
      [
        'pack',
        specifier,
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        packageDir,
        '--registry',
        registryUrl,
      ],
      { cwd: packageDir, env, stdio: 'pipe' },
    );
    const packResult = parseJsonOutput(packOutput, `npm pack ${specifier}`);
    const filename = packResult[0]?.filename;
    if (packResult.length !== 1 || typeof filename !== 'string') {
      throw new Error(`${specifier} npm pack must return exactly one tarball`);
    }
    const downloadedTarball = path.join(packageDir, filename);
    if (!fs.existsSync(downloadedTarball)) {
      throw new Error(
        `${specifier} downloaded tarball is missing: ${downloadedTarball}`,
      );
    }
    const downloaded = computeTarballDigests(downloadedTarball);
    assertEqual(
      downloaded.sha256,
      item.sha256,
      `${specifier} downloaded sha256 mismatch`,
    );
    assertEqual(
      downloaded.shasum,
      item.shasum,
      `${specifier} downloaded shasum mismatch`,
    );
    assertEqual(
      downloaded.integrity,
      item.integrity,
      `${specifier} downloaded integrity mismatch`,
    );

    const distOutput = runImpl(
      'npm',
      ['view', specifier, 'dist', '--json', '--registry', registryUrl],
      { cwd: packageDir, env, stdio: 'pipe' },
    );
    const dist = parseJsonOutput(distOutput, `npm view ${specifier} dist`);
    assertEqual(
      dist.integrity,
      item.integrity,
      `${specifier} registry metadata integrity mismatch`,
    );
    assertEqual(
      dist.shasum,
      item.shasum,
      `${specifier} registry metadata shasum mismatch`,
    );

    results.push({
      sourceName: item.sourceName,
      targetName: item.targetName,
      version: item.version,
      sha256: downloaded.sha256,
      shasum: downloaded.shasum,
      integrity: downloaded.integrity,
    });
  }

  return {
    packageCount: results.length,
    packages: results,
  };
}

export { verifyRegistryCohort };
