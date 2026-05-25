#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const createBin = path.join(repoRoot, 'packages/toolkit/create/bin/run.js');
const doctorBin = path.join(
  repoRoot,
  'scripts/ultramodern-contract-doctor/run-contract-doctor.js',
);
const controlPlaneBin = path.join(
  repoRoot,
  'scripts/superapp-local-control-plane/run-local-control-plane.js',
);

function normalize(filePath) {
  return filePath.split(path.sep).join('/');
}

function relativeToRepo(filePath) {
  const relativePath = path.relative(repoRoot, filePath);
  return relativePath.startsWith('..') ? filePath : relativePath || '.';
}

function commandLabel(command, args) {
  return [relativeToRepo(command), ...args].join(' ');
}

function runNode(command, args, options = {}) {
  const cwd = options.cwd || repoRoot;
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    command: commandLabel(command, args),
    cwd: normalize(relativeToRepo(cwd)),
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    ok: result.status === 0,
  };
}

function readJsonOutput(step) {
  try {
    return JSON.parse(step.stdout);
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : String(error),
      stdout: step.stdout,
    };
  }
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseArgs(argv) {
  const options = {
    workspace: undefined,
    packageName: 'ultramodern-preflight-workspace',
    overlay: 'none',
    mode: 'dry-run',
    packageSource: undefined,
    packageVersion: undefined,
    packageRegistry: undefined,
    packageScope: undefined,
    packageNamePrefix: undefined,
    keep: false,
    json: false,
    out: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') {
      options.workspace = argv[++index];
    } else if (arg === '--package-name') {
      options.packageName = argv[++index];
    } else if (arg === '--overlay') {
      options.overlay = argv[++index];
    } else if (arg === '--mode') {
      options.mode = argv[++index];
    } else if (arg === '--ultramodern-package-source') {
      options.packageSource = argv[++index];
    } else if (arg === '--ultramodern-package-version') {
      options.packageVersion = argv[++index];
    } else if (arg === '--ultramodern-package-registry') {
      options.packageRegistry = argv[++index];
    } else if (arg === '--ultramodern-package-scope') {
      options.packageScope = argv[++index];
    } else if (arg === '--ultramodern-package-name-prefix') {
      options.packageNamePrefix = argv[++index];
    } else if (arg === '--keep') {
      options.keep = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--out') {
      options.out = argv[++index];
    }
  }

  return options;
}

function createWorkspaceArgs(workspace, options) {
  const args = [workspace, '--ultramodern-workspace', '--lang', 'en'];
  if (options.packageSource) {
    args.push('--ultramodern-package-source', options.packageSource);
  }
  if (options.packageVersion) {
    args.push('--ultramodern-package-version', options.packageVersion);
  }
  if (options.packageRegistry) {
    args.push('--ultramodern-package-registry', options.packageRegistry);
  }
  if (options.packageScope) {
    args.push('--ultramodern-package-scope', options.packageScope);
  }
  if (options.packageNamePrefix) {
    args.push('--ultramodern-package-name-prefix', options.packageNamePrefix);
  }
  return args;
}

function workspaceNeedsGeneration(workspace) {
  return (
    !fs.existsSync(workspace) ||
    fs.readdirSync(workspace, { withFileTypes: true }).length === 0
  );
}

function createSmokeChecks(doctor, controlPlane) {
  const processRoles = new Set(
    (controlPlane.processes || []).map(process => process.role),
  );
  const fullStackVerticals = (controlPlane.processes || []).filter(process =>
    process.capabilities?.includes('effect-bff'),
  );
  const plannedCount = controlPlane.summary?.planned || 0;
  const totalCount = controlPlane.summary?.total || 0;
  const checks = [
    {
      id: 'doctor-pass',
      status: doctor.status === 'pass' ? 'pass' : 'fail',
      message: 'Contract doctor passes against the generated workspace.',
    },
    {
      id: 'control-plane-process-count',
      status: totalCount >= 4 && plannedCount >= 4 ? 'pass' : 'fail',
      message:
        'Local control-plane plan includes shell, full-stack remotes, and design-system remote.',
      expected: 'at least 4 planned processes',
      actual: `${plannedCount}/${totalCount}`,
    },
    {
      id: 'control-plane-roles',
      status:
        processRoles.has('shell') &&
        processRoles.has('remote') &&
        processRoles.has('design-system-remote') &&
        fullStackVerticals.length >= 2
          ? 'pass'
          : 'fail',
      message:
        'Local control-plane plan covers shell, MF remotes, design system, and full-stack Effect BFF capabilities.',
      actual: {
        roles: Array.from(processRoles).sort(),
        fullStackVerticals: fullStackVerticals.map(process => process.id),
      },
    },
  ];
  return checks;
}

