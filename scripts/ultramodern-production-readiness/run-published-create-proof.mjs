#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const defaultCreatePackage = '@bleedingdev/modern-js-create@latest';
const defaultProjectName = 'ultramodern-ci-superapp';
const defaultSingleAppProjectName = 'ultramodern-ci-single-app';
const defaultOut = '.modern/production-readiness/published-create-proof.json';
const browserSmokeScript = path.join(
  repoRoot,
  'scripts/ultramodern-production-readiness/run-browser-smoke.mjs',
);
const browserSmokePlaywrightPackage =
  process.env.ULTRAMODERN_BROWSER_SMOKE_PLAYWRIGHT_PACKAGE ??
  'playwright@1.60.0';
const readableErpVerticalNames = [
  'inventory',
  'finance',
  'people',
  'analytics',
  'orders',
  'procurement',
  'billing',
  'logistics',
  'support',
  'compliance',
];
const scaleProfiles = Object.freeze({
  'erp-10': Object.freeze({
    id: 'erp-10',
    verticalCount: 10,
  }),
  'erp-25': Object.freeze({
    id: 'erp-25',
    verticalCount: 25,
  }),
  'erp-50': Object.freeze({
    id: 'erp-50',
    verticalCount: 50,
  }),
});

function parseArgs(argv) {
  const options = {
    createPackage: defaultCreatePackage,
    projectName: defaultProjectName,
    singleAppProjectName: defaultSingleAppProjectName,
    scaleProfile: undefined,
    verticalCount: undefined,
    out: defaultOut,
    deployCloudflare: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--create-package') {
      options.createPackage = argv[++index];
    } else if (arg === '--project-name') {
      options.projectName = argv[++index];
    } else if (arg === '--single-app-project-name') {
      options.singleAppProjectName = argv[++index];
    } else if (arg === '--scale-profile') {
      options.scaleProfile = argv[++index];
    } else if (arg === '--vertical-count') {
      options.verticalCount = Number.parseInt(argv[++index], 10);
    } else if (arg === '--out') {
      options.out = argv[++index];
    } else if (arg === '--deploy-cloudflare') {
      options.deployCloudflare = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (
    options.verticalCount !== undefined &&
    (!Number.isInteger(options.verticalCount) || options.verticalCount < 0)
  ) {
    throw new Error('--vertical-count must be a non-negative integer');
  }
  if (
    options.scaleProfile !== undefined &&
    !Object.hasOwn(scaleProfiles, options.scaleProfile)
  ) {
    throw new Error(
      `--scale-profile must be one of ${Object.keys(scaleProfiles).join(', ')}`,
    );
  }
  assertSafeName(options.projectName, '--project-name');
  assertSafeName(options.singleAppProjectName, '--single-app-project-name');

  const selectedProfile = selectScaleProfile(options);

  return {
    ...options,
    selectedProfile,
    scaleProfile: selectedProfile.id,
    verticalCount: selectedProfile.verticalCount,
    out: path.resolve(repoRoot, options.out),
    verticals: generateVerticalNames(selectedProfile.verticalCount),
  };
}

function selectScaleProfile(options) {
  if (options.scaleProfile !== undefined) {
    const profile = scaleProfiles[options.scaleProfile];
    if (
      options.verticalCount !== undefined &&
      options.verticalCount !== profile.verticalCount
    ) {
      throw new Error(
        `--vertical-count ${String(
          options.verticalCount,
        )} does not match --scale-profile ${profile.id}`,
      );
    }
    return profile;
  }

  if (options.verticalCount !== undefined) {
    return {
      id: `custom-${options.verticalCount}`,
      verticalCount: options.verticalCount,
    };
  }

  return scaleProfiles['erp-10'];
}

function assertSafeName(value, optionName) {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) {
    throw new Error(`${optionName} must match /^[a-z][a-z0-9-]*$/`);
  }
}

function generatedVerticalName(index) {
  return `erp-vertical-${String(index + 1).padStart(3, '0')}`;
}

function generateVerticalNames(count) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('vertical count must be a non-negative integer');
  }
  return Array.from({ length: count }, (_, index) =>
    index < readableErpVerticalNames.length
      ? readableErpVerticalNames[index]
      : generatedVerticalName(index),
  );
}

