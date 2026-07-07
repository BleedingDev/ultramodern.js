import {
  type UltramodernBridgeTestAlias,
  type UltramodernBridgeWorkspacePackage,
  type UltramodernBridgeWorkspacePackageInput,
  ultramodernBridgeCliFlags,
} from './schema';
import {
  readRepeatedOptionValues,
  requireNonEmptyValue,
  splitAssignment,
  uniqueNonEmptyValues,
} from './shared';

type WorkspacePackageDraft = {
  pattern: string;
  packageNames: string[];
  testAliases: UltramodernBridgeTestAlias[];
};

export function readWorkspacePackages(
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

export function normalizeWorkspacePackages(
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
