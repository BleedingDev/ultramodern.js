// Consumer: release acceptance, publish outcomes, and downstream exact-artifact readers.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  releaseManifestFile,
  verifyReleaseArtifacts,
} from '../prepare-bleedingdev-packages/release-artifacts.mjs';
import { ultramodernCreateSourceName } from '../prepare-bleedingdev-packages/constants.mjs';

function hashBuffer(buffer, algorithm, encoding) {
  return crypto.createHash(algorithm).update(buffer).digest(encoding);
}

function computeTarballDigests(tarballPath) {
  const bytes = fs.readFileSync(tarballPath);
  return {
    sha256: hashBuffer(bytes, 'sha256', 'hex'),
    shasum: hashBuffer(bytes, 'sha1', 'hex'),
    integrity: `sha512-${hashBuffer(bytes, 'sha512', 'base64')}`,
  };
}

function targetScope(targetName) {
  const match = /^@([^/]+)\//u.exec(targetName);
  if (!match) {
    throw new Error(`Release target package must be scoped: ${targetName}`);
  }
  return match[1];
}

function exactInternalSpecifier(targetName, version) {
  return `npm:${targetName}@${version}`;
}

function validateCreatePackage(createPackage, manifest) {
  const packageJson = createPackage.packageJson;
  const expectedVersion = manifest.release.version;
  if (packageJson.ultramodern?.frameworkVersion !== expectedVersion) {
    throw new Error(
      `${createPackage.targetName} must record ultramodern.frameworkVersion=${expectedVersion}, found ${String(
        packageJson.ultramodern?.frameworkVersion,
      )}`,
    );
  }

  const i18nTarget = manifest.aliases['@modern-js/i18n-utils'];
  const expectedI18n = exactInternalSpecifier(i18nTarget, expectedVersion);
  if (packageJson.dependencies?.['@modern-js/i18n-utils'] !== expectedI18n) {
    throw new Error(
      `${createPackage.targetName} dependencies.@modern-js/i18n-utils must be ${expectedI18n} because create imports it at runtime`,
    );
  }

  const requiredExports = [
    '.',
    './ultramodern-workspace',
    './ultramodern-workspace/codesmith',
  ];
  const packageExports = packageJson.exports;
  const publishExports = packageJson.publishConfig?.exports;
  // pnpm pack promotes publishConfig.exports into exports and drops the
  // override from the packed manifest; when the override survives (older
  // toolchains), it must still match exports exactly.
  if (
    !packageExports ||
    (publishExports !== undefined &&
      !isDeepStrictEqual(packageExports, publishExports)) ||
    requiredExports.some(subpath => packageExports[subpath] === undefined)
  ) {
    throw new Error(
      `${createPackage.targetName} package exports and publishConfig.exports must expose the same required subpaths`,
    );
  }

  return {
    exactSpecifier: `${createPackage.targetName}@${createPackage.version}`,
    frameworkVersion: packageJson.ultramodern.frameworkVersion,
    publicSubpaths: requiredExports,
    runtimeDependencyChecks: Object.entries(packageJson.dependencies ?? {})
      .map(([dependencyName, specifier]) => ({ dependencyName, specifier }))
      .sort((left, right) =>
        left.dependencyName.localeCompare(right.dependencyName),
      ),
  };
}

