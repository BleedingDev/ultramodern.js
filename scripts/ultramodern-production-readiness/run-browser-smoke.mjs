#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import fsKit from '../lib/fs-kit.js';
import processKit from '../lib/process-kit.js';
import { runNodeBackendFederationProof } from './browser-smoke/backend-evidence.mjs';
import {
  assertLocalPortsAvailable,
  launchBrowser,
  startServer,
  startWorkerdProof,
} from './browser-smoke/bootstrap.mjs';
import { validateBrowserTarget } from './browser-smoke/browser-validate.mjs';
import {
  BrowserSmokeError,
  normalizeSmokeContract,
  parseArgs,
  readSmokeContract,
} from './browser-smoke/contract.mjs';
import { validateFailureIsolation } from './browser-smoke/failure-isolation.mjs';
import {
  validateHttpTarget,
  waitForTarget,
} from './browser-smoke/http-validate.mjs';
import {
  bindContractToReleaseIdentity,
  createRuntimeEvidence,
} from './browser-smoke/runtime-evidence.mjs';
import {
  createSmokeTargets,
  orderTargetsForLocalStartup,
} from './browser-smoke/targets.mjs';

export {
  findDuplicateStylesheetHrefs,
  isFatalConsoleMessage,
  remoteBoundaryCandidates,
  validateBrowserTarget,
} from './browser-smoke/browser-validate.mjs';
export {
  BrowserSmokeError,
  normalizeSmokeContract,
  parseArgs,
  readSmokeContract,
} from './browser-smoke/contract.mjs';
export {
  validateHttpTarget,
  waitForTarget,
} from './browser-smoke/http-validate.mjs';
export {
  createSmokeTargets,
  orderTargetsForLocalStartup,
} from './browser-smoke/targets.mjs';
export { assertLocalPortsAvailable };

const { writeJsonFile } = fsKit;
const { writeStream } = processKit;

export function assertStrictRuntimeEvidence(evidence) {
  const failedEvidence = Object.entries(evidence).filter(
    ([, dimension]) => dimension?.status !== 'pass',
  );
  if (failedEvidence.length > 0) {
    throw new BrowserSmokeError(
      `Strict runtime evidence failed: ${failedEvidence
        .map(([dimension]) => dimension)
        .join(', ')}`,
      {
        failedEvidence: Object.fromEntries(failedEvidence),
      },
    );
  }
}

