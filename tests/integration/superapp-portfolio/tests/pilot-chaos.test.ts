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
const host = 'http://localhost';
const enabled = process.env.SUPERAPP_PILOT_CHAOS === '1';
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
  return response.json();
}

async function runPilot(
  port: number,
  requestId: string,
  overrides: Record<string, unknown> = {},
) {
  return postJson(port, '/bff-api/effect/pilot/grab-marketplace/run', {
    tenant: 'superapp-global',
    actor: 'overnight.pilot',
    requestId,
    modules: fullModuleSet,
    chaos: 'none',
    ...overrides,
  });
}

async function expectRejectedWithoutStateDrift(input: {
  port: number;
  id: string;
  pathname: string;
  body?: unknown;
}) {
  const before = await getBootstrap(input.port);
  const response = await postJson(input.port, input.pathname, input.body);
  expect(response.status).toBeGreaterThanOrEqual(400);
  const after = await getBootstrap(input.port);
  expect(after).toEqual(before);
  return {
    id: input.id,
    status: response.status,
  };
}

(enabled ? describe : describe.skip)(
  'superapp complex pilot chaos certification',
  () => {
    let port: number;
    let app: Awaited<ReturnType<typeof modernServe>> | undefined;

    beforeAll(async () => {
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
      await killApp(app);
    });

    test('survives complex SuperApp workflows, idempotency storms, chaos, and invalid-request drift probes', async () => {
      const metrics = createPortfolioMetrics({
        suite: 'superapp-portfolio-pilot-chaos',
        outputDir: artifactDir,
      });
      const checks: Array<Record<string, unknown>> = [];

      await metrics.timed('reset:initial', () => resetPortfolio(port));
      const acceptedResponse = await metrics.timed('pilot:accepted', () =>
        runPilot(port, 'pilot-main-1'),
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

      const duplicateResponses = await metrics.timed(
        'pilot:idempotency-storm',
        () =>
          Promise.all(
            Array.from({ length: 20 }, () => runPilot(port, 'pilot-main-1')),
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
      const afterDuplicates = await getBootstrap(port);
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
          runPilot(port, `pilot-${chaos}`, { chaos }),
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
        await metrics.timed(`reset:after:${chaos}`, () => resetPortfolio(port));
        const recovered = await getBootstrap(port);
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
          port,
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
          port,
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

      const beforeMalformed = await getBootstrap(port);
      const malformed = await fetch(
        `${host}:${port}/bff-api/effect/pilot/grab-marketplace/run`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: '{',
        },
      );
      expect(malformed.status).toBeGreaterThanOrEqual(400);
      const afterMalformed = await getBootstrap(port);
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