function createStepSummary(name, step) {
  return {
    name,
    command: step.command,
    cwd: step.cwd,
    status: step.ok ? 'pass' : 'fail',
    exitCode: step.status,
    stderr: step.stderr.trim() || undefined,
  };
}

function runUltramodernPreflight(options = {}) {
  const tempRoot = options.workspace
    ? undefined
    : fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-preflight-'));
  const workspace = path.resolve(
    options.workspace || path.join(tempRoot, options.packageName),
  );
  const generated = workspaceNeedsGeneration(workspace);
  const steps = [];

  try {
    if (generated && (options.mode || 'dry-run') === 'live') {
      throw new Error(
        'Live preflight requires --workspace pointing at an existing installed workspace. Generate an install-backed workspace first, run package installation there, then rerun with --workspace.',
      );
    }

    if (generated) {
      const createStep = runNode(
        createBin,
        createWorkspaceArgs(workspace, options),
      );
      steps.push(createStepSummary('generate-workspace', createStep));
      if (!createStep.ok) {
        throw new Error(createStep.stderr || createStep.stdout);
      }
    } else {
      steps.push({
        name: 'generate-workspace',
        command: 'reuse existing workspace',
        cwd: '.',
        status: 'pass',
        exitCode: 0,
      });
    }

    const generatedValidator = runNode(
      path.join(workspace, 'scripts/validate-ultramodern-workspace.mjs'),
      [],
      { cwd: workspace },
    );
    steps.push(createStepSummary('generated-validator', generatedValidator));
    if (!generatedValidator.ok) {
      throw new Error(generatedValidator.stderr || generatedValidator.stdout);
    }

    const doctorStep = runNode(doctorBin, ['--workspace', workspace, '--json']);
    const doctor = readJsonOutput(doctorStep);
    steps.push(createStepSummary('contract-doctor', doctorStep));

    const controlPlaneStep = runNode(controlPlaneBin, [
      '--workspace',
      workspace,
      '--overlay',
      options.overlay || 'none',
      '--mode',
      options.mode || 'dry-run',
      '--json',
    ]);
    const controlPlane = readJsonOutput(controlPlaneStep);
    steps.push(createStepSummary('local-control-plane', controlPlaneStep));

    const smokeChecks = createSmokeChecks(doctor, controlPlane);
    const failedSteps = steps.filter(step => step.status === 'fail');
    const failedSmoke = smokeChecks.filter(check => check.status === 'fail');
    const status =
      failedSteps.length === 0 && failedSmoke.length === 0 ? 'pass' : 'fail';

    return {
      schemaVersion: 1,
      status,
      workspace,
      generated,
      overlay: options.overlay || 'none',
      mode: options.mode || 'dry-run',
      workspaceRetained: Boolean(options.keep || options.workspace),
      steps,
      doctor,
      controlPlane,
      smokeChecks,
      summary: {
        steps: steps.length,
        failedSteps: failedSteps.length,
        smokeChecks: smokeChecks.length,
        failedSmokeChecks: failedSmoke.length,
      },
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      status: 'fail',
      workspace,
      generated,
      overlay: options.overlay || 'none',
      mode: options.mode || 'dry-run',
      workspaceRetained: Boolean(options.keep || options.workspace),
      steps,
      error: error instanceof Error ? error.message : String(error),
      summary: {
        steps: steps.length,
        failedSteps: steps.filter(step => step.status === 'fail').length || 1,
        smokeChecks: 0,
        failedSmokeChecks: 0,
      },
    };
  } finally {
    if (tempRoot && !options.keep) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

function renderHuman(result) {
  const lines = [
    `UltraModern preflight: ${result.status}`,
    `Workspace: ${result.workspaceRetained ? result.workspace : 'temporary workspace cleaned up'}`,
    `Steps: ${result.summary.steps - result.summary.failedSteps}/${result.summary.steps} passed`,
  ];
  for (const step of result.steps || []) {
    lines.push(`- ${step.status.toUpperCase()} ${step.name}: ${step.command}`);
    if (step.stderr) {
      lines.push(`  stderr: ${step.stderr}`);
    }
  }
  for (const check of result.smokeChecks || []) {
    lines.push(`- ${check.status.toUpperCase()} ${check.id}: ${check.message}`);
  }
  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }
  return `${lines.join('\n')}\n`;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  const result = runUltramodernPreflight(options);
  if (options.out) {
    const outPath = path.resolve(options.out);
    ensureParentDir(outPath);
    fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  process.stdout.write(
    options.json ? `${JSON.stringify(result, null, 2)}\n` : renderHuman(result),
  );
  process.exitCode = result.status === 'pass' ? 0 : 1;
}

module.exports = {
  runUltramodernPreflight,
  renderHuman,
};
