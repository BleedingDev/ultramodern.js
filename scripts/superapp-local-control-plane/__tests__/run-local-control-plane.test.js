const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  createLocalControlPlanePlan,
  runLocalControlPlane,
  waitForHttp,
} = require('../run-local-control-plane');

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-control-'));
  writeJson(root, 'topology/reference-topology.json', {
    shell: {
      id: 'shell-super-app',
      package: '@demo/shell-super-app',
    },
    remotes: [
      {
        id: 'remote-commerce',
        kind: 'vertical',
        package: '@demo/remote-commerce',
        moduleFederation: {
          manifestUrl: 'http://localhost:3021/mf-manifest.json',
        },
      },
      {
        id: 'remote-design-system',
        kind: 'horizontal-design-system',
        package: '@demo/remote-design-system',
        moduleFederation: {
          manifestUrl: 'http://localhost:3023/mf-manifest.json',
        },
      },
    ],
    effectServices: [
      {
        id: 'service-recommendations-effect',
        package: '@demo/service-recommendations-effect',
      },
    ],
  });
  writeJson(root, 'topology/ownership.json', {
    owners: [
      { id: 'shell-super-app', path: 'apps/shell-super-app' },
      { id: 'remote-commerce', path: 'apps/remotes/remote-commerce' },
      {
        id: 'remote-design-system',
        path: 'apps/remotes/remote-design-system',
      },
      {
        id: 'service-recommendations-effect',
        path: 'services/service-recommendations-effect',
      },
    ],
  });
  writeJson(root, 'topology/local-overlays/development.json', {
    ports: {
      'shell-super-app': 3020,
      'remote-commerce': 3021,
      'remote-design-system': 3023,
      'service-recommendations-effect': 3030,
    },
    services: {
      'service-recommendations-effect':
        'http://localhost:3030/recommendations-api',
    },
  });
  return root;
}

function createOwnedDirectories(root) {
  for (const relativePath of [
    'apps/shell-super-app',
    'apps/remotes/remote-commerce',
    'apps/remotes/remote-design-system',
    'services/service-recommendations-effect',
  ]) {
    fs.mkdirSync(path.join(root, relativePath), { recursive: true });
  }
}

