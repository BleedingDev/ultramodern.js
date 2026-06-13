import dns from 'node:dns';
import path from 'node:path';
import { buildFixtureOnce } from '../../../utils/fixtureBuild';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import { createPortfolioMetrics } from './portfolioMetrics';

dns.setDefaultResultOrder('ipv4first');
setSuiteTimeout(1000 * 60 * 10);

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const stressEnabled = process.env.SUPERAPP_PORTFOLIO_STRESS === '1';
const stressCycles = Number.parseInt(
  process.env.SUPERAPP_PORTFOLIO_STRESS_CYCLES ?? '12',
  10,
);
const artifactDir =
  process.env.SUPERAPP_PORTFOLIO_STRESS_ARTIFACT_DIR ??
  '/tmp/modernjs-superapp-portfolio-stress';

async function postJson(port: number, pathname: string, body?: unknown) {
  return fetch(`${host}:${port}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function getJson(port: number, pathname: string) {
  const response = await fetch(`${host}:${port}${pathname}`);
  expect(response.status).toBe(200);
  return response.json();
}

(stressEnabled ? describe : describe.skip)(
  'superapp portfolio stress profile',
  () => {
    let port: number;
    let app: Awaited<ReturnType<typeof modernServe>> | undefined;

    beforeAll(async () => {
      const build = await buildFixtureOnce(appDir, {
        build: () => modernBuild(appDir),
      });
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

    test('runs cross-app workflow churn and writes a JSON artifact', async () => {
      const metrics = createPortfolioMetrics({
        suite: 'superapp-portfolio-stress',
        outputDir: artifactDir,
      });
      await metrics.timed('reset', async () => {
        const response = await postJson(port, '/bff-api/effect/reset');
        expect(response.status).toBe(200);
      });
      await metrics.timed('erp:approval:ap-1001', async () => {
        const response = await postJson(
          port,
          '/bff-api/effect/apps/enterprise-mega-erp/erp/approval/ap-1001/decision',
          {
            decision: 'approved',
            actor: 'stress.runner',
          },
        );
        expect(response.status).toBe(200);
      });
      await metrics.timed('erp:approval:ap-1002', async () => {
        const response = await postJson(
          port,
          '/bff-api/effect/apps/enterprise-mega-erp/erp/approval/ap-1002/decision',
          {
            decision: 'rejected',
            actor: 'stress.runner',
          },
        );
        expect(response.status).toBe(200);
      });

      const appIds = [
        'mobility-marketplace',
        'enterprise-mega-erp',
        'mf-platform',
        'tenant-security',
        'failure-lab',
      ];
      for (let cycle = 0; cycle < stressCycles; cycle += 1) {
        await Promise.all(
          appIds.map(appId =>
            metrics.timed(`workflow:${appId}`, async () => {
              const response = await postJson(
                port,
                `/bff-api/effect/apps/${appId}/workflow`,
                {
                  action: `stress-${cycle}`,
                  actor: 'stress.runner',
                  requestId: `${appId}-${cycle}`,
                },
              );
              expect(response.status).toBe(200);
            }),
          ),
        );
        await metrics.timed('erp:chat', async () => {
          const response = await postJson(
            port,
            '/bff-api/effect/apps/enterprise-mega-erp/erp/chat/send',
            {
              channel:
                cycle % 2 === 0 ? 'incident-war-room' : 'finance-control',
              author: 'stress.runner',
              text: `portfolio erp stress event ${cycle + 1}`,
              priority: cycle % 4 === 0 ? 'urgent' : 'normal',
            },
          );
          expect(response.status).toBe(200);
        });
      }

      const bootstrap = await metrics.timed('bootstrap:final', async () => {
        const response = await fetch(
          `${host}:${port}/bff-api/effect/bootstrap`,
        );
        expect(response.status).toBe(200);
        return response.json();
      });
      expect(bootstrap.summary.eventCount).toBe(stressCycles * appIds.length);
      const erp = await metrics.timed('erp:bootstrap:final', () =>
        getJson(port, '/bff-api/effect/apps/enterprise-mega-erp/erp/bootstrap'),
      );
      expect(erp.summary.pendingApprovals).toBe(0);
      expect(erp.chat).toHaveLength(2 + stressCycles);
      const summary = metrics.write({
        stressCycles,
        finalEventCount: bootstrap.summary.eventCount,
        erpFinalMessageCount: erp.chat.length,
      });
      expect(summary.unexpectedErrorCount).toBe(0);
    });
  },
);
