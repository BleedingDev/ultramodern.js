const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createAcceptanceContinuationFixture,
} = require('./support/acceptance-continuation-fixture');

const continuationModule =
  '../published-create-proof/acceptance-continuation.mjs';
const sdkModuleFederationDependencies = {
  '@module-federation/runtime': 'npm:@bleedingdev/mf-runtime@2.9.1',
  '@module-federation/dts-plugin': 'npm:@bleedingdev/mf-dts-plugin@2.9.1',
  '@module-federation/modern-js-v3': 'npm:@bleedingdev/mf-modern-js-v3@2.9.1',
};

function changeRuntimeReport(record, platform, change) {
  const descriptor = record.runtimeReports[platform];
  const report = JSON.parse(descriptor.text);
  change(report);
  descriptor.text = `${JSON.stringify(report, null, 2)}\n`;
  descriptor.byteLength = Buffer.byteLength(descriptor.text);
  descriptor.sha256 = crypto
    .createHash('sha256')
    .update(descriptor.text)
    .digest('hex');
}

function changeShellFinalization(record, change) {
  const descriptor = record.reusedEvidence.cloudflare.shellFinalization;
  const result = JSON.parse(descriptor.text);
  change(result);
  descriptor.text = `${JSON.stringify(result, null, 2)}\n`;
  descriptor.byteLength = Buffer.byteLength(descriptor.text);
  descriptor.sha256 = crypto
    .createHash('sha256')
    .update(descriptor.text)
    .digest('hex');
}

test('source-node continuation validates all remaining stages against their reports', async () => {
  const { assertAcceptanceContinuation, continuationResultIds } = await import(
    continuationModule
  );
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();

  assert.equal(
    assertAcceptanceContinuation(record, { release, runIdentity }),
    record,
  );
  assert.deepEqual(
    record.results.map(result => result.id),
    continuationResultIds,
  );
  assert.equal(record.results.length, 20);
  assert.equal(record.reusedEvidence.nodeOutputs.length, 11);
  assert.equal(
    record.reusedEvidence.priorRunLog.attribution.commands.length,
    11,
  );
  assert.equal(record.runtimeReports.node.provenance, 'external-report');
  assert.equal(record.runtimeReports.workerd.provenance, 'executed-here');
});

test('source-node continuation also accepts a Node report executed during continuation', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({
      nodeReportProvenance: 'executed-here',
    });

  assert.equal(
    assertAcceptanceContinuation(record, { release, runIdentity }),
    record,
  );
});

test('source-workerd continuation retains the failed build and separate shell finalization', async () => {
  const { assertAcceptanceContinuation, requiredContinuationResultIds } =
    await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({ cursor: 'source-workerd' });

  assert.equal(
    assertAcceptanceContinuation(record, { release, runIdentity }),
    record,
  );
  assert.deepEqual(
    record.results.map(result => result.id),
    requiredContinuationResultIds('source-workerd'),
  );
  assert.equal(record.results.length, 20);
  assert.ok(record.results.some(result => result.id === 'cloudflare-output'));
  assert.ok(!record.results.some(result => result.id === 'cloudflare-build'));
  const cloudflare = record.reusedEvidence.cloudflare;
  assert.equal(cloudflare.priorRunLog.attribution.commands.length, 10);
  assert.equal(
    cloudflare.priorRunLog.attribution.shellAttempt.compilerLines.length,
    3,
  );
  assert.match(
    cloudflare.priorRunLog.attribution.shellAttempt.failure.text,
    /UI-only application emitted an undeclared API\/backend artifact/u,
  );
  assert.equal(cloudflare.outputs, record.runtimeOutputs.workerd);
  assert.equal(record.runtimeOutputs.workerd.length, 11);
  assert.ok(
    record.runtimeOutputs.workerd.every(
      output => output.rendererManifestPath === 'public/renderer-build.json',
    ),
  );
  assert.ok(
    record.reusedEvidence.nodeOutputs.every(
      output => output.rendererManifestPath === 'renderer-build.json',
    ),
  );
  const finalization = JSON.parse(cloudflare.shellFinalization.text);
  assert.equal(finalization.originalBuildSucceeded, false);
  assert.equal(finalization.compilerReplayed, false);
  assert.equal(finalization.command.actions.length, 12);
  assert.deepEqual(finalization.descriptors.priorNodeReport, {
    path: record.runtimeReports.node.path,
    byteLength: record.runtimeReports.node.byteLength,
    sha256: record.runtimeReports.node.sha256,
  });
});

