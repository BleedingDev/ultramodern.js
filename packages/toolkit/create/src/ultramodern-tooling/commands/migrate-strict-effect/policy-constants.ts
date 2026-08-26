import path from 'node:path';
import { ULTRAMODERN_WORKSPACE_POLICY } from '../../../ultramodern-workspace/policy';
import { createPackageRoot } from '../context';

const conditionalPatches =
  ULTRAMODERN_WORKSPACE_POLICY.pnpm.patchedDependencies.conditional;

function conditionalPatchPath(packageName: string) {
  const patch = conditionalPatches.find(
    candidate => candidate.packageName === packageName,
  );
  if (!patch) {
    throw new Error(`Missing canonical patch policy for ${packageName}.`);
  }
  return patch.path;
}

function patchSourcePath(patchPath: string) {
  return path.join(createPackageRoot, 'template-workspace', patchPath);
}

export const requiredGeneratedPatches =
  ULTRAMODERN_WORKSPACE_POLICY.pnpm.patchedDependencies.required.map(patch => ({
    path: patch.path,
    sourcePath: patchSourcePath(patch.path),
  }));

export const drizzleOrmDeclarationPatchPath =
  conditionalPatchPath('drizzle-orm');

export const drizzleOrmDeclarationPatchSourcePath = patchSourcePath(
  drizzleOrmDeclarationPatchPath,
);
