#!/usr/bin/env node
// Run the original React corpus through its existing staged tests/node_modules CLI seam.
// The caller owns workDir and retains it; this runner stops only its own registry.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  assertCohortResolutionProvenance,
  createAcceptancePackageManagerEnv,
} from '../../ultramodern-production-readiness/published-create-proof/acceptance-profile.mjs';
import { createProcessEnv } from '../../ultramodern-production-readiness/published-create-proof/constants.mjs';
import { inspectNpmTarball } from '../../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs';
import { readReleaseManifest } from '../../ultramodern-publish/lib/source-create-proof/release-manifest.mjs';
import { startEphemeralRegistry } from '../../ultramodern-publish/lib/source-create-proof/runtime-proof/registry.mjs';
import {
  assertReactBaselineDataLoaderPackageCurrent,
  assertReactBaselineInputsUnchanged,
  auditReactBaselineConsumerOutputs,
  createReactBaselineBuildToolDependencies,
  createReactBaselineRootDeclarationDependencies,
  createReactBaselineTransportOverrides,
  materializeReactBaselineDataLoaderPackage,
  REACT_BASELINE_SUITES,
  stageReactBaselineInputs,
} from './react-baseline-staging.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const suiteCounts = Object.freeze([9, 2, 1, 5]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function selectReactBaselineRun({ diagnostic, receipt }) {
  assert.ok(
    diagnostic === undefined || diagnostic === 'mf9',
    'The only supported diagnostic profile is mf9',
  );
  if (diagnostic === 'mf9') {
    assert.equal(
      receipt,
      undefined,
      'MF9 diagnostics cannot write a baseline receipt; omit --receipt',
    );
    return Object.freeze({
      diagnostic: true,
      suites: Object.freeze([REACT_BASELINE_SUITES[0]]),
      commandName: 'mf9',
    });
  }
  return Object.freeze({
    diagnostic: false,
    suites: REACT_BASELINE_SUITES,
    commandName: 'react17',
  });
}

function within(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  );
}

