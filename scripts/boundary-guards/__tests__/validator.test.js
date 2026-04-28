const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractImportSpecifiers,
  runBoundaryGuardChecks,
  validateOwnershipBlastRadius,
  validateOwnershipContractShape,
  validateImportGuards,
  validateProfileShape,
  validateRequiredSnippets,
} = require('../validator');

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-boundary-guards-'));

const IMPACT_RULE_THEN_KEY = 'then';

const removeDir = directory => {
  fs.rmSync(directory, { recursive: true, force: true });
};

const makeOwnershipContract = () => ({
  schemaVersion: 1,
  contractId: 'mv-test-ownership',
  principals: [
    {
      id: 'team:checkout',
      type: 'team',
      displayName: 'Checkout Team',
    },
    {
      id: 'team:catalog',
      type: 'team',
      displayName: 'Catalog Team',
    },
    {
      id: 'team:platform',
      type: 'team',
      displayName: 'Platform Team',
    },
  ],
  ownershipTargets: {
    routes: [
      {
        id: 'route:checkout',
        vertical: 'checkout',
        owners: ['team:checkout'],
        routePatterns: ['/checkout/**'],
      },
      {
        id: 'route:catalog',
        vertical: 'catalog',
        owners: ['team:catalog'],
        routePatterns: ['/catalog/**'],
      },
    ],
    remotes: [],
    services: [],
    sharedPackages: [
      {
        id: 'pkg:design-system',
        vertical: 'platform',
        owners: ['team:platform'],
        packageNames: ['@modern-js/design-system'],
        publicApiRefs: ['design-system-public-api'],
        allowedConsumerVerticals: ['checkout', 'catalog'],
      },
    ],
  },
  pathRules: [
    {
      id: 'checkout-route-paths',
      targetId: 'route:checkout',
      includeGlobs: ['apps/checkout/**'],
      rule: 'owned',
      requiresApprovalGateIds: ['owning-vertical'],
    },
    {
      id: 'design-system-paths',
      targetId: 'pkg:design-system',
      includeGlobs: ['packages/design-system/**'],
      rule: 'shared-api-only',
      requiresApprovalGateIds: ['platform-owner'],
    },
  ],
  dependencyGraphImpact: {
    graphSources: [
      {
        id: 'test-import-graph',
        type: 'import-graph',
        path: 'graph.json',
      },
    ],
    impactRules: [
      {
        id: 'cross-vertical-consumer-impact',
        when: {
          crossesVertical: true,
        },
        [IMPACT_RULE_THEN_KEY]: {
          riskTier: 'high',
          requireApprovalGateIds: ['impacted-vertical'],
          blockIfUnownedConsumer: true,
        },
      },
    ],
    requiredOutputs: [
      'changed-targets',
      'direct-consumers',
      'cross-vertical-consumers',
      'approval-plan',
    ],
  },
  approvalGates: [
    {
      id: 'owning-vertical',
      name: 'Owning vertical approval',
      requiredApprovals: {
        minimumCount: 1,
        principalTypes: ['team'],
        mustIncludeOwningVertical: true,
      },
    },
    {
      id: 'impacted-vertical',
      name: 'Impacted vertical approval',
      requiredApprovals: {
        minimumCount: 1,
        principalTypes: ['team'],
        mustIncludeImpactedVerticals: true,
      },
    },
    {
      id: 'platform-owner',
      name: 'Platform owner approval',
      requiredApprovals: {
        minimumCount: 1,
        principalTypes: ['team'],
        mustIncludePlatformOwner: true,
      },
    },
  ],
  extractionBoundaryChecks: {
    noCrossVerticalImports: true,
    allowedCrossingModes: ['api-only', 'remote-contract-only'],
    requiredBoundaryRefs: ['auth', 'session', 'trace'],
    remoteExtractionReadiness: [
      'stable-route-ownership',
      'loader-bridge-contract',
      'fallback-ui',
    ],
    serviceExtractionReadiness: [
      'api-contract',
      'auth-boundary',
      'trace-boundary',
    ],
  },
});

test('validateProfileShape accepts valid profile schema', () => {
  const profile = {
    schemaVersion: 1,
    contractPath: 'contract.json',
    moduleManifests: ['manifest.json'],
    importGuards: [
      {
        id: 'guard',
        roots: ['packages/runtime'],
        bannedImportPatterns: ['^@modules/'],
      },
    ],
    requiredSnippets: [
      {
        id: 'snippet',
        path: 'file.ts',
        includes: ['token'],
      },
    ],
  };

  assert.doesNotThrow(() => validateProfileShape(profile));
});

