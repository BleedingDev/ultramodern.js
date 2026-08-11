import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function bindTractorAcceptanceEvidence({
  cwd = process.cwd(),
  environment = process.env,
} = {}) {
  const tractorRef = environment.TRACTOR_REF;
  const runAttempt = environment.GITHUB_RUN_ATTEMPT;
  const githubOutput = environment.GITHUB_OUTPUT;
  if (typeof tractorRef !== 'string' || !/^[0-9a-f]{40}$/u.test(tractorRef)) {
    throw new Error('TRACTOR_REF must be an immutable commit SHA');
  }
  if (typeof runAttempt !== 'string' || !/^[1-9]\d*$/u.test(runAttempt)) {
    throw new Error('GITHUB_RUN_ATTEMPT must be a positive integer');
  }
  if (typeof githubOutput !== 'string' || githubOutput.length === 0) {
    throw new Error('GITHUB_OUTPUT is required to bind Tractor evidence');
  }

  const reportPath = path.join(
    cwd,
    '.modern/production-readiness/tractor-downstream-acceptance.json',
  );
  const bytes = fs.readFileSync(reportPath);
  const report = JSON.parse(bytes.toString('utf8'));
  if (report.tractor?.baselineRevision !== tractorRef) {
    throw new Error(
      'Tractor acceptance report is not bound to the immutable baseline',
    );
  }
  const artifactName = `ultramodern-tractor-downstream-acceptance-${tractorRef}-attempt-${runAttempt}`;
  const reportSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.appendFileSync(
    githubOutput,
    [
      `artifact_name=${artifactName}`,
      `baseline_revision=${tractorRef}`,
      `report_sha256=${reportSha256}`,
      '',
    ].join('\n'),
  );
  return { artifactName, baselineRevision: tractorRef, reportSha256 };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  bindTractorAcceptanceEvidence();
}
