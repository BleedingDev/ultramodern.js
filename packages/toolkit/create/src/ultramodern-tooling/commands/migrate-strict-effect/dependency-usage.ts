import fs from 'node:fs';
import path from 'node:path';
import { semver } from '@modern-js/utils';
import * as pnpmYaml from './pnpm-yaml';

export function workspaceUsesDependency(
  workspaceRoot: string,
  packageName: string,
  exactVersion?: string,
) {
  const packageJsonPaths = [path.join(workspaceRoot, 'package.json')];
  let compatibleRangeDeclared = false;

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

  const aliasPrefix = `npm:${packageName}@`;
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
          specifier === `${aliasPrefix}${exactVersion}`
        ) {
          return true;
        }
        if (
          typeof specifier === 'string' &&
          semver.satisfies(exactVersion, specifier, {
            includePrerelease: true,
          })
        ) {
          compatibleRangeDeclared = true;
        }
      }

      for (const specifier of Object.values(dependencies)) {
        if (
          typeof specifier !== 'string' ||
          !specifier.startsWith(aliasPrefix)
        ) {
          continue;
        }
        const aliasedVersion = specifier.slice(aliasPrefix.length);
        if (exactVersion === undefined || aliasedVersion === exactVersion) {
          return true;
        }
        if (
          semver.satisfies(exactVersion, aliasedVersion, {
            includePrerelease: true,
          })
        ) {
          compatibleRangeDeclared = true;
        }
      }
    }
  }

  if (!exactVersion || !compatibleRangeDeclared) {
    return false;
  }

  const lockfilePath = path.join(workspaceRoot, 'pnpm-lock.yaml');
  if (!fs.existsSync(lockfilePath)) return true;
  try {
    const closure = pnpmYaml.discoverReachablePnpmLockReleaseAgeClosure(
      pnpmYaml.parsePnpmWorkspaceYaml(
        fs.readFileSync(lockfilePath, 'utf-8'),
        lockfilePath,
      ).document,
    );
    return (
      closure.unresolved.length > 0 ||
      closure.candidates.some(
        candidate =>
          candidate.packageName === packageName &&
          candidate.version === exactVersion,
      )
    );
  } catch {
    return true;
  }
}
