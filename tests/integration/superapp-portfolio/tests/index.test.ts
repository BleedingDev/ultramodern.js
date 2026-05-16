import { execSync } from 'node:child_process';
import dns from 'node:dns';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchOptions,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

dns.setDefaultResultOrder('ipv4first');
setSuiteTimeout(1000 * 60 * 8);

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const browserLaunchOptions = launchOptions as Parameters<
  typeof puppeteer.launch
>[0];

function captureBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', error => {
    errors.push(error instanceof Error ? error.message : String(error));
  });
  return errors;
}

async function postJson(port: number, pathname: string, body?: unknown) {
  return fetch(`${host}:${port}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function getBootstrap(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/effect/bootstrap`);
  expect(response.status).toBe(200);
  return response.json();
}

async function resetPortfolio(port: number) {
  const response = await postJson(port, '/bff-api/effect/reset');
  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload).toMatchObject({
    ok: true,
    workloadResetSeedMetadata: {
      resetVersion: 'superapp-workload-reset-seed-v1',
      resetSeed: 'superapp-portfolio-reset-seed-v1',
    },
    summary: {
      appCount: 5,
      highRiskApps: 3,
      eventCount: 0,
      failureMode: 'healthy',
    },
  });
}

async function expectEffectPortfolioContracts(port: number) {
  await resetPortfolio(port);

  const openApiResponse = await fetch(`${host}:${port}/bff-api/openapi.json`);
  expect(openApiResponse.status).toBe(200);
  const openApi = await openApiResponse.json();
  expect(openApi.paths['/effect/bootstrap']).toBeDefined();
  expect(openApi.paths['/effect/apps/{appId}/workflow']).toBeDefined();
  expect(openApi.paths['/effect/pilot/{scenario}/run']).toBeDefined();
  expect(openApi.paths['/effect/failure/{mode}']).toBeDefined();

  const bootstrap = await getBootstrap(port);
  expect(bootstrap.summary).toMatchObject({
    appCount: 5,
    highRiskApps: 3,
    totalOpenWork: 272,
    eventCount: 0,
    failureMode: 'healthy',
  });
  expect(bootstrap.apps.map((app: { id: string }) => app.id)).toEqual([
    'mobility-marketplace',
    'enterprise-mega-erp',
    'mf-platform',
    'tenant-security',
    'failure-lab',
  ]);
  expect(
    bootstrap.pilotScenarios.map((item: { scenario: string }) => item.scenario),
  ).toEqual([
    'grab-marketplace',
    'mega-erp-command-center',
    'mobility-erp-chat',
  ]);
  expect(bootstrap.pilotScenarios[0]).toMatchObject({
    label: 'Grab-style Marketplace Surge',
    tenant: 'superapp-global',
    workflows: expect.arrayContaining([
      'price quote idempotency under burst traffic',
    ]),
    invariants: expect.arrayContaining([
      'quote request id remains idempotent across retries',
    ]),
  });
  expect(bootstrap.workloadCatalog).toMatchObject({
    catalogVersion: 'superapp-workload-data-v1',
    seed: 'superapp-portfolio-workload-data-v1',
    clockStartIso: '2026-01-15T08:00:00.000Z',
    requestIdPrefix: 'swl-v1',
  });
  expect(bootstrap.workloadData).toMatchObject({
    datasetVersion: 'superapp-generated-workload-v1',
    seed: 'superapp-portfolio-generated-workload-v1',
    clockStartIso: '2026-01-15T08:00:00.000Z',
    metadata: {
      totalRecords: 106960,
      totals: {
        orders: 6300,
        invoices: 4650,
        ledgerEntries: 11200,
        rides: 6300,
        dispatchAssignments: 6300,
        fleetVehicles: 1970,
        chatThreads: 3100,
        messages: 31000,
        auditEvents: 23000,
        users: 3060,
        roles: 1260,
        memberships: 6220,
        tenantResources: 2600,
      },
    },
    helperIds: {
      stableRecords: {
        orderId: 'ord-coe-01025',
        messageId: 'msg-psh-04097',
        auditEventId: 'aud-sec-02049',
      },
    },
  });
  expect(
    bootstrap.workloadData.samples.orders.map(
      (record: { id: string }) => record.id,
    ),
  ).toEqual([
    'ord-coe-01025',
    'ord-coe-01026',
    'ord-coe-01027',
    'ord-coe-01028',
  ]);
  expect(
    Object.values(bootstrap.workloadData.samples).reduce(
      (sum: number, records) => sum + (records as unknown[]).length,
      0,
    ),
  ).toBe(52);
  expect(bootstrap.workloadScenarioProfileMetadata).toMatchObject({
    profileVersion: 'superapp-workload-scenario-profiles-v1',
    seed: 'superapp-portfolio-scenario-profiles-v1',
    categories: [
      'read-heavy',
      'write-heavy',
      'mixed',
      'search-filter-sort',
      'chat-pagination',
      'tenant-boundary',
    ],
    helperMetadata: {
      profileCount: 6,
      tenantBoundaryProfileId: 'tenant-boundary-probes',
    },
  });
  expect(bootstrap.workloadResetSeedMetadata).toMatchObject({
    resetVersion: 'superapp-workload-reset-seed-v1',
    resetSeed: 'superapp-portfolio-reset-seed-v1',
    catalogSeed: 'superapp-portfolio-workload-data-v1',
    generatedSeed: 'superapp-portfolio-generated-workload-v1',
    scenarioProfileSeed: 'superapp-portfolio-scenario-profiles-v1',
    clockStartIso: '2026-01-15T08:00:00.000Z',
    clockStepMs: 17000,
    eventIdPrefix: 'evt',
    pilotRunIdPrefix: 'pilot',
    helperIds: {
      stableRecords: {
        orderId: 'ord-coe-01025',
        messageId: 'msg-psh-04097',
        auditEventId: 'aud-sec-02049',
      },
    },
    defaultSeeds: {
      stress: {
        target: 'stress',
        scenarioId: 'marketplace-surge-to-ledger',
        profileId: 'read-heavy-command-center',
        tenantId: 'city-ops-eu',
      },
      chaos: {
        target: 'chaos',
        scenarioId: 'fleet-incident-refund',
        profileId: 'write-heavy-order-ledger',
        tenantId: 'city-ops-eu',
      },
      browser: {
        target: 'browser',
        scenarioId: 'marketplace-surge-to-ledger',
        profileId: 'mixed-cross-app-journey',
        tenantId: 'city-ops-eu',
      },
      contract: {
        target: 'contract',
        scenarioId: 'tenant-boundary-audit',
        profileId: 'tenant-boundary-probes',
        tenantId: 'security-root',
      },
    },
  });
  expect(
    bootstrap.workloadResetSeedMetadata.sampleWindows.map(
      (window: { id: string }) => window.id,
    ),
  ).toEqual(Object.values(bootstrap.workloadData.helperIds.sampleWindows));
  expect(
    bootstrap.workloadResetSeedMetadata.defaultSeeds.browser.sampleRecordIds,
  ).toEqual([
    'rid-coe-01501',
    'rid-coe-01502',
    'ord-coe-01025',
    'ord-coe-01026',
    'inv-acm-00513',
    'inv-acm-00514',
    'led-acm-02049',
    'led-acm-02050',
    'thd-psh-00065',
    'thd-psh-00066',
    'msg-psh-04097',
    'msg-psh-04098',
    'aud-sec-02049',
    'aud-sec-02050',
  ]);
  expect(bootstrap.workloadCatalog.helperMetadata.domainIds).toEqual([
    'erp-finance',
    'dispatch-mobility',
    'marketplace-orders',
    'fleet-mobility',
    'chat-threads',
    'audit-events',
    'users-roles',
    'admin-operations',
  ]);
  expect(
    bootstrap.workloadCatalog.tenants.map(
      (tenant: { id: string }) => tenant.id,
    ),
  ).toEqual([
    'superapp-global',
    'city-ops-eu',
    'acme-global',
    'platform-shell',
    'security-root',
    'chaos-lab',
  ]);
  const financeDomain = bootstrap.workloadCatalog.domains.find(
    (domain: { id: string }) => domain.id === 'erp-finance',
  );
  expect(financeDomain).toMatchObject({
    ownerAppId: 'enterprise-mega-erp',
    modules: expect.arrayContaining(['erp', 'billing']),
    workflows: expect.arrayContaining([
      'marketplace settlement reconciliation',
    ]),
    invariants: expect.arrayContaining([
      'approval count matches emitted finance audit events',
    ]),
    consistency: 'strong',
  });
  expect(
    bootstrap.workloadCatalog.domains.every(
      (domain: { workflows: string[]; invariants: string[] }) =>
        domain.workflows.length >= 3 && domain.invariants.length >= 3,
    ),
  ).toBe(true);
  expect(
    bootstrap.workloadCatalog.scenarios.map(
      (scenario: { id: string }) => scenario.id,
    ),
  ).toEqual([
    'marketplace-surge-to-ledger',
    'fleet-incident-refund',
    'erp-close-admin-rotation',
    'tenant-boundary-audit',
  ]);
  const surgeScenario = bootstrap.workloadCatalog.scenarios.find(
    (scenario: { id: string }) => scenario.id === 'marketplace-surge-to-ledger',
  );
  expect(surgeScenario).toMatchObject({
    tenantId: 'superapp-global',
    domains: expect.arrayContaining([
      'dispatch-mobility',
      'marketplace-orders',
      'erp-finance',
      'chat-threads',
      'audit-events',
    ]),
  });
  expect(surgeScenario).toBeDefined();
  expect(
    (
      surgeScenario as { operations: Array<{ requestId: string }> }
    ).operations.map((operation: { requestId: string }) => operation.requestId),
  ).toEqual([
    'swl-v1-surge-quote-001',
    'swl-v1-surge-order-001',
    'swl-v1-surge-ledger-001',
    'swl-v1-surge-chat-001',
  ]);
  expect(
    bootstrap.workloadCatalog.adminOperations.map(
      (operation: { id: string }) => operation.id,
    ),
  ).toEqual([
    'admin-role-grant-support-lead',
    'admin-rotate-remote-manifest',
    'admin-token-quarantine',
    'admin-failure-drill-reset',
  ]);
  for (const app of bootstrap.apps) {
    expect(app.profiles.smoke.workflows.length).toBeGreaterThanOrEqual(3);
    expect(app.profiles.stress.concurrency).toBeGreaterThanOrEqual(8);
    expect(app.profiles.nightly.durationMs).toBeGreaterThanOrEqual(
      1000 * 60 * 60,
    );
  }

  const workflow = await postJson(
    port,
    '/bff-api/effect/apps/mobility-marketplace/workflow',
    {
      action: 'quote',
      actor: 'ops.commander',
      requestId: 'req-mobility-1',
    },
  );
  expect(workflow.status).toBe(200);
  await expect(workflow.json()).resolves.toMatchObject({
    event: {
      id: 'evt-1',
      appId: 'mobility-marketplace',
      action: 'quote',
      status: 'accepted',
    },
    summary: {
      eventCount: 1,
    },
  });

  const deduped = await postJson(
    port,
    '/bff-api/effect/apps/mobility-marketplace/workflow',
    {
      action: 'quote',
      actor: 'ops.commander',
      requestId: 'req-mobility-1',
    },
  );
  expect(deduped.status).toBe(200);
  await expect(deduped.json()).resolves.toMatchObject({
    event: {
      id: 'evt-1',
      status: 'deduped',
    },
    summary: {
      eventCount: 1,
    },
  });

  const failure = await postJson(port, '/bff-api/effect/failure/remote-down', {
    actor: 'failure.operator',
    reason: 'verify deterministic fallback lane',
  });
  expect(failure.status).toBe(200);
  await expect(failure.json()).resolves.toMatchObject({
    failureMode: 'remote-down',
    summary: {
      failureMode: 'remote-down',
      eventCount: 2,
    },
  });

  await resetPortfolio(port);
  const pilot = await postJson(
    port,
    '/bff-api/effect/pilot/grab-marketplace/run',
    {
      tenant: 'superapp-global',
      actor: 'ops.pilot',
      requestId: 'pilot-contract-1',
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
      chaos: 'none',
    },
  );
  expect(pilot.status).toBe(200);
  await expect(pilot.json()).resolves.toMatchObject({
    run: {
      requestId: 'pilot-contract-1',
      scenario: 'grab-marketplace',
      scenarioLabel: 'Grab-style Marketplace Surge',
      tenant: 'superapp-global',
      status: 'accepted',
      chaos: 'none',
      summary: {
        workflowEvents: 8,
        chatMessages: 1,
        approvals: 2,
        securityChecks: 1,
        degradedModules: 0,
      },
    },
    summary: {
      eventCount: 8,
      failureMode: 'healthy',
    },
  });
}

