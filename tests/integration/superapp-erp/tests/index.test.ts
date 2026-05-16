import { execSync } from 'node:child_process';
import dns from 'node:dns';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchApp,
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

type AppProcess = Awaited<ReturnType<typeof launchApp>>;

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

async function resetSuperApp(port: number) {
  const response = await fetch(`${host}:${port}/bff-api/effect/reset`, {
    method: 'POST',
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    pendingApprovals: 2,
    totalMessages: 2,
  });
}

async function expectEffectContracts(port: number) {
  await resetSuperApp(port);

  const openApiResponse = await fetch(`${host}:${port}/bff-api/openapi.json`);
  expect(openApiResponse.status).toBe(200);
  const openApi = await openApiResponse.json();
  expect(openApi.paths['/effect/bootstrap']).toBeDefined();
  expect(openApi.paths['/effect/approval/{id}/decision']).toBeDefined();
  expect(openApi.paths['/effect/chat/send']).toBeDefined();

  const bootstrapResponse = await fetch(
    `${host}:${port}/bff-api/effect/bootstrap`,
  );
  expect(bootstrapResponse.status).toBe(200);
  const bootstrap = await bootstrapResponse.json();
  expect(bootstrap.summary).toEqual({
    tenantName: 'Acme Global Operations',
    moduleCount: 5,
    pendingApprovals: 2,
    urgentMessages: 1,
    totalOpenWork: 43,
    financeExposure: 54800,
  });
  expect(bootstrap.modules.map((item: { id: string }) => item.id)).toEqual([
    'dispatch',
    'finance',
    'inventory',
    'hr',
    'chat',
  ]);

  const approvalResponse = await fetch(
    `${host}:${port}/bff-api/effect/approval/ap-1001/decision`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        decision: 'approved',
        actor: 'finance.lead',
      }),
    },
  );
  expect(approvalResponse.status).toBe(200);
  await expect(approvalResponse.json()).resolves.toEqual({
    id: 'ap-1001',
    status: 'approved',
    actor: 'finance.lead',
    pendingApprovals: 1,
  });

  const chatResponse = await fetch(`${host}:${port}/bff-api/effect/chat/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      channel: 'incident-war-room',
      author: 'ops.commander',
      text: 'Escalate route capacity',
      priority: 'urgent',
    }),
  });
  expect(chatResponse.status).toBe(200);
  const chat = await chatResponse.json();
  expect(chat).toMatchObject({
    accepted: true,
    totalMessages: 3,
    message: {
      id: 'msg-3',
      channel: 'incident-war-room',
      author: 'ops.commander',
      text: 'Escalate route capacity',
      priority: 'urgent',
    },
  });
}

async function expectServerSideWorkflowLoad(port: number) {
  await resetSuperApp(port);

  const invalidChatResponse = await fetch(
    `${host}:${port}/bff-api/effect/chat/send`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        channel: 'incident-war-room',
        author: 'ops.commander',
        text: 'Invalid priority should be rejected',
        priority: 'critical',
      }),
    },
  );
  expect(invalidChatResponse.status).toBeGreaterThanOrEqual(400);

  const unknownApprovalResponse = await fetch(
    `${host}:${port}/bff-api/effect/approval/ap-missing/decision`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        decision: 'approved',
        actor: 'finance.lead',
      }),
    },
  );
  expect(unknownApprovalResponse.status).toBeGreaterThanOrEqual(400);

  const decisions = [];
  for (const [id, decision, actor] of [
    ['ap-1001', 'approved', 'finance.lead'],
    ['ap-1002', 'rejected', 'ops.manager'],
  ] as const) {
    decisions.push(
      await fetch(`${host}:${port}/bff-api/effect/approval/${id}/decision`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          decision,
          actor,
        }),
      }),
    );
  }
  expect(decisions.map(response => response.status)).toEqual([200, 200]);
  const decisionPayloads = await Promise.all(
    decisions.map(response => response.json()),
  );
  expect(decisionPayloads).toEqual([
    {
      id: 'ap-1001',
      status: 'approved',
      actor: 'finance.lead',
      pendingApprovals: 1,
    },
    {
      id: 'ap-1002',
      status: 'rejected',
      actor: 'ops.manager',
      pendingApprovals: 0,
    },
  ]);

  const messages = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      fetch(`${host}:${port}/bff-api/effect/chat/send`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          channel: index % 2 === 0 ? 'incident-war-room' : 'finance-control',
          author: `load.agent.${index + 1}`,
          text: `workflow event ${index + 1}`,
          priority: index === 0 ? 'urgent' : 'normal',
        }),
      }),
    ),
  );
  expect(messages.map(response => response.status)).toEqual([
    200, 200, 200, 200, 200,
  ]);
  const messagePayloads = await Promise.all(
    messages.map(response => response.json()),
  );
  expect(messagePayloads.map(payload => payload.message.id).sort()).toEqual([
    'msg-3',
    'msg-4',
    'msg-5',
    'msg-6',
    'msg-7',
  ]);
  expect(
    Math.max(...messagePayloads.map(payload => payload.totalMessages)),
  ).toBe(7);

  const bootstrapResponse = await fetch(
    `${host}:${port}/bff-api/effect/bootstrap`,
  );
  expect(bootstrapResponse.status).toBe(200);
  const bootstrap = await bootstrapResponse.json();
  expect(bootstrap.summary).toMatchObject({
    pendingApprovals: 0,
    urgentMessages: 2,
    totalOpenWork: 43,
  });
  expect(
    bootstrap.approvals.map(
      (approval: { id: string; status: string }) =>
        `${approval.id}:${approval.status}`,
    ),
  ).toEqual(['ap-1001:approved', 'ap-1002:rejected']);
  expect(bootstrap.chat).toHaveLength(7);

  await resetSuperApp(port);
}

async function expectProductionShell(port: number) {
  const response = await fetch(`${host}:${port}/`);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('Acme Global Operations');
  expect(html).toContain('tanstack-effect-superapp');
  expect(html).toContain('Command Center');
  expect(html).toContain('executive-command-center');
  expect(html).not.toContain('html-rspack-plugin');
  expect(html).not.toContain('hot-update');
}

function expectProductionRouteManifest() {
  const manifestPath = path.join(appDir, 'dist/routes-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const serialized = JSON.stringify(manifest);
  expect(serialized).not.toContain('hot-update');
  expect(serialized).not.toContain('html-rspack-plugin');

  for (const route of Object.values(manifest.routeAssets) as Array<{
    assets?: string[];
  }>) {
    for (const asset of route.assets ?? []) {
      expect(asset).toMatch(/^\/static\//);
      expect(existsSync(path.join(appDir, 'dist', asset.slice(1)))).toBe(true);
    }
  }

  expect(manifest.routeAssets.index.assets).toContain('/static/js/index.js');
  expect(manifest.routeAssets.index.assets).toContain('/static/css/index.css');
  expect(manifest.routeAssets['approvals/page'].assets).toContain(
    '/static/js/async/approvals/page.js',
  );
  expect(manifest.routeAssets['chat/page'].assets).toContain(
    '/static/js/async/chat/page.js',
  );
}

async function expectSuperAppUi(page: Page, port: number) {
  await resetSuperApp(port);

  await page.goto(`${host}:${port}/`, {
    waitUntil: ['networkidle0'],
    timeout: 50000,
  });
  await page.waitForSelector('[data-testid="dashboard-ready"]');

  await expect(
    page.$eval('[data-testid="tenant-name"]', el => el.textContent),
  ).resolves.toContain('Acme Global Operations');
  await expect(
    page.$eval('[data-testid="shell-mode"]', el => el.textContent),
  ).resolves.toBe('tanstack-effect-superapp');
  await expect(
    page.$eval('[data-testid="route-kind"]', el => el.textContent),
  ).resolves.toBe('executive-command-center');
  await expect(
    page.$eval('[data-testid="summary"]', el => el.textContent),
  ).resolves.toContain('modules:5;pending:2;urgent:1');
  await expect(
    page.$eval('[data-testid="module-finance"]', el => el.textContent),
  ).resolves.toContain('status:degraded');

  await page.click('[data-testid="nav-approvals"]');
  await page.waitForSelector('[data-testid="approvals-page"]');
  await expect(
    page.$eval('[data-testid="route-kind"]', el => el.textContent),
  ).resolves.toBe('finance-approval-workflow');
  await page.click('[data-testid="approve-first"]');
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="approval-decision"]')
      ?.textContent?.includes('ap-1001:approved:1'),
  );
  await expect(
    page.$eval('[data-testid="approval-ap-1001"]', el => el.textContent),
  ).resolves.toContain('ap-1001:approved');

  await page.click('[data-testid="nav-chat"]');
  await page.waitForSelector('[data-testid="chat-page"]');
  await expect(
    page.$eval('[data-testid="route-kind"]', el => el.textContent),
  ).resolves.toBe('ops-chat-command-channel');
  await page.$eval(
    '[data-testid="chat-input"]',
    (element, value) => {
      const input = element as HTMLInputElement;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;

      valueSetter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    'Reroute high priority loads',
  );
  await page.click('[data-testid="chat-send"]');
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="chat-receipt"]')
      ?.textContent?.includes('msg-3:3'),
  );
  await page.waitForSelector('[data-testid="chat-msg-3"]');
  await expect(
    page.$eval('[data-testid="chat-msg-3"]', el => el.textContent),
  ).resolves.toContain('ops.commander:urgent:Reroute high priority loads');
}

function expectTypecheckPasses() {
  execSync('pnpm exec tsgo --noEmit -p tsconfig.json', {
    cwd: appDir,
    stdio: 'pipe',
  });
}

describe('Effect + TanStack SuperApp ERP readiness fixture', () => {
  test('passes TypeScript contract checks', () => {
    expectTypecheckPasses();
  });

  describe('development runtime', () => {
    let app: AppProcess;
    let browser: Browser;
    let page: Page;
    let port: number;
    let browserErrors: string[];

    beforeAll(async () => {
      port = await getPort();
      app = await launchApp(appDir, port, {});
      browser = await puppeteer.launch(browserLaunchOptions);
      page = await browser.newPage();
      browserErrors = captureBrowserErrors(page);
    });

    afterAll(async () => {
      await page?.close();
      await browser?.close();
      await killApp(app);
    });

    test('serves Effect API contracts and TanStack-driven workflows', async () => {
      await expectEffectContracts(port);
      await expectServerSideWorkflowLoad(port);
      await expectSuperAppUi(page, port);
      expect(browserErrors).toEqual([]);
    });
  });

  describe('production build and serve', () => {
    let app: AppProcess;
    let browser: Browser;
    let page: Page;
    let port: number;
    let browserErrors: string[];

    beforeAll(async () => {
      port = await getPort();
      const buildResult = await modernBuild(appDir);
      expect(buildResult.code).toBe(0);
      app = await modernServe(appDir, port, {
        cwd: appDir,
      });
      browser = await puppeteer.launch(browserLaunchOptions);
      page = await browser.newPage();
      browserErrors = captureBrowserErrors(page);
    });

    afterAll(async () => {
      await page?.close();
      await browser?.close();
      await killApp(app);
    });

    test('keeps SSR shell, Effect API contracts, and TanStack workflows working after build', async () => {
      await expectProductionShell(port);
      expectProductionRouteManifest();
      await expectEffectContracts(port);
      await expectServerSideWorkflowLoad(port);
      await expectSuperAppUi(page, port);
      expect(browserErrors).toEqual([]);
    });
  });
});
