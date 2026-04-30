import { execFileSync } from 'node:child_process';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import {
  getPort,
  killApp,
  modernBuild,
  modernServe,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

dns.setDefaultResultOrder('ipv4first');
setSuiteTimeout(1000 * 60 * 12);

const appDir = path.resolve(__dirname, '../');
const repoRoot = path.resolve(appDir, '../../..');
const enabled = process.env.SUPERAPP_PORTFOLIO_LOAD === '1';
const artifactDir =
  process.env.SUPERAPP_PORTFOLIO_LOAD_ARTIFACT_DIR ??
  '/tmp/modernjs-superapp-portfolio-load';

(enabled ? describe : describe.skip)(
  'superapp portfolio external HTTP load profile',
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

    test('survives high-concurrency pilot, workflow, chaos, invalid, and reset HTTP load', () => {
      fs.mkdirSync(artifactDir, { recursive: true });
      const summaryPath = path.join(artifactDir, 'summary.json');
      execFileSync(
        'node',
        [
          path.join(repoRoot, 'scripts/superapp-load/run-superapp-load.js'),
          '--target',
          'portfolio',
          '--scenario',
          'mixed',
          '--base-url',
          `http://localhost:${port}`,
          '--duration-ms',
          process.env.SUPERAPP_PORTFOLIO_LOAD_DURATION_MS ?? '12000',
          '--concurrency',
          process.env.SUPERAPP_PORTFOLIO_LOAD_CONCURRENCY ?? '24',
          '--request-timeout-ms',
          process.env.SUPERAPP_PORTFOLIO_LOAD_REQUEST_TIMEOUT_MS ?? '15000',
          '--p95-ms',
          process.env.SUPERAPP_PORTFOLIO_LOAD_P95_MS ?? '2500',
          '--max-ms',
          process.env.SUPERAPP_PORTFOLIO_LOAD_MAX_MS ?? '15000',
          '--max-error-rate',
          process.env.SUPERAPP_PORTFOLIO_LOAD_MAX_ERROR_RATE ?? '0',
          '--out',
          summaryPath,
        ],
        {
          cwd: repoRoot,
          stdio: 'inherit',
        },
      );

      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      expect(summary).toMatchObject({
        suite: 'superapp-portfolio-load',
        target: 'portfolio',
        scenario: 'mixed',
        unexpectedErrorCount: 0,
        budgetFailures: [],
      });
      expect(summary.requestCount).toBeGreaterThan(0);
      expect(summary.operations.portfolioPilot).toBeDefined();
      expect(summary.operations.portfolioChaos).toBeDefined();
      expect(
        Object.keys(summary.operations).some(key =>
          key.startsWith('portfolioInvalid:'),
        ),
      ).toBe(true);
    });
  },
);
