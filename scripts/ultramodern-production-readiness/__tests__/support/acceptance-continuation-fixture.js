const crypto = require('node:crypto');
const path = require('node:path');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function reportDescriptor(projectDirectory, platform, report, provenance) {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  return {
    path: path.join(projectDirectory, 'reports', `${platform}-summary.json`),
    sha256: sha256(text),
    byteLength: Buffer.byteLength(text),
    text,
    provenance,
  };
}

function fileDescriptor(filePath, text) {
  return {
    path: filePath,
    byteLength: Buffer.byteLength(text),
    sha256: sha256(text),
  };
}

async function createAcceptanceContinuationFixture({
  cursor = 'source-node',
  projectDirectory = path.resolve(__dirname, 'retained-erp-10'),
  nodeReportProvenance = 'external-report',
  moduleFederationDependencies = { '@module-federation/runtime': '2.8.0' },
  workerdBuildMarkers = {},
  cloudflareBuildCompleted = false,
} = {}) {
  const {
    assertRuntimeAcceptanceDimension,
    createReleaseArtifactBinding,
    runtimeAcceptanceDimensions,
    runtimeIdentityBinding,
  } = await import('../../published-create-proof/acceptance-contract.mjs');
  const {
    acceptanceContinuationSchema,
    createRuntimeArtifactBinding,
    requiredContinuationResultIds,
  } = await import('../../published-create-proof/acceptance-continuation.mjs');
  const { readableErpVerticalNames } = await import(
    '../../published-create-proof/constants.mjs'
  );
  const {
    parsePriorCloudflareBuildAttribution,
    parsePriorNodeBuildAttribution,
  } = await import('../../published-create-proof/source-node-attribution.mjs');
  const applicationSourceRevision = 'a'.repeat(40);
  const packageName = '@bleedingdev/modern-js-ultramodern-create';
  const releaseVersion = '3.4.0-ultramodern.1';
  const packageIntegrity = `sha512-${crypto
    .createHash('sha512')
    .update('continuation candidate tarball')
    .digest('base64')}`;
  const release = {
    source: {
      commit: 'b'.repeat(40),
      repository: 'BleedingDev/ultramodern.js',
    },
    release: { tag: 'latest', version: releaseVersion },
    manifestSha256: sha256('continuation candidate manifest'),
    cohortDigest: sha256('continuation candidate cohort'),
    packages: [
      {
        sourceName: '@modern-js/ultramodern-create',
        targetName: packageName,
        version: releaseVersion,
        integrity: packageIntegrity,
        packageJson: {
          name: packageName,
          version: releaseVersion,
          dependencies: { ...moduleFederationDependencies },
        },
      },
    ],
  };
  const runIdentity = 'github:BleedingDev/ultramodern.js:run:321:attempt:1';
  const verticals = [...readableErpVerticalNames];
  const appIds = ['shell-super-app', ...verticals];
  const artifacts = createReleaseArtifactBinding(release);
  const runtimeArtifacts = createRuntimeArtifactBinding(artifacts);
  const apps = appIds.map(appId => ({
    id: appId,
    kind: appId === 'shell-super-app' ? 'shell' : 'vertical',
    path: appId === 'shell-super-app' ? 'apps/shell' : `verticals/${appId}`,
    buildScript: `pnpm --dir ../.. exec ultramodern-create ultramodern public-surface --app ${appId} --target dist --sync-route-metadata && ultramodern build && pnpm --dir ../.. exec ultramodern-create ultramodern public-surface --app ${appId} --target dist && cross-env MODERNJS_DEPLOY=node ultramodern deploy --skip-build`,
  }));
  const nodeOutputs = apps.map(app => {
    const identity = {
      buildMarker: sha256(`finalized native build for ${app.id}`),
      sourceRevision: applicationSourceRevision,
      releaseVersion: '0.1.0',
      unitId: `acceptance/${app.id}`,
    };
    const rendererProfile = {
      renderer: 'react',
      protocolVersion: 1,
      compiler: { name: '@rsbuild/plugin-react', version: '2.1.0' },
      hydration: { name: 'react-dom', version: '19.3.0' },
      router: {
        name: 'react-router',
        version: '7.18.4',
        coreName: 'react-router',
        coreVersion: '7.18.4',
      },
    };
    const provider = {
      framework: 'tanstack',
      name: '@tanstack/react-router',
      version: '1.170.39',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.32',
    };
    const routerBindings = {
      main: {
        owner: '@modern-js/plugin-tanstack',
        evidence: 'file-routes',
        defaultProvider: { ...provider },
        providers: [{ ...provider }],
      },
    };
    const rendererIdentity = {
      renderer: 'react',
      protocolVersion: 1,
      appId: app.id,
      entryName: 'main',
      buildId: identity.buildMarker,
    };
    return {
      appId: app.id,
      path: app.path,
      rendererManifestPath: 'renderer-build.json',
      identity,
      rendererManifest: {
        schema: 'ultramodern-renderer-build',
        version: 1,
        buildMarker: identity.buildMarker,
        sourceRevision: applicationSourceRevision,
        inputDigest: sha256(`${app.id} inputs`),
        profileDigest: sha256(`${app.id} renderer profile`),
        compilerDigest: sha256(`${app.id} compiler`),
        frameworkCohortDigest: release.cohortDigest,
        profile: structuredClone(rendererProfile),
        routerBindings: structuredClone(routerBindings),
        cacheAllowed: true,
        promotable: true,
        identities: {
          main: { ...rendererIdentity },
        },
      },
      releaseEnvelope: {
        schemaVersion: 5,
        target: 'node',
        identity: { ...identity },
        ui: {
          rendererIdentity: { ...rendererIdentity },
          rendererProfile: structuredClone(rendererProfile),
          routerBindings: structuredClone(routerBindings),
        },
      },
    };
  });
  const workerdOutputs = nodeOutputs.map(nodeOutput => {
    const output = structuredClone(nodeOutput);
    const buildMarker =
      workerdBuildMarkers[output.appId] ?? output.identity.buildMarker;
    output.identity.buildMarker = buildMarker;
    output.rendererManifest.buildMarker = buildMarker;
    output.rendererManifest.identities.main.buildId = buildMarker;
    output.rendererManifestPath = 'public/renderer-build.json';
    output.releaseEnvelope.target = 'cloudflare';
    output.releaseEnvelope.identity.buildMarker = buildMarker;
    output.releaseEnvelope.ui.rendererIdentity.buildId = buildMarker;
    return output;
  });
  const runtimeReports = {};
  const runtimeDetails = new Map();
  const identityDetails = new Map();
  for (const platform of ['node', 'workerd']) {
    const outputsByAppId = new Map(
      (platform === 'node' ? nodeOutputs : workerdOutputs).map(output => [
        output.appId,
        output,
      ]),
    );
    const results = appIds.map((appId, index) => {
      const marker = outputsByAppId.get(appId).identity.buildMarker;
      return {
        appId,
        baseUrl: `http://127.0.0.1:${4100 + index}/`,
        status: 'pass',
        assertions: [
          'ui-marker-html',
          'browser-ui-marker',
          'no-js-ssr-ui-marker',
        ].map(type => ({
          appId,
          type,
          status: 'pass',
          actual: marker,
          expected: marker,
        })),
      };
    });
    const evidence = Object.fromEntries(
      runtimeAcceptanceDimensions.map(dimension => [
        dimension,
        {
          artifactMode: 'source',
          platform,
          status: 'pass',
          verticalIds: [...verticals],
          assertions: verticals.map(appId => ({
            appId,
            type: `${dimension}-app-coverage`,
            status: 'pass',
          })),
          ...(dimension === 'release-identity'
            ? {
                apps: verticals.map(appId => {
                  const identity = {
                    buildMarker: outputsByAppId.get(appId).identity.buildMarker,
                    sourceRevision: applicationSourceRevision,
                    releaseVersion: '0.1.0',
                    moduleFederation: runtimeArtifacts.moduleFederation,
                  };
                  return {
                    appId,
                    surfaces: Object.fromEntries(
                      ['frontend', 'ssr', 'api', 'backend'].map(surface => [
                        surface,
                        { ...identity },
                      ]),
                    ),
                  };
                }),
              }
            : {}),
        },
      ]),
    );
    const report = {
      schemaVersion: 1,
      mode: 'local',
      artifactMode: 'source',
      matrixId: `${platform}-full-stack`,
      platform,
      shellRuntime: platform,
      projectDir: projectDirectory,
      targetRuntimes: Object.fromEntries(
        appIds.map(appId => [appId, platform]),
      ),
      status: 'pass',
      skipped: [],
      results,
      evidence,
    };
    runtimeReports[platform] = reportDescriptor(
      projectDirectory,
      platform,
      report,
      platform === 'node' ? nodeReportProvenance : 'executed-here',
    );
    for (const dimension of runtimeAcceptanceDimensions) {
      const details = assertRuntimeAcceptanceDimension(report, {
        applicationSourceRevision,
        artifactBinding: runtimeArtifacts,
        dimension,
        mode: 'source',
        platform,
        release,
        verticals,
      });
      runtimeDetails.set(`${platform}-${dimension}`, details);
      if (dimension === 'release-identity')
        identityDetails.set(platform, details);
    }
  }

  const rootBuildScript =
    'pnpm -r --filter "./verticals/*" run build && pnpm --filter "./apps/shell" run build && pnpm mf:types && pnpm performance:readiness';
  const priorLines = [
    `Initialized empty Git repository in ${projectDirectory}/.git/`,
    `[main (root-commit) ${applicationSourceRevision.slice(0, 7)}] test: snapshot generated ERP-10 application source`,
    `$ ${rootBuildScript}`,
  ];
  for (const app of apps.filter(app => app.kind === 'vertical')) {
    priorLines.push(
      `${app.path} build$ ${app.buildScript}`,
      `${app.path} build: Static directory: .output/static`,
      `${app.path} build: You can preview this build by node .output/index`,
      `${app.path} build: Done`,
    );
  }
  const shell = apps.find(app => app.kind === 'shell');
  priorLines.push(
    `$ ${shell.buildScript}`,
    'Static directory: .output/static',
    'You can preview this build by node .output/index',
    '$ ultramodern-create ultramodern mf-types',
    '$ ultramodern-create ultramodern performance-readiness',
  );
  const priorLogText = `${priorLines.join('\n')}\n`;
  const operationalDetails = {
    artifactMode: 'source',
    baselineRevision: applicationSourceRevision,
    changedRevision: 'c'.repeat(40),
    changedPaths: [
      'verticals/inventory/api/index.ts',
      'verticals/inventory/locales/en/inventory.json',
    ],
    evidencePath: path.join(projectDirectory, 'operational-independence.json'),
    durationMs: 1,
    mutations: {
      apiResponse: {
        path: 'verticals/inventory/api/index.ts',
        value: 'Inventory C1 operational proof response',
      },
      uiLocalization: {
        path: 'verticals/inventory/locales/en/inventory.json',
        value: 'Inventory C1 UI and localization proof response',
      },
    },
  };
  const record = {
    schema: acceptanceContinuationSchema,
    schemaVersion: 1,
    generatedAt: '2026-10-04T00:00:00.000Z',
    mode: 'source',
    cursor,
    status: 'passed',
    passed: true,
    error: null,
    binding: {
      source: { ...release.source },
      release: { ...release.release },
      manifest: {
        sha256: release.manifestSha256,
        cohortDigest: release.cohortDigest,
        packageCount: release.packages.length,
      },
      artifacts,
      profile: { id: 'erp-10', version: 1 },
      runIdentity,
      applicationSourceRevision,
      runtimeIdentity: runtimeIdentityBinding(
        identityDetails.get('node'),
        identityDetails.get('workerd'),
      ),
    },
    reusedEvidence: {
      projectDirectory,
      applicationSourceRevision,
      priorRunLog: {
        path: path.join(projectDirectory, 'prior-run.log'),
        sha256: sha256(priorLogText),
        byteLength: Buffer.byteLength(priorLogText),
        text: priorLogText,
        attribution: parsePriorNodeBuildAttribution(priorLogText, {
          projectDir: projectDirectory,
          applicationSourceRevision,
          rootBuildScript,
          apps,
        }),
      },
      installedCohort: {
        expectedPackageCount: release.packages.length,
        observedPackageCount: release.packages.length,
        observedSourceNames: release.packages.map(item => item.sourceName),
      },
      nodeOutputs,
    },
    runtimeReports,
    runtimeOutputs: { workerd: workerdOutputs },
    results: requiredContinuationResultIds(cursor).map(id => ({
      id,
      status: 'pass',
      details:
        id === 'operational-independence'
          ? operationalDetails
          : { ...runtimeDetails.get(id), durationMs: 1 },
    })),
  };
  if (cursor === 'source-workerd') {
    const cloudflareApps = apps.map(app => ({
      ...app,
      buildScript: `pnpm --dir ../.. exec ultramodern-create ultramodern public-surface --app ${app.id} --target cloudflare-dist --sync-route-metadata && cross-env MODERNJS_DEPLOY=cloudflare ultramodern build && pnpm --dir ../.. exec ultramodern-create ultramodern public-surface --app ${app.id} --target cloudflare-dist && cross-env MODERNJS_DEPLOY=cloudflare ultramodern deploy --skip-build && ultramodern-create ultramodern cloudflare-output-verify --app ${app.id}`,
    }));
    const rootCloudflareBuildScript =
      'pnpm -r --filter "./verticals/*" run cloudflare:build && pnpm --filter "./apps/shell" run cloudflare:build && pnpm mf:types --target cloudflare && pnpm cloudflare-output:verify && pnpm cloudflare:ssr-proof';
    const cloudflareLines = cloudflareBuildCompleted
      ? [
          ...priorLines,
          '[ultramodern-browser-smoke] pass: source-node-summary.json',
          `$ ${rootCloudflareBuildScript}`,
        ]
      : [`$ ${rootCloudflareBuildScript}`];
    for (const app of cloudflareApps.filter(app => app.kind === 'vertical')) {
      cloudflareLines.push(
        `${app.path} cloudflare:build$ ${app.buildScript}`,
        `${app.path} cloudflare:build: [ultramodern] Cloudflare output verified: ${app.id}`,
        `${app.path} cloudflare:build: Done`,
      );
    }
    const cloudflareShell = cloudflareApps.find(app => app.kind === 'shell');
    cloudflareLines.push(
      `$ ${cloudflareShell.buildScript}`,
      'ready built in 0.1s (server)',
      'ready built in 0.2s (workerSSR)',
      'ready built in 0.3s (client)',
    );
    if (cloudflareBuildCompleted) {
      cloudflareLines.push(
        '[ultramodern] Cloudflare output verified: shell-super-app',
        '$ ultramodern-create ultramodern mf-types --target cloudflare',
        '$ ultramodern-create ultramodern cloudflare-output-verify',
        ...cloudflareApps.map(
          app => `[ultramodern] Cloudflare output verified: ${app.id}`,
        ),
        '$ ultramodern-create ultramodern cloudflare-ssr-proof',
        `Workerd SSR composition proof passed for 1 shell(s): ${projectDirectory}/.codex/reports/cloudflare-workerd-ssr/composition-proof.json`,
        '[ultramodern-browser-smoke] fail: source-workerd-summary.json',
      );
    } else {
      cloudflareLines.push(
        'error Error: [ultramodern-release-envelope] UI-only application emitted an undeclared API/backend artifact.',
        'ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL Command failed with exit code 1',
      );
    }
    const cloudflareLogText = `${cloudflareLines.join('\n')}\n`;
    const cloudflareLog = {
      ...fileDescriptor(
        path.join(projectDirectory, 'prior-cloudflare-run.log'),
        cloudflareLogText,
      ),
      text: cloudflareLogText,
      attribution: parsePriorCloudflareBuildAttribution(cloudflareLogText, {
        projectDir: projectDirectory,
        applicationSourceRevision,
        rootBuildScript: rootCloudflareBuildScript,
        apps: cloudflareApps,
      }),
    };
    const shellOutput = workerdOutputs.find(
      output => output.appId === 'shell-super-app',
    );
    const appDirectory = path.join(projectDirectory, shellOutput.path);
    const distDirectory = path.join(appDirectory, 'dist-cloudflare');
    const outputDirectory = path.join(appDirectory, '.output');
    const stageDirectory = path.join(
      projectDirectory,
      'node_modules/@modern-js/app-tools-extensions',
    );
    const sdkDirectory = path.join(
      projectDirectory,
      'node_modules/@modern-js/ultramodern-app-tools',
    );
    const descriptors = {
      candidateManifest: fileDescriptor(
        path.join(projectDirectory, 'release/manifest.json'),
        'continuation candidate manifest',
      ),
      priorNodeReport: fileDescriptor(
        record.runtimeReports.node.path,
        record.runtimeReports.node.text,
      ),
      originalCloudflareLog: fileDescriptor(
        cloudflareLog.path,
        cloudflareLog.text,
      ),
      rendererBuild: fileDescriptor(
        path.join(distDirectory, 'renderer-build.json'),
        JSON.stringify(shellOutput.rendererManifest),
      ),
      sourceEnvelope: fileDescriptor(
        path.join(distDirectory, 'release/microvertical-release-envelope.json'),
        JSON.stringify(shellOutput.releaseEnvelope),
      ),
      outputEnvelope: fileDescriptor(
        path.join(
          outputDirectory,
          'release/microvertical-release-envelope.json',
        ),
        JSON.stringify(shellOutput.releaseEnvelope),
      ),
      workerManifest: fileDescriptor(
        path.join(outputDirectory, 'server/modern-worker-manifest.json'),
        JSON.stringify({ deliveryUnit: shellOutput.identity }),
      ),
      workerEntry: fileDescriptor(
        path.join(outputDirectory, 'server/index.mjs'),
        'export default { fetch() {} };\n',
      ),
      wrangler: fileDescriptor(
        path.join(outputDirectory, 'wrangler.json'),
        JSON.stringify({ main: './server/index.mjs' }),
      ),
    };
    const shellFinalization = {
      schemaVersion: 1,
      kind: 'ultramodern-cloudflare-shell-finalization',
      status: 'pass',
      appId: shellOutput.appId,
      projectDirectory,
      appDirectory,
      distDirectory,
      outputDirectory,
      target: 'cloudflare',
      identity: { ...shellOutput.identity },
      originalBuildSucceeded: false,
      compilerReplayed: false,
      inputCandidate: {
        sourceRevision: release.source.commit,
        cohortDigest: release.cohortDigest,
        manifestSha256: release.manifestSha256,
      },
      descriptors,
      command: {
        executable: process.execPath,
        argv: [
          path.resolve(
            __dirname,
            '../../../../.codex/plan-graphs/renderer-agnostic-20261002/run-c31-preserved-cloudflare-shell-stage.mjs',
          ),
          '--project',
          projectDirectory,
          '--manifest',
          descriptors.candidateManifest.path,
          '--prior-node-report',
          descriptors.priorNodeReport.path,
          '--original-cloudflare-log',
          descriptors.originalCloudflareLog.path,
          '--result',
          path.resolve(projectDirectory, '../shell-finalization/result.json'),
        ],
        nativeConfigurationArgv: [
          process.execPath,
          'ultramodern',
          'deploy',
          '--skip-build',
        ],
        actions: [
          'createRunOptions',
          'createNativeConfigLoad',
          'createCli.init(deploy --skip-build)',
          'emitFrameworkMicroVerticalReleaseEnvelope',
          'verifyBuildOutputReleaseEnvelope',
          'createCloudflarePreset.prepare',
          'createCloudflarePreset.writeOutput',
          'createCloudflarePreset.genEntry',
          'verifyCloudflareOutput',
          'verifyCloudflareReleaseEnvelopeStaging',
          'onBeforeExit',
          'createCli.dispose',
        ],
      },
      configLoad: {
        configFile: path.join(appDirectory, 'modern.config.ts'),
        cliEntry: fileDescriptor(
          path.join(sdkDirectory, 'dist/cjs/cli/index.js'),
          'native SDK CLI fixture',
        ),
        nativeLoadEntry: fileDescriptor(
          path.join(sdkDirectory, 'dist/cjs/native-config-load/index.js'),
          'native config loader fixture',
        ),
        pluginEntry: fileDescriptor(
          path.join(
            projectDirectory,
            'node_modules/@modern-js/plugin/dist/cjs/cli/index.js',
          ),
          'native plugin CLI fixture',
        ),
        plugins: ['@modern-js/ultramodern-release-envelope'],
      },
      stageOwner: {
        packageName: '@modern-js/app-tools-extensions',
        version: releaseVersion,
        packageDirectory: stageDirectory,
        modules: [
          'cloudflare/index.js',
          'release-envelope/framework-output.js',
          'cloudflare-output-verifier/index.js',
        ].map(modulePath =>
          fileDescriptor(
            path.join(stageDirectory, 'dist/cjs', modulePath),
            `public owning module fixture: ${modulePath}`,
          ),
        ),
      },
      cleanup: {
        nativeOnBeforeExit: 'fulfilled',
        cliDisposed: true,
        environmentRestored: true,
        preservedCallerWork: true,
      },
    };
    record.reusedEvidence.cloudflare = {
      priorRunLog: cloudflareLog,
      ...(cloudflareBuildCompleted
        ? {}
        : {
            shellFinalization: {
              ...reportDescriptor(
                projectDirectory,
                'shell-finalization',
                shellFinalization,
                'external-report',
              ),
              path: path.resolve(
                projectDirectory,
                '../shell-finalization/result.json',
              ),
            },
          }),
      outputs: workerdOutputs,
    };
    record.results.find(
      result => result.id === 'cloudflare-output',
    ).details.originalAggregateBuildSucceeded = cloudflareBuildCompleted;
  }
  return { record, release, runIdentity };
}

module.exports = { createAcceptanceContinuationFixture };
