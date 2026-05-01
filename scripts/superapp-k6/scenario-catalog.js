(function registerSuperAppK6Catalog(root) {
  const DEFAULT_SCENARIO_SCRIPT = 'scripts/superapp-k6/superapp-scenarios.js';

  const REQUIRED_SCENARIO_IDS = [
    'smoke',
    'ramp-up',
    'spike',
    'breakpoint',
    'mixed-read-write',
    'tenant-boundary',
    'chat',
    'reset',
    'chaos-triggering',
  ];

  const DEFAULT_LOAD_THRESHOLD_PROFILE = 'smoke';
  const LOAD_THRESHOLD_PROFILE_IDS = ['smoke', 'release', 'nightly'];

  const ARTIFACT_LINKS = {
    workloadCatalog: {
      catalogVersion: 'superapp-workload-data-v1',
      seed: 'superapp-portfolio-workload-data-v1',
      requestIdPrefix: 'swl-v1',
    },
    workloadData: {
      datasetVersion: 'superapp-generated-workload-v1',
      seed: 'superapp-portfolio-generated-workload-v1',
    },
    workloadScenarioProfiles: {
      profileVersion: 'superapp-workload-scenario-profiles-v1',
      seed: 'superapp-portfolio-scenario-profiles-v1',
      tenantBoundaryProfileId: 'tenant-boundary-probes',
    },
    workloadResetSeed: {
      resetVersion: 'superapp-workload-reset-seed-v1',
      seed: 'superapp-portfolio-reset-seed-v1',
      defaultScenarioId: 'tenant-boundary-audit',
      defaultProfileId: 'tenant-boundary-probes',
      defaultTenantId: 'security-root',
    },
    workloadValidationArtifact: {
      artifactVersion: 'superapp-workload-validation-artifact-v1',
      artifactSeed: 'superapp-portfolio-validation-artifact-v1',
    },
  };

  const K6_THRESHOLD_PROFILES = {
    smoke: {
      id: 'smoke',
      label: 'Smoke Metadata Only',
      description:
        'Default PR-safe profile. It records threshold-profile metadata but does not add k6 thresholds or load commands to smoke certification.',
      scenarioIds: ['smoke'],
      defaultPrCost: {
        selectedByDefault: true,
        addsLoadToSmokeCertification: false,
      },
      certification: {
        profiles: ['smoke'],
        commandAddedToSmoke: false,
        reason:
          'Smoke certification keeps the existing fast checks; release and nightly must opt into load thresholds explicitly.',
      },
      thresholds: {},
    },
    release: {
      id: 'release',
      label: 'Stable Release Thresholds',
      description:
        'Stable release certification thresholds for sustained SuperApp read/write, tenant, chat, and reset workloads.',
      scenarioIds: [
        'smoke',
        'ramp-up',
        'mixed-read-write',
        'tenant-boundary',
        'chat',
        'reset',
      ],
      defaultPrCost: {
        selectedByDefault: false,
        addsLoadToSmokeCertification: false,
      },
      certification: {
        profiles: ['release', 'nightly'],
        commandAddedToSmoke: false,
        reason:
          'Release thresholds run only when certification is invoked with the release profile or a higher profile.',
      },
      thresholds: {
        checks: ['rate>=0.99'],
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<2000', 'p(99)<4000'],
        superapp_operation_failed: ['rate<0.01'],
        superapp_operation_duration: ['p(95)<2000', 'p(99)<4000'],
        'superapp_operation_failed{superapp_operation_kind:tenant-probe}': [
          'rate<0.001',
        ],
      },
    },
    nightly: {
      id: 'nightly',
      label: 'Aggressive Nightly Thresholds',
      description:
        'Broader and stricter nightly certification thresholds across every SuperApp torture k6 scenario, including breakpoint and chaos-triggering workloads.',
      scenarioIds: REQUIRED_SCENARIO_IDS,
      defaultPrCost: {
        selectedByDefault: false,
        addsLoadToSmokeCertification: false,
      },
      certification: {
        profiles: ['nightly'],
        commandAddedToSmoke: false,
        reason:
          'Nightly thresholds are intentionally excluded from default PR and smoke certification cost.',
      },
      thresholds: {
        checks: ['rate>=0.995'],
        http_req_failed: ['rate<0.005'],
        http_req_duration: ['p(95)<1500', 'p(99)<3000'],
        superapp_operation_failed: ['rate<0.005'],
        superapp_operation_duration: ['p(95)<1500', 'p(99)<3000'],
        'superapp_operation_failed{superapp_operation_kind:tenant-probe}': [
          'rate<0.0005',
        ],
        'superapp_operation_duration{superapp_operation_kind:chaos}': [
          'p(95)<2500',
        ],
      },
    },
  };

  const commonReadArtifacts = [
    'workloadCatalog',
    'workloadData',
    'workloadScenarioProfiles',
    'workloadValidationArtifact',
  ];
  const commonMutationArtifacts = [
    'workloadCatalog',
    'workloadScenarioProfiles',
    'workloadValidationArtifact',
  ];
  const resetArtifacts = [
    'workloadCatalog',
    'workloadData',
    'workloadScenarioProfiles',
    'workloadResetSeed',
    'workloadValidationArtifact',
  ];

  const jsonHeaders = {
    'content-type': 'application/json',
  };

  function bootstrapOperation(weight) {
    return {
      id: 'bootstrap',
      kind: 'read',
      method: 'GET',
      path: '/bff-api/effect/bootstrap',
      weight,
      expectedStatus: [200],
      workloadProfileId: 'read-heavy-command-center',
      artifactLinkIds: commonReadArtifacts,
    };
  }

  function pageOperation(input) {
    return {
      kind: 'read',
      method: 'GET',
      expectedStatus: [200],
      workloadProfileId: input.workloadProfileId,
      artifactLinkIds: input.artifactLinkIds || ['workloadValidationArtifact'],
      ...input,
    };
  }

  function workflowOperation(input) {
    return {
      id: input.id,
      kind: 'write',
      method: 'POST',
      path: `/bff-api/effect/apps/${input.appId}/workflow`,
      weight: input.weight,
      expectedStatus: [200],
      headers: jsonHeaders,
      bodyTemplate: {
        action: input.action,
        actor: input.actor,
        requestId: '{{requestId}}',
      },
      workloadProfileId: input.workloadProfileId,
      artifactLinkIds: commonMutationArtifacts,
      sampleSelectorIds: input.sampleSelectorIds,
    };
  }

  function pilotOperation(input) {
    return {
      id: input.id,
      kind: input.kind || 'write',
      method: 'POST',
      path: `/bff-api/effect/pilot/${input.scenario}/run`,
      weight: input.weight,
      expectedStatus: [200],
      headers: jsonHeaders,
      bodyTemplate: {
        tenant: 'superapp-global',
        actor: input.actor,
        requestId: '{{requestId}}',
        modules: input.modules,
        chaos: input.chaos || 'none',
      },
      workloadProfileId: input.workloadProfileId,
      artifactLinkIds: commonMutationArtifacts,
      sampleSelectorIds: input.sampleSelectorIds,
    };
  }

  function securityProbeOperation(input) {
    return {
      id: input.id,
      kind: 'tenant-probe',
      method: 'POST',
      path: '/bff-api/effect/security/probe',
      weight: input.weight,
      expectedStatus: input.expectedAllowed === false ? [200, 403, 500] : [200],
      headers: {
        ...jsonHeaders,
        authorization: 'Bearer k6-tenant-boundary',
        origin: 'https://superapp.example.test',
        'x-csrf-token': 'k6-tenant-boundary',
        'x-tenant-id': input.sourceTenantId,
        'x-user-role': input.roleId,
      },
      bodyTemplate: {
        targetTenant: input.targetTenantId,
        targetAppId: input.targetAppId,
        action: input.action,
        requestId: '{{requestId}}',
        mutation: false,
      },
      workloadProfileId: 'tenant-boundary-probes',
      artifactLinkIds: [
        'workloadCatalog',
        'workloadScenarioProfiles',
        'workloadValidationArtifact',
      ],
      tenantBoundaryProbeId: input.probeId,
      expectedAllowed: input.expectedAllowed,
      expectedFailedCheckIds: input.expectedFailedCheckIds,
      sampleSelectorIds: input.sampleSelectorIds,
    };
  }

  function failureOperation(input) {
    return {
      id: `failure-${input.mode}`,
      kind: 'chaos',
      method: 'POST',
      path: `/bff-api/effect/failure/${input.mode}`,
      weight: input.weight,
      expectedStatus: [200],
      headers: jsonHeaders,
      bodyTemplate: {
        actor: 'k6.chaos-triggering',
        reason: `ust-load-02 deterministic ${input.mode} trigger`,
      },
      chaosMode: input.mode,
      workloadProfileId: input.workloadProfileId || 'mixed-cross-app-journey',
      artifactLinkIds: ['workloadResetSeed', 'workloadValidationArtifact'],
    };
  }

  function resetOperation(weight) {
    return {
      id: 'reset-state',
      kind: 'reset',
      method: 'POST',
      path: '/bff-api/effect/reset',
      weight,
      expectedStatus: [200],
      headers: jsonHeaders,
      workloadProfileId: 'tenant-boundary-probes',
      artifactLinkIds: resetArtifacts,
      resetSeed: {
        resetVersion: ARTIFACT_LINKS.workloadResetSeed.resetVersion,
        seed: ARTIFACT_LINKS.workloadResetSeed.seed,
        scenarioId: 'tenant-boundary-audit',
        profileId: 'tenant-boundary-probes',
        tenantId: 'security-root',
      },
    };
  }

  const SCENARIOS = [
    {
      id: 'smoke',
      label: 'Smoke',
      description:
        'Fast binary-and-endpoint verification with a tiny write marker.',
      k6: {
        executor: 'constant-vus',
        vus: 2,
        duration: '30s',
        gracefulStop: '5s',
      },
      operationMix: {
        reads: 90,
        writes: 10,
        searchFilterSorts: 0,
        paginations: 0,
        tenantProbes: 0,
        resets: 0,
        chaos: 0,
      },
      resetSeedTarget: 'contract',
      operations: [
        bootstrapOperation(70),
        pageOperation({
          id: 'root-route',
          path: '/',
          weight: 20,
          workloadProfileId: 'read-heavy-command-center',
        }),
        workflowOperation({
          id: 'smoke-workflow-marker',
          appId: 'mobility-marketplace',
          action: 'k6-smoke-marker',
          actor: 'k6.smoke',
          weight: 10,
          workloadProfileId: 'write-heavy-order-ledger',
          sampleSelectorIds: ['orders-checkout-surge'],
        }),
      ],
    },
    {
      id: 'ramp-up',
      label: 'Ramp Up',
      description:
        'Gradually increases cross-app BFF load until the target scenario volume is reached.',
      k6: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
          { duration: '1m', target: 10 },
          { duration: '2m', target: 40 },
          { duration: '2m', target: 80 },
          { duration: '1m', target: 0 },
        ],
        gracefulRampDown: '20s',
      },
      vuProfile: {
        start: 0,
        peak: 80,
      },
      operationMix: {
        reads: 50,
        writes: 50,
        searchFilterSorts: 0,
        paginations: 0,
        tenantProbes: 0,
        resets: 0,
        chaos: 0,
      },
      resetSeedTarget: 'stress',
      operations: [
        bootstrapOperation(35),
        pilotOperation({
          id: 'ramp-grab-marketplace',
          scenario: 'grab-marketplace',
          modules: [
            'rides',
            'dispatch',
            'orders',
            'erp',
            'chat',
            'mf-remotes',
            'security',
            'billing',
          ],
          actor: 'k6.ramp-up',
          weight: 30,
          workloadProfileId: 'mixed-cross-app-journey',
          sampleSelectorIds: ['orders-checkout-surge', 'rides-rush-hour'],
        }),
        workflowOperation({
          id: 'ramp-erp-workflow',
          appId: 'enterprise-mega-erp',
          action: 'k6-ramp-up-ledger',
          actor: 'k6.ramp-up',
          weight: 20,
          workloadProfileId: 'write-heavy-order-ledger',
          sampleSelectorIds: ['ledger-reconciliation'],
        }),
        pageOperation({
          id: 'ramp-dispatch-route',
          path: '/mobility/dispatch',
          weight: 15,
          workloadProfileId: 'read-heavy-command-center',
          sampleSelectorIds: ['dispatch-retry-window'],
        }),
      ],
    },
    {
      id: 'spike',
      label: 'Spike',
      description:
        'Abruptly raises VUs to expose cold paths, socket backlog, and queue recovery behavior.',
      k6: {
        executor: 'ramping-vus',
        startVUs: 10,
        stages: [
          { duration: '30s', target: 20 },
          { duration: '20s', target: 120 },
          { duration: '1m', target: 120 },
          { duration: '30s', target: 20 },
          { duration: '30s', target: 0 },
        ],
        gracefulRampDown: '15s',
      },
      vuProfile: {
        start: 10,
        peak: 120,
      },
      operationMix: {
        reads: 40,
        writes: 50,
        searchFilterSorts: 0,
        paginations: 0,
        tenantProbes: 10,
        resets: 0,
        chaos: 0,
      },
      resetSeedTarget: 'stress',
      operations: [
        bootstrapOperation(25),
        pilotOperation({
          id: 'spike-mobility-chat',
          scenario: 'mobility-erp-chat',
          modules: ['rides', 'dispatch', 'erp', 'chat', 'security', 'billing'],
          actor: 'k6.spike',
          weight: 30,
          workloadProfileId: 'chat-pagination-history',
          sampleSelectorIds: ['chat-remote-fallback'],
        }),
        workflowOperation({
          id: 'spike-mf-workflow',
          appId: 'mf-platform',
          action: 'k6-spike-remote-refresh',
          actor: 'k6.spike',
          weight: 20,
          workloadProfileId: 'mixed-cross-app-journey',
          sampleSelectorIds: ['chat-remote-fallback'],
        }),
        pageOperation({
          id: 'spike-chat-route',
          path: '/mf-platform/chat',
          weight: 15,
          workloadProfileId: 'chat-pagination-history',
          sampleSelectorIds: ['chat-remote-fallback'],
        }),
        securityProbeOperation({
          probeId: 'city-ops-to-security-denied',
          id: 'spike-tenant-denied',
          sourceTenantId: 'city-ops-eu',
          targetTenantId: 'security-root',
          targetAppId: 'tenant-security',
          roleId: 'mobility-operator',
          action: 'role:read',
          expectedAllowed: false,
          expectedFailedCheckIds: [
            'tenant:header-matches-target',
            'tenant:app-access',
            'role:allowed-for-tenant',
          ],
          sampleSelectorIds: ['roles-privileged-page'],
          weight: 10,
        }),
      ],
    },
    {
      id: 'breakpoint',
      label: 'Breakpoint',
      description:
        'Ramps arrival rate beyond steady-state volume to identify the first visible failure boundary.',
      k6: {
        executor: 'ramping-arrival-rate',
        startRate: 10,
        timeUnit: '1s',
        preAllocatedVUs: 80,
        maxVUs: 240,
        stages: [
          { duration: '1m', target: 50 },
          { duration: '1m', target: 100 },
          { duration: '1m', target: 160 },
          { duration: '2m', target: 220 },
          { duration: '1m', target: 0 },
        ],
      },
      vuProfile: {
        preAllocated: 80,
        max: 240,
      },
      operationMix: {
        reads: 25,
        writes: 50,
        searchFilterSorts: 0,
        paginations: 0,
        tenantProbes: 15,
        resets: 0,
        chaos: 10,
      },
      resetSeedTarget: 'stress',
      operations: [
        bootstrapOperation(20),
        pilotOperation({
          id: 'breakpoint-grab-marketplace',
          scenario: 'grab-marketplace',
          modules: [
            'rides',
            'dispatch',
            'orders',
            'erp',
            'chat',
            'mf-remotes',
            'security',
            'billing',
          ],
          actor: 'k6.breakpoint',
          weight: 25,
          workloadProfileId: 'mixed-cross-app-journey',
          sampleSelectorIds: ['orders-checkout-surge'],
        }),
        workflowOperation({
          id: 'breakpoint-mobility-workflow',
          appId: 'mobility-marketplace',
          action: 'k6-breakpoint-checkout',
          actor: 'k6.breakpoint',
          weight: 25,
          workloadProfileId: 'write-heavy-order-ledger',
          sampleSelectorIds: ['orders-checkout-surge'],
        }),
        securityProbeOperation({
          probeId: 'acme-to-platform-denied',
          id: 'breakpoint-tenant-denied',
          sourceTenantId: 'acme-global',
          targetTenantId: 'platform-shell',
          targetAppId: 'mf-platform',
          roleId: 'finance-approver',
          action: 'admin-resource:read',
          expectedAllowed: false,
          expectedFailedCheckIds: [
            'tenant:header-matches-target',
            'tenant:app-access',
            'role:allowed-for-tenant',
          ],
          sampleSelectorIds: ['tenant-resources-drill-page'],
          weight: 15,
        }),
        failureOperation({
          mode: 'api-timeout',
          weight: 10,
          workloadProfileId: 'mixed-cross-app-journey',
        }),
        pageOperation({
          id: 'breakpoint-failure-lab-read',
          path: '/failure-lab',
          weight: 5,
          workloadProfileId: 'mixed-cross-app-journey',
          artifactLinkIds: ['workloadValidationArtifact'],
        }),
      ],
    },
    {
      id: 'mixed-read-write',
      label: 'Mixed Read Write',
      description:
        'Balanced SuperApp journey across bootstrap reads, table reads, pilot writes, workflow writes, and chat pagination.',
      k6: {
        executor: 'constant-vus',
        vus: 48,
        duration: '5m',
        gracefulStop: '20s',
      },
      operationMix: {
        reads: 28,
        writes: 50,
        searchFilterSorts: 12,
        paginations: 10,
        tenantProbes: 0,
        resets: 0,
        chaos: 0,
      },
      resetSeedTarget: 'browser',
      operations: [
        bootstrapOperation(18),
        pageOperation({
          id: 'mixed-invoice-read',
          path: '/mega-erp/procurement',
          weight: 10,
          workloadProfileId: 'mixed-cross-app-journey',
          sampleSelectorIds: ['invoices-month-close'],
        }),
        pageOperation({
          id: 'mixed-ledger-search',
          kind: 'search-filter-sort',
          path: '/mega-erp?sort=amountCents&fiscalPeriod=2026-01',
          weight: 12,
          workloadProfileId: 'search-filter-sort-ledger',
          sampleSelectorIds: ['ledger-reconciliation'],
        }),
        pageOperation({
          id: 'mixed-chat-page',
          kind: 'paginate',
          path: '/mf-platform/chat?cursor=msg-psh-04097',
          weight: 10,
          workloadProfileId: 'chat-pagination-history',
          sampleSelectorIds: ['messages-pagination-window'],
        }),
        workflowOperation({
          id: 'mixed-mobility-workflow',
          appId: 'mobility-marketplace',
          action: 'k6-mixed-checkout',
          actor: 'k6.mixed',
          weight: 16,
          workloadProfileId: 'mixed-cross-app-journey',
          sampleSelectorIds: ['orders-checkout-surge'],
        }),
        pilotOperation({
          id: 'mixed-grab-marketplace',
          scenario: 'grab-marketplace',
          modules: [
            'rides',
            'dispatch',
            'orders',
            'erp',
            'chat',
            'mf-remotes',
            'security',
            'billing',
          ],
          actor: 'k6.mixed',
          weight: 18,
          workloadProfileId: 'mixed-cross-app-journey',
          sampleSelectorIds: ['orders-checkout-surge', 'rides-rush-hour'],
        }),
        pilotOperation({
          id: 'mixed-mobility-erp-chat',
          scenario: 'mobility-erp-chat',
          modules: ['rides', 'dispatch', 'erp', 'chat', 'security', 'billing'],
          actor: 'k6.mixed',
          weight: 16,
          workloadProfileId: 'chat-pagination-history',
          sampleSelectorIds: ['chat-remote-fallback'],
        }),
      ],
    },
    {
      id: 'tenant-boundary',
      label: 'Tenant Boundary',
      description:
        'Read-only security probe workload that keeps allowed and denied tenant decisions under pressure.',
      k6: {
        executor: 'constant-vus',
        vus: 20,
        duration: '3m',
        gracefulStop: '15s',
      },
      operationMix: {
        reads: 10,
        writes: 0,
        searchFilterSorts: 0,
        paginations: 0,
        tenantProbes: 90,
        resets: 0,
        chaos: 0,
      },
      resetSeedTarget: 'contract',
      operations: [
        securityProbeOperation({
          probeId: 'security-root-audit-allowed',
          id: 'tenant-security-allowed',
          sourceTenantId: 'security-root',
          targetTenantId: 'security-root',
          targetAppId: 'tenant-security',
          roleId: 'security-admin',
          action: 'audit:read',
          expectedAllowed: true,
          expectedFailedCheckIds: [],
          sampleSelectorIds: ['audit-policy-stream'],
          weight: 35,
        }),
        securityProbeOperation({
          probeId: 'city-ops-to-security-denied',
          id: 'tenant-city-denied',
          sourceTenantId: 'city-ops-eu',
          targetTenantId: 'security-root',
          targetAppId: 'tenant-security',
          roleId: 'mobility-operator',
          action: 'role:read',
          expectedAllowed: false,
          expectedFailedCheckIds: [
            'tenant:header-matches-target',
            'tenant:app-access',
            'role:allowed-for-tenant',
          ],
          sampleSelectorIds: ['roles-privileged-page'],
          weight: 35,
        }),
        securityProbeOperation({
          probeId: 'acme-to-platform-denied',
          id: 'tenant-acme-denied',
          sourceTenantId: 'acme-global',
          targetTenantId: 'platform-shell',
          targetAppId: 'mf-platform',
          roleId: 'finance-approver',
          action: 'admin-resource:read',
          expectedAllowed: false,
          expectedFailedCheckIds: [
            'tenant:header-matches-target',
            'tenant:app-access',
            'role:allowed-for-tenant',
          ],
          sampleSelectorIds: ['tenant-resources-drill-page'],
          weight: 20,
        }),
        pageOperation({
          id: 'tenant-audit-read',
          path: '/security/audit?tenant=security-root',
          weight: 10,
          workloadProfileId: 'tenant-boundary-probes',
          sampleSelectorIds: ['audit-policy-stream'],
        }),
      ],
    },
    {
      id: 'chat',
      label: 'Chat',
      description:
        'Remote chat route churn, cursor pagination, and chat-bearing pilot writes.',
      k6: {
        executor: 'constant-vus',
        vus: 32,
        duration: '4m',
        gracefulStop: '15s',
      },
      operationMix: {
        reads: 20,
        writes: 30,
        searchFilterSorts: 0,
        paginations: 50,
        tenantProbes: 0,
        resets: 0,
        chaos: 0,
      },
      resetSeedTarget: 'browser',
      operations: [
        pageOperation({
          id: 'chat-thread-list',
          path: '/mf-platform/chat',
          weight: 20,
          workloadProfileId: 'chat-pagination-history',
          sampleSelectorIds: ['chat-remote-fallback'],
        }),
        pageOperation({
          id: 'chat-page-before',
          kind: 'paginate',
          path: '/mf-platform/chat?cursor=msg-psh-04097&direction=before',
          weight: 25,
          workloadProfileId: 'chat-pagination-history',
          sampleSelectorIds: ['messages-pagination-window'],
        }),
        pageOperation({
          id: 'chat-page-after',
          kind: 'paginate',
          path: '/mf-platform/chat?cursor=msg-psh-04098&direction=after',
          weight: 25,
          workloadProfileId: 'chat-pagination-history',
          sampleSelectorIds: ['messages-pagination-window'],
        }),
        pilotOperation({
          id: 'chat-pilot-write',
          scenario: 'mobility-erp-chat',
          modules: ['rides', 'dispatch', 'erp', 'chat', 'security', 'billing'],
          actor: 'k6.chat',
          weight: 20,
          workloadProfileId: 'chat-pagination-history',
          sampleSelectorIds: ['chat-remote-fallback'],
        }),
        workflowOperation({
          id: 'chat-mf-workflow',
          appId: 'mf-platform',
          action: 'k6-chat-marker',
          actor: 'k6.chat',
          weight: 10,
          workloadProfileId: 'chat-pagination-history',
          sampleSelectorIds: ['chat-remote-fallback'],
        }),
      ],
    },
    {
      id: 'reset',
      label: 'Reset',
      description:
        'Short deterministic reset/seed pressure that validates reset paths without managing external processes.',
      k6: {
        executor: 'shared-iterations',
        vus: 8,
        iterations: 24,
        maxDuration: '2m',
      },
      operationMix: {
        reads: 30,
        writes: 0,
        searchFilterSorts: 0,
        paginations: 0,
        tenantProbes: 0,
        resets: 70,
        chaos: 0,
      },
      resetSeedTarget: 'contract',
      operations: [
        resetOperation(60),
        bootstrapOperation(30),
        pageOperation({
          id: 'reset-security-read',
          path: '/security/audit?tenant=security-root',
          weight: 10,
          workloadProfileId: 'tenant-boundary-probes',
          artifactLinkIds: resetArtifacts,
          sampleSelectorIds: ['audit-policy-stream'],
        }),
      ],
    },
    {
      id: 'chaos-triggering',
      label: 'Chaos Triggering',
      description:
        'Triggers deterministic failure modes and chaos-bearing pilot runs without restarting external processes.',
      k6: {
        executor: 'constant-vus',
        vus: 24,
        duration: '3m',
        gracefulStop: '20s',
      },
      operationMix: {
        reads: 10,
        writes: 35,
        searchFilterSorts: 0,
        paginations: 0,
        tenantProbes: 0,
        resets: 5,
        chaos: 50,
      },
      resetSeedTarget: 'chaos',
      operations: [
        bootstrapOperation(10),
        failureOperation({
          mode: 'remote-down',
          weight: 20,
          workloadProfileId: 'mixed-cross-app-journey',
        }),
        failureOperation({
          mode: 'api-timeout',
          weight: 15,
          workloadProfileId: 'mixed-cross-app-journey',
        }),
        failureOperation({
          mode: 'chunk-404',
          weight: 15,
          workloadProfileId: 'mixed-cross-app-journey',
        }),
        pilotOperation({
          id: 'chaos-grab-remote-down',
          kind: 'chaos',
          scenario: 'grab-marketplace',
          modules: [
            'rides',
            'dispatch',
            'orders',
            'erp',
            'chat',
            'mf-remotes',
            'security',
            'billing',
          ],
          chaos: 'remote-down',
          actor: 'k6.chaos-triggering',
          weight: 20,
          workloadProfileId: 'mixed-cross-app-journey',
          sampleSelectorIds: ['orders-checkout-surge'],
        }),
        pilotOperation({
          id: 'chaos-erp-clock-skew',
          kind: 'chaos',
          scenario: 'mega-erp-command-center',
          modules: [
            'orders',
            'erp',
            'chat',
            'mf-remotes',
            'security',
            'billing',
          ],
          chaos: 'clock-skew',
          actor: 'k6.chaos-triggering',
          weight: 15,
          workloadProfileId: 'write-heavy-order-ledger',
          sampleSelectorIds: ['ledger-reconciliation'],
        }),
        resetOperation(5),
      ],
    },
  ];

  const scenarioById = new Map(
    SCENARIOS.map(scenario => [scenario.id, scenario]),
  );

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getScenarioCatalog() {
    return clone({
      schemaVersion: 1,
      catalogId: 'superapp-k6-scenarios-v1',
      defaultScenarioScript: DEFAULT_SCENARIO_SCRIPT,
      requiredScenarioIds: REQUIRED_SCENARIO_IDS,
      artifactLinks: ARTIFACT_LINKS,
      thresholdProfiles: getLoadThresholdProfiles(),
      scenarios: SCENARIOS,
    });
  }

  function getScenarioIds() {
    return SCENARIOS.map(scenario => scenario.id);
  }

  function getArtifactLinks() {
    return clone(ARTIFACT_LINKS);
  }

  function getLoadThresholdProfiles() {
    return clone({
      schemaVersion: 1,
      defaultProfileId: DEFAULT_LOAD_THRESHOLD_PROFILE,
      profiles: LOAD_THRESHOLD_PROFILE_IDS.map(id => K6_THRESHOLD_PROFILES[id]),
    });
  }

  function normalizeLoadThresholdProfile(profile) {
    const normalized = String(profile || DEFAULT_LOAD_THRESHOLD_PROFILE)
      .trim()
      .toLowerCase();
    if (!K6_THRESHOLD_PROFILES[normalized]) {
      throw new Error(
        `Unknown SuperApp load threshold profile "${profile}". Use one of: ${LOAD_THRESHOLD_PROFILE_IDS.join(
          ', ',
        )}`,
      );
    }
    return normalized;
  }

  function getLoadThresholdProfileDefinition(profile) {
    return clone(K6_THRESHOLD_PROFILES[normalizeLoadThresholdProfile(profile)]);
  }

  function getScenarioIdsForThresholdProfile(profile) {
    return getLoadThresholdProfileDefinition(profile).scenarioIds;
  }

  function getScenarioDefinition(id) {
    const scenario = scenarioById.get(id);
    if (!scenario) {
      throw new Error(`Unknown SuperApp k6 scenario: ${id}`);
    }
    return clone(scenario);
  }

  function normalizeScenarioSelection(selection) {
    const rawSelection = Array.isArray(selection)
      ? selection
      : String(selection || 'smoke').split(',');
    const normalized = rawSelection
      .map(item => String(item).trim())
      .filter(Boolean);

    if (normalized.length === 0 || normalized.includes('all')) {
      return getScenarioIds();
    }

    for (const id of normalized) {
      if (!scenarioById.has(id)) {
        throw new Error(
          `Unknown SuperApp k6 scenario "${id}". Use one of: ${getScenarioIds().join(
            ', ',
          )}, all`,
        );
      }
    }

    return [...new Set(normalized)];
  }

  function buildK6ScenariosForSelection(selection) {
    const scenarioIds = normalizeScenarioSelection(selection);
    return Object.fromEntries(
      scenarioIds.map(id => {
        const scenario = scenarioById.get(id);
        return [
          id,
          {
            ...clone(scenario.k6),
            exec: 'workload',
            tags: {
              superapp_scenario: id,
              superapp_reset_seed_target: scenario.resetSeedTarget,
            },
          },
        ];
      }),
    );
  }

  function buildK6OptionsForScenarios(
    selection,
    thresholdProfile = DEFAULT_LOAD_THRESHOLD_PROFILE,
  ) {
    const profile = getLoadThresholdProfileDefinition(thresholdProfile);
    const options = {
      summaryTrendStats: [
        'avg',
        'min',
        'med',
        'p(90)',
        'p(95)',
        'p(99)',
        'max',
      ],
      scenarios: buildK6ScenariosForSelection(selection),
      ext: {
        superapp: {
          thresholdProfile: {
            id: profile.id,
            label: profile.label,
            defaultPrCost: profile.defaultPrCost,
            certification: profile.certification,
          },
        },
      },
    };
    if (Object.keys(profile.thresholds).length > 0) {
      options.thresholds = profile.thresholds;
    }
    return options;
  }

  function selectWeightedOperation(scenario, iteration) {
    const totalWeight = scenario.operations.reduce(
      (sum, operation) => sum + operation.weight,
      0,
    );
    const cursor = (Math.abs(iteration) % totalWeight) + 1;
    let floor = 0;
    for (const operation of scenario.operations) {
      floor += operation.weight;
      if (cursor <= floor) {
        return operation;
      }
    }
    return scenario.operations[scenario.operations.length - 1];
  }

  function validateScenarioCatalog(catalog = getScenarioCatalog()) {
    const ids = new Set(catalog.scenarios.map(scenario => scenario.id));
    const errors = [];

    for (const requiredId of REQUIRED_SCENARIO_IDS) {
      if (!ids.has(requiredId)) {
        errors.push(`Missing required scenario: ${requiredId}`);
      }
    }

    for (const profile of Object.values(K6_THRESHOLD_PROFILES)) {
      for (const scenarioId of profile.scenarioIds) {
        if (!ids.has(scenarioId)) {
          errors.push(
            `${profile.id} threshold profile references missing scenario: ${scenarioId}`,
          );
        }
      }
      if (profile.defaultPrCost.addsLoadToSmokeCertification !== false) {
        errors.push(
          `${profile.id} threshold profile must declare no smoke certification cost increase`,
        );
      }
      for (const [metric, thresholds] of Object.entries(profile.thresholds)) {
        if (!metric || !Array.isArray(thresholds) || thresholds.length === 0) {
          errors.push(
            `${profile.id} threshold profile has invalid thresholds for ${metric}`,
          );
        }
      }
    }

    if (ids.size !== catalog.scenarios.length) {
      errors.push('Scenario ids must be unique');
    }

    for (const scenario of catalog.scenarios) {
      if (!scenario.k6 || !scenario.k6.executor) {
        errors.push(`${scenario.id} must declare a k6 executor`);
      }

      const hasDuration =
        Boolean(scenario.k6.duration) ||
        Boolean(scenario.k6.maxDuration) ||
        Array.isArray(scenario.k6.stages);
      if (!hasDuration) {
        errors.push(
          `${scenario.id} must declare duration, maxDuration, or stages`,
        );
      }

      const hasVuMetadata =
        Number.isFinite(scenario.k6.vus) ||
        Number.isFinite(scenario.k6.maxVUs) ||
        Boolean(scenario.vuProfile) ||
        scenario.k6.executor.includes('arrival-rate');
      if (!hasVuMetadata) {
        errors.push(`${scenario.id} must declare VU or arrival-rate metadata`);
      }

      const operationWeight = scenario.operations.reduce(
        (sum, operation) => sum + operation.weight,
        0,
      );
      if (operationWeight !== 100) {
        errors.push(`${scenario.id} operation weights must sum to 100`);
      }

      const mixTotal = Object.values(scenario.operationMix).reduce(
        (sum, value) => sum + value,
        0,
      );
      if (mixTotal !== 100) {
        errors.push(`${scenario.id} operation mix must sum to 100`);
      }

      for (const operation of scenario.operations) {
        if (!operation.id) {
          errors.push(`${scenario.id} has an operation without an id`);
        }
        if (!operation.method || !operation.path) {
          errors.push(
            `${scenario.id}:${operation.id} must declare method and path`,
          );
        }
        if (!Number.isFinite(operation.weight) || operation.weight <= 0) {
          errors.push(
            `${scenario.id}:${operation.id} must declare a positive weight`,
          );
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `Invalid SuperApp k6 scenario catalog:\n${errors.join('\n')}`,
      );
    }

    return true;
  }

  const api = {
    DEFAULT_LOAD_THRESHOLD_PROFILE,
    DEFAULT_SCENARIO_SCRIPT,
    LOAD_THRESHOLD_PROFILE_IDS,
    REQUIRED_SCENARIO_IDS,
    buildK6OptionsForScenarios,
    buildK6ScenariosForSelection,
    getArtifactLinks,
    getLoadThresholdProfileDefinition,
    getLoadThresholdProfiles,
    getScenarioCatalog,
    getScenarioDefinition,
    getScenarioIds,
    getScenarioIdsForThresholdProfile,
    normalizeLoadThresholdProfile,
    normalizeScenarioSelection,
    selectWeightedOperation,
    validateScenarioCatalog,
  };

  root.SUPERAPP_K6_CATALOG = getScenarioCatalog();
  root.SUPERAPP_K6_CATALOG_API = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
