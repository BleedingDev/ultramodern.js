import dns from 'node:dns';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import {
  getPort,
  killApp,
  launchOptions,
  modernBuild,
  modernServe,
  sleep,
} from '../../../utils/modernTestUtils';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';

dns.setDefaultResultOrder('ipv4first');

const appDir = path.resolve(__dirname, '../');
const host = 'http://localhost';
const browserLaunchOptions = launchOptions as Parameters<
  typeof puppeteer.launch
>[0];
const stressEnabled = process.env.SUPERAPP_ERP_STRESS === '1';
const stressRounds =
  parsePositiveInt(process.env.SUPERAPP_ERP_STRESS_ROUNDS) ?? 12;
const stressBatchSize =
  parsePositiveInt(process.env.SUPERAPP_ERP_STRESS_BATCH) ?? 24;
const stressResetCycles =
  parsePositiveInt(process.env.SUPERAPP_ERP_STRESS_RESET_CYCLES) ?? 4;
const stressRouteCycles =
  parsePositiveInt(process.env.SUPERAPP_ERP_STRESS_ROUTE_CYCLES) ?? 12;
const stressPauseMs =
  parsePositiveInt(process.env.SUPERAPP_ERP_STRESS_PAUSE_MS) ?? 20;
const stressP95BudgetMs =
  parsePositiveInt(process.env.SUPERAPP_ERP_STRESS_P95_MS) ?? 1500;
const stressMaxBudgetMs =
  parsePositiveInt(process.env.SUPERAPP_ERP_STRESS_MAX_MS) ?? 5000;
const describeStress = stressEnabled ? describe : describe.skip;

setSuiteTimeout(1000 * 60 * 15);

type AppProcess = Awaited<ReturnType<typeof modernServe>>;

type BootstrapPayload = {
  approvals: Array<{ id: string; status: string }>;
  chat: Array<{ id: string; priority: 'normal' | 'urgent' }>;
  summary: {
    pendingApprovals: number;
    urgentMessages: number;
    totalOpenWork: number;
  };
};

function parsePositiveInt(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function percentile(values: number[], percentileValue: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

function captureBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', error => {
    errors.push(error.message);
  });
  return errors;
}

async function timed<T>(operation: () => Promise<T>) {
  const startedAt = performance.now();
  const value = await operation();
  return {
    value,
    durationMs: performance.now() - startedAt,
  };
}

async function request(
  port: number,
  pathname: string,
  options: RequestInit = {},
) {
  return fetch(`${host}:${port}${pathname}`, options);
}

async function postJson(port: number, pathname: string, payload?: unknown) {
  return request(port, pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function getBootstrap(port: number) {
  const response = await request(port, '/bff-api/effect/bootstrap');
  expect(response.status).toBe(200);
  return (await response.json()) as BootstrapPayload;
}

async function resetSuperApp(port: number) {
  const response = await postJson(port, '/bff-api/effect/reset');
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    pendingApprovals: 2,
    totalMessages: 2,
  });
}

