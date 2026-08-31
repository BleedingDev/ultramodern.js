import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ResolvedUltramodernPackageSource } from '../../../ultramodern-package-source';
import {
  readWorkspaceReleaseCohort,
  releaseCohortSelectors,
  type UltramodernReleaseCohort,
} from '../../../ultramodern-release-cohort';
import { resolveWorkspacePackageLinkingPolicy } from '../../../ultramodern-workspace/package-source';
import {
  renderMinimumReleaseAgeExclude,
  resolveReleaseAgeApprovals,
  ULTRAMODERN_PACKAGE_PINS,
  ULTRAMODERN_WORKSPACE_POLICY,
  type UltramodernPatchPolicy,
} from '../../../ultramodern-workspace/policy';
import { workspaceUsesDependency } from './dependency-usage';
import type { MigrationIo } from './io';
import {
  discoverReachablePnpmLockReleaseAgeClosure,
  isYamlRecord,
  type PnpmWorkspaceYaml,
  parsePnpmWorkspaceYaml,
  stringifyPnpmWorkspaceYaml,
} from './pnpm-yaml';

const legacyBareReleaseAgePackages = new Set([
  ...Object.keys(ULTRAMODERN_PACKAGE_PINS.appDependencies),
  ...Object.keys(ULTRAMODERN_PACKAGE_PINS.appDevDependencies),
  ...Object.keys(ULTRAMODERN_PACKAGE_PINS.transitiveDependencies),
  '@module-federation/bridge-react-webpack-plugin',
  '@module-federation/cli',
  '@module-federation/dts-plugin',
  '@module-federation/enhanced',
  '@module-federation/error-codes',
  '@module-federation/inject-external-runtime-core-plugin',
  '@module-federation/managers',
  '@module-federation/manifest',
  '@module-federation/rsbuild-plugin',
  '@module-federation/rspack',
  '@module-federation/runtime-core',
  '@module-federation/runtime-tools',
  '@module-federation/sdk',
  '@module-federation/third-party-dts-extractor',
  '@module-federation/webpack-bundler-runtime',
  '@rsbuild/core',
  '@rsbuild/plugin-react',
  '@rsbuild/plugin-type-check',
  '@rspack/binding',
  '@rspack/core',
  '@rspack/plugin-react-refresh',
  'ts-checker-rspack-plugin',
]);

const staleOxcBindingTargets = [
  'android-arm-eabi',
  'android-arm64',
  'darwin-arm64',
  'darwin-x64',
  'freebsd-x64',
  'linux-arm-gnueabihf',
  'linux-arm-musleabihf',
  'linux-arm64-gnu',
  'linux-arm64-musl',
  'linux-ppc64-gnu',
  'linux-riscv64-gnu',
  'linux-riscv64-musl',
  'linux-s390x-gnu',
  'linux-x64-gnu',
  'linux-x64-musl',
  'openharmony-arm64',
  'win32-arm64-msvc',
  'win32-ia32-msvc',
  'win32-x64-msvc',
] as const;

const reviewedAugust10EffectTsgoPackages = [
  '@effect/tsgo',
  '@effect/tsgo-win32-x64',
  '@effect/tsgo-win32-arm64',
  '@effect/tsgo-linux-x64',
  '@effect/tsgo-linux-arm64',
  '@effect/tsgo-linux-arm',
  '@effect/tsgo-darwin-x64',
  '@effect/tsgo-darwin-arm64',
] as const;

// Recognition-only selectors authenticated by
// release-age-review-2026-08-10.json. They were emitted by older generated
// workspaces, but must never become active approvals again.
const reviewedAugust10StaleReleaseAgeEntries = [
  'effect@4.0.0-beta.107',
  '@effect/opentelemetry@4.0.0-beta.107',
  '@effect/vitest@4.0.0-beta.107',
  ...reviewedAugust10EffectTsgoPackages.map(
    packageName => `${packageName}@0.36.2`,
  ),
  'oxlint@1.78.0',
  ...staleOxcBindingTargets.map(target => `@oxlint/binding-${target}@1.78.0`),
  'oxfmt@0.63.0',
  ...staleOxcBindingTargets.map(target => `@oxfmt/binding-${target}@0.63.0`),
] as const;

