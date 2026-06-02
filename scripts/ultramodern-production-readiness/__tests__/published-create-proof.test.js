const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function loadProof() {
  return import('../run-published-create-proof.mjs');
}

test('defines ERP scale profiles for 10, 25, and 50 verticals', async () => {
  const { scaleProfiles } = await loadProof();

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(scaleProfiles).map(([id, profile]) => [
        id,
        profile.verticalCount,
      ]),
    ),
    {
      'erp-10': 10,
      'erp-25': 25,
      'erp-50': 50,
    },
  );
});

test('generates readable first-ten verticals and deterministic safe names above ten', async () => {
  const { generateVerticalNames } = await loadProof();
  const verticals = generateVerticalNames(25);

  assert.deepEqual(verticals.slice(0, 10), [
    'inventory',
    'finance',
    'people',
    'analytics',
    'orders',
    'procurement',
    'billing',
    'logistics',
    'support',
    'compliance',
  ]);
  assert.deepEqual(verticals.slice(10, 13), [
    'erp-vertical-011',
    'erp-vertical-012',
    'erp-vertical-013',
  ]);
  assert.equal(verticals[24], 'erp-vertical-025');
  assert.equal(new Set(verticals).size, verticals.length);
  assert.equal(
    verticals.every(name => /^[a-z][a-z0-9-]*$/u.test(name)),
    true,
  );
});

test('parses scale profile and legacy custom vertical count requests', async () => {
  const { parseArgs } = await loadProof();

  const profiled = parseArgs([
    '--scale-profile',
    'erp-25',
    '--out',
    '.modern/example.json',
  ]);
  assert.equal(profiled.scaleProfile, 'erp-25');
  assert.equal(profiled.verticalCount, 25);
  assert.equal(path.isAbsolute(profiled.out), true);

  const custom = parseArgs(['--vertical-count', '3']);
  assert.equal(custom.scaleProfile, 'custom-3');
  assert.deepEqual(custom.verticals, ['inventory', 'finance', 'people']);

  assert.throws(
    () => parseArgs(['--scale-profile', 'erp-25', '--vertical-count', '10']),
    /does not match --scale-profile erp-25/,
  );
});

test('runs generated-project pnpm commands through mise when the project pins a toolchain', async t => {
  const { commandExists, generatedPnpmCommand } = await loadProof();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-proof-'));
  t.after(() => fs.rmSync(projectDir, { force: true, recursive: true }));

  const plainCommand = generatedPnpmCommand(projectDir, ['install']);
  assert.deepEqual(plainCommand, {
    args: ['install'],
    command: 'pnpm',
    cwd: projectDir,
  });

  fs.writeFileSync(
    path.join(projectDir, '.mise.toml'),
    '[tools]\npnpm = "11.5.0"\n',
  );
  const pinnedCommand = generatedPnpmCommand(projectDir, ['build']);

  if (commandExists('mise')) {
    assert.equal(pinnedCommand.command, 'mise');
    assert.equal(pinnedCommand.cwd, path.resolve(__dirname, '../../..'));
    assert.deepEqual(pinnedCommand.args, [
      'exec',
      '-y',
      '-C',
      projectDir,
      '--',
      'pnpm',
      'build',
    ]);
  } else {
    assert.deepEqual(pinnedCommand, {
      args: ['build'],
      command: 'pnpm',
      cwd: projectDir,
    });
  }
});

