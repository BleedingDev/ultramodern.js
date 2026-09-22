import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { shellApp } from '../descriptors';
import {
  packageName as packageNameFor,
  toCamelCase,
  toEnvSegment,
  toKebabCase,
} from '../naming';
import { WORKSPACE_SCRIPT_SEGMENT_PATTERN } from '../workspace-script-plan';
import { assertCompilerArchitecture } from './architecture';
import {
  assert,
  assertArray,
  assertIncludesJson,
  assertObject,
  assertSameIdCohort,
  assertSameJson,
  assertSelfCheck,
  assertUniqueIdEntries,
  assertUniqueStrings,
  formatJson,
  sameJson,
} from './assertions';
import type {
  JsonRecord,
  Semver,
  ValidationContract,
  Vertical,
  WorkspaceValidationContract,
} from './types';

/** Validate observed workspace artifacts against the installed package's expectations. */
export function validateWorkspace(
  root: string,
  expected: WorkspaceValidationContract,
): void {
  const workspaceValidationContract = expected as ValidationContract;
  const packageScope = workspaceValidationContract.packageScope;
  const expectedNodeVersion = workspaceValidationContract.versions.node;
  const expectedCrossEnvVersion = workspaceValidationContract.versions.crossEnv;
  const expectedEffectVersion = workspaceValidationContract.versions.effect;
  const expectedEffectVitestVersion =
    workspaceValidationContract.versions.effectVitest;
  const expectedModuleFederationVersion =
    workspaceValidationContract.versions.moduleFederation;
  const expectedTanstackHistoryVersion =
    workspaceValidationContract.versions.tanstackHistory;
  const tailwindEnabled = workspaceValidationContract.tailwindEnabled;
  const fullStackVerticals = workspaceValidationContract.fullStackVerticals;
  // Backend-federation and Zerops runtime surfaces only exist when the workspace
  // exposes API-bearing verticals. Shell-only workspaces skip their
  // materialization during migrate, so the contract must not require them.
  const hasBackendSurfaces = fullStackVerticals.some(
    vertical => vertical.emitsApi,
  );
  // Every vertical (ui-only and horizontal-remote included) is a delivery unit
  // and deploys via Zerops; only the BACKEND proof/generation surfaces depend on
  // an API-bearing unit existing (split gating).
  const hasDeliveryUnits = fullStackVerticals.length > 0;
  const shellNamespace = workspaceValidationContract.shellNamespace;
  const oldRemotePaths = workspaceValidationContract.oldRemotePaths;
  const expectedBuildScript = workspaceValidationContract.scripts.build;
  const expectedCloudflareBuildScript =
    workspaceValidationContract.scripts.cloudflareBuild;
  const expectedCloudflareDeployScript =
    workspaceValidationContract.scripts.cloudflareDeploy;
  const publicSurfaceManagedSourceAssetPaths =
    workspaceValidationContract.publicSurfaceManagedSourceAssetPaths;
  const compactConfigPath =
    workspaceValidationContract.metadata.compactConfig.path;
  const retiredMetadataPaths =
    workspaceValidationContract.legacy.retiredMetadataPaths;
  const modernPackageCohort = workspaceValidationContract.cohort.modernPackages;
  const expectedAdditionalShellIds =
    workspaceValidationContract.cohort.additionalShellIds ?? [];
  const expectedAdditionalShells =
    workspaceValidationContract.additionalShells ?? [];
  const expectedPrimaryShellVerticalIds: string[] =
    workspaceValidationContract.topology?.referenceTopology?.shell
      ?.verticalRefs ?? workspaceValidationContract.cohort.verticalIds;
  const expectedReleaseCohort =
    workspaceValidationContract.cohort.releaseCohort;

  const readText = (relativePath: string) =>
    fs.readFileSync(path.join(root, relativePath), 'utf-8');
  const readJson = (relativePath: string): JsonRecord =>
    JSON.parse(readText(relativePath));
  const expectedModernPackageSpecifier = (packageName: string) => {
    if (packageSource.strategy === 'workspace') {
      return 'workspace:*';
    }
    const aliases = packageSource.modernPackages?.aliases ?? {};
    const alias = aliases[packageName];
    const specifier = packageSource.modernPackages?.specifier;
    return typeof alias === 'string' ? `npm:${alias}@${specifier}` : specifier;
  };

  const assertPortableGeneratedEnvironmentScripts = (
    packageJson: JsonRecord,
    label: string,
  ) => {
    const build = packageJson.scripts?.build ?? '';
    const cloudflareBuild = packageJson.scripts?.['cloudflare:build'] ?? '';
    assert(
      build.includes(
        'cross-env MODERNJS_DEPLOY=node modern deploy --skip-build',
      ),
      `${label} build must use cross-env for its Node deploy`,
    );
    assert(
      cloudflareBuild.includes(
        'cross-env MODERNJS_DEPLOY=cloudflare modern build',
      ),
      `${label} cloudflare:build must use cross-env for Modern build`,
    );
    assert(
      cloudflareBuild.includes(
        'cross-env MODERNJS_DEPLOY=cloudflare modern deploy --skip-build',
      ),
      `${label} cloudflare:build must use cross-env for Modern deploy`,
    );
    assert(
      !/(?:^|\s+&&\s+)MODERNJS_DEPLOY=/u.test(build),
      `${label} build must not use a POSIX-only environment prefix`,
    );
    assert(
      !/(?:^|\s+&&\s+)MODERNJS_DEPLOY=/u.test(cloudflareBuild),
      `${label} cloudflare:build must not use a POSIX-only environment prefix`,
    );
  };
  const assertExists = (relativePath: string) => {
    assert(
      fs.existsSync(path.join(root, relativePath)),
      `Missing ${relativePath}`,
    );
  };
  const assertNotExists = (relativePath: string) => {
    assert(
      !fs.existsSync(path.join(root, relativePath)),
      `Unexpected ${relativePath}`,
    );
  };
  const assertAnyOf = (relativePaths: string[]) => {
    assert(
      relativePaths.some(relativePath =>
        fs.existsSync(path.join(root, relativePath)),
      ),
      `Missing one of: ${relativePaths.join(', ')}`,
    );
  };
  const assertWorkspaceValidationContract = (
    contract: WorkspaceValidationContract,
  ) => {
    assert(
      contract !== null &&
        typeof contract === 'object' &&
        !Array.isArray(contract),
      'Workspace validation contract must be a JSON object',
    );
    assert(
      contract.schemaVersion === 2,
      `Unsupported workspace validation contract schemaVersion ${formatJson(contract.schemaVersion)}; expected 2`,
    );
    assert(
      contract.kind === 'modernjs.ultramodern-workspace-validation-contract',
      `Unsupported workspace validation contract kind ${formatJson(contract.kind)}`,
    );

    const metadataEntries = Object.entries(contract.metadata ?? {});
    assert(
      metadataEntries.length === (contract.cohort?.releaseCohort ? 5 : 4),
      'Workspace validation contract must declare every structured metadata input',
    );
    for (const [name, metadata] of metadataEntries) {
      assert(
        typeof metadata?.path === 'string' && metadata.path.length > 0,
        `Workspace validation contract metadata.${name}.path is required`,
      );
      assert(
        metadata.schemaVersion === 1,
        `Unsupported expected metadata schemaVersion ${formatJson(metadata.schemaVersion)} for ${name}`,
      );
    }

    assertUniqueStrings(
      contract.cohort?.modernPackages,
      'workspace validation contract Modern package cohort',
    );
    assertUniqueStrings(
      contract.cohort?.appIds,
      'workspace validation contract app cohort',
    );
    assertUniqueStrings(
      contract.cohort?.additionalShellIds ?? [],
      'workspace validation contract additional-shell cohort',
    );
    for (const [field, label] of [
      [
        'additionalShellOwnerIds',
        'workspace validation contract additional-shell owner cohort',
      ],
      [
        'additionalShellDeliveryUnitIds',
        'workspace validation contract additional-shell delivery-unit cohort',
      ],
      [
        'additionalShellDegradedStateIds',
        'workspace validation contract additional-shell degraded-state cohort',
      ],
      [
        'additionalShellBuildMarkerIds',
        'workspace validation contract additional-shell build-marker cohort',
      ],
    ] as const) {
      assertUniqueStrings(contract.cohort?.[field] ?? [], label);
    }
    assertUniqueStrings(
      contract.cohort?.backendAppIds,
      'workspace validation contract backend app cohort',
    );
    assertUniqueStrings(
      contract.cohort?.verticalIds,
      'workspace validation contract vertical cohort',
    );
    assertUniqueStrings(
      contract.cohort?.sharedPackageIds,
      'workspace validation contract shared package cohort',
    );
    assertUniqueStrings(
      contract.cohort?.ownerIds,
      'workspace validation contract owner cohort',
    );
    assertUniqueIdEntries(
      contract.cohort?.packageManifests,
      'workspace validation contract package manifests',
    );
    assertUniqueStrings(
      (contract.cohort?.packageManifests ?? []).map(manifest => manifest.path),
      'workspace validation contract package manifest paths',
    );

    const evidencePolicy = contract.validationEvidencePolicy;
    assert(
      evidencePolicy?.schemaVersion === 1,
      `Unsupported validation evidence policy schemaVersion ${formatJson(evidencePolicy?.schemaVersion)}; expected 1`,
    );
    assertUniqueIdEntries(
      evidencePolicy?.required,
      'workspace validation contract evidence requirements',
    );
    const requiredEvidence = new Map([
      ['typescript-compiler', 'compiler'],
      ['architecture-compiler', 'compiler'],
      ['executable-modern-config', 'runtime'],
      ['executable-runtime-config', 'runtime'],
      ['executable-module-federation-config', 'runtime'],
      ['executable-build-facade', 'runtime'],
      ['structured-package-config', 'structured'],
      ['structured-deploy-config', 'structured'],
      ['public-behavior-gates', 'behavior'],
    ]);
    assertSameJson(
      evidencePolicy.required,
      [...requiredEvidence].map(([id, kind]) => ({ id, kind })),
      'workspace validation contract evidence requirements',
      'restore the complete compiler, runtime, structured-data, and behavior evidence set',
    );
    for (const evidence of evidencePolicy.required) {
      assert(
        requiredEvidence.get(evidence.id) === evidence.kind,
        `Unsupported validation evidence ${formatJson(evidence)}`,
      );
    }
  };
  const assertAdditionalShellContractShape = () => {
    if (
      (workspaceValidationContract.cohort?.additionalShellIds ?? []).length > 0
    ) {
      for (const field of [
        'additionalShellOwnerIds',
        'additionalShellDeliveryUnitIds',
        'additionalShellDegradedStateIds',
        'additionalShellBuildMarkerIds',
      ] as const) {
        assertSameJson(
          workspaceValidationContract.cohort?.[field],
          workspaceValidationContract.cohort.additionalShellIds,
          `workspace validation contract ${field}`,
          'restore every generated additional-shell cohort',
        );
      }
      assertSameIdCohort(
        workspaceValidationContract.cohort?.additionalShellManifests,
        workspaceValidationContract.cohort.additionalShellIds,
        'workspace validation contract additional-shell manifests',
        'restore every generated additional-shell package manifest',
      );
      assertSameIdCohort(
        workspaceValidationContract.additionalShells,
        workspaceValidationContract.cohort.additionalShellIds,
        'workspace validation contract additional-shell records',
        'restore every generated additional-shell contract record',
      );
    } else {
      assert(
        workspaceValidationContract.cohort?.additionalShellManifests ===
          undefined,
        'Single-shell workspace must not declare additional-shell manifests',
      );
      assert(
        workspaceValidationContract.additionalShells === undefined,
        'Single-shell workspace must not declare additional-shell records',
      );
      for (const field of [
        'additionalShellOwnerIds',
        'additionalShellDeliveryUnitIds',
        'additionalShellDegradedStateIds',
        'additionalShellBuildMarkerIds',
      ] as const) {
        assert(
          workspaceValidationContract.cohort?.[field] === undefined,
          `Single-shell workspace must not declare ${field}`,
        );
      }
    }
  };
  const assertStructuredWorkspaceMetadata = ({
    ultramodernConfig,
    topology,
    ownership,
    overlay,
  }: Record<string, JsonRecord>) => {
    const observedMetadata = [
      {
        contract: workspaceValidationContract.metadata.compactConfig,
        value: ultramodernConfig,
      },
      {
        contract: workspaceValidationContract.metadata.referenceTopology,
        value: topology,
      },
      {
        contract: workspaceValidationContract.metadata.ownership,
        value: ownership,
      },
      {
        contract: workspaceValidationContract.metadata.developmentOverlay,
        value: overlay,
      },
    ];

    for (const entry of observedMetadata) {
      assert(
        entry.value !== null &&
          typeof entry.value === 'object' &&
          !Array.isArray(entry.value),
        `${entry.contract.path} must contain a JSON object`,
      );
      assert(
        Number.isInteger(entry.value.schemaVersion),
        `${entry.contract.path} must declare an integer schemaVersion`,
      );
    }

    const observedSchemaVersions = new Set(
      observedMetadata.map((entry: JsonRecord) => entry.value.schemaVersion),
    );
    assert(
      observedSchemaVersions.size === 1,
      `Mixed workspace metadata schema versions: ${observedMetadata
        .map(
          (entry: JsonRecord) =>
            `${entry.contract.path}=${entry.value.schemaVersion}`,
        )
        .join(', ')}`,
    );
    for (const entry of observedMetadata) {
      assert(
        entry.value.schemaVersion === entry.contract.schemaVersion,
        `Unsupported workspace metadata schemaVersion ${entry.value.schemaVersion} at ${entry.contract.path}; expected ${entry.contract.schemaVersion}`,
      );
    }

    assertObject(
      ultramodernConfig.packageSource,
      `${compactConfigPath} packageSource`,
      'restore generated compact package-source metadata',
    );
    for (const field of workspaceValidationContract.legacy
      .forbiddenCompactConfigFields) {
      assert(
        !Object.hasOwn(ultramodernConfig, field),
        `Stale legacy field ${compactConfigPath}.${field} is forbidden`,
      );
    }
    for (const field of workspaceValidationContract.legacy
      .forbiddenPackageSourceFields) {
      assert(
        !Object.hasOwn(ultramodernConfig.packageSource, field),
        `Stale legacy field ${compactConfigPath}.packageSource.${field} is forbidden`,
      );
    }
    for (const field of workspaceValidationContract.legacy
      .forbiddenTopologyFields) {
      assert(
        !Object.hasOwn(topology, field),
        `Stale legacy field ${workspaceValidationContract.metadata.referenceTopology.path}.${field} is forbidden`,
      );
    }

    assertSameIdCohort(
      ultramodernConfig.topology?.apps,
      workspaceValidationContract.cohort.appIds,
      `${compactConfigPath} topology.apps`,
      'restore the complete generated app cohort',
    );
    assertSameIdCohort(
      ultramodernConfig.moduleFederation?.apps,
      workspaceValidationContract.cohort.appIds,
      `${compactConfigPath} moduleFederation.apps`,
      'restore the complete generated Module Federation app cohort',
    );
    assertSameIdCohort(
      ultramodernConfig.backendFederation?.apps,
      workspaceValidationContract.cohort.backendAppIds,
      `${compactConfigPath} backendFederation.apps`,
      'restore the complete generated backend app cohort',
    );
    assertSameIdCohort(
      topology.verticals,
      workspaceValidationContract.cohort.verticalIds,
      `${workspaceValidationContract.metadata.referenceTopology.path} verticals`,
      'restore the complete generated vertical cohort',
    );
    assertUniqueIdEntries(topology.sharedPackages, 'topology.sharedPackages');
    assertIncludesJson(
      topology.sharedPackages.map((entry: JsonRecord) => entry.id),
      workspaceValidationContract.cohort.sharedPackageIds,
      'topology.sharedPackages',
      'restore required framework ownership entries',
    );
    assertSameIdCohort(
      topology.shell?.moduleFederation?.remotes,
      workspaceValidationContract.topology.referenceTopology.shell.moduleFederation.remotes.map(
        (remote: JsonRecord) => remote.id,
      ),
      `${workspaceValidationContract.metadata.referenceTopology.path} shell.moduleFederation.remotes`,
      'restore the complete generated shell remote cohort',
    );
    assertUniqueIdEntries(ownership.owners, 'ownership.owners');
    assertIncludesJson(
      ownership.owners.map((entry: JsonRecord) => entry.id),
      workspaceValidationContract.cohort.ownerIds,
      'ownership.owners',
      'restore required framework ownership entries',
    );

    for (const entry of [...topology.sharedPackages, ...ownership.owners]) {
      assert(
        typeof entry.path === 'string' && entry.path.length > 0,
        `${entry.id} must declare a package path`,
      );
      assert(
        readJson(`${entry.path}/package.json`).name === entry.package,
        `${entry.id} ownership package must match ${entry.path}/package.json`,
      );
    }

    for (const manifest of workspaceValidationContract.cohort
      .packageManifests) {
      assertExists(manifest.path);
      const packageJson = readJson(manifest.path);
      assert(
        packageJson.name === manifest.packageName,
        `${manifest.path} package name must be ${manifest.packageName}`,
      );
      if (manifest.role === 'shell' || manifest.role === 'vertical') {
        assert(
          packageJson.modernjs?.appId === manifest.id,
          `${manifest.path} modernjs.appId must be ${manifest.id}`,
        );
      }
    }
    if (expectedReleaseCohort) {
      const releaseCohortContract =
        workspaceValidationContract.metadata.releaseCohort;
      assertSelfCheck(
        releaseCohortContract?.path === '.modernjs/release-cohort.json',
        'authenticated release cohort projection',
        'Expected release-cohort metadata path is missing or invalid',
        '.modernjs/release-cohort.json',
      );
      assertSameJson(
        readJson(releaseCohortContract.path),
        expectedReleaseCohort,
        'authenticated release cohort projection',
        releaseCohortContract.path,
      );
    }
  };
  const findById = (entries: JsonRecord[], id: string) =>
    Array.isArray(entries)
      ? entries.find((entry: JsonRecord) => entry?.id === id)
      : undefined;
  const generatedContractLabel = compactConfigPath;
  const deliveryUnitIdentityFixArea =
    'regenerate vertical identity from delivery-unit record; do not hand-edit surface markers';
  const deliveryUnitBlock = (record: JsonRecord | undefined) => ({
    schemaVersion: record?.schemaVersion,
    kind: record?.kind,
    unitId: record?.unitId,
    packageName: record?.packageName,
    version: record?.version,
    buildMarker: record?.buildMarker,
    sourceRevision: record?.sourceRevision,
  });
  const expectedCompactAppFor = (id: string) =>
    workspaceValidationContract.topology.compactConfig?.apps?.find(
      (entry: JsonRecord) => entry?.id === id,
    );
  const expectedDeliveryUnitFor = (vertical: Vertical) => {
    const expectedApp = expectedCompactAppFor(vertical.id);
    return (
      expectedApp?.backendFederation?.deliveryUnit ??
      expectedApp?.deliveryUnit ??
      vertical.deliveryUnit
    );
  };
  const createModernPackageAliases = (packageSourceConfig: JsonRecord) => {
    if (typeof packageSourceConfig?.aliasScope !== 'string') {
      return undefined;
    }
    const scope = packageSourceConfig.aliasScope.replace(/^@/u, '');
    const prefix =
      typeof packageSourceConfig.aliasPackageNamePrefix === 'string'
        ? packageSourceConfig.aliasPackageNamePrefix
        : '';
    return Object.fromEntries(
      modernPackageCohort.map(packageName => [
        packageName,
        `@${scope}/${prefix}${packageName.split('/').at(-1)}`,
      ]),
    );
  };
  const createPackageSourceView = (config: JsonRecord) => {
    const source = config.packageSource;
    assert(
      source !== null && typeof source === 'object' && !Array.isArray(source),
      `${compactConfigPath} packageSource must be a JSON object`,
    );
    assert(
      source.strategy === 'workspace' || source.strategy === 'install',
      `${compactConfigPath} packageSource.strategy must be workspace or install`,
    );
    if (source.strategy === 'install') {
      assert(
        typeof source.modernPackageVersion === 'string' &&
          source.modernPackageVersion.length > 0,
        `${compactConfigPath} install package source must declare modernPackageVersion`,
      );
    }
    const strategy = source.strategy;
    const specifier =
      strategy === 'install' ? source.modernPackageVersion : 'workspace:*';
    const aliases = createModernPackageAliases(source);
    return {
      schemaVersion: 1,
      strategy,
      modernPackages: {
        packages: modernPackageCohort,
        specifier,
        ...(typeof source.registry === 'string'
          ? { registry: source.registry }
          : {}),
        ...(aliases ? { aliases } : {}),
      },
      generatedWorkspacePackages: {
        packages: [
          packageNameFor(packageScope, 'shared-contracts'),
          packageNameFor(packageScope, 'shared-design-tokens'),
        ],
        specifier: 'workspace:*',
      },
    };
  };
  const expectedManifestUrl = (vertical: Vertical) =>
    `http://localhost:${vertical.port}/mf-manifest.json`;
  const expectedApiUrl = (vertical: Vertical) =>
    `http://localhost:${vertical.port}${vertical.apiPrefix}${
      vertical.apiProtocol === 'rpc' ? '/rpc' : ''
    }`;
  const expectedBackendFederationName = (vertical: Vertical) =>
    `${vertical.mfName}Backend`;
  const expectedBackendManifestUrl = (vertical: Vertical) =>
    `http://localhost:${vertical.port}/backend-mf-manifest.json`;
  const expectedBackendContainerEntry = (vertical: Vertical) =>
    `http://localhost:${vertical.port}/backendRemoteEntry.cjs`;
  const expectedBackendManifestEnv = (vertical: Vertical) =>
    `VERTICAL_${toEnvSegment(vertical.domain ?? vertical.id)}_BACKEND_MF_MANIFEST`;
  const expectedPublicUrlEnv = (vertical: Vertical) =>
    `ULTRAMODERN_PUBLIC_URL_${toEnvSegment(vertical.id)}`;
  const expectedCloudflareWorkerName = (vertical: Vertical) =>
    toKebabCase(`${packageScope}-${vertical.id}`).slice(0, 63);
  const backendFederationSubset = (
    backendFederation: JsonRecord | undefined,
  ) => ({
    role: backendFederation?.role,
    name: backendFederation?.name,
    runtimeFramework: backendFederation?.runtimeFramework,
    strictEffectApproach: backendFederation?.strictEffectApproach,
    exposeRuntime: backendFederation?.exposes?.['./effect-api']?.runtime,
    exposeReadiness: backendFederation?.exposes?.['./effect-api']?.readiness,
    versionBoundary: {
      invariant: backendFederation?.versionBoundary?.invariant,
      hasUi: Object.hasOwn(backendFederation?.versionBoundary ?? {}, 'ui'),
      uiManifestUrl: backendFederation?.versionBoundary?.ui?.manifestUrl,
      apiReadiness: backendFederation?.versionBoundary?.api?.readiness,
    },
    cloudflare: {
      kind: backendFederation?.executionSurfaces?.cloudflare?.kind,
      hasApi: Object.hasOwn(
        backendFederation?.executionSurfaces?.cloudflare ?? {},
        'api',
      ),
      hasSsr: Object.hasOwn(
        backendFederation?.executionSurfaces?.cloudflare ?? {},
        'ssr',
      ),
      workerName: backendFederation?.executionSurfaces?.cloudflare?.workerName,
      publicUrlEnv:
        backendFederation?.executionSurfaces?.cloudflare?.publicUrlEnv,
      zephyrRuntime:
        backendFederation?.executionSurfaces?.cloudflare?.zephyr?.runtime,
    },
    node: {
      kind: backendFederation?.executionSurfaces?.node?.kind,
      remoteName: backendFederation?.executionSurfaces?.node?.remoteName,
      manifestEnv: backendFederation?.executionSurfaces?.node?.manifestEnv,
      manifestUrl: backendFederation?.executionSurfaces?.node?.manifestUrl,
      containerEntry:
        backendFederation?.executionSurfaces?.node?.containerEntry,
      remoteType: backendFederation?.executionSurfaces?.node?.remoteType,
      expose: backendFederation?.executionSurfaces?.node?.expose,
    },
    compatibility: {
      contractVersion: backendFederation?.compatibility?.contractVersion,
    },
    topLevelManifestUrl: backendFederation?.manifestUrl,
    topLevelContainerEntry: backendFederation?.containerEntry,
  });
  const expectedBackendFederationSubset = (vertical: Vertical) => ({
    role: 'microvertical-server',
    name: expectedBackendFederationName(vertical),
    runtimeFramework: 'effect',
    strictEffectApproach: true,
    exposeRuntime: `${vertical.path}/api/index.ts`,
    // The RPC surface exposes no REST readiness endpoint, so its backend
    // federation contract omits the readiness probes (G7a).
    exposeReadiness:
      vertical.apiProtocol === 'rpc'
        ? undefined
        : `${vertical.apiPrefix}/${vertical.stem}/readiness`,
    versionBoundary: {
      invariant: 'web-and-api-same-build',
      hasUi: vertical.emitsUi,
      uiManifestUrl: vertical.emitsUi
        ? expectedManifestUrl(vertical)
        : undefined,
      apiReadiness:
        vertical.apiProtocol === 'rpc'
          ? undefined
          : `${vertical.apiPrefix}/${vertical.stem}/readiness`,
    },
    cloudflare: {
      kind: 'cloudflare-worker-snapshot',
      hasApi: !vertical.emitsUi,
      hasSsr: vertical.emitsUi,
      workerName: expectedCloudflareWorkerName(vertical),
      publicUrlEnv: expectedPublicUrlEnv(vertical),
      zephyrRuntime: vertical.emitsUi ? 'ssr-worker' : 'api-worker',
    },
    node: {
      kind: 'node-mf-runtime',
      remoteName: expectedBackendFederationName(vertical),
      manifestEnv: expectedBackendManifestEnv(vertical),
      manifestUrl: expectedBackendManifestUrl(vertical),
      containerEntry: expectedBackendContainerEntry(vertical),
      remoteType: 'commonjs-module',
      expose: './effect-api',
    },
    compatibility: {
      contractVersion: 'microvertical-server-effect-v1',
    },
    topLevelManifestUrl: undefined,
    topLevelContainerEntry: undefined,
  });
  const serverExecutionSubset = (serverExecution: JsonRecord | undefined) => ({
    apiBaseUrl: serverExecution?.apiBaseUrl,
    versionBoundary: serverExecution?.versionBoundary,
    cloudflareKind: serverExecution?.cloudflare?.kind,
    cloudflareWorkerName: serverExecution?.cloudflare?.workerName,
    nodeKind: serverExecution?.node?.kind,
    nodeManifestUrl: serverExecution?.node?.manifestUrl,
    nodeContainerEntry: serverExecution?.node?.containerEntry,
  });
  const expectedServerExecutionSubset = (vertical: Vertical) => ({
    apiBaseUrl: expectedApiUrl(vertical),
    versionBoundary: 'web-and-api-same-build',
    cloudflareKind: 'cloudflare-worker-snapshot',
    cloudflareWorkerName: expectedCloudflareWorkerName(vertical),
    nodeKind: 'node-mf-runtime',
    nodeManifestUrl: expectedBackendManifestUrl(vertical),
    nodeContainerEntry: expectedBackendContainerEntry(vertical),
  });
  const remoteContractSubset = (remote: JsonRecord) => ({
    id: remote?.id,
    name: remote?.name,
    manifestUrl: remote?.manifestUrl,
  });
  const expectedRemoteContractSubset = (vertical: Vertical) => ({
    id: vertical.id,
    name: vertical.mfName,
    manifestUrl: expectedManifestUrl(vertical),
  });
  const expectedRemoteSubsetsForRefs = (refs: string[]) =>
    refs
      .map(ref => fullStackVerticals.find(vertical => vertical.id === ref))
      .filter((vertical): vertical is Vertical => vertical !== undefined)
      .map(expectedRemoteContractSubset);
  const requiredMicroVerticalPaths = (vertical: Vertical) => [
    `${vertical.path}/package.json`,
    `${vertical.path}/tsconfig.json`,
    `${vertical.path}/tsconfig.mf-types.json`,
    `${vertical.path}/modern.config.ts`,
    `${vertical.path}/src/modern-app-env.d.ts`,
    `${vertical.path}/src/modern.runtime.ts`,
    `${vertical.path}/locales/en/translation.json`,
    `${vertical.path}/locales/en/${vertical.namespace}.json`,
    `${vertical.path}/locales/cs/translation.json`,
    `${vertical.path}/locales/cs/${vertical.namespace}.json`,
    ...(vertical.emitsUi
      ? [
          `${vertical.path}/module-federation.config.ts`,
          `${vertical.path}/src/federation-entry.tsx`,
          ...vertical.componentPaths,
          `${vertical.path}/src/routes/index.css`,
          `${vertical.path}/src/routes/layout.tsx`,
          `${vertical.path}/src/routes/ultramodern-route-head.tsx`,
          `${vertical.path}/src/routes/ultramodern-route-metadata.ts`,
          ...(vertical.exposes.includes('./Widget')
            ? [
                `${vertical.path}/src/routes/[lang]/_mf/fragment/widget/page.tsx`,
              ]
            : []),
        ]
      : []),
    ...(vertical.emitsApi
      ? [
          `${vertical.path}/backend-federation.config.ts`,
          `${vertical.path}/api/effect-api.ts`,
          `${vertical.path}/api/index.ts`,
          `${vertical.path}/${vertical.apiContractPath}`,
          `${vertical.path}/${vertical.apiClientPath}`,
        ]
      : []),
  ];
  // UI/MF artifacts an `api-only` unit must NOT emit (headless invariant), and
  // API/BFF artifacts a `ui-only`/Horizontal Remote unit must NOT emit.
  const forbiddenMicroVerticalPaths = (vertical: Vertical) => [
    ...(vertical.emitsUi
      ? []
      : [
          `${vertical.path}/module-federation.config.ts`,
          `${vertical.path}/src/federation-entry.tsx`,
          // The federated demo `./Widget` component (descriptors.ts:127 ->
          // remoteComponentOutputPath) is a UI-only artifact; a headless api-only
          // unit exposes no browser component and must not ship it.
          `${vertical.path}/src/components/${vertical.domain ?? vertical.id}-widget.tsx`,
          `${vertical.path}/src/routes/layout.tsx`,
          `${vertical.path}/src/routes/[lang]/page.tsx`,
          `${vertical.path}/src/routes/[lang]/_mf/fragment/widget/page.tsx`,
          // A headless api-only unit renders no browser surface, so it must not
          // ship route components, the colocated route-metadata/head modules, or
          // the colocated `[lang]/route.meta.ts` route-meta file.
          `${vertical.path}/src/routes/[lang]/route.meta.ts`,
          `${vertical.path}/src/routes/ultramodern-route-head.tsx`,
          `${vertical.path}/src/routes/ultramodern-route-metadata.ts`,
          `${vertical.path}/src/routes/index.css`,
        ]),
    ...(vertical.emitsApi
      ? []
      : [
          `${vertical.path}/shared/api.ts`,
          // A ui-only/Horizontal Remote unit carries no API contract in either
          // protocol (neither the REST `shared/api.ts` nor the RPC `shared/rpc.ts`)
          // and no generated API client.
          `${vertical.path}/shared/rpc.ts`,
          `${vertical.path}/backend-federation.config.ts`,
          `${vertical.path}/api/index.ts`,
          `${vertical.path}/api/effect-api.ts`,
          `${vertical.path}/src/api/${vertical.domain ?? vertical.id}-client.ts`,
          `${vertical.path}/src/api/${vertical.domain ?? vertical.id}-rpc-client.ts`,
        ]),
  ];
  const assertRequiredVerticalFile =
    (vertical: Vertical) => (relativePath: string) => {
      assertSelfCheck(
        fs.existsSync(path.join(root, relativePath)),
        `required files for ${vertical.id}`,
        `Missing ${relativePath}`,
        'restore the generated MicroVertical files or rerun the MicroVertical generator',
      );
    };
  const assertForbiddenVerticalFile =
    (vertical: Vertical) => (relativePath: string) => {
      assertSelfCheck(
        !fs.existsSync(path.join(root, relativePath)),
        `forbidden files for ${vertical.id}`,
        `Unexpected ${relativePath} for a ${vertical.surfaceProfile} unit`,
        `remove ${relativePath}; a ${vertical.surfaceProfile} unit does not emit this surface`,
      );
    };
  const assertMicroVerticalContractGraph = ({
    topology,
    ownership,
    overlay,
    shellPackage,
  }: Record<string, JsonRecord>) => {
    const expectedVerticalIds = fullStackVerticals.map(vertical => vertical.id);
    const expectedShellVerticalIds = expectedPrimaryShellVerticalIds;
    const expectedShellRemotes = expectedShellVerticalIds.flatMap(
      verticalId => {
        const vertical = fullStackVerticals.find(
          candidate => candidate.id === verticalId,
        );
        return vertical === undefined
          ? []
          : [expectedRemoteContractSubset(vertical)];
      },
    );

    assertObject(
      topology.shell,
      'topology/reference-topology.json shell',
      'restore generated topology shell metadata',
    );
    assertArray(
      topology.verticals,
      'topology/reference-topology.json verticals',
      'restore generated topology vertical entries',
    );
    assertObject(
      topology.shell?.moduleFederation,
      'topology/reference-topology.json shell.moduleFederation',
      'restore generated shell Module Federation metadata',
    );
    assertArray(
      topology.shell?.moduleFederation?.remotes,
      'topology/reference-topology.json shell.moduleFederation.remotes',
      'restore generated shell Module Federation remotes',
    );
    assertArray(
      ownership.owners,
      'topology/ownership.json owners',
      'restore generated ownership entries',
    );
    assertObject(
      overlay.ports,
      'topology/local-overlays/development.json ports',
      'restore generated local development port overlays',
    );
    assertObject(
      overlay.manifests,
      'topology/local-overlays/development.json manifests',
      'restore generated local Module Federation manifest overlays',
    );
    assertObject(
      overlay.apis,
      'topology/local-overlays/development.json apis',
      'restore generated local API overlays',
    );
    assertSameJson(
      topology.shell.verticalRefs ?? [],
      expectedShellVerticalIds,
      'topology/reference-topology.json shell.verticalRefs',
      'restore generated topology shell references',
    );
    assertSameJson(
      topology.verticals.map((vertical: JsonRecord) => vertical?.id),
      expectedVerticalIds,
      'topology/reference-topology.json verticals',
      'restore generated topology vertical entries',
    );
    assertSameJson(
      topology.shell.moduleFederation.remotes.map(remoteContractSubset),
      expectedShellRemotes,
      'topology/reference-topology.json shell.moduleFederation.remotes',
      'restore generated shell Module Federation remotes',
    );
    const compactShell = findById(
      ultramodernConfig.topology?.apps,
      shellApp.id,
    );
    assertSameJson(
      compactShell?.moduleFederation?.verticalRefs ?? [],
      expectedShellVerticalIds,
      `${compactConfigPath} topology.apps.${shellApp.id}.moduleFederation.verticalRefs`,
      'keep compact and reference topology composition aligned',
    );
    for (const vertical of fullStackVerticals) {
      const expectedRefs = vertical.verticalRefs ?? [];
      const topologyEntry = findById(topology.verticals, vertical.id);
      const ownershipEntry = findById(ownership.owners, vertical.id);
      const expectedExposes = Array.isArray(vertical.exposes)
        ? vertical.exposes
        : Object.keys(vertical.exposes ?? {});

      const compactVertical = findById(
        ultramodernConfig.topology?.apps,
        vertical.id,
      );
      assertSameJson(
        {
          kind: compactVertical?.kind,
          package: compactVertical?.package ?? vertical.packageName,
          path:
            typeof compactVertical?.path === 'string'
              ? compactVertical.path.replace(/\\/gu, '/').replace(/^\.\/+/u, '')
              : vertical.path,
          namespace: compactVertical?.domain ?? vertical.domain ?? vertical.id,
          federationName:
            compactVertical?.moduleFederation?.name ?? vertical.mfName,
          exposes: compactVertical?.moduleFederation?.exposes ?? [],
          verticalRefs: compactVertical?.moduleFederation?.verticalRefs ?? [],
          ...(vertical.emitsApi
            ? {
                api: {
                  prefix:
                    compactVertical?.api?.prefix ??
                    `/${vertical.domain ?? vertical.id}-api`,
                  protocol:
                    compactVertical?.api?.protocol === 'rpc' ? 'rpc' : 'rest',
                  group: toCamelCase(
                    toKebabCase(
                      compactVertical?.api?.stem ??
                        vertical.domain ??
                        vertical.id,
                    ),
                  ),
                },
              }
            : {}),
        },
        {
          kind: 'vertical',
          package: vertical.packageName,
          path: vertical.path,
          namespace: vertical.namespace,
          federationName: vertical.mfName,
          exposes: expectedExposes,
          verticalRefs: expectedRefs,
          ...(vertical.emitsApi
            ? {
                api: {
                  prefix: vertical.apiPrefix,
                  protocol: vertical.apiProtocol,
                  group: vertical.group,
                },
              }
            : {}),
        },
        `${compactConfigPath} topology.apps.${vertical.id} published surfaces`,
        'keep compact and reference topology package, federation and API surfaces aligned',
      );

      requiredMicroVerticalPaths(vertical).forEach(
        assertRequiredVerticalFile(vertical),
      );

      assertObject(
        topologyEntry,
        `topology/reference-topology.json verticals.${vertical.id}`,
        'restore generated topology vertical entries',
      );
      assertSameJson(
        {
          kind: topologyEntry.kind,
          package: topologyEntry.package,
          path: topologyEntry.path,
          moduleFederation: {
            name: topologyEntry.moduleFederation?.name,
            manifestUrl: topologyEntry.moduleFederation?.manifestUrl,
            exposes: topologyEntry.moduleFederation?.exposes ?? [],
            verticalRefs: topologyEntry.moduleFederation?.verticalRefs ?? [],
            remotes: (topologyEntry.moduleFederation?.remotes ?? []).map(
              remoteContractSubset,
            ),
          },
          ...(vertical.emitsApi
            ? {
                api: {
                  prefix: topologyEntry.api?.bff?.prefix,
                  serverEntry: topologyEntry.api?.serverEntry,
                },
              }
            : {}),
        },
        {
          kind: 'vertical',
          package: vertical.packageName,
          path: vertical.path,
          moduleFederation: {
            name: vertical.mfName,
            manifestUrl: expectedManifestUrl(vertical),
            exposes: expectedExposes,
            verticalRefs: expectedRefs,
            remotes: expectedRemoteSubsetsForRefs(expectedRefs),
          },
          ...(vertical.emitsApi
            ? {
                api: {
                  prefix: vertical.apiPrefix,
                  serverEntry: `${vertical.path}/api/index.ts`,
                },
              }
            : {}),
        },
        `topology/reference-topology.json verticals.${vertical.id}`,
        'restore generated topology vertical entries',
      );
      if (vertical.emitsApi) {
        assertSameJson(
          backendFederationSubset(topologyEntry.backendFederation),
          expectedBackendFederationSubset(vertical),
          `topology/reference-topology.json verticals.${vertical.id}.backendFederation`,
          'restore generated MicroVertical server execution contract',
        );
      }

      if (vertical.deliveryUnit) {
        const compactApp = findById(
          ultramodernConfig.topology?.apps,
          vertical.id,
        );
        const expectedDeliveryUnit = deliveryUnitBlock(
          expectedDeliveryUnitFor(vertical),
        );
        assertSameJson(
          deliveryUnitBlock(compactApp?.deliveryUnit),
          expectedDeliveryUnit,
          `${generatedContractLabel} topology.apps.${vertical.id}.deliveryUnit`,
          deliveryUnitIdentityFixArea,
        );
        if (vertical.emitsApi) {
          assertSameJson(
            deliveryUnitBlock(compactApp?.backendFederation?.deliveryUnit),
            expectedDeliveryUnit,
            `${generatedContractLabel} topology.apps.${vertical.id}.backendFederation.deliveryUnit`,
            deliveryUnitIdentityFixArea,
          );
        }
        assertSameJson(
          deliveryUnitBlock(topologyEntry.deliveryUnit),
          expectedDeliveryUnit,
          `topology/reference-topology.json verticals.${vertical.id}.deliveryUnit`,
          deliveryUnitIdentityFixArea,
        );
        if (vertical.emitsApi) {
          assertSameJson(
            deliveryUnitBlock(topologyEntry.backendFederation?.deliveryUnit),
            expectedDeliveryUnit,
            `topology/reference-topology.json verticals.${vertical.id}.backendFederation.deliveryUnit`,
            deliveryUnitIdentityFixArea,
          );
          assertSelfCheck(
            topologyEntry.backendFederation?.versionBoundary?.identityRoot ===
              'deliveryUnit',
            `topology/reference-topology.json verticals.${vertical.id}.backendFederation.versionBoundary.identityRoot`,
            `Expected "deliveryUnit", found ${formatJson(topologyEntry.backendFederation?.versionBoundary?.identityRoot)}`,
            deliveryUnitIdentityFixArea,
          );
        }
      }

      assertObject(
        ownershipEntry,
        `topology/ownership.json owners.${vertical.id}`,
        'restore generated ownership entries',
      );
      assertSameJson(
        {
          package: ownershipEntry.package,
          path: ownershipEntry.path,
        },
        {
          package: vertical.packageName,
          path: vertical.path,
        },
        `topology/ownership.json owners.${vertical.id}`,
        'restore generated ownership entries',
      );

      assertSameJson(
        overlay.ports[vertical.id],
        vertical.port,
        `topology/local-overlays/development.json ports.${vertical.id}`,
        'restore generated local development port overlay',
      );
      if (vertical.emitsUi) {
        assertSameJson(
          overlay.manifests[vertical.id],
          expectedManifestUrl(vertical),
          `topology/local-overlays/development.json manifests.${vertical.id}`,
          'restore generated local Module Federation manifest overlay',
        );
      }
      if (vertical.emitsApi) {
        assertSameJson(
          overlay.apis[vertical.id],
          expectedApiUrl(vertical),
          `topology/local-overlays/development.json apis.${vertical.id}`,
          'restore generated local API overlay',
        );
        assertSameJson(
          serverExecutionSubset(overlay.serverExecution?.[vertical.id]),
          expectedServerExecutionSubset(vertical),
          `topology/local-overlays/development.json serverExecution.${vertical.id}`,
          'restore generated local MicroVertical server execution overlay',
        );
      }

      // Plain workspace dependencies and Zephyr metadata are gated
      // INDEPENDENTLY (G2a/G28): every shell depends on each API-emitting
      // vertical (its vertical-clients.ts re-exports the client) regardless of
      // UI composition, while Zephyr metadata follows UI composition refs only.
      const shellPackagesForDependencyChecks = [
        {
          id: 'shell-super-app',
          path: 'apps/shell-super-app',
          pkg: shellPackage,
          uiRefs: expectedShellVerticalIds,
        },
        ...expectedAdditionalShells.map(additionalShell => ({
          id: additionalShell.id,
          path: additionalShell.path,
          pkg: readJson(`${additionalShell.path}/package.json`),
          uiRefs: additionalShell.verticalRefs ?? [],
        })),
      ];
      for (const shellEntry of shellPackagesForDependencyChecks) {
        const composed = shellEntry.uiRefs.includes(vertical.id);
        if (vertical.emitsApi || composed) {
          assertSameJson(
            shellEntry.pkg.dependencies?.[vertical.packageName],
            'workspace:*',
            `${shellEntry.path}/package.json dependencies.${vertical.packageName}`,
            'restore shell dependency for the MicroVertical consumer',
          );
        }
        if (composed) {
          assertSameJson(
            shellEntry.pkg['zephyr:dependencies']?.[vertical.zephyrAlias],
            `${vertical.packageName}@workspace:*`,
            `${shellEntry.path}/package.json zephyr:dependencies.${vertical.zephyrAlias}`,
            'restore shell Zephyr dependency metadata for the MicroVertical',
          );
        }
      }
    }
  };
  const toPosixPath = (value: string) => value.split(path.sep).join('/');
  const referenceFrom = (fromPath: string, toPath: string) => ({
    path: toPosixPath(path.relative(fromPath, toPath)),
  });
  const sharedPackagePaths = [
    'packages/shared-contracts',
    'packages/shared-design-tokens',
  ];
  const tsgoCacheKey = (packagePath: string) =>
    packagePath.replace(/[^a-zA-Z0-9._-]+/gu, '__');
  const assertProjectReferenceEmitConfig = (
    tsConfig: JsonRecord,
    packagePath: string,
  ) => {
    const compilerOptions = tsConfig.compilerOptions ?? {};
    const relativeRoot = toPosixPath(path.relative(packagePath, '.')) || '.';
    assert(
      compilerOptions.composite === true,
      `${packagePath} must stay a composite TS-Go project`,
    );
    assert(
      compilerOptions.declaration === true,
      `${packagePath} must emit declarations for TS-Go build mode`,
    );
    assert(
      compilerOptions.declarationMap === false,
      `${packagePath} must not emit declaration maps during checks`,
    );
    assert(
      compilerOptions.emitDeclarationOnly === true,
      `${packagePath} must only emit declarations during checks`,
    );
    assert(
      compilerOptions.noEmit === false,
      `${packagePath} must override root noEmit for TS-Go build mode`,
    );
    assert(
      compilerOptions.outDir ===
        `${relativeRoot}/node_modules/.cache/tsgo/declarations/${tsgoCacheKey(packagePath)}`,
      `${packagePath} must emit TS-Go declarations into the generated cache`,
    );
    assert(
      compilerOptions.tsBuildInfoFile ===
        `${relativeRoot}/node_modules/.cache/tsgo/${tsgoCacheKey(packagePath)}.tsbuildinfo`,
      `${packagePath} must keep TS-Go build info in the generated cache`,
    );
  };
  const assertTsConfigReferenceGraph = () => {
    const baseTsConfig = readJson('tsconfig.base.json');
    const rootTsConfig = readJson('tsconfig.json');
    const shellTsConfig = readJson('apps/shell-super-app/tsconfig.json');
    const shellMfTypesTsConfig = readJson(
      'apps/shell-super-app/tsconfig.mf-types.json',
    );
    const additionalShellPaths = (
      workspaceValidationContract.structuralShellPolicy?.shells ?? []
    )
      .filter((shell: JsonRecord) => shell.id !== 'shell-super-app')
      .map((shell: JsonRecord) => shell.packageDir);
    const expectedRootReferences = [
      ...sharedPackagePaths,
      'apps/shell-super-app',
      ...fullStackVerticals.map(vertical => vertical.path),
      ...additionalShellPaths,
    ].map(referencePath => ({ path: referencePath }));
    const expectedShellReferences = sharedPackagePaths.map(referencePath =>
      referenceFrom('apps/shell-super-app', referencePath),
    );

    assertSameJson(
      rootTsConfig.files,
      [],
      'tsconfig.json files',
      'restore the generated root project-reference tsconfig',
    );
    assertIncludesJson(
      rootTsConfig.references ?? [],
      expectedRootReferences,
      'tsconfig.json references',
      'restore the generated root project-reference graph',
    );
    assertIncludesJson(
      shellTsConfig.references ?? [],
      expectedShellReferences,
      'apps/shell-super-app/tsconfig.json references',
      'restore the generated shell project-reference graph',
    );
    assert(
      baseTsConfig.compilerOptions?.skipLibCheck !== true,
      'tsconfig.base.json must not use skipLibCheck',
    );
    assertIncludesJson(
      shellTsConfig.include ?? [],
      [
        'src',
        'locales/**/*.json',
        'package.json',
        'shared',
        'shared/ultramodern-build.json',
        'server',
      ],
      'apps/shell-super-app/tsconfig.json include',
      'restore the generated shell typecheck boundary',
    );
    assertProjectReferenceEmitConfig(shellTsConfig, 'apps/shell-super-app');
    assertIncludesJson(
      shellMfTypesTsConfig.include ?? [],
      ['src/modern-app-env.d.ts'],
      'apps/shell-super-app/tsconfig.mf-types.json',
      'restore the generated shell Module Federation DTS boundary',
    );
    for (const sharedPackagePath of sharedPackagePaths) {
      assertProjectReferenceEmitConfig(
        readJson(`${sharedPackagePath}/tsconfig.json`),
        sharedPackagePath,
      );
    }

    for (const vertical of fullStackVerticals) {
      const verticalTsConfig = readJson(`${vertical.path}/tsconfig.json`);
      const verticalMfTypesTsConfig = readJson(
        `${vertical.path}/tsconfig.mf-types.json`,
      );
      const expectedVerticalReferences = [
        ...sharedPackagePaths,
        ...(vertical.verticalRefs ?? [])
          .map(verticalRef =>
            fullStackVerticals.find(candidate => candidate.id === verticalRef),
          )
          .filter((vertical): vertical is Vertical => vertical !== undefined)
          .map(referencedVertical => referencedVertical.path),
      ].map(referencePath => referenceFrom(vertical.path, referencePath));
      assertIncludesJson(
        verticalTsConfig.references ?? [],
        expectedVerticalReferences,
        `${vertical.path}/tsconfig.json references`,
        'restore the generated MicroVertical project-reference graph',
      );
      assertIncludesJson(
        verticalTsConfig.include ?? [],
        [
          'src',
          'locales/**/*.json',
          'package.json',
          'shared',
          'shared/ultramodern-build.json',
          'server',
          ...(vertical.emitsApi ? ['api'] : []),
        ],
        `${vertical.path}/tsconfig.json include`,
        'restore the generated MicroVertical typecheck boundary',
      );
      assertProjectReferenceEmitConfig(verticalTsConfig, vertical.path);
      assert(
        (vertical.verticalRefs ?? []).length > 0
          ? verticalTsConfig.compilerOptions?.skipLibCheck === true
          : verticalTsConfig.compilerOptions?.skipLibCheck !== true,
        `${vertical.path}/tsconfig.json must scope skipLibCheck to composed remotes`,
      );
      if (!vertical.emitsUi) {
        assertSelfCheck(
          !(verticalMfTypesTsConfig.include ?? []).includes(
            'src/federation-entry.tsx',
          ),
          `${vertical.path}/tsconfig.mf-types.json`,
          'A headless unit cannot include a browser federation entry',
          'restore the generated MicroVertical Module Federation DTS boundary',
        );
      }
      assertIncludesJson(
        verticalMfTypesTsConfig.include ?? [],
        vertical.emitsUi
          ? [
              'src/federation-entry.tsx',
              ...vertical.componentPaths.map(componentPath =>
                componentPath.replace(`${vertical.path}/`, ''),
              ),
              'src/modern-app-env.d.ts',
            ]
          : ['src/modern-app-env.d.ts'],
        `${vertical.path}/tsconfig.mf-types.json`,
        'restore the generated MicroVertical Module Federation DTS boundary',
      );
    }

    for (const shell of expectedAdditionalShells) {
      const shellTsConfig = readJson(`${shell.path}/tsconfig.json`);
      const shellMfTypesTsConfig = readJson(
        `${shell.path}/tsconfig.mf-types.json`,
      );
      const expectedShellReferences = sharedPackagePaths.map(referencePath =>
        referenceFrom(shell.path, referencePath),
      );
      assertIncludesJson(
        shellTsConfig.references ?? [],
        expectedShellReferences,
        `${shell.path}/tsconfig.json references`,
        'restore the generated additional-shell project-reference graph',
      );
      assertIncludesJson(
        shellTsConfig.include ?? [],
        [
          'src',
          'locales/**/*.json',
          'package.json',
          'shared',
          'shared/ultramodern-build.json',
          'server',
        ],
        `${shell.path}/tsconfig.json include`,
        'restore the generated additional-shell typecheck boundary',
      );
      assertProjectReferenceEmitConfig(shellTsConfig, shell.path);
      assertIncludesJson(
        shellMfTypesTsConfig.include ?? [],
        ['src/modern-app-env.d.ts'],
        `${shell.path}/tsconfig.mf-types.json`,
        'restore the generated additional-shell Module Federation DTS boundary',
      );
    }
  };
  const packageJsonFiles = (startDir: string) => {
    const files = [];
    const queue = [startDir];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (
          [
            '.git',
            '.output',
            '.zerops',
            'dist',
            'node_modules',
            'repos',
          ].includes(entry.name)
        ) {
          continue;
        }
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(absolute);
        } else if (entry.name === 'package.json') {
          files.push(absolute);
        }
      }
    }
    return files.sort();
  };
  const modernDependencyNames = (packageJson: JsonRecord) => [
    ...new Set(
      [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
      ]
        .flatMap(section => Object.keys(packageJson[section] ?? {}))
        .filter(packageName => packageName.startsWith('@modern-js/')),
    ),
  ];
  const assertModernPackageCohort = () => {
    const modernPackageNames =
      workspaceValidationContract.cohort.modernPackages;
    const cohortPackages = expectedReleaseCohort?.packages;
    const modernPackageNameSet = new Set(
      cohortPackages?.map((entry: JsonRecord) => entry.sourceName) ??
        modernPackageNames,
    );
    const observedModernPackageNames = new Set();
    const observedAppIds = [];
    // Additional shells (G28) are their own Delivery Units registered in the
    // additive `config.shells` collection and gated by the structural thin-shell
    // policy; they are deliberately kept out of the strict topology.apps cohort,
    // so their package manifests are excluded from the app-id cohort walk here.
    const additionalShellAppIds = new Set(
      (workspaceValidationContract.structuralShellPolicy?.shells ?? [])
        .map((shell: JsonRecord) => shell.id)
        .filter(id => id !== 'shell-super-app'),
    );
    for (const packageJsonPath of packageJsonFiles(root)) {
      const relativePath = path
        .relative(root, packageJsonPath)
        .split(path.sep)
        .join('/');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (
        typeof packageJson.modernjs?.appId === 'string' &&
        !additionalShellAppIds.has(packageJson.modernjs.appId)
      ) {
        observedAppIds.push(packageJson.modernjs.appId);
      }
      for (const packageName of modernDependencyNames(packageJson)) {
        observedModernPackageNames.add(packageName);
      }
      for (const section of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
      ]) {
        for (const packageName of modernPackageNameSet) {
          const actual = packageJson[section]?.[packageName];
          if (actual !== undefined) {
            assert(
              actual ===
                (cohortPackages
                  ? `npm:${cohortPackages.find((entry: JsonRecord) => entry.sourceName === packageName)?.targetName}@${expectedReleaseCohort.release.version}`
                  : expectedModernPackageSpecifier(packageName)),
              `${relativePath} ${section}.${packageName} must match package source metadata`,
            );
          }
        }
      }
    }

    for (const packageName of modernPackageNames) {
      assert(
        observedModernPackageNames.has(packageName),
        `Modern package cohort is missing ${packageName}`,
      );
    }
    assertUniqueStrings(observedAppIds, 'generated app package manifests');
    // The app-id cohort is a SET: observedAppIds is discovered by a
    // filesystem-ordered package.json walk, while cohort.appIds is in generation
    // insertion order. Compare order-insensitively (every other cohort check uses
    // the same sorted comparison via assertSameIdCohort) so a multi-vertical
    // workspace whose insertion order differs from filesystem order still passes.
    assertSameJson(
      [...observedAppIds].toSorted(),
      [...workspaceValidationContract.cohort.appIds].toSorted(),
      'generated app package manifest cohort',
      'restore every generated app package manifest',
    );
  };
  const assertPublicSurfaceAssets = (appPath: string) => {
    for (const relativePath of publicSurfaceManagedSourceAssetPaths) {
      assertNotExists(`${appPath}/${relativePath}`);
    }
  };
  const expectedWorkerName = (packageSuffix: string) =>
    `${packageScope}-${packageSuffix}`.slice(0, 63);
  const parseSemver = (version: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
    assert(match, `Unable to parse pnpm version: ${version}`);
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
      patch: Number(match[3]),
    };
  };
  const compareSemver = (left: Semver, right: Semver) =>
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch;

  const activePnpmVersion = execFileSync(
    'pnpm',
    ['--pm-on-fail=ignore', '--version'],
    {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
  const activeNodeVersion = process.versions.node;
  const minimumPnpmVersion = { major: 11, minor: 0, patch: 0 };
  const currentPnpmVersion = parseSemver(activePnpmVersion);
  const minimumNodeVersion = { major: 26, minor: 0, patch: 0 };
  const currentNodeVersion = parseSemver(activeNodeVersion);

  assert(
    compareSemver(currentPnpmVersion, minimumPnpmVersion) >= 0,
    `Generated workspace requires pnpm >=11; active pnpm is ${activePnpmVersion}. Run mise install, then rerun pnpm from the activated shell.`,
  );
  assert(
    compareSemver(currentNodeVersion, minimumNodeVersion) >= 0,
    `Generated workspace requires Node >=26; active Node is ${activeNodeVersion}. Run mise install, then rerun node from the activated shell.`,
  );

  const requiredPaths = [
    '.gitignore',
    'package.json',
    'pnpm-workspace.yaml',
    `patches/@module-federation__modern-js-v3@${expectedModuleFederationVersion}.patch`,
    `patches/@module-federation__bridge-react@${expectedModuleFederationVersion}.patch`,
    `patches/@module-federation__runtime-core@${expectedModuleFederationVersion}.patch`,
    'tsconfig.json',
    'tsconfig.base.json',
    'oxlint.config.ts',
    'oxfmt.config.ts',
    '.agents/agent-reference-repos.json',
    'topology/reference-topology.json',
    'topology/ownership.json',
    'topology/local-overlays/development.json',
    'scripts/assert-mf-types.mts',
    'scripts/bootstrap-agent-skills.mts',
    'scripts/check-ultramodern-i18n-boundaries.mts',
    ...(hasBackendSurfaces
      ? ['scripts/generate-node-backend-federation.mts']
      : []),
    'scripts/generate-public-surface-assets.mts',
    'scripts/generate-tanstack-routes.mts',
    'scripts/proof-cloudflare-version.mts',
    ...(hasDeliveryUnits ? ['scripts/proof-workerd-ssr.mts'] : []),
    ...(hasBackendSurfaces
      ? ['scripts/proof-node-backend-federation.mts']
      : []),
    'scripts/setup-agent-reference-repos.mts',
    'scripts/ultramodern-performance-readiness.config.mjs',
    'scripts/ultramodern-performance-readiness.mts',
    'scripts/ultramodern-typecheck.mts',
    'scripts/validate-ultramodern-workspace.mts',
    'scripts/verify-cloudflare-output.mts',
    'apps/shell-super-app/package.json',
    'apps/shell-super-app/tsconfig.json',
    'apps/shell-super-app/tsconfig.mf-types.json',
    'apps/shell-super-app/modern.config.ts',
    'apps/shell-super-app/module-federation.config.ts',
    'apps/shell-super-app/src/modern-app-env.d.ts',
    'apps/shell-super-app/src/modern.runtime.ts',
    'apps/shell-super-app/src/api/vertical-clients.ts',
    'apps/shell-super-app/locales/en/translation.json',
    `apps/shell-super-app/locales/en/${shellNamespace}.json`,
    'apps/shell-super-app/locales/cs/translation.json',
    `apps/shell-super-app/locales/cs/${shellNamespace}.json`,
    'apps/shell-super-app/src/routes/index.css',
    'apps/shell-super-app/src/routes/layout.tsx',
    'apps/shell-super-app/src/routes/shell-frame.tsx',
    'apps/shell-super-app/src/routes/ultramodern-route-head.tsx',
    'apps/shell-super-app/src/routes/ultramodern-route-metadata.ts',
    'packages/shared-contracts/package.json',
    'packages/shared-contracts/src/index.ts',
    'packages/shared-contracts/tsconfig.json',
    'packages/shared-design-tokens/package.json',
    'packages/shared-design-tokens/src/index.ts',
    'packages/shared-design-tokens/src/tokens.css',
    'packages/shared-design-tokens/tsconfig.json',
  ];

  for (const vertical of fullStackVerticals) {
    requiredPaths.push(...requiredMicroVerticalPaths(vertical));
  }

  if (tailwindEnabled) {
    requiredPaths.push(
      'apps/shell-super-app/tailwind.config.ts',
      ...fullStackVerticals
        .filter(vertical => vertical.emitsUi)
        .flatMap(vertical => [`${vertical.path}/tailwind.config.ts`]),
    );
  }

  requiredPaths.push(compactConfigPath);

  for (const vertical of fullStackVerticals) {
    requiredMicroVerticalPaths(vertical).forEach(
      assertRequiredVerticalFile(vertical),
    );
    // Reject profile-foreign surfaces planted into a unit (e.g. a browser MF
    // config in a headless api-only unit, or an API contract in a UI-only unit).
    forbiddenMicroVerticalPaths(vertical).forEach(
      assertForbiddenVerticalFile(vertical),
    );
  }
  for (const shell of expectedAdditionalShells) {
    requiredPaths.push(
      `${shell.path}/package.json`,
      `${shell.path}/tsconfig.json`,
      `${shell.path}/tsconfig.mf-types.json`,
      `${shell.path}/modern.config.ts`,
      `${shell.path}/module-federation.config.ts`,
      `${shell.path}/src/modern-app-env.d.ts`,
      `${shell.path}/src/modern.runtime.ts`,
      `${shell.path}/src/api/vertical-clients.ts`,
      `${shell.path}/locales/en/translation.json`,
      `${shell.path}/locales/en/${shellNamespace}.json`,
      `${shell.path}/locales/cs/translation.json`,
      `${shell.path}/locales/cs/${shellNamespace}.json`,
      `${shell.path}/src/routes/index.css`,
      `${shell.path}/src/routes/layout.tsx`,
      `${shell.path}/src/routes/shell-frame.tsx`,
      `${shell.path}/src/routes/ultramodern-route-head.tsx`,
      `${shell.path}/src/routes/ultramodern-route-metadata.ts`,
    );
    if (tailwindEnabled) {
      requiredPaths.push(`${shell.path}/tailwind.config.ts`);
    }
  }
  for (const requiredPath of requiredPaths) {
    assertExists(requiredPath);
  }
  // Agent skills metadata may live under .agents/ (agents-standard layout) or
  // .codex/ (legacy scaffold default).
  assertAnyOf(['.agents/skills-lock.json', '.codex/skills-lock.json']);
  assertAnyOf([
    '.agents/rstackjs-agent-skills-LICENSE',
    '.codex/rstackjs-agent-skills-LICENSE',
  ]);
  const readPnpmWorkspaceConfig = (key: string) =>
    JSON.parse(
      execFileSync('pnpm', ['config', 'get', key, '--json'], {
        cwd: root,
        encoding: 'utf-8',
      }),
    );
  const pnpmOverrides = readPnpmWorkspaceConfig('overrides');
  const pnpmPatches = readPnpmWorkspaceConfig('patchedDependencies');
  // pnpm reports patch paths realpathed against the workspace dir; on Windows
  // that can be the long-name form while `root` (process.cwd()) is the 8.3
  // short form, so compare realpaths instead of raw string equality.
  const canonicalFsPath = (target: string) => {
    try {
      return fs.realpathSync.native(target);
    } catch {
      return path.resolve(target);
    }
  };
  const patchPathMatches = (key: string, expectedRelativePath: string) =>
    typeof pnpmPatches[key] === 'string' &&
    canonicalFsPath(pnpmPatches[key]) ===
      canonicalFsPath(path.join(root, expectedRelativePath));
  assert(
    pnpmOverrides['@effect/opentelemetry'] === expectedEffectVersion,
    'pnpm-workspace.yaml must override @effect/opentelemetry to the generated Effect cohort',
  );
  assert(
    pnpmOverrides.effect === expectedEffectVersion,
    'pnpm-workspace.yaml must override effect to the generated Effect cohort',
  );
  assert(
    pnpmOverrides['@effect/vitest'] === expectedEffectVitestVersion,
    'pnpm-workspace.yaml must override @effect/vitest to the generated Effect test cohort',
  );
  assert(
    pnpmOverrides['@tanstack/history'] === expectedTanstackHistoryVersion,
    'pnpm-workspace.yaml must override @tanstack/history to the generated TanStack cohort',
  );
  assert(
    patchPathMatches(
      `@module-federation/modern-js-v3@${expectedModuleFederationVersion}`,
      `patches/@module-federation__modern-js-v3@${expectedModuleFederationVersion}.patch`,
    ),
    'pnpm-workspace.yaml must patch the generated Module Federation Modern.js integration cohort',
  );
  assert(
    patchPathMatches(
      `@module-federation/bridge-react@${expectedModuleFederationVersion}`,
      `patches/@module-federation__bridge-react@${expectedModuleFederationVersion}.patch`,
    ),
    'pnpm-workspace.yaml must patch the generated Module Federation React bridge cohort',
  );
  assert(
    patchPathMatches(
      `@module-federation/runtime-core@${expectedModuleFederationVersion}`,
      `patches/@module-federation__runtime-core@${expectedModuleFederationVersion}.patch`,
    ),
    'pnpm-workspace.yaml must patch the generated Module Federation runtime-core cohort',
  );
  assertWorkspaceValidationContract(expected);
  assertAdditionalShellContractShape();
  assertCompilerArchitecture(root, workspaceValidationContract);
  for (const oldRemotePath of oldRemotePaths) {
    assertNotExists(oldRemotePath);
  }
  for (const retiredMetadataPath of retiredMetadataPaths) {
    assertNotExists(retiredMetadataPath);
  }
  const rootPackage = readJson('package.json');
  const ultramodernConfig = readJson(compactConfigPath);
  const topology = readJson(
    workspaceValidationContract.metadata.referenceTopology.path,
  );
  const ownership = readJson(
    workspaceValidationContract.metadata.ownership.path,
  );
  const overlay = readJson(
    workspaceValidationContract.metadata.developmentOverlay.path,
  );
  assertStructuredWorkspaceMetadata({
    ultramodernConfig,
    topology,
    ownership,
    overlay,
  });
  const bridgeConfig =
    ultramodernConfig?.bridge?.enabled === true
      ? ultramodernConfig.bridge
      : undefined;
  const packageSource = createPackageSourceView(ultramodernConfig);
  assert(
    (ultramodernConfig.workspace?.node?.version ?? expectedNodeVersion) ===
      expectedNodeVersion,
    'Generated contract must record the Node toolchain version',
  );
  const shellPackage = readJson('apps/shell-super-app/package.json');

  assertMicroVerticalContractGraph({
    topology,
    ownership,
    overlay,
    shellPackage,
  });
  for (const field of [
    'features',
    'deploy',
    'moduleFederation',
    'backendFederation',
    'agentSkills',
    'tooling',
  ] as const) {
    assertSameJson(
      ultramodernConfig[field],
      workspaceValidationContract.policy.compactConfig[field],
      `${compactConfigPath} policy.${field}`,
      'restore framework policy metadata',
    );
  }
  assertTsConfigReferenceGraph();

  assert(rootPackage.private === true, 'Root package must be private');
  assert(
    typeof rootPackage.packageManager === 'string',
    'Root must declare packageManager',
  );
  const packageManagerPnpmVersionMatch = /^pnpm@(\d+\.\d+\.\d+)$/u.exec(
    rootPackage.packageManager,
  );
  assert(
    packageManagerPnpmVersionMatch,
    'Root packageManager must pin pnpm with a semver version',
  );
  const packageManagerPnpmVersion = packageManagerPnpmVersionMatch[1];
  assert(
    compareSemver(parseSemver(packageManagerPnpmVersion), minimumPnpmVersion) >=
      0,
    'Root packageManager must use pnpm >=11',
  );
  assert(rootPackage.engines?.node === '>=26', 'Root must require Node >=26');
  assert(rootPackage.engines?.pnpm === '>=11', 'Root must require pnpm >=11');
  const activeMiseTools = JSON.parse(
    execFileSync('mise', ['ls', '--current', '--json'], {
      cwd: root,
      encoding: 'utf-8',
    }),
  );
  assert(
    activeMiseTools.node?.some(
      (tool: JsonRecord) => tool.requested_version === expectedNodeVersion,
    ),
    'mise must activate the generated Node version',
  );
  assert(
    activeMiseTools.pnpm?.some(
      (tool: JsonRecord) =>
        tool.requested_version === packageManagerPnpmVersion,
    ),
    'mise must activate the generated pnpm version',
  );
  assert(
    rootPackage.modernjs?.preset === 'presetUltramodern',
    'Root must declare presetUltramodern',
  );
  assert(
    rootPackage.modernjs?.packageSource?.config ===
      './.modernjs/ultramodern.json',
    'Root must point at compact UltraModern config',
  );
  assert(
    rootPackage.modernjs?.packageSource?.strategy === packageSource.strategy,
    'Root package source strategy must match metadata',
  );
  assert(
    packageSource.strategy === 'workspace' ||
      packageSource.strategy === 'install',
    'Package source strategy must be workspace or install',
  );
  assert(
    packageSource.strategy === 'install' ||
      packageSource.modernPackages?.specifier === 'workspace:*',
    'Workspace package source must be explicitly backed by workspace:*',
  );
  assertModernPackageCohort();
  const assertAdditionalShellCohort = () => {
    const primaryShellConfig = findById(
      ultramodernConfig.topology?.apps,
      'shell-super-app',
    );
    const overlayPorts = overlay.ports ?? {};
    const configuredPorts = [
      ...Object.entries(overlayPorts).map(([id, port]) => ({ id, port })),
      ...(!Object.hasOwn(overlayPorts, 'shell-super-app')
        ? [{ id: 'shell-super-app', port: primaryShellConfig?.port }]
        : []),
      ...expectedAdditionalShells.map((shell: JsonRecord) => ({
        id: shell.id,
        port: shell.port,
      })),
    ];
    const portsByValue = new Map();
    for (const { id, port } of configuredPorts) {
      assert(
        typeof port === 'number' && Number.isFinite(port),
        `Configured development port for ${id} must be finite`,
      );
      const previous = portsByValue.get(port);
      assert(
        previous === undefined,
        `Duplicate configured development port ${port} for ${previous} and ${id}`,
      );
      portsByValue.set(port, id);
    }

    if (expectedAdditionalShellIds.length === 0) {
      assert(
        ultramodernConfig.shells === undefined,
        'Single-shell workspace must not declare config.shells',
      );
      return;
    }

    assertSameIdCohort(
      ultramodernConfig.shells,
      expectedAdditionalShellIds,
      `${compactConfigPath} shells`,
      'restore every configured additional shell',
    );
    const configuredShellRecords = ultramodernConfig.shells;
    const configuredShellById = new Map(
      configuredShellRecords.map((shell: JsonRecord) => [shell.id, shell]),
    );
    assertUniqueStrings(
      [
        primaryShellConfig?.moduleFederation?.name,
        ...expectedAdditionalShells.map((shell: JsonRecord) => shell.mfName),
      ],
      'configured shell Module Federation identities',
    );
    assertUniqueStrings(
      expectedAdditionalShells.map(
        (shell: JsonRecord) => shell.deliveryUnit?.buildMarker,
      ),
      'configured shell build markers',
    );

    for (const shell of expectedAdditionalShells) {
      const configShell = configuredShellById.get(shell.id);
      assertObject(
        configShell,
        `${compactConfigPath} shells.${shell.id}`,
        'restore the generated additional-shell config record',
      );
      assertSameJson(
        {
          id: configShell.id,
          name: configShell.name,
          kind: configShell.kind,
          package: configShell.package,
          path: configShell.path,
          port: configShell.port,
          portEnv: configShell.portEnv,
          mfName: configShell.mfName,
          verticalRefs: configShell.verticalRefs,
          owner: configShell.owner,
          deliveryUnit: configShell.deliveryUnit,
          moduleFederation: configShell.moduleFederation,
        },
        {
          id: shell.id,
          name: shell.id.replace(/^shell-/u, ''),
          kind: 'shell',
          package: shell.packageName,
          path: shell.path,
          port: shell.port,
          portEnv: shell.portEnv,
          mfName: shell.mfName,
          verticalRefs: shell.verticalRefs,
          owner: shell.owner,
          deliveryUnit: shell.deliveryUnit,
          moduleFederation: shell.moduleFederation,
        },
        `${compactConfigPath} shells.${shell.id}`,
        'restore the complete additional-shell config record',
      );
      assert(
        !Object.hasOwn(overlay.ports ?? {}, shell.id),
        `${shell.id} port must stay in config.shells, not the development overlay`,
      );
      const owner = configShell.owner;
      assertObject(
        owner,
        `${compactConfigPath} shells.${shell.id}.owner`,
        'record exactly one owner for every configured Delivery Unit',
      );
      assert(
        ['team', 'agent', 'agent-team'].includes(owner.kind) &&
          typeof owner.id === 'string' &&
          owner.id.length > 0,
        `${compactConfigPath} shells.${shell.id}.owner must identify one accountable owner`,
      );
      assertSameJson(
        owner,
        shell.owner,
        `${compactConfigPath} shells.${shell.id}.owner`,
        'restore the generated additional-shell owner attribution',
      );
      assertObject(
        configShell.deliveryUnit,
        `${compactConfigPath} shells.${shell.id}.deliveryUnit`,
        'restore the generated additional-shell Delivery Unit identity',
      );
      assert(
        typeof configShell.deliveryUnit.unitId === 'string' &&
          configShell.deliveryUnit.unitId.length > 0 &&
          typeof configShell.deliveryUnit.buildMarker === 'string' &&
          configShell.deliveryUnit.buildMarker.length > 0,
        `${compactConfigPath} shells.${shell.id}.deliveryUnit must carry unitId and buildMarker`,
      );

      const packagePath = `${shell.path}/package.json`;
      const packageJson = readJson(packagePath);
      assert(
        packageJson.name === shell.packageName,
        `${shell.id} package name is incorrect`,
      );
      assert(
        packageJson.modernjs?.appId === shell.id,
        `${shell.id} package modernjs.appId is incorrect`,
      );
      assert(
        packageJson.modernjs?.role === 'shell',
        `${shell.id} package modernjs.role must be shell`,
      );
      assert(
        packageJson.scripts?.['cloudflare:deploy'] ===
          'cross-env ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS=true pnpm run cloudflare:build && wrangler deploy --config .output/wrangler.json',
        `${shell.id} must expose a portable cloudflare:deploy`,
      );
      assert(
        packageJson.devDependencies?.['cross-env'] === expectedCrossEnvVersion,
        `${shell.id} cross-env dependency must match the portable generated-script cohort`,
      );
      assertPortableGeneratedEnvironmentScripts(packageJson, shell.id);

      const buildArtifact = readJson(
        `${shell.path}/shared/ultramodern-build.json`,
      );
      assert(
        buildArtifact.deliveryUnit?.appId === shell.id,
        `${shell.id} build artifact appId is incorrect`,
      );
      assert(
        buildArtifact.deliveryUnit?.buildMarker ===
          shell.deliveryUnit?.buildMarker,
        `${shell.id} build marker is not participating in the build artifact`,
      );
      assertSameJson(
        deliveryUnitBlock(configShell.deliveryUnit),
        deliveryUnitBlock(shell.deliveryUnit),
        `${compactConfigPath} shells.${shell.id}.deliveryUnit`,
        deliveryUnitIdentityFixArea,
      );
      assertSameJson(
        deliveryUnitBlock(buildArtifact.deliveryUnit),
        deliveryUnitBlock(shell.deliveryUnit),
        `${shell.path}/shared/ultramodern-build.json deliveryUnit`,
        deliveryUnitIdentityFixArea,
      );
      assert(
        shell.degradedState?.appId === shell.id &&
          shell.degradedState?.status === 'degraded',
        `${shell.id} degraded-state contract must identify its own shell`,
      );

      if ((shell.verticalRefs ?? []).length > 0) {
        assert(
          shell.degradedState.required === true,
          `${shell.id} degraded-state contract must be required for remote consumption`,
        );
      }
    }
  };
  assertAdditionalShellCohort();
  assert(
    rootPackage.devDependencies?.['@modern-js/ultramodern-create'] ===
      expectedModernPackageSpecifier('@modern-js/ultramodern-create'),
    'Root must depend on @modern-js/ultramodern-create through package source metadata',
  );
  assert(
    rootPackage.devDependencies?.['@modern-js/code-tools'] ===
      expectedModernPackageSpecifier('@modern-js/code-tools'),
    'Root must depend on @modern-js/code-tools through package source metadata',
  );
  assert(
    rootPackage.devDependencies?.['@modern-js/plugin-bff'] ===
      expectedModernPackageSpecifier('@modern-js/plugin-bff'),
    'Root must depend on @modern-js/plugin-bff for Node backend federation proof',
  );
  assert(
    rootPackage.devDependencies?.['cross-env'] === expectedCrossEnvVersion,
    'Root cross-env dependency must match the portable generated-script cohort',
  );
  assert(
    rootPackage.scripts?.format === 'oxfmt .',
    'Root format script must rely on the cross-platform Oxfmt ignore configuration',
  );
  assert(
    rootPackage.scripts?.['format:check'] === 'oxfmt --check .',
    'Root format:check script must rely on the cross-platform Oxfmt ignore configuration',
  );
  if (packageSource.strategy === 'install') {
    const installSpecifier = packageSource.modernPackages?.specifier;
    assert(
      typeof installSpecifier === 'string' &&
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
          installSpecifier,
        ) &&
        installSpecifier.includes('ultramodern'),
      'Install package source must use a semver UltraModern published cohort',
    );
    const modernAliases = packageSource.modernPackages?.aliases ?? {};
    if (Object.keys(modernAliases).length > 0) {
      for (const modernPackageName of [
        '@modern-js/app-tools',
        '@modern-js/code-tools',
        '@modern-js/plugin-bff',
        '@modern-js/plugin-i18n',
        '@modern-js/plugin-tanstack',
        '@modern-js/runtime',
        '@modern-js/ultramodern-create',
      ] as const) {
        assert(
          /^@[^/]+\/.+/.test(modernAliases[modernPackageName] ?? ''),
          `Install package source alias for ${modernPackageName} must be a scoped npm package`,
        );
      }
    }
  }
  assert(
    packageSource.generatedWorkspacePackages?.specifier === 'workspace:*',
    'Generated workspace packages must keep workspace:* links',
  );
  assert(
    rootPackage.scripts?.build === expectedBuildScript,
    'Root build script must build verticals before shell',
  );
  assert(
    rootPackage.scripts?.['cloudflare:build'] === expectedCloudflareBuildScript,
    'Root cloudflare:build script is incorrect',
  );
  assert(
    !('ultramodern:check' in (rootPackage.scripts ?? {})),
    'Root must not expose ultramodern:check',
  );
  if (bridgeConfig) {
    assert(
      rootPackage.scripts?.typecheck ===
        'pnpm -r --filter "./apps/*" --filter "./verticals/*" --filter "./packages/*" run typecheck',
      'Bridge root typecheck must check generated package boundaries without building parent implementation sources',
    );
    assert(
      Array.isArray(bridgeConfig.workspacePackages),
      'Bridge config must record workspace package patterns',
    );
    for (const workspacePackage of bridgeConfig.workspacePackages) {
      assert(
        rootPackage.workspaces?.includes(workspacePackage.pattern),
        `Root workspaces must include bridge package pattern ${workspacePackage.pattern}`,
      );
      assert(
        readPnpmWorkspaceConfig('packages').includes(workspacePackage.pattern),
        `pnpm-workspace.yaml must include bridge package pattern ${workspacePackage.pattern}`,
      );
    }
    for (const gate of bridgeConfig.gates ?? []) {
      const expectedGateScript = `${gate.cwd ? `cd ${gate.cwd} && ` : ''}${gate.command}`;
      assert(
        rootPackage.scripts?.[`bridge:${gate.name}`] === expectedGateScript,
        `Bridge gate script bridge:${gate.name} is incorrect`,
      );
    }
    assert(
      rootPackage.scripts?.['bridge:check'],
      'Bridge workspaces must expose bridge:check',
    );
  } else {
    assert(
      rootPackage.scripts?.typecheck ===
        'node ./scripts/ultramodern-typecheck.mts --build tsconfig.json',
      'Root typecheck must run TS-Go across the root project reference graph',
    );
  }
  assert(
    rootPackage.scripts?.['contract:check'] ===
      'node ./scripts/validate-ultramodern-workspace.mts',
    'Root must expose contract:check',
  );
  assert(
    rootPackage.scripts?.['api:check'] === 'modern-api-check',
    'Root must expose api:check',
  );
  assert(
    rootPackage.scripts?.['i18n:boundaries'] ===
      'node ./scripts/check-ultramodern-i18n-boundaries.mts',
    'Root must expose i18n:boundaries',
  );
  assert(
    rootPackage.scripts?.['performance:readiness'] ===
      'node ./scripts/ultramodern-performance-readiness.mts',
    'Root must expose default-on performance readiness diagnostics',
  );
  if (hasBackendSurfaces) {
    assert(
      rootPackage.scripts?.['node:backend-federation:generate'] ===
        'node ./scripts/generate-node-backend-federation.mts',
      'Root must expose local Node backend federation artifact generation',
    );
    assert(
      rootPackage.scripts?.['node:proof'] ===
        'node ./scripts/proof-node-backend-federation.mts',
      'Root must expose read-only node:proof for already-built backend federation Effect modules',
    );
  } else {
    assert(
      rootPackage.scripts?.['node:backend-federation:generate'] === undefined,
      'Root must not expose backend federation generation without an API surface',
    );
    assert(
      rootPackage.scripts?.['node:proof'] === undefined,
      'Root must not expose node:proof without an API surface',
    );
  }
  if (hasDeliveryUnits) {
    assert(
      rootPackage.scripts?.['zerops:materialize'] ===
        'node ./scripts/materialize-zerops-runtime.mjs',
      'Root must expose Zerops runtime materialization script',
    );
    assert(
      rootPackage.scripts?.['cloudflare:ssr-proof'] ===
        'node ./scripts/proof-workerd-ssr.mts',
      'Root must expose workerd distributed SSR composition proof',
    );
    assert(
      rootPackage.scripts?.['cloudflare:build']?.endsWith(
        '&& pnpm cloudflare:ssr-proof',
      ),
      'Root Cloudflare build must finish with workerd distributed SSR composition proof',
    );
  } else {
    assert(
      rootPackage.scripts?.['zerops:materialize'] === undefined,
      'Root must not expose Zerops materialization in a shell-only workspace',
    );
    assert(
      rootPackage.scripts?.['cloudflare:ssr-proof'] === undefined,
      'Root must not expose workerd SSR proof in a shell-only workspace',
    );
  }
  assertNotExists('scripts/generate-node-backend-federation.mjs');
  assertNotExists('scripts/proof-node-backend-federation.mjs');
  assertNotExists('scripts/verify-cloudflare-output.mjs');
  assertNotExists('scripts/generate-tanstack-routes.mjs');
  assert(
    typeof rootPackage.scripts?.check === 'string',
    'Root check must expose the generated quality gate',
  );
  assert(
    rootPackage.scripts?.['mf:types'] === 'node ./scripts/assert-mf-types.mts',
    'Root must expose mf:types',
  );
  assert(
    rootPackage.scripts?.['cloudflare:deploy'] ===
      expectedCloudflareDeployScript,
    'Root must expose cloudflare:deploy',
  );
  assert(
    rootPackage.scripts?.['cloudflare:proof'] ===
      'node ./scripts/proof-cloudflare-version.mts --out .codex/reports/cloudflare-version-proof/public-url-proof.json',
    'Root must expose cloudflare:proof',
  );
  assert(
    rootPackage.scripts?.['skills:install'] ===
      'node ./scripts/bootstrap-agent-skills.mts',
    'Root must expose skills:install',
  );
  assert(
    rootPackage.scripts?.['skills:check'] ===
      'node ./scripts/bootstrap-agent-skills.mts --check',
    'Root must expose skills:check',
  );
  const postinstall = rootPackage.scripts?.postinstall;
  const postinstallSegments =
    typeof postinstall === 'string'
      ? postinstall.match(
          new RegExp(WORKSPACE_SCRIPT_SEGMENT_PATTERN.source, 'gu'),
        )
      : undefined;
  assert(
    Array.isArray(postinstallSegments) &&
      postinstallSegments.join('&&') === postinstall &&
      postinstallSegments.every(command => command.trim().length > 0) &&
      postinstallSegments.some(
        command =>
          command.trim() ===
          'node ./scripts/bootstrap-agent-skills.mts --postinstall',
      ),
    'Root postinstall must run the default-on Codex skills bootstrap; formatting and reference repository installs remain explicit commands',
  );
  assert(
    rootPackage.scripts?.['agents:refs:install'] ===
      'node ./scripts/setup-agent-reference-repos.mts',
    'Root must expose agents:refs:install as the explicit reference repo installer',
  );

  const expectedZephyrDependencies = Object.fromEntries(
    expectedPrimaryShellVerticalIds.map(verticalId => {
      const vertical = fullStackVerticals.find(
        candidate => candidate.id === verticalId,
      );
      assert(vertical, `Missing primary-shell vertical ${verticalId}`);
      return [vertical.zephyrAlias, `${vertical.packageName}@workspace:*`];
    }),
  );
  assert(
    sameJson(shellPackage['zephyr:dependencies'], expectedZephyrDependencies),
    'Shell Zephyr dependencies must reference every primary-shell vertical package',
  );
  assert(
    shellPackage.devDependencies?.['@modern-js/app-tools'] ===
      expectedModernPackageSpecifier('@modern-js/app-tools'),
    'Shell app-tools dependency must match package source metadata',
  );
  assert(
    shellPackage.dependencies?.['@modern-js/plugin-bff'] ===
      expectedModernPackageSpecifier('@modern-js/plugin-bff'),
    'Shell plugin-bff dependency must match package source metadata',
  );
  assert(
    shellPackage.dependencies?.['@modern-js/plugin-i18n'] ===
      expectedModernPackageSpecifier('@modern-js/plugin-i18n'),
    'Shell plugin-i18n dependency must match package source metadata',
  );
  assert(
    shellPackage.dependencies?.['@modern-js/plugin-tanstack'] ===
      expectedModernPackageSpecifier('@modern-js/plugin-tanstack'),
    'Shell plugin-tanstack dependency must match package source metadata',
  );
  assert(
    shellPackage.dependencies?.['@modern-js/runtime'] ===
      expectedModernPackageSpecifier('@modern-js/runtime'),
    'Shell runtime dependency must match package source metadata',
  );
  assert(
    shellPackage.scripts?.['cloudflare:deploy'] ===
      'cross-env ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS=true pnpm run cloudflare:build && wrangler deploy --config .output/wrangler.json',
    'Shell must expose a portable cloudflare:deploy',
  );
  assert(
    shellPackage.devDependencies?.['cross-env'] === expectedCrossEnvVersion,
    'Shell cross-env dependency must match the portable generated-script cohort',
  );
  assertPortableGeneratedEnvironmentScripts(shellPackage, 'Shell');
  assert(
    topology.shell?.cloudflare?.workerName ===
      expectedWorkerName('shell-super-app'),
    'Shell topology Cloudflare workerName is incorrect',
  );
  assertPublicSurfaceAssets('apps/shell-super-app');
  assert(
    topology.shell?.verticalRefs?.join(',') ===
      expectedPrimaryShellVerticalIds.join(','),
    'Topology shell verticalRefs must match generated verticals',
  );
  assert(
    topology.verticals?.length === fullStackVerticals.length,
    'Topology must contain only generated verticals',
  );
  assert(
    !('remotes' in topology),
    'Topology must not expose legacy remotes; use verticals',
  );
  assert(
    !('effectServices' in topology),
    'Default APIs must be vertical-owned, not effectServices',
  );

  for (const vertical of fullStackVerticals) {
    const packageJson = readJson(`${vertical.path}/package.json`);
    const ultramodernBuildArtifact = readJson(
      `${vertical.path}/shared/ultramodern-build.json`,
    );
    if (vertical.deliveryUnit) {
      const topologyEntry = findById(topology.verticals, vertical.id);
      const expectedDeliveryUnit = deliveryUnitBlock(
        expectedDeliveryUnitFor(vertical),
      );
      const buildLabel = `${vertical.path}/shared/ultramodern-build.json deliveryUnit`;
      const buildIdentity = ultramodernBuildArtifact.deliveryUnit ?? {};
      assertSelfCheck(
        buildIdentity.buildMarker === expectedDeliveryUnit.buildMarker,
        buildLabel,
        `Expected build "${expectedDeliveryUnit.buildMarker}", found ${formatJson(buildIdentity.buildMarker)}`,
        deliveryUnitIdentityFixArea,
      );
      assertSelfCheck(
        buildIdentity.unitId === expectedDeliveryUnit.unitId,
        buildLabel,
        `Expected unitId "${expectedDeliveryUnit.unitId}", found ${formatJson(buildIdentity.unitId)}`,
        deliveryUnitIdentityFixArea,
      );
      assertSelfCheck(
        buildIdentity.packageName === expectedDeliveryUnit.packageName,
        buildLabel,
        `Expected packageName "${expectedDeliveryUnit.packageName}", found ${formatJson(buildIdentity.packageName)}`,
        deliveryUnitIdentityFixArea,
      );
      assertSelfCheck(
        buildIdentity.version === expectedDeliveryUnit.version,
        buildLabel,
        `Expected version "${expectedDeliveryUnit.version}", found ${formatJson(buildIdentity.version)}`,
        deliveryUnitIdentityFixArea,
      );
    }
    assert(
      packageJson.name === vertical.packageName,
      `${vertical.id} package name is incorrect`,
    );
    assert(
      packageJson.scripts?.['cloudflare:deploy'] ===
        'cross-env ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS=true pnpm run cloudflare:build && wrangler deploy --config .output/wrangler.json',
      `${vertical.id} must expose a portable cloudflare:deploy`,
    );
    assert(
      packageJson.devDependencies?.['cross-env'] === expectedCrossEnvVersion,
      `${vertical.id} cross-env dependency must match the portable generated-script cohort`,
    );
    assertPortableGeneratedEnvironmentScripts(packageJson, vertical.id);
    assert(
      packageJson.devDependencies?.['@modern-js/app-tools'] ===
        expectedModernPackageSpecifier('@modern-js/app-tools'),
      `${vertical.id} app-tools dependency must match package source metadata`,
    );
    if (vertical.emitsApi) {
      assert(
        packageJson.dependencies?.['@modern-js/plugin-bff'] ===
          expectedModernPackageSpecifier('@modern-js/plugin-bff'),
        `${vertical.id} plugin-bff dependency must match package source metadata`,
      );
    }
    assert(
      packageJson.dependencies?.['@modern-js/plugin-i18n'] ===
        expectedModernPackageSpecifier('@modern-js/plugin-i18n'),
      `${vertical.id} plugin-i18n dependency must match package source metadata`,
    );
    assert(
      packageJson.dependencies?.['@modern-js/plugin-tanstack'] ===
        expectedModernPackageSpecifier('@modern-js/plugin-tanstack'),
      `${vertical.id} plugin-tanstack dependency must match package source metadata`,
    );
    assert(
      packageJson.dependencies?.['@modern-js/runtime'] ===
        expectedModernPackageSpecifier('@modern-js/runtime'),
      `${vertical.id} runtime dependency must match package source metadata`,
    );
    if (vertical.emitsApi) {
      assert(
        packageJson.exports?.[vertical.apiClientExport!] ===
          `./${vertical.apiClientPath}`,
        `${vertical.id} must export its API client`,
      );
      assert(
        packageJson.exports?.['./api'] === `./${vertical.apiContractPath}`,
        `${vertical.id} must export its API contract`,
      );
      // API protocol exclusivity (G7a): an RPC unit ships only the RPC contract
      // and `${stem}-rpc-client`; a REST unit ships only the REST contract and
      // `${stem}-client`. Neither may carry the other protocol's surface.
      if (vertical.apiProtocol === 'rpc') {
        assert(
          !fs.existsSync(
            path.join(
              root,
              `${vertical.path}/src/api/${vertical.stem}-client.ts`,
            ),
          ),
          `${vertical.id} RPC unit must not emit the REST API client`,
        );
        assert(
          !fs.existsSync(path.join(root, `${vertical.path}/shared/api.ts`)),
          `${vertical.id} RPC unit must not emit the REST API contract`,
        );
      } else {
        assert(
          !fs.existsSync(
            path.join(
              root,
              `${vertical.path}/src/api/${vertical.stem}-rpc-client.ts`,
            ),
          ),
          `${vertical.id} REST unit must not emit the RPC API client`,
        );
        assert(
          !fs.existsSync(path.join(root, `${vertical.path}/shared/rpc.ts`)),
          `${vertical.id} REST unit must not emit the RPC API contract`,
        );
      }
    }
    const expectedVerticalZephyrDependencies = Object.fromEntries(
      fullStackVerticals
        .filter(candidate => vertical.verticalRefs.includes(candidate.id))
        .map(candidate => [
          candidate.zephyrAlias,
          `${candidate.packageName}@workspace:*`,
        ]),
    );
    assert(
      sameJson(
        packageJson['zephyr:dependencies'],
        expectedVerticalZephyrDependencies,
      ),
      `${vertical.id} Zephyr dependencies must match declared vertical refs`,
    );

    if (vertical.emitsUi) assertPublicSurfaceAssets(vertical.path);

    const topologyEntry = topology.verticals?.find(
      (verticalEntry: JsonRecord) => verticalEntry.id === vertical.id,
    );
    assert(
      topologyEntry?.kind === 'vertical',
      `${vertical.id} topology kind is incorrect`,
    );
    assert(
      topologyEntry?.package === vertical.packageName,
      `${vertical.id} topology package is incorrect`,
    );
    assert(
      topologyEntry?.cloudflare?.workerName === expectedWorkerName(vertical.id),
      `${vertical.id} topology Cloudflare workerName is incorrect`,
    );
    assert(
      topologyEntry?.moduleFederation?.name === vertical.mfName,
      `${vertical.id} topology MF name is incorrect`,
    );
    assert(
      JSON.stringify(topologyEntry?.moduleFederation?.exposes) ===
        JSON.stringify(vertical.exposes),
      `${vertical.id} topology exposes are incorrect`,
    );
    assert(
      JSON.stringify(topologyEntry?.moduleFederation?.verticalRefs ?? []) ===
        JSON.stringify(vertical.verticalRefs),
      `${vertical.id} topology verticalRefs are incorrect`,
    );
    // API/BFF topology metadata only exists for API-bearing units; and the REST
    // readiness/domain-operation surface is absent for the RPC protocol (G7a).
    if (vertical.emitsApi) {
      assert(
        topologyEntry?.api?.bff?.prefix === vertical.apiPrefix,
        `${vertical.id} topology API prefix is incorrect`,
      );
      assert(
        topologyEntry?.api?.bff?.strictEffectApproach === true,
        `${vertical.id} topology strictEffectApproach is incorrect`,
      );
      assert(
        topologyEntry?.api?.serverEntry === `${vertical.path}/api/index.ts`,
        `${vertical.id} topology server entry is incorrect`,
      );
      if (vertical.apiProtocol !== 'rpc') {
        assert(
          topologyEntry?.api?.readiness?.endpoint ===
            `/${vertical.stem}/readiness`,
          `${vertical.id} topology readiness endpoint is incorrect`,
        );
      }
    }

    if (vertical.deliveryUnit) {
      const expectedDeliveryUnit = deliveryUnitBlock(
        expectedDeliveryUnitFor(vertical),
      );
      const compactAppEntry = ultramodernConfig.topology?.apps?.find(
        (entry: JsonRecord) => entry?.id === vertical.id,
      );
      // The backend-federation delivery-unit mirror only exists for API-bearing
      // units; a UI-only vertical carries just the app-level delivery unit.
      if (vertical.emitsApi) {
        const compactBackendDeliveryUnit = deliveryUnitBlock(
          compactAppEntry?.backendFederation?.deliveryUnit,
        );
        assertSameJson(
          deliveryUnitBlock(compactAppEntry?.deliveryUnit),
          compactBackendDeliveryUnit,
          `${compactConfigPath} topology.apps.${vertical.id}.deliveryUnit`,
          deliveryUnitIdentityFixArea,
        );
        assertSameJson(
          compactBackendDeliveryUnit,
          expectedDeliveryUnit,
          `${compactConfigPath} topology.apps.${vertical.id}.backendFederation.deliveryUnit`,
          deliveryUnitIdentityFixArea,
        );
        assertSelfCheck(
          compactAppEntry?.backendFederation?.versionBoundary?.identityRoot ===
            'deliveryUnit',
          `${compactConfigPath} topology.apps.${vertical.id}.backendFederation.versionBoundary.identityRoot`,
          `Expected "deliveryUnit", found ${formatJson(compactAppEntry?.backendFederation?.versionBoundary?.identityRoot)}`,
          deliveryUnitIdentityFixArea,
        );
      }
      assertSameJson(
        deliveryUnitBlock(compactAppEntry?.deliveryUnit),
        expectedDeliveryUnit,
        `${compactConfigPath} topology.apps.${vertical.id}.deliveryUnit`,
        deliveryUnitIdentityFixArea,
      );
      assertSameJson(
        deliveryUnitBlock(compactAppEntry?.deliveryUnit),
        deliveryUnitBlock(topologyEntry?.deliveryUnit),
        `${compactConfigPath} vs topology/reference-topology.json verticals.${vertical.id}.deliveryUnit`,
        deliveryUnitIdentityFixArea,
      );
    }

    assert(
      ownership.owners?.some(
        (owner: JsonRecord) =>
          owner.id === vertical.id && owner.path === vertical.path,
      ),
      `${vertical.id} ownership entry is missing`,
    );
    assert(
      overlay.ports?.[vertical.id],
      `${vertical.id} development port is missing`,
    );
    if (vertical.emitsUi) {
      assert(
        overlay.manifests?.[vertical.id]?.includes('/mf-manifest.json'),
        `${vertical.id} development manifest is missing`,
      );
    }
    if (vertical.emitsApi) {
      assert(
        overlay.apis?.[vertical.id]?.endsWith(
          vertical.apiProtocol === 'rpc'
            ? `${vertical.apiPrefix}/rpc`
            : vertical.apiPrefix,
        ),
        `${vertical.id} development API URL is missing`,
      );
    }
  }

  // Delivery-unit identity for ALL unit kinds (G29). Every workspace app —
  // shell, UI-only vertical, and API-bearing vertical — is an indivisible
  // delivery unit and must carry one consistent identity record across the
  // compact config, the reference topology, and its generated build artifact
  // (ADR-0019: one delivery-unit record, one build marker).
  for (const expectedApp of workspaceValidationContract.topology.compactConfig
    ?.apps ?? []) {
    const unitLabel = `delivery-unit identity for ${expectedApp.id}`;
    const expectedDeliveryUnit = deliveryUnitBlock(expectedApp.deliveryUnit);
    assertSelfCheck(
      typeof expectedDeliveryUnit.unitId === 'string' &&
        expectedDeliveryUnit.unitId.length > 0 &&
        typeof expectedDeliveryUnit.buildMarker === 'string' &&
        expectedDeliveryUnit.buildMarker.length > 0,
      unitLabel,
      `Every unit kind must declare a delivery-unit record; found ${formatJson(expectedApp.deliveryUnit)}`,
      deliveryUnitIdentityFixArea,
    );

    const compactAppEntry = ultramodernConfig.topology?.apps?.find(
      (entry: JsonRecord) => entry?.id === expectedApp.id,
    );
    assertSameJson(
      expectedWorkerName(expectedApp.packageSuffix),
      expectedWorkerName(expectedApp.id),
      `${compactConfigPath} topology.apps.${expectedApp.id}.packageSuffix`,
      'keep the app package suffix aligned with its Cloudflare worker identity',
    );
    if (expectedApp.id === shellApp.id) {
      assertSameJson(
        {
          kind: compactAppEntry?.kind,
          name: compactAppEntry?.moduleFederation?.name ?? shellApp.mfName,
          portEnv: compactAppEntry?.portEnv ?? shellApp.portEnv,
        },
        {
          kind: shellApp.kind,
          name: shellApp.mfName,
          portEnv: shellApp.portEnv,
        },
        `${compactConfigPath} topology.apps.${shellApp.id} shell identity`,
        'restore the primary shell federation name and port environment',
      );
    }
    // Compare consumer inputs directly. The retired generated-contract view
    // used these inputs too; its remaining fields were synthetic constants.
    assertSelfCheck(
      compactAppEntry?.moduleFederation?.ssr !== false,
      `${compactConfigPath} topology.apps.${expectedApp.id}.moduleFederation.ssr`,
      'Workspace apps require streaming Module Federation SSR',
      'restore generated streaming SSR Module Federation settings',
    );
    assertSameJson(
      {
        package: compactAppEntry?.package ?? expectedApp.package,
        path:
          typeof compactAppEntry?.path === 'string'
            ? compactAppEntry.path.replace(/\\/gu, '/').replace(/^\.\/+/u, '')
            : expectedApp.path,
      },
      { package: expectedApp.package, path: expectedApp.path },
      `${compactConfigPath} topology.apps.${expectedApp.id} identity`,
      'restore the app package and path declared by the workspace topology',
    );
    assertSameJson(
      compactAppEntry?.deploy?.cloudflare,
      expectedApp.deploy?.cloudflare,
      `${compactConfigPath} topology.apps.${expectedApp.id}.deploy.cloudflare`,
      'regenerate the app Cloudflare deployment contract; do not add local proof-only smoke checks',
    );
    assertSameJson(
      deliveryUnitBlock(compactAppEntry?.deliveryUnit),
      expectedDeliveryUnit,
      `${compactConfigPath} topology.apps.${expectedApp.id}.deliveryUnit`,
      deliveryUnitIdentityFixArea,
    );

    const topologyUnitEntry =
      expectedApp.kind === 'shell'
        ? topology.shell
        : topology.verticals?.find(
            (entry: JsonRecord) => entry?.id === expectedApp.id,
          );
    assertSameJson(
      deliveryUnitBlock(topologyUnitEntry?.deliveryUnit),
      expectedDeliveryUnit,
      `topology/reference-topology.json ${expectedApp.kind === 'shell' ? 'shell' : `verticals.${expectedApp.id}`}.deliveryUnit`,
      deliveryUnitIdentityFixArea,
    );

    const appPath = expectedApp.path;
    const buildArtifactPath = `${appPath}/shared/ultramodern-build.json`;
    assertExists(buildArtifactPath);
    const buildIdentity = readJson(buildArtifactPath).deliveryUnit ?? {};
    assertSelfCheck(
      buildIdentity.unitId === expectedDeliveryUnit.unitId &&
        buildIdentity.buildMarker === expectedDeliveryUnit.buildMarker,
      `${buildArtifactPath} deliveryUnit`,
      `Expected ${formatJson({ unitId: expectedDeliveryUnit.unitId, buildMarker: expectedDeliveryUnit.buildMarker })}, found ${formatJson({ unitId: buildIdentity.unitId, buildMarker: buildIdentity.buildMarker })}`,
      deliveryUnitIdentityFixArea,
    );
  }

  console.log('UltraModern workspace scaffold validated');
}
