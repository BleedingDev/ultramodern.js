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
  return {
    packageName: createPackage.targetName,
    version: createPackage.version,
    frameworkVersion,
    exactSpecifier,
  };
}

function createPnpmDlxArgs(createPackage, forwardedArgs) {
  return [
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
        if (dependencyName.startsWith('@modern-js/')) {
          assertCondition(
            sourceNames.has(dependencyName),
            `${relative} declares ${dependencyName} outside strict release aliases/publishOrder`,
          );
          const expectedSpecifier = `npm:${expected.aliases[dependencyName]}@${release.release.version}`;
          assertCondition(
            specifier === expectedSpecifier,
            `${relative} ${blockName}.${dependencyName} must be ${expectedSpecifier}, found ${String(
              specifier,
            )}`,
          );
          observed.add(dependencyName);
          continue;
        }
        if (
          typeof specifier === 'string' &&
          specifier.startsWith('npm:@bleedingdev/')
        ) {
          const target = /^npm:(?<target>@[^@]+)@/u.exec(specifier)?.groups
            ?.target;
          assertCondition(
            targetNames.has(target),
            `${relative} ${blockName}.${dependencyName} aliases an unknown BleedingDev cohort target ${String(
              target,
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
  assertGeneratedCohort,
  assertGeneratedReleaseCohort,
  compactMetadataPath,
  createPnpmDlxArgs,
  expectedReleaseCohort,
  packageJsonFiles,
  readCompactMetadata,
  resolveCreatePackage,
  retiredMetadataPaths,
};
