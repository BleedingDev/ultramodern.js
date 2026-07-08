import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import fsKit from '../../../lib/fs-kit.js';
import {
  npmPublishAttempts,
  npmPublishRetryDelayMs,
  repoRoot,
  transientNpmPublishErrorPatterns,
} from './constants.mjs';
import { run, runAsync, sleep } from './commands.mjs';
import { orderPublishItems } from './manifest.mjs';

const { readJsonFile } = fsKit;
const execFileAsync = promisify(execFile);

function isTransientNpmPublishError(error) {
  const output = [
    error instanceof Error ? error.message : '',
    typeof error?.stdout === 'string' ? error.stdout : '',
    typeof error?.stderr === 'string' ? error.stderr : '',
  ].join('\n');

  return transientNpmPublishErrorPatterns.some(pattern => pattern.test(output));
}

function packSourcePackage(packageName, packDir) {
  const before = new Set(fs.readdirSync(packDir));
  run(
    'pnpm',
    ['--filter', packageName, 'pack', '--pack-destination', packDir],
    {
      stdio: 'pipe',
    },
  );
  const after = fs.readdirSync(packDir);
  const created = after.filter(
    name => !before.has(name) && name.endsWith('.tgz'),
  );
  if (created.length !== 1) {
    throw new Error(
      `Expected one pack artifact for ${packageName}, got ${created.length}`,
    );
  }
  return path.join(packDir, created[0]);
}

function extractTarball(tarball, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  run('tar', ['-xzf', tarball, '-C', targetDir], { stdio: 'pipe' });
  return path.join(targetDir, 'package');
}

async function packageExists(packageName, version) {
  try {
    return (
      (await resolveRegistryPackageVersion(packageName, version)) === version
    );
  } catch {
    return false;
  }
}

async function resolveRegistryPackageVersion(packageName, version) {
  const { stdout } = await execFileAsync(
    'npm',
    ['view', `${packageName}@${version}`, 'version', '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
    },
  );
  return JSON.parse(stdout);
}

async function resolveRegistryDistTag(packageName, tag) {
  const { stdout } = await execFileAsync(
    'npm',
    ['view', packageName, 'dist-tags', '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
    },
  );
  const distTags = JSON.parse(stdout);
  return typeof distTags?.[tag] === 'string' ? distTags[tag] : undefined;
}

async function resolveRegistryPackageDist(packageName, version) {
  const { stdout } = await execFileAsync(
    'npm',
    ['view', `${packageName}@${version}`, 'dist', '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
    },
  );
  return JSON.parse(stdout);
}

async function assertRegistryTarballReachable(
  packageName,
  version,
  dist,
  fetchImpl = globalThis.fetch,
) {
  if (!dist || typeof dist.tarball !== 'string') {
    throw new Error(`${packageName}@${version} is missing dist.tarball`);
  }

  const response = await fetchImpl(dist.tarball, { method: 'HEAD' });
  if (!response.ok) {
    throw new Error(
      `${packageName}@${version} tarball ${dist.tarball} returned HTTP ${response.status}`,
    );
  }
}