// Recognition-only selectors authenticated by
// release-age-review-2026-08-24.json and release-age-review-2026-08-25.json.
// They were emitted by older generated workspaces, but must never become
// active approvals again.
const reviewedAugust24And25StaleReleaseAgeEntries = [
  '@rsbuild/core@2.2.0-rc.0',
  'baseline-browser-mapping@2.11.19',
  'electron-to-chromium@1.5.413',
  'caniuse-lite@1.0.30001810',
  'electron-to-chromium@1.5.414',
] as const;

const knownStaleReleaseAgeEntries = new Set([
  '@effect/opentelemetry@4.0.0-beta.92',
  '@effect/opentelemetry@4.0.0-beta.94',
  '@effect/opentelemetry@4.0.0-beta.97',
  // @effect/vitest only became a release-age approval while the cohort was
  // already on beta.97, so no beta.92/beta.94 workspace ever emitted it into
  // minimumReleaseAgeExclude. It is also never emitted into
  // trustPolicyExclude (only effect and @effect/opentelemetry are), so it
  // needs no assertOwnedTrustPolicyList clause.
  '@effect/vitest@4.0.0-beta.97',
  '@typescript/native-preview@7.0.0-dev.20260628.1',
  '@typescript/typescript6@6.0.2',
  '@cloudflare/workers-types@5.20260708.1',
  'effect@4.0.0-beta.92',
  'effect@4.0.0-beta.94',
  'effect@4.0.0-beta.97',
  'i18next@26.3.1',
  'miniflare@4.20260708.0',
  'workerd@1.20260708.1',
  'wrangler@4.109.0',
  'ultracite@7.10.2',
  'ultracite@7.10.5',
  'oxfmt@0.64.0',
  'oxlint@1.79.0',
  ...staleOxcBindingTargets.map(target => `@oxfmt/binding-${target}@0.64.0`),
  ...staleOxcBindingTargets.map(target => `@oxlint/binding-${target}@1.79.0`),
  ...reviewedAugust10StaleReleaseAgeEntries,
  ...reviewedAugust24And25StaleReleaseAgeEntries,
  ...ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals
    .filter(approval => approval.packageName.startsWith('@module-federation/'))
    .map(approval => `${approval.packageName}@2.6.0`),
]);

const canonicalReleaseAgeEntries = new Set(
  ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals.map(
    approval => `${approval.packageName}@${approval.version}`,
  ),
);

const retiredTypescriptPeerOverrides = new Set([
  '@module-federation/dts-plugin>typescript',
  '@module-federation/enhanced>typescript',
  '@module-federation/modern-js-v3>typescript',
  '@module-federation/rspack>typescript',
  'i18next>typescript',
]);

type RegistryResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export type ReleaseAgeRegistryFetch = (
  url: URL,
  init: { headers: Record<string, string>; redirect: 'error' },
) => Promise<RegistryResponse>;

function ensureMap(document: PnpmWorkspaceYaml, key: string) {
  const current = document[key];
  if (current === undefined) {
    const created: PnpmWorkspaceYaml = {};
    document[key] = created;
    return created;
  }
  if (!isYamlRecord(current)) {
    throw new Error(`pnpm-workspace.yaml ${key} must be a mapping.`);
  }
  return current;
}

function setOwnedScalar(
  document: PnpmWorkspaceYaml,
  key: string,
  value: string | number | boolean,
) {
  const current = document[key];
  if (current !== undefined && typeof current === 'object') {
    throw new Error(`pnpm-workspace.yaml ${key} must be a scalar.`);
  }
  document[key] = value;
}

function reconcileOwnedMap(
  target: PnpmWorkspaceYaml,
  expected: Readonly<Record<string, string | boolean>>,
) {
  for (const [key, value] of Object.entries(expected)) {
    target[key] = value;
  }
}

