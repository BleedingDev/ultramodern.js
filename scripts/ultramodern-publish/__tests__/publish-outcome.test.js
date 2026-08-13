// Consumer: publish-bleedingdev.yml authenticated outcome handoff.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const {
  createOperationalAcceptanceReceiptFixture,
} = require('../../ultramodern-production-readiness/__tests__/support/operational-acceptance-fixture.js');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const repoRoot = path.resolve(__dirname, '../../..');
const source = {
  commit: '1'.repeat(40),
  repository: 'BleedingDev/ultramodern.js',
};
const release = { tag: 'latest', version: '3.4.0-ultramodern.2' };
const runId = '123';
const producerRunAttempt = 1;
const publicationRunAttempt = 2;
const outcomeRunAttempt = 3;
const producerArtifactIdentity = `run-${runId}-attempt-${producerRunAttempt}`;
const producerRunIdentity = `github:${source.repository}:run:${runId}:attempt:${producerRunAttempt}`;

async function outcomeApi() {
  return import('../publish-outcome.mjs');
}

async function createEvidenceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-outcome-'));
  const releaseDir = path.join(root, 'release');
  const manifestPath = path.join(releaseDir, 'manifest.json');
  const manifestDigestPath = path.join(releaseDir, 'manifest.json.sha256');
  const cohortDigestPath = path.join(releaseDir, 'cohort.sha256');
  const receiptPath = path.join(releaseDir, 'acceptance-receipt.json');
  const operationalEvidencePath = path.join(
    root,
    'acceptance-receipt.operational-independence.json',
  );
  const publishedReceiptPath = path.join(
    root,
    'published-acceptance-receipt.json',
  );
  const publishedOperationalEvidencePath = path.join(
    root,
    'published-acceptance-receipt.operational-independence.json',
  );
  const tractorReportPath = path.join(
    root,
    'tractor-downstream-acceptance.json',
  );
  const outPath = path.join(root, 'publish-outcome.json');
  const [releaseArtifactsApi, releaseManifestApi, receiptApi, constants] =
    await Promise.all([
      import('../prepare-bleedingdev-packages.mjs'),
      import('../lib/source-create-proof/release-manifest.mjs'),
      import(
        '../../ultramodern-production-readiness/published-create-proof/acceptance-receipt.mjs'
      ),
      import('../lib/prepare-bleedingdev-packages/constants.mjs'),
    ]);
  const aliases = {
    '@modern-js/create': '@bleedingdev/modern-js-create',
    '@modern-js/i18n-utils': '@bleedingdev/modern-js-i18n-utils',
  };
  const exportsMap = {
    '.': './index.js',
    './ultramodern-workspace': './index.js',
    './ultramodern-workspace/codesmith': './index.js',
  };
  const definitions = [
    {
      dependencies: {
        '@modern-js/i18n-utils': `npm:${aliases['@modern-js/i18n-utils']}@${release.version}`,
        '@module-federation/runtime': '2.8.0',
      },
      exports: exportsMap,
      sourceName: '@modern-js/create',
      targetName: aliases['@modern-js/create'],
      ultramodern: { frameworkVersion: release.version },
    },
    {
      dependencies: {},
      sourceName: '@modern-js/i18n-utils',
      targetName: aliases['@modern-js/i18n-utils'],
    },
  ];
  const packages = definitions.map(definition => {
    const packageDir = path.join(
      root,
      'staged',
      definition.targetName.replaceAll('/', '__'),
    );
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      `${JSON.stringify({
        dependencies: definition.dependencies,
        exports: definition.exports,
        name: definition.targetName,
        publishConfig: { access: 'public', exports: definition.exports },
        ultramodern: definition.ultramodern,
        version: release.version,
      })}\n`,
    );
    fs.writeFileSync(
      path.join(packageDir, 'index.js'),
      'module.exports = {};\n',
    );
    if (definition.sourceName === '@modern-js/create') {
      for (const relativePath of constants.createTemplateRequiredFiles) {
        const filePath = path.join(packageDir, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, 'fixture\n');
      }
    }
    return {
      packageDir: path.relative(repoRoot, packageDir),
      sourceName: definition.sourceName,
      targetName: definition.targetName,
      version: release.version,
    };
  });
  releaseArtifactsApi.createReleaseArtifacts({
    aliases,
    command: execFileSync,
    outDir: releaseDir,
    packages,
    source,
    tag: release.tag,
    tools: { node: process.version, npm: 'fixture-npm', pnpm: 'fixture-pnpm' },
    version: release.version,
  });
  const acceptanceRelease = releaseManifestApi.readReleaseManifest({
    manifestPath,
  });
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const cohortDigest = manifest.cohortDigest;
  const manifestSha256 = acceptanceRelease.manifestSha256;
  const createReceipt = async (mode, targetPath, evidencePath) => {
    const receipt = receiptApi.createAcceptanceReceipt({
      createPackage: {
        exactSpecifier: `@bleedingdev/modern-js-create@${release.version}`,
        packageName: '@bleedingdev/modern-js-create',
        version: release.version,
      },
      mode,
      profile: { id: 'erp-10', verticalCount: 10 },
      registry: {
        cohortPackages: 'verified',
        externalDependencies: 'verified',
        resolution: 'verified',
        url: 'https://registry.npmjs.org/',
      },
      release: acceptanceRelease,
      runIdentity: producerRunIdentity,
      runtime: {
        arch: 'x64',
        node: '24.0.0',
        npm: '11.0.0',
        platform: 'linux',
        playwright: '1.60.0',
        pnpm: '11.17.0',
        registry: { integrity: 'sha512-bnBt', name: 'npm', version: '11.0.0' },
        yaml: { integrity: 'sha512-eWFtbA==', name: 'yaml', version: '2.0.0' },
      },
    });
    receiptApi.bindSupplyChainEvidence(receipt, {
      closureSha256: digest('closure'),
      exceptionPolicySha256: digest('exceptions'),
      lockSha256: digest('lock'),
      registryMetadataSha256: digest('registry'),
      releaseManifestSha256: manifestSha256,
    });
    await createOperationalAcceptanceReceiptFixture({
      evidencePath,
      receipt,
      receiptApi,
    });
    fs.writeFileSync(targetPath, `${JSON.stringify(receipt)}\n`);
  };
  await createReceipt('source', receiptPath, operationalEvidencePath);
  await createReceipt(
    'published',
    publishedReceiptPath,
    publishedOperationalEvidencePath,
  );
  const tractorBaselineRevision = 'cb6974e31bc919c86ae5bb86044409f0f1e036d5';
  const verticalIds = ['checkout', 'decide', 'explore'];
  const boundaryCandidates = {
    checkout: ['checkout', 'verticalCheckout'],
    decide: ['decide', 'verticalDecide'],
    explore: ['explore', 'verticalExplore'],
  };
  const nativeSearch = {
    cartRoute: '/en/cart?sku=EX-01',
    productRoute: '/en/tractors/example?sku=EX-01',
    sku: 'EX-01',
    status: 'native-typed-search',
  };
  // The acceptance report carries the summary assertVisibleTractorUi returns
  // for the raw browser evidence, never the raw evidence itself.
  const visibleUi = {
    accessibilityCheckCount: 7,
    boundaryCount: 5,
    computedStyleSampleCount: 5,
    runtimeInteractionCount: 4,
    status: 'visible-ui-contract',
  };
  const assertions = types => types.map(type => ({ status: 'pass', type }));
  const nodeSsrResult = (appId, noJavaScriptType) => {
    const httpAssertionTypes = [
      'ssr-route',
      'ui-marker-html',
      'css-root-marker',
      'mf-manifest',
      'mf-manifest-json',
      'locale-json',
    ];
    const noJavaScriptAssertionTypes = [
      'no-js-ssr-css-root-marker',
      'no-js-stylesheet-href-dedupe',
      'no-js-ssr-failed-responses',
      'no-js-screenshot',
      noJavaScriptType,
      ...(appId === 'shell-super-app'
        ? ['no-js-shell-composition-boundary']
        : []),
    ];
    const noJavaScriptAssertions = assertions(noJavaScriptAssertionTypes);
    if (appId === 'shell-super-app') {
      noJavaScriptAssertions.find(
        assertion => assertion.type === 'no-js-distributed-ssr-route',
      ).route = '/en/tractors/example';
      Object.assign(
        noJavaScriptAssertions.find(
          assertion => assertion.type === 'no-js-shell-composition-boundary',
        ),
        {
          declaredRemoteIds: verticalIds,
          matchedRemoteBoundaries: verticalIds.map(remoteId => ({
            boundaryId: remoteId,
            remoteId,
          })),
          triedRemoteBoundaries: verticalIds.map(remoteId => ({
            matchedBoundaryId: remoteId,
            remoteId,
            triedBoundaryIds: boundaryCandidates[remoteId],
          })),
        },
      );
    }
    return {
      appId,
      httpAssertions: assertions(httpAssertionTypes),
      httpAssertionTypes,
      noJavaScriptAssertions,
      noJavaScriptAssertionTypes,
    };
  };
  fs.writeFileSync(
    tractorReportPath,
    `${JSON.stringify({
      checks: [
        {
          detail: {
            createPackage: `@bleedingdev/modern-js-create@${release.version}`,
            version: release.version,
          },
          id: 'exact-create-migration',
          status: 'passed',
        },
        {
          detail: {
            dependencyObservationCount: 1,
            generatedCohort: {
              packageCount: definitions.length,
              projectionSchema: 'bleedingdev.ultramodern.release-cohort',
              projectionSchemaVersion: 1,
              version: release.version,
            },
          },
          id: 'exact-cohort',
          status: 'passed',
        },
        ...[
          'install---frozen-lockfile',
          'check',
          'promotable-application-source',
          'build',
          'node:proof',
        ].map(id => ({ detail: { id }, id, status: 'passed' })),
        {
          detail: {
            appIds: verticalIds,
            resultCount: verticalIds.length,
            status: 'pass',
          },
          id: 'node-backend-federation-executed',
          status: 'passed',
        },
        {
          detail: {
            appCount: verticalIds.length + 1,
            distributedSsrRoute: '/en/tractors/example',
            results: [
              ...verticalIds.map(appId =>
                nodeSsrResult(appId, 'no-js-ssr-ui-marker'),
              ),
              nodeSsrResult('shell-super-app', 'no-js-distributed-ssr-route'),
            ],
            status: 'pass',
          },
          id: 'node-server-rendered-ssr-executed',
          status: 'passed',
        },
        {
          detail: {
            assertionCount: 5,
            nativeSearch,
            platform: 'node',
            routes: [
              '/en/tractors',
              '/en/tractors/example?sku=EX-01',
              '/en/cart?sku=EX-01',
              '/en/checkout',
              '/en/checkout/thank-you',
            ],
            ui: visibleUi,
          },
          id: 'node-visible-tractor-workflow',
          status: 'passed',
        },
        {
          detail: { id: 'cloudflare:build' },
          id: 'cloudflare:build',
          status: 'passed',
        },
        {
          detail: {
            assertionCount: 5,
            nativeSearch,
            platform: 'workerd',
            routes: [
              '/en/tractors',
              '/en/tractors/example?sku=EX-01',
              '/en/cart?sku=EX-01',
              '/en/checkout',
              '/en/checkout/thank-you',
            ],
            ui: visibleUi,
          },
          id: 'workerd-visible-tractor-workflow',
          status: 'passed',
        },
        {
          detail: {
            node: nativeSearch,
            workerd: nativeSearch,
          },
          id: 'native-tanstack-search',
          status: 'passed',
        },
        {
          detail: { node: visibleUi, workerd: visibleUi },
          id: 'visible-tractor-ui',
          status: 'passed',
        },
      ],
      release: {
        cohortDigest,
        manifestSha256,
        sourceRevision: source.commit,
        version: release.version,
      },
      schema: 'bleedingdev.ultramodern.tractor-downstream-acceptance',
      schemaVersion: 1,
      status: 'passed',
      tractor: { baselineRevision: tractorBaselineRevision },
    })}\n`,
  );
  return {
    cohortDigestPath,
    manifestDigestPath,
    manifestPath,
    operationalEvidencePath,
    outPath,
    publishedOperationalEvidencePath,
    publishedReceiptPath,
    receiptPath,
    root,
    tractorBaselineRevision,
    tractorReportPath,
    tractorReportSha256: digest(fs.readFileSync(tractorReportPath)),
  };
}

