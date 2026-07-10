import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  npmPublishAttempts,
  npmPublishRetryDelayMs,
  npmRegistryOrigin,
  repoRoot,
  transientNpmPublishErrorPatterns,
} from './constants.mjs';
import { run, sleep } from './commands.mjs';
import {
  publishAcceptedPackage,
  validateAcceptedPackageDryRun,
} from './npm-buffer-publisher.mjs';
import {
  assertVerifiedReleaseArtifacts,
  readVerifiedPackageArtifactBytes,
  verifyPackageArtifact,
  verifyPackageArtifactBytes,
} from './release-artifacts.mjs';
import {
  createRegistryProvenanceExpectation,
  verifyRegistryProvenance,
} from './provenance.mjs';

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
  return (await lookupRegistryPackageDist(packageName, version)) !== null;
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
  if (!distTags || typeof distTags !== 'object' || Array.isArray(distTags)) {
    throw new Error(`${packageName} returned invalid registry dist-tags`);
  }
  return typeof distTags[tag] === 'string' ? distTags[tag] : undefined;
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
  const dist = JSON.parse(stdout);
  if (!dist || typeof dist !== 'object' || Array.isArray(dist)) {
    throw new Error(
      `${packageName}@${version} returned invalid registry dist metadata`,
    );
  }
  return dist;
}

function isRegistryNotFoundError(error) {
  const output = [
    error instanceof Error ? error.message : '',
    typeof error?.stdout === 'string' ? error.stdout : '',
    typeof error?.stderr === 'string' ? error.stderr : '',
  ].join('\n');
  return (
    /\bE404\b/u.test(output) ||
    /404 Not Found/u.test(output) ||
    /is not in this registry/u.test(output)
  );
}

