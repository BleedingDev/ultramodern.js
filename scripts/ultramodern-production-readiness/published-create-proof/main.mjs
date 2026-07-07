import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from './args.mjs';
import { runBrowserSmoke } from './browser-smoke.mjs';
import {
  createCloudflareDeployProofEvidence,
  createCloudflareProofArgs,
} from './cloudflare.mjs';
import { writeJsonFile, writeStream } from './constants.mjs';
import {
  assertGeneratedCohort,
  createPnpmDlxArgs,
  resolveCreatePackage,
} from './package-cohort.mjs';
import {
  createCleanPnpmDlxEnv,
  roundDurationMs,
  run,
  timedStep,
} from './process.mjs';
import { readGeneratedTopologyEvidence } from './topology.mjs';
import {
  addVertical,
  createWorkspace,
  packageScriptExists,
} from './workspace.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-production-readiness-'),
  );
  const pnpmDlxEnv = createCleanPnpmDlxEnv(path.join(workDir, 'pnpm-dlx'));
  const projectDir = path.join(workDir, options.projectName);
  const summary = {
    schemaVersion: 1,
    suite: 'ultramodern-published-create-proof',
    dimensions: ['integration', 'browser', 'module-federation'],
    status: 'running',
    createPackage: undefined,
    createCommand: undefined,
    projectDir,
    scaleProfile: options.scaleProfile,
    verticals: options.verticals,
    verticalCount: options.verticalCount,
    checks: [],
    evidence: [],
    timings: {},
  };

  try {
    const createPackage = timedStep(summary, 'createResolution', () =>
      resolveCreatePackage(options.createPackage),
    );
    summary.createPackage = createPackage;
    summary.createCommand = {
      runner: 'pnpm dlx',
      requestedPackageSpecifier: createPackage.dlxSpecifier,
      executedPackageSpecifier: createPackage.exactSpecifier,
      command: [
        'pnpm',
        ...createPnpmDlxArgs(createPackage, ['<project>']),
      ].join(' '),
      cache: 'temporary pnpm store/cache for create and vertical dlx commands',
    };

    timedStep(summary, 'workspaceCreation', () =>
      createWorkspace(workDir, options.projectName, createPackage, pnpmDlxEnv),
    );
    summary.checks.push('pnpm-dlx-clean-cache-command-contract');
    summary.verticalAddTimings = [];
    timedStep(summary, 'addVerticals', () => {
      for (const vertical of options.verticals) {
        const startedAt = performance.now();
        addVertical(projectDir, vertical, createPackage, pnpmDlxEnv);
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

    if (options.commandContractOnly) {
      if (!options.deployCloudflare) {
        summary.evidence.push(createCloudflareDeployProofEvidence());
      }
      summary.checks.push('command-contract-only');
      summary.status = summary.evidence.length > 0 ? 'warning' : 'passed';
      summary.ok = true;
      writeJsonFile(options.out, summary, { atomic: false });
      await writeStream(
        process.stdout,
        `[ultramodern-production-readiness] pass: ${options.out}\n`,
      );
      return 0;
    }

    timedStep(summary, 'install', () =>
      run('pnpm', ['install'], { cwd: projectDir }),
    );
    summary.checks.push('install');

    timedStep(summary, 'check', () =>
      run('pnpm', ['check'], { cwd: projectDir }),
    );
    summary.checks.push('check');

    if (packageScriptExists(projectDir, 'ultramodern:check')) {
      throw new Error(
        'Generated workspace must not define deprecated ultramodern:check; use primitive gates and pnpm check instead.',
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
        run('pnpm', createCloudflareProofArgs({ requirePublicUrls: true }), {
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
    } else {
      summary.evidence.push(createCloudflareDeployProofEvidence());
    }

    summary.status = summary.evidence.length > 0 ? 'warning' : 'passed';
    summary.ok = true;
    writeJsonFile(options.out, summary, { atomic: false });
    await writeStream(
      process.stdout,
      `[ultramodern-production-readiness] pass: ${options.out}\n`,
    );
    return 0;
  } catch (error) {
    summary.ok = false;
    summary.error = error instanceof Error ? error.message : String(error);
    summary.status = 'failed';
    writeJsonFile(options.out, summary, { atomic: false });
    await writeStream(
      process.stderr,
      `[ultramodern-production-readiness] ${summary.error}\n`,
    );
    return 1;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export { main };
