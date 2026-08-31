import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { yaml } from '@modern-js/utils';
import { transformSync } from 'esbuild';
import { runUltramodernToolingCli } from '../src/ultramodern-tooling/commands';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { snapshotWorkspace } from './helpers/workspace-kit';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');
const createBinPath = path.join(packageRoot, 'bin/run.js');

const hermeticEnv = {
  ...process.env,
  MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: '3.2.0-ultramodern.108',
  ULTRAMODERN_CREATE_BIN: createBinPath,
};

const generatedConfigRuntimePackages = {
  'app-tools': path.resolve(packageRoot, '../../solutions/app-tools'),
  'plugin-i18n': path.resolve(packageRoot, '../../runtime/plugin-i18n'),
  'plugin-tanstack': path.resolve(packageRoot, '../../runtime/plugin-tanstack'),
};

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [builtCliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: hermeticEnv,
  });
}

function read(workspaceDir: string, relativePath: string) {
  return fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');
}

function readJson(workspaceDir: string, relativePath: string): any {
  return JSON.parse(read(workspaceDir, relativePath));
}

function writeJson(workspaceDir: string, relativePath: string, value: unknown) {
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf-8',
  );
}

function exists(workspaceDir: string, relativePath: string) {
  return fs.existsSync(path.join(workspaceDir, relativePath));
}

function linkGeneratedConfigRuntime(
  workspaceDir: string,
  appDirectory: string,
) {
  const workspaceModules = path.join(workspaceDir, 'node_modules');
  if (!fs.existsSync(workspaceModules)) {
    fs.symlinkSync(
      path.resolve(packageRoot, '../../../node_modules/.pnpm/node_modules'),
      workspaceModules,
      'dir',
    );
  }

  const modernScope = path.join(
    workspaceDir,
    appDirectory,
    'node_modules/@modern-js',
  );
  fs.mkdirSync(modernScope, { recursive: true });
  for (const [name, packagePath] of Object.entries(
    generatedConfigRuntimePackages,
  )) {
    const packageLink = path.join(modernScope, name);
    if (!fs.existsSync(packageLink)) {
      fs.symlinkSync(packagePath, packageLink, 'dir');
    }
  }
}

type GeneratedConfigPolicy = {
  bffRequestId?: string;
  deliveryIdentity: {
    buildMarker?: string;
    releaseVersion?: string;
    sourceRevision?: string;
  };
  deployWorkerSsr?: boolean;
  serverSsr?: {
    mode?: string;
    moduleFederationAppSSR?: boolean;
  };
  telemetry?: {
    enabled?: boolean;
    exporters?: Record<string, { enabled?: boolean; endpoint?: string }>;
    failLoudStartup?: boolean;
  };
};

