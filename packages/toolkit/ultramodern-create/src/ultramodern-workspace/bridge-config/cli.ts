import { readBridgeGates } from './gates';
import { normalizeUltramodernBridgeConfig } from './normalize';
import {
  type UltramodernBridgeConfig,
  ultramodernBridgeCliBooleanFlags,
  ultramodernBridgeCliFlags,
  ultramodernBridgeCliValueFlags,
} from './schema';
import {
  parseLockfilePolicy,
  readCsvOptionValues,
  readSingleValue,
  rejectBooleanFlagValues,
  requireNonEmptyValue,
} from './shared';
import { readWorkspacePackages } from './workspace-packages';

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