test('source-workerd continuation attributes all completed Cloudflare commands without a fabricated shell stage', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({
      cursor: 'source-workerd',
      cloudflareBuildCompleted: true,
      moduleFederationDependencies: sdkModuleFederationDependencies,
      workerdBuildMarkers: { 'shell-super-app': 'd'.repeat(64) },
    });

  assert.equal(
    assertAcceptanceContinuation(record, { release, runIdentity }),
    record,
  );
  const cloudflare = record.reusedEvidence.cloudflare;
  assert.equal(cloudflare.priorRunLog.attribution.commands.length, 11);
  assert.equal(cloudflare.shellFinalization, undefined);
  assert.equal(cloudflare.priorRunLog.attribution.shellAttempt, undefined);
  assert.equal(
    cloudflare.priorRunLog.attribution.rootCompletion.verifiedApps.length,
    11,
  );
  assert.equal(
    record.results.find(result => result.id === 'cloudflare-output').details
      .originalAggregateBuildSucceeded,
    true,
  );
  assert.equal(record.runtimeReports.workerd.provenance, 'executed-here');
  assert.equal(record.runtimeReports.node.provenance, 'external-report');
});

test('completed Cloudflare continuation rejects incomplete or mixed command provenance', async t => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const fixture = await createAcceptanceContinuationFixture({
    cursor: 'source-workerd',
    cloudflareBuildCompleted: true,
  });
  const mutations = [
    [
      'missing completed command',
      record => {
        record.reusedEvidence.cloudflare.priorRunLog.attribution.commands.pop();
      },
    ],
    [
      'fabricated separate finalization',
      record => {
        record.reusedEvidence.cloudflare.shellFinalization = {};
      },
    ],
    [
      'false aggregate result',
      record => {
        record.results.find(
          result => result.id === 'cloudflare-output',
        ).details.originalAggregateBuildSucceeded = false;
      },
    ],
    [
      'missing genuine proof with fresh byte binding',
      record => {
        const descriptor = record.reusedEvidence.cloudflare.priorRunLog;
        descriptor.text = descriptor.text.replace(
          /^Workerd SSR composition proof passed.*\n/gmu,
          '',
        );
        descriptor.byteLength = Buffer.byteLength(descriptor.text);
        descriptor.sha256 = crypto
          .createHash('sha256')
          .update(descriptor.text)
          .digest('hex');
      },
    ],
    [
      'foreign native output placement',
      record => {
        record.runtimeOutputs.workerd[0].rendererManifestPath =
          'renderer-build.json';
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const record = structuredClone(fixture.record);
      mutate(record);
      assert.throws(() => assertAcceptanceContinuation(record, fixture));
    });
  }
});

test('failed Cloudflare shell still requires its separate public finalization', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({ cursor: 'source-workerd' });
  delete record.reusedEvidence.cloudflare.shellFinalization;

  assert.throws(() =>
    assertAcceptanceContinuation(record, { release, runIdentity }),
  );
});

test('continuation preserves the full 49-package cohort while observing 18 authored dependencies', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({
      cursor: 'source-workerd',
      cloudflareBuildCompleted: true,
      releasePackageCount: 49,
      observedPackageCount: 18,
    });

  assert.equal(
    assertAcceptanceContinuation(record, { release, runIdentity }),
    record,
  );
  assert.equal(record.binding.artifacts.packages.length, 49);
  assert.equal(record.binding.manifest.packageCount, 49);
  assert.equal(record.reusedEvidence.installedCohort.expectedPackageCount, 49);
  assert.equal(record.reusedEvidence.installedCohort.observedPackageCount, 18);
});

