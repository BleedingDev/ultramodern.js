import type { UltramodernBridgeLockfilePolicy } from './schema';
import {
  ultramodernBridgeCliBooleanFlags,
  ultramodernBridgeCliFlags,
  ultramodernBridgeLockfilePolicies,
} from './schema';

export function rejectBooleanFlagValues(args: string[]) {
  for (const flag of ultramodernBridgeCliBooleanFlags) {
    if (args.some(arg => arg.startsWith(`${flag}=`))) {
      throw new Error(`${flag} does not accept a value.`);
    }
  }
}

export function readRepeatedOptionValues(
  args: string[],
  flag: string,
): string[] {
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

export function readSingleValue(
  args: string[],
  flag: string,
): string | undefined {
  const values = readRepeatedOptionValues(args, flag);
  if (values.length > 1) {
    throw new Error(`${flag} can be provided only once.`);
  }

  return values[0];
}

export function readCsvOptionValues(args: string[], flag: string): string[] {
  return readRepeatedOptionValues(args, flag).flatMap(value =>
    value
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean),
  );
}

export function requireNonEmptyValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

export function parseLockfilePolicy(
  value: string,
): UltramodernBridgeLockfilePolicy {
  if (
    !(ultramodernBridgeLockfilePolicies as readonly string[]).includes(value)
  ) {
    throw new Error(
      `${ultramodernBridgeCliFlags.lockfilePolicy} must be "nested" or "parent".`,
    );
  }

  return value as UltramodernBridgeLockfilePolicy;
}

export function splitAssignment(
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

export function uniqueNonEmptyValues(
  values: readonly string[],
  label: string,
): string[] {
  const unique = new Set<string>();

  for (const [index, value] of values.entries()) {
    unique.add(requireNonEmptyValue(value, `${label}[${index}]`));
  }

  return [...unique];
}
