import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateUltramodernWorkspace } from '../../src/ultramodern-workspace';

type CreateWorkspaceOptions = {
  tempPrefix?: string;
  workspaceDir?: string;
};

export function createWorkspace(
  packageNameOrWorkspaceDir: string,
  options: CreateWorkspaceOptions = {},
) {
  const usesExplicitWorkspaceDir =
    options.workspaceDir !== undefined ||
    path.isAbsolute(packageNameOrWorkspaceDir);
  const packageName =
    usesExplicitWorkspaceDir && options.workspaceDir === undefined
      ? path.basename(packageNameOrWorkspaceDir)
      : packageNameOrWorkspaceDir;
  const workspaceDir =
    options.workspaceDir ??
    (usesExplicitWorkspaceDir
      ? packageNameOrWorkspaceDir
      : path.join(
          fs.mkdtempSync(path.join(os.tmpdir(), options.tempPrefix ?? 'um-')),
          packageName,
        ));
  const tempRoot = path.dirname(workspaceDir);

  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName,
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: { strategy: 'workspace' },
  });

  return { tempRoot, workspaceDir };
}

export function listFiles(root: string, dir = root): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(root, entryPath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, entryPath).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

export function snapshotWorkspace(
  workspaceDir: string,
): Record<string, string> {
  return Object.fromEntries(
    listFiles(workspaceDir).map(relativePath => [
      relativePath,
      fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
    ]),
  );
}
