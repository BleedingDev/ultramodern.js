import {
  type UltramodernBridgeGate,
  type UltramodernBridgeGateInput,
  ultramodernBridgeCliFlags,
} from './schema';
import {
  readRepeatedOptionValues,
  requireNonEmptyValue,
  splitAssignment,
} from './shared';

type BridgeGateDraft = {
  name: string;
  command?: string;
  cwd?: string;
};

export function readBridgeGates(args: string[]): UltramodernBridgeGate[] {
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

export function normalizeBridgeGates(
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
