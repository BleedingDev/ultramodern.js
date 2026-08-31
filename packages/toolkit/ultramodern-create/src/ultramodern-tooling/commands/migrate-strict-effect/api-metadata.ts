import fs from 'node:fs';
import path from 'node:path';
import type { ResolvedUltramodernPackageSource } from '../../../ultramodern-package-source';
import { type MigrationIo, readJsonFile, writeJsonFile } from './io';
import { updateUltramodernConfigToolchain } from './toolchain-pins';

const packageSourceOwnedKeys = [
  'strategy',
  'modernPackageVersion',
  'registry',
  'aliasScope',
  'aliasPackageNamePrefix',
] as const;

const retiredPackageSourceKeys = [
  'generatedWorkspacePackages',
  'metadata',
  'modernPackages',
] as const;

type PackageSourceReconciliationOptions = {
  canonical: Record<string, unknown>;
  label: string;
  ownedKeys: readonly string[];
};

function requireObject(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, any>;
}

export function reconcilePackageSourceMetadata(
  value: unknown,
  { canonical, label, ownedKeys }: PackageSourceReconciliationOptions,
): Record<string, unknown> {
  const existing = value === undefined ? {} : requireObject(value, label);
  const frameworkOwnedKeys = new Set([
    ...ownedKeys,
    ...retiredPackageSourceKeys,
  ]);

  for (const key of Object.keys(canonical)) {
    if (!frameworkOwnedKeys.has(key)) {
      throw new Error(`${label} canonical key ${key} is not framework-owned.`);
    }
  }

  const extensionEntries = Object.entries(existing).filter(
    ([key]) => !frameworkOwnedKeys.has(key),
  );
  const next = Object.fromEntries(extensionEntries);
  Object.assign(next, canonical);

  const expectedKeys = [
    ...extensionEntries.map(([key]) => key),
    ...Object.keys(canonical),
  ];
  const actualKeys = Object.keys(next);
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`${label} could not establish exact package-source keys.`);
  }

  for (const [key, extensionValue] of extensionEntries) {
    if (!Object.is(next[key], extensionValue)) {
      throw new Error(`${label} could not preserve extension key ${key}.`);
    }
  }
  for (const key of frameworkOwnedKeys) {
    const shouldExist = Object.hasOwn(canonical, key);
    if (
      Object.hasOwn(next, key) !== shouldExist ||
      (shouldExist && !Object.is(next[key], canonical[key]))
    ) {
      throw new Error(
        `${label} could not establish exact postcondition for ${key}.`,
      );
    }
  }

  return next;
}

export function reconcileCompactPackageSourceMetadata(
  value: unknown,
  packageSource: ResolvedUltramodernPackageSource,
) {
  return reconcilePackageSourceMetadata(value, {
    canonical: {
      strategy: packageSource.strategy,
      modernPackageVersion: packageSource.modernPackageVersion,
      ...(packageSource.registry ? { registry: packageSource.registry } : {}),
      ...(packageSource.aliasScope
        ? { aliasScope: packageSource.aliasScope }
        : {}),
      ...(packageSource.aliasPackageNamePrefix
        ? { aliasPackageNamePrefix: packageSource.aliasPackageNamePrefix }
        : {}),
    },
    label: 'packageSource',
    ownedKeys: packageSourceOwnedKeys,
  });
}