async function decideApproval(
  port: number,
  id: string,
  decision: 'approved' | 'rejected',
  actor: string,
) {
  const response = await postJson(
    port,
    `/bff-api/effect/approval/${id}/decision`,
    {
      decision,
      actor,
    },
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function sendChatMessage(
  port: number,
  round: number,
  index: number,
  priority: 'normal' | 'urgent',
) {
  const response = await postJson(port, '/bff-api/effect/chat/send', {
    channel: index % 2 === 0 ? 'incident-war-room' : 'finance-control',
    author: `stress.agent.${round}.${index + 1}`,
    text: `stress round ${round} event ${index + 1}`,
    priority,
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function expectRoute(page: Page, port: number, pathname: string) {
  await page.goto(`${host}:${port}${pathname}`, {
    waitUntil: ['networkidle0'],
    timeout: 50000,
  });

  if (pathname === '/') {
    await page.waitForSelector('[data-testid="dashboard-ready"]');
    await expect(
      page.$eval('[data-testid="route-kind"]', el => el.textContent),
    ).resolves.toBe('executive-command-center');
    return;
  }

  if (pathname === '/approvals') {
    await page.waitForSelector('[data-testid="approvals-page"]');
    await expect(
      page.$eval('[data-testid="route-kind"]', el => el.textContent),
    ).resolves.toBe('finance-approval-workflow');
    return;
  }

  await page.waitForSelector('[data-testid="chat-page"]');
  await expect(
    page.$eval('[data-testid="route-kind"]', el => el.textContent),
  ).resolves.toBe('ops-chat-command-channel');
}

async function expectInvalidRequestsDoNotMutateState(port: number) {
  await resetSuperApp(port);
  const before = await getBootstrap(port);

  const invalidRequests = [
    request(port, '/bff-api/effect/chat/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{',
    }),
    postJson(port, '/bff-api/effect/chat/send'),
    postJson(port, '/bff-api/effect/chat/send', {
      channel: 'incident-war-room',
      author: 'stress.agent.invalid',
      text: 'invalid priority',
      priority: 'critical',
    }),
    postJson(port, '/bff-api/effect/chat/send', {
      channel: 'incident-war-room',
      author: 'stress.agent.invalid',
      priority: 'urgent',
    }),
    postJson(port, '/bff-api/effect/approval/ap-1001/decision', {
      decision: 'approved',
    }),
    postJson(port, '/bff-api/effect/approval/ap-1001/decision', {
      decision: 'escalated',
      actor: 'finance.lead',
    }),
    postJson(port, '/bff-api/effect/approval/ap-missing/decision', {
      decision: 'approved',
      actor: 'finance.lead',
    }),
  ];

  const responses = await Promise.all(invalidRequests);
  for (const response of responses) {
    expect(response.status).toBeGreaterThanOrEqual(400);
  }

  const after = await getBootstrap(port);
  expect(after.summary).toEqual(before.summary);
  expect(after.approvals).toEqual(before.approvals);
  expect(after.chat).toEqual(before.chat);
}

function expectGaplessMessageIds(chat: Array<{ id: string }>) {
  const numericIds = chat.map(message =>
    Number(message.id.replace('msg-', '')),
  );
  expect(new Set(numericIds).size).toBe(numericIds.length);
  expect([...numericIds].sort((a, b) => a - b)).toEqual(
    Array.from({ length: numericIds.length }, (_, index) => index + 1),
  );
}

describeStress('SuperApp ERP brutal stress and edge-case validation', () => {
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
      stderr: false,
      stdout: false,
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

  test('rejects invalid Effect payloads without state drift', async () => {
    await expectInvalidRequestsDoNotMutateState(port);
  });

  test('preserves state and latency budgets under concurrent Effect bursts', async () => {
    const durations: number[] = [];

    for (let cycle = 0; cycle < stressResetCycles; cycle += 1) {
      await resetSuperApp(port);
      await expect(
        decideApproval(port, 'ap-1001', 'approved', 'finance.lead'),
      ).resolves.toMatchObject({
        pendingApprovals: 1,
      });
      await expect(
        decideApproval(port, 'ap-1002', 'rejected', 'ops.manager'),
      ).resolves.toMatchObject({
        pendingApprovals: 0,
      });

      let expectedMessages = 2;
      let expectedUrgentMessages = 1;

      for (let round = 0; round < stressRounds; round += 1) {
        const batch = await Promise.all(
          Array.from({ length: stressBatchSize }, async (_, index) => {
            const priority = (round + index) % 4 === 0 ? 'urgent' : 'normal';
            const result = await timed(() =>
              sendChatMessage(port, round + 1, index, priority),
            );
            durations.push(result.durationMs);
            return result.value;
          }),
        );

        expectedMessages += stressBatchSize;
        expectedUrgentMessages += batch.filter(
          payload => payload.message.priority === 'urgent',
        ).length;

        const bootstrapResult = await timed(() => getBootstrap(port));
        durations.push(bootstrapResult.durationMs);
        expect(bootstrapResult.value.summary).toMatchObject({
          pendingApprovals: 0,
          urgentMessages: expectedUrgentMessages,
          totalOpenWork: 43,
        });
        expect(bootstrapResult.value.chat).toHaveLength(expectedMessages);
        expectGaplessMessageIds(bootstrapResult.value.chat);

        await sleep(stressPauseMs);
      }

      const finalBootstrap = await getBootstrap(port);
      expect(finalBootstrap.chat).toHaveLength(
        2 + stressRounds * stressBatchSize,
      );
      expectGaplessMessageIds(finalBootstrap.chat);
      expect(finalBootstrap.approvals.map(approval => approval.status)).toEqual(
        ['approved', 'rejected'],
      );
    }

    const p95DurationMs = percentile(durations, 95);
    const maxDurationMs = Math.max(...durations);
    console.info(
      `[superapp-stress] samples=${durations.length};p95=${Math.round(
        p95DurationMs,
      )}ms;max=${Math.round(maxDurationMs)}ms`,
    );
    expect(p95DurationMs).toBeLessThan(stressP95BudgetMs);
    expect(maxDurationMs).toBeLessThan(stressMaxBudgetMs);
  });

  test('keeps TanStack route churn stable after stressed Effect state', async () => {
    await resetSuperApp(port);

    await Promise.all(
      Array.from({ length: stressBatchSize }, (_, index) => {
        const priority = index % 3 === 0 ? 'urgent' : 'normal';
        return sendChatMessage(port, 1, index, priority);
      }),
    );

    for (let cycle = 0; cycle < stressRouteCycles; cycle += 1) {
      await expectRoute(page, port, '/');
      await page.click('[data-testid="nav-approvals"]');
      await page.waitForSelector('[data-testid="approvals-page"]');
      await expect(
        page.$eval('[data-testid="route-kind"]', el => el.textContent),
      ).resolves.toBe('finance-approval-workflow');

      await page.click('[data-testid="nav-chat"]');
      await page.waitForSelector('[data-testid="chat-page"]');
      await expect(
        page.$eval('[data-testid="route-kind"]', el => el.textContent),
      ).resolves.toBe('ops-chat-command-channel');

      await sleep(stressPauseMs);
    }

    expect(browserErrors).toEqual([]);
  });
});
