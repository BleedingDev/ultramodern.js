import {
  createDeliveryUnitRecord,
  deliveryUnitContractBlock,
} from './delivery-unit';
import { createNeutralOwnership, shellApp } from './descriptors';
import { toEnvSegment, toKebabCase, toPascalCase } from './naming';
import { type JsonValue, type WorkspaceApp } from './types';

/**
 * Multi-shell model (G28). A workspace models N Shells, each its own Delivery
 * Unit with a distinct id / path / port / Module Federation host name. Default
 * generation still emits exactly one shell — the primary shell — with today's
 * id and path, so default output stays byte-identical; additional shells are
 * added explicitly via the `add-shell` operation.
 *
 * A Shell (CONTEXT.md) is a thin composition host: it owns top-level routing,
 * provisions the Platform Baseline, and composes MicroVertical surfaces. It is
 * its own Delivery Unit but not a MicroVertical. Multiple shells (a super app,
 * an admin app, an external customer's app) may compose overlapping subsets of
 * the same verticals.
 */
export const PRIMARY_SHELL_ID = shellApp.id;

export const FIRST_ADDITIONAL_SHELL_PORT = 3120;

/**
 * Build the descriptor for an additional (non-primary) shell delivery unit
 * (G28). Its id / directory / package suffix / Module Federation host name /
 * port env are all shell-specific so multiple shells never collide.
 */
export function createShellDescriptor(
  name: string,
  port: number,
): WorkspaceApp {
  const normalized = toKebabCase(name);
  const id = `shell-${normalized}`;
  const displayPrefix = toPascalCase(normalized).replace(
    /([a-z])([A-Z])/g,
    '$1 $2',
  );
  return {
    id,
    directory: `apps/${id}`,
    packageSuffix: id,
    displayName: `${displayPrefix} Shell`,
    kind: 'shell',
    portEnv: `SHELL_${toEnvSegment(normalized)}_PORT`,
    port,
    mfName: `shell${toPascalCase(normalized)}`,
    verticalRefs: [],
    ownership: createNeutralOwnership(id, 'tier-0-shell'),
  };
}

/**
 * Validate an additional-shell name. Reuses the vertical-name grammar
 * (lowercase kebab-case) and rejects the reserved primary-shell suffix so an
 * additional shell can never shadow the primary `shell-super-app`.
 */
export function assertValidShellName(name: string): string {
  const normalized = toKebabCase(name);
  if (!normalized || normalized !== name) {
    throw new Error(`Invalid Shell name "${name}". Use lowercase kebab-case.`);
  }
  if (
    `shell-${normalized}` === PRIMARY_SHELL_ID ||
    normalized === 'super-app'
  ) {
    throw new Error(
      `Shell name "${name}" is reserved for the primary shell (${PRIMARY_SHELL_ID}).`,
    );
  }
  return normalized;
}

/**
 * The per-shell delivery-unit identity block (G28 / G29 pattern). Every shell
 * — primary or additional — carries a stamped delivery-unit descriptor, the
 * same shape verticals stamp in contracts.ts, so a shell is a first-class
 * Delivery Unit with its own build marker and unit id.
 */
export function shellDeliveryUnitBlock(
  scope: string,
  shell: WorkspaceApp,
): JsonValue {
  return (
    shell.deliveryUnit ??
    deliveryUnitContractBlock(createDeliveryUnitRecord(scope, shell))
  );
}
