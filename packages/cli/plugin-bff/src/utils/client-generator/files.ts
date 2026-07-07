// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off processEnv:off strictBooleanExpressions:off
import { fs } from '@modern-js/utils';
import path from 'path';

export interface FileDetails {
  resourcePath: string;
  source: string;
  targetDir: string;
  name: string;
  absTargetDir: string;
  relativeTargetDistDir: string;
  exportKey: string;
}

export const API_DIR = 'api';
export const PLUGIN_DIR = 'plugin';
export const RUNTIME_DIR = 'runtime';
export const CLIENT_DIR = 'client';

export const EXPORT_PREFIX = `./${API_DIR}/`;
export const TYPE_PREFIX = `${API_DIR}/`;
export const GENERATED_RUNTIME_DIRS = [CLIENT_DIR, PLUGIN_DIR, RUNTIME_DIR];

export const toPosixPath = (p: string) => p.replace(/\\/g, '/');
export const posixJoin = (...args: string[]) => toPosixPath(path.join(...args));

export function createFileDetails(options: {
  appDirectory: string;
  baseDirectory: string;
  resourcePath: string;
  source: string;
  relativeDistPath: string;
}): FileDetails {
  const {
    appDirectory,
    baseDirectory,
    resourcePath,
    source,
    relativeDistPath,
  } = options;
  const relativePath = path.relative(baseDirectory, resourcePath);
  const parsedPath = path.parse(relativePath);

  const targetDir = posixJoin(
    `./${relativeDistPath}/${CLIENT_DIR}`,
    parsedPath.dir,
    `${parsedPath.name}.js`,
  );
  const absTargetDir = path.resolve(targetDir);

  const relativePathFromAppDirectory = path.relative(
    appDirectory,
    path.dirname(resourcePath),
  );

  const typesFilePath = posixJoin(
    `./${relativeDistPath}`,
    relativePathFromAppDirectory,
    `${parsedPath.name}.d.ts`,
  );

  return {
    resourcePath,
    source,
    targetDir,
    name: parsedPath.name,
    absTargetDir,
    relativeTargetDistDir: `./${typesFilePath}`,
    exportKey: toPosixPath(path.join(parsedPath.dir, parsedPath.name)),
  };
}

export async function readDirectoryFiles(
  appDirectory: string,
  directory: string,
  relativeDistPath: string,
): Promise<FileDetails[]> {
  const filesList: FileDetails[] = [];

  async function readFiles(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === '_app.ts') continue;

      const resourcePath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await readFiles(resourcePath);
      } else {
        const source = await fs.readFile(resourcePath, 'utf8');
        filesList.push(
          createFileDetails({
            appDirectory,
            baseDirectory: directory,
            resourcePath,
            source,
            relativeDistPath,
          }),
        );
      }
    }
  }

  await readFiles(directory);
  return filesList;
}

export async function writeTargetFile(absTargetDir: string, content: string) {
  await fs.mkdir(path.dirname(absTargetDir), { recursive: true });
  await fs.writeFile(absTargetDir, content);
}

export async function copyFiles(from: string, to: string) {
  if (await fs.pathExists(from)) {
    await fs.copy(toPosixPath(from), toPosixPath(to));
  }
}
