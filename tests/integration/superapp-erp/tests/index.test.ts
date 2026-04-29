import { execFileSync } from 'node:child_process';
import dns from 'node:dns';
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
  await page.click('[data-testid="chat-input"]', {
    clickCount: 3,
  });
  await page.keyboard.press('Backspace');
  await page.type('[data-testid="chat-input"]', 'Reroute high priority loads');
  await page.click('[data-testid="chat-send"]');
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="chat-receipt"]')
      ?.textContent?.includes('msg-3:3'),
  );
  await expect(
    page.$eval('[data-testid="chat-msg-3"]', el => el.textContent),
  ).resolves.toContain('ops.commander:urgent:Reroute high priority loads');
}

function expectTypecheckPasses() {
  execFileSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', 'tsconfig.json'], {
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

    beforeAll(async () => {
      port = await getPort();
      app = await launchApp(appDir, port, {});
      browser = await puppeteer.launch(browserLaunchOptions);
      page = await browser.newPage();
    });

    afterAll(async () => {
      await page?.close();
      await browser?.close();
      await killApp(app);
    });

    test('serves Effect API contracts and TanStack-driven workflows', async () => {
      await expectEffectContracts(port);
      await expectSuperAppUi(page, port);
    });
  });

  describe('production build and serve', () => {
    let app: AppProcess;
    let port: number;

    beforeAll(async () => {
      port = await getPort();
      const buildResult = await modernBuild(appDir);
      expect(buildResult.code).toBe(0);
      app = await modernServe(appDir, port, {
        cwd: appDir,
      });
    });

    afterAll(async () => {
      await killApp(app);
    });

    test('keeps Effect API contracts working after build', async () => {
      await expectEffectContracts(port);
    });
  });
});