test('continuation rejects incomplete or foreign observed cohort evidence', async t => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const fixture = await createAcceptanceContinuationFixture({
    releasePackageCount: 49,
    observedPackageCount: 18,
  });
  const mutations = [
    [
      'changed full release size',
      cohort => {
        cohort.expectedPackageCount = 48;
      },
    ],
    [
      'unobserved declared dependency',
      cohort => {
        cohort.observedPackageCount += 1;
      },
    ],
    [
      'duplicate observed dependency',
      cohort => {
        cohort.observedSourceNames[1] = cohort.observedSourceNames[0];
      },
    ],
    [
      'foreign observed dependency',
      cohort => {
        cohort.observedSourceNames[0] = '@modern-js/foreign-package';
      },
    ],
    [
      'empty observed dependency set',
      cohort => {
        cohort.observedPackageCount = 0;
        cohort.observedSourceNames = [];
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const record = structuredClone(fixture.record);
      mutate(record.reusedEvidence.installedCohort);
      assert.throws(
        () => assertAcceptanceContinuation(record, fixture),
        /prior evidence attribution is incomplete/u,
      );
    });
  }
});

test('source-workerd continuation rejects a Cloudflare manifest bound to the Node producer path', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({ cursor: 'source-workerd' });
  record.runtimeOutputs.workerd.find(
    output => output.appId === 'inventory',
  ).rendererManifestPath = 'renderer-build.json';

  assert.throws(() =>
    assertAcceptanceContinuation(record, { release, runIdentity }),
  );
});

test('source-workerd continuation rejects a Node manifest bound to the Cloudflare public path', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({ cursor: 'source-workerd' });
  record.reusedEvidence.nodeOutputs.find(
    output => output.appId === 'inventory',
  ).rendererManifestPath = 'public/renderer-build.json';

  assert.throws(() =>
    assertAcceptanceContinuation(record, { release, runIdentity }),
  );
});

test('source-workerd continuation rejects shell finalization for another candidate', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({ cursor: 'source-workerd' });
  changeShellFinalization(record, result => {
    result.inputCandidate.sourceRevision = 'd'.repeat(40);
  });

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /Shell finalization differs from the candidate\/native output/u,
  );
});

test('source-workerd continuation rejects shell finalization bound to another Node report', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({ cursor: 'source-workerd' });
  changeShellFinalization(record, result => {
    result.descriptors.priorNodeReport.sha256 = 'd'.repeat(64);
  });

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /Shell finalization input\/output descriptors differ/u,
  );
});

test('source-workerd continuation rejects an omitted public shell stage action', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({ cursor: 'source-workerd' });
  changeShellFinalization(record, result => {
    result.command.actions = result.command.actions.filter(
      action => action !== 'onBeforeExit',
    );
  });

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /actual public stage contract/u,
  );
});

test('source-workerd continuation rejects incomplete native shell cleanup', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({ cursor: 'source-workerd' });
  changeShellFinalization(record, result => {
    result.cleanup.environmentRestored = false;
  });

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /successful cleanup/u,
  );
});

test('continuation accepts different native Node and Cloudflare build markers', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({
      workerdBuildMarkers: {
        'shell-super-app': 'd'.repeat(64),
        inventory: 'e'.repeat(64),
      },
    });

  assert.equal(
    assertAcceptanceContinuation(record, { release, runIdentity }),
    record,
  );
  for (const appId of ['shell-super-app', 'inventory']) {
    const node = record.reusedEvidence.nodeOutputs.find(
      output => output.appId === appId,
    );
    const workerd = record.runtimeOutputs.workerd.find(
      output => output.appId === appId,
    );
    assert.notEqual(node.identity.buildMarker, workerd.identity.buildMarker);
    assert.equal(workerd.releaseEnvelope.target, 'cloudflare');
    const report = JSON.parse(record.runtimeReports.workerd.text);
    const result = report.results.find(result => result.appId === appId);
    assert.ok(
      result.assertions.every(
        assertion =>
          assertion.actual === workerd.identity.buildMarker &&
          assertion.expected === workerd.identity.buildMarker,
      ),
    );
  }
});

test('continuation rejects a workerd browser marker from another native build', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  changeRuntimeReport(record, 'workerd', report => {
    const result = report.results.find(result => result.appId === 'inventory');
    result.assertions.find(
      assertion => assertion.type === 'browser-ui-marker',
    ).actual = 'e'.repeat(64);
  });

  assert.throws(() =>
    assertAcceptanceContinuation(record, { release, runIdentity }),
  );
});