function assertUniqueStringList(value: unknown, key: string) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`pnpm-workspace.yaml ${key} must be a string list.`);
  }
  const entries = value as string[];
  if (new Set(entries).size !== entries.length) {
    throw new Error(`pnpm-workspace.yaml ${key} contains duplicate entries.`);
  }
  return entries;
}

function packageVersionParts(selector: string) {
  const separator = selector.lastIndexOf('@');
  if (separator <= 0) {
    return undefined;
  }
  return {
    packageName: selector.slice(0, separator),
    version: selector.slice(separator + 1),
  };
}

function assertOwnedReleaseAgeList(
  current: unknown,
  expected: readonly string[],
) {
  const entries = assertUniqueStringList(current, 'minimumReleaseAgeExclude');
  const expectedSet = new Set(expected);

  for (const entry of entries) {
    if (
      expectedSet.has(entry) ||
      canonicalReleaseAgeEntries.has(entry) ||
      knownStaleReleaseAgeEntries.has(entry)
    ) {
      continue;
    }
    if (
      entry === '@bleedingdev/modern-js-*' ||
      entry === '@module-federation/*' ||
      entry === '@rspack/binding-*' ||
      legacyBareReleaseAgePackages.has(entry)
    ) {
      continue;
    }
    if (/^@bleedingdev\/modern-js-[^@]+@[^@]+$/u.test(entry)) {
      continue;
    }

    throw new Error(
      `Unapproved release-age exclusion "${entry}" has no canonical review evidence.`,
    );
  }
}

function assertOwnedTrustPolicyList(
  current: unknown,
  expected: readonly string[],
) {
  const entries = assertUniqueStringList(current, 'trustPolicyExclude');
  const expectedSet = new Set(expected);
  for (const entry of entries) {
    if (
      expectedSet.has(entry) ||
      entry === 'effect@4.0.0-beta.92' ||
      entry === '@effect/opentelemetry@4.0.0-beta.92' ||
      entry === 'effect@4.0.0-beta.94' ||
      entry === '@effect/opentelemetry@4.0.0-beta.94' ||
      entry === 'effect@4.0.0-beta.97' ||
      entry === '@effect/opentelemetry@4.0.0-beta.97' ||
      entry === 'effect@4.0.0-beta.102' ||
      entry === '@effect/opentelemetry@4.0.0-beta.102' ||
      entry === 'effect@4.0.0-beta.107' ||
      entry === '@effect/opentelemetry@4.0.0-beta.107'
    ) {
      continue;
    }
    throw new Error(
      `Unmatched trust-policy exclusion "${entry}" cannot be migrated safely.`,
    );
  }
}

function patchKey(patch: UltramodernPatchPolicy) {
  return `${patch.packageName}@${patch.version}`;
}

function reconcilePatchedDependencies(
  document: PnpmWorkspaceYaml,
  includeDrizzleOrmPatch: boolean,
) {
  const policy = ULTRAMODERN_WORKSPACE_POLICY.pnpm.patchedDependencies;
  const expectedPatches = [
    ...policy.required,
    ...(includeDrizzleOrmPatch ? policy.conditional : []),
  ];
  const expected = new Map(
    expectedPatches.map(patch => [patchKey(patch), patch.path]),
  );
  const stale = new Map(policy.stale.map(patch => [patchKey(patch), patch]));
  const ownedPackageNames = new Set(
    [...policy.required, ...policy.conditional, ...policy.stale].map(
      patch => patch.packageName,
    ),
  );
  const patchedDependencies = ensureMap(document, 'patchedDependencies');

  for (const [selector, patchPath] of Object.entries(patchedDependencies)) {
    const stalePatch = stale.get(selector);
    if (stalePatch) {
      if (patchPath !== stalePatch.path) {
        throw new Error(
          `Stale framework patch ${selector} uses an unrecognized path and cannot be removed safely.`,
        );
      }
      delete patchedDependencies[selector];
      continue;
    }

    const parts = packageVersionParts(selector);
    if (
      parts &&
      ownedPackageNames.has(parts.packageName) &&
      !expected.has(selector)
    ) {
      const conditionalPatch = policy.conditional.find(
        patch => patchKey(patch) === selector,
      );
      if (
        conditionalPatch &&
        !includeDrizzleOrmPatch &&
        patchPath === conditionalPatch.path
      ) {
        delete patchedDependencies[selector];
        continue;
      }
      throw new Error(
        `Framework-owned patch selector ${selector} has unknown provenance.`,
      );
    }
  }

  for (const [selector, patchPath] of expected) {
    patchedDependencies[selector] = patchPath;
  }
}