test('validateProfileShape accepts optional ownership gate inputs', () => {
  const profile = {
    schemaVersion: 1,
    contractPath: 'contract.json',
    moduleManifests: ['manifest.json'],
    importGuards: [],
    requiredSnippets: [],
    ownershipGate: {
      contractPath: 'ownership.json',
      changedPaths: ['apps/checkout/page.tsx'],
      dependencyGraph: {
        consumers: [
          {
            id: 'catalog-consumer',
            targetId: 'route:catalog',
          },
        ],
      },
      approvedGateIds: ['owning-vertical'],
    },
  };

  assert.doesNotThrow(() => validateProfileShape(profile));
});

test('validateImportGuards detects banned imports', () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, 'input.ts');
    fs.writeFileSync(
      filePath,
      "import exampleModule from '@modules/example-module';\n",
    );

    const report = validateImportGuards({
      importGuards: [
        {
          id: 'no-domain',
          roots: [dir],
          bannedImportPatterns: ['^@modules/[^/]+'],
        },
      ],
      rootDir: process.cwd(),
      scanExtensions: ['.ts'],
    });

    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].guardId, 'no-domain');
  } finally {
    removeDir(dir);
  }
});

test('extractImportSpecifiers includes export-from statements', () => {
  const content = [
    "import sdk from '@modern-js/runtime';",
    "export * from '@modules/example-module';",
    "export { helper } from '@integrations/provider';",
    "const dep = require('@modules/secondary-module');",
  ].join('\n');

  const specifiers = extractImportSpecifiers(content);
  assert.deepEqual(specifiers, [
    '@modern-js/runtime',
    '@modules/example-module',
    '@integrations/provider',
    '@modules/secondary-module',
  ]);
});

test('validateImportGuards detects banned re-export specifiers', () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, 'barrel.ts');
    fs.writeFileSync(filePath, "export * from '@modules/example-module';\n");

    const report = validateImportGuards({
      importGuards: [
        {
          id: 'no-domain-reexport',
          roots: [dir],
          bannedImportPatterns: ['^@modules/[^/]+'],
        },
      ],
      rootDir: process.cwd(),
      scanExtensions: ['.ts'],
    });

    assert.equal(report.violations.length, 1);
    assert.equal(report.violations[0].guardId, 'no-domain-reexport');
    assert.equal(report.violations[0].specifier, '@modules/example-module');
  } finally {
    removeDir(dir);
  }
});

test('validateRequiredSnippets detects order violations', () => {
  const dir = makeTempDir();
  try {
    const filePath = path.join(dir, 'runtime.ts');
    fs.writeFileSync(filePath, 'register();\nvalidate();\ntrust();\n');

    const report = validateRequiredSnippets({
      requiredSnippets: [
        {
          id: 'ordered-check',
          path: path.relative(process.cwd(), filePath),
          includes: ['register();', 'validate();', 'trust();'],
          orderedIncludes: ['trust();', 'validate();'],
        },
      ],
      rootDir: process.cwd(),
    });

    assert.equal(report.violations.length, 1);
    assert.match(report.violations[0].message, /out of required order/);
  } finally {
    removeDir(dir);
  }
});

test('validateOwnershipContractShape accepts Wave 0 ownership schema concepts', () => {
  assert.doesNotThrow(() =>
    validateOwnershipContractShape(makeOwnershipContract()),
  );
});

test('validateOwnershipBlastRadius detects unowned changed paths', () => {
  const contract = makeOwnershipContract();
  const report = validateOwnershipBlastRadius({
    contract,
    ownershipGate: {
      contract,
      changedPaths: ['apps/unknown/page.tsx'],
    },
  });

  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0].type, 'ownership-unowned-changed-path');
});

test('validateOwnershipBlastRadius requires approvals for cross-vertical consumers', () => {
  const contract = makeOwnershipContract();
  const report = validateOwnershipBlastRadius({
    contract,
    ownershipGate: {
      contract,
      changedPaths: ['apps/checkout/page.tsx'],
      dependencyGraph: {
        consumers: [
          {
            id: 'catalog-route-consumer',
            targetId: 'route:catalog',
            depth: 1,
          },
        ],
      },
      approvedGateIds: ['owning-vertical'],
    },
  });

  assert.equal(report.crossesVertical, true);
  assert.deepEqual(report.requiredGateIds, [
    'impacted-vertical',
    'owning-vertical',
  ]);
  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0].type, 'ownership-missing-approval-gate');
  assert.equal(report.violations[0].gateId, 'impacted-vertical');
});

