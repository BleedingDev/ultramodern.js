import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile } from './constants.mjs';

const compactMetadataPath = '.modernjs/ultramodern.json';
const releaseCohortPath = '.modernjs/release-cohort.json';
const retiredMetadataPaths = Object.freeze([
  '.modernjs/ultramodern-package-source.json',
  '.modernjs/ultramodern-workspace-template-manifest.json',
]);
const dependencyBlocks = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const bootstrapDependencyBlocks = Object.freeze([
  'dependencies',
  'optionalDependencies',
]);
const minimumReleaseAgeMinutes = 1440;

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value), null, 2);
}

function assertGeneratedReleaseCohort(projectDir, release) {
  assertCondition(
    isPlainObject(release?.cohortProjection) &&
      /^[a-f0-9]{64}$/u.test(release.cohortProjection.sha256) &&
      isPlainObject(release.cohortProjection.value),
    'Strict release manifest cohort projection is required for generated cohort validation',
  );
  const filePath = path.join(projectDir, releaseCohortPath);
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
  assertCondition(
    stat?.isFile() && !stat.isSymbolicLink(),
    `Generated authenticated release cohort is missing or unsafe: ${releaseCohortPath}`,
  );
  const bytes = fs.readFileSync(filePath);
  const expectedBytes = Buffer.from(
    `${canonicalJson(release.cohortProjection.value)}\n`,
    'utf8',
  );
  assertCondition(
    bytes.equals(expectedBytes),
    `Generated authenticated release cohort differs from strict release manifest: ${releaseCohortPath}`,
  );
  assertCondition(
    crypto.createHash('sha256').update(bytes).digest('hex') ===
      release.cohortProjection.sha256,
    `Generated authenticated release cohort SHA-256 differs from strict release manifest: ${releaseCohortPath}`,
  );
}

function sourcePackageSuffix(sourceName) {
  const separator = sourceName.lastIndexOf('/');
  assertCondition(
    sourceName.startsWith('@modern-js/') && separator > 0,
    `Release alias source must be an exact @modern-js package name: ${sourceName}`,
  );
  return sourceName.slice(separator + 1);
}

function targetAliasParts(sourceName, targetName) {
  const match = /^@(?<scope>[^/]+)\/(?<name>[^/]+)$/u.exec(targetName);
  assertCondition(
    match?.groups,
    `Release alias target must be an exact scoped package name: ${targetName}`,
  );
  const suffix = sourcePackageSuffix(sourceName);
  assertCondition(
    match.groups.name.endsWith(suffix),
    `Release alias ${sourceName} -> ${targetName} does not preserve the source package suffix`,
  );
  return {
    aliasScope: match.groups.scope,
    aliasPackageNamePrefix: match.groups.name.slice(
      0,
      match.groups.name.length - suffix.length,
    ),
  };
}

function expectedReleaseCohort(release) {
  assertCondition(
    isPlainObject(release?.aliases),
    'Strict release manifest aliases are required for cohort validation',
  );
  assertCondition(
    Array.isArray(release?.publishOrder) && release.publishOrder.length > 0,
    'Strict release manifest publishOrder is required for cohort validation',
  );

  const aliasEntries = Object.entries(release.aliases).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  assertCondition(
    aliasEntries.length > 0,
    'Strict release manifest aliases must not be empty',
  );
  const targetNames = aliasEntries.map(([, targetName]) => targetName);
  const publishedTargets = [...release.publishOrder];
  assertCondition(
    new Set(publishedTargets).size === publishedTargets.length,
    'Strict release manifest publishOrder contains duplicate targets',
  );
  assertCondition(
    JSON.stringify([...targetNames].sort()) ===
      JSON.stringify([...publishedTargets].sort()),
    'Strict release manifest aliases and publishOrder must independently enumerate the same cohort',
  );

  let aliasProfile;
  for (const [sourceName, targetName] of aliasEntries) {
    assertCondition(
      typeof targetName === 'string' && targetName.length > 0,
      `Strict release manifest alias for ${sourceName} is missing`,
    );
    const currentProfile = targetAliasParts(sourceName, targetName);
    aliasProfile ??= currentProfile;
    assertCondition(
      currentProfile.aliasScope === aliasProfile.aliasScope &&
        currentProfile.aliasPackageNamePrefix ===
          aliasProfile.aliasPackageNamePrefix,
      `Strict release manifest aliases cannot be represented by one generated package-source profile: ${sourceName} -> ${targetName}`,
    );
  }

  if (release.packages !== undefined) {
    assertCondition(
      Array.isArray(release.packages),
      'Strict release manifest package observations must be an array',
    );
    const packagePairs = release.packages
      .map(item => `${item.sourceName}\0${item.targetName}`)
      .sort();
    const expectedPairs = aliasEntries
      .map(([sourceName, targetName]) => `${sourceName}\0${targetName}`)
      .sort();
    assertCondition(
      JSON.stringify(packagePairs) === JSON.stringify(expectedPairs),
      'Strict release manifest package observations omit or add a cohort member from aliases/publishOrder',
    );
  }

  return Object.freeze({
    aliases: Object.freeze(Object.fromEntries(aliasEntries)),
    aliasScope: aliasProfile.aliasScope,
    aliasPackageNamePrefix: aliasProfile.aliasPackageNamePrefix,
    sourceNames: Object.freeze(aliasEntries.map(([sourceName]) => sourceName)),
    targetNames: Object.freeze(targetNames),
  });
}