function reconcilePnpmPolicy(
  document: PnpmWorkspaceYaml,
  includeDrizzleOrmPatch: boolean,
  packageSource: ResolvedUltramodernPackageSource,
  releaseCohort: UltramodernReleaseCohort | undefined,
  now?: Date,
) {
  const policy = ULTRAMODERN_WORKSPACE_POLICY.pnpm;
  const minimumReleaseAgeExclude = renderMinimumReleaseAgeExclude({
    now,
    packageSource,
    releaseCohort,
  });
  const workspacePackageLinkingPolicy =
    resolveWorkspacePackageLinkingPolicy(packageSource);

  if (document.minimumReleaseAgeExclude !== undefined) {
    assertOwnedReleaseAgeList(
      document.minimumReleaseAgeExclude,
      minimumReleaseAgeExclude,
    );
  }
  if (document.trustPolicyExclude !== undefined) {
    assertOwnedTrustPolicyList(
      document.trustPolicyExclude,
      policy.trustPolicyExclude,
    );
  }

  for (const [key, value] of [
    ['minimumReleaseAge', policy.minimumReleaseAge],
    ['minimumReleaseAgeStrict', policy.minimumReleaseAgeStrict],
    [
      'minimumReleaseAgeIgnoreMissingTime',
      policy.minimumReleaseAgeIgnoreMissingTime,
    ],
    ['trustPolicy', policy.trustPolicy],
    ['trustPolicyIgnoreAfter', policy.trustPolicyIgnoreAfter],
    ['blockExoticSubdeps', policy.blockExoticSubdeps],
    ['engineStrict', policy.engineStrict],
    ['pmOnFail', policy.pmOnFail],
    ['verifyDepsBeforeRun', policy.verifyDepsBeforeRun],
    ['strictDepBuilds', policy.strictDepBuilds],
  ] as const) {
    setOwnedScalar(document, key, value);
  }
  for (const key of [
    'injectWorkspacePackages',
    'linkWorkspacePackages',
  ] as const) {
    const value = workspacePackageLinkingPolicy[key];
    if (value === undefined) {
      delete document[key];
    } else {
      setOwnedScalar(document, key, value);
    }
  }

  document.minimumReleaseAgeExclude = minimumReleaseAgeExclude;
  document.trustPolicyExclude = [...policy.trustPolicyExclude];

  const peerDependencyRules = ensureMap(document, 'peerDependencyRules');
  const allowedVersions = ensureMap(peerDependencyRules, 'allowedVersions');
  for (const selector of retiredTypescriptPeerOverrides) {
    delete allowedVersions[selector];
  }
  reconcileOwnedMap(
    allowedVersions,
    policy.peerDependencyRules.allowedVersions,
  );

  const overrides = ensureMap(document, 'overrides');
  const ownedOverrideNames = new Set(Object.keys(policy.overrides));
  for (const selector of Object.keys(overrides)) {
    const parts = packageVersionParts(selector);
    if (parts && ownedOverrideNames.has(parts.packageName)) {
      delete overrides[selector];
    }
  }
  reconcileOwnedMap(overrides, policy.overrides);
  const packageExtensions = document.packageExtensions;
  if (packageExtensions !== undefined) {
    if (!isYamlRecord(packageExtensions)) {
      throw new Error(
        'pnpm-workspace.yaml packageExtensions must be a mapping.',
      );
    }
    for (const selector of Object.keys(packageExtensions)) {
      if (
        packageVersionParts(selector)?.packageName ===
        '@module-federation/dts-plugin'
      ) {
        delete packageExtensions[selector];
      }
    }
    if (Object.keys(packageExtensions).length === 0) {
      delete document.packageExtensions;
    }
  }
  reconcileOwnedMap(ensureMap(document, 'allowBuilds'), policy.allowBuilds);
  reconcilePatchedDependencies(document, includeDrizzleOrmPatch);
}