export async function runUltramodernBrowserSmoke(options) {
  if (
    (options.artifactMode === undefined) !==
    (options.platform === undefined)
  ) {
    throw new BrowserSmokeError(
      'artifactMode and platform must be provided together for strict release smoke',
    );
  }
  if (
    options.artifactMode &&
    options.mode === 'local' &&
    (options.shellRuntime ?? 'node') !== options.platform
  ) {
    throw new BrowserSmokeError(
      'Strict local release smoke requires shellRuntime to match platform',
    );
  }
  const { contract: sourceContract, contractPath } = options.contract
    ? {
        contract: normalizeSmokeContract(options.contract, {
          sourcePath: options.contractPath,
        }),
        contractPath: options.contractPath ?? '<provided>',
      }
    : readSmokeContract(options.projectDir);
  const contract =
    options.artifactMode && options.platform
      ? bindContractToReleaseIdentity({
          contract: sourceContract,
          platform: options.platform,
          projectDir: options.projectDir,
        })
      : sourceContract;
  const { skipped, targets } = createSmokeTargets(contract, options);
  if (
    options.artifactMode &&
    (targets.length === 0 ||
      targets.length !== contract.apps.length ||
      skipped.length > 0)
  ) {
    throw new BrowserSmokeError(
      'Strict release smoke requires one executable target for every contract app',
      {
        appIds: contract.apps.map(app => app.id),
        skipped,
        targetAppIds: targets.map(target => target.app.id),
      },
    );
  }
  const report = {
    schemaVersion: 1,
    artifactMode: options.artifactMode,
    artifactDir: options.artifactDir,
    contractPath,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    mode: options.mode,
    platform: options.platform,
    projectDir: options.projectDir,
    shellRuntime:
      options.mode === 'public'
        ? (options.platform ?? 'workerd')
        : (options.shellRuntime ?? 'node'),
    results: [],
    skipped,
    status: 'running',
    targetRuntimes: {},
  };
  const servers = [];
  const serversByAppId = new Map();
  let browser;
  const localStartupOrder =
    options.mode === 'local' ? orderTargetsForLocalStartup(targets) : undefined;
  const startServerImpl = options.startServerImpl ?? startServer;
  const validateBrowserTargetImpl =
    options.validateBrowserTargetImpl ?? validateBrowserTarget;

  try {
    if (localStartupOrder) {
      const preflightLocalPortsImpl =
        options.preflightLocalPortsImpl ?? assertLocalPortsAvailable;
      await preflightLocalPortsImpl(localStartupOrder.validation);
      if (report.shellRuntime === 'workerd') {
        if (localStartupOrder.shells.length !== 1) {
          throw new BrowserSmokeError(
            'workerd browser smoke requires exactly one shell target',
          );
        }
        const startWorkerdProofImpl =
          options.startWorkerdProofImpl ?? startWorkerdProof;
        const server = await startWorkerdProofImpl(options);
        servers.push(server);
        if (!server.targetUrls) {
          throw new BrowserSmokeError(
            'strict all-workerd browser smoke requires a workerd URL for every target',
          );
        }
        for (const target of localStartupOrder.validation) {
          const targetUrl = server.targetUrls[target.app.id];
          if (typeof targetUrl !== 'string' || targetUrl.length === 0) {
            throw new BrowserSmokeError(
              `workerd proof did not publish a URL for ${target.app.id}`,
            );
          }
          target.baseUrl = targetUrl;
          target.port = Number(new URL(targetUrl).port);
          report.targetRuntimes[target.app.id] = 'workerd';
          await waitForTarget(target, {
            fetchImpl: options.fetchImpl ?? fetch,
            requireManifest: target.app.kind !== 'shell',
            retryDelayMs: options.retryDelayMs,
            serverExit: server.exited,
            serverLogPath: server.logPath,
            timeoutMs: options.timeoutMs,
          });
        }
      } else {
        for (const layer of localStartupOrder.remoteLayers) {
          const layerServers = layer.map(target => {
            const server = startServerImpl(target, options);
            servers.push(server);
            serversByAppId.set(target.app.id, server);
            report.targetRuntimes[target.app.id] = 'node';
            return server;
          });
          await Promise.all(
            layer.map((target, index) => {
              const server = layerServers[index];
              return waitForTarget(target, {
                fetchImpl: options.fetchImpl ?? fetch,
                requireManifest: true,
                retryDelayMs: options.retryDelayMs,
                serverExit: server.exited,
                serverLogPath: server.logPath,
                timeoutMs: options.timeoutMs,
              });
            }),
          );
        }
        for (const target of localStartupOrder.shells) {
          const server = startServerImpl(target, options);
          servers.push(server);
          serversByAppId.set(target.app.id, server);
          report.targetRuntimes[target.app.id] = 'node';
          await waitForTarget(target, {
            fetchImpl: options.fetchImpl ?? fetch,
            retryDelayMs: options.retryDelayMs,
            serverExit: server.exited,
            serverLogPath: server.logPath,
            timeoutMs: options.timeoutMs,
          });
        }
      }
    }

    if (targets.length === 0) {
      report.status = 'skipped';
      writeJsonFile(options.out, report, { atomic: false });
      return report;
    }

    browser = await launchBrowser(options.browserProvider);
    const validationTargets = localStartupOrder?.validation ?? targets;
    for (const target of validationTargets) {
      const httpAssertions = await validateHttpTarget(target, {
        fetchImpl: options.fetchImpl ?? fetch,
      });
      const runtime =
        report.targetRuntimes[target.app.id] ??
        options.platform ??
        (options.mode === 'public'
          ? 'workerd'
          : (options.shellRuntime ?? 'node'));
      report.targetRuntimes[target.app.id] ??= runtime;
      const browserAssertions = await validateBrowserTargetImpl(
        target,
        browser,
        {
          artifactDir: options.artifactDir,
          runtime,
        },
      );
      report.results.push({
        appId: target.app.id,
        assertions: [...httpAssertions, ...browserAssertions],
        baseUrl: target.baseUrl,
        status: 'pass',
      });
    }

    if (options.artifactMode && options.platform) {
      if (options.platform === 'node') {
        const backendAssertions = runNodeBackendFederationProof({
          artifactDir: options.artifactDir,
          projectDir: options.projectDir,
        });
        for (const assertion of backendAssertions) {
          const result = report.results.find(
            candidate => candidate.appId === assertion.appId,
          );
          result?.assertions.push(assertion);
        }
      }
      const failureIsolationAssertions = await validateFailureIsolation({
        fetchImpl: options.fetchImpl ?? fetch,
        options,
        platform: options.platform,
        servers,
        serversByAppId,
        startServerImpl,
        targets: validationTargets,
      });
      for (const assertion of failureIsolationAssertions) {
        const result = report.results.find(
          candidate => candidate.appId === assertion.appId,
        );
        result?.assertions.push(assertion);
      }
      report.evidence = createRuntimeEvidence({
        artifactMode: options.artifactMode,
        contract,
        platform: options.platform,
        projectDir: options.projectDir,
        results: report.results,
      });
      assertStrictRuntimeEvidence(report.evidence);
    }
    report.status = 'pass';
    writeJsonFile(options.out, report, { atomic: false });
    return report;
  } catch (error) {
    report.status = 'fail';
    report.error = error instanceof Error ? error.message : String(error);
    if (error instanceof BrowserSmokeError && error.details) {
      report.errorDetails = error.details;
    }
    writeJsonFile(options.out, report, { atomic: false });
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    await Promise.allSettled(servers.map(server => server.stop()));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runUltramodernBrowserSmoke(options);
  await writeStream(
    process.stdout,
    `[ultramodern-browser-smoke] ${report.status}: ${options.out}\n`,
  );
  process.exit(report.status === 'pass' || report.status === 'skipped' ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`[ultramodern-browser-smoke] ${error.message}\n`);
    process.exitCode = 1;
  });
}
