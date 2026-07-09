import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile } from './constants.mjs';
import { run } from './process.mjs';

function packageNameFromSpecifier(specifier) {
  const lastAt = specifier.lastIndexOf('@');
  if (specifier.startsWith('@') && lastAt > 0) {
    return specifier.slice(0, lastAt);
  }
  if (!specifier.startsWith('@') && lastAt > -1) {
    return specifier.slice(0, lastAt);
  }
  return specifier;
}

function resolveCreatePackage(specifier) {
  const packageName = packageNameFromSpecifier(specifier);
  const packageMetadata = JSON.parse(
    run('npm', ['view', specifier, '--json'], { stdio: 'pipe' }),
  );
  const version = packageMetadata.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Could not resolve npm version for ${specifier}`);
  }
  const frameworkVersion = packageMetadata.ultramodern?.frameworkVersion;
  if (
    packageName === '@bleedingdev/modern-js-create' &&
    (typeof frameworkVersion !== 'string' || frameworkVersion.length === 0)
  ) {
    throw new Error(
      `${packageName}@${version} must declare ultramodern.frameworkVersion`,
    );
  }
  return {
    packageName,
    version,
    dlxSpecifier: specifier,
    frameworkVersion:
      typeof frameworkVersion === 'string' && frameworkVersion.length > 0
        ? frameworkVersion
        : version,
    exactSpecifier: `${packageName}@${version}`,
  };
}

function createPnpmDlxArgs(createPackage, forwardedArgs) {
  return ['dlx', createPackage.exactSpecifier, ...forwardedArgs];
}

function bleedingdevAlias(modernPackageName) {
  return `@bleedingdev/modern-js-${modernPackageName.split('/').at(-1)}`;
}

function modernPackageAlias(modernPackageName, packageSource) {
  const scope = (packageSource.aliasScope ?? 'bleedingdev').replace(/^@/u, '');
  const prefix = packageSource.aliasPackageNamePrefix ?? 'modern-js-';
  return `@${scope}/${prefix}${modernPackageName.split('/').at(-1)}`;
}

function expectedSpecifier(modernPackageName, version) {
  return `npm:${bleedingdevAlias(modernPackageName)}@${version}`;
}

function generatedModernPackages(packageSource, errors) {
  const packageNames = packageSource.modernPackages?.packages;
  if (!Array.isArray(packageNames) || packageNames.length === 0) {
    errors.push('package source Modern package cohort is missing');
    return [];
  }

  const invalidPackageNames = packageNames.filter(
    packageName =>
      typeof packageName !== 'string' || !packageName.startsWith('@modern-js/'),
  );
  if (invalidPackageNames.length > 0) {
    errors.push(
      `package source Modern package cohort contains invalid entries: ${invalidPackageNames.join(
        ', ',
      )}`,
    );
  }

  return packageNames.filter(
    packageName =>
      typeof packageName === 'string' && packageName.startsWith('@modern-js/'),
  );
}

function modernDependencyNames(packageJson) {
  return [
    ...new Set(
      ['dependencies', 'devDependencies']
        .flatMap(section => Object.keys(packageJson[section] ?? {}))
        .filter(packageName => packageName.startsWith('@modern-js/')),
    ),
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

function readOptionalJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return readJsonFile(filePath);
}

function compactPackageSource(projectDir, compactMetadata) {
  const source = compactMetadata?.packageSource;
  if (!source) {
    return undefined;
  }
  const packageNames = [
    ...new Set(
      packageJsonFiles(projectDir).flatMap(packageJsonPath =>
        modernDependencyNames(readJsonFile(packageJsonPath)),
      ),
    ),
  ].sort();
  return {
    modernPackages: {
      aliases: Object.fromEntries(
        packageNames.map(packageName => [
          packageName,
          modernPackageAlias(packageName, source),
        ]),
      ),
      packages: packageNames,
      specifier: source.modernPackageVersion,
    },
    strategy: source.strategy,
  };
}

function generatedMetadata(projectDir, manifestPath) {
  const compactMetadata = readOptionalJsonFile(
    path.join(projectDir, '.modernjs/ultramodern.json'),
  );
  const legacyPackageSource = readOptionalJsonFile(
    path.join(projectDir, '.modernjs/ultramodern-package-source.json'),
  );
  const legacyManifest = readOptionalJsonFile(
    path.join(projectDir, manifestPath),
  );
  return {
    manifest: legacyManifest ?? compactMetadata,
    packageSource:
      legacyPackageSource ?? compactPackageSource(projectDir, compactMetadata),
  };
}

function assertGeneratedCohort(
  projectDir,
  expectedFrameworkVersion,
  {
    expectedTemplateVersion = expectedFrameworkVersion,
    manifestPath = '.modernjs/ultramodern-workspace-template-manifest.json',
    workspaceManifest = true,
  } = {},
) {
  const errors = [];
  const { manifest, packageSource } = generatedMetadata(
    projectDir,
    manifestPath,
  );
  if (!packageSource) {
    errors.push('package source metadata is missing');
  }
  if (!manifest) {
    errors.push(`manifest metadata is missing: ${manifestPath}`);
  }
  if (errors.length > 0) {
    throw new Error(errors.map(error => `- ${error}`).join('\n'));
  }
  const modernPackageNames = generatedModernPackages(packageSource, errors);
  const modernPackageNameSet = new Set(modernPackageNames);

  if (packageSource.strategy !== 'install') {
    errors.push(`package source strategy is ${packageSource.strategy}`);
  }
  if (packageSource.modernPackages?.specifier !== expectedFrameworkVersion) {
    errors.push(
      `package source specifier is ${packageSource.modernPackages?.specifier}`,
    );
  }
  const templateVersion =
    manifest.template?.version ?? manifest.generator?.version;
  if (templateVersion !== expectedTemplateVersion) {
    errors.push(`template version is ${templateVersion}`);
  }
  const manifestModernPackageSpecifier =
    manifest.packageSource?.modernPackageSpecifier ??
    manifest.packageSource?.modernPackageVersion;
  if (
    workspaceManifest &&
    manifestModernPackageSpecifier !== expectedFrameworkVersion
  ) {
    errors.push(
      `manifest package specifier is ${manifestModernPackageSpecifier}`,
    );
  }

  for (const modernPackageName of modernPackageNames) {
    const alias = packageSource.modernPackages?.aliases?.[modernPackageName];
    const expectedAlias = bleedingdevAlias(modernPackageName);
    if (alias !== expectedAlias) {
      errors.push(`${modernPackageName} alias is ${alias}`);
    }
  }

  for (const packageJsonPath of packageJsonFiles(projectDir)) {
    const relative = path.relative(projectDir, packageJsonPath);
    const packageJson = readJsonFile(packageJsonPath);
    for (const modernPackageName of modernDependencyNames(packageJson)) {
      if (!modernPackageNameSet.has(modernPackageName)) {
        errors.push(
          `${relative} declares ${modernPackageName} outside package source metadata`,
        );
      }
    }
    for (const section of ['dependencies', 'devDependencies']) {
      for (const modernPackageName of modernPackageNames) {
        const actual = packageJson[section]?.[modernPackageName];
        const expected = expectedSpecifier(
          modernPackageName,
          expectedFrameworkVersion,
        );
        if (actual !== undefined && actual !== expected) {
          errors.push(
            `${relative} ${section}.${modernPackageName} is ${actual}`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.map(error => `- ${error}`).join('\n'));
  }
}

export {
  assertGeneratedCohort,
  bleedingdevAlias,
  compactPackageSource,
  createPnpmDlxArgs,
  expectedSpecifier,
  generatedMetadata,
  generatedModernPackages,
  modernDependencyNames,
  modernPackageAlias,
  packageJsonFiles,
  packageNameFromSpecifier,
  readOptionalJsonFile,
  resolveCreatePackage,
};
