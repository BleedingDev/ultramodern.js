#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  renderLedgerEvidence,
  resolveRepositoryTopLevel,
} = require('./divergence');

const file = path.join(
  resolveRepositoryTopLevel({ rootDir: process.cwd() }),
  'FORK-DIVERGENCE.md',
);
const original = fs.readFileSync(file, 'utf8');
const rendered = renderLedgerEvidence(original);
if (process.argv.slice(2).some(arg => arg !== '--check')) {
  throw new Error('Usage: render-ledger.js [--check]');
}
if (process.argv.includes('--check')) {
  if (rendered !== original)
    throw new Error(
      'FORK-DIVERGENCE.md evidence table is stale; run render-ledger.js.',
    );
} else if (rendered !== original) {
  fs.writeFileSync(file, rendered);
}
