#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_TANSTACK_ROUTER = '1.169.2';
const DEPRECATED_TANSTACK_MARKERS = [
  '@modern-js/runtime/tanstack-router',
  'tanstackRouter',
  'tanstackSsrScript',
  'tanstackMatchedModernRouteIds',
];

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function relative(workspace, filePath) {
  return path.relative(workspace, filePath).split(path.sep).join('/');
}

function slug(value) {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
}

function createCheck(id, ok, details) {
  return {
    id,
    status: ok ? 'pass' : 'fail',
    severity: ok ? 'info' : details.severity || 'error',
    message: details.message,
    file: details.file,
    path: details.path,
    expected: details.expected,
    actual: details.actual,
    suggestion: details.suggestion,
  };
}

function listFiles(root, predicate = () => true) {
  if (!exists(root)) {
    return [];
  }
  const files = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && predicate(entryPath)) {
        files.push(entryPath);
      }
    }
  };
  walk(root);
  return files;
}

function checkRootPackage(workspace) {
  const file = path.join(workspace, 'package.json');
  if (!exists(file)) {
    return [
      createCheck('root-package', false, {
        file: 'package.json',
        message: 'Root package.json is missing.',
        suggestion:
          'Generate the workspace with @modern-js/create --ultramodern-workspace.',
      }),
    ];
  }
  const pkg = readJson(file);
  return [
    createCheck(
      'root-preset-ultramodern',
      pkg.modernjs?.preset === 'presetUltramodern',
      {
        file: 'package.json',
        path: 'modernjs.preset',
        message: 'Root package declares presetUltramodern.',
        expected: 'presetUltramodern',
        actual: pkg.modernjs?.preset,
        suggestion: 'Set package.json modernjs.preset to presetUltramodern.',
      },
    ),
  ];
}

function checkTemplateManifest(workspace) {
  const file = path.join(
    workspace,
    '.modernjs/ultramodern-workspace-template-manifest.json',
  );
  if (!exists(file)) {
    return [
      createCheck('template-manifest', false, {
        file: '.modernjs/ultramodern-workspace-template-manifest.json',
        message: 'Template manifest evidence is missing.',
        suggestion:
          'Keep the generated .modernjs template manifest in the workspace.',
      }),
    ];
  }
  const manifest = readJson(file);
  return [
    createCheck(
      'template-manifest-id',
      manifest.template?.id === 'modernjs-ultramodern-superapp-workspace',
      {
        file: relative(workspace, file),
        path: 'template.id',
        message:
          'Template manifest identifies the UltraModern workspace template.',
        expected: 'modernjs-ultramodern-superapp-workspace',
        actual: manifest.template?.id,
        suggestion:
          'Regenerate the workspace or restore the generated template manifest.',
      },
    ),
  ];
}

function checkTopology(workspace) {
  const file = path.join(workspace, 'topology/reference-topology.json');
  if (!exists(file)) {
    return [
      createCheck('topology', false, {
        file: 'topology/reference-topology.json',
        message: 'Reference topology is missing.',
        suggestion:
          'Restore topology/reference-topology.json from the generated workspace.',
      }),
    ];
  }
  const topology = readJson(file);
  return [
    createCheck('topology-preset', topology.preset === 'presetUltramodern', {
      file: relative(workspace, file),
      path: 'preset',
      message: 'Topology declares presetUltramodern.',
      expected: 'presetUltramodern',
      actual: topology.preset,
      suggestion: 'Set topology.preset to presetUltramodern.',
    }),
    createCheck('topology-shell', Boolean(topology.shell?.id), {
      file: relative(workspace, file),
      path: 'shell.id',
      message: 'Topology declares a shell.',
      suggestion: 'Add shell metadata with a stable shell id.',
    }),
    createCheck('topology-remotes', (topology.remotes || []).length >= 3, {
      file: relative(workspace, file),
      path: 'remotes',
      message: 'Topology declares vertical and design-system remotes.',
      expected: 'at least 3 remotes',
      actual: (topology.remotes || []).length,
      suggestion: 'Include two vertical remotes and one design-system remote.',
    }),
    createCheck(
      'topology-design-system-remote',
      (topology.remotes || []).some(
        remote => remote.kind === 'horizontal-design-system',
      ),
      {
        file: relative(workspace, file),
        path: 'remotes',
        message:
          'Topology declares the design system as a Module Federation remote.',
        suggestion: 'Add a remote with kind horizontal-design-system.',
      },
    ),
    createCheck(
      'topology-effect-service',
      (topology.effectServices || []).length > 0,
      {
        file: relative(workspace, file),
        path: 'effectServices',
        message: 'Topology declares at least one Effect service.',
        suggestion:
          'Add an Effect service boundary to topology.effectServices.',
      },
    ),
  ];
}

