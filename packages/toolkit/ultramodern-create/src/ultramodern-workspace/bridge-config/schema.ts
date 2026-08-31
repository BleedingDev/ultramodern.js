export const ultramodernBridgeCliFlags = {
  enabled: '--bridge',
  parentRoot: '--bridge-parent-root',
  workspacePackage: '--bridge-workspace-package',
  workspacePackageName: '--bridge-workspace-package-name',
  testAlias: '--bridge-test-alias',
  dependency: '--bridge-dependency',
  lockfilePolicy: '--bridge-lockfile-policy',
  gate: '--bridge-gate',
  gateCwd: '--bridge-gate-cwd',
  reactSingleton: '--bridge-react-singleton',
} as const;

export const ultramodernBridgeCliValueFlags = [
  ultramodernBridgeCliFlags.parentRoot,
  ultramodernBridgeCliFlags.workspacePackage,
  ultramodernBridgeCliFlags.workspacePackageName,
  ultramodernBridgeCliFlags.testAlias,
  ultramodernBridgeCliFlags.dependency,
  ultramodernBridgeCliFlags.lockfilePolicy,
  ultramodernBridgeCliFlags.gate,
  ultramodernBridgeCliFlags.gateCwd,
  ultramodernBridgeCliFlags.reactSingleton,
] as const;

export const ultramodernBridgeCliBooleanFlags = [
  ultramodernBridgeCliFlags.enabled,
] as const;

export const ultramodernBridgeLockfilePolicies = ['nested', 'parent'] as const;

export type UltramodernBridgeLockfilePolicy =
  (typeof ultramodernBridgeLockfilePolicies)[number];

export type UltramodernBridgeTestAlias = {
  alias: string;
  target: string;
};

export type UltramodernBridgeWorkspacePackage = {
  pattern: string;
  packageNames?: string[];
  testAliases?: UltramodernBridgeTestAlias[];
};

export type UltramodernBridgeGate = {
  name: string;
  command: string;
  cwd?: string;
};

export type UltramodernBridgeConfig = {
  enabled: true;
  parentRoot: string;
  workspacePackages: UltramodernBridgeWorkspacePackage[];
  dependencies: string[];
  lockfilePolicy: UltramodernBridgeLockfilePolicy;
  gates: UltramodernBridgeGate[];
  reactSingletons: string[];
};

export type UltramodernBridgeWorkspacePackageInput = {
  pattern: string;
  packageNames?: readonly string[];
  testAliases?: readonly UltramodernBridgeTestAlias[];
};

export type UltramodernBridgeGateInput = {
  name: string;
  command: string;
  cwd?: string;
};

export type UltramodernEnabledBridgeConfigInput = {
  enabled?: true;
  parentRoot: string;
  workspacePackages: readonly UltramodernBridgeWorkspacePackageInput[];
  dependencies: readonly string[];
  lockfilePolicy?: UltramodernBridgeLockfilePolicy;
  gates: readonly UltramodernBridgeGateInput[];
  reactSingletons?: readonly string[];
};

export type UltramodernBridgeConfigInput =
  | UltramodernEnabledBridgeConfigInput
  | { enabled: false };
