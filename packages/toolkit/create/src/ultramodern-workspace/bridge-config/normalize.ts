import { defaultReactSingletons } from './defaults';
import { normalizeBridgeGates } from './gates';
import type {
  UltramodernBridgeConfig,
  UltramodernBridgeConfigInput,
} from './schema';
import {
  parseLockfilePolicy,
  requireNonEmptyValue,
  uniqueNonEmptyValues,
} from './shared';
import {
  validateParentPackageCoverage,
  validateReactSingletons,
} from './validation';
import { normalizeWorkspacePackages } from './workspace-packages';

export function normalizeUltramodernBridgeConfig(
  bridge: UltramodernBridgeConfigInput | undefined,
): UltramodernBridgeConfig | undefined {
  if (!bridge || bridge.enabled === false) {
    return undefined;
  }

  const parentRoot = requireNonEmptyValue(
    bridge.parentRoot,
    'bridge.parentRoot',
  );
  const workspacePackages = normalizeWorkspacePackages(
    bridge.workspacePackages,
  );
  const dependencies = uniqueNonEmptyValues(
    bridge.dependencies,
    'bridge.dependencies',
  );
  const gates = normalizeBridgeGates(bridge.gates);
  const reactSingletons =
    bridge.reactSingletons && bridge.reactSingletons.length > 0
      ? uniqueNonEmptyValues(bridge.reactSingletons, 'bridge.reactSingletons')
      : [...defaultReactSingletons];

  if (workspacePackages.length === 0) {
    throw new Error(
      'Bridge mode requires at least one bridge.workspacePackages entry.',
    );
  }

  if (dependencies.length === 0) {
    throw new Error(
      'Bridge mode requires at least one explicit bridge.dependencies package name.',
    );
  }

  if (gates.length === 0) {
    throw new Error(
      'Bridge mode requires at least one bridge.gates delegated parent command.',
    );
  }

  validateParentPackageCoverage(workspacePackages, dependencies);
  validateReactSingletons(reactSingletons);

  return {
    enabled: true,
    parentRoot,
    workspacePackages,
    dependencies,
    lockfilePolicy: parseLockfilePolicy(bridge.lockfilePolicy ?? 'nested'),
    gates,
    reactSingletons,
  };
}
