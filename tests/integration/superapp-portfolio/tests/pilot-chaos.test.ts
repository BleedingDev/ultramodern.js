import dns from 'node:dns';
import path from 'node:path';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import { createPortfolioMetrics } from './portfolioMetrics';

dns.setDefaultResultOrder('ipv4first');
setSuiteTimeout(1000 * 60 * 15);

const appDir = path.resolve(__dirname, '../');
const enabled = process.env.SUPERAPP_PILOT_CHAOS === '1';
const externalBaseUrl = (
  process.env.SUPERAPP_PILOT_CHAOS_BASE_URL ??
  process.env.SUPERAPP_DESTROY_BASE_URL ??
  ''
).replace(/\/+$/, '');
const artifactDir =
  process.env.SUPERAPP_PILOT_CHAOS_ARTIFACT_DIR ??
  '/tmp/modernjs-superapp-pilot-chaos';

const fullModuleSet = [
  'rides',
  'dispatch',
  'orders',
  'erp',
  'chat',
  'mf-remotes',
  'security',
  'billing',
];

const productionScenarios = [
  {
    scenario: 'grab-marketplace',
    label: 'Grab-style Marketplace Surge',
    modules: fullModuleSet,
    workflowEvents: 8,
    approvals: 2,
    checks: 13,
  },
  {
    scenario: 'mega-erp-command-center',
    label: 'Enterprise MegaERP Command Center',
    modules: ['orders', 'erp', 'chat', 'mf-remotes', 'security', 'billing'],
    workflowEvents: 6,
    approvals: 2,
    checks: 13,
  },
  {
    scenario: 'mobility-erp-chat',
    label: 'Mobility Incident To ERP Chat Escalation',
    modules: ['rides', 'dispatch', 'erp', 'chat', 'security', 'billing'],
    workflowEvents: 6,
    approvals: 1,
    checks: 12,
  },
];

async function postJson(baseUrl: string, pathname: string, body?: unknown) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function getBootstrap(baseUrl: string) {
  const response = await fetch(`${baseUrl}/bff-api/effect/bootstrap`);
  expect(response.status).toBe(200);
  return response.json();
}

async function resetPortfolio(baseUrl: string) {
  const response = await postJson(baseUrl, '/bff-api/effect/reset');
  expect(response.status).toBe(200);
  return response.json();
}

async function runPilot(
  baseUrl: string,
  requestId: string,
  overrides: Record<string, unknown> = {},
) {
  const scenario = String(overrides.scenario ?? 'grab-marketplace');
  const { scenario: _scenario, ...payloadOverrides } = overrides;

  return postJson(baseUrl, `/bff-api/effect/pilot/${scenario}/run`, {
    tenant: 'superapp-global',
    actor: 'overnight.pilot',
    requestId,
    modules: fullModuleSet,
    chaos: 'none',
    ...payloadOverrides,
  });
}

async function expectRejectedWithoutStateDrift(input: {
  baseUrl: string;
  id: string;
  pathname: string;
  body?: unknown;
}) {
  const before = await getBootstrap(input.baseUrl);
  const response = await postJson(input.baseUrl, input.pathname, input.body);
  expect(response.status).toBeGreaterThanOrEqual(400);
  const after = await getBootstrap(input.baseUrl);
  expect(after).toEqual(before);
  return {
    id: input.id,
    status: response.status,
  };
}

