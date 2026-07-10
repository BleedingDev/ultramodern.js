// Workspace model — loads the generated MicroVertical topology/ownership JSONs
// and builds the unit index every tool keys off. This is the layer audit.mjs
// structurally lacks (spike §6): unit/surface attribution.
//
// Sources of truth in a generated workspace:
//   .modernjs/ultramodern.json  — workspace.packageScope, topology.apps[]
//                                  (moduleFederation role/exposes/remotes/
//                                   verticalRefs, api.consumedBy)
//   topology/ownership.json     — owners[] {id, package, path} (authoritative
//                                  file->unit attribution incl. packages/*)
import fs from 'node:fs';
import path from 'node:path';

export function isUltramodernWorkspace(wsRoot) {
  return fs.existsSync(path.join(wsRoot, '.modernjs/ultramodern.json'));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// Build the full unit index from contract + ownership.
export function loadWorkspace(wsRoot) {
  const contract = readJson(path.join(wsRoot, '.modernjs/ultramodern.json'));
  const scope = contract.workspace.packageScope;
  const apps = contract.topology?.apps ?? [];

  // Ownership gives authoritative id -> path (verticals/*, apps/*, packages/*).
  let owners = [];
  const ownershipPath = path.join(wsRoot, 'topology/ownership.json');
  if (fs.existsSync(ownershipPath)) {
    owners = (readJson(ownershipPath).owners ?? []).map(o => ({
      id: o.id,
      package: o.package,
      path: o.path,
    }));
  }
  // Fallback: derive units from contract apps if ownership.json is absent.
  if (owners.length === 0) {
    owners = apps.map(a => ({
      id: a.id,
      package: `@${scope}/${a.packageSuffix ?? a.id}`,
      path: a.moduleFederation?.role === 'host' ? `apps/${a.id}` : `verticals/${a.id}`,
    }));
  }

  // Longest-prefix-first so nested paths attribute correctly.
  const unitByPath = [...owners].sort((a, b) => b.path.length - a.path.length);
  const unitIds = new Set(owners.map(o => o.id));

  // package suffix -> unit id (suffix = last segment of '@scope/<suffix>').
  const suffixToUnit = new Map();
  for (const o of owners) {
    if (o.package?.startsWith(`@${scope}/`)) {
      suffixToUnit.set(o.package.slice(`@${scope}/`.length), o.id);
    }
  }
  for (const a of apps) {
    if (a.packageSuffix) suffixToUnit.set(a.packageSuffix, a.id);
  }

  // MF remote alias -> unit id (from any host's remotes[] registration).
  const aliasToUnit = new Map();
  for (const a of apps) {
    for (const r of a.moduleFederation?.remotes ?? []) {
      aliasToUnit.set(r.alias, r.id);
    }
  }

  // Canonical unit identity, mirroring (not importing) the unitId derivation in
  // packages/toolkit/create/src/ultramodern-workspace/delivery-unit.ts:
  //   unitId = `${scope}/${app.domain ?? app.id}`.
  // ownership.json carries no domain, so we cross-reference the contract app by
  // id for an optional `domain`, falling back to the owner/app id.
  const appById = new Map(apps.map(a => [a.id, a]));
  const canonicalById = new Map(); // owner.id -> `${scope}/${domain ?? id}`
  const unitByCanonical = new Map(); // canonical -> owner.id
  for (const o of owners) {
    const domain = appById.get(o.id)?.domain ?? o.id;
    const canonical = `${scope}/${domain}`;
    canonicalById.set(o.id, canonical);
    unitByCanonical.set(canonical, o.id);
  }

  return {
    wsRoot,
    scope,
    contract,
    apps,
    owners,
    unitByPath,
    unitIds,
    suffixToUnit,
    aliasToUnit,
    appById,
    canonicalById,
    unitByCanonical,
  };
}

// Canonical delivery-unit id for an owner/app id (`${scope}/${domain ?? id}`).
export function canonicalUnitId(ws, unitId) {
  return ws.canonicalById.get(unitId) ?? `${ws.scope}/${unitId}`;
}

// Published-surface subpaths a provider unit legitimately exposes: its MF
// exposes (with the leading `./` stripped, e.g. `Route`, `Widget`) plus the
// published API-client subpaths when the unit declares an `api`. Deep imports of
// any OTHER subpath cross-unit bypass the Isolation Boundary.
export function publishedSubpaths(ws, unitId) {
  const app = ws.appById.get(unitId);
  const allowed = new Set();
  const exposes = app?.moduleFederation?.exposes ?? ['./Route', './Widget'];
  for (const exp of exposes) allowed.add(exp.replace(/^\.\//, ''));
  if (app?.api) {
    allowed.add('api/client');
    allowed.add('api/clients');
  }
  return allowed;
}

// Attribute a workspace-relative POSIX path to its owning delivery unit id,
// or null for shared/non-unit paths (scripts/, topology/, root files).
export function attributeUnit(ws, relPath) {
  for (const owner of ws.unitByPath) {
    if (relPath === owner.path || relPath.startsWith(`${owner.path}/`)) {
      return owner.id;
    }
  }
  return null;
}

// Declared edges from the contract (spike §2.3): host verticalRefs x provider
// exposes, plus api.consumedBy. Returns Map<key, {consumer,provider,surface,source}>.
export function declaredEdges(ws) {
  const declared = new Map();
  const add = (consumer, provider, surface, source) => {
    const key = `${consumer}->${provider}#${surface}`;
    if (!declared.has(key)) declared.set(key, { consumer, provider, surface, source });
  };
  for (const app of ws.apps) {
    const mf = app.moduleFederation;
    if (mf?.role === 'host') {
      for (const ref of mf.verticalRefs ?? []) {
        const providerApp = ws.apps.find(a => a.id === ref);
        const exposes = providerApp?.moduleFederation?.exposes ?? ['./Route', './Widget'];
        for (const exp of exposes) {
          add(app.id, ref, exp.replace(/^\.\//, ''), 'verticalRefs+exposes');
        }
      }
    }
    if (app.api?.consumedBy) {
      for (const consumer of app.api.consumedBy) {
        add(consumer, app.id, 'api', 'api.consumedBy');
      }
    }
  }
  return declared;
}