function loadGeneratedConfigPolicy(
  workspaceDir: string,
  appDirectories: string[],
  env: Record<string, string | undefined>,
) {
  for (const appDirectory of appDirectories) {
    linkGeneratedConfigRuntime(workspaceDir, appDirectory);
  }

  const configPaths = Object.fromEntries(
    appDirectories.map(appDirectory => [
      appDirectory,
      path.join(workspaceDir, appDirectory, 'modern.config.ts'),
    ]),
  );
  const tsxLoader = pathToFileURL(
    fs.realpathSync(path.join(packageRoot, 'node_modules/tsx/dist/loader.mjs')),
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      tsxLoader,
      '--input-type=module',
      '--eval',
      `
        import { pathToFileURL } from 'node:url';
        const configPaths = ${JSON.stringify(configPaths)};
        const policies = {};
        for (const [appDirectory, configPath] of Object.entries(configPaths)) {
          const loaded = await import(pathToFileURL(configPath).href);
          const config = loaded.default?.default ?? loaded.default;
          policies[appDirectory] = {
            bffRequestId: config.bff?.requestId,
            deliveryIdentity: {
              buildMarker: config.source?.globalVars?.ULTRAMODERN_BUILD_MARKER,
              releaseVersion:
                config.source?.globalVars?.ULTRAMODERN_RELEASE_VERSION,
              sourceRevision:
                config.source?.globalVars?.ULTRAMODERN_SOURCE_REVISION,
            },
            deployWorkerSsr: config.deploy?.worker?.ssr,
            serverSsr: config.server?.ssr,
            telemetry: config.server?.telemetry,
          };
        }
        process.stdout.write(JSON.stringify(policies));
      `,
    ],
    {
      cwd: workspaceDir,
      encoding: 'utf8',
      env: {
        ...hermeticEnv,
        MODERNJS_DEPLOY: undefined,
        MODERN_TELEMETRY_OTLP_ENDPOINT: undefined,
        MODERN_TELEMETRY_VICTORIA_ENDPOINT: undefined,
        ...env,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Record<string, GeneratedConfigPolicy>;
}

function runGeneratedWorkspaceCheck(workspaceDir: string) {
  return spawnSync(
    process.execPath,
    ['scripts/validate-ultramodern-workspace.mts'],
    {
      cwd: workspaceDir,
      encoding: 'utf8',
      env: hermeticEnv,
    },
  );
}

function runGeneratedApiCheck(workspaceDir: string) {
  return spawnSync(
    process.execPath,
    ['scripts/check-ultramodern-api-boundaries.mts'],
    {
      cwd: workspaceDir,
      encoding: 'utf8',
      env: hermeticEnv,
    },
  );
}

function runGeneratedCloudflareProof(workspaceDir: string, outPath: string) {
  return spawnSync(
    process.execPath,
    ['scripts/proof-cloudflare-version.mts', '--out', outPath],
    {
      cwd: workspaceDir,
      encoding: 'utf8',
      env: hermeticEnv,
    },
  );
}

function commandOutput(result: ReturnType<typeof runGeneratedWorkspaceCheck>) {
  return `${result.stdout}\n${result.stderr}`;
}

function evaluateRuntimeFramework(source: string): string {
  const transformed = transformSync(source, {
    format: 'cjs',
    loader: 'ts',
    target: 'node20',
  }).code;
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(transformed, {
    module,
    exports: module.exports,
    require(specifier: string) {
      if (specifier === '@modern-js/runtime') {
        return { defineRuntimeConfig: (config: unknown) => config };
      }
      if (specifier === '@modern-js/runtime/boundary-debugger') {
        return { ultramodernBoundaryDebuggerPlugin: () => ({}) };
      }
      if (specifier === 'i18next') {
        return { createInstance: () => ({}) };
      }
      return { default: {} };
    },
  });
  const config = module.exports.default as { router?: { framework?: string } };
  return config.router?.framework ?? '';
}

type RecordedCommand = {
  argv: string[];
  command: 'node' | 'pnpm';
  cwd: string;
};

type CommandRecorder = {
  binDir: string;
  logPath: string;
  recorderPath: string;
};

function writeRecorderCommandShim(binDir: string, command: string) {
  const executablePath = path.join(binDir, command);
  fs.writeFileSync(
    executablePath,
    [
      '#!/bin/sh',
      `exec "$ULTRAMODERN_SCRIPT_RECORDER_NODE" "$ULTRAMODERN_SCRIPT_RECORDER_PATH" ${command} "$@"`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  fs.writeFileSync(
    `${executablePath}.cmd`,
    `@echo off\r\n"%ULTRAMODERN_SCRIPT_RECORDER_NODE%" "%ULTRAMODERN_SCRIPT_RECORDER_PATH%" ${command} %*\r\n`,
    'utf8',
  );
}

function createCommandRecorder(tempRoot: string): CommandRecorder {
  const binDir = path.join(tempRoot, 'script-recorder-bin');
  const logPath = path.join(tempRoot, 'script-invocations.jsonl');
  const recorderPath = path.join(tempRoot, 'script-recorder.cjs');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    recorderPath,
    `
const fs = require('node:fs');
const path = require('node:path');

const [command, ...argv] = process.argv.slice(2);
const cwd = path.relative(process.env.ULTRAMODERN_SCRIPT_RECORDER_WORKSPACE, process.cwd()) || '.';
const record = { argv, command, cwd };
fs.appendFileSync(process.env.ULTRAMODERN_SCRIPT_RECORDER_LOG, JSON.stringify(record) + '\\n');

const failure = process.env.ULTRAMODERN_SCRIPT_RECORDER_FAILURE
  ? JSON.parse(process.env.ULTRAMODERN_SCRIPT_RECORDER_FAILURE)
  : undefined;
if (
  failure &&
  failure.command === command &&
  JSON.stringify(failure.argv) === JSON.stringify(argv)
) {
  process.exit(23);
}
`,
    'utf8',
  );
  for (const command of ['node', 'pnpm']) {
    writeRecorderCommandShim(binDir, command);
  }
  return { binDir, logPath, recorderPath };
}

function readRecordedCommands(logPath: string): RecordedCommand[] {
  const records = fs.existsSync(logPath)
    ? fs.readFileSync(logPath, 'utf8').trim()
    : '';
  return records
    ? records.split(/\r?\n/u).map(line => JSON.parse(line) as RecordedCommand)
    : [];
}

function runGeneratedPackageScript(
  workspaceDir: string,
  recorder: CommandRecorder,
  scriptName: string,
  failure?: Pick<RecordedCommand, 'argv' | 'command'>,
) {
  fs.writeFileSync(recorder.logPath, '', 'utf8');
  const env: NodeJS.ProcessEnv = {
    ...hermeticEnv,
    PATH: `${recorder.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    ULTRAMODERN_SCRIPT_RECORDER_FAILURE: failure
      ? JSON.stringify(failure)
      : undefined,
    ULTRAMODERN_SCRIPT_RECORDER_LOG: recorder.logPath,
    ULTRAMODERN_SCRIPT_RECORDER_NODE: process.execPath,
    ULTRAMODERN_SCRIPT_RECORDER_PATH: recorder.recorderPath,
    ULTRAMODERN_SCRIPT_RECORDER_WORKSPACE: fs.realpathSync(workspaceDir),
  };
  if (process.platform === 'win32') {
    env.Path = env.PATH;
    env.PATHEXT = `.CMD;.EXE;.BAT;.COM;${process.env.PATHEXT ?? ''}`;
  }
  const packageJson = readJson(workspaceDir, 'package.json');
  const script = packageJson.scripts?.[scriptName];
  assert.equal(
    typeof script,
    'string',
    `Missing generated ${scriptName} script`,
  );
  const result = spawnSync(script, {
    cwd: workspaceDir,
    encoding: 'utf8',
    env,
    shell: true,
  });
  return { records: readRecordedCommands(recorder.logPath), result };
}

function assertGeneratedWorkspaceScriptBehavior(
  workspaceDir: string,
  tempRoot: string,
) {
  const recorder = createCommandRecorder(tempRoot);
  const pnpm = (...argv: string[]): RecordedCommand => ({
    argv,
    command: 'pnpm',
    cwd: '.',
  });
  const node = (...argv: string[]): RecordedCommand => ({
    argv,
    command: 'node',
    cwd: '.',
  });
  const successfulScenarios: Array<{
    expected: RecordedCommand[];
    scriptName: string;
  }> = [
    {
      scriptName: 'dev',
      expected: [
        pnpm(
          '--parallel',
          '--filter',
          '@integration-workspace/shell-super-app',
          '--filter',
          '@integration-workspace/catalog',
          '--filter',
          '@integration-workspace/checkout',
          'dev',
        ),
      ],
    },
    {
      scriptName: 'dev:catalog',
      expected: [pnpm('--filter', '@integration-workspace/catalog', 'dev')],
    },
    {
      scriptName: 'dev:checkout',
      expected: [pnpm('--filter', '@integration-workspace/checkout', 'dev')],
    },
    {
      scriptName: 'build',
      expected: [
        pnpm('-r', '--filter', './verticals/*', 'run', 'build'),
        pnpm('--filter', './apps/shell-super-app', 'run', 'build'),
        pnpm('mf:types'),
        pnpm('performance:readiness'),
      ],
    },
    {
      scriptName: 'check',
      expected: [
        pnpm('format:check'),
        pnpm('lint'),
        pnpm('typecheck'),
        pnpm('skills:check'),
        pnpm('i18n:boundaries'),
        pnpm('api:check'),
        pnpm('contract:check'),
        pnpm('performance:readiness'),
      ],
    },
    {
      scriptName: 'node:proof',
      expected: [node('./scripts/proof-node-backend-federation.mts')],
    },
    {
      scriptName: 'node:backend-federation:generate',
      expected: [node('./scripts/generate-node-backend-federation.mts')],
    },
    {
      scriptName: 'zerops:materialize',
      expected: [node('./scripts/materialize-zerops-runtime.mjs')],
    },
    {
      scriptName: 'cloudflare:ssr-proof',
      expected: [node('./scripts/proof-workerd-ssr.mts')],
    },
    {
      scriptName: 'cloudflare:build',
      expected: [
        pnpm('-r', '--filter', './verticals/*', 'run', 'cloudflare:build'),
        pnpm('--filter', './apps/shell-super-app', 'run', 'cloudflare:build'),
        pnpm('mf:types'),
        pnpm('cloudflare-output:verify'),
        pnpm('cloudflare:ssr-proof'),
      ],
    },
  ];

  for (const scenario of successfulScenarios) {
    const execution = runGeneratedPackageScript(
      workspaceDir,
      recorder,
      scenario.scriptName,
    );
    assert.equal(
      execution.result.status,
      0,
      `${scenario.scriptName}\n${commandOutput(execution.result)}`,
    );
    assert.deepEqual(execution.records, scenario.expected, scenario.scriptName);
  }

  const failureScenarios: Array<{
    expected: RecordedCommand[];
    failure: Pick<RecordedCommand, 'argv' | 'command'>;
    scriptName: string;
  }> = [
    {
      scriptName: 'build',
      failure: pnpm('-r', '--filter', './verticals/*', 'run', 'build'),
      expected: [pnpm('-r', '--filter', './verticals/*', 'run', 'build')],
    },
    {
      scriptName: 'check',
      failure: pnpm('contract:check'),
      expected: [
        pnpm('format:check'),
        pnpm('lint'),
        pnpm('typecheck'),
        pnpm('skills:check'),
        pnpm('i18n:boundaries'),
        pnpm('api:check'),
        pnpm('contract:check'),
      ],
    },
    {
      scriptName: 'cloudflare:build',
      failure: pnpm('cloudflare-output:verify'),
      expected: [
        pnpm('-r', '--filter', './verticals/*', 'run', 'cloudflare:build'),
        pnpm('--filter', './apps/shell-super-app', 'run', 'cloudflare:build'),
        pnpm('mf:types'),
        pnpm('cloudflare-output:verify'),
      ],
    },
  ];

  for (const scenario of failureScenarios) {
    const execution = runGeneratedPackageScript(
      workspaceDir,
      recorder,
      scenario.scriptName,
      scenario.failure,
    );
    assert.notEqual(
      execution.result.status,
      0,
      `${scenario.scriptName} must propagate command failure`,
    );
    assert.deepEqual(execution.records, scenario.expected, scenario.scriptName);
  }
}

function appById(apps: any[], id: string): any {
  const app = apps.find(candidate => candidate.id === id);
  assert.ok(app, `Expected app ${id}`);
  return app;
}

function assertGeneratedVerticalFiles(workspaceDir: string, id: string) {
  for (const relativePath of [
    `verticals/${id}/api/effect-api.ts`,
    `verticals/${id}/api/index.ts`,
    `verticals/${id}/backend-federation.config.ts`,
    `verticals/${id}/locales/cs/${id}.json`,
    `verticals/${id}/locales/cs/translation.json`,
    `verticals/${id}/locales/en/${id}.json`,
    `verticals/${id}/locales/en/translation.json`,
    `verticals/${id}/shared/api.ts`,
    `verticals/${id}/src/components/${id}-widget.tsx`,
    `verticals/${id}/src/api/${id}-client.ts`,
    `verticals/${id}/src/federation-entry.tsx`,
    `verticals/${id}/src/routes/[lang]/page.tsx`,
    `verticals/${id}/src/routes/ultramodern-route-metadata.ts`,
  ]) {
    assert.equal(exists(workspaceDir, relativePath), true, relativePath);
  }
}

function assertIntegratedVertical(
  workspaceDir: string,
  id: 'catalog' | 'checkout',
  port: number,
) {
  const scope = 'integration-workspace';
  const packageName = `@${scope}/${id}`;
  const mfName = `vertical${id[0].toUpperCase()}${id.slice(1)}`;
  const manifestUrl = `http://localhost:${port}/mf-manifest.json`;
  const backendFederationName = `${mfName}Backend`;
  const backendManifestUrl = `http://localhost:${port}/backend-mf-manifest.json`;
  const backendContainerEntry = `http://localhost:${port}/backendRemoteEntry.cjs`;
  const apiUrl = `http://localhost:${port}/${id}-api`;
  const topology = readJson(workspaceDir, 'topology/reference-topology.json');
  const ownership = readJson(workspaceDir, 'topology/ownership.json');
  const overlay = readJson(
    workspaceDir,
    'topology/local-overlays/development.json',
  );
  const ultramodernConfig = readJson(
    workspaceDir,
    '.modernjs/ultramodern.json',
  );
  const shellPackage = readJson(
    workspaceDir,
    'apps/shell-super-app/package.json',
  );
  const verticalPackage = readJson(
    workspaceDir,
    `verticals/${id}/package.json`,
  );
  const topologyEntry = appById(topology.verticals, id);
  const ownershipEntry = appById(ownership.owners, id);
  const configEntry = appById(ultramodernConfig.topology.apps, id);
  const moduleFederationEntry = appById(
    ultramodernConfig.moduleFederation.apps,
    id,
  );
  const backendFederationEntry = appById(
    ultramodernConfig.backendFederation.apps,
    id,
  );

  assertGeneratedVerticalFiles(workspaceDir, id);
  assert.deepEqual(topologyEntry.moduleFederation.exposes, [
    './Route',
    './Widget',
  ]);
  assert.equal(topologyEntry.moduleFederation.name, mfName);
  assert.equal(topologyEntry.moduleFederation.manifestUrl, manifestUrl);
  assert.equal(topologyEntry.backendFederation.role, 'microvertical-server');
  assert.equal(topologyEntry.backendFederation.name, backendFederationName);
  assert.equal(
    topologyEntry.backendFederation.versionBoundary.ui.manifestEnv,
    `VERTICAL_${id.replace(/-/g, '_').toUpperCase()}_MF_MANIFEST`,
  );
  assert.equal(
    topologyEntry.backendFederation.versionBoundary.ui.manifestUrl,
    manifestUrl,
  );
  assert.equal(
    topologyEntry.backendFederation.versionBoundary.api.readiness,
    `/${id}-api/${id}/readiness`,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.node.manifestEnv,
    `VERTICAL_${id.replace(/-/g, '_').toUpperCase()}_BACKEND_MF_MANIFEST`,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.node.manifestUrl,
    backendManifestUrl,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.node.containerEntry,
    backendContainerEntry,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.node.kind,
    'node-mf-runtime',
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.node.remoteType,
    'commonjs-module',
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.cloudflare.kind,
    'cloudflare-worker-snapshot',
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.cloudflare.publicUrlEnv,
    `ULTRAMODERN_PUBLIC_URL_${id.replace(/-/g, '_').toUpperCase()}`,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.cloudflare.workerDispatch
      .serviceBinding,
    `VERTICAL_${id.replace(/-/g, '_').toUpperCase()}_WORKER`,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.cloudflare.workerDispatch
      .serviceBindingEnv,
    `VERTICAL_${id.replace(/-/g, '_').toUpperCase()}_WORKER_BINDING`,
  );
  assert.equal(
    topologyEntry.backendFederation.executionSurfaces.cloudflare.workerDispatch
      .dispatchWorkerNameEnv,
    `VERTICAL_${id.replace(/-/g, '_').toUpperCase()}_WORKER_NAME`,
  );
  assert.equal(topologyEntry.backendFederation.runtimeFramework, 'effect');
  assert.equal(topologyEntry.backendFederation.strictEffectApproach, true);
  assert.equal(
    topologyEntry.backendFederation.exposes['./effect-api'].runtime,
    `verticals/${id}/api/index.ts`,
  );
  assert.equal(
    topologyEntry.backendFederation.exposes['./effect-api'].readiness,
    `/${id}-api/${id}/readiness`,
  );
  assert.equal(
    topologyEntry.backendFederation.compatibility.contractVersion,
    'microvertical-server-effect-v1',
  );
  assert.equal(topologyEntry.backendFederation.manifestUrl, undefined);
  assert.equal(topologyEntry.backendFederation.containerEntry, undefined);
  assert.equal(topologyEntry.package, packageName);
  assert.equal(topologyEntry.path, `verticals/${id}`);
  assert.equal(topologyEntry.api.bff.prefix, `/${id}-api`);
  assert.equal(topologyEntry.api.serverEntry, `verticals/${id}/api/index.ts`);
  assert.equal(ownershipEntry.package, packageName);
  assert.equal(ownershipEntry.path, `verticals/${id}`);
  assert.equal(ownershipEntry.ownership.team, 'super-app-platform');
  assert.equal(overlay.ports[id], port);
  assert.equal(overlay.manifests[id], manifestUrl);
  assert.equal(overlay.serverExecution[id].apiBaseUrl, apiUrl);
  assert.equal(
    overlay.serverExecution[id].node.manifestUrl,
    backendManifestUrl,
  );
  assert.equal(
    overlay.serverExecution[id].node.containerEntry,
    backendContainerEntry,
  );
  assert.equal(
    overlay.serverExecution[id].cloudflare.kind,
    'cloudflare-worker-snapshot',
  );
  assert.equal(
    overlay.serverExecution[id].cloudflare.workerDispatch.serviceBinding,
    `VERTICAL_${id.replace(/-/g, '_').toUpperCase()}_WORKER`,
  );
  assert.equal(overlay.apis[id], apiUrl);

  assert.equal(configEntry.package, packageName);
  assert.equal(configEntry.path, `verticals/${id}`);
  assert.equal(configEntry.kind, 'vertical');
  assert.equal(configEntry.moduleFederation.ssr, true);
  assert.deepEqual(configEntry.moduleFederation.exposes, [
    './Route',
    './Widget',
  ]);
  assert.equal(configEntry.moduleFederation.name, mfName);
  assert.equal(configEntry.backendFederation.role, 'microvertical-server');
  assert.equal(configEntry.backendFederation.name, backendFederationName);
  assert.equal(
    configEntry.backendFederation.executionSurfaces.node.manifestUrl,
    backendManifestUrl,
  );
  assert.equal(
    configEntry.backendFederation.executionSurfaces.node.containerEntry,
    backendContainerEntry,
  );
  assert.equal(
    configEntry.backendFederation.executionSurfaces.node.remoteType,
    'commonjs-module',
  );
  assert.equal(
    configEntry.backendFederation.executionSurfaces.cloudflare.kind,
    'cloudflare-worker-snapshot',
  );
  assert.equal(configEntry.backendFederation.runtimeFramework, 'effect');
  assert.equal(configEntry.backendFederation.strictEffectApproach, true);
  assert.equal(configEntry.api.prefix, `/${id}-api`);
  assert.equal(moduleFederationEntry.role, 'remote');
  assert.equal(moduleFederationEntry.name, mfName);
  assert.deepEqual(moduleFederationEntry.exposes, ['./Route', './Widget']);
  assert.equal(backendFederationEntry.role, 'microvertical-server');
  assert.equal(backendFederationEntry.name, backendFederationName);
  assert.equal(
    backendFederationEntry.executionSurfaces.node.manifestUrl,
    backendManifestUrl,
  );
  assert.equal(
    backendFederationEntry.executionSurfaces.node.containerEntry,
    backendContainerEntry,
  );
  assert.equal(
    backendFederationEntry.executionSurfaces.node.remoteType,
    'commonjs-module',
  );
  assert.equal(
    backendFederationEntry.executionSurfaces.cloudflare.kind,
    'cloudflare-worker-snapshot',
  );
  assert.equal(backendFederationEntry.runtimeFramework, 'effect');
  assert.equal(backendFederationEntry.strictEffectApproach, true);
  assert.equal(
    backendFederationEntry.contractVersion,
    'microvertical-server-effect-v1',
  );

  assert.equal(verticalPackage.name, packageName);
  assert.equal(
    verticalPackage.type,
    undefined,
    'generated MF vertical app packages must stay CJS-compatible',
  );
  assert.equal(
    verticalPackage.exports['./Route'],
    './src/federation-entry.tsx',
  );
  assert.equal(
    verticalPackage.exports['./Widget'],
    `./src/components/${id}-widget.tsx`,
  );
  assert.equal(verticalPackage.exports['./api'], './shared/api.ts');
  assert.equal(
    verticalPackage.dependencies['@modern-js/plugin-bff'],
    'workspace:*',
  );
  assert.equal(shellPackage.dependencies['react-router'], undefined);
  assert.equal(verticalPackage.dependencies['react-router'], undefined);
  assert.equal(shellPackage.dependencies['react-router-dom'], undefined);
  assert.equal(verticalPackage.dependencies['react-router-dom'], undefined);
  // TanStack Router is the frontend router, so no generated app installs
  // react-router. Every federated React UI must therefore disable the MF React
  // bridge router, which is what makes the plugin alias
  // `@module-federation/bridge-react` to its react-router-free base entry.
  for (const federationConfigPath of [
    'apps/shell-super-app/module-federation.config.ts',
    `verticals/${id}/module-federation.config.ts`,
  ]) {
    assert.match(
      read(workspaceDir, federationConfigPath),
      /bridge: \{\n\s+enableBridgeRouter: false,\n\s+\},/u,
      federationConfigPath,
    );
  }
  assert.equal(shellPackage.dependencies[packageName], 'workspace:*');
  assert.equal(
    shellPackage['zephyr:dependencies'][id],
    `${packageName}@workspace:*`,
  );
}

test('generated workspace scripts execute the complete ordered command plan and stop on failure', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-script-plan-'));
  const workspaceDir = path.join(tempRoot, 'integration-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'integration-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'checkout',
      modernVersion: '3.2.1',
    });

    assertGeneratedWorkspaceScriptBehavior(workspaceDir, tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('workspace and MicroVertical integration stays coherent across public API and CLI additions', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-integration-'));
  const workspaceDir = path.join(tempRoot, 'integration-workspace');

  try {
    const workspaceResult = generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'integration-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    assert.equal(workspaceResult.operation, 'workspace');
    assert.equal(workspaceResult.packageSource.strategy, 'workspace');

    const publicApiResult = addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    assert.deepEqual(publicApiResult.assignedPorts, { catalog: 4101 });

    const cliResult = runCli(workspaceDir, ['--vertical-name', 'checkout']);
    assert.equal(cliResult.status, 0, cliResult.stderr);

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    const overlay = readJson(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const rootPackage = readJson(workspaceDir, 'package.json');
    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    const packageSource = ultramodernConfig.packageSource;

    assert.deepEqual(topology.shell.verticalRefs, ['catalog', 'checkout']);
    assert.deepEqual(
      fs.readdirSync(path.join(workspaceDir, '.modernjs')).sort(),
      ['ultramodern.json'],
    );
    assert.equal(
      appById(ultramodernConfig.topology.apps, 'shell-super-app')
        .moduleFederation.ssr,
      true,
    );
    assert.deepEqual(
      topology.shell.moduleFederation.remotes.map((remote: any) => remote.id),
      ['catalog', 'checkout'],
    );
    assert.deepEqual(Object.keys(overlay.ports).sort(), [
      'catalog',
      'checkout',
      'shell-super-app',
    ]);
    assert.deepEqual(
      ultramodernConfig.topology.apps.map((app: any) => app.id),
      ['shell-super-app', 'catalog', 'checkout'],
    );
    assert.deepEqual(
      appById(ultramodernConfig.topology.apps, 'shell-super-app')
        .moduleFederation.verticalRefs,
      ['catalog', 'checkout'],
    );
    assert.deepEqual(
      appById(
        ultramodernConfig.topology.apps,
        'shell-super-app',
      ).moduleFederation.remotes.map((remote: any) => remote.id),
      ['catalog', 'checkout'],
    );
    assert.equal(rootPackage.modernjs.packageSource.strategy, 'workspace');
    assert.equal(
      rootPackage.modernjs.packageSource.config,
      './.modernjs/ultramodern.json',
    );
    assert.equal(rootPackage.type, 'module');
    assert.equal(
      shellPackage.type,
      undefined,
      'generated MF shell app package must stay CJS-compatible',
    );
    assert.equal(exists(workspaceDir, 'scripts/proof-workerd-ssr.mts'), true);
    const compactConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    const compactCatalog = appById(compactConfig.topology.apps, 'catalog');
    assert.deepEqual(compactCatalog.deploy.cloudflare.jsonSmokeChecks, [
      {
        id: 'catalog-readiness-smoke',
        route: '/catalog-api/catalog/readiness',
        expect: {
          status: 'ready',
          'checks.api': 'ready',
          'checks.moduleFederation': 'ready',
          'checks.ssr': 'ready',
        },
      },
    ]);
    const zeropsConfig = yaml.load(read(workspaceDir, 'zerops.yaml')) as {
      zerops: Array<{
        build: { base: string; deployFiles: string[] };
        deploy: { readinessCheck: { httpGet: { path: string; port: number } } };
        run: { base: string };
        setup: string;
      }>;
    };
    const zeropsServices = new Map(
      zeropsConfig.zerops.map(service => [service.setup, service]),
    );
    assert.deepEqual(
      [...zeropsServices.keys()],
      ['shell-super-app', 'catalog', 'checkout'],
    );
    const zeropsShell = zeropsServices.get('shell-super-app');
    assert.equal(zeropsShell?.build.base, 'nodejs@26');
    assert.equal(zeropsShell?.run.base, 'nodejs@26');
    assert.deepEqual(zeropsShell?.deploy.readinessCheck.httpGet, {
      path: '/',
      port: 3020,
    });
    assert.deepEqual(
      zeropsServices.get('catalog')?.deploy.readinessCheck.httpGet,
      { path: '/catalog-api/catalog/readiness', port: 4101 },
    );
    assert.deepEqual(
      zeropsServices.get('checkout')?.deploy.readinessCheck.httpGet,
      { path: '/checkout-api/checkout/readiness', port: 4102 },
    );
    assert.equal(
      rootPackage.devDependencies['@modern-js/plugin-bff'],
      'workspace:*',
    );
    assert.throws(() =>
      read(workspaceDir, 'scripts/generate-node-backend-federation.mjs'),
    );
    assert.throws(() =>
      read(workspaceDir, 'scripts/proof-node-backend-federation.mjs'),
    );
    assert.equal(packageSource.strategy, 'workspace');
    assert.equal(packageSource.modernPackageVersion, 'workspace:*');
    assert.equal(packageSource.aliasScope, undefined);
    assert.equal(packageSource.aliasPackageNamePrefix, undefined);
    assert.equal(
      shellPackage.dependencies['@modern-js/runtime'],
      'workspace:*',
    );
    assert.equal(
      evaluateRuntimeFramework(
        read(workspaceDir, 'apps/shell-super-app/src/modern.runtime.ts'),
      ),
      'tanstack',
    );
    assert.equal(
      evaluateRuntimeFramework(
        read(workspaceDir, 'verticals/catalog/src/modern.runtime.ts'),
      ),
      'tanstack',
    );

    assertIntegratedVertical(workspaceDir, 'catalog', 4101);
    assertIntegratedVertical(workspaceDir, 'checkout', 4102);
    const validation = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(validation.status, 0, commandOutput(validation));
    const afterTwoVerticals = snapshotWorkspace(workspaceDir);
    assert.throws(
      () =>
        addUltramodernVertical({
          workspaceRoot: workspaceDir,
          name: 'catalog',
          modernVersion: '3.2.1',
        }),
      /Refusing to overwrite existing path: verticals\/catalog/,
    );
    assert.deepEqual(snapshotWorkspace(workspaceDir), afterTwoVerticals);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated configs resolve endpoint-driven telemetry and preset identities across app profiles', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-config-policy-'));
  const workspaceDir = path.join(tempRoot, 'config-policy-workspace');
  const appProfiles = {
    'apps/shell-super-app': 'shell-super-app',
    'verticals/headless': 'headless',
    'verticals/storefront': 'storefront',
  } as const;

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'config-policy-workspace',
      modernVersion: '3.2.1',
      enableTailwind: false,
      packageSource: { strategy: 'workspace' },
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'storefront',
      preset: 'ui-only',
      modernVersion: '3.2.1',
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'headless',
      preset: 'api-only',
      modernVersion: '3.2.1',
    });

    const scenarios = [
      {
        env: {},
        expectedTelemetry: {
          enabled: true,
          failLoudStartup: false,
        },
      },
      {
        env: {
          MODERN_TELEMETRY_OTLP_ENDPOINT: 'https://otel.example/v1/logs',
        },
        expectedTelemetry: {
          enabled: true,
          exporters: {
            otlp: {
              enabled: true,
              endpoint: 'https://otel.example/v1/logs',
            },
          },
          failLoudStartup: false,
        },
      },
      {
        env: {
          MODERN_TELEMETRY_VICTORIA_ENDPOINT:
            'https://victoria.example/api/v1/import/prometheus',
        },
        expectedTelemetry: {
          enabled: true,
          exporters: {
            victoriaMetrics: {
              enabled: true,
              endpoint: 'https://victoria.example/api/v1/import/prometheus',
            },
          },
          failLoudStartup: false,
        },
      },
      {
        env: {
          MODERN_TELEMETRY_OTLP_ENDPOINT: 'https://otel.example/v1/logs',
          MODERN_TELEMETRY_VICTORIA_ENDPOINT:
            'https://victoria.example/api/v1/import/prometheus',
        },
        expectedTelemetry: {
          enabled: true,
          exporters: {
            otlp: {
              enabled: true,
              endpoint: 'https://otel.example/v1/logs',
            },
            victoriaMetrics: {
              enabled: true,
              endpoint: 'https://victoria.example/api/v1/import/prometheus',
            },
          },
          failLoudStartup: false,
        },
      },
    ];

    for (const scenario of scenarios) {
      const policies = loadGeneratedConfigPolicy(
        workspaceDir,
        Object.keys(appProfiles),
        scenario.env,
      );
      for (const [appDirectory, appId] of Object.entries(appProfiles)) {
        const policy = policies[appDirectory];
        assert.equal(policy.bffRequestId, appId);
        assert.deepEqual(policy.serverSsr, {
          mode: 'stream',
          moduleFederationAppSSR: true,
        });
        assert.deepEqual(policy.telemetry, scenario.expectedTelemetry);
        assert.ok(policy.deliveryIdentity.buildMarker);
        assert.ok(policy.deliveryIdentity.releaseVersion);
        assert.ok(policy.deliveryIdentity.sourceRevision);
      }
    }

    const cloudflarePolicies = loadGeneratedConfigPolicy(
      workspaceDir,
      Object.keys(appProfiles),
      {
        MODERNJS_DEPLOY: 'cloudflare',
        MODERN_PUBLIC_SITE_URL: 'https://example.test',
      },
    );
    for (const policy of Object.values(cloudflarePolicies)) {
      assert.equal(policy.deployWorkerSsr, true);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated Cloudflare proof records backend server execution metadata offline', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-proof-'));
  const workspaceDir = path.join(tempRoot, 'proof-workspace');
  const proofOut = '.codex/reports/cloudflare-version-proof/test-proof.json';

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'proof-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const shellConfig = appById(
      ultramodernConfig.topology.apps,
      'shell-super-app',
    );
    shellConfig.deploy ??= {};
    shellConfig.deploy.cloudflare ??= {};
    shellConfig.deploy.cloudflare.jsonSmokeChecks = [
      {
        id: 'catalog-domain-smoke',
        route: '/catalog-api/catalog/CL-08-GR',
        expect: {
          name: 'Holland Hamster',
          price: 7750,
          sku: 'CL-08-GR',
        },
      },
      {
        body: {
          quantity: 2,
          sku: 'CL-08-GR',
        },
        expect: {
          'item.lineTotal': 15500,
          'item.quantity': 2,
          'item.sku': 'CL-08-GR',
        },
        id: 'checkout-post-smoke',
        method: 'POST',
        route: '/checkout-api/checkout',
      },
    ];
    writeJson(workspaceDir, '.modernjs/ultramodern.json', ultramodernConfig);

    const proofResult = runGeneratedCloudflareProof(workspaceDir, proofOut);
    assert.equal(proofResult.status, 0, commandOutput(proofResult));

    const proof = readJson(workspaceDir, proofOut);
    assert.equal(proof.status, 'skipped');
    const catalogTarget = proof.proofTargets.find(
      (target: any) => target.appId === 'catalog',
    );
    assert.ok(catalogTarget, 'catalog proof target must be present');
    assert.equal(
      catalogTarget.cloudflare.routes.apiReadiness,
      '/catalog-api/catalog/readiness',
    );
    assert.equal(catalogTarget.backendFederation.role, 'microvertical-server');
    assert.equal(
      catalogTarget.backendFederation.versionBoundary.invariant,
      'web-and-api-same-build',
    );
    assert.equal(
      catalogTarget.backendFederation.versionBoundary.ui.marker,
      catalogTarget.backendFederation.versionBoundary.api.marker,
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.cloudflare.kind,
      'cloudflare-worker-snapshot',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.cloudflare.ssr
        .effectBffBundle,
      '.output/worker/__modern_bff_effect.js',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.cloudflare.zephyr
        .snapshotIdEnv,
      'ZEPHYR_CATALOG_SNAPSHOT_ID',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.cloudflare
        .workerDispatch.serviceBinding,
      'VERTICAL_CATALOG_WORKER',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.cloudflare
        .workerDispatch.serviceBindingEnv,
      'VERTICAL_CATALOG_WORKER_BINDING',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.node.kind,
      'node-mf-runtime',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.node.adapterVersion,
      'backend-mf-effect-v1',
    );
    assert.equal(
      catalogTarget.backendFederation.executionSurfaces.node.runtimePackage,
      '@modern-js/plugin-bff/effect',
    );
    assert.equal(catalogTarget.backendFederation.manifestUrl, undefined);
    assert.equal(catalogTarget.backendFederation.containerEntry, undefined);
    assert.equal(
      catalogTarget.serverExecution.versionBoundary,
      'web-and-api-same-build',
    );
    assert.equal(
      catalogTarget.serverExecution.cloudflare.apiReadiness,
      '/catalog-api/catalog/readiness',
    );
    assert.equal(
      catalogTarget.serverExecution.cloudflare.workerDispatch
        .dispatchNamespaceEnv,
      'VERTICAL_CATALOG_DISPATCH_NAMESPACE',
    );
    assert.equal(
      catalogTarget.serverExecution.cloudflare.zephyr.versionIdEnv,
      'ZEPHYR_CATALOG_VERSION_ID',
    );
    assert.equal(
      catalogTarget.serverExecution.node.manifestUrl,
      'http://localhost:4101/backend-mf-manifest.json',
    );

    const shellTarget = proof.proofTargets.find(
      (target: any) => target.appId === 'shell-super-app',
    );
    assert.ok(shellTarget, 'shell proof target must be present');
    assert.deepEqual(
      shellTarget.cloudflare.serviceBindings.map((binding: any) => ({
        appId: binding.appId,
        binding: binding.binding,
        interface: binding.interface,
        route: binding.route,
        service: binding.service,
      })),
      [
        {
          appId: 'catalog',
          binding: 'VERTICAL_CATALOG_WORKER',
          interface: 'fetch',
          route: '/catalog-api/catalog/readiness',
          service: 'proof-workspace-catalog',
        },
      ],
    );
    assert.deepEqual(shellTarget.cloudflare.jsonSmokeChecks, [
      {
        id: 'catalog-domain-smoke',
        route: '/catalog-api/catalog/CL-08-GR',
        expect: {
          name: 'Holland Hamster',
          price: 7750,
          sku: 'CL-08-GR',
        },
      },
      {
        body: {
          quantity: 2,
          sku: 'CL-08-GR',
        },
        expect: {
          'item.lineTotal': 15500,
          'item.quantity': 2,
          'item.sku': 'CL-08-GR',
        },
        id: 'checkout-post-smoke',
        method: 'POST',
        route: '/checkout-api/checkout',
      },
    ]);
    assert.equal(shellTarget.backendFederation, undefined);
    assert.equal(shellTarget.serverExecution, undefined);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated MicroVertical self-check names corrupted contracts and fix areas', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-self-check-'));

  const scenarios = [
    {
      workspaceName: 'topology-corrupt',
      mutate: (workspaceDir: string) => {
        const topology = readJson(
          workspaceDir,
          'topology/reference-topology.json',
        );
        topology.shell.moduleFederation.remotes[0].manifestUrl =
          'http://localhost:4999/mf-manifest.json';
        writeJson(workspaceDir, 'topology/reference-topology.json', topology);
      },
      expectedContract:
        /MicroVertical contract self-check failed: topology\/reference-topology\.json shell\.moduleFederation\.remotes\./,
      expectedFixArea:
        /Fix area: restore generated shell Module Federation remotes\./,
    },
    {
      workspaceName: 'overlay-corrupt',
      mutate: (workspaceDir: string) => {
        const overlay = readJson(
          workspaceDir,
          'topology/local-overlays/development.json',
        );
        overlay.apis.catalog = 'http://localhost:4101/not-catalog-api';
        writeJson(
          workspaceDir,
          'topology/local-overlays/development.json',
          overlay,
        );
      },
      expectedContract:
        /MicroVertical contract self-check failed: topology\/local-overlays\/development\.json apis\.catalog\./,
      expectedFixArea: /Fix area: restore generated local API overlay\./,
    },
    {
      workspaceName: 'backend-federation-corrupt',
      mutate: (workspaceDir: string) => {
        const topology = readJson(
          workspaceDir,
          'topology/reference-topology.json',
        );
        appById(topology.verticals, 'catalog').backendFederation.manifestUrl =
          'http://localhost:4101/backend-mf-manifest.json';
        writeJson(workspaceDir, 'topology/reference-topology.json', topology);
      },
      expectedContract:
        /MicroVertical contract self-check failed: topology\/reference-topology\.json verticals\.catalog\.backendFederation\./,
      expectedFixArea:
        /Fix area: restore generated MicroVertical server execution contract\./,
    },
    {
      workspaceName: 'vertical-file-missing',
      mutate: (workspaceDir: string) => {
        fs.rmSync(path.join(workspaceDir, 'verticals/catalog/shared/api.ts'));
      },
      expectedContract:
        /MicroVertical contract self-check failed: required files for catalog\. Missing verticals\/catalog\/shared\/api\.ts\./,
      expectedFixArea:
        /Fix area: restore the generated MicroVertical files or rerun the MicroVertical generator\./,
    },
    {
      workspaceName: 'shell-ssr-corrupt',
      mutate: (workspaceDir: string) => {
        const ultramodernConfig = readJson(
          workspaceDir,
          '.modernjs/ultramodern.json',
        );
        appById(
          ultramodernConfig.topology.apps,
          'shell-super-app',
        ).moduleFederation.ssr = false;
        writeJson(
          workspaceDir,
          '.modernjs/ultramodern.json',
          ultramodernConfig,
        );
      },
      expectedContract:
        /MicroVertical contract self-check failed: \.modernjs\/ultramodern\.json shell SSR contract\./,
      expectedFixArea:
        /Fix area: restore generated streaming SSR Module Federation settings\./,
    },
    {
      workspaceName: 'delivery-unit-drift',
      mutate: (workspaceDir: string) => {
        const ultramodernConfig = readJson(
          workspaceDir,
          '.modernjs/ultramodern.json',
        );
        appById(
          ultramodernConfig.topology.apps,
          'catalog',
        ).deliveryUnit.buildMarker = 'deadbeefdeadbeef';
        writeJson(
          workspaceDir,
          '.modernjs/ultramodern.json',
          ultramodernConfig,
        );
      },
      expectedContract:
        /MicroVertical contract self-check failed: \.modernjs\/ultramodern\.json topology\.apps\.catalog\.deliveryUnit\./,
      expectedFixArea:
        /Fix area: regenerate vertical identity from delivery-unit record; do not hand-edit surface markers\./,
    },
    {
      workspaceName: 'vertical-ssr-corrupt',
      mutate: (workspaceDir: string) => {
        const ultramodernConfig = readJson(
          workspaceDir,
          '.modernjs/ultramodern.json',
        );
        appById(
          ultramodernConfig.topology.apps,
          'catalog',
        ).moduleFederation.ssr = false;
        writeJson(
          workspaceDir,
          '.modernjs/ultramodern.json',
          ultramodernConfig,
        );
      },
      expectedContract:
        /MicroVertical contract self-check failed: \.modernjs\/ultramodern\.json apps\.catalog\./,
      expectedFixArea:
        /Fix area: regenerate the generated MicroVertical contract entry\./,
    },
  ] as const;

  try {
    for (const scenario of scenarios) {
      const workspaceDir = path.join(tempRoot, scenario.workspaceName);
      generateUltramodernWorkspace({
        targetDir: workspaceDir,
        packageName: scenario.workspaceName,
        modernVersion: '3.2.1',
        enableTailwind: true,
        packageSource: { strategy: 'workspace' },
      });
      addUltramodernVertical({
        workspaceRoot: workspaceDir,
        name: 'catalog',
        modernVersion: '3.2.1',
      });

      const passingResult = runGeneratedWorkspaceCheck(workspaceDir);
      assert.equal(passingResult.status, 0, commandOutput(passingResult));

      scenario.mutate(workspaceDir);
      const failingResult = runGeneratedWorkspaceCheck(workspaceDir);
      const output = commandOutput(failingResult);
      assert.notEqual(failingResult.status, 0, output);
      assert.match(output, scenario.expectedContract);
      assert.match(output, scenario.expectedFixArea);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated API boundary check structurally rejects raw handler drift', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-api-check-'));
  const workspaceDir = path.join(tempRoot, 'api-check-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'api-check-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const passingResult = runGeneratedApiCheck(workspaceDir);
    assert.equal(passingResult.status, 0, commandOutput(passingResult));

    fs.writeFileSync(
      path.join(workspaceDir, 'verticals/catalog/api/index.ts'),
      `
import { createHandler } from '@modern-js/plugin-bff/hono-server';

export const handler = async (request: Request) => {
  const body = await request.json();
  return Response.json(body);
};

export default async function fallback() {
  return new Response('legacy');
}

const runtimeFramework = 'hono';
const strictEffectApproach = false;
`,
      'utf-8',
    );

    fs.writeFileSync(
      path.join(workspaceDir, 'verticals/catalog/api/effect-api.ts'),
      `
export const backendFederationContract = {
 role: 'backend-remote',
 strictEffectApproach: false,
};

export const handler = async (request: Request) => Response.json(await request.json());
`,
      'utf-8',
    );

    const failingResult = runGeneratedApiCheck(workspaceDir);
    const output = commandOutput(failingResult);
    assert.notEqual(failingResult.status, 0, output);
    assert.match(output, /must not import Hono server helpers/);
    assert.match(output, /must not hand-build Response objects/);
    assert.match(output, /must not manually parse request bodies/);
    assert.match(output, /must not export raw request handlers/);
    assert.match(output, /must keep strictEffectApproach enabled/);
    assert.match(output, /must describe the MicroVertical server role/);
    assert.match(output, /must preserve strict Effect backend execution/);
    assert.match(
      output,
      /must preserve the MicroVertical server contract version/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate converges a legacy shell-only workspace to a validator-clean state', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-migrate-shell-'));
  const workspaceDir = path.join(tempRoot, 'shell-only-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'shell-only-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });

    // Fresh shell-only workspace already satisfies the (backend-surface-gated)
    // contract self-check.
    const freshResult = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(freshResult.status, 0, commandOutput(freshResult));

    // Simulate an older-create workspace: agent/i18n scripts shipped as .mjs
    // and package.json wired at those legacy paths.
    for (const name of [
      'bootstrap-agent-skills',
      'setup-agent-reference-repos',
      'check-ultramodern-i18n-boundaries',
    ]) {
      fs.renameSync(
        path.join(workspaceDir, `scripts/${name}.mts`),
        path.join(workspaceDir, `scripts/${name}.mjs`),
      );
    }
    const legacyPackage = readJson(workspaceDir, 'package.json');
    legacyPackage.scripts['skills:install'] =
      'node ./scripts/bootstrap-agent-skills.mjs';
    legacyPackage.scripts['skills:check'] =
      'node ./scripts/bootstrap-agent-skills.mjs --check';
    legacyPackage.scripts.postinstall =
      "oxfmt . '!repos/**' && node ./scripts/bootstrap-agent-skills.mjs --postinstall";
    legacyPackage.scripts['agents:refs:install'] =
      'node ./scripts/setup-agent-reference-repos.mjs';
    legacyPackage.scripts['i18n:boundaries'] =
      'node ./scripts/check-ultramodern-i18n-boundaries.mjs';
    writeJson(workspaceDir, 'package.json', legacyPackage);

    const migrateStatus = await runUltramodernToolingCli(
      ['migrate-strict-effect', '--skip-install'],
      workspaceDir,
    );
    assert.equal(migrateStatus, 0);

    for (const name of [
      'bootstrap-agent-skills',
      'setup-agent-reference-repos',
      'check-ultramodern-i18n-boundaries',
    ]) {
      assert.equal(exists(workspaceDir, `scripts/${name}.mts`), true, name);
      assert.equal(exists(workspaceDir, `scripts/${name}.mjs`), false, name);
    }

    // The migrated workspace must again satisfy the generated contract check,
    // including the skills/agent-reference wrappers and script wiring, without
    // requiring backend-federation or Zerops artifacts.
    const migratedResult = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(migratedResult.status, 0, commandOutput(migratedResult));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('workspace package-source strategy and Tailwind-disabled generation remain integrated', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-integration-'));
  const workspaceDir = path.join(tempRoot, 'workspace-source-no-tailwind');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'workspace-source-no-tailwind',
      modernVersion: '3.2.1',
      enableTailwind: false,
      packageSource: {
        strategy: 'workspace',
      },
    });
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const rootPackage = readJson(workspaceDir, 'package.json');
    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const packageSource = ultramodernConfig.packageSource;
    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    const catalogPackage = readJson(
      workspaceDir,
      'verticals/catalog/package.json',
    );

    assert.equal(rootPackage.modernjs.packageSource.strategy, 'workspace');
    assert.equal(
      rootPackage.modernjs.packageSource.config,
      './.modernjs/ultramodern.json',
    );
    assert.equal(packageSource.strategy, 'workspace');
    assert.equal(packageSource.modernPackageVersion, 'workspace:*');
    assert.equal(
      shellPackage.dependencies['@modern-js/runtime'],
      'workspace:*',
    );
    assert.equal(
      catalogPackage.dependencies['@modern-js/runtime'],
      'workspace:*',
    );
    assert.equal(
      catalogPackage.dependencies['@modern-js/plugin-bff'],
      'workspace:*',
    );
    for (const dependency of ['tailwindcss', '@rsbuild/plugin-tailwindcss']) {
      assert.equal(shellPackage.devDependencies[dependency], undefined);
      assert.equal(catalogPackage.devDependencies[dependency], undefined);
    }
    for (const relativePath of [
      'apps/shell-super-app/tailwind.config.ts',
      'verticals/catalog/tailwind.config.ts',
    ]) {
      assert.equal(exists(workspaceDir, relativePath), false, relativePath);
    }
    assert.equal(ultramodernConfig.features.tailwind, false);
    assert.equal(
      appById(ultramodernConfig.topology.apps, 'shell-super-app').kind,
      'shell',
    );
    assert.equal(
      appById(ultramodernConfig.topology.apps, 'catalog').kind,
      'vertical',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

/* -------------------------------------------------------------------------- */
/* Surface-profile-aware generated validator (Sol batch-3 verify #5 / #9)     */
/* -------------------------------------------------------------------------- */

function generateProfileWorkspace(
  workspaceDir: string,
  vertical: {
    name: string;
    preset?: 'full-stack' | 'api-only' | 'ui-only';
    apiProtocol?: 'rest' | 'rpc';
    horizontalRemote?: boolean;
  },
) {
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: path.basename(workspaceDir),
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: { strategy: 'workspace' },
  });
  addUltramodernVertical({
    workspaceRoot: workspaceDir,
    modernVersion: '3.2.1',
    name: vertical.name,
    preset: vertical.preset,
    apiProtocol: vertical.apiProtocol,
    horizontalRemote: vertical.horizontalRemote,
  });
}