function assertOriginalCorpusRevision(stage, revision) {
  assert.match(
    revision,
    /^[a-f0-9]{40}$/u,
    'The candidate must name an exact original source commit',
  );
  const references = stage.inputFiles.map(input => {
    assert.ok(
      !/[\r\n]/u.test(input.relativePath),
      'Original source paths must be unambiguous',
    );
    return `${revision}:${input.relativePath}`;
  });
  const output = execFileSync('git', ['cat-file', '--batch'], {
    cwd: repoRoot,
    input: `${references.join('\n')}\n`,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let offset = 0;
  for (const input of stage.inputFiles) {
    const newline = output.indexOf(10, offset);
    assert.ok(
      newline >= offset,
      `Original candidate source is absent: ${input.relativePath}`,
    );
    const header = /^[a-f0-9]{40} blob (\d+)$/u.exec(
      output.subarray(offset, newline).toString(),
    );
    assert.ok(
      header,
      `Original candidate source is not a tracked blob: ${input.relativePath}`,
    );
    const start = newline + 1;
    const end = start + Number(header[1]);
    assert.equal(
      hash(output.subarray(start, end)),
      input.sha256,
      `Copied original input differs from candidate source: ${input.relativePath}`,
    );
    assert.equal(output[end], 10, 'Original source batch was truncated');
    offset = end + 1;
  }
  assert.equal(
    offset,
    output.length,
    'Original source batch contains unexpected records',
  );
}

/** Require native test records, including all original files and zero skipped cases. */
export function assertReactBaselineReport(report, version) {
  assert.equal(report.tool, 'rstest', 'A native Rstest report is required');
  assert.equal(
    report.version,
    version,
    'Rstest report version differs from the installed runner',
  );
  assert.equal(report.status, 'pass', 'Original React corpus did not pass');
  assert.deepEqual(
    report.summary,
    {
      testFiles: 4,
      failedFiles: 0,
      tests: 17,
      failedTests: 0,
      passedTests: 17,
      skippedTests: 0,
      todoTests: 0,
    },
    'Original React corpus requires 17 actual passes and zero skips',
  );
  assert.ok(
    Array.isArray(report.tests) && report.tests.length === 17,
    'Native report must contain all 17 test records',
  );
  assert.ok(
    Array.isArray(report.files) && report.files.length === 4,
    'Native report must contain the four original test files',
  );
  assert.equal(
    report.unhandledErrors?.length ?? 0,
    0,
    'Native Rstest reported unhandled errors',
  );
  const seen = new Set();
  for (const [index, suite] of REACT_BASELINE_SUITES.entries()) {
    const records = report.tests.filter(test => test.testPath === suite);
    const files = report.files.filter(file => file.testPath === suite);
    assert.equal(
      files.length,
      1,
      `Missing or duplicate original suite: ${suite}`,
    );
    assert.equal(files[0].status, 'pass', `Original suite failed: ${suite}`);
    assert.equal(
      records.length,
      suiteCounts[index],
      `Original case count differs: ${suite}`,
    );
    assert.equal(
      files[0].results?.length,
      suiteCounts[index],
      `Native file case count differs: ${suite}`,
    );
    for (const test of records) {
      assert.equal(
        test.status,
        'pass',
        `Original case did not run successfully: ${test.fullName}`,
      );
      assert.ok(
        typeof test.fullName === 'string' && test.fullName.length > 0,
        'Native original case must have its full name',
      );
      const key = `${suite}\0${test.fullName}`;
      assert.ok(
        !seen.has(key),
        `Duplicate original test record: ${test.fullName}`,
      );
      seen.add(key);
    }
    assert.ok(
      files[0].results.every(test => test.status === 'pass'),
      `Native file contains an unsuccessful case: ${suite}`,
    );
  }
  assert.equal(
    seen.size,
    17,
    'Foreign test records cannot replace the original corpus',
  );
  return report.summary;
}

/** Extract the real CLI JSON reporter from its otherwise unchanged build/test stdout. */
function readNativeRstestReport(stdout) {
  const matches = [...stdout.matchAll(/\{\s*"tool"\s*:\s*"rstest"/gu)];
  assert.equal(
    matches.length,
    1,
    'Expected exactly one native Rstest JSON report',
  );
  const start = matches[0].index;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < stdout.length; index += 1) {
    const character = stdout[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        const bytes = stdout.slice(start, index + 1);
        const report = JSON.parse(bytes);
        return { report, bytes: Buffer.from(`${bytes}\n`) };
      }
    }
  }
  throw new Error('Native Rstest JSON report was truncated');
}

export function readReactBaselineReport(stdout, version) {
  const parsed = readNativeRstestReport(stdout);
  assertReactBaselineReport(parsed.report, version);
  return parsed;
}

/** Preserve actual MF outcomes for diagnostics without granting baseline qualification. */
export function readReactMfDiagnosticReport(stdout, version) {
  const parsed = readNativeRstestReport(stdout);
  const { report } = parsed;
  const suite = REACT_BASELINE_SUITES[0];
  assert.equal(report.tool, 'rstest', 'A native Rstest report is required');
  assert.equal(
    report.version,
    version,
    'Rstest report version differs from the installed runner',
  );
  assert.ok(
    report.status === 'pass' || report.status === 'fail',
    'MF9 diagnostic requires a completed native report',
  );
  assert.ok(
    Array.isArray(report.files) && report.files.length === 1,
    'MF9 diagnostic requires exactly its original test file',
  );
  const file = report.files[0];
  assert.equal(file.testPath, suite, 'MF9 diagnostic contains a foreign file');
  assert.ok(file.status === 'pass' || file.status === 'fail');
  assert.ok(
    Array.isArray(report.tests) && report.tests.length === 9,
    'MF9 diagnostic requires all nine native test records',
  );
  assert.ok(Array.isArray(file.results) && file.results.length === 9);
  assert.ok(Array.isArray(report.unhandledErrors ?? []));
  const names = new Set();
  const counts = { pass: 0, fail: 0, skip: 0, todo: 0 };
  for (const record of report.tests) {
    assert.equal(
      record.testPath,
      suite,
      'MF9 diagnostic contains a foreign case',
    );
    assert.ok(Object.hasOwn(counts, record.status));
    assert.ok(
      typeof record.fullName === 'string' && record.fullName.length > 0,
    );
    assert.ok(
      !names.has(record.fullName),
      'MF9 diagnostic contains duplicate cases',
    );
    names.add(record.fullName);
    counts[record.status] += 1;
  }
  const cases = records =>
    records
      .map(record => [record.testPath, record.fullName, record.status])
      .sort();
  assert.deepEqual(cases(file.results), cases(report.tests));
  assert.deepEqual(report.summary, {
    testFiles: 1,
    failedFiles: file.status === 'fail' ? 1 : 0,
    tests: 9,
    failedTests: counts.fail,
    passedTests: counts.pass,
    skippedTests: counts.skip,
    todoTests: counts.todo,
  });
  if (report.status === 'pass') {
    assert.equal(file.status, 'pass', 'MF9 diagnostic file did not pass');
    assert.equal(
      counts.pass,
      9,
      'MF9 diagnostic pass requires nine actual passes',
    );
    assert.equal(report.unhandledErrors?.length ?? 0, 0);
  }
  return parsed;
}

function installedCandidatePackages(shadow, release) {
  const expected = new Map([
    ...release.packages.map(item => [item.targetName, item]),
    ...release.sidecars.packages.map(item => [item.name, item]),
  ]);
  const inspected = new Map();
  const installed = [];
  const virtualStore = path.join(shadow, 'node_modules/.pnpm');
  assert.ok(
    fs.lstatSync(virtualStore).isDirectory(),
    'An ordinary pnpm virtual store is required',
  );
  for (const entry of fs.readdirSync(virtualStore, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const scope = path.join(
      virtualStore,
      entry.name,
      'node_modules',
      `@${release.targetScope}`,
    );
    if (!fs.existsSync(scope)) continue;
    for (const packageEntry of fs.readdirSync(scope, { withFileTypes: true })) {
      const directory = fs.realpathSync(path.join(scope, packageEntry.name));
      assert.ok(
        within(shadow, directory),
        'Installed candidate must remain in the owned shadow',
      );
      const packageJson = readJson(path.join(directory, 'package.json'));
      const item = expected.get(packageJson.name);
      assert.ok(
        item,
        `Installed package is outside the accepted candidate: ${packageJson.name}`,
      );
      assert.equal(
        packageJson.version,
        item.version,
        `Installed candidate version differs: ${packageJson.name}`,
      );
      if (!inspected.has(item.sha256)) {
        const bytes =
          item.bytes ??
          fs.readFileSync(path.join(release.artifactRoot, item.tarballPath));
        assert.equal(
          hash(bytes),
          item.sha256,
          `Candidate tarball changed: ${packageJson.name}`,
        );
        inspected.set(item.sha256, inspectNpmTarball(bytes));
      }
      for (const [relativePath, bytes] of inspected.get(item.sha256)
        .fileContents) {
        const installedFile = path.join(directory, relativePath);
        const stat = fs.lstatSync(installedFile);
        assert.ok(
          stat.isFile(),
          `Installed candidate file must be ordinary: ${installedFile}`,
        );
        assert.ok(
          fs.readFileSync(installedFile).equals(bytes),
          `Installed candidate bytes differ: ${packageJson.name}/${relativePath}`,
        );
      }
      installed.push({
        name: packageJson.name,
        version: item.version,
        directory,
        tarballSha256: item.sha256,
        packageJsonSha256: item.packageJsonSha256,
      });
    }
  }
  assert.ok(
    installed.length > 0,
    'No actual candidate packages were installed',
  );
  return installed.sort((left, right) =>
    left.directory.localeCompare(right.directory),
  );
}

function exposeDataLoaderPrerequisite(shadow, installed, release) {
  const name = release.aliases['@modern-js/plugin-data-loader'];
  const accepted = release.packages.filter(
    item =>
      item.sourceName === '@modern-js/plugin-data-loader' &&
      item.targetName === name,
  );
  assert.equal(
    accepted.length,
    1,
    'The data-loader prerequisite requires its exact accepted public owner',
  );
  const owner = accepted[0];
  const matches = installed.filter(item => item.name === name);
  assert.ok(
    matches.length > 0,
    'The candidate data-loader runtime was not installed',
  );
  assert.equal(matches[0].tarballSha256, owner.sha256);
  const bytes =
    owner.bytes ??
    fs.readFileSync(path.join(release.artifactRoot, owner.tarballPath));
  assert.equal(
    hash(bytes),
    owner.sha256,
    'Candidate data-loader tarball changed',
  );
  const inspection = inspectNpmTarball(bytes);
  assert.equal(inspection.packageJson.name, name);
  assert.equal(inspection.packageJson.version, owner.version);
  assert.equal(inspection.packageJsonSha256, owner.packageJsonSha256);
  const runtime = inspection.fileContents.get('dist/esm/runtime/index.mjs');
  assert.ok(
    Buffer.isBuffer(runtime),
    'The genuine packed data-loader runtime is missing',
  );
  const materialization = materializeReactBaselineDataLoaderPackage({
    consumerRoot: shadow,
    inspection,
  });
  return {
    ...materialization,
    kind: 'ordinary-authenticated-public-tarball-members',
    packageName: name,
    packageVersion: owner.version,
    packageDirectory: materialization.path,
    installedPackageDirectory: matches[0].directory,
    tarballSha256: owner.sha256,
    packageJsonSha256: owner.packageJsonSha256,
    runtimeSha256: hash(runtime),
  };
}

/** Materialize and execute only in a fresh caller-owned root; outputs remain owned by caller. */
export async function runReactBaselineCandidate(options) {
  const selection = selectReactBaselineRun(options);
  const {
    manifest,
    workDir,
    receipt,
    storeDir,
    pnpmExecutable,
    browserExecutable,
  } = options;
  for (const [name, value] of Object.entries({
    manifest,
    workDir,
    ...(selection.diagnostic ? {} : { receipt }),
    storeDir,
    pnpmExecutable,
    browserExecutable,
  })) {
    assert.ok(
      typeof value === 'string' && path.isAbsolute(value),
      `${name} must be absolute`,
    );
  }
  if (!selection.diagnostic) {
    assert.ok(
      !fs.existsSync(receipt),
      'Consumer receipt must be fresh and exclusive',
    );
  }
  assert.ok(
    fs.lstatSync(workDir).isDirectory() && fs.readdirSync(workDir).length === 0,
    'The caller must provide a fresh empty owned work directory',
  );
  assert.ok(
    fs.lstatSync(browserExecutable).isFile(),
    'A genuine browser executable is required',
  );
  const release = readReleaseManifest({ manifestPath: manifest });
  assert.ok(
    release.sidecars?.packages.length > 0,
    'The exact maintained sidecar lane is required',
  );
  if (options.expectedSourceRevision !== undefined) {
    assert.equal(
      release.source.commit,
      options.expectedSourceRevision,
      'Candidate source revision differs',
    );
  }
  const stage = stageReactBaselineInputs({
    repoRoot,
    workDir: path.join(workDir, 'consumer'),
  });
  assertOriginalCorpusRevision(stage, release.source.commit);
  const rootPackage = readJson(path.join(repoRoot, 'package.json'));
  const declarationSource = execFileSync(
    'git',
    ['show', `${release.source.commit}:package.json`],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const rootDeclarations = createReactBaselineRootDeclarationDependencies(
    JSON.parse(declarationSource.toString('utf8')),
  );
  const rootWorkspace = parseYaml(
    fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'),
  );
  const rstestVersion = rootPackage.devDependencies['@rstest/core'];
  assert.match(
    rstestVersion,
    /^\d+\.\d+\.\d+$/u,
    'The original runner version must be exact',
  );
  const testBuildTools = createReactBaselineBuildToolDependencies(
    release,
    readJson(
      path.join(stage.testsDir, 'integration/routes-tanstack-rsc/package.json'),
    ),
  );
  fs.writeFileSync(
    path.join(stage.workDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'ultramodern-react-baseline-transport',
        private: true,
        packageManager: rootPackage.packageManager,
        devDependencies: {
          '@rstest/core': rstestVersion,
          '@modern-js/tsconfig':
            rootPackage.devDependencies['@modern-js/tsconfig'],
          ...rootDeclarations,
          ...testBuildTools,
        },
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  );
  fs.writeFileSync(
    path.join(stage.workDir, 'pnpm-workspace.yaml'),
    stringifyYaml({
      packages: [
        'tests',
        ...stage.fixturePackagePaths.map(file =>
          path.relative(stage.workDir, path.dirname(file)),
        ),
      ],
      autoInstallPeers: rootWorkspace.autoInstallPeers,
      linkWorkspacePackages: rootWorkspace.linkWorkspacePackages,
      strictPeerDependencies: rootWorkspace.strictPeerDependencies,
      verifyDepsBeforeRun: rootWorkspace.verifyDepsBeforeRun,
      allowBuilds: rootWorkspace.allowBuilds,
      packageImportMethod: 'clone-or-copy',
      overrides: createReactBaselineTransportOverrides(release),
    }),
    { flag: 'wx' },
  );
  let registry;
  let child;
  let interrupted;
  const commands = [];
  const interrupt = signal => {
    interrupted ??= signal;
    // This is only the runner's own direct child; the owned-temp wrapper reaps its group.
    child?.kill(signal);
  };
  const onInt = () => interrupt('SIGINT');
  const onTerm = () => interrupt('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  const run = async (args, cwd, env, name, allowFailure = false) => {
    assert.ok(!interrupted, `Consumer interrupted by ${interrupted}`);
    const stdoutPath = path.join(workDir, `${name}.stdout.log`);
    const stderrPath = path.join(workDir, `${name}.stderr.log`);
    const stdout = fs.openSync(stdoutPath, 'wx');
    const stderr = fs.openSync(stderrPath, 'wx');
    let outcome;
    try {
      child = spawn(pnpmExecutable, args, {
        cwd,
        env: createProcessEnv(env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', bytes => {
        fs.writeSync(stdout, bytes);
        process.stdout.write(bytes);
      });
      child.stderr.on('data', bytes => {
        fs.writeSync(stderr, bytes);
        process.stderr.write(bytes);
      });
      outcome = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (exitCode, signal) =>
          resolve({ exitCode, signal }),
        );
      });
    } finally {
      child = undefined;
      fs.closeSync(stdout);
      fs.closeSync(stderr);
    }
    commands.push({
      executable: pnpmExecutable,
      args,
      cwd,
      ...outcome,
      stdoutPath,
      stderrPath,
    });
    if (!allowFailure) {
      assert.equal(
        outcome.exitCode,
        0,
        `${name} exited ${outcome.exitCode} (${outcome.signal ?? 'no signal'})`,
      );
    }
    assert.ok(!interrupted, `Consumer interrupted by ${interrupted}`);
    return fs.readFileSync(stdoutPath, 'utf8');
  };
  try {
    registry = await startEphemeralRegistry({
      release,
      releaseDir: release.artifactRoot,
      rootDir: path.join(workDir, 'registry'),
      storeDir,
      spawnImpl: (command, args, settings) =>
        spawn(command === 'pnpm' ? pnpmExecutable : command, args, {
          ...settings,
          env: createProcessEnv({
            ...settings.env,
            PATH: [
              path.dirname(pnpmExecutable),
              settings.env?.PATH ?? process.env.PATH,
            ]
              .filter(Boolean)
              .join(path.delimiter),
          }),
        }),
    });
    assert.ok(!interrupted, `Consumer interrupted by ${interrupted}`);
    const env = createAcceptancePackageManagerEnv(
      workDir,
      registry.env,
      pnpmExecutable,
      process.env,
      { storeDir },
    );
    Object.assign(env, {
      MODERN_TEST_PACKAGE_MANIFEST: undefined,
      INTEGRATION_MAX_WORKERS: '1',
      MODERN_SERVER_LOG_LEVEL: 'info',
      PUPPETEER_EXECUTABLE_PATH: browserExecutable,
      PUPPETEER_SKIP_DOWNLOAD: 'true',
    });
    await run(
      ['install', '--lockfile-only', '--ignore-scripts'],
      stage.workDir,
      env,
      'lock',
    );
    const provenance = assertCohortResolutionProvenance(
      stage.workDir,
      release,
      registry.registryUrl,
    );
    await run(['install', '--frozen-lockfile'], stage.workDir, env, 'install');
    assertCohortResolutionProvenance(
      stage.workDir,
      release,
      registry.registryUrl,
    );
    const installed = installedCandidatePackages(stage.workDir, release);
    const prerequisite = exposeDataLoaderPrerequisite(
      stage.workDir,
      installed,
      release,
    );
    const runnerPackagePath = fs.realpathSync(
      path.join(stage.workDir, 'node_modules/@rstest/core/package.json'),
    );
    assert.ok(
      within(stage.workDir, runnerPackagePath),
      'The original test runner must be genuinely installed in the owned shadow',
    );
    const runnerPackage = readJson(runnerPackagePath);
    assert.equal(
      runnerPackage.name,
      '@rstest/core',
      'Installed test runner identity differs',
    );
    assert.equal(
      runnerPackage.version,
      rstestVersion,
      'Installed test runner version differs',
    );
    const cli = fs.realpathSync(
      path.join(
        stage.testsDir,
        'node_modules/@modern-js/app-tools/bin/modern.js',
      ),
    );
    assert.ok(
      installed.some(
        item =>
          item.name === release.aliases['@modern-js/app-tools'] &&
          within(item.directory, cli),
      ),
      'The unchanged harness CLI must resolve to the genuine installed candidate',
    );
    assertReactBaselineInputsUnchanged(stage);
    assertReactBaselineInputsUnchanged(stage, repoRoot);
    assertReactBaselineDataLoaderPackageCurrent(prerequisite);
    const stdout = await run(
      ['exec', 'rstest', 'run', ...selection.suites, '--reporter', 'json'],
      stage.testsDir,
      env,
      selection.commandName,
      selection.diagnostic,
    );
    const { report, bytes } = selection.diagnostic
      ? readReactMfDiagnosticReport(stdout, rstestVersion)
      : readReactBaselineReport(stdout, rstestVersion);
    const reportPath = path.join(workDir, 'rstest-report.json');
    fs.writeFileSync(reportPath, bytes, { flag: 'wx' });
    const generatedOutputs = auditReactBaselineConsumerOutputs(stage);
    assertReactBaselineInputsUnchanged(stage, repoRoot);
    assertReactBaselineDataLoaderPackageCurrent(prerequisite);
    installedCandidatePackages(stage.workDir, release);
    const result = {
      schema: selection.diagnostic
        ? 'bleedingdev.ultramodern.original-react-mf-diagnostic'
        : 'bleedingdev.ultramodern.original-react-baseline',
      schemaVersion: 1,
      status:
        report.status === 'pass' && commands.at(-1).exitCode === 0
          ? 'passed'
          : 'failed',
      ...(selection.diagnostic ? { qualification: 'diagnostic-only' } : {}),
      candidate: {
        manifestPath: release.manifestPath,
        manifestSha256: release.manifestSha256,
        sourceRevision: release.source.commit,
        version: release.release.version,
        cohortDigest: release.cohortDigest,
      },
      transport: {
        kind: 'ordinary-pnpm-authenticated-candidate-registry',
        registryUrl: registry.registryUrl,
        provenance,
        installedPackages: installed,
        originalCli: cli,
        prerequisite,
        testBuildTools,
        rootDeclarationContext: {
          sourceRevision: release.source.commit,
          sourcePath: 'package.json',
          sourceSha256: hash(declarationSource),
          devDependencies: rootDeclarations,
        },
      },
      inputs: stage.inputFiles,
      inputDigest: hash(Buffer.from(JSON.stringify(stage.inputFiles))),
      generatedOutputs,
      suites: selection.suites,
      summary: report.summary,
      report: {
        path: reportPath,
        sha256: hash(bytes),
        tool: report.tool,
        version: report.version,
        packageJsonPath: runnerPackagePath,
        packageJsonSha256: hash(fs.readFileSync(runnerPackagePath)),
      },
      browser: {
        executable: browserExecutable,
        sha256: hash(fs.readFileSync(browserExecutable)),
      },
      node: { executable: process.execPath, version: process.version },
      commands,
      workDir,
      outputs: 'retained-caller-owned',
    };
    // No success receipt is issued until the owned registry has actually stopped.
    await registry.stop();
    registry = undefined;
    if (selection.diagnostic) {
      const diagnosticPath = path.join(workDir, 'mf9-diagnostic.json');
      fs.writeFileSync(diagnosticPath, `${JSON.stringify(result, null, 2)}\n`, {
        flag: 'wx',
      });
      console.log(
        `Original MF9 diagnostic (${result.status}): ${diagnosticPath}`,
      );
      assert.equal(
        result.status,
        'passed',
        'Original MF9 diagnostic did not pass',
      );
      return result;
    }
    fs.writeFileSync(receipt, `${JSON.stringify(result, null, 2)}\n`, {
      flag: 'wx',
    });
    console.log(
      `Original React baseline: 17 passed, 0 skipped. Receipt: ${receipt}`,
    );
    return result;
  } catch (error) {
    try {
      await registry?.stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Original React baseline failed and its owned registry cleanup failed',
        { cause: error },
      );
    }
    throw error;
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { values } = parseArgs({
    options: {
      manifest: { type: 'string' },
      'work-dir': { type: 'string' },
      receipt: { type: 'string' },
      diagnostic: { type: 'string' },
      'store-dir': { type: 'string' },
      'pnpm-executable': { type: 'string' },
      'browser-executable': { type: 'string' },
      'expected-source-revision': { type: 'string' },
    },
  });
  runReactBaselineCandidate({
    manifest: values.manifest,
    workDir: values['work-dir'],
    receipt: values.receipt,
    diagnostic: values.diagnostic,
    storeDir: values['store-dir'],
    pnpmExecutable: values['pnpm-executable'],
    browserExecutable: values['browser-executable'],
    expectedSourceRevision: values['expected-source-revision'],
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