test('validateOwnershipBlastRadius accepts owned graph impact with approval plan', () => {
  const contract = makeOwnershipContract();
  const report = validateOwnershipBlastRadius({
    contract,
    ownershipGate: {
      contract,
      changedPaths: ['packages/design-system/button.tsx'],
      dependencyGraph: {
        crossVerticalConsumers: [
          {
            id: 'checkout-route-consumer',
            targetId: 'route:checkout',
            depth: 2,
          },
        ],
      },
      approvals: [
        {
          gateId: 'platform-owner',
          principalIds: ['team:platform'],
        },
        {
          gateId: 'impacted-vertical',
          principalIds: ['team:checkout'],
        },
      ],
    },
  });

  assert.equal(report.crossesVertical, true);
  assert.equal(report.violations.length, 0);
  assert.equal(report.changedTargets[0].targetId, 'pkg:design-system');
});

test('runBoundaryGuardChecks validates happy path', () => {
  const dir = makeTempDir();
  try {
    const contractPath = path.join(dir, 'contract.json');
    const manifestPath = path.join(dir, 'manifest.json');
    const sourceDir = path.join(dir, 'module');
    const runtimeFile = path.join(dir, 'runtime.ts');
    const policyFile = path.join(dir, 'policy.ts');
    fs.mkdirSync(sourceDir, { recursive: true });

    fs.writeFileSync(
      contractPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          compatibilityLanes: ['effect-first', 'tanstack-first'],
          sharedRequirements: {
            requiredManifestFields: [
              'moduleId',
              'version',
              'runtime',
              'sourceDir',
              'lifecycleHooks',
              'policyHooks',
              'observability',
              'compliance',
            ],
            requiredComplianceFlags: [
              'usesSdkContracts',
              'usesPolicyMiddleware',
              'usesObservabilityHooks',
            ],
            requiredObservabilitySignals: ['metrics', 'audit', 'trace'],
            requiredLifecycleHooks: [
              'registerRoutes',
              'registerCapabilities',
              'registerMigrations',
            ],
            requiredPolicyHooks: [
              'authorize',
              'enforceTenantScope',
              'validateOperationContext',
            ],
            requiredObservabilityHooks: [
              'emitBusinessMetric',
              'emitAuditEvent',
              'emitTraceContext',
            ],
            forbiddenCodePatterns: [
              'createRequest\\(',
              'x-modernjs-bff-envelope',
              'x-operation-id',
            ],
          },
          profiles: {},
        },
        null,
        2,
      ),
    );

    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          moduleId: 'example-module',
          version: '1.0.0',
          runtime: 'effect-first',
          sourceDir: path.relative(dir, sourceDir),
          lifecycleHooks: [
            'registerRoutes',
            'registerCapabilities',
            'registerMigrations',
          ],
          policyHooks: [
            'authorize',
            'enforceTenantScope',
            'validateOperationContext',
          ],
          observability: {
            signals: ['metrics', 'audit', 'trace'],
            hooks: ['emitBusinessMetric', 'emitAuditEvent', 'emitTraceContext'],
          },
          compliance: {
            usesSdkContracts: true,
            usesPolicyMiddleware: true,
            usesObservabilityHooks: true,
          },
        },
        null,
        2,
      ),
    );

    fs.writeFileSync(
      path.join(sourceDir, 'index.ts'),
      'export const moduleValue = "ok";\n',
    );
    fs.writeFileSync(
      runtimeFile,
      'await enforceRemoteTrustPolicy();\nvalidateRuntimeCompatibility();\nGarfishInstance.registerApp(apps);\n',
    );
    fs.writeFileSync(
      policyFile,
      'export const evaluateCrossProjectPolicy = () => "missing_operation_context operation_context_mismatch";\n',
    );

    const profilePath = path.join(dir, 'profile.json');
    fs.writeFileSync(
      profilePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          contractPath: path.relative(dir, contractPath),
          moduleManifests: [path.relative(dir, manifestPath)],
          importGuards: [
            {
              id: 'guard',
              roots: [path.relative(dir, sourceDir)],
              bannedImportPatterns: ['^@modules/'],
            },
          ],
          requiredSnippets: [
            {
              id: 'runtime',
              path: path.relative(dir, runtimeFile),
              includes: [
                'enforceRemoteTrustPolicy',
                'validateRuntimeCompatibility',
                'GarfishInstance.registerApp',
              ],
              orderedIncludes: [
                'enforceRemoteTrustPolicy',
                'validateRuntimeCompatibility',
                'GarfishInstance.registerApp',
              ],
            },
            {
              id: 'policy',
              path: path.relative(dir, policyFile),
              includes: [
                'evaluateCrossProjectPolicy',
                'missing_operation_context',
                'operation_context_mismatch',
              ],
            },
          ],
          scanExtensions: ['.ts'],
        },
        null,
        2,
      ),
    );

    const report = runBoundaryGuardChecks({
      profilePath,
      rootDir: dir,
      allowEmptyManifests: false,
    });

    assert.equal(report.validatedManifests, 1);
    assert.equal(report.requiredSnippetChecks, 2);
  } finally {
    removeDir(dir);
  }
});
