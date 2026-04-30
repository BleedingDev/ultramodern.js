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
setSuiteTimeout(1000 * 60 * 30);

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const nightlyEnabled = process.env.SUPERAPP_PORTFOLIO_NIGHTLY === '1';
const nightlyCycles = Number.parseInt(
  process.env.SUPERAPP_PORTFOLIO_NIGHTLY_CYCLES ?? '30',
  10,
);
const artifactDir =
  process.env.SUPERAPP_PORTFOLIO_NIGHTLY_ARTIFACT_DIR ??
  '/tmp/modernjs-superapp-portfolio-nightly';

async function postJson(port: number, pathname: string, body?: unknown) {
  return fetch(`${host}:${port}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

(nightlyEnabled ? describe : describe.skip)(
  'superapp portfolio nightly profile',
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

    test('cycles failure injection, reset recovery, and workflow idempotency', async () => {
      const metrics = createPortfolioMetrics({
        suite: 'superapp-portfolio-nightly',
        outputDir: artifactDir,
      });
      const failureModes = ['remote-down', 'api-timeout', 'chunk-404'];

      for (let cycle = 0; cycle < nightlyCycles; cycle += 1) {
        const mode = failureModes[cycle % failureModes.length];
        await metrics.timed(`failure:${mode}`, async () => {
          const response = await postJson(
            port,
            `/bff-api/effect/failure/${mode}`,
            {
              actor: 'nightly.runner',
              reason: `cycle-${cycle}`,
            },
          );
          expect(response.status).toBe(200);
        });
        await metrics.timed('reset', async () => {
          const response = await postJson(port, '/bff-api/effect/reset');
          expect(response.status).toBe(200);
        });
        await metrics.timed('idempotent-workflow', async () => {
          const payload = {
            action: 'nightly-idempotency',
            actor: 'nightly.runner',
            requestId: `nightly-${cycle}`,
          };
          const first = await postJson(
            port,
            '/bff-api/effect/apps/enterprise-mega-erp/workflow',
            payload,
          );
          const second = await postJson(
            port,
            '/bff-api/effect/apps/enterprise-mega-erp/workflow',
            payload,
          );
          expect([first.status, second.status]).toEqual([200, 200]);
          await expect(second.json()).resolves.toMatchObject({
            event: {
              status: 'deduped',
            },
          });
        });
      }

      const summary = metrics.write({ nightlyCycles });
      expect(summary.unexpectedErrorCount).toBe(0);
    });
  },
);