test('generated validator accepts multiple verticals added in non-alphabetical order (cross-process identity + set-cohort)', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-multi-vertical-'));
  const workspaceDir = path.join(tempRoot, 'multi-vertical-workspace');
  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: path.basename(workspaceDir),
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    // Insertion order deliberately differs from filesystem-sorted order so the
    // app-id cohort check (set semantics) and the delivery-unit build marker
    // (deterministic identity hash, recomputed in the spawned validator
    // process) are both exercised end to end.
    for (const name of ['inventory', 'finance', 'people', 'analytics']) {
      addUltramodernVertical({
        workspaceRoot: workspaceDir,
        modernVersion: '3.2.1',
        name,
      });
    }

    const passing = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passing.status, 0, commandOutput(passing));

    const inventoryPackagePath = 'verticals/inventory/package.json';
    const inventoryPackage = readJson(workspaceDir, inventoryPackagePath);
    const portabilityMutations = [
      {
        expected: /inventory cross-env dependency must match/u,
        mutate(packageJson: Record<string, any>) {
          packageJson.devDependencies['cross-env'] = '10.0.0';
        },
      },
      {
        expected: /inventory build must use cross-env/u,
        mutate(packageJson: Record<string, any>) {
          packageJson.scripts.build = packageJson.scripts.build.replace(
            'cross-env MODERNJS_DEPLOY=node',
            'MODERNJS_DEPLOY=node',
          );
        },
      },
      {
        expected:
          /inventory cloudflare:build must use cross-env for Modern build/u,
        mutate(packageJson: Record<string, any>) {
          packageJson.scripts['cloudflare:build'] = packageJson.scripts[
            'cloudflare:build'
          ].replace(
            'cross-env MODERNJS_DEPLOY=cloudflare modern build',
            'MODERNJS_DEPLOY=cloudflare modern build',
          );
        },
      },
      {
        expected:
          /inventory cloudflare:build must use cross-env for Modern deploy/u,
        mutate(packageJson: Record<string, any>) {
          packageJson.scripts['cloudflare:build'] = packageJson.scripts[
            'cloudflare:build'
          ].replace(
            'cross-env MODERNJS_DEPLOY=cloudflare modern deploy',
            'MODERNJS_DEPLOY=cloudflare modern deploy',
          );
        },
      },
    ];
    for (const { expected, mutate } of portabilityMutations) {
      const invalidPackage = structuredClone(inventoryPackage);
      mutate(invalidPackage);
      writeJson(workspaceDir, inventoryPackagePath, invalidPackage);
      const invalidResult = runGeneratedWorkspaceCheck(workspaceDir);
      assert.notEqual(invalidResult.status, 0, commandOutput(invalidResult));
      assert.match(commandOutput(invalidResult), expected);
    }
    writeJson(workspaceDir, inventoryPackagePath, inventoryPackage);

    const apiPassing = runGeneratedApiCheck(workspaceDir);
    assert.equal(apiPassing.status, 0, commandOutput(apiPassing));

    fs.writeFileSync(
      path.join(
        workspaceDir,
        'apps/shell-super-app/src/api/vertical-clients.ts',
      ),
      'export {};\n',
      'utf-8',
    );
    const missingClientExports = runGeneratedApiCheck(workspaceDir);
    const missingClientOutput = commandOutput(missingClientExports);
    assert.notEqual(missingClientExports.status, 0, missingClientOutput);
    assert.match(missingClientOutput, /must re-export .*\/api\/client/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator accepts an api-only (headless) workspace and rejects planted UI/MF artifacts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-profile-api-'));
  const workspaceDir = path.join(tempRoot, 'api-only-workspace');
  try {
    generateProfileWorkspace(workspaceDir, {
      name: 'headless',
      preset: 'api-only',
    });

    // The headless unit ships API artifacts but no UI/MF files.
    assert.ok(exists(workspaceDir, 'verticals/headless/shared/api.ts'));
    assert.ok(exists(workspaceDir, 'verticals/headless/api/index.ts'));
    assert.ok(
      !exists(workspaceDir, 'verticals/headless/module-federation.config.ts'),
    );
    assert.ok(
      !exists(workspaceDir, 'verticals/headless/src/federation-entry.tsx'),
    );
    assert.ok(
      exists(workspaceDir, 'verticals/headless/locales/en/headless.json'),
    );
    assert.ok(
      exists(workspaceDir, 'verticals/headless/locales/cs/headless.json'),
    );

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    const backendFederation = appById(
      topology.verticals,
      'headless',
    ).backendFederation;
    assert.equal(backendFederation.runtimeFramework, 'effect');
    assert.equal(backendFederation.strictEffectApproach, true);
    assert.equal(
      backendFederation.executionSurfaces.cloudflare.zephyr.runtime,
      'api-worker',
    );
    assert.equal(
      backendFederation.executionSurfaces.cloudflare.api.effectBffBundle,
      '.output/worker/__modern_bff_effect.js',
    );
    assert.equal(backendFederation.executionSurfaces.cloudflare.ssr, undefined);
    assert.equal('ui' in backendFederation.versionBoundary, false);

    const compactApp = appById(
      readJson(workspaceDir, '.modernjs/ultramodern.json').topology.apps,
      'headless',
    );
    assert.deepEqual(backendFederation.deliveryUnit, compactApp.deliveryUnit);

    const passing = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passing.status, 0, commandOutput(passing));

    const apiPassing = runGeneratedApiCheck(workspaceDir);
    assert.equal(apiPassing.status, 0, commandOutput(apiPassing));

    // An empty UI boundary is still a UI boundary. A headless API-only unit
    // must omit the branch itself, not merely its manifest URL.
    backendFederation.versionBoundary.ui = {};
    writeJson(workspaceDir, 'topology/reference-topology.json', topology);
    const failingUiBoundary = runGeneratedWorkspaceCheck(workspaceDir);
    const uiBoundaryOutput = commandOutput(failingUiBoundary);
    assert.notEqual(failingUiBoundary.status, 0, uiBoundaryOutput);
    assert.match(
      uiBoundaryOutput,
      /topology\/reference-topology\.json verticals\.headless\.backendFederation/,
    );
    delete backendFederation.versionBoundary.ui;
    writeJson(workspaceDir, 'topology/reference-topology.json', topology);

    // Likewise, any SSR execution branch contradicts an API-worker-only
    // Cloudflare topology, even when that branch contains no leaf values.
    backendFederation.executionSurfaces.cloudflare.ssr = {};
    writeJson(workspaceDir, 'topology/reference-topology.json', topology);
    const failingSsrBranch = runGeneratedWorkspaceCheck(workspaceDir);
    const ssrBranchOutput = commandOutput(failingSsrBranch);
    assert.notEqual(failingSsrBranch.status, 0, ssrBranchOutput);
    assert.match(
      ssrBranchOutput,
      /topology\/reference-topology\.json verticals\.headless\.backendFederation/,
    );
    delete backendFederation.executionSurfaces.cloudflare.ssr;
    writeJson(workspaceDir, 'topology/reference-topology.json', topology);

    // Planting a UI/MF artifact into a headless unit must be rejected.
    fs.writeFileSync(
      path.join(workspaceDir, 'verticals/headless/module-federation.config.ts'),
      'export default {};\n',
      'utf-8',
    );
    const failing = runGeneratedWorkspaceCheck(workspaceDir);
    const output = commandOutput(failing);
    assert.notEqual(failing.status, 0, output);
    assert.match(
      output,
      /Unexpected .*module-federation\.config\.ts for a api-only unit/,
    );
    fs.rmSync(
      path.join(workspaceDir, 'verticals/headless/module-federation.config.ts'),
    );

    // Planting colocated route metadata (a UI/browser-surface artifact) into a
    // headless unit must also be rejected.
    fs.mkdirSync(path.join(workspaceDir, 'verticals/headless/src/routes'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(
        workspaceDir,
        'verticals/headless/src/routes/ultramodern-route-metadata.ts',
      ),
      'export const metadata = {};\n',
      'utf-8',
    );
    const failingRouteMeta = runGeneratedWorkspaceCheck(workspaceDir);
    const routeMetaOutput = commandOutput(failingRouteMeta);
    assert.notEqual(failingRouteMeta.status, 0, routeMetaOutput);
    assert.match(
      routeMetaOutput,
      /Unexpected .*ultramodern-route-metadata\.ts for a api-only unit/,
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        'verticals/headless/src/routes/ultramodern-route-metadata.ts',
      ),
    );

    // Planting the federated `./Widget` demo component (a UI-only artifact:
    // descriptors.ts:127 -> src/components/${domain}-widget.tsx) into a headless
    // unit must be rejected.
    fs.mkdirSync(path.join(workspaceDir, 'verticals/headless/src/components'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(
        workspaceDir,
        'verticals/headless/src/components/headless-widget.tsx',
      ),
      'export const Widget = () => null;\n',
      'utf-8',
    );
    const failingWidget = runGeneratedWorkspaceCheck(workspaceDir);
    const widgetOutput = commandOutput(failingWidget);
    assert.notEqual(failingWidget.status, 0, widgetOutput);
    assert.match(
      widgetOutput,
      /Unexpected .*src\/components\/headless-widget\.tsx for a api-only unit/,
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        'verticals/headless/src/components/headless-widget.tsx',
      ),
    );

    // Planting a colocated `[lang]/route.meta.ts` (a UI/browser route-meta
    // artifact) into a headless unit must be rejected too.
    fs.mkdirSync(
      path.join(workspaceDir, 'verticals/headless/src/routes/[lang]'),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(
        workspaceDir,
        'verticals/headless/src/routes/[lang]/route.meta.ts',
      ),
      'export const meta = {};\n',
      'utf-8',
    );
    const failingRouteMetaColocated = runGeneratedWorkspaceCheck(workspaceDir);
    const routeMetaColocatedOutput = commandOutput(failingRouteMetaColocated);
    assert.notEqual(
      failingRouteMetaColocated.status,
      0,
      routeMetaColocatedOutput,
    );
    assert.match(
      routeMetaColocatedOutput,
      /Unexpected .*\[lang\]\/route\.meta\.ts for a api-only unit/,
    );
    fs.rmSync(
      path.join(
        workspaceDir,
        'verticals/headless/src/routes/[lang]/route.meta.ts',
      ),
    );

    // Widening the headless unit's Module Federation DTS boundary to a browser
    // federation entry it does not ship must be rejected (the api-only mf-types
    // boundary only covers the app ambient types).
    const mfTypes = readJson(
      workspaceDir,
      'verticals/headless/tsconfig.mf-types.json',
    );
    mfTypes.include = ['src/federation-entry.tsx', 'src/modern-app-env.d.ts'];
    writeJson(
      workspaceDir,
      'verticals/headless/tsconfig.mf-types.json',
      mfTypes,
    );
    const failingDts = runGeneratedWorkspaceCheck(workspaceDir);
    const dtsOutput = commandOutput(failingDts);
    assert.notEqual(failingDts.status, 0, dtsOutput);
    assert.match(
      dtsOutput,
      /restore the generated MicroVertical Module Federation DTS boundary/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator accepts a ui-only workspace and rejects planted API artifacts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-profile-ui-'));
  const workspaceDir = path.join(tempRoot, 'ui-only-workspace');
  try {
    generateProfileWorkspace(workspaceDir, {
      name: 'surface',
      preset: 'ui-only',
    });

    assert.ok(
      exists(workspaceDir, 'verticals/surface/src/federation-entry.tsx'),
    );
    assert.ok(!exists(workspaceDir, 'verticals/surface/shared/api.ts'));

    const passing = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passing.status, 0, commandOutput(passing));

    const apiPassing = runGeneratedApiCheck(workspaceDir);
    assert.equal(apiPassing.status, 0, commandOutput(apiPassing));

    // Planting an API contract into a ui-only unit must be rejected.
    fs.writeFileSync(
      path.join(workspaceDir, 'verticals/surface/shared/api.ts'),
      'export const api = {};\n',
      'utf-8',
    );
    const failing = runGeneratedApiCheck(workspaceDir);
    const output = commandOutput(failing);
    assert.notEqual(failing.status, 0, output);
    assert.match(output, /Unexpected .*shared\/api\.ts for a ui-only unit/);
    fs.rmSync(path.join(workspaceDir, 'verticals/surface/shared/api.ts'));

    // Planting an RPC contract into a ui-only unit must be rejected too: a
    // ui-only unit carries no API contract in either protocol.
    fs.writeFileSync(
      path.join(workspaceDir, 'verticals/surface/shared/rpc.ts'),
      'export const rpc = {};\n',
      'utf-8',
    );
    const failingRpc = runGeneratedApiCheck(workspaceDir);
    const rpcOutput = commandOutput(failingRpc);
    assert.notEqual(failingRpc.status, 0, rpcOutput);
    assert.match(rpcOutput, /Unexpected .*shared\/rpc\.ts for a ui-only unit/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator validates a Horizontal Remote (components-only) workspace', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-profile-hr-'));
  const workspaceDir = path.join(tempRoot, 'horizontal-remote-workspace');
  try {
    generateProfileWorkspace(workspaceDir, {
      name: 'design-system',
      horizontalRemote: true,
    });

    assert.ok(
      exists(workspaceDir, 'verticals/design-system/src/federation-entry.tsx'),
    );
    assert.ok(!exists(workspaceDir, 'verticals/design-system/shared/api.ts'));

    const passing = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passing.status, 0, commandOutput(passing));

    const apiPassing = runGeneratedApiCheck(workspaceDir);
    assert.equal(apiPassing.status, 0, commandOutput(apiPassing));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator accepts an rpc-protocol workspace and rejects a missing RPC client', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-profile-rpc-'));
  const workspaceDir = path.join(tempRoot, 'rpc-workspace');
  try {
    generateProfileWorkspace(workspaceDir, {
      name: 'catalog',
      apiProtocol: 'rpc',
    });

    // RPC generation emits the RPC contract/client, not the REST surface.
    assert.ok(exists(workspaceDir, 'verticals/catalog/shared/rpc.ts'));
    assert.ok(
      exists(workspaceDir, 'verticals/catalog/src/api/catalog-rpc-client.ts'),
    );
    assert.ok(!exists(workspaceDir, 'verticals/catalog/shared/api.ts'));
    assert.ok(
      !exists(workspaceDir, 'verticals/catalog/src/api/catalog-client.ts'),
    );

    // The compact config records the `rpc` protocol, so the generated
    // validator synthesizes a REST-less Cloudflare proof route (mirroring
    // policy.ts:76) and, per its readiness assertions, must NOT require a REST
    // `apiReadiness` route for this unit. The exit-0 check below is the
    // end-to-end proof that no REST readiness is required for an rpc unit.
    const rpcConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    const rpcAppEntry = rpcConfig.topology.apps.find(
      (app: { id: string }) => app.id === 'catalog',
    );
    assert.equal(rpcAppEntry?.api?.protocol, 'rpc');

    const passing = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passing.status, 0, commandOutput(passing));

    const apiPassing = runGeneratedApiCheck(workspaceDir);
    assert.equal(apiPassing.status, 0, commandOutput(apiPassing));

    const rpcContractPath = path.join(
      workspaceDir,
      'verticals/catalog/shared/rpc.ts',
    );
    const rpcContract = fs.readFileSync(rpcContractPath, 'utf-8');
    fs.writeFileSync(
      rpcContractPath,
      rpcContract.replace(
        'RpcGroup.make(',
        '/* RpcGroup.make( is not executable proof */ fakeRpcGroup.make(',
      ),
      'utf-8',
    );
    const structurallyInvalid = runGeneratedApiCheck(workspaceDir);
    const structurallyInvalidOutput = commandOutput(structurallyInvalid);
    assert.notEqual(structurallyInvalid.status, 0, structurallyInvalidOutput);
    assert.match(structurallyInvalidOutput, /through RpcGroup\.make/);
    fs.writeFileSync(rpcContractPath, rpcContract, 'utf-8');

    // Planting the REST API client into an RPC unit must be rejected: an RPC
    // unit ships only the `${stem}-rpc-client`, never the REST `${stem}-client`.
    fs.writeFileSync(
      path.join(workspaceDir, 'verticals/catalog/src/api/catalog-client.ts'),
      'export const client = {};\n',
      'utf-8',
    );
    const failingRestClient = runGeneratedWorkspaceCheck(workspaceDir);
    const restClientOutput = commandOutput(failingRestClient);
    assert.notEqual(failingRestClient.status, 0, restClientOutput);
    assert.match(
      restClientOutput,
      /catalog RPC unit must not emit the REST API client/,
    );
    fs.rmSync(
      path.join(workspaceDir, 'verticals/catalog/src/api/catalog-client.ts'),
    );

    // Removing the RPC client must be rejected by the generated validator.
    fs.rmSync(
      path.join(
        workspaceDir,
        'verticals/catalog/src/api/catalog-rpc-client.ts',
      ),
    );
    const failing = runGeneratedApiCheck(workspaceDir);
    const output = commandOutput(failing);
    assert.notEqual(failing.status, 0, output);
    assert.match(
      output,
      /Missing verticals\/catalog\/src\/api\/catalog-rpc-client\.ts/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator still accepts a rest full-stack workspace', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-profile-rest-'));
  const workspaceDir = path.join(tempRoot, 'rest-workspace');
  try {
    generateProfileWorkspace(workspaceDir, {
      name: 'catalog',
      apiProtocol: 'rest',
    });
    const passing = runGeneratedWorkspaceCheck(workspaceDir);
    assert.equal(passing.status, 0, commandOutput(passing));

    const apiPassing = runGeneratedApiCheck(workspaceDir);
    assert.equal(apiPassing.status, 0, commandOutput(apiPassing));

    const ultramodernConfig = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const catalogApp = ultramodernConfig.topology.apps.find(
      (app: { id: string }) => app.id === 'catalog',
    );
    const catalogApi = catalogApp.api;
    delete catalogApp.api;
    writeJson(workspaceDir, '.modernjs/ultramodern.json', ultramodernConfig);
    const missingApiMetadata = runGeneratedApiCheck(workspaceDir);
    const missingApiOutput = commandOutput(missingApiMetadata);
    assert.notEqual(missingApiMetadata.status, 0, missingApiOutput);
    assert.match(
      missingApiOutput,
      /full-stack vertical must declare its Effect API/,
    );
    catalogApp.api = catalogApi;
    writeJson(workspaceDir, '.modernjs/ultramodern.json', ultramodernConfig);

    const mixedRpcContract = path.join(
      workspaceDir,
      'verticals/catalog/shared/rpc.ts',
    );
    fs.writeFileSync(mixedRpcContract, 'export const rpc = {};\n', 'utf-8');
    const mixedProtocol = runGeneratedApiCheck(workspaceDir);
    const mixedProtocolOutput = commandOutput(mixedProtocol);
    assert.notEqual(mixedProtocol.status, 0, mixedProtocolOutput);
    assert.match(
      mixedProtocolOutput,
      /REST unit must not emit .*shared\/rpc\.ts/,
    );
    fs.rmSync(mixedRpcContract);

    const apiEntryPath = path.join(
      workspaceDir,
      'verticals/catalog/api/index.ts',
    );
    const apiEntry = fs.readFileSync(apiEntryPath, 'utf-8');
    fs.writeFileSync(
      apiEntryPath,
      apiEntry.replace(
        'HttpApiBuilder.group(',
        '/* HttpApiBuilder.group( is not executable proof */ fakeBuilder.group(',
      ),
      'utf-8',
    );
    const structurallyInvalid = runGeneratedApiCheck(workspaceDir);
    const invalidOutput = commandOutput(structurallyInvalid);
    assert.notEqual(structurallyInvalid.status, 0, invalidOutput);
    assert.match(
      invalidOutput,
      /must implement handlers through HttpApiBuilder\.group/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