function exactBootstrapDependencyTargets(packageJson, release, cohort) {
  const targets = new Set();
  const knownTargets = new Set(cohort.targetNames);
  for (const blockName of bootstrapDependencyBlocks) {
    for (const [dependencyName, specifier] of Object.entries(
      packageJson[blockName] ?? {},
    )) {
      const sourceAliasTarget = cohort.aliases[dependencyName];
      const npmAlias =
        typeof specifier === 'string'
          ? /^npm:(?<target>@[^/]+\/[^@]+|[^@]+)@(?<version>.+)$/u.exec(
              specifier,
            )?.groups
          : undefined;
      const targetName = sourceAliasTarget ?? npmAlias?.target;
      if (!targetName || !knownTargets.has(targetName)) {
        assertCondition(
          !targetName?.startsWith('@bleedingdev/modern-js-'),
          `${blockName}.${dependencyName} targets omitted release package ${targetName}`,
        );
        continue;
      }
      const expectedSpecifier = `npm:${targetName}@${release.release.version}`;
      assertCondition(
        specifier === expectedSpecifier,
        `${blockName}.${dependencyName} must resolve to exact bootstrap dependency ${expectedSpecifier}, found ${String(
          specifier,
        )}`,
      );
      targets.add(targetName);
    }
  }
  return [...targets].sort((left, right) => left.localeCompare(right));
}

