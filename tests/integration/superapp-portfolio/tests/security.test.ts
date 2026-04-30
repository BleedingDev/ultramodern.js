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
setSuiteTimeout(1000 * 60 * 10);

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const enabled = process.env.SUPERAPP_PORTFOLIO_SECURITY === '1';
const artifactDir =
  process.env.SUPERAPP_PORTFOLIO_SECURITY_ARTIFACT_DIR ??
  '/tmp/modernjs-superapp-portfolio-security';

type Check = {
  id: string;
  ok: boolean;
  detail?: Record<string, unknown>;
};

async function postJson(
  port: number,
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${host}:${port}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
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
}

function securityHeaders(port: number, overrides: Record<string, string> = {}) {
  return {
    authorization: 'Bearer secret-token-for-redaction',
    origin: `${host}:${port}`,
    'x-csrf-token': 'superapp-valid-csrf',
    'x-tenant-id': 'security-root',
    'x-user-role': 'security-admin',
    ...overrides,
  };
}

function securityPayload(overrides: Record<string, unknown> = {}) {
  return {
    targetTenant: 'security-root',
    targetAppId: 'tenant-security',
    action: 'role-check',
    requestId: 'security-probe-1',
    mutation: true,
    ...overrides,
  };
}

async function expectRejectedWithoutStateDrift(input: {
  port: number;
  id: string;
  headers?: Record<string, string>;
  payload?: Record<string, unknown>;
  forbiddenText?: string[];
}) {
  const before = await getBootstrap(input.port);
  const response = await postJson(
    input.port,
    '/bff-api/effect/security/probe',
    securityPayload(input.payload),
    securityHeaders(input.port, input.headers),
  );
  expect(response.status).toBeGreaterThanOrEqual(400);
  const text = await response.text();
  for (const forbidden of input.forbiddenText ?? [
    'secret-token-for-redaction',
    'superapp-valid-csrf',
  ]) {
    expect(text).not.toContain(forbidden);
  }
  const after = await getBootstrap(input.port);
  expect(after).toEqual(before);
  return {
    id: input.id,
    ok: true,
    detail: {
      status: response.status,
    },
  };
}

(enabled ? describe : describe.skip)(
  'superapp portfolio security certification',
  () => {
    let port: number;
    let app: Awaited<ReturnType<typeof modernServe>> | undefined;
    const checks: Check[] = [];

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

    afterEach(() => {
      createPortfolioMetrics({
        suite: 'superapp-portfolio-security',
        outputDir: artifactDir,
      }).write({
        checkCount: checks.length,
        failedCount: checks.filter(check => !check.ok).length,
        checks,
      });
    });

    test('certifies auth, roles, csrf, tenant isolation, origins, request ids, and telemetry redaction', async () => {
      await resetPortfolio(port);
      const bootstrap = await getBootstrap(port);
      const securityApp = bootstrap.apps.find(
        (app: { id: string }) => app.id === 'tenant-security',
      );
      expect(securityApp).toMatchObject({
        tenant: 'security-root',
        kind: 'security',
        risk: 'high',
      });
      expect(securityApp.capabilities).toEqual(
        expect.arrayContaining([
          'tenant isolation',
          'role boundaries',
          'csrf guard',
          'telemetry redaction',
        ]),
      );
      expect(securityApp.profiles.stress.workflows).toEqual(
        expect.arrayContaining([
          'requestid-isolation',
          'origin-check',
          'redaction-scan',
        ]),
      );
      checks.push({
        id: 'metadata:security-profile',
        ok: true,
      });

      const allowed = await postJson(
        port,
        '/bff-api/effect/security/probe',
        securityPayload(),
        securityHeaders(port),
      );
      expect(allowed.status).toBe(200);
      const decision = await allowed.json();
      expect(decision.allowed).toBe(true);
      expect(decision.checks.every((check: { ok: boolean }) => check.ok)).toBe(
        true,
      );
      expect(decision.telemetry).toMatchObject({
        tenant: 'security-root',
        appId: 'tenant-security',
        requestId: 'security-probe-1',
        role: 'security-admin',
        authorization: '[redacted]',
        csrfToken: '[redacted]',
      });
      expect(JSON.stringify(decision)).not.toContain(
        'secret-token-for-redaction',
      );
      checks.push({
        id: 'security-probe:allowed-redacted',
        ok: true,
        detail: {
          checkIds: decision.checks.map((check: { id: string }) => check.id),
        },
      });

      checks.push(
        await expectRejectedWithoutStateDrift({
          port,
          id: 'reject:cross-tenant-access',
          headers: {
            'x-tenant-id': 'city-ops-eu',
          },
        }),
      );
      checks.push(
        await expectRejectedWithoutStateDrift({
          port,
          id: 'reject:role-boundary',
          headers: {
            'x-user-role': 'erp-operator',
          },
        }),
      );
      checks.push(
        await expectRejectedWithoutStateDrift({
          port,
          id: 'reject:csrf',
          headers: {
            'x-csrf-token': 'bad-csrf-token',
          },
          forbiddenText: ['bad-csrf-token', 'secret-token-for-redaction'],
        }),
      );
      checks.push(
        await expectRejectedWithoutStateDrift({
          port,
          id: 'reject:origin',
          headers: {
            origin: 'https://evil.example',
          },
        }),
      );

      await resetPortfolio(port);
      const sharedRequestId = 'shared-idempotency-key';
      const mobility = await postJson(
        port,
        '/bff-api/effect/apps/mobility-marketplace/workflow',
        {
          action: 'quote',
          actor: 'security.runner',
          requestId: sharedRequestId,
        },
      );
      const erp = await postJson(
        port,
        '/bff-api/effect/apps/enterprise-mega-erp/workflow',
        {
          action: 'bulk-approve',
          actor: 'security.runner',
          requestId: sharedRequestId,
        },
      );
      const duplicateMobility = await postJson(
        port,
        '/bff-api/effect/apps/mobility-marketplace/workflow',
        {
          action: 'quote',
          actor: 'security.runner',
          requestId: sharedRequestId,
        },
      );
      expect([mobility.status, erp.status, duplicateMobility.status]).toEqual([
        200, 200, 200,
      ]);
      await expect(mobility.json()).resolves.toMatchObject({
        event: {
          id: 'evt-1',
          status: 'accepted',
        },
      });
      await expect(erp.json()).resolves.toMatchObject({
        event: {
          id: 'evt-2',
          status: 'accepted',
        },
      });
      await expect(duplicateMobility.json()).resolves.toMatchObject({
        event: {
          id: 'evt-1',
          status: 'deduped',
        },
      });
      const finalBootstrap = await getBootstrap(port);
      expect(finalBootstrap.summary.eventCount).toBe(2);
      expect(
        finalBootstrap.events.map(
          (event: { appId: string; requestId: string }) =>
            `${event.appId}:${event.requestId}`,
        ),
      ).toEqual([
        `mobility-marketplace:${sharedRequestId}`,
        `enterprise-mega-erp:${sharedRequestId}`,
      ]);
      checks.push({
        id: 'requestid:isolation-by-app',
        ok: true,
      });

      const failedCount = checks.filter(check => !check.ok).length;
      expect(failedCount).toBe(0);
    });
  },
);