function createHttpServerCommand(options = {}) {
  const script = [
    "const fs = require('node:fs');",
    "const http = require('node:http');",
    'const port = Number(process.env.PORT);',
    options.markReadyFile
      ? "if (process.env.ULTRAMODERN_TEST_READY_MARKER) { fs.mkdirSync(require('node:path').dirname(process.env.ULTRAMODERN_TEST_READY_MARKER), { recursive: true }); fs.writeFileSync(process.env.ULTRAMODERN_TEST_READY_MARKER, 'ready'); }"
      : '',
    'const server = http.createServer((request, response) => {',
    "if (process.env.ULTRAMODERN_TEST_WAIT_FOR_MARKER === '1' && !fs.existsSync(process.env.ULTRAMODERN_TEST_READY_MARKER || '')) {",
    'response.statusCode = 503;',
    "response.end('waiting');",
    'return;',
    '}',
    "response.end('ok');",
    '});',
    "server.listen(port, '127.0.0.1');",
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
  ].join('');
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

function writeSpawnSafeCommands(root) {
  const command = createHttpServerCommand();
  const overlayPath = path.join(
    root,
    'topology/local-overlays/development.json',
  );
  const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf-8'));
  overlay.commands = {
    'shell-super-app': command,
    'remote-commerce': command,
    'remote-design-system': command,
    'service-recommendations-effect': command,
  };
  writeJson(root, 'topology/local-overlays/development.json', overlay);
}

function writeShellDependsOnRemoteCommands(root) {
  const marker = path.join(root, '.modern/test-ready-marker');
  const overlayPath = path.join(
    root,
    'topology/local-overlays/development.json',
  );
  const overlay = JSON.parse(fs.readFileSync(overlayPath, 'utf-8'));
  overlay.commands = {
    'shell-super-app': createHttpServerCommand(),
    'remote-commerce': createHttpServerCommand({ markReadyFile: true }),
    'remote-design-system': createHttpServerCommand(),
    'service-recommendations-effect': createHttpServerCommand(),
  };
  overlay.env = {
    'shell-super-app': {
      ULTRAMODERN_TEST_READY_MARKER: marker,
      ULTRAMODERN_TEST_WAIT_FOR_MARKER: '1',
    },
    'remote-commerce': {
      ULTRAMODERN_TEST_READY_MARKER: marker,
    },
  };
  writeJson(root, 'topology/local-overlays/development.json', overlay);
}

test('creates a dry-run process plan from topology and ownership metadata', () => {
  const root = createWorkspace();
  try {
    const plan = createLocalControlPlanePlan({ workspace: root });
    assert.equal(plan.mode, 'dry-run');
    assert.equal(plan.summary.total, 4);
    assert.equal(plan.summary.planned, 4);
    assert.deepEqual(
      plan.processes.map(process => [process.id, process.role, process.port]),
      [
        ['shell-super-app', 'shell', 3020],
        ['remote-commerce', 'remote', 3021],
        ['remote-design-system', 'design-system-remote', 3023],
        ['service-recommendations-effect', 'effect-service', 3030],
      ],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dry-run remains the default mode', () => {
  const root = createWorkspace();
  try {
    const plan = createLocalControlPlanePlan({ workspace: root });
    assert.equal(plan.mode, 'dry-run');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('applies rehearsal overlays without launching processes', () => {
  const root = createWorkspace();
  try {
    const versionSkew = createLocalControlPlanePlan({
      workspace: root,
      overlay: 'version-skew',
    });
    assert.equal(
      versionSkew.processes.find(process => process.id === 'remote-commerce')
        .env.ULTRAMODERN_VERSION_SKEW,
      '1',
    );
    const serviceUnavailable = createLocalControlPlanePlan({
      workspace: root,
      overlay: 'service-unavailable',
    });
    assert.equal(
      serviceUnavailable.processes.find(
        process => process.id === 'service-recommendations-effect',
      ).readiness.status,
      'disabled-by-overlay',
    );
    assert.equal(serviceUnavailable.summary.disabled, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('applies service-unavailable overlay to full-stack vertical BFF remotes', () => {
  const root = createWorkspace();
  try {
    const topologyPath = path.join(root, 'topology/reference-topology.json');
    const topology = JSON.parse(fs.readFileSync(topologyPath, 'utf-8'));
    topology.remotes[0].api = { effect: { runtime: 'effect' } };
    topology.effectServices = [];
    writeJson(root, 'topology/reference-topology.json', topology);

    const serviceUnavailable = createLocalControlPlanePlan({
      workspace: root,
      overlay: 'service-unavailable',
    });

    const commerce = serviceUnavailable.processes.find(
      process => process.id === 'remote-commerce',
    );
    assert.deepEqual(commerce.capabilities, [
      'module-federation',
      'effect-bff',
    ]);
    assert.equal(commerce.readiness.status, 'disabled-by-overlay');
    assert.equal(commerce.env.ULTRAMODERN_SERVICE_UNAVAILABLE, '1');
    assert.equal(serviceUnavailable.summary.disabled, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('live mode launches spawn-safe process descriptors, probes readiness, captures logs, and tears down', async () => {
  const root = createWorkspace();
  try {
    createOwnedDirectories(root);
    writeSpawnSafeCommands(root);

    const result = await runLocalControlPlane({
      workspace: root,
      mode: 'live',
      readinessTimeoutMs: 5000,
      readinessIntervalMs: 50,
      teardownTimeoutMs: 2000,
    });

    assert.equal(result.mode, 'live');
    assert.equal(result.status, 'pass');
    assert.equal(result.summary.ready, 4);
    assert.equal(result.summary.failed, 0);
    assert.deepEqual(result.failures, []);
    for (const processDescriptor of result.processes) {
      assert.equal(processDescriptor.readiness.status, 'ready');
      assert.equal(processDescriptor.teardown.status, 'stopped');
      assert.equal(processDescriptor.env.PORT, String(processDescriptor.port));
      assert.ok(fs.existsSync(processDescriptor.logs.stdoutPath));
      assert.ok(fs.existsSync(processDescriptor.logs.stderrPath));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('live mode starts the whole topology before probing readiness', async () => {
  const root = createWorkspace();
  try {
    createOwnedDirectories(root);
    writeShellDependsOnRemoteCommands(root);

    const result = await runLocalControlPlane({
      workspace: root,
      mode: 'live',
      readinessTimeoutMs: 5000,
      readinessIntervalMs: 50,
      teardownTimeoutMs: 2000,
    });

    assert.equal(result.status, 'pass');
    assert.equal(result.summary.ready, 4);
    assert.deepEqual(result.failures, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readiness requires a successful HTTP status', async () => {
  const server = http.createServer((request, response) => {
    response.statusCode = 404;
    response.end('missing');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const result = await waitForHttp(`http://127.0.0.1:${address.port}/`, {
      timeoutMs: 150,
      intervalMs: 25,
      requestTimeoutMs: 100,
    });

    assert.equal(result.ok, false);
    assert.equal(result.classification, 'readiness-timeout');
    assert.match(result.error, /404/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('live mode reports package-install preconditions before pnpm dev startup', async () => {
  const root = createWorkspace();
  try {
    createOwnedDirectories(root);

    const result = await runLocalControlPlane({
      workspace: root,
      mode: 'live',
      readinessTimeoutMs: 100,
    });

    assert.equal(result.status, 'fail');
    assert.equal(result.summary.failed, 4);
    assert.equal(result.failures.length, 4);
    assert.deepEqual(
      new Set(result.failures.map(failure => failure.classification)),
      new Set(['missing-install']),
    );
    assert.equal(
      result.processes.find(process => process.id === 'shell-super-app')
        .teardown.status,
      'skipped',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
