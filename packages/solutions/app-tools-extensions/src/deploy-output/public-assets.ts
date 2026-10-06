import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRelativePath } from '../cloudflare/utils';

/**
 * Deploy output directory that receives declared public assets on every
 * target: Cloudflare Worker Static Assets and the Node deploy output.
 */
export const DECLARED_PUBLIC_ASSET_DIRECTORY = 'public';

export interface DeclaredPublicAssetConfig {
  from: string;
  to: string;
}

export interface DeclaredPublicAssetScope {
  /** Config path used in errors, for example `deploy.node.publicAssets`. */
  label: string;
  /** Output described in destination errors. */
  output: string;
}

export interface DeclaredPublicAsset {
  from: string;
  to: string;
  index: number;
}

export const CLOUDFLARE_PUBLIC_ASSET_SCOPE: DeclaredPublicAssetScope = {
  label: 'deploy.worker.publicAssets',
  output: 'Cloudflare public output',
};

export const NODE_PUBLIC_ASSET_SCOPE: DeclaredPublicAssetScope = {
  label: 'deploy.node.publicAssets',
  output: 'Node public output',
};

export const normalizeDeclaredPublicAssets = (
  assets: readonly DeclaredPublicAssetConfig[] | undefined,
  scope: DeclaredPublicAssetScope,
): DeclaredPublicAsset[] =>
  (assets ?? []).map((asset, index) => ({
    from: normalizeRelativePath(
      asset?.from,
      `${scope.label}[${index}].from`,
      'app root',
    ),
    to: normalizeRelativePath(
      asset?.to,
      `${scope.label}[${index}].to`,
      scope.output,
      { allowRoot: true },
    ),
    index,
  }));

interface DeclaredPublicAssetFile {
  index: number;
  /** Destination relative to the deploy output root, POSIX separators. */
  logicalPath: string;
}

const isMissingPathError = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  (error as NodeJS.ErrnoException).code === 'ENOENT';

const pathExists = async (filePath: string) => {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
};

const listDeclaredPublicAssetFiles = async (
  appDirectory: string,
  assets: readonly DeclaredPublicAsset[],
  scope: DeclaredPublicAssetScope,
): Promise<DeclaredPublicAssetFile[]> => {
  const files: DeclaredPublicAssetFile[] = [];
  const owners = new Map<string, number>();
  const add = (index: number, logicalPath: string) => {
    const owner = owners.get(logicalPath);
    if (owner !== undefined) {
      throw new Error(
        `${scope.label}[${index}] and ${scope.label}[${owner}] both stage ${JSON.stringify(logicalPath)}.`,
      );
    }
    owners.set(logicalPath, index);
    files.push({ index, logicalPath });
  };
  const visit = async (
    asset: DeclaredPublicAsset,
    sourcePath: string,
    destination: string,
  ): Promise<void> => {
    const stat = await fs.lstat(sourcePath);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `${scope.label}[${asset.index}].from must not contain symbolic links: ${path
          .relative(appDirectory, sourcePath)
          .replace(/\\/gu, '/')}`,
      );
    }
    if (stat.isFile()) {
      if (destination === DECLARED_PUBLIC_ASSET_DIRECTORY) {
        throw new Error(
          `${scope.label}[${asset.index}].to must name a file when ${scope.label}[${asset.index}].from is a file.`,
        );
      }
      add(asset.index, destination);
      return;
    }
    if (!stat.isDirectory()) {
      throw new Error(
        `${scope.label}[${asset.index}].from must contain only files and directories: ${path
          .relative(appDirectory, sourcePath)
          .replace(/\\/gu, '/')}`,
      );
    }
    const entries = (await fs.readdir(sourcePath)).sort();
    for (const entry of entries) {
      await visit(
        asset,
        path.join(sourcePath, entry),
        path.posix.join(destination, entry),
      );
    }
  };

  for (const asset of assets) {
    const sourcePath = path.join(appDirectory, asset.from);
    if (!(await pathExists(sourcePath))) {
      throw new Error(
        `${scope.label}[${asset.index}].from does not exist: ${asset.from}`,
      );
    }
    await visit(
      asset,
      sourcePath,
      path.posix.join(DECLARED_PUBLIC_ASSET_DIRECTORY, asset.to),
    );
  }
  return files;
};

/**
 * Resolve the files declared public assets add to a deploy output that was
 * copied from `generatedRoot`, relative to the deploy output root. Declared
 * files that replace a generated file are not part of the result, matching
 * {@link stageDeclaredPublicAssets}.
 */
export const resolveAddedDeclaredPublicAssetPaths = async ({
  appDirectory,
  assets,
  generatedRoot,
  scope,
}: {
  appDirectory: string;
  assets: readonly DeclaredPublicAsset[];
  generatedRoot: string;
  scope: DeclaredPublicAssetScope;
}): Promise<string[]> => {
  const added: string[] = [];
  for (const file of await listDeclaredPublicAssetFiles(
    appDirectory,
    assets,
    scope,
  )) {
    if (!(await pathExists(path.join(generatedRoot, file.logicalPath)))) {
      added.push(file.logicalPath);
    }
  }
  return added.sort();
};

/**
 * Copy declared public assets into the deploy output after the framework has
 * staged its own public files.
 *
 * A declared file may replace a generated public file, such as an app-owned
 * `robots.txt`; the replaced file keeps its generated release classification.
 *
 * @returns the files the declarations added, relative to the deploy output
 * root. The release envelope records these as declared public assets.
 */
export const stageDeclaredPublicAssets = async ({
  appDirectory,
  outputDirectory,
  assets,
  scope,
}: {
  appDirectory: string;
  outputDirectory: string;
  assets: readonly DeclaredPublicAsset[];
  scope: DeclaredPublicAssetScope;
}): Promise<string[]> => {
  const files = await listDeclaredPublicAssetFiles(appDirectory, assets, scope);
  const added: string[] = [];
  for (const file of files) {
    const asset = assets.find(candidate => candidate.index === file.index)!;
    const relativePath = path.posix.relative(
      path.posix.join(DECLARED_PUBLIC_ASSET_DIRECTORY, asset.to),
      file.logicalPath,
    );
    const destination = path.join(outputDirectory, file.logicalPath);
    const replacesGeneratedFile = await pathExists(destination);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(
      path.join(appDirectory, asset.from, relativePath),
      destination,
    );
    if (!replacesGeneratedFile) {
      added.push(file.logicalPath);
    }
  }
  return added.sort();
};