function createOptions(fixture, artifactName, dryRun) {
  const options = {
    ...fixture,
    artifactName,
    dryRun,
    producerArtifactIdentity,
    publicationRunAttempt,
    producerRunAttempt,
    producerRunIdentity,
    repository: source.repository,
    runAttempt: outcomeRunAttempt,
    runId,
    sourceCommit: source.commit,
    tag: release.tag,
    version: release.version,
  };
  if (dryRun) {
    delete options.publishedOperationalEvidencePath;
    delete options.publishedReceiptPath;
    delete options.tractorBaselineRevision;
    delete options.tractorReportPath;
    delete options.tractorReportSha256;
  }
  return options;
}

function artifact(id, name, overrides = {}) {
  return {
    created_at: '2026-07-10T10:00:00Z',
    expired: false,
    id,
    name,
    ...overrides,
  };
}

test('dry-run and real publication emit the same strict bound outcome schema', async () => {
  const api = await outcomeApi();
  const artifactName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });

  for (const dryRun of [true, false]) {
    const fixture = await createEvidenceFixture();
    try {
      const outcome = api.createPublishOutcome(
        createOptions(fixture, artifactName, dryRun),
      );
      assert.equal(outcome.schema, api.publishOutcomeSchema);
      assert.equal(outcome.schemaVersion, api.publishOutcomeSchemaVersion);
      assert.equal(outcome.artifactName, artifactName);
      assert.equal(outcome.dryRun, dryRun);
      assert.deepEqual(outcome.source, source);
      assert.deepEqual(outcome.release, release);
      assert.deepEqual(outcome.workflowRun, {
        attempt: outcomeRunAttempt,
        id: runId,
      });
      assert.deepEqual(
        outcome.publication,
        dryRun ? null : { runAttempt: publicationRunAttempt },
      );
      assert.deepEqual(outcome.producer, {
        artifactIdentity: producerArtifactIdentity,
        runAttempt: producerRunAttempt,
        runIdentity: producerRunIdentity,
      });
    } finally {
      fs.rmSync(fixture.root, { force: true, recursive: true });
    }
  }
});

