import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { validateNodeBackendFederationProofResult } from './backend-proof-contract.mjs';
import { BrowserSmokeError } from './contract.mjs';

function runNodeBackendFederationProof({
  artifactDir,
  projectDir,
  spawnSyncImpl = spawnSync,
}) {
  const result = spawnSyncImpl('pnpm', ['run', 'node:proof'], {
    cwd: projectDir,
    encoding: 'utf8',
    env: {
      ...process.env,
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
  const reportPath = path.join(
    projectDir,
    '.codex/reports/node-backend-federation-proof/proof.json',
  );
  if (!fs.existsSync(reportPath)) {
    throw new BrowserSmokeError(
      'Node backend federation proof did not emit its report',
      { reportPath },
    );
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.status !== 'pass' || !Array.isArray(report.results)) {
    throw new BrowserSmokeError(
      'Node backend federation proof report did not pass',
      { reportPath, status: report.status },
    );
  }
  return report.results.map(item => {
    const validation = validateNodeBackendFederationProofResult(item);
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

export { runNodeBackendFederationProof };
