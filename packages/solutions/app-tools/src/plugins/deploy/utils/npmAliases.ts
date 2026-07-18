import fs from 'node:fs/promises';
import path from 'node:path';

type PackageJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
};

type PackageRecord = {
  directory: string;
  packageJson: PackageJson;
};

export type NpmAlias = {
  aliasName: string;
  targetName: string;
  targetVersion: string;
};

const dependencyKeys = ['dependencies', 'optionalDependencies'] as const;
const exactVersionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

async function readPackageJson(filePath: string): Promise<PackageJson> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as PackageJson;
}

function parseNpmAlias(
  aliasName: string,
  specifier: string,
): NpmAlias | undefined {
  if (!specifier.startsWith('npm:')) {
    return undefined;
  }

  const target = specifier.slice('npm:'.length);
  const versionSeparator = target.lastIndexOf('@');
  if (versionSeparator <= 0 || versionSeparator === target.length - 1) {
    throw new Error(
      `Invalid npm alias specifier for ${aliasName}: ${specifier}`,
    );
  }

  return {
    aliasName,
    targetName: target.slice(0, versionSeparator),
    targetVersion: target.slice(versionSeparator + 1),
  };
}

function aliasesFromPackageJson(packageJson: PackageJson): NpmAlias[] {
  const aliases: NpmAlias[] = [];
  for (const dependencyKey of dependencyKeys) {
    for (const [aliasName, specifier] of Object.entries(
      packageJson[dependencyKey] ?? {},
    )) {
      const alias = parseNpmAlias(aliasName, specifier);
      if (alias) {
        aliases.push(alias);
      }
    }
  }
  return aliases;
}

async function collectPackageRecords(
  nodeModulesDirectory: string,
): Promise<PackageRecord[]> {
  const records: PackageRecord[] = [];
  const visitedNodeModules = new Set<string>();

  const visitPackage = async (directory: string) => {
    const packageJsonPath = path.join(directory, 'package.json');
    try {
      const packageJson = await readPackageJson(packageJsonPath);
      if (packageJson.name && packageJson.version) {
        records.push({ directory, packageJson });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    await visitNodeModules(path.join(directory, 'node_modules'));
  };

  const visitScope = async (scopeDirectory: string) => {
    const entries = await fs.readdir(scopeDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await visitPackage(path.join(scopeDirectory, entry.name));
      }
    }
  };

  const visitNdepeStore = async (storeDirectory: string) => {
    const entries = await fs.readdir(storeDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await visitNodeModules(
          path.join(storeDirectory, entry.name, 'node_modules'),
        );
      }
    }
  };

  const visitNodeModules = async (directory: string): Promise<void> => {
    const resolvedDirectory = path.resolve(directory);
    if (visitedNodeModules.has(resolvedDirectory)) {
      return;
    }
    visitedNodeModules.add(resolvedDirectory);

    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const entryPath = path.join(directory, entry.name);
      if (entry.name === '.ndepe') {
        await visitNdepeStore(entryPath);
      } else if (entry.name.startsWith('@')) {
        await visitScope(entryPath);
      } else {
        await visitPackage(entryPath);
      }
    }
  };

  await visitNodeModules(nodeModulesDirectory);
  return records;
}

