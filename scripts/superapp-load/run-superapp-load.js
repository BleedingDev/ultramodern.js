#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');

const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_BASE_URL = 'http://localhost:8080';
const DEFAULT_OUTPUT_ROOT = '.modern/superapp-load';

const usage = () => `
Usage:
  node scripts/superapp-load/run-superapp-load.js [options]

Options:
  --base-url <url>              SuperApp origin. Default: ${DEFAULT_BASE_URL}
  --target <name>               erp|portfolio. Default: erp
  --scenario <name>             Target scenario. Default: mixed
  --profile <name>              Alias for --scenario.
  --duration-ms <number>        Run duration. Default: 30000
  --concurrency <number>        Concurrent workers. Default: 8
  --run-id <id>                 Artifact run id. Default: timestamped
  --output-dir <path>           Artifact directory. Default: ${DEFAULT_OUTPUT_ROOT}/<run-id>
  --out <path>                  Artifact summary file or directory.
  --p95-ms <number>             Fail when p95 exceeds budget. Default: 1500
  --max-ms <number>             Fail when max exceeds budget. Default: 5000
  --max-error-rate <number>     Fail when unexpected error rate exceeds budget. Default: 0
  --request-timeout-ms <number> Per-request timeout. Default: 10000
  --help                        Show this help.
`;

const parseArgs = argv => {
  const parsed = {
    baseUrl: process.env.SUPERAPP_LOAD_BASE_URL || DEFAULT_BASE_URL,
    target: process.env.SUPERAPP_LOAD_TARGET || 'erp',
    scenario: process.env.SUPERAPP_LOAD_SCENARIO || 'mixed',
    durationMs:
      parsePositiveInt(process.env.SUPERAPP_LOAD_DURATION_MS) ?? 30000,
    concurrency: parsePositiveInt(process.env.SUPERAPP_LOAD_CONCURRENCY) ?? 8,
    runId:
      process.env.SUPERAPP_LOAD_RUN_ID ||
      `superapp-load-${new Date().toISOString()}-${process.pid}`,
    outputDir: process.env.SUPERAPP_LOAD_OUTPUT_DIR,
    outputPath: process.env.SUPERAPP_LOAD_OUT,
    p95Ms: parsePositiveInt(process.env.SUPERAPP_LOAD_P95_MS) ?? 1500,
    maxMs: parsePositiveInt(process.env.SUPERAPP_LOAD_MAX_MS) ?? 5000,
    maxErrorRate:
      parseNonNegativeNumber(process.env.SUPERAPP_LOAD_MAX_ERROR_RATE) ?? 0,
    requestTimeoutMs:
      parsePositiveInt(process.env.SUPERAPP_LOAD_REQUEST_TIMEOUT_MS) ?? 10000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    switch (arg) {
      case '--base-url':
        parsed.baseUrl = requireValue(argv, ++index, arg);
        break;
      case '--target':
        parsed.target = requireValue(argv, ++index, arg);
        break;
      case '--scenario':
      case '--profile':
        parsed.scenario = requireValue(argv, ++index, arg);
        break;
      case '--duration-ms':
        parsed.durationMs = requirePositiveInt(argv, ++index, arg);
        break;
      case '--concurrency':
        parsed.concurrency = requirePositiveInt(argv, ++index, arg);
        break;
      case '--run-id':
        parsed.runId = requireValue(argv, ++index, arg);
        break;
      case '--output-dir':
        parsed.outputDir = requireValue(argv, ++index, arg);
        break;
      case '--out':
        parsed.outputPath = requireValue(argv, ++index, arg);
        break;
      case '--p95-ms':
        parsed.p95Ms = requirePositiveInt(argv, ++index, arg);
        break;
      case '--max-ms':
        parsed.maxMs = requirePositiveInt(argv, ++index, arg);
        break;
      case '--max-error-rate':
        parsed.maxErrorRate = requireNonNegativeNumber(argv, ++index, arg);
        break;
      case '--request-timeout-ms':
        parsed.requestTimeoutMs = requirePositiveInt(argv, ++index, arg);
        break;
      case '--help':
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!TARGET_SCENARIOS.has(parsed.target)) {
    throw new Error(
      `Invalid --target "${parsed.target}". Use one of: ${[
        ...TARGET_SCENARIOS.keys(),
      ].join(', ')}`,
    );
  }

  const scenarios = TARGET_SCENARIOS.get(parsed.target);
  if (!scenarios.has(parsed.scenario)) {
    throw new Error(
      `Invalid --scenario "${parsed.scenario}" for target "${
        parsed.target
      }". Use one of: ${[...scenarios.keys()].join(', ')}`,
    );
  }

  parsed.baseUrl = parsed.baseUrl.replace(/\/+$/, '');
  parsed.runId = sanitizeSegment(parsed.runId);
  const defaultOutputDir = path.join(DEFAULT_OUTPUT_ROOT, parsed.runId);
  if (parsed.outputPath) {
    const outputPath = resolveArtifactPath(parsed.outputPath);
    if (path.extname(outputPath) === '.json') {
      parsed.outputFile = outputPath;
      parsed.outputDir = path.dirname(outputPath);
    } else {
      parsed.outputDir = outputPath;
      parsed.outputFile = path.join(outputPath, 'summary.json');
    }
  } else {
    parsed.outputDir = resolveArtifactPath(
      parsed.outputDir || defaultOutputDir,
    );
    parsed.outputFile = path.join(parsed.outputDir, 'summary.json');
  }

  return parsed;
};

function resolveArtifactPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(REPO_ROOT, value);
}

function requireValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function requirePositiveInt(argv, index, name) {
  const parsed = parsePositiveInt(requireValue(argv, index, name));
  if (parsed === undefined) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function requireNonNegativeNumber(argv, index, name) {
  const parsed = parseNonNegativeNumber(requireValue(argv, index, name));
  if (parsed === undefined) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function parsePositiveInt(value) {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeNumber(value) {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function sanitizeSegment(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .replace(/-+/g, '-');
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const percentile = (values, percentileValue) => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
};

const summarizeDurations = samples => {
  const values = samples.map(sample => sample.durationMs);
  let minMs = 0;
  let maxMs = 0;
  if (values.length > 0) {
    minMs = values[0];
    maxMs = values[0];
    for (const value of values) {
      if (value < minMs) {
        minMs = value;
      }
      if (value > maxMs) {
        maxMs = value;
      }
    }
  }

  return {
    count: values.length,
    minMs,
    maxMs,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    p99Ms: percentile(values, 99),
  };
};

const summarizeOperations = samples => {
  const grouped = {};
  for (const sample of samples) {
    grouped[sample.operation] ||= [];
    grouped[sample.operation].push(sample);
  }

  return Object.fromEntries(
    Object.entries(grouped).map(([operation, operationSamples]) => [
      operation,
      {
        ...summarizeDurations(operationSamples),
        ok: operationSamples.filter(sample => sample.ok).length,
        unexpectedErrors: operationSamples.filter(sample => !sample.ok).length,
      },
    ]),
  );
};

const jsonHeaders = {
  'content-type': 'application/json',
};

async function requestJson(baseUrl, pathname, options = {}) {
  const { timeoutMs, expectedStatus, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...fetchOptions,
      signal: controller.signal,
    });
    const text = await response.text();
    const durationMs = performance.now() - startedAt;
    const expected =
      typeof expectedStatus === 'function'
        ? expectedStatus(response.status)
        : response.status === expectedStatus;
    return {
      durationMs,
      status: response.status,
      ok: expected,
      body: parseJson(text),
      error: expected ? undefined : `Unexpected status ${response.status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause =
      error instanceof Error && error.cause
        ? `; cause=${String(error.cause)}`
        : '';
    return {
      durationMs: performance.now() - startedAt,
      status: 0,
      ok: false,
      error: `${message}${cause}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJson(text) {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function postJson(baseUrl, pathname, payload, options) {
  return requestJson(baseUrl, pathname, {
    method: 'POST',
    headers: jsonHeaders,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    ...options,
  });
}

function postRawJson(baseUrl, pathname, body, options) {
  return requestJson(baseUrl, pathname, {
    method: 'POST',
    headers: jsonHeaders,
    body,
    ...options,
  });
}

function makeContext(workerId = 0) {
  return {
    approvalToggle: workerId,
    chatCounter: workerId * 100000,
    invalidCounter: 0,
    resetCounter: 0,
  };
}

async function bootstrapOperation(baseUrl, context, options) {
  return requestJson(baseUrl, '/bff-api/effect/bootstrap', {
    expectedStatus: 200,
    timeoutMs: options.requestTimeoutMs,
  });
}

async function approvalOperation(baseUrl, context, options) {
  context.approvalToggle += 1;
  const id = context.approvalToggle % 2 === 0 ? 'ap-1002' : 'ap-1001';
  const decision = context.approvalToggle % 2 === 0 ? 'rejected' : 'approved';
  return postJson(
    baseUrl,
    `/bff-api/effect/approval/${id}/decision`,
    {
      decision,
      actor: 'load.runner',
    },
    {
      expectedStatus: 200,
      timeoutMs: options.requestTimeoutMs,
    },
  );
}

async function chatOperation(baseUrl, context, options) {
  context.chatCounter += 1;
  return postJson(
    baseUrl,
    '/bff-api/effect/chat/send',
    {
      channel:
        context.chatCounter % 2 === 0 ? 'finance-control' : 'incident-war-room',
      author: `load.runner.${context.chatCounter}`,
      text: `load event ${context.chatCounter}`,
      priority: context.chatCounter % 5 === 0 ? 'urgent' : 'normal',
    },
    {
      expectedStatus: 200,
      timeoutMs: options.requestTimeoutMs,
    },
  );
}

async function invalidOperation(baseUrl, context, options) {
  context.invalidCounter += 1;
  const before =
    options.scenario === 'invalid'
      ? await captureStableState(baseUrl, options)
      : undefined;
  if (before && !before.ok) {
    return {
      ...before,
      operation: 'invalid:preflight',
    };
  }

  const variant = invalidRequestVariant(context.invalidCounter);
  const result = await variant.run(baseUrl, options);
  const operation = `invalid:${variant.name}`;
  if (!result.ok || !before) {
    return {
      ...result,
      operation,
    };
  }

  const after = await captureStableState(baseUrl, options);
  if (!after.ok) {
    return {
      durationMs: result.durationMs + after.durationMs,
      status: after.status,
      ok: false,
      operation,
      error: `State verification failed after invalid request: ${after.error}`,
    };
  }

  const drift = diffStableState(before.state, after.state);
  return {
    ...result,
    operation,
    ok: drift.length === 0,
    error:
      drift.length === 0
        ? undefined
        : `Invalid request changed stable state: ${drift.join(', ')}`,
  };
}

async function resetOperation(baseUrl, context, options) {
  context.resetCounter += 1;
  return postJson(baseUrl, '/bff-api/effect/reset', undefined, {
    expectedStatus: 200,
    timeoutMs: options.requestTimeoutMs,
  });
}

const SCENARIOS = new Map([
  ['bootstrap', [bootstrapOperation]],
  ['approval', [approvalOperation]],
  ['chat', [chatOperation]],
  ['invalid', [invalidOperation]],
  ['reset', [resetOperation]],
  [
    'mixed',
    [
      bootstrapOperation,
      bootstrapOperation,
      chatOperation,
      chatOperation,
      approvalOperation,
      invalidOperation,
      resetOperation,
    ],
  ],
]);

const portfolioAppIds = [
  'mobility-marketplace',
  'enterprise-mega-erp',
  'mf-platform',
  'tenant-security',
  'failure-lab',
];

const portfolioPilotScenarios = [
  {
    scenario: 'grab-marketplace',
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
    chaosModes: [
      'none',
      'remote-down',
      'api-timeout',
      'chunk-404',
      'clock-skew',
      'restart-during-load',
    ],
  },
  {
    scenario: 'mega-erp-command-center',
    modules: ['orders', 'erp', 'chat', 'mf-remotes', 'security', 'billing'],
    chaosModes: [
      'none',
      'remote-down',
      'api-timeout',
      'chunk-404',
      'clock-skew',
      'restart-during-load',
    ],
  },
  {
    scenario: 'mobility-erp-chat',
    modules: ['rides', 'dispatch', 'erp', 'chat', 'security', 'billing'],
    chaosModes: [
      'none',
      'remote-down',
      'api-timeout',
      'chunk-404',
      'clock-skew',
      'restart-during-load',
    ],
  },
];

async function portfolioBootstrapOperation(baseUrl, context, options) {
  return requestJson(baseUrl, '/bff-api/effect/bootstrap', {
    expectedStatus: 200,
    timeoutMs: options.requestTimeoutMs,
  });
}

async function portfolioWorkflowOperation(baseUrl, context, options) {
  context.portfolioWorkflowCounter =
    (context.portfolioWorkflowCounter || 0) + 1;
  const appId =
    portfolioAppIds[context.portfolioWorkflowCounter % portfolioAppIds.length];
  return postJson(
    baseUrl,
    `/bff-api/effect/apps/${appId}/workflow`,
    {
      action: `load-workflow-${context.portfolioWorkflowCounter}`,
      actor: 'load.runner',
      requestId: `load-${context.workerId}-${context.portfolioWorkflowCounter}`,
    },
    {
      expectedStatus: 200,
      timeoutMs: options.requestTimeoutMs,
    },
  );
}

async function portfolioPilotOperation(baseUrl, context, options) {
  context.portfolioPilotCounter = (context.portfolioPilotCounter || 0) + 1;
  const scenario =
    portfolioPilotScenarios[
      context.portfolioPilotCounter % portfolioPilotScenarios.length
    ];
  return postJson(
    baseUrl,
    `/bff-api/effect/pilot/${scenario.scenario}/run`,
    {
      tenant: 'superapp-global',
      actor: 'load.runner',
      requestId: `load-pilot-${context.workerId}-${context.portfolioPilotCounter}`,
      modules: scenario.modules,
      chaos: 'none',
    },
    {
      expectedStatus: 200,
      timeoutMs: options.requestTimeoutMs,
    },
  );
}

async function portfolioChaosOperation(baseUrl, context, options) {
  context.portfolioChaosCounter = (context.portfolioChaosCounter || 0) + 1;
  const scenario =
    portfolioPilotScenarios[
      context.portfolioChaosCounter % portfolioPilotScenarios.length
    ];
  const chaos =
    scenario.chaosModes[
      context.portfolioChaosCounter % scenario.chaosModes.length
    ];
  return postJson(
    baseUrl,
    `/bff-api/effect/pilot/${scenario.scenario}/run`,
    {
      tenant: 'superapp-global',
      actor: 'load.runner.chaos',
      requestId: `load-chaos-${context.workerId}-${context.portfolioChaosCounter}`,
      modules: scenario.modules,
      chaos,
    },
    {
      expectedStatus: 200,
      timeoutMs: options.requestTimeoutMs,
    },
  );
}

async function portfolioInvalidOperation(baseUrl, context, options) {
  context.portfolioInvalidCounter = (context.portfolioInvalidCounter || 0) + 1;
  const before =
    options.scenario === 'invalid'
      ? await captureStableState(baseUrl, options)
      : undefined;
  if (before && !before.ok) {
    return {
      ...before,
      operation: 'portfolioInvalid:preflight',
    };
  }

  const variant = portfolioInvalidRequestVariant(
    context.portfolioInvalidCounter,
  );
  const result = await variant.run(baseUrl, options);
  const operation = `portfolioInvalid:${variant.name}`;
  if (!result.ok || !before) {
    return {
      ...result,
      operation,
    };
  }

  const after = await captureStableState(baseUrl, options);
  if (!after.ok) {
    return {
      durationMs: result.durationMs + after.durationMs,
      status: after.status,
      ok: false,
      operation,
      error: `State verification failed after invalid request: ${after.error}`,
    };
  }

  const drift = diffStableState(before.state, after.state);
  return {
    ...result,
    operation,
    ok: drift.length === 0,
    error:
      drift.length === 0
        ? undefined
        : `Invalid request changed stable state: ${drift.join(', ')}`,
  };
}

async function portfolioResetOperation(baseUrl, context, options) {
  return postJson(baseUrl, '/bff-api/effect/reset', undefined, {
    expectedStatus: 200,
    timeoutMs: options.requestTimeoutMs,
  });
}

const PORTFOLIO_SCENARIOS = new Map([
  ['bootstrap', [portfolioBootstrapOperation]],
  ['workflow', [portfolioWorkflowOperation]],
  ['pilot', [portfolioPilotOperation]],
  ['chaos', [portfolioChaosOperation]],
  ['invalid', [portfolioInvalidOperation]],
  ['reset', [portfolioResetOperation]],
  [
    'mixed',
    [
      portfolioBootstrapOperation,
      portfolioBootstrapOperation,
      portfolioWorkflowOperation,
      portfolioPilotOperation,
      portfolioPilotOperation,
      portfolioChaosOperation,
      portfolioInvalidOperation,
      portfolioResetOperation,
    ],
  ],
]);

const TARGET_SCENARIOS = new Map([
  ['erp', SCENARIOS],
  ['portfolio', PORTFOLIO_SCENARIOS],
]);

function invalidRequestVariant(counter) {
  const variants = [
    {
      name: 'chat-priority',
      run: (baseUrl, options) =>
        postJson(
          baseUrl,
          '/bff-api/effect/chat/send',
          {
            channel: 'incident-war-room',
            author: 'load.runner.invalid',
            text: 'invalid priority should be rejected',
            priority: 'critical',
          },
          {
            expectedStatus: status => status >= 400,
            timeoutMs: options.requestTimeoutMs,
          },
        ),
    },
    {
      name: 'approval-missing-actor',
      run: (baseUrl, options) =>
        postJson(
          baseUrl,
          '/bff-api/effect/approval/ap-1001/decision',
          {
            decision: 'approved',
          },
          {
            expectedStatus: status => status >= 400,
            timeoutMs: options.requestTimeoutMs,
          },
        ),
    },
    {
      name: 'approval-unknown-id',
      run: (baseUrl, options) =>
        postJson(
          baseUrl,
          '/bff-api/effect/approval/ap-missing/decision',
          {
            decision: 'approved',
            actor: 'load.runner.invalid',
          },
          {
            expectedStatus: status => status >= 400,
            timeoutMs: options.requestTimeoutMs,
          },
        ),
    },
    {
      name: 'malformed-json',
      run: (baseUrl, options) =>
        postRawJson(baseUrl, '/bff-api/effect/chat/send', '{', {
          expectedStatus: status => status >= 400,
          timeoutMs: options.requestTimeoutMs,
        }),
    },
  ];
  return variants[(counter - 1) % variants.length];
}

function portfolioInvalidRequestVariant(counter) {
  const variants = [
    {
      name: 'unknown-tenant',
      run: (baseUrl, options) =>
        postJson(
          baseUrl,
          '/bff-api/effect/pilot/grab-marketplace/run',
          {
            tenant: 'missing-tenant',
            actor: 'load.runner.invalid',
            requestId: `invalid-tenant-${counter}`,
            modules: ['rides'],
            chaos: 'none',
          },
          {
            expectedStatus: status => status >= 400,
            timeoutMs: options.requestTimeoutMs,
          },
        ),
    },
    {
      name: 'tenant-boundary',
      run: (baseUrl, options) =>
        postJson(
          baseUrl,
          '/bff-api/effect/pilot/mobility-erp-chat/run',
          {
            tenant: 'city-ops-eu',
            actor: 'load.runner.invalid',
            requestId: `invalid-boundary-${counter}`,
            modules: ['rides', 'erp'],
            chaos: 'none',
          },
          {
            expectedStatus: status => status >= 400,
            timeoutMs: options.requestTimeoutMs,
          },
        ),
    },
    {
      name: 'missing-required-module',
      run: (baseUrl, options) =>
        postJson(
          baseUrl,
          '/bff-api/effect/pilot/mega-erp-command-center/run',
          {
            tenant: 'superapp-global',
            actor: 'load.runner.invalid',
            requestId: `invalid-modules-${counter}`,
            modules: ['erp'],
            chaos: 'none',
          },
          {
            expectedStatus: status => status >= 400,
            timeoutMs: options.requestTimeoutMs,
          },
        ),
    },
    {
      name: 'malformed-json',
      run: (baseUrl, options) =>
        postRawJson(
          baseUrl,
          '/bff-api/effect/pilot/grab-marketplace/run',
          '{',
          {
            expectedStatus: status => status >= 400,
            timeoutMs: options.requestTimeoutMs,
          },
        ),
    },
  ];
  return variants[(counter - 1) % variants.length];
}

async function captureStableState(baseUrl, options) {
  const result = await bootstrapOperation(baseUrl, makeContext(), options);
  if (!result.ok) {
    return {
      durationMs: result.durationMs,
      status: result.status,
      ok: false,
      error: result.error || `Unexpected status ${result.status}`,
    };
  }
  return {
    durationMs: result.durationMs,
    status: result.status,
    ok: true,
    state: normalizeStableState(result.body),
  };
}

function normalizeStableState(body) {
  if (body?.apps || body?.pilotRuns) {
    return {
      summary: body?.summary,
      apps: body?.apps,
      events: body?.events,
      pilotRuns: body?.pilotRuns,
    };
  }

  return {
    summary: body?.summary,
    approvals: body?.approvals,
    chat: body?.chat,
  };
}

function diffStableState(before, after) {
  const drift = [];
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  for (const key of keys) {
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) {
      drift.push(key);
    }
  }
  return drift;
}

async function worker(id, options, samples, deadline) {
  const context = makeContext(id);
  context.workerId = id;
  const operations = TARGET_SCENARIOS.get(options.target).get(options.scenario);
  let operationIndex = id;

  while (Date.now() < deadline) {
    const operation = operations[operationIndex % operations.length];
    operationIndex += 1;
    const result = await operation(options.baseUrl, context, options);
    samples.push({
      worker: id,
      operation: result.operation || operation.name.replace(/Operation$/, ''),
      durationMs: result.durationMs,
      status: result.status,
      ok: result.ok,
      error: result.error,
    });
  }
}

async function ensureHealthy(options) {
  const reset = await resetOperation(options.baseUrl, makeContext(), options);
  if (!reset.ok) {
    throw new Error(
      `SuperApp ERP reset failed before load run: status=${reset.status}; error=${reset.error}`,
    );
  }
  const bootstrap = await bootstrapOperation(
    options.baseUrl,
    makeContext(),
    options,
  );
  if (!bootstrap.ok) {
    throw new Error(
      `SuperApp ERP bootstrap failed before load run: status=${bootstrap.status}; error=${bootstrap.error}`,
    );
  }
}

async function cleanup(options) {
  const reset = await resetOperation(options.baseUrl, makeContext(), options);
  return {
    reset: {
      ok: reset.ok,
      status: reset.status,
      durationMs: reset.durationMs,
      error: reset.error,
    },
  };
}

function evaluateBudgets(summary) {
  const failures = [];
  if (summary.durations.p95Ms > summary.budgets.p95Ms) {
    failures.push(
      `p95 ${Math.round(summary.durations.p95Ms)}ms exceeds ${summary.budgets.p95Ms}ms`,
    );
  }
  if (summary.durations.maxMs > summary.budgets.maxMs) {
    failures.push(
      `max ${Math.round(summary.durations.maxMs)}ms exceeds ${summary.budgets.maxMs}ms`,
    );
  }
  if (summary.unexpectedErrorRate > summary.budgets.maxErrorRate) {
    failures.push(
      `unexpected error rate ${summary.unexpectedErrorRate} exceeds ${summary.budgets.maxErrorRate}`,
    );
  }
  return failures;
}

function writeSummary(
  options,
  samples,
  cleanupResult,
  startedAt,
  eventLoopDelay,
) {
  eventLoopDelay.disable();
  const finishedAt = Date.now();
  const unexpectedErrors = samples.filter(sample => !sample.ok);
  const summary = {
    schemaVersion: 1,
    suite: `superapp-${options.target}-load`,
    runId: options.runId,
    target: options.target,
    scenario: options.scenario,
    baseUrl: options.baseUrl,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    parameters: {
      durationMs: options.durationMs,
      concurrency: options.concurrency,
      requestTimeoutMs: options.requestTimeoutMs,
    },
    budgets: {
      p95Ms: options.p95Ms,
      maxMs: options.maxMs,
      maxErrorRate: options.maxErrorRate,
    },
    requestCount: samples.length,
    okCount: samples.length - unexpectedErrors.length,
    unexpectedErrorCount: unexpectedErrors.length,
    unexpectedErrorRate:
      samples.length === 0 ? 0 : unexpectedErrors.length / samples.length,
    durations: summarizeDurations(samples),
    operations: summarizeOperations(samples),
    eventLoopDelay: {
      minMs: eventLoopDelay.min / 1_000_000,
      maxMs: eventLoopDelay.max / 1_000_000,
      meanMs: eventLoopDelay.mean / 1_000_000,
      p95Ms: eventLoopDelay.percentile(95) / 1_000_000,
      p99Ms: eventLoopDelay.percentile(99) / 1_000_000,
    },
    cleanup: cleanupResult,
    unexpectedErrors: unexpectedErrors.slice(0, 20),
  };
  summary.budgetFailures = evaluateBudgets(summary);

  fs.mkdirSync(options.outputDir, { recursive: true });
  fs.writeFileSync(options.outputFile, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const samples = [];
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  eventLoopDelay.enable();

  await ensureHealthy(options);
  const deadline = Date.now() + options.durationMs;
  await Promise.all(
    Array.from({ length: options.concurrency }, (_, index) =>
      worker(index + 1, options, samples, deadline),
    ),
  );

  const cleanupResult = await cleanup(options);
  const summary = writeSummary(
    options,
    samples,
    cleanupResult,
    startedAt,
    eventLoopDelay,
  );
  console.log(
    JSON.stringify(
      {
        summaryPath: options.outputFile,
        requestCount: summary.requestCount,
        p95Ms: Math.round(summary.durations.p95Ms),
        maxMs: Math.round(summary.durations.maxMs),
        unexpectedErrorCount: summary.unexpectedErrorCount,
        budgetFailures: summary.budgetFailures,
      },
      null,
      2,
    ),
  );

  if (summary.budgetFailures.length > 0) {
    process.exitCode = 1;
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
