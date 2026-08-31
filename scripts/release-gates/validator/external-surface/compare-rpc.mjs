// G14-RPC: RPC surface comparator (contract-version based).
//
// Mirrors the Effect BFF cross-project contract model
// (packages/server/bff-effect/src/effect/endpoint-contracts.ts:
// each operation is stamped with a per-endpoint contract hash;
// `createOperationContractHash` / `OperationContractSource`). The RPC surface
// declares a single integer `contractVersion` that is its externally published
// major (ADR-0020 §materialization: "a new RPC contract version").
//
// Contract shape (documented in ./CONTRACT-SHAPES.md):
//   {
//     kind: 'rpc',
//     surfaceId: string,
//     contractVersion: number,             // the major
//     servedVersions?: number[],           // majors served side by side now
//     retiredMajors?: number[],            // previously-served majors whose
//                                          //   retirement is explicitly declared
//     operations: [ { name: string, contractHash: string } ]
//   }
// A breaking change is any removed op or op whose contractHash mutated, OR the
// removal of a previously-served major (servedVersions shrank) that is NOT
// explicitly listed in `retiredMajors` — silently dropping a served major is
// breaking for external consumers. Under
// ADR-0020 a published RPC major is immutable: a breaking change bumps
// `contractVersion` and keeps the previous version served (present in the new
// contract's `servedVersions`).
import { stableHash } from './hash.mjs';

function opHash(op) {
  return op.contractHash ?? stableHash(op);
}

function indexOps(contract) {
  const byName = new Map();
  for (const op of contract?.operations ?? []) byName.set(op.name, op);
  return byName;
}

/**
 * Compare two RPC surface contracts.
 * @param {object} oldContract
 * @param {object} newContract
 * @param {{ zone?: 'coordinated' | 'external' }} [options]
 */
export function compareRpcSurface(oldContract, newContract, options = {}) {
  const zone = options.zone ?? 'coordinated';
  const surfaceId = newContract?.surfaceId ?? oldContract?.surfaceId ?? '';
  const errors = [];
  const notes = [];

  const oldVersion = oldContract?.contractVersion ?? 1;
  const newVersion = newContract?.contractVersion ?? 1;
  const servedVersions = newContract?.servedVersions ?? [newVersion];
  const oldServedVersions = oldContract?.servedVersions ?? [oldVersion];
  const retiredMajors = newContract?.retiredMajors ?? [];

  const oldByName = indexOps(oldContract);
  const newByName = indexOps(newContract);

  const changes = [];
  const breakingChanges = [];

  for (const [name, oldOp] of oldByName) {
    const newOp = newByName.get(name);
    if (!newOp) {
      changes.push({ name, type: 'removed' });
      breakingChanges.push({ name, reason: 'operation removed' });
    } else if (opHash(oldOp) !== opHash(newOp)) {
      changes.push({ name, type: 'changed' });
      breakingChanges.push({ name, reason: 'operation contract hash changed' });
    } else {
      changes.push({ name, type: 'unchanged' });
    }
  }
  for (const [name] of newByName) {
    if (!oldByName.has(name)) changes.push({ name, type: 'added' });
  }

  // Removing a previously-served major without explicit retirement is breaking.
  const droppedMajors = oldServedVersions.filter(
    v => !servedVersions.includes(v) && !retiredMajors.includes(v),
  );
  for (const v of droppedMajors) {
    breakingChanges.push({
      name: `v${v}`,
      reason: 'previously-served major removed without explicit retirement',
    });
  }

  const classification = breakingChanges.length > 0 ? 'breaking' : 'additive';

  // Side-by-side: contract version bumped past the old major AND the old major
  // is still served (present in servedVersions).
  const versionBumped = newVersion > oldVersion;
  const oldStillServed = servedVersions.includes(oldVersion);
  const sideBySideSatisfied = versionBumped && oldStillServed;
  const details = !versionBumped
    ? `contractVersion not bumped (still v${newVersion})`
    : oldStillServed
      ? `contractVersion bumped v${oldVersion} -> v${newVersion} with v${oldVersion} still served`
      : `contractVersion bumped to v${newVersion} but v${oldVersion} no longer served`;

  let verdict = 'pass';
  if (classification === 'breaking') {
    if (zone === 'external') {
      if (sideBySideSatisfied) {
        verdict = 'pass-with-note';
        notes.push(
          'external breaking change materialised as new RPC contract version served side by side',
        );
      } else {
        verdict = 'fail';
        errors.push(
          'external RPC surface breaking change without a side-by-side new contract version (ADR-0020): ' +
            breakingChanges.map(b => `${b.name} (${b.reason})`).join('; '),
        );
      }
    } else {
      verdict = 'pass-with-note';
      notes.push(
        'coordinated-zone breaking change permitted; in-repo consumers must update in-change',
      );
    }
  } else if (versionBumped) {
    verdict = 'pass-with-note';
    notes.push(
      `additive contract version bump v${oldVersion} -> v${newVersion}`,
    );
  }

  return {
    kind: 'rpc',
    surfaceId,
    zone,
    oldVersion,
    newVersion,
    servedVersions,
    retiredMajors,
    droppedMajors,
    changes,
    classification,
    breakingChanges,
    sideBySide: { satisfied: sideBySideSatisfied, details },
    verdict,
    notes,
    errors,
  };
}