test('summarizes topology and generated contract evidence', async () => {
  const { createTopologyEvidence, generateVerticalNames } = await loadProof();
  const verticalNames = generateVerticalNames(3);

  const evidence = createTopologyEvidence({
    selectedProfile: {
      id: 'custom-3',
      verticalCount: 3,
    },
    verticalNames,
    packageCohortAssertion: {
      status: 'pass',
      expectedVersion: '1.2.3',
    },
    topology: {
      shell: {
        moduleFederation: {
          remotes: [{ id: 'inventory' }, { id: 'finance' }, { id: 'people' }],
          sharedContractVersion: 'mf-ssr-contract-v1',
        },
      },
      verticals: verticalNames.map(id => ({
        id,
        moduleFederation: {
          sharedContractVersion: 'mf-ssr-contract-v1',
        },
      })),
      sharedPackages: [{ id: 'shared-contracts' }],
    },
    generatedContract: {
      apps: [
        {
          id: 'shell-super-app',
          kind: 'shell',
          moduleFederation: {
            remotes: [{ id: 'inventory' }],
            sharedContractVersion: 'mf-ssr-contract-v1',
          },
        },
        ...verticalNames.map(id => ({
          id,
          kind: 'vertical',
          moduleFederation: {
            sharedContractVersion: 'mf-ssr-contract-v1',
          },
        })),
      ],
    },
  });

  assert.equal(evidence.selectedProfile, 'custom-3');
  assert.equal(evidence.verticalCount, 3);
  assert.deepEqual(evidence.verticalNames, verticalNames);
  assert.equal(evidence.mfRemoteCount, 3);
  assert.deepEqual(evidence.contractCounts, {
    topologyVerticals: 3,
    topologySharedPackages: 1,
    generatedContractApps: 4,
    generatedContractVerticals: 3,
  });
  assert.equal(evidence.sharedVersionAssertions.packageCohort.status, 'pass');
  assert.equal(
    evidence.sharedVersionAssertions.moduleFederationSharedContract.status,
    'pass',
  );
});

test('marks mismatched MF shared contract versions as failed evidence', async () => {
  const { createTopologyEvidence } = await loadProof();

  const evidence = createTopologyEvidence({
    selectedProfile: {
      id: 'custom-1',
      verticalCount: 1,
    },
    verticalNames: ['inventory'],
    packageCohortAssertion: {
      status: 'pass',
      expectedVersion: '1.2.3',
    },
    topology: {
      shell: {
        moduleFederation: {
          sharedContractVersion: 'mf-ssr-contract-v1',
        },
      },
      verticals: [
        {
          id: 'inventory',
          moduleFederation: {
            sharedContractVersion: 'mf-ssr-contract-v2',
          },
        },
      ],
    },
    generatedContract: {
      apps: [],
    },
  });

  assert.equal(
    evidence.sharedVersionAssertions.moduleFederationSharedContract.status,
    'fail',
  );
  assert.deepEqual(
    evidence.sharedVersionAssertions.moduleFederationSharedContract.versions,
    ['mf-ssr-contract-v1', 'mf-ssr-contract-v2'],
  );
});

test('normalizes duplicate diagnostic log lines without hiding unique output', async () => {
  const { normalizeDiagnosticLines } = await loadProof();

  const summary = normalizeDiagnosticLines(
    [
      '\u001b[33mWARN\u001b[39m Cloudflare public URL is missing',
      'WARN Cloudflare public URL is missing',
      'Run pnpm cloudflare:proof -- --require-public-urls',
      'WARN Cloudflare public URL is missing',
    ].join('\n'),
  );

  assert.deepEqual(summary.lines, [
    'WARN Cloudflare public URL is missing',
    'Run pnpm cloudflare:proof -- --require-public-urls',
  ]);
  assert.equal(summary.duplicateCount, 2);
  assert.equal(summary.truncatedCount, 0);
});

test('formats Cloudflare command failures with concise actionable diagnostics', async () => {
  const { createCommandDiagnostics, formatCommandFailure } = await loadProof();

  const diagnostic = createCommandDiagnostics({
    args: ['cloudflare:proof', '--', '--require-public-urls'],
    command: 'pnpm',
    cwd: '/tmp/example-workspace',
    durationMs: 123.456,
    logPath:
      '.modern/production-readiness/cloudflare-diagnostics/cloudflare-proof.log',
    result: {
      signal: null,
      status: 1,
      stdout: [
        'checking shell-super-app',
        'checking shell-super-app',
        'checking inventory',
      ].join('\n'),
      stderr: [
        'shell-super-app requires ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
        'shell-super-app requires ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
      ].join('\n'),
    },
  });

  assert.equal(diagnostic.status, 'fail');
  assert.equal(diagnostic.stderr.duplicateCount, 1);
  assert.equal(diagnostic.stdout.duplicateCount, 1);

  const message = formatCommandFailure(diagnostic);
  assert.match(message, /Command failed: pnpm cloudflare:proof/);
  assert.match(message, /requires ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP/);
  assert.match(message, /omitted 1 duplicate log line/);
  assert.match(message, /full log: \.modern\/production-readiness/);
});