test('continuation rejects a Cloudflare native output from another application commit', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  const output = record.runtimeOutputs.workerd.find(
    output => output.appId === 'inventory',
  );
  output.identity.sourceRevision = 'd'.repeat(40);
  output.rendererManifest.sourceRevision = output.identity.sourceRevision;
  output.releaseEnvelope.identity.sourceRevision =
    output.identity.sourceRevision;

  assert.throws(() =>
    assertAcceptanceContinuation(record, { release, runIdentity }),
  );
});

test('continuation rejects different native delivery units between targets', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  const output = record.runtimeOutputs.workerd.find(
    output => output.appId === 'inventory',
  );
  output.identity.unitId = 'acceptance/foreign-inventory';
  output.releaseEnvelope.identity.unitId = output.identity.unitId;

  assert.throws(() =>
    assertAcceptanceContinuation(record, { release, runIdentity }),
  );
});

test('continuation rejects different native application release versions between targets', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  const output = record.runtimeOutputs.workerd.find(
    output => output.appId === 'inventory',
  );
  output.identity.releaseVersion = '0.2.0';
  output.releaseEnvelope.identity.releaseVersion =
    output.identity.releaseVersion;

  assert.throws(() =>
    assertAcceptanceContinuation(record, { release, runIdentity }),
  );
});

test('continuation rejects workerd runtime evidence outside the native release cohort', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  changeRuntimeReport(record, 'workerd', report => {
    const app = report.evidence['release-identity'].apps.find(
      app => app.appId === 'inventory',
    );
    for (const surface of Object.values(app.surfaces)) {
      surface.moduleFederation = [
        { packageName: '@module-federation/runtime', version: '2.8.1' },
      ];
    }
  });

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /Module Federation cohort differs from the exact release cohort/u,
  );
});

test('continuation rejects different native renderer identity tuples between targets', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  const output = record.runtimeOutputs.workerd.find(
    output => output.appId === 'inventory',
  );
  output.rendererManifest.identities.main.protocolVersion = 2;
  output.releaseEnvelope.ui.rendererIdentity.protocolVersion = 2;
  output.rendererManifest.profile.protocolVersion = 2;
  output.releaseEnvelope.ui.rendererProfile.protocolVersion = 2;

  assert.throws(() =>
    assertAcceptanceContinuation(record, { release, runIdentity }),
  );
});

test('continuation rejects different native compiler profiles between targets', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  const output = record.runtimeOutputs.workerd.find(
    output => output.appId === 'inventory',
  );
  output.rendererManifest.profile.compiler.version = '2.2.0';
  output.releaseEnvelope.ui.rendererProfile.compiler.version = '2.2.0';

  assert.throws(() =>
    assertAcceptanceContinuation(record, { release, runIdentity }),
  );
});

test('continuation rejects different native router providers between targets', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  const output = record.runtimeOutputs.workerd.find(
    output => output.appId === 'inventory',
  );
  for (const bindings of [
    output.rendererManifest.routerBindings,
    output.releaseEnvelope.ui.routerBindings,
  ]) {
    bindings.main.defaultProvider.version = '1.170.40';
    bindings.main.providers[0].version = '1.170.40';
  }

  assert.throws(() =>
    assertAcceptanceContinuation(record, { release, runIdentity }),
  );
});

test('continuation preserves all SDK packages while proving the runtime package', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({
      moduleFederationDependencies: sdkModuleFederationDependencies,
    });

  assert.equal(
    assertAcceptanceContinuation(record, { release, runIdentity }),
    record,
  );
  assert.deepEqual(
    record.binding.artifacts.moduleFederation,
    Object.keys(sdkModuleFederationDependencies)
      .sort((left, right) => left.localeCompare(right))
      .map(packageName => ({ packageName, version: '2.9.1' })),
  );
  const runtimeCohort = [
    { packageName: '@module-federation/runtime', version: '2.9.1' },
  ];
  for (const platform of ['node', 'workerd']) {
    const report = JSON.parse(record.runtimeReports[platform].text);
    for (const app of report.evidence['release-identity'].apps) {
      for (const surface of Object.values(app.surfaces)) {
        assert.deepEqual(surface.moduleFederation, runtimeCohort);
      }
    }
    for (const app of record.binding.runtimeIdentity[platform]) {
      assert.deepEqual(app.moduleFederation, runtimeCohort);
    }
  }
});