async function verifyRegistryPackage(packageName, version) {
  const attempts = 12;
  const retryDelayMs = 5000;
  let lastError = '';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const publishedVersion = await resolveRegistryPackageVersion(
        packageName,
        version,
      );
      if (publishedVersion !== version) {
        throw new Error(
          `Published package ${packageName}@${version} resolved unexpected version ${publishedVersion}`,
        );
      }
      await assertRegistryTarballReachable(
        packageName,
        version,
        await resolveRegistryPackageDist(packageName, version),
      );
      return;
    } catch (error) {
      lastError =
        error instanceof Error && 'stderr' in error
          ? String(error.stderr)
          : error instanceof Error
            ? error.message
            : String(error);
    }

    if (attempt < attempts) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Published package ${packageName}@${version} was not visible on npm after ${attempts} attempts: ${lastError}`,
  );
}

async function verifyRegistryDistTag(packageName, tag, version) {
  const resolvedVersion = await resolveRegistryDistTag(packageName, tag);
  if (resolvedVersion !== version) {
    throw new Error(
      `${packageName} dist-tag ${tag} points at ${resolvedVersion ?? '<missing>'}, expected ${version}`,
    );
  }
}

async function publishPackage(
  packageDir,
  options,
  runner = runAsync,
  wait = sleep,
  registry = { packageExists },
) {
  const packageJson = readJsonFile(path.join(packageDir, 'package.json'));
  const args = [
    'publish',
    packageDir,
    '--access',
    'public',
    '--tag',
    options.tag,
  ];

  if (options.dryRun) {
    args.push('--dry-run');
  } else {
    args.push('--provenance');
  }

  const maxAttempts = options.dryRun ? 1 : npmPublishAttempts;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runner('npm', args, { captureOutput: true });
      return packageJson.name;
    } catch (error) {
      if (
        !options.dryRun &&
        (await registry.packageExists(packageJson.name, packageJson.version))
      ) {
        console.log(
          `Reusing existing ${packageJson.name}@${packageJson.version} after npm publish returned an error`,
        );
        return packageJson.name;
      }

      const shouldRetry =
        attempt < maxAttempts && isTransientNpmPublishError(error);
      if (!shouldRetry) {
        throw error;
      }

      console.warn(
        `npm publish for ${packageJson.name}@${packageJson.version} failed with a transient registry/provenance error; retrying attempt ${
          attempt + 1
        }/${maxAttempts} in ${npmPublishRetryDelayMs}ms.`,
      );
      await wait(npmPublishRetryDelayMs);
    }
  }

  return packageJson.name;
}

async function validateRegistryCohort(
  manifest,
  options,
  registry = { verifyRegistryDistTag, verifyRegistryPackage },
) {
  if (options.dryRun) {
    console.log('Skipping registry cohort validation for dry-run publish');
    return;
  }

  const failures = [];
  for (const item of manifest.packages) {
    try {
      await registry.verifyRegistryPackage(item.targetName, manifest.version);
      await registry.verifyRegistryDistTag(
        item.targetName,
        options.tag,
        manifest.version,
      );
    } catch (error) {
      failures.push(
        `${item.targetName}@${manifest.version}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      [
        `Registry cohort validation failed for ${manifest.version}.`,
        `The ${options.tag} dist-tag is not coherent for the full cohort.`,
        ...failures,
      ].join('\n'),
    );
  }
}

async function publishManifestPackages(manifest, options) {
  const publishItems = orderPublishItems(manifest.packages, manifest);

  const publishOne = async item => {
    const packageDir = path.join(repoRoot, item.packageDir);
    if (
      !options.dryRun &&
      (await packageExists(item.targetName, options.version))
    ) {
      console.log(
        `Reusing existing ${item.targetName}@${options.version} for full-cohort publish`,
      );
      await verifyRegistryPackage(item.targetName, options.version);
      await verifyRegistryDistTag(
        item.targetName,
        options.tag,
        options.version,
      );
      return;
    }

    const publishedName = await publishPackage(packageDir, options);
    console.log(`Published ${publishedName}@${options.version}`);
    if (!options.dryRun) {
      await verifyRegistryPackage(publishedName, options.version);
    }
  };

  console.log(
    `Publishing ${manifest.packages.length} package(s) in dependency order`,
  );
  if (options.publishConcurrency !== 1) {
    console.log(
      `Ignoring publish concurrency ${options.publishConcurrency}; full-cohort packages publish sequentially so dependency tarballs are fetchable before consumers.`,
    );
  }
  for (const item of publishItems) {
    await publishOne(item);
  }

  await validateRegistryCohort(manifest, options);
}

export {
  assertRegistryTarballReachable,
  extractTarball,
  isTransientNpmPublishError,
  packSourcePackage,
  packageExists,
  publishManifestPackages,
  publishPackage,
  validateRegistryCohort,
  verifyRegistryDistTag,
  verifyRegistryPackage,
};