function resolveBootstrapReleaseAgePolicy(release, cohort, createPackage) {
  assertCondition(
    isPlainObject(release?.dependencyGraph),
    'Strict release manifest dependencyGraph is required for bootstrap policy',
  );
  assertCondition(
    Array.isArray(release?.packages),
    'Strict release manifest package observations are required for bootstrap policy',
  );

  const graphTargets = Object.keys(release.dependencyGraph).sort(
    (left, right) => left.localeCompare(right),
  );
  const expectedTargets = [...cohort.targetNames].sort((left, right) =>
    left.localeCompare(right),
  );
  assertCondition(
    JSON.stringify(graphTargets) === JSON.stringify(expectedTargets),
    'Strict release manifest dependencyGraph must enumerate the exact release cohort',
  );

  const packagesByTarget = new Map();
  for (const item of release.packages) {
    assertCondition(
      isPlainObject(item) &&
        typeof item.sourceName === 'string' &&
        cohort.aliases[item.sourceName] === item.targetName,
      `Strict release manifest contains an invalid package observation for ${String(
        item?.targetName,
      )}`,
    );
    assertCondition(
      item.version === release.release.version,
      `Bootstrap dependency ${item.targetName} must use release version ${release.release.version}, found ${String(
        item.version,
      )}`,
    );
    assertCondition(
      isPlainObject(item.packageJson),
      `Bootstrap dependency ${item.targetName} is missing its authenticated packed package.json`,
    );
    assertCondition(
      !packagesByTarget.has(item.targetName),
      `Strict release manifest contains duplicate package observation ${item.targetName}`,
    );
    packagesByTarget.set(item.targetName, item);
  }
  assertCondition(
    packagesByTarget.size === expectedTargets.length,
    'Strict release manifest package observations must enumerate the exact release cohort for bootstrap policy',
  );

  for (const targetName of expectedTargets) {
    const graphDependencies = release.dependencyGraph[targetName];
    assertCondition(
      Array.isArray(graphDependencies) &&
        graphDependencies.every(
          dependency =>
            typeof dependency === 'string' &&
            packagesByTarget.has(dependency) &&
            dependency !== targetName,
        ) &&
        new Set(graphDependencies).size === graphDependencies.length,
      `Strict release manifest dependencyGraph.${targetName} is malformed`,
    );
    const packageObservation = packagesByTarget.get(targetName);
    const packedDependencies = exactBootstrapDependencyTargets(
      packageObservation.packageJson,
      release,
      cohort,
    );
    assertCondition(
      JSON.stringify(
        [...graphDependencies].sort((left, right) => left.localeCompare(right)),
      ) === JSON.stringify(packedDependencies),
      `Strict release manifest dependencyGraph.${targetName} differs from authenticated packed runtime dependencies`,
    );
  }

  const reachableTargets = new Set();
  const visiting = new Set();
  const visit = targetName => {
    assertCondition(
      !visiting.has(targetName),
      `Strict release manifest bootstrap dependency cycle includes ${targetName}`,
    );
    if (reachableTargets.has(targetName)) {
      return;
    }
    visiting.add(targetName);
    for (const dependency of release.dependencyGraph[targetName]) {
      visit(dependency);
    }
    visiting.delete(targetName);
    reachableTargets.add(targetName);
  };
  visit(createPackage.targetName);

  return Object.freeze({
    minimumReleaseAge: minimumReleaseAgeMinutes,
    minimumReleaseAgeExclude: Object.freeze(
      [...reachableTargets]
        .sort((left, right) => left.localeCompare(right))
        .map(targetName => `${targetName}@${release.release.version}`),
    ),
    minimumReleaseAgeIgnoreMissingTime: false,
    minimumReleaseAgeStrict: true,
  });
}

function resolveCreatePackage(release, requestedSpecifier) {
  const cohort = expectedReleaseCohort(release);
  const createPackage = release?.createPackage;
  assertCondition(
    createPackage?.sourceName === '@modern-js/create',
    'Strict release manifest must identify @modern-js/create as the create package',
  );
  assertCondition(
    cohort.aliases[createPackage.sourceName] === createPackage.targetName,
    'Strict release manifest create package does not match aliases/publishOrder',
  );
  assertCondition(
    createPackage.version === release.release?.version,
    'Strict release manifest create package version does not match release.version',
  );
  const frameworkVersion =
    createPackage.packageJson?.ultramodern?.frameworkVersion;
  assertCondition(
    frameworkVersion === release.release.version,
    `Exact create package must natively declare ultramodern.frameworkVersion=${release.release.version}, found ${String(
      frameworkVersion,
    )}`,
  );

  const exactSpecifier = `${createPackage.targetName}@${createPackage.version}`;
  if (
    requestedSpecifier !== undefined &&
    requestedSpecifier !== exactSpecifier
  ) {
    throw new Error(
      `Create package must be the exact release manifest package ${exactSpecifier}, found ${requestedSpecifier}`,
    );
  }
  const bootstrapReleaseAgePolicy = resolveBootstrapReleaseAgePolicy(
    release,
    cohort,
    createPackage,
  );
  return Object.freeze({
    packageName: createPackage.targetName,
    version: createPackage.version,
    frameworkVersion,
    exactSpecifier,
    bootstrapReleaseAgePolicy,
  });
}