function validatePackedCohort(packages, manifest) {
  const targetNames = new Set(packages.map(item => item.targetName));
  const packageChecks = [];

  for (const item of packages) {
    const internalDependencyChecks = [];
    for (const blockName of ['dependencies', 'optionalDependencies']) {
      for (const [dependencyName, specifier] of Object.entries(
        item.packageJson[blockName] ?? {},
      )) {
        const aliasTarget = manifest.aliases[dependencyName];
        if (aliasTarget) {
          const expected = exactInternalSpecifier(
            aliasTarget,
            manifest.release.version,
          );
          if (specifier !== expected) {
            throw new Error(
              `${item.targetName} ${blockName}.${dependencyName} must resolve to exact cohort ${expected}, found ${String(
                specifier,
              )}`,
            );
          }
          internalDependencyChecks.push({
            blockName,
            dependencyName,
            resolution: 'exact-release-alias',
            specifier,
          });
          continue;
        }

        const aliasMatch =
          typeof specifier === 'string'
            ? /^npm:(?<target>@[^/]+\/[^@]+|[^@]+)(?:@(?<range>.*))?$/u.exec(
                specifier,
              )
            : undefined;
        if (
          aliasMatch?.groups?.target &&
          targetNames.has(aliasMatch.groups.target)
        ) {
          const expected = exactInternalSpecifier(
            aliasMatch.groups.target,
            manifest.release.version,
          );
          if (specifier !== expected) {
            throw new Error(
              `${item.targetName} ${blockName}.${dependencyName} must resolve to exact cohort ${expected}, found ${String(
                specifier,
              )}`,
            );
          }
          internalDependencyChecks.push({
            blockName,
            dependencyName,
            resolution: 'exact-release-alias',
            specifier,
          });
          continue;
        }
        if (
          aliasMatch?.groups?.target?.startsWith('@bleedingdev/modern-js-') &&
          !targetNames.has(aliasMatch.groups.target)
        ) {
          throw new Error(
            `${item.targetName} ${blockName}.${dependencyName} targets omitted cohort package ${aliasMatch.groups.target}`,
          );
        }
        if (dependencyName.startsWith('@modern-js/')) {
          internalDependencyChecks.push({
            blockName,
            dependencyName,
            resolution: 'external-registry',
            specifier,
          });
        }
      }
    }
    packageChecks.push({
      sourceName: item.sourceName,
      targetName: item.targetName,
      version: item.version,
      internalDependencyChecks,
    });
  }

  const createPackage = packages.find(
    item => item.sourceName === ultramodernCreateSourceName,
  );
  return {
    create: validateCreatePackage(createPackage, manifest),
    packages: packageChecks,
  };
}

function readReleaseManifest({ manifestPath }) {
  const resolvedManifestPath = path.resolve(manifestPath);
  if (path.basename(resolvedManifestPath) !== releaseManifestFile) {
    throw new Error(
      `Strict release manifest path must end in ${releaseManifestFile}: ${resolvedManifestPath}`,
    );
  }
  const artifactRoot = path.dirname(resolvedManifestPath);
  const verified = verifyReleaseArtifacts(artifactRoot);
  if (verified.manifestPath !== resolvedManifestPath) {
    throw new Error(
      `Verified release manifest path mismatch: expected ${resolvedManifestPath}, found ${verified.manifestPath}`,
    );
  }

  const packages = verified.packages.map(item => ({
    ...item,
    artifactPath: path.resolve(artifactRoot, item.tarballPath),
  }));
  const createPackages = packages.filter(
    item => item.sourceName === ultramodernCreateSourceName,
  );
  if (createPackages.length !== 1) {
    throw new Error(
      `Strict release manifest must contain exactly one ${ultramodernCreateSourceName} package, found ${createPackages.length}`,
    );
  }
  const scopes = new Set(packages.map(item => targetScope(item.targetName)));
  if (scopes.size !== 1) {
    throw new Error(
      `Strict release manifest target packages must use one scope, found ${[
        ...scopes,
      ].join(', ')}`,
    );
  }
  if (![...scopes].includes('bleedingdev')) {
    throw new Error(
      `Strict release manifest target packages must use the @bleedingdev scope, found @${[
        ...scopes,
      ].join(', @')}`,
    );
  }
  const packageChecks = validatePackedCohort(packages, verified.manifest);

  return Object.freeze({
    schema: verified.manifest.schema,
    schemaVersion: verified.manifest.schemaVersion,
    manifestPath: verified.manifestPath,
    manifestSha256: verified.manifestSha256,
    artifactRoot,
    source: Object.freeze({ ...verified.manifest.source }),
    release: Object.freeze({ ...verified.manifest.release }),
    tools: Object.freeze({ ...verified.manifest.tools }),
    aliases: Object.freeze({ ...verified.manifest.aliases }),
    dependencyGraph: Object.freeze({ ...verified.manifest.dependencyGraph }),
    publishOrder: Object.freeze([...verified.manifest.publishOrder]),
    cohortDigest: verified.manifest.cohortDigest,
    cohortProjection: verified.cohortProjection,
    targetScope: [...scopes][0],
    packages: Object.freeze(packages.map(item => Object.freeze(item))),
    createPackage: Object.freeze(createPackages[0]),
    packageChecks: Object.freeze(packageChecks),
  });
}

export { computeTarballDigests, readReleaseManifest };