function stalePatchFilesToRemove(
  workspaceRoot: string,
  document: PnpmWorkspaceYaml,
) {
  const staleFiles: string[] = [];
  const patchedDependencies = ensureMap(document, 'patchedDependencies');
  const lexicalWorkspaceRoot = path.resolve(workspaceRoot);
  const physicalWorkspaceRoot = fs.realpathSync.native(lexicalWorkspaceRoot);
  const isOutsideRoot = (root: string, candidate: string) => {
    const relativePath = path.relative(root, candidate);
    return (
      relativePath === '' ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    );
  };
  const resolvePhysicalPath = (absolutePath: string) => {
    const missingSegments: string[] = [];
    let existingAncestor = absolutePath;
    while (!fs.existsSync(existingAncestor)) {
      const parent = path.dirname(existingAncestor);
      if (parent === existingAncestor) {
        break;
      }
      missingSegments.unshift(path.basename(existingAncestor));
      existingAncestor = parent;
    }
    return path.resolve(
      fs.realpathSync.native(existingAncestor),
      ...missingSegments,
    );
  };
  const resolvePatchPath = (selector: string, patchPath: unknown) => {
    if (typeof patchPath !== 'string' || patchPath.length === 0) {
      throw new Error(
        `Patched dependency ${selector} must reference a non-empty path string.`,
      );
    }
    const absolutePath = path.resolve(
      lexicalWorkspaceRoot,
      patchPath.replaceAll('\\', '/'),
    );
    if (isOutsideRoot(lexicalWorkspaceRoot, absolutePath)) {
      throw new Error(
        `Patched dependency ${selector} references a path outside the workspace: ${patchPath}`,
      );
    }
    const physicalPath = resolvePhysicalPath(absolutePath);
    if (isOutsideRoot(physicalWorkspaceRoot, physicalPath)) {
      throw new Error(
        `Patched dependency ${selector} resolves outside the workspace: ${patchPath}`,
      );
    }
    return {
      absolutePath,
      identity:
        process.platform === 'win32'
          ? physicalPath.toLowerCase()
          : physicalPath,
    };
  };
  const resolvedPatchedDependencies = Object.entries(patchedDependencies).map(
    ([selector, patchPath]) => ({
      ...resolvePatchPath(selector, patchPath),
      selector,
    }),
  );
  const resolvedBySelector = new Map(
    resolvedPatchedDependencies.map(resolved => [resolved.selector, resolved]),
  );
  const activeFrameworkPatchIdentities = new Set(
    [
      ...ULTRAMODERN_WORKSPACE_POLICY.pnpm.patchedDependencies.required,
      ...ULTRAMODERN_WORKSPACE_POLICY.pnpm.patchedDependencies.conditional,
    ]
      .map(patch => ({
        actual: resolvedBySelector.get(patchKey(patch)),
        expected: resolvePatchPath(patchKey(patch), patch.path),
      }))
      .filter(({ actual, expected }) => actual?.identity === expected.identity)
      .map(({ expected }) => expected.identity),
  );

  const stalePatchesByIdentity = new Map<
    string,
    {
      acceptedDigests: Set<string>;
      absolutePath: string;
      policyPath: string;
    }
  >();
  for (const patch of ULTRAMODERN_WORKSPACE_POLICY.pnpm.patchedDependencies
    .stale) {
    const stalePath = resolvePatchPath(patchKey(patch), patch.path);
    const existing = stalePatchesByIdentity.get(stalePath.identity);
    const acceptedDigests = [
      patch.sha256,
      ...(patch.acceptedLegacySha256 ?? []),
    ];
    if (existing) {
      for (const digest of acceptedDigests) {
        existing.acceptedDigests.add(digest);
      }
      continue;
    }
    stalePatchesByIdentity.set(stalePath.identity, {
      acceptedDigests: new Set(acceptedDigests),
      absolutePath: stalePath.absolutePath,
      policyPath: patch.path,
    });
  }

  for (const [identity, stalePatch] of stalePatchesByIdentity) {
    if (activeFrameworkPatchIdentities.has(identity)) {
      continue;
    }
    const survivingSelectors = resolvedPatchedDependencies
      .filter(resolved => resolved.identity === identity)
      .map(resolved => resolved.selector);
    if (survivingSelectors.length > 0) {
      throw new Error(
        `Stale framework patch ${stalePatch.policyPath} is still referenced by consumer-owned selector(s): ${survivingSelectors.join(', ')}; refusing to mutate the workspace.`,
      );
    }
    const patchPath = stalePatch.absolutePath;
    if (!fs.existsSync(patchPath)) {
      continue;
    }
    const digest = crypto
      .createHash('sha256')
      .update(fs.readFileSync(patchPath))
      .digest('hex');
    if (!stalePatch.acceptedDigests.has(digest)) {
      throw new Error(
        `Stale framework patch ${stalePatch.policyPath} was modified (expected a reviewed sha256, found ${digest}); refusing to delete it.`,
      );
    }
    staleFiles.push(patchPath);
  }
  return staleFiles;
}

