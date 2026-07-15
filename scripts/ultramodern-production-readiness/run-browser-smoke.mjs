#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import fsKit from '../lib/fs-kit.js';
import processKit from '../lib/process-kit.js';
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
import {
  validateHttpTarget,
  waitForTarget,
} from './browser-smoke/http-validate.mjs';
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

export async function runUltramodernBrowserSmoke(options) {
  const { contract, contractPath } = options.contract
    ? {
        contract: normalizeSmokeContract(options.contract, {
          sourcePath: options.contractPath,
        }),
        contractPath: options.contractPath ?? '<provided>',
      }
    : readSmokeContract(options.projectDir);
  const { skipped, targets } = createSmokeTargets(contract, options);
  const report = {
    schemaVersion: 1,
    artifactDir: options.artifactDir,
    contractPath,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    mode: options.mode,
    projectDir: options.projectDir,
    shellRuntime: options.shellRuntime ?? 'node',
    results: [],
    skipped,
    status: 'running',
  };
  const servers = [];
  let browser;
  const localStartupOrder =
    options.mode === 'local' ? orderTargetsForLocalStartup(targets) : undefined;
  const startServerImpl = options.startServerImpl ?? startServer;

  try {
    if (localStartupOrder) {
      const preflightLocalPortsImpl =
        options.preflightLocalPortsImpl ?? assertLocalPortsAvailable;
      await preflightLocalPortsImpl(localStartupOrder.validation);
      for (const target of localStartupOrder.remotes) {
        servers.push(startServerImpl(target, options));
      }
      for (const [index, target] of localStartupOrder.remotes.entries()) {
        const server = servers[index];
        await waitForTarget(target, {
          fetchImpl: options.fetchImpl ?? fetch,
          requireManifest: true,
          retryDelayMs: options.retryDelayMs,
          serverExit: server.exited,
          serverLogPath: server.logPath,
          timeoutMs: options.timeoutMs,
        });
      }
      for (const target of localStartupOrder.shells) {
        let server;
        if (report.shellRuntime === 'workerd') {
          if (localStartupOrder.shells.length !== 1) {
            throw new BrowserSmokeError(
              'workerd browser smoke requires exactly one shell target',
            );
          }
          const startWorkerdProofImpl =
            options.startWorkerdProofImpl ?? startWorkerdProof;
          server = await startWorkerdProofImpl(options);
          target.baseUrl = server.baseUrl;
          target.port = Number(new URL(server.baseUrl).port);
        } else {
          server = startServerImpl(target, options);
        }
        servers.push(server);
        await waitForTarget(target, {
          fetchImpl: options.fetchImpl ?? fetch,
          retryDelayMs: options.retryDelayMs,
          serverExit: server.exited,
          serverLogPath: server.logPath,
          timeoutMs: options.timeoutMs,
        });
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
      const browserAssertions = await validateBrowserTarget(target, browser, {
        artifactDir: options.artifactDir,
      });
      report.results.push({
        appId: target.app.id,
        assertions: [...httpAssertions, ...browserAssertions],
        baseUrl: target.baseUrl,
        status: 'pass',
      });
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