(enabled ? describe : describe.skip)(
  'superapp complex pilot chaos certification',
  () => {
    let baseUrl: string;
    let app: Awaited<ReturnType<typeof modernServe>> | undefined;

    beforeAll(async () => {
      if (externalBaseUrl) {
        baseUrl = externalBaseUrl;
        return;
      }

      const build = await modernBuild(appDir);
      expect(build.code).toBe(0);
      const port = await getPort();
      baseUrl = `http://localhost:${port}`;
      app = await modernServe(appDir, port, {
        cwd: appDir,
        stderr: false,
        stdout: false,
      });
    });

    afterAll(async () => {
      await killApp(app);
    });

    test('survives complex SuperApp workflows, idempotency storms, chaos, and invalid-request drift probes', async () => {
      const metrics = createPortfolioMetrics({
        suite: 'superapp-portfolio-pilot-chaos',
        outputDir: artifactDir,
      });
      const checks: Array<Record<string, unknown>> = [];

      await metrics.timed('reset:initial', () => resetPortfolio(baseUrl));
      const acceptedResponse = await metrics.timed('pilot:accepted', () =>
        runPilot(baseUrl, 'pilot-main-1'),
      );
      expect(acceptedResponse.status).toBe(200);
      const accepted = await acceptedResponse.json();
      expect(accepted.run).toMatchObject({
        requestId: 'pilot-main-1',
        scenario: 'grab-marketplace',
        tenant: 'superapp-global',
        status: 'accepted',
        chaos: 'none',
      });
      expect(accepted.run.moduleResults).toHaveLength(fullModuleSet.length);
      expect(
        accepted.run.moduleResults.every((item: { ok: boolean }) => item.ok),
      ).toBe(true);
      expect(accepted.run.summary).toMatchObject({
        workflowEvents: fullModuleSet.length,
        chatMessages: 1,
        approvals: 2,
        securityChecks: 1,
        degradedModules: 0,
      });
      checks.push({
        id: 'pilot:full-module-contract',
        modules: accepted.run.moduleResults.map(
          (item: { module: string }) => item.module,
        ),
      });

      for (const scenario of productionScenarios) {
        await metrics.timed(`reset:scenario:${scenario.scenario}`, () =>
          resetPortfolio(baseUrl),
        );
        const response = await metrics.timed(
          `pilot:scenario:${scenario.scenario}`,
          () =>
            runPilot(baseUrl, `scenario-${scenario.scenario}`, {
              scenario: scenario.scenario,
              modules: scenario.modules,
            }),
        );
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.run).toMatchObject({
          scenario: scenario.scenario,
          scenarioLabel: scenario.label,
          tenant: 'superapp-global',
          status: 'accepted',
          chaos: 'none',
          summary: {
            workflowEvents: scenario.workflowEvents,
            chatMessages: 1,
            approvals: scenario.approvals,
            securityChecks: 1,
            degradedModules: 0,
          },
        });
        expect(payload.run.moduleResults).toHaveLength(scenario.modules.length);
        expect(payload.run.productionChecks).toHaveLength(scenario.checks);
        checks.push({
          id: `pilot:scenario:${scenario.scenario}`,
          modules: scenario.modules,
          productionChecks: payload.run.productionChecks.length,
        });
      }

      await metrics.timed('reset:after:production-scenarios', () =>
        resetPortfolio(baseUrl),
      );
      const duplicateSeed = await metrics.timed('pilot:duplicate-seed', () =>
        runPilot(baseUrl, 'pilot-main-1'),
      );
      expect(duplicateSeed.status).toBe(200);
      const duplicateResponses = await metrics.timed(
        'pilot:idempotency-storm',
        () =>
          Promise.all(
            Array.from({ length: 20 }, () => runPilot(baseUrl, 'pilot-main-1')),
          ),
      );
      expect(
        duplicateResponses.every(response => response.status === 200),
      ).toBe(true);
      const duplicatePayloads = await Promise.all(
        duplicateResponses.map(response => response.json()),
      );
      expect(
        duplicatePayloads.every(payload => payload.run.status === 'deduped'),
      ).toBe(true);
      const afterDuplicates = await getBootstrap(baseUrl);
      expect(afterDuplicates.summary.eventCount).toBe(fullModuleSet.length);
      checks.push({
        id: 'pilot:idempotency-storm',
        duplicateCount: duplicatePayloads.length,
      });

      for (const chaos of [
        'remote-down',
        'api-timeout',
        'chunk-404',
        'clock-skew',
        'restart-during-load',
      ]) {
        const response = await metrics.timed(`pilot:chaos:${chaos}`, () =>
          runPilot(baseUrl, `pilot-${chaos}`, { chaos }),
        );
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.run.chaos).toBe(chaos);
        expect(payload.run.summary.degradedModules).toBeGreaterThan(0);
        expect(
          payload.run.moduleResults.some(
            (item: { degraded: boolean }) => item.degraded,
          ),
        ).toBe(true);
        if (chaos === 'api-timeout') {
          expect(
            payload.run.moduleResults.some(
              (item: { module: string; ok: boolean }) =>
                item.module === 'erp' && !item.ok,
            ),
          ).toBe(true);
        } else {
          expect(
            payload.run.moduleResults.every((item: { ok: boolean }) => item.ok),
          ).toBe(true);
        }
        await metrics.timed(`reset:after:${chaos}`, () =>
          resetPortfolio(baseUrl),
        );
        const recovered = await getBootstrap(baseUrl);
        expect(recovered.summary).toMatchObject({
          eventCount: 0,
          failureMode: 'healthy',
        });
        checks.push({
          id: `pilot:chaos:${chaos}`,
          degradedModules: payload.run.summary.degradedModules,
        });
      }

      checks.push(
        await expectRejectedWithoutStateDrift({
          baseUrl,
          id: 'pilot:reject:tenant-module-boundary',
          pathname: '/bff-api/effect/pilot/mobility-erp-chat/run',
          body: {
            tenant: 'city-ops-eu',
            actor: 'overnight.pilot',
            requestId: 'bad-tenant-boundary',
            modules: ['rides', 'erp'],
            chaos: 'none',
          },
        }),
      );
      checks.push(
        await expectRejectedWithoutStateDrift({
          baseUrl,
          id: 'pilot:reject:unknown-tenant',
          pathname: '/bff-api/effect/pilot/mobility-erp-chat/run',
          body: {
            tenant: 'missing-tenant',
            actor: 'overnight.pilot',
            requestId: 'bad-tenant',
            modules: ['rides'],
            chaos: 'none',
          },
        }),
      );

      const beforeMalformed = await getBootstrap(baseUrl);
      const malformed = await fetch(
        `${baseUrl}/bff-api/effect/pilot/grab-marketplace/run`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: '{',
        },
      );
      expect(malformed.status).toBeGreaterThanOrEqual(400);
      const afterMalformed = await getBootstrap(baseUrl);
      expect(afterMalformed).toEqual(beforeMalformed);
      checks.push({
        id: 'pilot:reject:malformed-json',
        status: malformed.status,
      });

      const summary = metrics.write({
        checkCount: checks.length,
        failedCount: 0,
        checks,
      });
      expect(summary.unexpectedErrorCount).toBe(0);
    });
  },
);