async function resolveAliasTarget(
  ownerDirectory: string,
  alias: NpmAlias,
  outputDirectory: string,
): Promise<PackageRecord | undefined> {
  let directory = ownerDirectory;
  const outputRoot = path.resolve(outputDirectory);
  while (
    directory === outputRoot ||
    directory.startsWith(`${outputRoot}${path.sep}`)
  ) {
    const candidate = path.join(directory, 'node_modules', alias.targetName);
    try {
      await fs.realpath(candidate);
      const packageJson = await readPackageJson(
        path.join(candidate, 'package.json'),
      );
      if (packageJson.name !== alias.targetName || !packageJson.version) {
        throw new Error(
          `npm alias ${alias.aliasName} resolved ${candidate} to unexpected package ${String(packageJson.name)}`,
        );
      }
      if (
        exactVersionPattern.test(alias.targetVersion) &&
        packageJson.version !== alias.targetVersion
      ) {
        return undefined;
      }
      // Keep the lexical path inside .output. realpath can cross an operating
      // system alias such as macOS /var -> /private/var, which would turn the
      // deployment link into a non-relocatable path outside the artifact.
      return { directory: candidate, packageJson };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    if (directory === outputRoot) {
      break;
    }
    directory = path.dirname(directory);
  }
  return undefined;
}

async function ensureAliasLink(
  ownerDirectory: string,
  alias: NpmAlias,
  target: PackageRecord,
) {
  const aliasPath = path.join(ownerDirectory, 'node_modules', alias.aliasName);
  await fs.mkdir(path.dirname(aliasPath), { recursive: true });

  try {
    const [existing, expected] = await Promise.all([
      fs.realpath(aliasPath),
      fs.realpath(target.directory),
    ]);
    if (existing === expected) {
      return;
    }
    throw new Error(
      `Cannot preserve npm alias ${alias.aliasName}: ${aliasPath} already resolves to ${existing}, expected ${expected}`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const linkTarget = path.relative(path.dirname(aliasPath), target.directory);
  await fs.symlink(linkTarget, aliasPath, 'dir');
}

function aliasSpecifier(alias: NpmAlias) {
  return `npm:${alias.targetName}@${alias.targetVersion}`;
}

export async function readPackageIdentity(
  entryPath: string,
): Promise<{ name: string; version: string }> {
  let directory = path.dirname(entryPath);
  const root = path.parse(directory).root;
  while (directory !== root) {
    try {
      const packageJson = await readPackageJson(
        path.join(directory, 'package.json'),
      );
      if (packageJson.name && packageJson.version) {
        return { name: packageJson.name, version: packageJson.version };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    directory = path.dirname(directory);
  }
  throw new Error(
    `Cannot find owning package for deployment entry ${entryPath}`,
  );
}

export async function preserveNpmAliases({
  appDirectory,
  outputDirectory,
  implicitAliases = [],
}: {
  appDirectory: string;
  outputDirectory: string;
  implicitAliases?: NpmAlias[];
}) {
  const records = await collectPackageRecords(
    path.join(outputDirectory, 'node_modules'),
  );

  const appPackageJson = await readPackageJson(
    path.join(appDirectory, 'package.json'),
  );
  const rootAliases = [
    ...aliasesFromPackageJson(appPackageJson),
    ...implicitAliases,
  ].filter(alias => alias.aliasName !== alias.targetName);

  const emittedRootAliases: NpmAlias[] = [];
  for (const alias of rootAliases) {
    const target = await resolveAliasTarget(
      outputDirectory,
      alias,
      outputDirectory,
    );
    if (!target) {
      if (implicitAliases.includes(alias)) {
        throw new Error(
          `Cannot preserve implicit npm alias ${alias.aliasName}: emitted target ${alias.targetName}@${alias.targetVersion} is missing`,
        );
      }
      continue;
    }
    await ensureAliasLink(outputDirectory, alias, target);
    emittedRootAliases.push(alias);
  }

  for (const record of records) {
    for (const alias of aliasesFromPackageJson(record.packageJson).filter(
      candidate => candidate.aliasName !== candidate.targetName,
    )) {
      const target = await resolveAliasTarget(
        record.directory,
        alias,
        outputDirectory,
      );
      if (!target) {
        // ndepe emits only runtime-traced packages. A package manifest can
        // still declare type-only or otherwise unused aliases whose targets
        // correctly are not part of this deployment output.
        continue;
      }
      await ensureAliasLink(record.directory, alias, target);
    }
  }

  const outputPackageJsonPath = path.join(outputDirectory, 'package.json');
  const outputPackageJson = await readPackageJson(outputPackageJsonPath);
  outputPackageJson.dependencies ??= {};
  for (const alias of emittedRootAliases) {
    outputPackageJson.dependencies[alias.aliasName] = aliasSpecifier(alias);
  }
  await fs.writeFile(
    outputPackageJsonPath,
    `${JSON.stringify(outputPackageJson, null, 2)}\n`,
  );
}
