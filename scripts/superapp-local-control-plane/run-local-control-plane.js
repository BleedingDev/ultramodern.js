#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const OVERLAYS = new Set([
  'none',
  'remote-unavailable',
  'version-skew',
  'design-system-bad-release',
  'service-unavailable',
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function normalize(filePath) {
  return filePath.split(path.sep).join('/');
}

function packageFilter(packageName) {
  return packageName ? `--filter ${packageName}` : '';
}

function portFromUrl(value) {
  if (!value) {
    return undefined;
  }
  try {
    return Number(new URL(value).port) || undefined;
  } catch {
    return undefined;
  }
}

function buildOwnerMap(workspace) {
  const ownershipPath = path.join(workspace, 'topology/ownership.json');
  if (!fs.existsSync(ownershipPath)) {
    return new Map();
  }
  return new Map(
    readJson(ownershipPath).owners.map(owner => [owner.id, owner]),
  );
}

function readDevelopmentOverlay(workspace) {
  const overlayPath = path.join(
    workspace,
    'topology/local-overlays/development.json',
  );
  return fs.existsSync(overlayPath) ? readJson(overlayPath) : {};
}

function createProcessDescriptor(input) {
  const cwd = input.path ? normalize(input.path) : '.';
  const command =
    input.command || `pnpm ${packageFilter(input.package)} dev`.trim();
  return {
    id: input.id,
    role: input.role,
    package: input.package,
    cwd,
    command,
    port: input.port,
    healthUrl:
      input.healthUrl ||
      (input.port ? `http://localhost:${input.port}/` : undefined),
    env: input.env || {},
    logs: {
      stdout: `.modern/superapp-local-control-plane/${input.id}/stdout.log`,
      stderr: `.modern/superapp-local-control-plane/${input.id}/stderr.log`,
    },
    readiness: {
      status: input.disabled ? 'disabled-by-overlay' : 'planned',
      timeoutMs: 60000,
    },
    teardown: {
      status: 'not-started',
    },
  };
}

function applyOverlay(processes, overlay) {
  if (overlay === 'none') {
    return processes;
  }
  return processes.map(process => {
    const next = {
      ...process,
      env: { ...process.env },
      readiness: { ...process.readiness },
    };
    if (overlay === 'remote-unavailable' && process.role === 'remote') {
      next.readiness.status = 'disabled-by-overlay';
      next.env.ULTRAMODERN_REMOTE_UNAVAILABLE = '1';
    }
    if (
      overlay === 'version-skew' &&
      (process.role === 'shell' || process.role === 'remote')
    ) {
      next.env.ULTRAMODERN_VERSION_SKEW = '1';
    }
    if (
      overlay === 'design-system-bad-release' &&
      process.role === 'design-system-remote'
    ) {
      next.env.ULTRAMODERN_DESIGN_SYSTEM_BAD_RELEASE = '1';
      next.readiness.status = 'disabled-by-overlay';
    }
    if (
      overlay === 'service-unavailable' &&
      process.role === 'effect-service'
    ) {
      next.env.ULTRAMODERN_SERVICE_UNAVAILABLE = '1';
      next.readiness.status = 'disabled-by-overlay';
    }
    return next;
  });
}

function createLocalControlPlanePlan(options = {}) {
  const workspace = path.resolve(options.workspace || process.cwd());
  const topologyPath = path.resolve(
    workspace,
    options.topology || 'topology/reference-topology.json',
  );
  const overlay = options.overlay || 'none';
  if (!OVERLAYS.has(overlay)) {
    throw new Error(`Unsupported local control-plane overlay: ${overlay}`);
  }
  const topology = readJson(topologyPath);
  const owners = buildOwnerMap(workspace);
  const devOverlay = readDevelopmentOverlay(workspace);
  const processes = [];
  const shellOwner = owners.get(topology.shell?.id);
  processes.push(
    createProcessDescriptor({
      id: topology.shell.id,
      role: 'shell',
      package: topology.shell.package,
      path: shellOwner?.path,
      port: devOverlay.ports?.[topology.shell.id],
    }),
  );
  for (const remote of topology.remotes || []) {
    const owner = owners.get(remote.id);
    processes.push(
      createProcessDescriptor({
        id: remote.id,
        role:
          remote.kind === 'horizontal-design-system'
            ? 'design-system-remote'
            : 'remote',
        package: remote.package,
        path: owner?.path,
        port:
          devOverlay.ports?.[remote.id] ||
          portFromUrl(remote.moduleFederation?.manifestUrl),
      }),
    );
  }
  for (const service of topology.effectServices || []) {
    const owner = owners.get(service.id);
    processes.push(
      createProcessDescriptor({
        id: service.id,
        role: 'effect-service',
        package: service.package,
        path: owner?.path,
        port: devOverlay.ports?.[service.id],
        healthUrl:
          devOverlay.services?.[service.id] ||
          (devOverlay.ports?.[service.id]
            ? `http://localhost:${devOverlay.ports[service.id]}/`
            : undefined),
      }),
    );
  }
  const plannedProcesses = applyOverlay(processes, overlay);
  return {
    schemaVersion: 1,
    mode: 'dry-run',
    workspace,
    topology: normalize(path.relative(workspace, topologyPath)),
    overlay,
    processes: plannedProcesses,
    summary: {
      total: plannedProcesses.length,
      planned: plannedProcesses.filter(
        process => process.readiness.status === 'planned',
      ).length,
      disabled: plannedProcesses.filter(
        process => process.readiness.status === 'disabled-by-overlay',
      ).length,
    },
  };
}

function parseArgs(argv) {
  const options = {
    workspace: process.cwd(),
    topology: 'topology/reference-topology.json',
    overlay: 'none',
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') {
      options.workspace = argv[++index];
    } else if (arg === '--topology') {
      options.topology = argv[++index];
    } else if (arg === '--overlay') {
      options.overlay = argv[++index];
    } else if (arg === '--json') {
      options.json = true;
    }
  }
  return options;
}

function renderHuman(plan) {
  return [
    `UltraModern local control plane: ${plan.mode}`,
    `Overlay: ${plan.overlay}`,
    `Processes: ${plan.summary.planned}/${plan.summary.total} planned`,
    ...plan.processes.map(
      process =>
        `- ${process.role} ${process.id}: ${process.command} (${process.readiness.status})`,
    ),
  ].join('\n');
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  const plan = createLocalControlPlanePlan(options);
  process.stdout.write(
    options.json
      ? `${JSON.stringify(plan, null, 2)}\n`
      : `${renderHuman(plan)}\n`,
  );
}

module.exports = {
  OVERLAYS,
  createLocalControlPlanePlan,
  renderHuman,
};
