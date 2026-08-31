import {
  createDeliveryUnitRecord,
  deliveryUnitContractBlock,
} from './delivery-unit';
import {
  createModuleFederationRemoteContracts,
  createNeutralOwnership,
  shellApp,
} from './descriptors';
import { packageName, toEnvSegment, toKebabCase, toPascalCase } from './naming';
import {
  type JsonObject,
  type JsonValue,
  type OwnerAttribution,
  resolveOwnerAttribution,
  type WorkspaceApp,
} from './types';

/**
 * Multi-shell model (G28). A workspace models N Shells, each its own Delivery
 * Unit with a distinct id / path / port / Module Federation host name. Default
 * generation still emits exactly one shell — the primary shell — with today's
 * id and path, so legacy output stays byte-identical; additional shells are
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

/**
 * Serialize one additional shell into the additive compact-config collection.
 * The primary shell remains projected through topology.apps; this record is
 * the durable source for every non-primary shell's identity and composition.
 */
export function createAdditionalShellConfigEntry(
  scope: string,
  shell: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): JsonObject {
  const verticalRefs = shell.verticalRefs ?? [];
  return {
    id: shell.id,
    name: shell.id.replace(/^shell-/u, ''),
    kind: 'shell',
    package: packageName(scope, shell.packageSuffix),
    path: shell.directory,
    port: shell.port,
    portEnv: shell.portEnv,
    mfName: shell.mfName,
    verticalRefs,
    owner: resolveOwnerAttribution(shell.ownership),
    deliveryUnit: shellDeliveryUnitBlock(scope, shell),
    moduleFederation: {
      role: 'host',
      name: shell.mfName,
      verticalRefs,
      remotes: createModuleFederationRemoteContracts(shell, remotes),
      ssr: true,
      sharedContractVersion: 'mf-ssr-contract-v1',
    },
  };
}

/**
 * Resolve the configured shells collection from a compact UltraModern config
 * (G28). Always includes the primary shell; additional shells are read from the
 * additive `shells` array so a legacy single-shell config resolves to exactly
 * `[primaryShell]`.
 */
export function resolveConfiguredAdditionalShells(
  config: Record<string, unknown> | undefined,
): WorkspaceApp[] {
  const shells = config?.shells;
  if (!Array.isArray(shells)) {
    return [];
  }
  return shells
    .filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry),
    )
    .map(entry => {
      const id = String(entry.id ?? '');
      const suffix =
        typeof entry.package === 'string'
          ? (entry.package.split('/').at(-1) ?? id)
          : id;
      const name =
        typeof entry.name === 'string' ? entry.name : id.replace(/^shell-/, '');
      const port =
        typeof entry.port === 'number'
          ? entry.port
          : FIRST_ADDITIONAL_SHELL_PORT;
      const descriptor = createShellDescriptor(name, port);
      const moduleFederation =
        entry.moduleFederation &&
        typeof entry.moduleFederation === 'object' &&
        !Array.isArray(entry.moduleFederation)
          ? (entry.moduleFederation as Record<string, unknown>)
          : undefined;
      const owner = entry.owner;
      const deliveryUnit = entry.deliveryUnit;
      const ownerAttribution: OwnerAttribution | undefined =
        owner &&
        typeof owner === 'object' &&
        !Array.isArray(owner) &&
        'kind' in owner &&
        (owner.kind === 'team' ||
          owner.kind === 'agent' ||
          owner.kind === 'agent-team') &&
        'id' in owner &&
        typeof owner.id === 'string'
          ? {
              kind: owner.kind,
              id: owner.id,
              ...('contact' in owner && typeof owner.contact === 'string'
                ? { contact: owner.contact }
                : {}),
            }
          : undefined;
      const ownership =
        ownerAttribution === undefined
          ? descriptor.ownership
          : { ...descriptor.ownership, owner: ownerAttribution };
      return {
        ...descriptor,
        id,
        packageSuffix: suffix,
        ownership,
        displayName:
          typeof entry.displayName === 'string'
            ? entry.displayName
            : descriptor.displayName,
        directory:
          typeof entry.path === 'string' ? entry.path : descriptor.directory,
        portEnv:
          typeof entry.portEnv === 'string'
            ? entry.portEnv
            : descriptor.portEnv,
        mfName:
          typeof entry.mfName === 'string'
            ? entry.mfName
            : typeof moduleFederation?.name === 'string'
              ? moduleFederation.name
              : descriptor.mfName,
        verticalRefs: Array.isArray(entry.verticalRefs)
          ? entry.verticalRefs.filter(
              (ref): ref is string => typeof ref === 'string',
            )
          : Array.isArray(moduleFederation?.verticalRefs)
            ? moduleFederation.verticalRefs.filter(
                (ref): ref is string => typeof ref === 'string',
              )
            : [],
        ...(deliveryUnit &&
        typeof deliveryUnit === 'object' &&
        !Array.isArray(deliveryUnit)
          ? { deliveryUnit: deliveryUnit as JsonObject }
          : {}),
      } satisfies WorkspaceApp;
    });
}