function assertBootstrapReleaseAgePolicy(createPackage) {
  const policy = createPackage?.bootstrapReleaseAgePolicy;
  const createIdentity =
    typeof createPackage?.exactSpecifier === 'string'
      ? /^(?<packageName>@[^/]+\/[^@]+)@(?<version>[1-9]\d*\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$/u.exec(
          createPackage.exactSpecifier,
        )?.groups
      : undefined;
  const exactExcludes = policy?.minimumReleaseAgeExclude;
  assertCondition(
    createIdentity &&
      createPackage.version === createIdentity.version &&
      policy?.minimumReleaseAge === minimumReleaseAgeMinutes &&
      policy.minimumReleaseAgeStrict === true &&
      policy.minimumReleaseAgeIgnoreMissingTime === false &&
      Array.isArray(exactExcludes) &&
      exactExcludes.length > 0 &&
      exactExcludes.every(
        specifier =>
          typeof specifier === 'string' &&
          /^@[^/]+\/[^@/]+@[1-9]\d*\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(
            specifier,
          ) &&
          specifier.endsWith(`@${createIdentity.version}`) &&
          specifier.startsWith(
            `${createIdentity.packageName.slice(
              0,
              createIdentity.packageName.indexOf('/') + 1,
            )}`,
          ),
      ) &&
      new Set(exactExcludes).size === exactExcludes.length &&
      JSON.stringify(exactExcludes) ===
        JSON.stringify(
          [...exactExcludes].sort((left, right) => left.localeCompare(right)),
        ) &&
      exactExcludes.includes(createPackage.exactSpecifier),
    'Create package must carry an exact authenticated bootstrap release-age policy',
  );
  return policy;
}

function createPnpmDlxArgs(createPackage, forwardedArgs) {
  const policy = assertBootstrapReleaseAgePolicy(createPackage);
  return [
    '--pm-on-fail=ignore',
    `--config.minimum-release-age=${policy.minimumReleaseAge}`,
    `--config.minimum-release-age-strict=${String(policy.minimumReleaseAgeStrict)}`,
    `--config.minimum-release-age-ignore-missing-time=${String(
      policy.minimumReleaseAgeIgnoreMissingTime,
    )}`,
    ...policy.minimumReleaseAgeExclude.map(
      specifier => `--config.minimum-release-age-exclude=${specifier}`,
    ),
    'dlx',
    '--allow-build=esbuild',
    createPackage.exactSpecifier,
    ...forwardedArgs,
  ];
}

function packageJsonFiles(root) {
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['.git', '.output', 'dist', 'node_modules'].includes(entry.name)) {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
      } else if (entry.name === 'package.json') {
        files.push(absolute);
      }
    }
  }
  return files.sort();
}

function readCompactMetadata(projectDir) {
  for (const retiredPath of retiredMetadataPaths) {
    const filePath = path.join(projectDir, retiredPath);
    if (fs.existsSync(filePath)) {
      throw new Error(
        `Generated workspace contains retired package-cohort metadata ${retiredPath}; strict acceptance never mixes legacy metadata with ${compactMetadataPath}`,
      );
    }
  }

  const filePath = path.join(projectDir, compactMetadataPath);
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
  assertCondition(
    stat?.isFile() && !stat.isSymbolicLink(),
    `Generated compact metadata is missing or unsafe: ${compactMetadataPath}`,
  );
  return readJsonFile(filePath);
}

function normalizedRegistry(value) {
  if (value === undefined) {
    return undefined;
  }
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(
      `Generated package source registry is invalid: ${String(value)}`,
    );
  }
}