async function lookupRegistryDistTag(packageName, tag) {
  try {
    return await resolveRegistryDistTag(packageName, tag);
  } catch (error) {
    if (isRegistryNotFoundError(error)) {
      return undefined;
    }
    throw new Error(
      `Registry dist-tag state is uncertain for ${packageName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

async function lookupRegistryPackageDist(packageName, version) {
  try {
    return await resolveRegistryPackageDist(packageName, version);
  } catch (error) {
    if (isRegistryNotFoundError(error)) {
      return null;
    }
    throw new Error(
      `Registry state is uncertain for ${packageName}@${version}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function assertRegistryDistMatches(item, dist) {
  const mismatches = [];
  if (dist?.integrity !== item.integrity) {
    mismatches.push(
      `integrity expected ${item.integrity}, found ${String(dist?.integrity)}`,
    );
  }
  if (dist?.shasum !== item.shasum) {
    mismatches.push(
      `shasum expected ${item.shasum}, found ${String(dist?.shasum)}`,
    );
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Registry artifact identity mismatch for ${item.targetName}@${item.version}: ${mismatches.join(
        '; ',
      )}`,
    );
  }
}

function pinnedRegistryTarballUrl(item, value) {
  if (typeof value !== 'string' || value.trim() !== value || value === '') {
    throw new Error(`${item.targetName}@${item.version} is missing dist.tarball`);
  }
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(
      `${item.targetName}@${item.version} registry tarball URL is invalid`,
      { cause: error },
    );
  }
  const packageBaseName = item.targetName.slice(
    item.targetName.lastIndexOf('/') + 1,
  );
  const expectedPath = `/${item.targetName}/-/${packageBaseName}-${item.version}.tgz`;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch (error) {
    throw new Error(
      `${item.targetName}@${item.version} registry tarball URL has invalid encoding`,
      { cause: error },
    );
  }
  if (
    url.origin !== npmRegistryOrigin ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    decodedPath !== expectedPath
  ) {
    throw new Error(
      `${item.targetName}@${item.version} registry tarball URL is not the pinned npm endpoint ${npmRegistryOrigin}${expectedPath}`,
    );
  }
  return url.href;
}

async function verifyRegistryTarball(
  item,
  dist,
  fetchImpl = globalThis.fetch,
) {
  const packageLabel = `${item.targetName}@${item.version}`;
  const tarballUrl = pinnedRegistryTarballUrl(item, dist?.tarball);
  if (typeof fetchImpl !== 'function') {
    throw new Error(`${packageLabel} registry tarball fetch is unavailable`);
  }
  let response;
  try {
    response = await fetchImpl(tarballUrl, {
      headers: { accept: 'application/octet-stream' },
      method: 'GET',
      redirect: 'error',
    });
  } catch (error) {
    throw new Error(
      `${packageLabel} registry tarball request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  if (!response?.ok) {
    throw new Error(
      `${packageLabel} registry tarball ${tarballUrl} returned HTTP ${String(
        response?.status ?? '<unknown>',
      )}`,
    );
  }
  if (typeof response.arrayBuffer !== 'function') {
    throw new Error(`${packageLabel} registry tarball response is malformed`);
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(`${packageLabel} registry tarball body could not be read`, {
      cause: error,
    });
  }

  const actual = {
    integrity: `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    shasum: crypto.createHash('sha1').update(bytes).digest('hex'),
    size: bytes.length,
  };
  const mismatches = [];
  for (const field of ['size', 'sha256', 'shasum', 'integrity']) {
    if (actual[field] !== item[field]) {
      mismatches.push(
        `${field} expected ${String(item[field])}, found ${String(actual[field])}`,
      );
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Registry tarball byte mismatch for ${packageLabel}: ${mismatches.join(
        '; ',
      )}`,
    );
  }
  return { ...actual, tarballUrl };
}

async function verifyRegistryPackageDist(
  item,
  dist,
  provenanceExpectation,
  registry = {
    assertRegistryDistMatches,
    verifyRegistryProvenance,
    verifyRegistryTarball,
  },
) {
  registry.assertRegistryDistMatches(item, dist);
  await registry.verifyRegistryTarball(item, dist);
  await registry.verifyRegistryProvenance(
    item,
    dist,
    provenanceExpectation,
  );
  return dist;
}

async function verifyRegistryPackage(
  item,
  provenanceExpectation,
  registry = {
    assertRegistryDistMatches,
    lookupRegistryPackageDist,
    verifyRegistryPackageDist,
    verifyRegistryProvenance,
    verifyRegistryTarball,
  },
) {
  const attempts = 12;
  const retryDelayMs = 5000;
  let lastError = '';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const dist = await registry.lookupRegistryPackageDist(
      item.targetName,
      item.version,
    );
    if (dist === null) {
      lastError = `${item.targetName}@${item.version} is not present in the registry`;
    } else {
      try {
        await registry.verifyRegistryPackageDist(
          item,
          dist,
          provenanceExpectation,
          {
            assertRegistryDistMatches: registry.assertRegistryDistMatches,
            verifyRegistryProvenance: registry.verifyRegistryProvenance,
            verifyRegistryTarball: registry.verifyRegistryTarball,
          },
        );
        return dist;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (attempt < attempts) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Published package ${item.targetName}@${item.version} did not verify on npm after ${attempts} attempts: ${lastError}`,
  );
}

async function verifyRegistryDistTag(packageName, tag, version) {
  const resolvedVersion = await lookupRegistryDistTag(packageName, tag);
  if (resolvedVersion !== version) {
    throw new Error(
      `${packageName} dist-tag ${tag} points at ${resolvedVersion ?? '<missing>'}, expected ${version}`,
    );
  }
}

async function preflightRegistryPackages(
  publishItems,
  options,
  provenanceExpectation,
  registry = {
    lookupRegistryDistTag,
    lookupRegistryPackageDist,
    verifyRegistryPackageDist,
  },
) {
  const failures = [];
  const states = new Map();
  for (const item of publishItems) {
    try {
      const [dist, currentTag] = await Promise.all([
        registry.lookupRegistryPackageDist(item.targetName, item.version),
        registry.lookupRegistryDistTag(item.targetName, options.tag),
      ]);
      if (dist !== null) {
        await registry.verifyRegistryPackageDist(
          item,
          dist,
          provenanceExpectation,
        );
        if (currentTag !== item.version) {
          throw new Error(
            `${item.targetName} dist-tag ${options.tag} points at ${currentTag ?? '<missing>'}, expected ${item.version}`,
          );
        }
        states.set(item.targetName, { currentTag, dist, exists: true });
        continue;
      }

      if (currentTag === item.version) {
        throw new Error(
          `${item.targetName} dist-tag ${options.tag} points at ${item.version}, but that exact registry version is absent`,
        );
      }
      states.set(item.targetName, { currentTag, dist: null, exists: false });
      const prefix = options.dryRun
        ? 'Dry-run registry preflight'
        : 'Registry publish preflight';
      console.log(
        `${prefix}: ${item.targetName}@${item.version} is absent; provenance equivalence cannot be asserted before publication. Current ${options.tag}: ${currentTag ?? '<missing>'}.`,
      );
    } catch (error) {
      failures.push(
        `${item.targetName}@${item.version}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(
      [
        `Registry publish preflight failed for ${options.version}.`,
        ...failures,
      ].join('\n'),
    );
  }
  return states;
}

async function publishPackage(
  artifact,
  options,
  overrides = {},
) {
  const registry = {
    assertRegistryDistMatches,
    lookupRegistryPackageDist,
    verifyRegistryPackageDist,
    verifyRegistryProvenance,
    verifyRegistryTarball,
    ...overrides.registry,
  };
  const artifactReader =
    overrides.artifactReader ?? readVerifiedPackageArtifactBytes;
  const acceptedBytes = Buffer.from(
    artifactReader(artifact, artifact.artifactPath),
  );
  const publishAcceptedPackageImpl =
    overrides.publishAcceptedPackage ?? publishAcceptedPackage;
  const validateAcceptedPackageDryRunImpl =
    overrides.validateAcceptedPackageDryRun ?? validateAcceptedPackageDryRun;
  const wait = overrides.wait ?? sleep;
  const maxAttempts = options.dryRun ? 1 : npmPublishAttempts;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const acceptedArtifact = verifyPackageArtifactBytes(
      artifact,
      acceptedBytes,
    );
    try {
      try {
        if (options.dryRun) {
          await validateAcceptedPackageDryRunImpl(
            acceptedArtifact,
            acceptedBytes,
            options,
          );
        } else {
          await publishAcceptedPackageImpl(
            acceptedArtifact,
            acceptedBytes,
            options,
          );
        }
      } finally {
        verifyPackageArtifactBytes(artifact, acceptedBytes);
      }
    } catch (error) {
        if (!options.dryRun && options.provenanceExpectation) {
          const dist = await registry.lookupRegistryPackageDist(
            artifact.targetName,
            artifact.version,
          );
          if (dist !== null) {
            await registry.verifyRegistryPackageDist(
              artifact,
              dist,
              options.provenanceExpectation,
              {
                assertRegistryDistMatches: registry.assertRegistryDistMatches,
                verifyRegistryProvenance: registry.verifyRegistryProvenance,
                verifyRegistryTarball: registry.verifyRegistryTarball,
              },
            );
            console.log(
              `Reusing byte-identical ${artifact.targetName}@${artifact.version} after npm publish returned an error`,
            );
            return artifact.targetName;
          }
        }

        const shouldRetry =
          attempt < maxAttempts && isTransientNpmPublishError(error);
        if (!shouldRetry) {
          throw error;
        }

        console.warn(
          `npm publish for ${artifact.targetName}@${artifact.version} failed with a transient registry/provenance error; retrying attempt ${
            attempt + 1
          }/${maxAttempts} in ${npmPublishRetryDelayMs}ms.`,
        );
        await wait(npmPublishRetryDelayMs);
        continue;
    }

    return artifact.targetName;
  }
  return artifact.targetName;
}

async function validateRegistryCohort(
  manifest,
  options,
  registry = { verifyRegistryDistTag, verifyRegistryPackage },
) {
  if (options.dryRun) {
    console.log('Skipping final registry cohort assertion for dry-run publish');
    return;
  }

  const provenanceExpectation =
    createRegistryProvenanceExpectation(manifest);
  const failures = [];
  for (const item of manifest.packages) {
    try {
      await registry.verifyRegistryPackage(item, provenanceExpectation);
      await registry.verifyRegistryDistTag(
        item.targetName,
        options.tag,
        manifest.release.version,
      );
    } catch (error) {
      failures.push(
        `${item.targetName}@${manifest.release.version}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      [
        `Registry cohort validation failed for ${manifest.release.version}.`,
        `The ${options.tag} dist-tag is not coherent for the full cohort.`,
        ...failures,
      ].join('\n'),
    );
  }
}

async function publishManifestPackages(
  releaseArtifacts,
  options,
  overrides = {},
) {
  const registry = {
    assertRegistryDistMatches,
    lookupRegistryDistTag,
    lookupRegistryPackageDist,
    preflightRegistryPackages,
    publishPackage,
    validateRegistryCohort,
    verifyPackageArtifact,
    verifyRegistryDistTag,
    verifyRegistryPackage,
    verifyRegistryPackageDist,
    verifyRegistryProvenance,
    verifyRegistryTarball,
    ...overrides,
  };
  assertVerifiedReleaseArtifacts(releaseArtifacts);
  const { manifest } = releaseArtifacts;
  if (
    manifest.release.version !== options.version ||
    manifest.release.tag !== options.tag
  ) {
    throw new Error(
      `Verified release ${manifest.release.version} (${manifest.release.tag}) does not match publish request ${options.version} (${options.tag})`,
    );
  }
  const provenanceExpectation =
    createRegistryProvenanceExpectation(manifest);

  const artifactsByTarget = new Map(
    releaseArtifacts.packages.map(item => [item.targetName, item]),
  );
  const publishItems = manifest.publishOrder.map(targetName => {
    const artifact = artifactsByTarget.get(targetName);
    if (!artifact) {
      throw new Error(`Verified release is missing artifact ${targetName}`);
    }
    return artifact;
  });

  for (const artifact of publishItems) {
    registry.verifyPackageArtifact(artifact, artifact.artifactPath);
  }
  const preflight = await registry.preflightRegistryPackages(
    publishItems,
    options,
    provenanceExpectation,
    {
      lookupRegistryDistTag: registry.lookupRegistryDistTag,
      lookupRegistryPackageDist: registry.lookupRegistryPackageDist,
      verifyRegistryPackageDist: registry.verifyRegistryPackageDist,
    },
  );

  console.log(
    `Publishing ${publishItems.length} immutable package artifact(s) in dependency order`,
  );
  if (options.publishConcurrency !== 1) {
    console.log(
      `Ignoring publish concurrency ${options.publishConcurrency}; full-cohort packages publish sequentially so dependency tarballs are fetchable before consumers.`,
    );
  }
  for (const artifact of publishItems) {
    const state = preflight.get(artifact.targetName);
    if (!state) {
      throw new Error(
        `Registry preflight omitted ${artifact.targetName}@${artifact.version}`,
      );
    }
    if (!options.dryRun && state.exists) {
      console.log(
        `Reusing byte-identical ${artifact.targetName}@${artifact.version} for full-cohort publish`,
      );
      continue;
    }

    const publishedName = await registry.publishPackage(artifact, {
      ...options,
      acceptedTools: manifest.tools,
      provenanceExpectation,
    });
    console.log(
      options.dryRun
        ? `Dry-run validated ${publishedName}@${artifact.version}`
        : `Published ${publishedName}@${artifact.version}`,
    );
    registry.verifyPackageArtifact(artifact, artifact.artifactPath);
    if (!options.dryRun) {
      await registry.verifyRegistryPackage(artifact, provenanceExpectation);
    }
  }

  if (!options.dryRun) {
    await registry.validateRegistryCohort(manifest, options, {
      verifyRegistryDistTag: registry.verifyRegistryDistTag,
      verifyRegistryPackage: registry.verifyRegistryPackage,
    });
  }
}

export {
  assertRegistryDistMatches,
  createRegistryProvenanceExpectation,
  extractTarball,
  isRegistryNotFoundError,
  isTransientNpmPublishError,
  lookupRegistryDistTag,
  lookupRegistryPackageDist,
  packSourcePackage,
  packageExists,
  preflightRegistryPackages,
  publishManifestPackages,
  publishPackage,
  validateRegistryCohort,
  verifyRegistryDistTag,
  verifyRegistryPackage,
  verifyRegistryPackageDist,
  verifyRegistryProvenance,
  verifyRegistryTarball,
};