function checkOwnership(workspace) {
  const file = path.join(workspace, 'topology/ownership.json');
  if (!exists(file)) {
    return [
      createCheck('ownership', false, {
        file: 'topology/ownership.json',
        message: 'Ownership metadata is missing.',
        suggestion:
          'Restore topology/ownership.json from the generated workspace.',
      }),
    ];
  }
  const ownership = readJson(file);
  return [
    createCheck('ownership-owners', (ownership.owners || []).length > 0, {
      file: relative(workspace, file),
      path: 'owners',
      message: 'Ownership metadata declares owners.',
      suggestion:
        'Add owners with team, slack, pagerDuty, runbookRef, and blastRadius.',
    }),
  ];
}

function checkAppPackages(workspace) {
  const topologyFile = path.join(workspace, 'topology/reference-topology.json');
  if (!exists(topologyFile)) {
    return [];
  }
  const topology = readJson(topologyFile);
  const ownershipFile = path.join(workspace, 'topology/ownership.json');
  const ownership = exists(ownershipFile)
    ? readJson(ownershipFile)
    : { owners: [] };
  const ownersById = new Map(
    (ownership.owners || []).map(owner => [owner.id, owner]),
  );
  const ids = [
    topology.shell?.id,
    ...(topology.remotes || []).map(r => r.id),
  ].filter(Boolean);
  const checks = [];
  for (const id of ids) {
    const owner = ownersById.get(id);
    const packageFile = owner?.path
      ? path.join(workspace, owner.path, 'package.json')
      : null;
    if (!packageFile || !exists(packageFile)) {
      checks.push(
        createCheck(`package-${id}`, false, {
          file: owner?.path
            ? `${owner.path}/package.json`
            : 'topology/ownership.json',
          message: `${id} package.json is missing.`,
          suggestion:
            'Keep ownership paths aligned with generated package locations.',
        }),
      );
      continue;
    }
    const pkg = readJson(packageFile);
    checks.push(
      createCheck(
        `tanstack-plugin-${id}`,
        pkg.dependencies?.['@modern-js/plugin-tanstack'] === 'workspace:*',
        {
          file: relative(workspace, packageFile),
          path: 'dependencies.@modern-js/plugin-tanstack',
          message: `${id} uses @modern-js/plugin-tanstack.`,
          expected: 'workspace:*',
          actual: pkg.dependencies?.['@modern-js/plugin-tanstack'],
          suggestion:
            'Use @modern-js/plugin-tanstack as the TanStack runtime path.',
        },
      ),
      createCheck(
        `tanstack-version-${id}`,
        pkg.dependencies?.['@tanstack/react-router'] ===
          EXPECTED_TANSTACK_ROUTER,
        {
          file: relative(workspace, packageFile),
          path: 'dependencies.@tanstack/react-router',
          message: `${id} uses the latest approved TanStack Router version.`,
          expected: EXPECTED_TANSTACK_ROUTER,
          actual: pkg.dependencies?.['@tanstack/react-router'],
          suggestion: `Update @tanstack/react-router to ${EXPECTED_TANSTACK_ROUTER}.`,
        },
      ),
    );
  }
  return checks;
}

function checkEffectService(workspace) {
  const topologyFile = path.join(workspace, 'topology/reference-topology.json');
  if (!exists(topologyFile)) {
    return [];
  }
  const topology = readJson(topologyFile);
  const ownershipFile = path.join(workspace, 'topology/ownership.json');
  const ownership = exists(ownershipFile)
    ? readJson(ownershipFile)
    : { owners: [] };
  const ownersById = new Map(
    (ownership.owners || []).map(owner => [owner.id, owner]),
  );
  const service = (topology.effectServices || [])[0];
  if (!service) {
    return [];
  }
  const owner = ownersById.get(service.id);
  const serviceRoot = owner?.path ? path.join(workspace, owner.path) : null;
  const config = serviceRoot
    ? path.join(serviceRoot, 'modern.config.ts')
    : null;
  const sharedApi = serviceRoot
    ? path.join(serviceRoot, 'shared/effect/api.ts')
    : null;
  const entry = serviceRoot
    ? path.join(serviceRoot, 'api/effect/index.ts')
    : null;
  return [
    createCheck(
      'effect-service-config',
      Boolean(
        config &&
          exists(config) &&
          readText(config).includes("runtimeFramework: 'effect'"),
      ),
      {
        file: config ? relative(workspace, config) : 'topology/ownership.json',
        message: 'Effect service config uses the Effect runtime framework.',
        expected: "runtimeFramework: 'effect'",
        actual: config && exists(config) ? 'present' : 'missing',
        suggestion: 'Configure the service BFF runtimeFramework as effect.',
      },
    ),
    createCheck('effect-shared-api', Boolean(sharedApi && exists(sharedApi)), {
      file: sharedApi
        ? relative(workspace, sharedApi)
        : 'topology/ownership.json',
      message: 'Effect service exposes shared API metadata.',
      suggestion: 'Keep shared/effect/api.ts in the generated Effect service.',
    }),
    createCheck(
      'effect-entry',
      Boolean(
        entry && exists(entry) && readText(entry).includes('defineEffectBff'),
      ),
      {
        file: entry ? relative(workspace, entry) : 'topology/ownership.json',
        message: 'Effect service entry uses defineEffectBff.',
        expected: 'defineEffectBff',
        suggestion: 'Implement the service with defineEffectBff.',
      },
    ),
  ];
}