function packageNameFromSpecifier(specifier) {
  const lastAt = specifier.lastIndexOf('@');
  if (specifier.startsWith('@') && lastAt > 0) {
    return specifier.slice(0, lastAt);
  }
  if (!specifier.startsWith('@') && lastAt > -1) {
    return specifier.slice(0, lastAt);
  }
  return specifier;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      ...(options.env || {}),
    },
    encoding: 'utf-8',
    stdio: options.stdio || 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${[command, ...args].join(' ')}`);
  }
  return result.stdout?.trim() ?? '';
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => {
          reject(new Error('Failed to reserve an available TCP port'));
        });
        return;
      }
      const { port } = address;
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function startServe(projectDir, port) {
  const output = {
    stderr: '',
    stdout: '',
  };
  const child = spawn('pnpm', ['serve'], {
    cwd: projectDir,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      MODERN_BASELINE_ENABLE_TELEMETRY_EXPORTERS: 'false',
      MODERN_PUBLIC_SITE_URL: `http://localhost:${port}`,
      NODE_ENV: 'production',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ready = new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(
        new Error(`modern serve did not become ready.\n${serveOutput(output)}`),
      );
    }, 60_000);

    const settleReady = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    };

    const onData = key => chunk => {
      const message = chunk.toString();
      output[key] += message;
      if (/> Local:/i.test(`${output.stdout}\n${output.stderr}`)) {
        settleReady();
      }
    };

    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));
    child.on('error', error => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      error.stdout = output.stdout;
      error.stderr = output.stderr;
      reject(error);
    });
    child.on('close', code => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `modern serve exited before readiness marker with code ${
            code ?? 'unknown'
          }.\n${serveOutput(output)}`,
        ),
      );
    });
  });

  return { child, output, ready };
}

function serveOutput(output) {
  return [output.stdout.trim(), output.stderr.trim()]
    .filter(Boolean)
    .join('\n');
}

async function stopServe(server) {
  if (!server?.child || server.child.killed) {
    return;
  }

  await new Promise(resolve => {
    const timeout = setTimeout(() => {
      if (!server.child.killed) {
        server.child.kill('SIGKILL');
      }
      resolve();
    }, 5_000);

    server.child.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    server.child.kill('SIGTERM');
  });
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  const text = await response.text();
  return { response, text };
}

function assertSingleAppSsrHtml(route, response, text) {
  const trimmed = text.trim();
  const failures = [];

  if (response.status !== 200) {
    failures.push(`${route} returned ${response.status}`);
  }
  if (trimmed.length === 0) {
    failures.push(`${route} returned an empty HTML body`);
  }
  if (!/<html[\s>]/iu.test(text)) {
    failures.push(`${route} HTML is missing <html>`);
  }
  if (!/<body[\s>]/iu.test(text)) {
    failures.push(`${route} HTML is missing <body>`);
  }
  if (!text.includes('id="$tsr-stream-barrier"')) {
    failures.push(`${route} HTML is missing TanStack SSR stream barrier`);
  }
  if (!text.includes('$_TSR')) {
    failures.push(`${route} HTML is missing TanStack SSR bootstrap`);
  }
  if (!text.includes('UltraModern.js Starter')) {
    failures.push(`${route} HTML is missing generated page content`);
  }
  if (text.includes('__modern_ssr_fallback_reason__')) {
    failures.push(`${route} HTML contains Modern SSR fallback marker`);
  }
  if (/<div id="root"><\/div>/iu.test(text)) {
    failures.push(`${route} HTML contains an empty root`);
  }

  if (failures.length > 0) {
    throw new Error(failures.map(failure => `- ${failure}`).join('\n'));
  }
}

function assertNoSsrRenderErrors(output) {
  const combined = serveOutput(output);
  const fatalPatterns = [
    /Element type is invalid/iu,
    /Hydration failed/iu,
    /Minified React error/iu,
    /Objects are not valid as a React child/iu,
    /ReferenceError:\s+require is not defined/iu,
    /TelemetryStartupHealthError/iu,
    /__modern_ssr_fallback_reason__/iu,
    /renderTo(?:String|PipeableStream|ReadableStream)[\s\S]{0,160}(?:failed|error|exception)/iu,
    /(?:failed|error|exception)[\s\S]{0,160}renderTo(?:String|PipeableStream|ReadableStream)/iu,
  ];

  const matchedPattern = fatalPatterns.find(pattern => pattern.test(combined));
  if (matchedPattern) {
    throw new Error(
      `modern serve emitted an SSR/render failure matching ${matchedPattern}.\n${combined}`,
    );
  }
}