test('non-dry outcome fails closed without passing published acceptance evidence', async () => {
  const api = await outcomeApi();
  const artifactName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });
  const fixture = await createEvidenceFixture();
  try {
    const missing = createOptions(fixture, artifactName, false);
    delete missing.publishedReceiptPath;
    delete missing.publishedOperationalEvidencePath;
    assert.throws(
      () => api.createPublishOutcome(missing),
      /requires published and Tractor acceptance evidence/u,
    );

    const missingTractor = createOptions(fixture, artifactName, false);
    delete missingTractor.tractorBaselineRevision;
    delete missingTractor.tractorReportPath;
    delete missingTractor.tractorReportSha256;
    assert.throws(
      () => api.createPublishOutcome(missingTractor),
      /requires published and Tractor acceptance evidence/u,
    );

    const receipt = JSON.parse(
      fs.readFileSync(fixture.publishedReceiptPath, 'utf8'),
    );
    receipt.mode = 'source';
    fs.writeFileSync(
      fixture.publishedReceiptPath,
      `${JSON.stringify(receipt)}\n`,
    );
    assert.throws(
      () =>
        api.createPublishOutcome(createOptions(fixture, artifactName, false)),
      /Acceptance receipt mode must be published/u,
    );
  } finally {
    fs.rmSync(fixture.root, { force: true, recursive: true });
  }
});