test('continuation rejects an observed runtime outside the authenticated SDK cohort', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({
      moduleFederationDependencies: sdkModuleFederationDependencies,
    });
  changeRuntimeReport(record, 'node', report => {
    const app = report.evidence['release-identity'].apps.find(
      app => app.appId === 'inventory',
    );
    for (const surface of Object.values(app.surfaces)) {
      surface.moduleFederation = [
        { packageName: '@module-federation/runtime', version: '2.9.2' },
      ];
    }
  });

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /Module Federation cohort differs from the exact release cohort/u,
  );
});

test('continuation rejects a full SDK cohort with no authenticated runtime package', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { createReleaseArtifactBinding } = await import(
    '../published-create-proof/acceptance-contract.mjs'
  );
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({
      moduleFederationDependencies: sdkModuleFederationDependencies,
    });
  delete release.packages[0].packageJson.dependencies[
    '@module-federation/runtime'
  ];
  record.binding.artifacts = createReleaseArtifactBinding(release);

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /runtime/u,
  );
});

test('continuation still rejects changed SDK tooling in the full artifact binding', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture({
      moduleFederationDependencies: sdkModuleFederationDependencies,
    });
  const changedRelease = structuredClone(release);
  changedRelease.packages[0].packageJson.dependencies[
    '@module-federation/dts-plugin'
  ] = 'npm:@bleedingdev/mf-dts-plugin@2.9.2';

  assert.throws(
    () =>
      assertAcceptanceContinuation(record, {
        release: changedRelease,
        runIdentity,
      }),
    /artifacts differs from the current release/u,
  );
});

test('continuation rejects a different current release source commit', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  const changedRelease = structuredClone(release);
  changedRelease.source.commit = 'd'.repeat(40);

  assert.throws(
    () =>
      assertAcceptanceContinuation(record, {
        release: changedRelease,
        runIdentity,
      }),
    /source differs from the current release/u,
  );
});

test('continuation rejects changed candidate tarball bytes', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  const changedRelease = structuredClone(release);
  changedRelease.packages[0].integrity = `sha512-${crypto
    .createHash('sha512')
    .update('different candidate tarball')
    .digest('base64')}`;

  assert.throws(
    () =>
      assertAcceptanceContinuation(record, {
        release: changedRelease,
        runIdentity,
      }),
    /artifacts differs from the current release/u,
  );
});

test('continuation cannot turn the reused build into another passing stage', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  record.results.unshift({
    id: 'build',
    status: 'pass',
    details: { durationMs: 1 },
  });

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /only its twenty remaining stages/u,
  );
});

test('continuation rejects a missing remaining stage', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  record.results = record.results.filter(result => result.id !== 'backend');

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /only its twenty remaining stages/u,
  );
});

test('continuation rejects a non-finite stage duration', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  record.results.find(
    result => result.id === 'cloudflare-build',
  ).details.durationMs = Number.NaN;

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /incomplete or failed stages/u,
  );
});

test('continuation rejects a negative stage duration', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  record.results.find(result => result.id === 'node-ssr').details.durationMs =
    -1;

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /incomplete or failed stages/u,
  );
});

test('continuation rejects a partial Node report even with fresh byte references', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  changeRuntimeReport(record, 'node', report => {
    report.results.find(result => result.appId === 'inventory').status = 'fail';
  });

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /runtime report must prove all retained targets/u,
  );
});

test('continuation rejects changed report bytes before consuming the report', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  record.runtimeReports.node.text = record.runtimeReports.node.text.replace(
    '"inventory"',
    '"inventorz"',
  );
  assert.equal(
    Buffer.byteLength(record.runtimeReports.node.text),
    record.runtimeReports.node.byteLength,
  );

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /runtime report reference is invalid/u,
  );
});

test('continuation rejects a retained envelope for a different target', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  record.reusedEvidence.nodeOutputs[1].releaseEnvelope.target = 'cloudflare';

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /retained Node output conflicts with finalized native identity/u,
  );
});

test('continuation rejects a renderer marker that differs from the retained envelope', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  record.reusedEvidence.nodeOutputs[1].rendererManifest.buildMarker =
    'e'.repeat(64);

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /retained Node output conflicts with finalized native identity/u,
  );
});

test('continuation rejects a retained native output from another application commit', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  record.reusedEvidence.nodeOutputs[1].rendererManifest.sourceRevision =
    'd'.repeat(40);

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /retained Node output conflicts with finalized native identity/u,
  );
});

