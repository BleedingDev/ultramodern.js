const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createLocalControlPlanePlan } = require('../run-local-control-plane');

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