async function runSingleAppSsrProof(singleAppDir) {
  run('pnpm', ['install'], { cwd: singleAppDir });

  const port = await reservePort();
  const env = {
    MODERN_BASELINE_ENABLE_TELEMETRY_EXPORTERS: 'false',
    MODERN_PUBLIC_SITE_URL: `http://localhost:${port}`,
  };
  run('pnpm', ['build'], { cwd: singleAppDir, env });

  const server = startServe(singleAppDir, port);
  try {
    await server.ready;
    const routes = ['/', '/en'];
    for (const route of routes) {
      const { response, text } = await fetchHtml(
        `http://localhost:${port}${route}`,
      );
      assertSingleAppSsrHtml(route, response, text);
    }
    assertNoSsrRenderErrors(server.output);
  } finally {
    await stopServe(server);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return readJson(filePath);
}

function roundDurationMs(value) {
  return Math.round(value * 100) / 100;
}

function timedStep(summary, id, action) {
  const startedAt = performance.now();
  try {
    const value = action();
    summary.timings[id] = {
      status: 'pass',
      durationMs: roundDurationMs(performance.now() - startedAt),
    };
    return value;
  } catch (error) {
    summary.timings[id] = {
      status: 'fail',
      durationMs: roundDurationMs(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
    throw error;
  }
}

async function timedStepAsync(summary, id, action) {
  const startedAt = performance.now();
  try {
    const value = await action();
    summary.timings[id] = {
      status: 'pass',
      durationMs: roundDurationMs(performance.now() - startedAt),
    };
    return value;
  } catch (error) {
    summary.timings[id] = {
      status: 'fail',
      durationMs: roundDurationMs(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
    throw error;
  }
}

function skippedTiming(reason) {
  return {
    status: 'skipped',
    durationMs: 0,
    reason,
  };
}

function resolveCreatePackage(specifier) {
  const packageName = packageNameFromSpecifier(specifier);
  const packageMetadata = JSON.parse(
    run('npm', ['view', specifier, '--json'], { stdio: 'pipe' }),
  );
  const version = packageMetadata.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Could not resolve npm version for ${specifier}`);
  }
  const frameworkVersion = packageMetadata.ultramodern?.frameworkVersion;
  if (
    packageName === '@bleedingdev/modern-js-create' &&
    (typeof frameworkVersion !== 'string' || frameworkVersion.length === 0)
  ) {
    throw new Error(
      `${packageName}@${version} must declare ultramodern.frameworkVersion`,
    );
  }
  return {
    packageName,
    version,
    frameworkVersion:
      typeof frameworkVersion === 'string' && frameworkVersion.length > 0
        ? frameworkVersion
        : version,
    exactSpecifier: `${packageName}@${version}`,
  };
}

function bleedingdevAlias(modernPackageName) {
  return `@bleedingdev/modern-js-${modernPackageName.split('/').at(-1)}`;
}

function expectedSpecifier(modernPackageName, version) {
  return `npm:${bleedingdevAlias(modernPackageName)}@${version}`;
}

function generatedModernPackages(packageSource, errors) {
  const packageNames = packageSource.modernPackages?.packages;
  if (!Array.isArray(packageNames) || packageNames.length === 0) {
    errors.push('package source Modern package cohort is missing');
    return [];
  }

  const invalidPackageNames = packageNames.filter(
    packageName =>
      typeof packageName !== 'string' || !packageName.startsWith('@modern-js/'),
  );
  if (invalidPackageNames.length > 0) {
    errors.push(
      `package source Modern package cohort contains invalid entries: ${invalidPackageNames.join(
        ', ',
      )}`,
    );
  }

  return packageNames.filter(
    packageName =>
      typeof packageName === 'string' && packageName.startsWith('@modern-js/'),
  );
}

function modernDependencyNames(packageJson) {
  return [
    ...new Set(
      ['dependencies', 'devDependencies']
        .flatMap(section => Object.keys(packageJson[section] ?? {}))
        .filter(packageName => packageName.startsWith('@modern-js/')),
    ),
  ];
}

function packageJsonFiles(root) {
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['.git', '.output', 'dist', 'node_modules'].includes(entry.name)) {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
      } else if (entry.name === 'package.json') {
        files.push(absolute);
      }
    }
  }
  return files.sort();
}

function assertGeneratedCohort(
  projectDir,
  expectedFrameworkVersion,
  {
    expectedTemplateVersion = expectedFrameworkVersion,
    manifestPath = '.modernjs/mv-template-manifest.json',
    workspaceManifest = false,
  } = {},
) {
  const errors = [];
  const packageSource = readJson(
    path.join(projectDir, '.modernjs/ultramodern-package-source.json'),
  );
  const manifest = readJson(path.join(projectDir, manifestPath));
  const modernPackageNames = generatedModernPackages(packageSource, errors);
  const modernPackageNameSet = new Set(modernPackageNames);

  if (packageSource.strategy !== 'install') {
    errors.push(`package source strategy is ${packageSource.strategy}`);
  }
  if (packageSource.modernPackages?.specifier !== expectedFrameworkVersion) {
    errors.push(
      `package source specifier is ${packageSource.modernPackages?.specifier}`,
    );
  }
  if (manifest.template?.version !== expectedTemplateVersion) {
    errors.push(`template version is ${manifest.template?.version}`);
  }
  if (
    workspaceManifest &&
    manifest.packageSource?.modernPackageSpecifier !== expectedFrameworkVersion
  ) {
    errors.push(
      `manifest package specifier is ${manifest.packageSource?.modernPackageSpecifier}`,
    );
  }

  for (const modernPackageName of modernPackageNames) {
    const alias = packageSource.modernPackages?.aliases?.[modernPackageName];
    const expectedAlias = bleedingdevAlias(modernPackageName);
    if (alias !== expectedAlias) {
      errors.push(`${modernPackageName} alias is ${alias}`);
    }
  }

  for (const packageJsonPath of packageJsonFiles(projectDir)) {
    const relative = path.relative(projectDir, packageJsonPath);
    const packageJson = readJson(packageJsonPath);
    for (const modernPackageName of modernDependencyNames(packageJson)) {
      if (!modernPackageNameSet.has(modernPackageName)) {
        errors.push(
          `${relative} declares ${modernPackageName} outside package source metadata`,
        );
      }
    }
    for (const section of ['dependencies', 'devDependencies']) {
      for (const modernPackageName of modernPackageNames) {
        const actual = packageJson[section]?.[modernPackageName];
        const expected = expectedSpecifier(
          modernPackageName,
          expectedFrameworkVersion,
        );
        if (actual !== undefined && actual !== expected) {
          errors.push(
            `${relative} ${section}.${modernPackageName} is ${actual}`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.map(error => `- ${error}`).join('\n'));
  }
}

function packageScriptExists(projectDir, scriptName) {
  const packageJson = readJson(path.join(projectDir, 'package.json'));
  return typeof packageJson.scripts?.[scriptName] === 'string';
}

function createWorkspace(workDir, projectName, createPackage) {
  run(
    'pnpm',
    [
      'dlx',
      createPackage.exactSpecifier,
      projectName,
      '--ultramodern-workspace',
      '--lang',
      'en',
    ],
    { cwd: workDir },
  );
}

function createSingleApp(workDir, projectName, createPackage) {
  run(
    'pnpm',
    [
      'dlx',
      createPackage.exactSpecifier,
      projectName,
      '--router',
      'tanstack',
      '--bff-runtime',
      'effect',
      '--lang',
      'en',
    ],
    { cwd: workDir },
  );
}

function addVertical(projectDir, vertical, createPackage) {
  run(
    'pnpm',
    [
      'dlx',
      createPackage.exactSpecifier,
      vertical,
      '--vertical',
      '--lang',
      'en',
    ],
    { cwd: projectDir },
  );
}

function playwrightRuntimeDir() {
  const digest = crypto
    .createHash('sha256')
    .update(browserSmokePlaywrightPackage)
    .digest('hex')
    .slice(0, 12);
  return path.join(os.tmpdir(), `ultramodern-browser-smoke-${digest}`);
}

function ensureBrowserSmokeRuntime() {
  const runtimeDir = playwrightRuntimeDir();
  const packageJsonPath = path.join(
    runtimeDir,
    'node_modules/playwright/package.json',
  );
  if (fs.existsSync(packageJsonPath)) {
    return runtimeDir;
  }

  fs.rmSync(runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeDir, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      browserSmokePlaywrightPackage,
    ],
    { cwd: runtimeDir },
  );
  return runtimeDir;
}

function runBrowserSmoke(projectDir, { mode, requirePublicUrls = false }) {
  const artifactDir = `.modern/production-readiness/browser-smoke/${mode}`;
  const out = `.modern/production-readiness/browser-smoke/${mode}-summary.json`;
  const runtimeDir = ensureBrowserSmokeRuntime();
  const args = [
    'node',
    browserSmokeScript,
    '--project-dir',
    projectDir,
    '--artifact-dir',
    artifactDir,
    '--out',
    out,
    '--mode',
    mode,
  ];

  if (requirePublicUrls) {
    args.push('--require-public-urls');
  }

  run(args[0], args.slice(1), {
    env: {
      ULTRAMODERN_BROWSER_SMOKE_PLAYWRIGHT_ROOT: runtimeDir,
    },
  });
  return readJson(path.resolve(repoRoot, out));
}

function createSharedContractVersionAssertion({ topology, generatedContract }) {
  const versions = [
    topology?.shell?.moduleFederation?.sharedContractVersion,
    ...(topology?.verticals ?? []).map(
      vertical => vertical.moduleFederation?.sharedContractVersion,
    ),
    ...(generatedContract?.apps ?? []).map(
      app => app.moduleFederation?.sharedContractVersion,
    ),
  ].filter(value => typeof value === 'string' && value.length > 0);
  const uniqueVersions = [...new Set(versions)].sort();

  if (uniqueVersions.length === 0) {
    return {
      status: 'unknown',
      versions: [],
      message: 'No MF sharedContractVersion values found in topology/contract.',
    };
  }

  return {
    status: uniqueVersions.length === 1 ? 'pass' : 'fail',
    versions: uniqueVersions,
  };
}

function createTopologyEvidence({
  selectedProfile,
  verticalNames,
  topology,
  generatedContract,
  packageCohortAssertion,
}) {
  const topologyVerticals = topology?.verticals ?? [];
  const contractApps = generatedContract?.apps ?? [];
  const contractVerticals = contractApps.filter(app => app.kind === 'vertical');
  const topologyShellRemoteCount =
    topology?.shell?.moduleFederation?.remotes?.length;
  const contractShellRemoteCount = contractApps.find(
    app => app.kind === 'shell',
  )?.moduleFederation?.remotes?.length;
  const mfRemoteCount =
    topologyShellRemoteCount ??
    contractShellRemoteCount ??
    contractVerticals.length;

  return {
    selectedProfile: selectedProfile.id,
    verticalCount: verticalNames.length,
    verticalNames,
    mfRemoteCount,
    contractCounts: {
      topologyVerticals: topologyVerticals.length,
      topologySharedPackages: topology?.sharedPackages?.length ?? 0,
      generatedContractApps: contractApps.length,
      generatedContractVerticals: contractVerticals.length,
    },
    sharedVersionAssertions: {
      packageCohort: packageCohortAssertion,
      moduleFederationSharedContract: createSharedContractVersionAssertion({
        topology,
        generatedContract,
      }),
    },
  };
}

function readGeneratedTopologyEvidence(
  projectDir,
  options,
  packageCohortAssertion,
) {
  return createTopologyEvidence({
    selectedProfile: options.selectedProfile,
    verticalNames: options.verticals,
    topology: readJsonIfExists(
      path.join(projectDir, 'topology/reference-topology.json'),
    ),
    generatedContract: readJsonIfExists(
      path.join(projectDir, '.modernjs/ultramodern-generated-contract.json'),
    ),
    packageCohortAssertion,
  });
}

function writeStream(stream, message) {
  return new Promise((resolve, reject) => {
    stream.write(message, error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-production-readiness-'),
  );
  const projectDir = path.join(workDir, options.projectName);
  const singleAppDir = path.join(workDir, options.singleAppProjectName);
  const summary = {
    schemaVersion: 1,
    createPackage: undefined,
    projectDir,
    singleAppDir,
    scaleProfile: options.scaleProfile,
    verticals: options.verticals,
    verticalCount: options.verticalCount,
    checks: [],
    timings: {},
  };

  try {
    const createPackage = timedStep(summary, 'createResolution', () =>
      resolveCreatePackage(options.createPackage),
    );
    summary.createPackage = createPackage;

    timedStep(summary, 'singleAppCreation', () =>
      createSingleApp(workDir, options.singleAppProjectName, createPackage),
    );
    timedStep(summary, 'singleAppCohortAssertion', () =>
      assertGeneratedCohort(singleAppDir, createPackage.frameworkVersion, {
        expectedTemplateVersion: createPackage.version,
        manifestPath: '.modernjs/mv-template-manifest.json',
      }),
    );
    summary.checks.push('single-app-published-cohort-alignment');

    await timedStepAsync(summary, 'singleAppSsrServeProof', () =>
      runSingleAppSsrProof(singleAppDir),
    );
    summary.checks.push('single-app-install');
    summary.checks.push('single-app-build');
    summary.checks.push('single-app-ssr-serve');

    timedStep(summary, 'workspaceCreation', () =>
      createWorkspace(workDir, options.projectName, createPackage),
    );
    summary.verticalAddTimings = [];
    timedStep(summary, 'addVerticals', () => {
      for (const vertical of options.verticals) {
        const startedAt = performance.now();
        addVertical(projectDir, vertical, createPackage);
        summary.verticalAddTimings.push({
          vertical,
          status: 'pass',
          durationMs: roundDurationMs(performance.now() - startedAt),
        });
      }
    });

    let packageCohortAssertion;
    try {
      packageCohortAssertion = timedStep(
        summary,
        'sharedVersionAssertion',
        () => {
          assertGeneratedCohort(projectDir, createPackage.frameworkVersion, {
            expectedTemplateVersion: createPackage.version,
            manifestPath:
              '.modernjs/ultramodern-workspace-template-manifest.json',
            workspaceManifest: true,
          });
          return {
            status: 'pass',
            expectedVersion: createPackage.frameworkVersion,
          };
        },
      );
    } catch (error) {
      packageCohortAssertion = {
        status: 'fail',
        expectedVersion: createPackage.frameworkVersion,
        error: error instanceof Error ? error.message : String(error),
      };
      summary.topologyEvidence = readGeneratedTopologyEvidence(
        projectDir,
        options,
        packageCohortAssertion,
      );
      throw error;
    }
    summary.topologyEvidence = readGeneratedTopologyEvidence(
      projectDir,
      options,
      packageCohortAssertion,
    );
    summary.checks.push('workspace-published-cohort-alignment');

    timedStep(summary, 'install', () =>
      run('pnpm', ['install'], { cwd: projectDir }),
    );
    summary.checks.push('install');

    timedStep(summary, 'check', () =>
      run('pnpm', ['check'], { cwd: projectDir }),
    );
    summary.checks.push('check');

    if (packageScriptExists(projectDir, 'ultramodern:check')) {
      timedStep(summary, 'ultramodernCheck', () =>
        run('pnpm', ['ultramodern:check'], { cwd: projectDir }),
      );
      summary.checks.push('ultramodern-check');
    } else {
      summary.timings.ultramodernCheck = skippedTiming(
        'package.json does not define ultramodern:check',
      );
    }

    timedStep(summary, 'build', () =>
      run('pnpm', ['build'], { cwd: projectDir }),
    );
    summary.checks.push('build');

    summary.browserSmoke = {
      local: timedStep(summary, 'browserSmokeLocal', () =>
        runBrowserSmoke(projectDir, { mode: 'local' }),
      ),
    };
    summary.checks.push('browser-smoke-local');

    if (options.deployCloudflare) {
      timedStep(summary, 'cloudflareDeploy', () => {
        run('pnpm', ['cloudflare:deploy'], { cwd: projectDir });
        run('pnpm', ['cloudflare:proof', '--', '--require-public-urls'], {
          cwd: projectDir,
        });
      });
      summary.browserSmoke.public = timedStep(
        summary,
        'browserSmokePublic',
        () =>
          runBrowserSmoke(projectDir, {
            mode: 'public',
            requirePublicUrls: true,
          }),
      );
      summary.checks.push('cloudflare-deploy-proof');
      summary.checks.push('browser-smoke-public');
    }

    summary.ok = true;
    writeJson(options.out, summary);
    await writeStream(
      process.stdout,
      `[ultramodern-production-readiness] pass: ${options.out}\n`,
    );
    return 0;
  } catch (error) {
    summary.ok = false;
    summary.error = error instanceof Error ? error.message : String(error);
    writeJson(options.out, summary);
    await writeStream(
      process.stderr,
      `[ultramodern-production-readiness] ${summary.error}\n`,
    );
    return 1;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  let exitCode = 1;
  try {
    exitCode = await main();
  } catch (error) {
    await writeStream(
      process.stderr,
      `[ultramodern-production-readiness] ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
  process.exit(exitCode);
}

export {
  assertGeneratedCohort,
  createTopologyEvidence,
  generateVerticalNames,
  parseArgs,
  resolveCreatePackage,
  scaleProfiles,
};
