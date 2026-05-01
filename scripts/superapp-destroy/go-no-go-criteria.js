#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const GO_NO_GO_SCHEMA_VERSION = 'superapp-destroy-go-no-go-v1';
const DECISIONS = Object.freeze({
  GO_FOR_DEVELOPMENT: 'go-for-development',
  GO_FOR_RELEASE: 'go-for-release',
  NO_GO_FOR_DEVELOPMENT: 'no-go-for-development',
  NOT_GO_FOR_RELEASE: 'not-go-for-release',
});
const CURRENT_EVIDENCE = Object.freeze({
  upstreamRoots: [
    'workload-data',
    'harness-telemetry',
    'k6-load',
    'chaos-failure',
    'effect-tanstack-contracts',
    'browser-runtime',
    'soak-stability',
  ],
  completedDestroyTodos: [
    'ust-destroy-01',
    'ust-destroy-02',
    'ust-destroy-03',
    'ust-destroy-04',
    'ust-destroy-05',
  ],
  smokeRun: {
    reachedPhases: [
      'build',
      'serve',
      'warmup',
      'load',
      'browser-smoke',
      'chaos',
      'contracts',
      'runtime-matrix',
      'soak-stability-evidence',
    ],
    failedPhase: undefined,
    failure: undefined,
    teardownPassed: true,
  },
  observedLoad: {
    requests: 536,
    p95LatencyMs: 3.02,
    p99LatencyMs: 5.07,
    maxLatencyMs: 8.34,
    errorRate: 0,
    budgetFailures: [],
  },
  blockers: [],
  releaseReadinessClassification: 'pass',
});
const RERUN_COMMANDS = Object.freeze([
  'node scripts/superapp-destroy/run-superapp-destroy.js --execute --profile smoke --run-id superapp-destroy-smoke-rerun --output-dir .modern/superapp-destroy/superapp-destroy-smoke-rerun --load-duration-ms 1000 --load-concurrency 1',
  'node scripts/superapp-destroy/readiness-report.js --plan .modern/superapp-destroy/superapp-destroy-smoke-rerun/destroy-plan.json --execution .modern/superapp-destroy/superapp-destroy-smoke-rerun/destroy-execution.json --output-dir .modern/superapp-destroy/superapp-destroy-smoke-rerun',
  'node scripts/superapp-destroy/run-superapp-destroy.js --execute --profile release --run-id superapp-destroy-release-cert --output-dir .modern/superapp-destroy/superapp-destroy-release-cert',
  'node scripts/superapp-destroy/run-superapp-destroy.js --execute --profile nightly --run-id superapp-destroy-nightly-cert --output-dir .modern/superapp-destroy/superapp-destroy-nightly-cert',
  'node scripts/superapp-destroy/run-superapp-destroy.js --execute --profile manual-torture --run-id superapp-destroy-manual-torture-cert --output-dir .modern/superapp-destroy/superapp-destroy-manual-torture-cert',
]);

function createGoNoGoCriteria(input = {}, options = {}) {
  const evidence = normalizeEvidence(input);
  const gateGroups = createGateGroups(evidence);
  const openBlockers = evidence.blockers.filter(
    blocker => blocker.status !== 'closed',
  );
  const developmentPass = gateGroups.developmentStart.every(
    gate => gate.status === 'pass',
  );
  const releasePass = gateGroups.releaseCertification.every(
    gate => gate.status === 'pass',
  );
  const nightlyPass = gateGroups.nightlyManualTorture.every(
    gate => gate.status === 'pass',
  );
  const productionPass = gateGroups.productionRollout.every(
    gate => gate.status === 'pass',
  );
  const report = pruneUndefined({
    schemaVersion: GO_NO_GO_SCHEMA_VERSION,
    suite: 'superapp-destroy-go-no-go',
    generatedAt: options.generatedAt || new Date().toISOString(),
    decision: developmentPass
      ? DECISIONS.GO_FOR_DEVELOPMENT
      : DECISIONS.NO_GO_FOR_DEVELOPMENT,
    releaseDecision: releasePass
      ? DECISIONS.GO_FOR_RELEASE
      : DECISIONS.NOT_GO_FOR_RELEASE,
    summary: {
      canBeginSuperAppDevelopment: developmentPass,
      canCertifyRelease: releasePass,
      canRunNightlyManualTortureAsGate: nightlyPass,
      canStartProductionRollout: productionPass,
    },
    guardrails: [
      'Keep SuperApp work behind fork-owned branches and existing certification commands.',
      'Keep destroy-run warmup, load, chaos, contracts, runtime-matrix, and soak evidence known before certifying release.',
      'Do not convert manual-torture into a default PR blocker.',
      'Regenerate .modern artifacts locally only; do not commit generated destroy artifacts.',
    ],
    evidence: {
      upstreamRoots: evidence.upstreamRoots,
      completedDestroyTodos: evidence.completedDestroyTodos,
      smokeRun: evidence.smokeRun,
      observedLoad: evidence.observedLoad,
    },
    gates: gateGroups,
    blockers: openBlockers,
    rerunCommands: evidence.rerunCommands,
  });

  return {
    markdown: renderGoNoGoMarkdown(report),
    report,
  };
}

