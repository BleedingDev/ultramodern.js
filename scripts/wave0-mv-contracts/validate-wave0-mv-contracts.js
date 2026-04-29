#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const rootDir = process.cwd();

const requiredJsonFiles = [
  {
    path: 'docs/super-app-rfc-adr/contracts/mv-runtime-parity-contract.json',
    tokens: ['trust', 'compatibility', 'fallback', 'telemetry', 'known'],
  },
  {
    path: 'docs/super-app-rfc-adr/contracts/mv-topology-manifest.schema.json',
    tokens: ['remote', 'service', 'integrity', 'attestation', 'ttl', 'lkg'],
    schema: true,
  },
  {
    path: 'docs/super-app-rfc-adr/contracts/mv-template-manifest.schema.json',
    tokens: ['template', 'provenance', 'checksum', 'lifecycle', 'source'],
    schema: true,
  },
  {
    path: 'docs/super-app-rfc-adr/contracts/mv-ownership.schema.json',
    tokens: ['owner', 'route', 'remote', 'service', 'approval'],
    schema: true,
  },
];

const requiredAdrFiles = [
  {
    path: 'docs/super-app-rfc-adr/ADR-0010-mv-wave0-contract-first-gates.md',
    tokens: ['Wave 1', 'blocked', 'validate:wave0-mv-contracts'],
  },
  {
    path: 'docs/super-app-rfc-adr/ADR-0011-mf-vs-garfish-runtime-parity-contract.md',
    tokens: ['Module Federation', 'Garfish', 'known non-equivalences'],
  },
  {
    path: 'docs/super-app-rfc-adr/ADR-0012-mv-topology-manifest-and-zephyr-profile.md',
    tokens: ['topology manifest', 'Zephyr', 'withZephyr'],
  },
  {
    path: 'docs/super-app-rfc-adr/ADR-0013-mv-ds-platform-contract.md',
    tokens: ['design system', 'vendor-neutral', 'SSR'],
  },
  {
    path: 'docs/super-app-rfc-adr/ADR-0014-mv-template-supply-chain-policy.md',
    tokens: ['template', 'supply-chain', 'provenance'],
  },
  {
    path: 'docs/super-app-rfc-adr/ADR-0015-mv-ownership-and-blast-radius-gates.md',
    tokens: ['ownership', 'blast radius', 'cross-vertical'],
  },
];

const readText = relativePath => {
  const absolutePath = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing required Wave 0 artifact: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, 'utf8');
};

const assertTokens = ({ relativePath, content, tokens }) => {
  const normalized = content.toLowerCase();
  const missing = tokens.filter(
    token => !normalized.includes(token.toLowerCase()),
  );
  if (missing.length > 0) {
    throw new Error(
      `${relativePath} is missing required contract terms: ${missing.join(', ')}`,
    );
  }
};

const assertJsonContract = contract => {
  const content = readText(contract.path);
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`${contract.path} is not valid JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${contract.path} must contain a JSON object`);
  }

  if (contract.schema && parsed.type !== 'object') {
    throw new Error(`${contract.path} must be an object schema`);
  }

  if (contract.schema && !parsed.properties) {
    throw new Error(`${contract.path} must define schema properties`);
  }

  assertTokens({
    relativePath: contract.path,
    content,
    tokens: contract.tokens,
  });
};

const assertAdr = adr => {
  const content = readText(adr.path);
  assertTokens({
    relativePath: adr.path,
    content,
    tokens: ['Status:', 'Acceptance Criteria', ...adr.tokens],
  });
};

const main = () => {
  for (const contract of requiredJsonFiles) {
    assertJsonContract(contract);
  }

  for (const adr of requiredAdrFiles) {
    assertAdr(adr);
  }

  const summary = {
    jsonContracts: requiredJsonFiles.length,
    adrDocuments: requiredAdrFiles.length,
    wave1EntryBlockedUntilGreen: true,
  };

  console.log(
    `[wave0-mv-contracts] validation passed:\n${JSON.stringify(summary, null, 2)}`,
  );
};

try {
  main();
} catch (error) {
  console.error(`[wave0-mv-contracts] validation failed: ${error.message}`);
  process.exit(1);
}