export function updateGeneratedPnpmWorkspacePolicy(
  io: MigrationIo,
  packageSource: ResolvedUltramodernPackageSource,
  options: { now?: Date; releaseCohort?: UltramodernReleaseCohort } = {},
) {
  const workspaceFile = path.join(io.workspaceRoot, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspaceFile)) {
    return false;
  }

  const source = fs.readFileSync(workspaceFile, 'utf-8');
  const { document, lineEnding } = parsePnpmWorkspaceYaml(
    source,
    workspaceFile,
  );
  const before = JSON.stringify(document);
  const drizzleOrmPatch =
    ULTRAMODERN_WORKSPACE_POLICY.pnpm.patchedDependencies.conditional.find(
      patch => patch.packageName === 'drizzle-orm',
    );
  reconcilePnpmPolicy(
    document,
    drizzleOrmPatch !== undefined &&
      workspaceUsesDependency(
        io.workspaceRoot,
        drizzleOrmPatch.packageName,
        drizzleOrmPatch.version,
      ),
    packageSource,
    options.releaseCohort,
    options.now,
  );
  const stalePatchFiles = stalePatchFilesToRemove(io.workspaceRoot, document);

  let changed = false;
  if (JSON.stringify(document) !== before) {
    changed =
      io.write(
        workspaceFile,
        stringifyPnpmWorkspaceYaml(document, lineEnding),
      ) || changed;
  }
  for (const stalePatchFile of stalePatchFiles) {
    changed = io.remove(stalePatchFile) || changed;
  }
  return changed;
}

function packageRegistryUrl(registryUrl: string, packageName: string) {
  let base: URL;
  try {
    base = new URL(registryUrl);
  } catch {
    throw new Error(`Registry URL is invalid: ${registryUrl}`);
  }
  if (base.protocol !== 'https:') {
    throw new Error(`Registry URL must use HTTPS: ${registryUrl}`);
  }
  const encodedName = packageName.startsWith('@')
    ? packageName.replace('/', '%2f')
    : encodeURIComponent(packageName);
  return new URL(encodedName, base);
}

function packageVersionKey(packageName: string, version: string) {
  return `${packageName}@${version}`;
}

function isRegistryRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const registryFetchConcurrency = 16;
const registryFetchAttempts = 3;
const registryFetchRetryDelayMs = 250;

function isTransientRegistryStatus(status: number) {
  return status === 429 || status >= 500;
}

