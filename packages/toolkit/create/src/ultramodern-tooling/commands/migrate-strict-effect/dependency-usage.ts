import fs from 'node:fs';
import path from 'node:path';

export function workspaceUsesDependency(
  workspaceRoot: string,
  packageName: string,
  exactVersion?: string,
) {
  const packageJsonPaths = [path.join(workspaceRoot, 'package.json')];

  for (const workspaceDir of ['apps', 'verticals', 'packages']) {
    const absoluteWorkspaceDir = path.join(workspaceRoot, workspaceDir);
    if (!fs.existsSync(absoluteWorkspaceDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(absoluteWorkspaceDir, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageJsonPath = path.join(
        absoluteWorkspaceDir,
        entry.name,
        'package.json',
      );
      if (fs.existsSync(packageJsonPath)) {
        packageJsonPaths.push(packageJsonPath);
      }
    }
  }

  for (const packageJsonPath of packageJsonPaths) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const dependencies = packageJson[field];
      if (!dependencies || typeof dependencies !== 'object') {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(dependencies, packageName)) {
        const specifier = dependencies[packageName];
        if (
          exactVersion === undefined ||
          specifier === exactVersion ||
          specifier === `npm:${packageName}@${exactVersion}`
        ) {
          return true;
        }
      }

      for (const specifier of Object.values(dependencies)) {
        if (
          typeof specifier === 'string' &&
          (exactVersion === undefined
            ? specifier.startsWith(`npm:${packageName}@`)
            : specifier === `npm:${packageName}@${exactVersion}`)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}