function writeGoNoGoCriteria(input = {}, options = {}) {
  const { markdown, report } = createGoNoGoCriteria(input, options);
  if (options.jsonPath) {
    writeFile(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.markdownPath) {
    writeFile(options.markdownPath, markdown);
  }
  return {
    markdown,
    markdownPath: options.markdownPath && resolveRepoPath(options.markdownPath),
    report,
    reportPath: options.jsonPath && resolveRepoPath(options.jsonPath),
  };
}

function renderGoNoGoMarkdown(report) {
  const lines = [
    '# SuperApp Go/No-Go Criteria',
    '',
    `- Development start: ${report.decision}`,
    `- Release certification: ${report.releaseDecision}`,
    `- Nightly/manual torture gate: ${formatBoolean(report.summary.canRunNightlyManualTortureAsGate)}`,
    `- Production rollout: ${formatBoolean(report.summary.canStartProductionRollout)}`,
    '',
    '## Current Evidence',
    '',
    `- Upstream roots completed: ${report.evidence.upstreamRoots.join(', ')}`,
    `- Destroy readiness completed: ${report.evidence.completedDestroyTodos.join(', ')}`,
    `- Smoke reached: ${report.evidence.smokeRun.reachedPhases.join(', ')}`,
    `- Smoke failure: ${report.evidence.smokeRun.failure || 'none'}`,
    `- Teardown passed: ${formatBoolean(report.evidence.smokeRun.teardownPassed)}`,
    `- Load: ${report.evidence.observedLoad.requests} requests, p95 ${report.evidence.observedLoad.p95LatencyMs}ms, p99 ${report.evidence.observedLoad.p99LatencyMs}ms, max ${report.evidence.observedLoad.maxLatencyMs}ms, error rate ${report.evidence.observedLoad.errorRate}`,
    '',
    '## Required Gates',
    '',
    ...renderGateSection('Development Start', report.gates.developmentStart),
    '',
    ...renderGateSection(
      'Release Certification',
      report.gates.releaseCertification,
    ),
    '',
    ...renderGateSection(
      'Nightly/Manual Torture',
      report.gates.nightlyManualTorture,
    ),
    '',
    ...renderGateSection('Production Rollout', report.gates.productionRollout),
    '',
    '## Residual Blockers',
    '',
    ...renderBlockers(report.blockers),
    '',
    '## Certification Rerun Commands',
    '',
    ...report.rerunCommands.flatMap(command => ['```bash', command, '```', '']),
  ];

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

function createGateGroups(evidence) {
  const upstreamComplete = evidence.upstreamRoots.length >= 7;
  const destroyTodosReady = [
    'ust-destroy-01',
    'ust-destroy-02',
    'ust-destroy-03',
    'ust-destroy-04',
  ].every(todo => evidence.completedDestroyTodos.includes(todo));
  const loadPassed =
    evidence.observedLoad.requests > 0 &&
    evidence.observedLoad.errorRate === 0 &&
    evidence.observedLoad.budgetFailures.length === 0;
  const teardownPassed = evidence.smokeRun.teardownPassed === true;
  const chaosBlocked = hasOpenBlocker(evidence, 'modernjs-b9f');
  const k6Blocked = hasOpenBlocker(evidence, 'modernjs-fdl');
  const noOpenBlockers = evidence.blockers.every(
    blocker => blocker.status === 'closed',
  );

  return {
    developmentStart: [
      gate(
        'upstream-roots-complete',
        upstreamComplete,
        'All upstream torture roots have completed.',
        'Complete workload, telemetry, k6/load, chaos, contracts, browser, and soak roots.',
      ),
      gate(
        'destroy-readiness-01-04-complete',
        destroyTodosReady,
        'Destroy command, profiles, aggregation, and first smoke evidence are complete.',
        'Complete ust-destroy-01 through ust-destroy-04 before using the fork for SuperApp development.',
      ),
      gate(
        'bounded-smoke-reached-runtime-lanes',
        evidence.smokeRun.reachedPhases.includes('load') &&
          evidence.smokeRun.reachedPhases.includes('browser-smoke'),
        'The bounded smoke reached build, serve, warmup, load, and browser smoke.',
        'Produce a bounded smoke run that reaches build, serve, warmup, load, and browser smoke.',
      ),
      gate(
        'load-budget-clean',
        loadPassed,
        'Observed load stayed inside budget with zero errors.',
        'Fix load failures before starting large SuperApp development.',
      ),
      gate(
        'teardown-clean',
        teardownPassed,
        'Teardown passed after the bounded smoke failure.',
        'Fix teardown before starting large SuperApp development.',
      ),
    ],
    releaseCertification: [
      gate(
        'full-destroy-pass',
        noOpenBlockers,
        'A full release destroy run can pass with all lane evidence known.',
        'Close residual blockers and rerun release destroy certification.',
      ),
      gate(
        'chaos-port-stable',
        !chaosBlocked,
        'Chaos lane port allocation is stable.',
        'Resolve modernjs-b9f and prove chaos passes without EADDRINUSE.',
      ),
      gate(
        'k6-evidence-known',
        !k6Blocked,
        'k6 prerequisite or fallback is available and evidence is known.',
        'Resolve modernjs-fdl and prove k6 artifacts are no longer unknown.',
      ),
      gate(
        'release-readiness-report-pass',
        evidence.releaseReadinessClassification === 'pass',
        'Release readiness report is pass.',
        'Generate a release readiness report with pass classification.',
      ),
    ],
    nightlyManualTorture: [
      gate(
        'nightly-manual-not-default-pr',
        true,
        'Nightly and manual-torture remain explicit scheduled/operator gates.',
        'Keep expensive profiles out of default PR blocking policy.',
      ),
      gate(
        'infra-blockers-closed',
        !chaosBlocked && !k6Blocked,
        'Chaos and k6 infrastructure blockers are closed.',
        'Close modernjs-b9f and modernjs-fdl before treating nightly/manual torture as authoritative.',
      ),
      gate(
        'nightly-manual-reruns-defined',
        evidence.rerunCommands.some(command =>
          command.includes('--profile nightly'),
        ) &&
          evidence.rerunCommands.some(command =>
            command.includes('--profile manual-torture'),
          ),
        'Nightly and manual-torture rerun commands are documented.',
        'Document deterministic rerun commands for nightly and manual-torture profiles.',
      ),
    ],
    productionRollout: [
      gate(
        'release-certified',
        noOpenBlockers && evidence.releaseReadinessClassification === 'pass',
        'Release certification is complete.',
        'Do not start production rollout until release destroy certification passes.',
      ),
      gate(
        'production-evidence-present',
        evidence.productionRolloutEvidence === 'pass',
        'Production rollout evidence is pass.',
        'Add production rollout evidence after release certification succeeds.',
      ),
    ],
  };
}

function gate(id, passed, pass, fail) {
  return {
    id,
    status: passed ? 'pass' : 'blocked',
    requiredEvidence: passed ? pass : fail,
  };
}

function normalizeEvidence(input) {
  return {
    upstreamRoots: [...(input.upstreamRoots || CURRENT_EVIDENCE.upstreamRoots)],
    completedDestroyTodos: [
      ...(input.completedDestroyTodos ||
        CURRENT_EVIDENCE.completedDestroyTodos),
    ],
    smokeRun: {
      ...CURRENT_EVIDENCE.smokeRun,
      ...(input.smokeRun || {}),
      reachedPhases: [
        ...(input.smokeRun?.reachedPhases ||
          CURRENT_EVIDENCE.smokeRun.reachedPhases),
      ],
    },
    observedLoad: {
      ...CURRENT_EVIDENCE.observedLoad,
      ...(input.observedLoad || {}),
      budgetFailures: [
        ...(input.observedLoad?.budgetFailures ||
          CURRENT_EVIDENCE.observedLoad.budgetFailures),
      ],
    },
    blockers: (input.blockers || CURRENT_EVIDENCE.blockers).map(blocker => ({
      ...blocker,
      status: blocker.status || 'open',
    })),
    releaseReadinessClassification:
      input.releaseReadinessClassification ||
      CURRENT_EVIDENCE.releaseReadinessClassification ||
      'blocked',
    productionRolloutEvidence: input.productionRolloutEvidence || 'blocked',
    rerunCommands: [...(input.rerunCommands || RERUN_COMMANDS)],
  };
}

function hasOpenBlocker(evidence, id) {
  return evidence.blockers.some(
    blocker => blocker.id === id && blocker.status !== 'closed',
  );
}

function renderGateSection(title, gates) {
  return [
    `### ${title}`,
    '',
    table(
      ['Gate', 'Status', 'Required Evidence'],
      gates.map(gate => [gate.id, gate.status, gate.requiredEvidence]),
    ),
  ];
}

function renderBlockers(blockers) {
  if (blockers.length === 0) {
    return ['- none'];
  }
  return blockers.map(
    blocker =>
      `- ${blocker.id}: ${blocker.title} (${blocker.status}, owner: ${blocker.owner || 'unassigned'}). Action: ${blocker.action} Required evidence: ${blocker.requiredEvidence}`,
  );
}

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(formatTableCell).join(' | ')} |`),
  ].join('\n');
}

function formatTableCell(value) {
  return String(value ?? '')
    .replace(/\n/g, ' ')
    .replace(/\|/g, '\\|');
}

function formatBoolean(value) {
  return value ? 'yes' : 'no';
}

function writeFile(filePath, content) {
  const resolved = resolveRepoPath(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content);
}

function resolveRepoPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(REPO_ROOT, value);
}

function pruneUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(pruneUndefined);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, pruneUndefined(entryValue)]),
  );
}

module.exports = {
  CURRENT_EVIDENCE,
  DECISIONS,
  GO_NO_GO_SCHEMA_VERSION,
  RERUN_COMMANDS,
  createGoNoGoCriteria,
  renderGoNoGoMarkdown,
  writeGoNoGoCriteria,
};