test('publish outcome rejects incomplete receipt, operational evidence, and Tractor proof', async () => {
  const api = await outcomeApi();
  const artifactName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });
  const cases = [
    {
      label: 'forged receipt artifact binding',
      mutate(fixture) {
        const receipt = JSON.parse(
          fs.readFileSync(fixture.receiptPath, 'utf8'),
        );
        receipt.binding.artifacts.packages[0].integrity = 'sha512-Zm9yZ2Vk';
        receipt.binding.create.integrity = 'sha512-Zm9yZ2Vk';
        fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(receipt)}\n`);
      },
      pattern: /binding does not match the strict release manifest/u,
    },
    {
      label: 'foreign producer receipt',
      mutate(fixture) {
        const receipt = JSON.parse(
          fs.readFileSync(fixture.receiptPath, 'utf8'),
        );
        receipt.binding.runIdentity = 'github:foreign/repo:run:999:attempt:1';
        fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(receipt)}\n`);
      },
      pattern:
        /(?:run identity must be|binding does not match the strict release manifest)/u,
    },
    {
      label: 'missing required receipt result',
      mutate(fixture) {
        const receipt = JSON.parse(
          fs.readFileSync(fixture.receiptPath, 'utf8'),
        );
        receipt.results.pop();
        fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(receipt)}\n`);
      },
      pattern: /every required result exactly once/u,
    },
    {
      label: 'tampered operational evidence',
      mutate(fixture) {
        const evidence = JSON.parse(
          fs.readFileSync(fixture.operationalEvidencePath, 'utf8'),
        );
        evidence.result = 'fail';
        fs.writeFileSync(
          fixture.operationalEvidencePath,
          `${JSON.stringify(evidence)}\n`,
        );
      },
      pattern: /canonical digest does not match its content/u,
    },
    {
      label: 'coherently re-digested operational forgery',
      async mutate(fixture) {
        const receipt = JSON.parse(
          fs.readFileSync(fixture.receiptPath, 'utf8'),
        );
        const evidence = JSON.parse(
          fs.readFileSync(fixture.operationalEvidencePath, 'utf8'),
        );
        const { digestCanonical } = await import(
          pathToFileURL(
            path.resolve(
              __dirname,
              '../../ultramodern-production-readiness/canonical-digest.mjs',
            ),
          )
        );
        evidence.result = 'fail';
        const payload = { ...evidence };
        delete payload.evidenceDigest;
        evidence.evidenceDigest = digestCanonical(payload);
        const evidenceSource = `${JSON.stringify(evidence)}\n`;
        fs.writeFileSync(fixture.operationalEvidencePath, evidenceSource);
        const detail = receipt.results.find(
          result => result.id === 'operational-independence',
        ).details;
        detail.evidenceDigest = evidence.evidenceDigest;
        detail.evidenceFileSha256 = digest(evidenceSource);
        fs.writeFileSync(fixture.receiptPath, `${JSON.stringify(receipt)}\n`);
      },
      pattern: /missing, skipped, or not passing/u,
    },
    {
      label: 'missing Tractor check',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        report.checks.pop();
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /every required check/u,
    },
    {
      label: 'forged exact create migration detail',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        report.checks.find(
          check => check.id === 'exact-create-migration',
        ).detail.createPackage = 'attacker-package@latest';
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /exact-create migration/u,
    },
    {
      label: 'forged exact cohort detail',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        report.checks.find(
          check => check.id === 'exact-cohort',
        ).detail.generatedCohort.packageCount = 1;
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /exact cohort/u,
    },
    {
      label: 'malformed Node SSR proof',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        report.checks.find(
          check => check.id === 'node-server-rendered-ssr-executed',
        ).detail.appCount = 0;
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /server-rendered SSR evidence/u,
    },
    {
      label: 'coherently reduced Node SSR app set',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        const backend = report.checks.find(
          check => check.id === 'node-backend-federation-executed',
        ).detail;
        backend.appIds = backend.appIds.filter(appId => appId !== 'checkout');
        backend.resultCount = backend.appIds.length;
        const ssr = report.checks.find(
          check => check.id === 'node-server-rendered-ssr-executed',
        ).detail;
        ssr.results = ssr.results.filter(result => result.appId !== 'checkout');
        ssr.appCount = ssr.results.length;
        const composition = ssr.results
          .find(result => result.appId === 'shell-super-app')
          .noJavaScriptAssertions.find(
            assertion => assertion.type === 'no-js-shell-composition-boundary',
          );
        composition.declaredRemoteIds = composition.declaredRemoteIds.filter(
          appId => appId !== 'checkout',
        );
        composition.matchedRemoteBoundaries =
          composition.matchedRemoteBoundaries.filter(
            boundary => boundary.remoteId !== 'checkout',
          );
        composition.triedRemoteBoundaries =
          composition.triedRemoteBoundaries.filter(
            boundary => boundary.remoteId !== 'checkout',
          );
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /reviewed topology/u,
    },
    {
      label: 'failing assertion appended to passing Node SSR proof',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        const result = report.checks
          .find(check => check.id === 'node-server-rendered-ssr-executed')
          .detail.results.find(item => item.appId === 'explore');
        result.httpAssertions.push({
          status: 'fail',
          type: 'effect-readiness',
        });
        result.httpAssertionTypes.push('effect-readiness');
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /server-rendered SSR evidence/u,
    },
    {
      label: 'empty distributed SSR route',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        report.checks.find(
          check => check.id === 'node-server-rendered-ssr-executed',
        ).detail.distributedSsrRoute = '';
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /server-rendered SSR evidence/u,
    },
    {
      label: 'self-attested distributed SSR route',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        report.checks.find(
          check => check.id === 'node-server-rendered-ssr-executed',
        ).detail.distributedSsrRoute = '/';
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /server-rendered SSR evidence/u,
    },
    {
      label: 'forged visible workflow route coverage',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        report.checks.find(
          check => check.id === 'node-visible-tractor-workflow',
        ).detail.routes = Array(5).fill('/en/tractors');
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /node browser workflow evidence/u,
    },
    {
      label: 'under-covered visible UI contract summary',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        const workflow = report.checks.find(
          check => check.id === 'node-visible-tractor-workflow',
        ).detail;
        workflow.ui = { ...workflow.ui, boundaryCount: 4 };
        report.checks.find(
          check => check.id === 'visible-tractor-ui',
        ).detail.node = workflow.ui;
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /boundaryCount must cover at least 5/u,
    },
    {
      label: 'detached visible UI summary',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        const summary = report.checks.find(
          check => check.id === 'visible-tractor-ui',
        ).detail;
        summary.node = { ...summary.node, runtimeInteractionCount: 3 };
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /visible UI summary differs/u,
    },
    {
      label: 'empty shell SSR composition payload',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        const composition = report.checks
          .find(check => check.id === 'node-server-rendered-ssr-executed')
          .detail.results.find(result => result.appId === 'shell-super-app')
          .noJavaScriptAssertions.find(
            assertion => assertion.type === 'no-js-shell-composition-boundary',
          );
        composition.declaredRemoteIds = [];
        composition.matchedRemoteBoundaries = [];
        composition.triedRemoteBoundaries = [];
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /server-rendered SSR evidence/u,
    },
    {
      label: 'producer-impossible shell SSR boundary identity',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        const composition = report.checks
          .find(check => check.id === 'node-server-rendered-ssr-executed')
          .detail.results.find(result => result.appId === 'shell-super-app')
          .noJavaScriptAssertions.find(
            assertion => assertion.type === 'no-js-shell-composition-boundary',
          );
        const matched = composition.matchedRemoteBoundaries.find(
          boundary => boundary.remoteId === 'explore',
        );
        const tried = composition.triedRemoteBoundaries.find(
          boundary => boundary.remoteId === 'explore',
        );
        matched.boundaryId = 'forged-boundary';
        tried.matchedBoundaryId = 'forged-boundary';
        tried.triedBoundaryIds = ['forged-boundary'];
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /server-rendered SSR evidence/u,
    },
    {
      label: 'inconsistent shell SSR boundary identity',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        const composition = report.checks
          .find(check => check.id === 'node-server-rendered-ssr-executed')
          .detail.results.find(result => result.appId === 'shell-super-app')
          .noJavaScriptAssertions.find(
            assertion => assertion.type === 'no-js-shell-composition-boundary',
          );
        composition.matchedRemoteBoundaries[0].boundaryId = 'forged-boundary';
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /server-rendered SSR evidence/u,
    },
    {
      label: 'missing shell SSR composition proof',
      mutate(fixture) {
        const report = JSON.parse(
          fs.readFileSync(fixture.tractorReportPath, 'utf8'),
        );
        const shell = report.checks
          .find(check => check.id === 'node-server-rendered-ssr-executed')
          .detail.results.find(result => result.appId === 'shell-super-app');
        shell.noJavaScriptAssertionTypes =
          shell.noJavaScriptAssertionTypes.filter(
            type => type !== 'no-js-shell-composition-boundary',
          );
        shell.noJavaScriptAssertions = shell.noJavaScriptAssertions.filter(
          assertion => assertion.type !== 'no-js-shell-composition-boundary',
        );
        fs.writeFileSync(
          fixture.tractorReportPath,
          `${JSON.stringify(report)}\n`,
        );
        fixture.tractorReportSha256 = digest(
          fs.readFileSync(fixture.tractorReportPath),
        );
      },
      pattern: /server-rendered SSR evidence/u,
    },
  ];
  for (const { label, mutate, pattern } of cases) {
    const fixture = await createEvidenceFixture();
    try {
      await mutate(fixture);
      assert.throws(
        () =>
          api.createPublishOutcome(createOptions(fixture, artifactName, false)),
        pattern,
        label,
      );
    } finally {
      fs.rmSync(fixture.root, { force: true, recursive: true });
    }
  }
});

test('artifact discovery accepts one current outcome across all API pages', async () => {
  const api = await outcomeApi();
  const previousName = api.publishOutcomeArtifactName({
    runAttempt: publicationRunAttempt,
    runId,
  });
  const expectedName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });
  const selected = api.selectPublishOutcomeArtifact(
    [
      { artifacts: [artifact(1, 'unrelated'), artifact(2, previousName)] },
      { artifacts: [artifact(3, expectedName)] },
    ],
    {
      completedAt: '2026-07-10T10:01:00Z',
      runAttempt: outcomeRunAttempt,
      runId,
    },
  );
  assert.equal(selected.id, 3);
  assert.equal(selected.name, expectedName);
});

test('artifact discovery fails closed for missing and cross-page duplicate outcomes', async () => {
  const api = await outcomeApi();
  const expectedName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });
  const options = {
    completedAt: '2026-07-10T10:01:00Z',
    runAttempt: outcomeRunAttempt,
    runId,
  };

  assert.throws(
    () => api.selectPublishOutcomeArtifact([{ artifacts: [] }], options),
    /found 0/u,
  );
  assert.throws(
    () =>
      api.selectPublishOutcomeArtifact(
        [
          { artifacts: [artifact(1, expectedName)] },
          { artifacts: [artifact(2, expectedName)] },
        ],
        options,
      ),
    /found 2/u,
  );
});

test('artifact discovery fails closed for malformed, delayed, expired, and name-drift evidence', async () => {
  const api = await outcomeApi();
  const expectedName = api.publishOutcomeArtifactName({
    runAttempt: outcomeRunAttempt,
    runId,
  });
  const options = {
    completedAt: '2026-07-10T10:01:00Z',
    runAttempt: outcomeRunAttempt,
    runId,
  };
  const cases = [
    [[{ artifacts: 'not-an-array' }], /artifacts must be an array/u],
    [
      [{ artifacts: [{ expired: false, id: 1, name: expectedName }] }],
      /created_at must be an ISO timestamp/u,
    ],
    [
      [
        {
          artifacts: [
            artifact(1, expectedName, {
              created_at: '2026-07-10T10:02:00Z',
            }),
          ],
        },
      ],
      /created after the triggering run completed/u,
    ],
    [
      [{ artifacts: [artifact(1, expectedName, { expired: true })] }],
      /is expired/u,
    ],
    [
      [{ artifacts: [artifact(1, `${expectedName}-renamed`)] }],
      /artifact name drift/u,
    ],
  ];
  for (const [pages, pattern] of cases) {
    assert.throws(
      () => api.selectPublishOutcomeArtifact(pages, options),
      pattern,
    );
  }
});