test('continuation rejects a recorded assertion count that differs from its raw report', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  record.results.find(
    result => result.id === 'workerd-backend',
  ).details.assertionCount += 1;

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /workerd-backend differs from its actual runtime report/u,
  );
});

test('continuation rejects changed raw dimension counts with fresh byte references', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  changeRuntimeReport(record, 'node', report => {
    report.evidence.backend.assertions.pop();
  });

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /node-backend differs from its actual runtime report/u,
  );
});

test('continuation rejects a Node browser marker from another native build', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  changeRuntimeReport(record, 'node', report => {
    const result = report.results.find(result => result.appId === 'inventory');
    result.assertions.find(
      assertion => assertion.type === 'browser-ui-marker',
    ).actual = 'e'.repeat(64);
  });

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /Node HTTP\/browser evidence differs from its retained native output/u,
  );
});

test('continuation rejects a prior build attributed to another project', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  record.reusedEvidence.priorRunLog.attribution.projectDirectory = path.resolve(
    'different-retained-project',
  );

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /prior evidence attribution is incomplete/u,
  );
});

test('continuation rejects a prior build attributed to another application commit', async () => {
  const { assertAcceptanceContinuation } = await import(continuationModule);
  const { record, release, runIdentity } =
    await createAcceptanceContinuationFixture();
  record.reusedEvidence.priorRunLog.attribution.applicationSourceRevision =
    'd'.repeat(40);

  assert.throws(
    () => assertAcceptanceContinuation(record, { release, runIdentity }),
    /prior evidence attribution is incomplete/u,
  );
});

test('continuation policy environment restores the accepted install settings without changing the project', async t => {
  const { readInstalledPolicyEnvironment } = await import(continuationModule);
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'acceptance-continuation-policy-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const statePath = path.join(
    root,
    'node_modules/.pnpm-workspace-state-v1.json',
  );
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const settings = {
    minimumReleaseAge: 1440,
    minimumReleaseAgeStrict: true,
    minimumReleaseAgeIgnoreMissingTime: false,
    trustPolicy: 'no-downgrade',
    enableGlobalVirtualStore: false,
    minimumReleaseAgeExclude: [
      '@bleedingdev/modern-js-ultramodern-create@3.4.0-ultramodern.1',
      '@bleedingdev/runtime-sidecar@1.2.3',
    ],
    trustPolicyExclude: ['@fixture/already-installed@4.5.6'],
  };
  const stateText = JSON.stringify({ settings });
  fs.writeFileSync(statePath, stateText);

  assert.deepEqual(
    readInstalledPolicyEnvironment(root, {
      PATH: '/accepted/node/bin',
      PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE: '["foreign@1.0.0"]',
      npm_config_trust_policy_exclude: '["foreign@1.0.0"]',
      pnpm_config_minimum_release_age_exclude: '["foreign@1.0.0"]',
    }),
    {
      PATH: '/accepted/node/bin',
      CI: 'true',
      pnpm_config_pm_on_fail: 'ignore',
      pnpm_config_minimum_release_age: '1440',
      pnpm_config_minimum_release_age_strict: 'true',
      pnpm_config_minimum_release_age_ignore_missing_time: 'false',
      pnpm_config_minimum_release_age_exclude: JSON.stringify(
        settings.minimumReleaseAgeExclude,
      ),
      pnpm_config_trust_policy_exclude: JSON.stringify(
        settings.trustPolicyExclude,
      ),
      pnpm_config_trust_policy: 'no-downgrade',
      pnpm_config_enable_global_virtual_store: 'false',
    },
  );
  assert.equal(fs.readFileSync(statePath, 'utf8'), stateText);
});

test('continuation policy environment requires both installed exclusion arrays', async t => {
  const { readInstalledPolicyEnvironment } = await import(continuationModule);
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'acceptance-continuation-invalid-policy-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const statePath = path.join(
    root,
    'node_modules/.pnpm-workspace-state-v1.json',
  );
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(
    statePath,
    JSON.stringify({ settings: { minimumReleaseAgeExclude: [] } }),
  );

  assert.throws(
    () => readInstalledPolicyEnvironment(root),
    /Continuation requires the original strict pnpm install settings/u,
  );
});