async function fetchRegistryResponse(
  fetchImpl: ReleaseAgeRegistryFetch,
  url: URL,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < registryFetchAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        redirect: 'error',
      });
      if (
        response.ok ||
        !isTransientRegistryStatus(response.status) ||
        attempt === registryFetchAttempts - 1
      ) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === registryFetchAttempts - 1) {
        throw error;
      }
    }
    await new Promise(resolve =>
      setTimeout(resolve, registryFetchRetryDelayMs * 2 ** attempt),
    );
  }
  throw lastError;
}

async function resolveRegistryCandidates(
  candidates: ReturnType<
    typeof discoverReachablePnpmLockReleaseAgeClosure
  >['candidates'],
  options: {
    fetchImpl: ReleaseAgeRegistryFetch;
    now: Date;
    registryUrl: string;
  },
) {
  const nowTimestamp = options.now.getTime();
  if (!Number.isFinite(nowTimestamp)) {
    throw new Error('Release-age validation requires a valid current time.');
  }

  async function resolveCandidate(candidate: (typeof candidates)[number]) {
    const key = packageVersionKey(candidate.packageName, candidate.version);
    let response: RegistryResponse;
    try {
      response = await fetchRegistryResponse(
        options.fetchImpl,
        packageRegistryUrl(options.registryUrl, candidate.packageName),
      );
    } catch (error) {
      throw new Error(
        `Registry metadata is uncertain for ${key} (${candidate.path.join(
          ' -> ',
        )}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `Registry metadata is uncertain for ${key} (${candidate.path.join(
          ' -> ',
        )}): HTTP ${response.status}`,
      );
    }

    let packument: unknown;
    try {
      packument = await response.json();
    } catch (error) {
      throw new Error(
        `Registry metadata is invalid JSON for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!isRegistryRecord(packument)) {
      throw new Error(`Registry metadata is invalid for ${key}.`);
    }
    const versions = packument.versions;
    const time = packument.time;
    const versionMetadata = isRegistryRecord(versions)
      ? versions[candidate.version]
      : undefined;
    const dist = isRegistryRecord(versionMetadata)
      ? versionMetadata.dist
      : undefined;
    const integrity = isRegistryRecord(dist) ? dist.integrity : undefined;
    if (integrity !== candidate.registry.dist.integrity) {
      throw new Error(
        `Registry metadata integrity mismatch for ${key}: lock has ${candidate.registry.dist.integrity}, registry has ${String(
          integrity,
        )}`,
      );
    }
    const publishedAt = isRegistryRecord(time)
      ? time[candidate.version]
      : undefined;
    const publishedAtTimestamp =
      typeof publishedAt === 'string' ? Date.parse(publishedAt) : Number.NaN;
    if (
      typeof publishedAt !== 'string' ||
      !Number.isFinite(publishedAtTimestamp) ||
      publishedAtTimestamp > nowTimestamp
    ) {
      throw new Error(
        `Registry publication time is missing, invalid, or in the future for ${key}.`,
      );
    }
    return {
      ...candidate,
      registry: {
        ...candidate.registry,
        publishedAt: new Date(publishedAtTimestamp).toISOString(),
      },
    };
  }

  const results = new Array<Awaited<ReturnType<typeof resolveCandidate>>>(
    candidates.length,
  );
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < candidates.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await resolveCandidate(candidates[index]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(registryFetchConcurrency, candidates.length) },
      () => worker(),
    ),
  );
  return results;
}