function normalizeStrictEffectApiMetadata(value: Record<string, any>) {
  let changed = false;
  const backendFederation = value.backendFederation;
  if (
    backendFederation &&
    typeof backendFederation === 'object' &&
    !Array.isArray(backendFederation) &&
    Object.hasOwn(backendFederation, 'entry')
  ) {
    delete backendFederation.entry;
    changed = true;
  }

  const api = value.api;
  if (!api || typeof api !== 'object' || Array.isArray(api)) {
    return changed;
  }

  if (api.backendFederation !== undefined) {
    delete api.backendFederation;
    changed = true;
  }

  const oldEffect = api.effect;
  if (oldEffect && typeof oldEffect === 'object' && !Array.isArray(oldEffect)) {
    if (api.stem === undefined && typeof oldEffect.stem === 'string') {
      api.stem = oldEffect.stem;
      changed = true;
    }
    if (api.prefix === undefined && typeof oldEffect.prefix === 'string') {
      api.prefix = oldEffect.prefix;
      changed = true;
    }
    if (api.consumedBy === undefined && Array.isArray(oldEffect.consumedBy)) {
      api.consumedBy = oldEffect.consumedBy;
      changed = true;
    }
    delete api.effect;
    changed = true;
  }

  if (api.runtime !== 'effect') {
    api.runtime = 'effect';
    changed = true;
  }

  if (api.bff && typeof api.bff === 'object' && !Array.isArray(api.bff)) {
    if (api.bff.strictEffectApproach !== true) {
      api.bff.strictEffectApproach = true;
      changed = true;
    }
  }

  if (typeof value.path === 'string') {
    const directServerEntry = `${value.path}/api/index.ts`;
    if (
      typeof api.serverEntry === 'string' &&
      /\/api\/effect\/index\.[cm]?[jt]sx?$/u.test(api.serverEntry)
    ) {
      api.serverEntry = directServerEntry;
      changed = true;
    }

    if (
      api.contract &&
      typeof api.contract === 'object' &&
      !Array.isArray(api.contract)
    ) {
      if (api.contract.export === './shared/effect/api') {
        api.contract.export = './api';
        changed = true;
      }
      if (
        typeof api.contract.path === 'string' &&
        /\/shared\/effect\/api\.[cm]?[jt]sx?$/u.test(api.contract.path)
      ) {
        api.contract.path = `${value.path}/shared/api.ts`;
        changed = true;
      }
    }

    if (
      api.client &&
      typeof api.client === 'object' &&
      !Array.isArray(api.client)
    ) {
      if (api.client.export === './effect/client') {
        api.client.export = './api/client';
        changed = true;
      }
      if (
        typeof api.client.path === 'string' &&
        /\/src\/effect\/[^/]+-client\.[cm]?ts$/u.test(api.client.path)
      ) {
        const basename = path.basename(api.client.path);
        api.client.path = `${value.path}/src/api/${basename}`;
        changed = true;
      }
    }

    if (api.serverEntry === undefined && api.runtime === 'effect') {
      api.serverEntry = directServerEntry;
      changed = true;
    }
  }

  return changed;
}

export function updateUltramodernConfig(
  io: MigrationIo,
  config: Record<string, any>,
  packageSource: ResolvedUltramodernPackageSource,
) {
  const configPath = path.join(io.workspaceRoot, '.modernjs/ultramodern.json');
  config.packageSource = reconcileCompactPackageSourceMetadata(
    config.packageSource,
    packageSource,
  );

  // Keep every version field in the compact config consistent with the
  // migrated package version. `generator.version` sits next to
  // `packageSource.modernPackageVersion`; leaving it stale produces a
  // half-bumped config.
  if (
    config.generator &&
    typeof config.generator === 'object' &&
    !Array.isArray(config.generator) &&
    typeof config.generator.version === 'string'
  ) {
    config.generator.version = packageSource.modernPackageVersion;
  }

  updateUltramodernConfigToolchain(config);

  for (const app of config.topology?.apps ?? []) {
    if (app && typeof app === 'object' && !Array.isArray(app)) {
      normalizeStrictEffectApiMetadata(app);
    }
  }

  writeJsonFile(io, configPath, config);
}

export function updateReferenceTopology(io: MigrationIo) {
  const topologyPath = path.join(
    io.workspaceRoot,
    'topology/reference-topology.json',
  );
  if (!fs.existsSync(topologyPath)) {
    return false;
  }

  const topology = readJsonFile(topologyPath);
  let changed = false;
  for (const vertical of topology.verticals ?? []) {
    if (vertical && typeof vertical === 'object' && !Array.isArray(vertical)) {
      changed = normalizeStrictEffectApiMetadata(vertical) || changed;
    }
  }

  if (changed) {
    writeJsonFile(io, topologyPath, topology);
  }

  return changed;
}
