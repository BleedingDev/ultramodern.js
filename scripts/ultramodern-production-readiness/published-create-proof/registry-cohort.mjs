import fs from 'node:fs';
import path from 'node:path';
import {
  assertRegistryDistMatches,
  assertRegistryTarballBytes,
  mapWithConcurrency,
  resolveRegistryPackageDist,
} from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/registry-read.mjs';
import { runAsync } from './process.mjs';

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

async function verifyRegistryCohort({
  release,
  registryUrl,
  env = {},
  workDir,
  runImpl = runAsync,
}) {
  const downloadsDir = path.join(workDir, 'registry-downloads');
  fs.mkdirSync(downloadsDir, { recursive: true });

  async function verifyPackage(item) {
    const specifier = `${item.targetName}@${item.version}`;
    const packageDir = path.join(downloadsDir, item.sha256.slice(0, 16));
    fs.mkdirSync(packageDir, { recursive: true });
    const packOutput = await runImpl(
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
    const downloaded = assertRegistryTarballBytes(
      item,
      fs.readFileSync(downloadedTarball),
    );
    const dist = await resolveRegistryPackageDist(
      item.targetName,
      item.version,
      {
        registryUrl,
        cwd: packageDir,
        env,
        run: async (...args) => ({ stdout: await runImpl(...args) }),
      },
    );
    assertRegistryDistMatches(item, dist);

    return {
      sourceName: item.sourceName,
      targetName: item.targetName,
      version: item.version,
      sha256: downloaded.sha256,
      shasum: downloaded.shasum,
      integrity: downloaded.integrity,
    };
  }

  // Read-only workers drain before workDir cleanup, even when one fails.
  const results = await mapWithConcurrency(release.packages, 8, verifyPackage);

  return {
    packageCount: results.length,
    packages: results,
  };
}

export { verifyRegistryCohort };
