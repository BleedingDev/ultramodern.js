import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { validateNodeBackendFederationProofResult } from './backend-proof-contract.mjs';
import { BrowserSmokeError } from './contract.mjs';

function readNodeBackendFederationProof({
  projectDir,
  reportPath = path.resolve(
    projectDir,
    '.codex/reports/node-backend-federation-proof/proof.json',
  ),
  expectedArtifacts,
}) {
  const root = path.resolve(projectDir);
  const resolvedReportPath = path.resolve(root, reportPath);
  const reportsRoot = path.join(root, '.codex/reports');
  const relativeReport = path.relative(reportsRoot, resolvedReportPath);
  if (
    !relativeReport ||
    path.isAbsolute(relativeReport) ||
    relativeReport === '..' ||
    relativeReport.startsWith(`..${path.sep}`)
  ) {
    throw new BrowserSmokeError(
      'Node backend federation proof report must be inside the project reports subtree',
      { reportPath: resolvedReportPath },
    );
  }
  const parts = path.relative(root, resolvedReportPath).split(path.sep);
  let currentPath = root;
  try {
    if (!fs.lstatSync(root).isDirectory()) {
      throw new BrowserSmokeError(
        'Node backend federation proof project must be an ordinary directory',
      );
    }
    for (const [index, part] of parts.entries()) {
      currentPath = path.join(currentPath, part);
      const stat = fs.lstatSync(currentPath);
      if (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) {
        throw new BrowserSmokeError(
          'Node backend federation proof report and parents must be ordinary entries',
          { reportPath: resolvedReportPath, entryPath: currentPath },
        );
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new BrowserSmokeError(
      'Node backend federation proof did not emit its report',
      { reportPath: resolvedReportPath },
    );
  }
  const report = JSON.parse(fs.readFileSync(resolvedReportPath, 'utf8'));
  if (!report || report.status !== 'pass' || !Array.isArray(report.results)) {
    throw new BrowserSmokeError(
      'Node backend federation proof report did not pass',
      { reportPath: resolvedReportPath, status: report?.status },
    );
  }
  const expectedByApp = new Map();
  if (expectedArtifacts !== undefined) {
    if (report.schemaVersion !== 1 || report.target !== '.output') {
      throw new BrowserSmokeError(
        'Node backend federation proof report must use schema 1 and final .output artifacts',
        { reportPath: resolvedReportPath },
      );
    }
    if (!Array.isArray(expectedArtifacts) || expectedArtifacts.length === 0) {
      throw new BrowserSmokeError(
        'Node backend federation proof requires current artifact evidence',
      );
    }
    for (const expected of expectedArtifacts) {
      if (
        typeof expected?.appId !== 'string' ||
        !expected.appId ||
        expected.appId !== expected.appId.trim() ||
        expectedByApp.has(expected.appId)
      ) {
        throw new BrowserSmokeError(
          'Node backend federation proof expected artifacts must have unique appIds',
        );
      }
      expectedByApp.set(expected.appId, expected);
    }
    if (report.results.length !== expectedByApp.size) {
      throw new BrowserSmokeError(
        'Node backend federation proof report must exactly cover current artifacts',
      );
    }
  }
  const seen = new Set();
  return report.results.map(item => {
    const validation = validateNodeBackendFederationProofResult(item);
    if (expectedArtifacts !== undefined) {
      const expected = expectedByApp.get(item?.appId);
      if (!validation.ok || !expected || seen.has(item.appId)) {
        throw new BrowserSmokeError(
          'Node backend federation proof result failed or has duplicate or unexpected appId',
          { appId: item?.appId, failures: validation.failures },
        );
      }
      seen.add(item.appId);
      if (
        item.releaseEnvelope.path !== expected.envelopePath ||
        item.releaseEnvelope.envelopeDigest !== expected.envelopeDigest ||
        item.releaseEnvelope.target !== 'node' ||
        !expected.identity ||
        item.versionBoundary.buildVersion !== expected.identity.buildMarker ||
        item.versionBoundary.version !== expected.identity.releaseVersion ||
        item.versionBoundary.sourceRevision !==
          expected.identity.sourceRevision ||
        (expected.identity.unitId !== undefined &&
          item.versionBoundary.unitId !== expected.identity.unitId) ||
        (expected.identity.packageName !== undefined &&
          item.versionBoundary.packageName !== expected.identity.packageName)
      ) {
        throw new BrowserSmokeError(
          'Node backend federation proof result does not match current artifact identity',
          { appId: item.appId },
        );
      }
      // The current verified envelope digest also binds its optional UI identity,
      // renderer profile and router bindings. The public proof has no separate UI field.
    }
    return {
      appId: item.appId,
      containerEntry: item.containerEntry,
      failures: validation.failures,
      manifestUrl: item.manifestUrl,
      remoteName: item.remoteName,
      runtimeEntry: item.runtimeEntry,
      smokeCheckCount: item.smokeChecks?.length ?? 0,
      status: validation.ok ? 'pass' : 'fail',
      type: 'backend-federation-network',
    };
  });
}

function runNodeBackendFederationProof({
  artifactDir,
  projectDir,
  expectedArtifacts,
  processEnv = process.env,
  spawnSyncImpl = spawnSync,
}) {
  const result = spawnSyncImpl('pnpm', ['run', 'node:proof'], {
    cwd: projectDir,
    encoding: 'utf8',
    env: {
      ...processEnv,
      // The browser smoke harness already owns and has health-checked these
      // exact final Node processes. Ask the generated proof to consume them
      // instead of racing a second process set for the same ports.
      ULTRAMODERN_NODE_PROOF_SERVER_MODE: 'existing',
    },
    maxBuffer: 16 * 1024 * 1024,
  });
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, 'node-backend-federation-proof.log'),
    `${result.stdout ?? ''}${result.stderr ?? ''}`,
  );
  if (result.status !== 0) {
    throw new BrowserSmokeError('Node backend federation proof failed', {
      exitCode: result.status,
      signal: result.signal,
    });
  }
  return readNodeBackendFederationProof({ projectDir, expectedArtifacts });
}

export { readNodeBackendFederationProof, runNodeBackendFederationProof };
