import { defaultReactSingletons } from './defaults';
import type { UltramodernBridgeWorkspacePackage } from './schema';

export function validateParentPackageCoverage(
  workspacePackages: readonly UltramodernBridgeWorkspacePackage[],
  dependencies: readonly string[],
) {
  const declaredPackages = new Set<string>();

  for (const [index, entry] of workspacePackages.entries()) {
    const label = `bridge.workspacePackages[${index}]`;
    const packageNames = entry.packageNames ?? [];
    if (packageNames.length === 0 && (entry.testAliases ?? []).length > 0) {
      throw new Error(
        `${label}.packageNames must declare the parent package names covered by "${entry.pattern}" before testAliases can be checked.`,
      );
    }

    for (const packageName of packageNames) {
      declaredPackages.add(packageName);
    }

    for (const alias of entry.testAliases ?? []) {
      if (
        !packageNames.some(packageName =>
          aliasMatchesPackage(alias.alias, packageName),
        )
      ) {
        throw new Error(
          `${label}.testAliases entry "${alias.alias}" must match one of ${label}.packageNames.`,
        );
      }

      if (pointsAtBuildOutput(alias.target)) {
        throw new Error(
          `${label}.testAliases target "${alias.target}" must point at source files, not dist output.`,
        );
      }
    }
  }

  const missingDependencies = dependencies.filter(
    dependency => !declaredPackages.has(dependency),
  );
  if (declaredPackages.size > 0 && missingDependencies.length > 0) {
    throw new Error(
      `Bridge mode dependencies must be declared by bridge.workspacePackages[].packageNames: ${missingDependencies.join(
        ', ',
      )}.`,
    );
  }
}

function aliasMatchesPackage(alias: string, packageName: string): boolean {
  return alias === packageName || alias.startsWith(`${packageName}/`);
}

function pointsAtBuildOutput(target: string): boolean {
  return target.split(/[\\/]/u).includes('dist');
}

export function validateReactSingletons(reactSingletons: readonly string[]) {
  const missing = defaultReactSingletons.filter(
    packageName => !reactSingletons.includes(packageName),
  );

  if (missing.length > 0) {
    throw new Error(
      `Bridge mode React singleton/dedupe declarations must include ${defaultReactSingletons.join(
        ' and ',
      )}. Missing: ${missing.join(', ')}.`,
    );
  }
}
