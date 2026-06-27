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

const defaultReactSingletons = ['react', 'react-dom'] as const;

type WorkspacePackageDraft = {
  pattern: string;
  packageNames: string[];
  testAliases: UltramodernBridgeTestAlias[];
};

type BridgeGateDraft = {
  name: string;
  command?: string;
  cwd?: string;
};

export function hasUltramodernBridgeCliOptions(args: string[]): boolean {
  return args.some(arg =>
    [
      ...ultramodernBridgeCliBooleanFlags,
      ...ultramodernBridgeCliValueFlags,
    ].some(flag => arg === flag || arg.startsWith(`${flag}=`)),
  );
}

export function parseUltramodernBridgeCliOptions(
  args: string[],
): UltramodernBridgeConfig | undefined {
  rejectBooleanFlagValues(args);

  if (!hasUltramodernBridgeCliOptions(args)) {
    return undefined;
  }

  const parentRoot = readSingleValue(
    args,
    ultramodernBridgeCliFlags.parentRoot,
  );
  const lockfilePolicy =
    readSingleValue(args, ultramodernBridgeCliFlags.lockfilePolicy) ?? 'nested';

  const workspacePackages = readWorkspacePackages(args);
  const gates = readBridgeGates(args);
  const reactSingletons = readCsvOptionValues(
    args,
    ultramodernBridgeCliFlags.reactSingleton,
  );

  return normalizeUltramodernBridgeConfig({
    enabled: true,
    parentRoot: requireNonEmptyValue(
      parentRoot,
      ultramodernBridgeCliFlags.parentRoot,
    ),
    workspacePackages,
    dependencies: readCsvOptionValues(
      args,
      ultramodernBridgeCliFlags.dependency,
    ),
    lockfilePolicy: parseLockfilePolicy(lockfilePolicy),
    gates,
    reactSingletons: reactSingletons.length > 0 ? reactSingletons : undefined,
  });
}

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

function rejectBooleanFlagValues(args: string[]) {
  for (const flag of ultramodernBridgeCliBooleanFlags) {
    if (args.some(arg => arg.startsWith(`${flag}=`))) {
      throw new Error(`${flag} does not accept a value.`);
    }
  }
}

function readRepeatedOptionValues(args: string[], flag: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === flag) {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`${flag} requires a value.`);
      }
      values.push(value);
      index += 1;
      continue;
    }

    if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    }
  }

  return values;
}

function readSingleValue(args: string[], flag: string): string | undefined {
  const values = readRepeatedOptionValues(args, flag);
  if (values.length > 1) {
    throw new Error(`${flag} can be provided only once.`);
  }

  return values[0];
}

function readCsvOptionValues(args: string[], flag: string): string[] {
  return readRepeatedOptionValues(args, flag).flatMap(value =>
    value
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean),
  );
}

function requireNonEmptyValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function parseLockfilePolicy(value: string): UltramodernBridgeLockfilePolicy {
  if (
    !(ultramodernBridgeLockfilePolicies as readonly string[]).includes(value)
  ) {
    throw new Error(
      `${ultramodernBridgeCliFlags.lockfilePolicy} must be "nested" or "parent".`,
    );
  }

  return value as UltramodernBridgeLockfilePolicy;
}

function readWorkspacePackages(
  args: string[],
): UltramodernBridgeWorkspacePackage[] {
  const drafts = new Map<string, WorkspacePackageDraft>();
  const getDraft = (pattern: string) => {
    const normalizedPattern = requireNonEmptyValue(
      pattern,
      ultramodernBridgeCliFlags.workspacePackage,
    );
    const existing = drafts.get(normalizedPattern);
    if (existing) {
      return existing;
    }

    const draft: WorkspacePackageDraft = {
      pattern: normalizedPattern,
      packageNames: [],
      testAliases: [],
    };
    drafts.set(normalizedPattern, draft);
    return draft;
  };

  for (const pattern of readRepeatedOptionValues(
    args,
    ultramodernBridgeCliFlags.workspacePackage,
  )) {
    getDraft(pattern);
  }

  for (const value of readRepeatedOptionValues(
    args,
    ultramodernBridgeCliFlags.workspacePackageName,
  )) {
    const { left: pattern, right: packageNames } = splitAssignment(
      value,
      ultramodernBridgeCliFlags.workspacePackageName,
      '<pattern>=<package-name>[,<package-name>]',
    );
    getDraft(pattern).packageNames.push(
      ...packageNames
        .split(',')
        .map(packageName => packageName.trim())
        .filter(Boolean),
    );
  }

  for (const value of readRepeatedOptionValues(
    args,
    ultramodernBridgeCliFlags.testAlias,
  )) {
    const separator = value.indexOf(':');
    if (separator === -1) {
      throw new Error(
        `${ultramodernBridgeCliFlags.testAlias} must use <pattern>:<alias>=<target>.`,
      );
    }

    const pattern = value.slice(0, separator);
    const aliasDefinition = value.slice(separator + 1);
    const { left: alias, right: target } = splitAssignment(
      aliasDefinition,
      ultramodernBridgeCliFlags.testAlias,
      '<pattern>:<alias>=<target>',
    );
    getDraft(pattern).testAliases.push({
      alias: requireNonEmptyValue(
        alias,
        `${ultramodernBridgeCliFlags.testAlias} alias`,
      ),
      target: requireNonEmptyValue(
        target,
        `${ultramodernBridgeCliFlags.testAlias} target`,
      ),
    });
  }

  return normalizeWorkspacePackages([...drafts.values()]);
}

