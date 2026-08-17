import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const governanceDocs = [
  'docs/super-app-rfc-adr/SUNSET-DECISION-0001-compatibility-lanes.md',
  'docs/super-app-rfc-adr/MIGRATION-PLAYBOOK-0001-existing-teams-to-mv.md',
  'docs/super-app-rfc-adr/evidence/mv-wave4/compatibility-sunset/evidence-index.md',
];
const liveEvidenceContracts = [
  'docs/super-app-rfc-adr/evidence/release-candidate/current',
  'docs/super-app-rfc-adr/evidence/module-certification/current',
];
const deletedPathMarker = 'evidence/mv-production-rollout';
const deletedEvidenceBasenames = [
  'design-system-evidence.md',
  'extraction-evidence.md',
  'fallback-evidence.md',
  'incident-evidence.md',
  'rollback-evidence.md',
  'rollout-evidence.md',
  'trust-evidence.md',
  'design-system-failure.md',
  'remote-failure.md',
  'trust-policy-failure.md',
];
// `review-evidence.md` remains a legitimate basename in both live contracts;
// `README.md` is generic, so claim/path guards cover the deleted package instead.
const retractedClaims = [
  'frozen historical snapshots',
  'Golden has enough evidence',
  'Wave 3 `remote-commerce` package demonstrates',
  'matches the Wave 3',
  'Production rollout evidence matches the shape of `rollout-evidence.md`',
  'Legacy `remote-commerce` evidence remains useful for evidence shape only',
  'Wave 3 certification',
  'legacy `remote-commerce` package',
];

function readGovernanceDocs() {
  return governanceDocs.map(relativePath => ({
    relativePath,
    text: fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
  }));
}

test('MV governance docs do not cite retracted rollout artifacts as evidence', () => {
  for (const { relativePath, text } of readGovernanceDocs()) {
    assert.equal(
      text.includes(deletedPathMarker),
      false,
      `${relativePath} still cites the deleted MV rollout evidence directory`,
    );

    for (const basename of deletedEvidenceBasenames) {
      assert.equal(
        text.includes(basename),
        false,
        `${relativePath} still cites deleted evidence file ${basename}`,
      );
    }

    for (const claim of retractedClaims) {
      assert.equal(
        text.includes(claim),
        false,
        `${relativePath} still carries retracted claim: ${claim}`,
      );
    }
  }
});

test('migration guidance points at live evidence-contract directories', () => {
  for (const relativePath of liveEvidenceContracts) {
    const absolutePath = path.join(repoRoot, relativePath);
    assert.equal(
      fs.existsSync(absolutePath),
      true,
      `live evidence-contract directory is missing: ${relativePath}`,
    );
    assert.equal(
      fs.statSync(absolutePath).isDirectory(),
      true,
      `live evidence-contract path is not a directory: ${relativePath}`,
    );
  }
});