async function expectInvalidRequestsDoNotDrift(port: number) {
  await resetPortfolio(port);
  const before = await getBootstrap(port);

  const invalidWorkflow = await postJson(
    port,
    '/bff-api/effect/apps/unknown-app/workflow',
    {
      action: 'quote',
      actor: 'ops.commander',
      requestId: 'invalid-1',
    },
  );
  expect(invalidWorkflow.status).toBeGreaterThanOrEqual(400);

  const malformed = await fetch(
    `${host}:${port}/bff-api/effect/apps/mobility-marketplace/workflow`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{',
    },
  );
  expect(malformed.status).toBeGreaterThanOrEqual(400);

  const after = await getBootstrap(port);
  expect(after.summary).toEqual(before.summary);
  expect(after.events).toEqual(before.events);
  expect(after.apps).toEqual(before.apps);
}

describe('superapp portfolio fixture', () => {
  let port: number;
  let app: Awaited<ReturnType<typeof modernServe>> | undefined;
  let browser: Browser | undefined;

  beforeAll(async () => {
    execSync('pnpm tsgo --noEmit', {
      cwd: appDir,
      stdio: 'inherit',
    });
    const build = await modernBuild(appDir);
    expect(build.code).toBe(0);
    port = await getPort();
    app = await modernServe(appDir, port, {
      cwd: appDir,
      stderr: false,
      stdout: false,
    });
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
    await killApp(app);
  });

  test('serves Effect portfolio contracts and profile metadata', async () => {
    await expectEffectPortfolioContracts(port);
  });

  test('rejects invalid portfolio requests without state drift', async () => {
    await expectInvalidRequestsDoNotDrift(port);
  });

  test('renders TanStack portfolio routes without browser errors', async () => {
    browser = await puppeteer.launch(browserLaunchOptions);
    const page = await browser.newPage();
    const errors = captureBrowserErrors(page);

    await page.goto(`${host}:${port}`, {
      waitUntil: ['domcontentloaded', 'networkidle0'],
    });
    await page.waitForSelector('[data-testid="portfolio-ready"]');
    await page.waitForSelector('[data-testid="pilot-command-center"]');
    await expect(
      page.$eval(
        '[data-testid="pilot-scenario-plan"]',
        element => element.textContent,
      ),
    ).resolves.toContain('Grab-style Marketplace Surge');
    await expect(
      page.$eval(
        '[data-testid="summary-apps"]',
        element => element.textContent,
      ),
    ).resolves.toBe('apps:5');

    await page.select('[data-testid="pilot-chaos"]', 'api-timeout');
    await page.click('[data-testid="run-pilot"]');
    await expect(
      page.waitForFunction(() =>
        document
          .querySelector('[data-testid="pilot-status"]')
          ?.textContent?.includes(
            'Grab-style Marketplace Surge:accepted:api-timeout',
          ),
      ),
    ).resolves.toBeTruthy();
    await expect(
      page.$eval(
        '[data-testid="pilot-module-erp"]',
        element => element.textContent,
      ),
    ).resolves.toContain('failed:degraded');
    await expect(
      page.$eval(
        '[data-testid="pilot-summary"]',
        element => element.textContent,
      ),
    ).resolves.toContain('degraded:1');
    await expect(
      page.$eval(
        '[data-testid="pilot-production-checks"]',
        element => element.textContent,
      ),
    ).resolves.toContain('checks:13');
    await page.click('[data-testid="reset-pilot"]');
    await expect(
      page.waitForFunction(() =>
        document
          .querySelector('[data-testid="pilot-status"]')
          ?.textContent?.includes('idle'),
      ),
    ).resolves.toBeTruthy();

    await page.click('[data-testid="nav-mobility"]');
    await page.waitForSelector('[data-testid="portfolio-app-page"]');
    await expect(
      page.$eval(
        '[data-testid="app-route-kind"]',
        element => element.textContent,
      ),
    ).resolves.toBe('mobility');
    await page.click('[data-testid="run-workflow"]');
    await expect(
      page.waitForFunction(() =>
        document
          .querySelector('[data-testid="workflow-event"]')
          ?.textContent?.includes('evt-1:accepted'),
      ),
    ).resolves.toBeTruthy();

    expect(errors).toEqual([]);
  });
});