export async function validateGeneratedPnpmLockReleaseAgePolicy(
  workspaceRoot: string,
  packageSource: ResolvedUltramodernPackageSource,
  options: {
    fetchImpl?: ReleaseAgeRegistryFetch;
    now?: Date;
    registryUrl?: string;
    releaseCohort?: UltramodernReleaseCohort;
  } = {},
) {
  const lockfilePath = path.join(workspaceRoot, 'pnpm-lock.yaml');
  if (!fs.existsSync(lockfilePath)) {
    throw new Error(
      'Cannot validate release-age approvals without pnpm-lock.yaml.',
    );
  }

  const now = options.now ?? new Date();
  const releaseCohort =
    options.releaseCohort ??
    (packageSource.strategy === 'install'
      ? readWorkspaceReleaseCohort(workspaceRoot)
      : undefined);
  const activeSelectors = renderMinimumReleaseAgeExclude({
    now,
    packageSource,
    releaseCohort,
  });
  const workspacePolicyPath = path.join(workspaceRoot, 'pnpm-workspace.yaml');
  const { document: workspacePolicy } = parsePnpmWorkspaceYaml(
    fs.readFileSync(workspacePolicyPath, 'utf-8'),
    workspacePolicyPath,
  );
  const renderedSelectors = assertUniqueStringList(
    workspacePolicy.minimumReleaseAgeExclude,
    'minimumReleaseAgeExclude',
  );
  if (JSON.stringify(renderedSelectors) !== JSON.stringify(activeSelectors)) {
    throw new Error(
      'pnpm-workspace.yaml release-age exclusions do not match canonical policy.',
    );
  }

  const firstPartySelectors = new Set(
    releaseCohort ? releaseCohortSelectors(releaseCohort) : [],
  );
  const firstPartyTargetNames = new Set(
    releaseCohort?.packages.map(item => item.targetName) ?? [],
  );
  const { document: lockfile } = parsePnpmWorkspaceYaml(
    fs.readFileSync(lockfilePath, 'utf-8'),
    lockfilePath,
  );
  const closure = discoverReachablePnpmLockReleaseAgeClosure(lockfile);
  if (closure.unresolved.length > 0) {
    const unresolved = closure.unresolved
      .slice(0, 20)
      .map(candidate => {
        const packageName = candidate.package ?? 'unknown package';
        return `- ${packageName}: ${candidate.reason}; path ${candidate.path.join(
          ' -> ',
        )}`;
      })
      .join('\n');
    throw new Error(
      `Dependency closure has unresolved candidates:\n${unresolved}`,
    );
  }

  const closureKeys = new Set(
    closure.candidates.map(candidate =>
      packageVersionKey(candidate.packageName, candidate.version),
    ),
  );
  const approvals =
    ULTRAMODERN_WORKSPACE_POLICY.pnpm.releaseAge.approvals.filter(approval =>
      closureKeys.has(`${approval.packageName}@${approval.version}`),
    );
  const isFirstPartyCandidate = (packageName: string, version: string) => {
    if (!firstPartyTargetNames.has(packageName)) {
      return false;
    }
    const key = `${packageName}@${version}`;
    if (!firstPartySelectors.has(key)) {
      throw new Error(
        `First-party lock candidate ${key} is absent from the authenticated release cohort.`,
      );
    }
    return true;
  };
  const thirdPartyCandidates = closure.candidates.filter(
    candidate =>
      !isFirstPartyCandidate(candidate.packageName, candidate.version),
  );
  const activeCandidates = await resolveRegistryCandidates(
    thirdPartyCandidates,
    {
      fetchImpl: options.fetchImpl ?? (fetch as ReleaseAgeRegistryFetch),
      now,
      registryUrl:
        options.registryUrl ??
        packageSource.registry ??
        'https://registry.npmjs.org/',
    },
  );
  const resolved = resolveReleaseAgeApprovals(activeCandidates, {
    approvals,
    now,
  });
  if (resolved.reviewCandidates.length > 0) {
    const pathsByKey = new Map(
      thirdPartyCandidates.map(candidate => [
        packageVersionKey(candidate.packageName, candidate.version),
        candidate.path,
      ]),
    );
    throw new Error(
      [
        `Dependency closure contains ${resolved.reviewCandidates.length} immature package(s) without an exact, unexpired approval:`,
        ...resolved.reviewCandidates.slice(0, 20).map(candidate => {
          const key = packageVersionKey(
            candidate.packageName,
            candidate.version,
          );
          return `- ${key}; path ${pathsByKey.get(key)?.join(' -> ') ?? 'unknown'}`;
        }),
      ].join('\n'),
    );
  }
  return {
    ...resolved,
    minimumReleaseAgeExclude: activeSelectors,
  };
}