function assertGeneratedCohort(projectDir, release, { registryUrl } = {}) {
  assertGeneratedReleaseCohort(projectDir, release);
  const expected = expectedReleaseCohort(release);
  const compact = readCompactMetadata(projectDir);
  assertCondition(
    compact?.schemaVersion === 1,
    `Generated compact metadata schemaVersion must be 1, found ${String(
      compact?.schemaVersion,
    )}`,
  );
  assertCondition(
    isPlainObject(compact.generator),
    'Generated compact metadata generator identity is missing',
  );
  assertCondition(
    compact.generator.package === release.createPackage.sourceName &&
      compact.generator.version === release.createPackage.version,
    `Generated compact metadata must observe exact create ${release.createPackage.sourceName}@${release.createPackage.version}`,
  );
  assertCondition(
    isPlainObject(compact.packageSource),
    'Generated compact metadata packageSource is missing',
  );
  const forbiddenPackageSourceKeys = [
    'metadata',
    'modernPackages',
    'modernPackageSpecifier',
  ].filter(key => compact.packageSource[key] !== undefined);
  assertCondition(
    forbiddenPackageSourceKeys.length === 0,
    `Generated compact metadata mixes retired package-source fields: ${forbiddenPackageSourceKeys.join(
      ', ',
    )}`,
  );
  assertCondition(
    compact.packageSource.strategy === 'install',
    `Generated package source strategy must be install, found ${String(
      compact.packageSource.strategy,
    )}`,
  );
  assertCondition(
    compact.packageSource.modernPackageVersion === release.release.version,
    `Generated package source version must be ${release.release.version}, found ${String(
      compact.packageSource.modernPackageVersion,
    )}`,
  );
  assertCondition(
    compact.packageSource.aliasScope === expected.aliasScope,
    `Generated package source aliasScope must be ${expected.aliasScope}, found ${String(
      compact.packageSource.aliasScope,
    )}`,
  );
  assertCondition(
    compact.packageSource.aliasPackageNamePrefix ===
      expected.aliasPackageNamePrefix,
    `Generated package source aliasPackageNamePrefix must be ${expected.aliasPackageNamePrefix}, found ${String(
      compact.packageSource.aliasPackageNamePrefix,
    )}`,
  );
  if (
    compact.packageSource.registry !== undefined &&
    registryUrl !== undefined
  ) {
    assertCondition(
      normalizedRegistry(compact.packageSource.registry) ===
        normalizedRegistry(registryUrl),
      `Generated package source registry must be ${normalizedRegistry(
        registryUrl,
      )}, found ${String(compact.packageSource.registry)}`,
    );
  }

  const sourceNames = new Set(expected.sourceNames);
  const targetNames = new Set(expected.targetNames);
  const observed = new Set();
  for (const packageJsonPath of packageJsonFiles(projectDir)) {
    const relative = path.relative(projectDir, packageJsonPath);
    const packageJson = readJsonFile(packageJsonPath);
    for (const blockName of dependencyBlocks) {
      const block = packageJson[blockName];
      if (!isPlainObject(block)) {
        continue;
      }
      for (const [dependencyName, specifier] of Object.entries(block)) {
        if (targetNames.has(dependencyName)) {
          throw new Error(
            `${relative} ${blockName}.${dependencyName} bypasses the source-name alias contract`,
          );
        }
        const exactSourceName = sourceNames.has(dependencyName)
          ? dependencyName
          : undefined;
        if (dependencyName.startsWith('@modern-js/')) {
          assertCondition(
            exactSourceName,
            `${relative} declares ${dependencyName} outside strict release aliases/publishOrder`,
          );
        }
        if (exactSourceName) {
          const expectedSpecifier = `npm:${expected.aliases[exactSourceName]}@${release.release.version}`;
          assertCondition(
            specifier === expectedSpecifier,
            `${relative} ${blockName}.${dependencyName} must be ${expectedSpecifier}, found ${String(
              specifier,
            )}`,
          );
          observed.add(exactSourceName);
          continue;
        }
        const npmAlias =
          typeof specifier === 'string'
            ? /^npm:(?<target>@[^/]+\/[^@]+|[^@]+)@(?<version>.+)$/u.exec(
                specifier,
              )?.groups
            : undefined;
        if (npmAlias && targetNames.has(npmAlias.target)) {
          const expectedSpecifier = `npm:${npmAlias.target}@${release.release.version}`;
          assertCondition(
            specifier === expectedSpecifier,
            `${relative} ${blockName}.${dependencyName} must target exact cohort package ${npmAlias.target}@${release.release.version}, found ${String(
              specifier,
            )}`,
          );
        }
        if (
          typeof specifier === 'string' &&
          specifier.startsWith('npm:@bleedingdev/')
        ) {
          assertCondition(
            targetNames.has(npmAlias?.target),
            `${relative} ${blockName}.${dependencyName} aliases an unknown BleedingDev cohort target ${String(
              npmAlias?.target,
            )}`,
          );
        }
      }
    }
  }
  assertCondition(
    observed.size > 0,
    'Generated workspace does not observe any strict release Modern package alias',
  );

  return {
    expectedPackageCount: expected.sourceNames.length,
    observedPackageCount: observed.size,
    observedSourceNames: [...observed].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

export {
  assertBootstrapReleaseAgePolicy,
  assertGeneratedCohort,
  createPnpmDlxArgs,
  expectedReleaseCohort,
  packageJsonFiles,
  resolveCreatePackage,
  retiredMetadataPaths,
};
