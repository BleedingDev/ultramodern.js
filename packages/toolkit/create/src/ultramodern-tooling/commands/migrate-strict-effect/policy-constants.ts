import path from 'node:path';
import { ULTRAMODERN_WORKSPACE_POLICY } from '../../../ultramodern-workspace/policy';
import { createPackageRoot } from '../context';

const requiredPatches =
  ULTRAMODERN_WORKSPACE_POLICY.pnpm.patchedDependencies.required;
const conditionalPatches =
  ULTRAMODERN_WORKSPACE_POLICY.pnpm.patchedDependencies.conditional;

function requiredPatchPath(packageName: string) {
  const patch = [...requiredPatches, ...conditionalPatches].find(
    candidate => candidate.packageName === packageName,
  );
  if (!patch) {
    throw new Error(`Missing canonical patch policy for ${packageName}.`);
  }
  return patch.path;
}

export const moduleFederationModernJsPatchPath = requiredPatchPath(
  '@module-federation/modern-js-v3',
);

export const moduleFederationModernJsPatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  moduleFederationModernJsPatchPath,
);

export const moduleFederationBridgeReactPatchPath = requiredPatchPath(
  '@module-federation/bridge-react',
);

export const moduleFederationBridgeReactPatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  moduleFederationBridgeReactPatchPath,
);

export const tanstackRouterCorePatchPath = requiredPatchPath(
  '@tanstack/router-core',
);

export const tanstackRouterCorePatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  tanstackRouterCorePatchPath,
);

export const drizzleOrmDeclarationPatchPath = requiredPatchPath('drizzle-orm');

export const drizzleOrmDeclarationPatchSourcePath = path.join(
  createPackageRoot,
  'template-workspace',
  drizzleOrmDeclarationPatchPath,
);