function readBridgeGates(args: string[]): UltramodernBridgeGate[] {
  const gates = new Map<string, BridgeGateDraft>();
  const getGate = (name: string) => {
    const normalizedName = requireNonEmptyValue(
      name,
      `${ultramodernBridgeCliFlags.gate} name`,
    );
    const existing = gates.get(normalizedName);
    if (existing) {
      return existing;
    }

    const draft: BridgeGateDraft = { name: normalizedName };
    gates.set(normalizedName, draft);
    return draft;
  };

  for (const value of readRepeatedOptionValues(
    args,
    ultramodernBridgeCliFlags.gate,
  )) {
    const { left: name, right: command } = splitAssignment(
      value,
      ultramodernBridgeCliFlags.gate,
      '<name>=<command>',
    );
    getGate(name).command = requireNonEmptyValue(
      command,
      `${ultramodernBridgeCliFlags.gate} command`,
    );
  }

  for (const value of readRepeatedOptionValues(
    args,
    ultramodernBridgeCliFlags.gateCwd,
  )) {
    const { left: name, right: cwd } = splitAssignment(
      value,
      ultramodernBridgeCliFlags.gateCwd,
      '<name>=<cwd>',
    );
    getGate(name).cwd = requireNonEmptyValue(
      cwd,
      `${ultramodernBridgeCliFlags.gateCwd} cwd`,
    );
  }

  const missingCommand = [...gates.values()].find(gate => !gate.command);
  if (missingCommand) {
    throw new Error(
      `${ultramodernBridgeCliFlags.gateCwd} references "${missingCommand.name}" without a matching ${ultramodernBridgeCliFlags.gate}.`,
    );
  }

  return normalizeBridgeGates(
    [...gates.values()].map(gate => ({
      name: gate.name,
      command: gate.command as string,
      cwd: gate.cwd,
    })),
  );
}

function splitAssignment(
  value: string,
  flag: string,
  usage: string,
): { left: string; right: string } {
  const separator = value.indexOf('=');
  if (separator === -1) {
    throw new Error(`${flag} must use ${usage}.`);
  }

  return {
    left: value.slice(0, separator),
    right: value.slice(separator + 1),
  };
}

function normalizeWorkspacePackages(
  workspacePackages: readonly UltramodernBridgeWorkspacePackageInput[],
): UltramodernBridgeWorkspacePackage[] {
  return workspacePackages.map((entry, index) => {
    const label = `bridge.workspacePackages[${index}]`;
    const packageNames =
      entry.packageNames && entry.packageNames.length > 0
        ? uniqueNonEmptyValues(entry.packageNames, `${label}.packageNames`)
        : undefined;
    const testAliases =
      entry.testAliases && entry.testAliases.length > 0
        ? normalizeTestAliases(entry.testAliases, label)
        : undefined;

    return {
      pattern: requireNonEmptyValue(entry.pattern, `${label}.pattern`),
      ...(packageNames ? { packageNames } : {}),
      ...(testAliases ? { testAliases } : {}),
    };
  });
}

function validateParentPackageCoverage(
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

function validateReactSingletons(reactSingletons: readonly string[]) {
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

function normalizeTestAliases(
  testAliases: readonly UltramodernBridgeTestAlias[],
  parentLabel: string,
): UltramodernBridgeTestAlias[] {
  const aliases = new Map<string, UltramodernBridgeTestAlias>();

  for (const [index, alias] of testAliases.entries()) {
    const label = `${parentLabel}.testAliases[${index}]`;
    const normalizedAlias = requireNonEmptyValue(alias.alias, `${label}.alias`);
    aliases.set(normalizedAlias, {
      alias: normalizedAlias,
      target: requireNonEmptyValue(alias.target, `${label}.target`),
    });
  }

  return [...aliases.values()];
}

function normalizeBridgeGates(
  gates: readonly UltramodernBridgeGateInput[],
): UltramodernBridgeGate[] {
  const normalized = new Map<string, UltramodernBridgeGate>();

  for (const [index, gate] of gates.entries()) {
    const label = `bridge.gates[${index}]`;
    const name = requireNonEmptyValue(gate.name, `${label}.name`);
    normalized.set(name, {
      name,
      command: requireNonEmptyValue(gate.command, `${label}.command`),
      ...(gate.cwd
        ? { cwd: requireNonEmptyValue(gate.cwd, `${label}.cwd`) }
        : {}),
    });
  }

  return [...normalized.values()];
}

function uniqueNonEmptyValues(
  values: readonly string[],
  label: string,
): string[] {
  const unique = new Set<string>();

  for (const [index, value] of values.entries()) {
    unique.add(requireNonEmptyValue(value, `${label}[${index}]`));
  }

  return [...unique];
}