function checkDeprecatedMarkers(workspace) {
  const files = listFiles(workspace, filePath =>
    /\.(ts|tsx|js|mjs|json)$/.test(filePath),
  );
  const checks = [];
  for (const marker of DEPRECATED_TANSTACK_MARKERS) {
    const matcher =
      marker === '@modern-js/runtime/tanstack-router'
        ? content => content.includes(marker)
        : content =>
            new RegExp(`(^|[^A-Za-z0-9_$])${marker}\\s*[:?=]`, 'm').test(
              content,
            );
    const offenders = files
      .filter(filePath => matcher(readText(filePath)))
      .map(filePath => relative(workspace, filePath));
    checks.push(
      createCheck(`deprecated-marker-${slug(marker)}`, offenders.length === 0, {
        message: `Generated workspace avoids deprecated TanStack marker ${marker}.`,
        expected: 'no matches',
        actual: offenders,
        suggestion:
          'Use @modern-js/plugin-tanstack/runtime and generic router runtime fields.',
      }),
    );
  }
  return checks;
}

function checkSharedPackageBoundaries(workspace) {
  const packageFiles = listFiles(path.join(workspace, 'packages'), filePath =>
    filePath.endsWith('package.json'),
  );
  return packageFiles.map(packageFile => {
    const pkg = readJson(packageFile);
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    const forbidden = [
      '@module-federation/modern-js-v3',
      '@modern-js/plugin-bff',
      '@modern-js/plugin-tanstack',
    ].filter(dep => deps[dep]);
    return createCheck(
      `shared-boundary-${pkg.name || relative(workspace, packageFile)}`,
      forbidden.length === 0,
      {
        file: relative(workspace, packageFile),
        path: 'dependencies',
        message: 'Shared package does not own app/runtime plugin roles.',
        expected: 'no app/runtime plugin deps',
        actual: forbidden,
        suggestion:
          'Move app/runtime plugins to shell, remote, or service packages.',
      },
    );
  });
}

function runUltramodernContractDoctor(options = {}) {
  const workspace = path.resolve(options.workspace || process.cwd());
  const checks = [
    ...checkRootPackage(workspace),
    ...checkTemplateManifest(workspace),
    ...checkTopology(workspace),
    ...checkOwnership(workspace),
    ...checkAppPackages(workspace),
    ...checkEffectService(workspace),
    ...checkDeprecatedMarkers(workspace),
    ...checkSharedPackageBoundaries(workspace),
  ];
  const failed = checks.filter(check => check.status === 'fail');
  return {
    schemaVersion: 1,
    status: failed.length > 0 ? 'fail' : 'pass',
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length,
    },
    checks,
  };
}

function renderHuman(result) {
  const lines = [
    `UltraModern contract doctor: ${result.status}`,
    `Checks: ${result.summary.passed}/${result.summary.total} passed`,
  ];
  for (const check of result.checks.filter(item => item.status === 'fail')) {
    lines.push(`FAIL ${check.id}: ${check.message}`);
    if (check.file) {
      lines.push(`  file: ${check.file}`);
    }
    if (check.suggestion) {
      lines.push(`  fix: ${check.suggestion}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const options = { workspace: process.cwd(), format: 'human' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') {
      options.workspace = argv[++index];
    } else if (arg === '--format') {
      options.format = argv[++index];
    } else if (arg === '--json') {
      options.format = 'json';
    }
  }
  return options;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  const result = runUltramodernContractDoctor(options);
  process.stdout.write(
    options.format === 'json'
      ? `${JSON.stringify(result, null, 2)}\n`
      : renderHuman(result),
  );
  process.exitCode = result.status === 'pass' ? 0 : 1;
}

module.exports = {
  EXPECTED_TANSTACK_ROUTER,
  runUltramodernContractDoctor,
  renderHuman,
};
