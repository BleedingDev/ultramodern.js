const crypto = require('node:crypto');
const fs = require('node:fs');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function canonicalSerialize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalSerialize).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`)
    .join(',')}}`;
}

const defaultOptions = {
  apps: {
    changed: 'inventory',
    shell: 'shell-super-app',
    sibling: 'finance',
  },
  identity: {
    baselineRevision: '1'.repeat(40),
    changedRevision: '2'.repeat(40),
    releaseVersion: '0.1.0',
    runtimeReleaseVersion: '0.1.0',
    runtimeSourceRevision: '1'.repeat(40),
  },
  mutations: {
    apiResponse: {
      path: 'verticals/inventory/api/index.ts',
      value: 'Inventory C1 operational proof response',
    },
    uiLocalization: {
      path: 'verticals/inventory/locales/en/inventory.json',
      value:
        'C1 operational independence: inventory UI and localization moved together.',
    },
  },
  ownerPath: 'verticals/inventory',
  verticalCount: 10,
};

function fixtureOptions(overrides) {
  return {
    ...defaultOptions,
    ...overrides,
    apps: { ...defaultOptions.apps, ...overrides.apps },
    identity: { ...defaultOptions.identity, ...overrides.identity },
    mutations: {
      apiResponse: {
        ...defaultOptions.mutations.apiResponse,
        ...overrides.mutations?.apiResponse,
      },
      uiLocalization: {
        ...defaultOptions.mutations.uiLocalization,
        ...overrides.mutations?.uiLocalization,
      },
    },
  };
}

function operationalDetails(receipt, evidencePath, options) {
  const { identity, mutations } = options;
  const beforeIdentity = {
    buildMarker: `${options.apps.changed}-before`,
    releaseVersion: identity.releaseVersion,
    sourceRevision: identity.baselineRevision,
    unitId: `acceptance/${options.apps.changed}`,
  };
  const afterIdentity = {
    ...beforeIdentity,
    buildMarker: `${options.apps.changed}-after`,
    sourceRevision: identity.changedRevision,
  };
  const target = platform => {
    const changed = {
      afterIdentity,
      afterTreeDigest: digest(`${platform}-${options.apps.changed}-after`),
      beforeIdentity,
      beforeTreeDigest: digest(`${platform}-${options.apps.changed}-before`),
      surfaces: Object.fromEntries(
        ['uiClient', 'ssr', 'apiBackend', 'backendFederation'].map(surface => [
          surface,
          {
            afterDigest: digest(`${platform}-${surface}-after`),
            beforeDigest: digest(`${platform}-${surface}-before`),
            changed: true,
          },
        ]),
      ),
    };
    const runtimePlatform = platform === 'cloudflare' ? 'workerd' : 'node';
    return {
      changed,
      shell: {
        byteIdentical: true,
        envelopeIdentical: true,
        treeDigest: digest(`${platform}-${options.apps.shell}`),
      },
      sibling: {
        byteIdentical: true,
        envelopeIdentical: true,
        treeDigest: digest(`${platform}-${options.apps.sibling}`),
      },
      servedBehavior: {
        appId: options.apps.changed,
        baseUrls: {
          app: `http://127.0.0.1/${runtimePlatform}/${options.apps.changed}`,
          shell: `http://127.0.0.1/${runtimePlatform}/${options.apps.shell}`,
        },
        identity: {
          build: afterIdentity.buildMarker,
          buildMarker: afterIdentity.buildMarker,
          sourceRevision: afterIdentity.sourceRevision,
          unitId: afterIdentity.unitId,
          version: afterIdentity.releaseVersion,
        },
        platform: runtimePlatform,
        result: 'pass',
        routes: {
          api: `/${options.apps.changed}-api/${options.apps.changed}`,
          ssr: '/en',
          ui: '/en',
        },
        responses: {
          api: {
            bodySha256: digest(`${platform}-api-body`),
            contentType: 'application/json',
            status: 200,
            value: mutations.apiResponse.value,
          },
          ssr: {
            bodySha256: digest(`${platform}-ssr-body`),
            buildMarker: afterIdentity.buildMarker,
            contentType: 'text/html',
            status: 200,
          },
          ui: {
            bodySha256: digest(`${platform}-ui-body`),
            boundaryId: 'verticalInventory',
            contentType: 'text/html',
            expose: './Widget',
            status: 200,
            value: mutations.uiLocalization.value,
            visiblyRendered: true,
          },
        },
      },
    };
  };
  return {
    artifactMode: receipt.mode,
    baselineRevision: identity.baselineRevision,
    changedPaths: [mutations.apiResponse.path, mutations.uiLocalization.path],
    changedRevision: identity.changedRevision,
    crossTargetIdentity: afterIdentity,
    durationMs: 1,
    evidenceDigest: '0'.repeat(64),
    evidenceFileSha256: '0'.repeat(64),
    evidencePath,
    mutations,
    selectedApps: options.apps,
    targets: {
      cloudflare: target('cloudflare'),
      node: target('node'),
    },
  };
}

function operationalEvidence(details, options) {
  const target = platform => {
    const summary = details.targets[platform];
    return {
      comparison: {
        target: platform,
        changed: {
          ...summary.changed,
          changed: true,
        },
        shell: summary.shell,
        sibling: summary.sibling,
      },
      servedBehavior: summary.servedBehavior,
    };
  };
  const evidence = {
    schemaVersion: 1,
    kind: 'ultramodern-operational-independence-proof',
    commits: {
      baseline: details.baselineRevision,
      changed: details.changedRevision,
      changedPaths: details.changedPaths,
      ownerPath: options.ownerPath,
    },
    apps: {
      shell: { id: details.selectedApps.shell },
      changed: { id: details.selectedApps.changed },
      sibling: { id: details.selectedApps.sibling },
    },
    targets: {
      node: target('node'),
      cloudflare: target('cloudflare'),
    },
    crossTarget: {
      equal: true,
      identity: details.crossTargetIdentity,
    },
    result: 'pass',
  };
  evidence.evidenceDigest = digest(canonicalSerialize(evidence));
  return evidence;
}

async function createOperationalAcceptanceReceiptFixture({
  evidencePath,
  overrides = {},
  receipt,
  receiptApi,
}) {
  const options = fixtureOptions(overrides);
  const runtimeIdentity = Object.fromEntries(
    ['node', 'workerd'].map(platform => [
      platform,
      Array.from({ length: options.verticalCount }, (_, index) => ({
        appId: `vertical-${index + 1}`,
        buildMarker: `marker-${index + 1}`,
        moduleFederation: receipt.binding.artifacts.moduleFederation,
        releaseVersion: options.identity.runtimeReleaseVersion,
        sourceRevision: options.identity.runtimeSourceRevision,
      })),
    ]),
  );
  for (const id of receipt.profile.requiredResults) {
    const runtime =
      /^(?<platform>node|workerd)-(?<dimension>ssr|browser-mf|api|backend|backend-driven-ui|failure-isolation|release-identity)$/u.exec(
        id,
      )?.groups;
    await receiptApi.recordAcceptanceResult(receipt, id, async () =>
      id === 'operational-independence'
        ? operationalDetails(receipt, evidencePath, options)
        : runtime
          ? {
              artifactMode: receipt.mode,
              assertionCount: 1,
              dimension: runtime.dimension,
              durationMs: 0,
              platform: runtime.platform,
              ...(runtime.dimension === 'release-identity'
                ? { apps: runtimeIdentity[runtime.platform] }
                : {}),
            }
          : { id },
    );
  }
  receiptApi.bindRuntimeIdentityEvidence(receipt, runtimeIdentity);
  receiptApi.finalizeAcceptanceReceipt(receipt);

  const operationalResult = receipt.results.find(
    result => result.id === 'operational-independence',
  );
  let evidenceSource;
  if (operationalResult) {
    const details = operationalResult.details;
    const evidence = operationalEvidence(details, options);
    evidenceSource = `${JSON.stringify(evidence, null, 2)}\n`;
    details.evidenceDigest = evidence.evidenceDigest;
    details.evidenceFileSha256 = digest(evidenceSource);
    fs.writeFileSync(evidencePath, evidenceSource);
  }

  return {
    evidencePath: operationalResult ? evidencePath : undefined,
    evidenceSource,
    runtimeIdentity,
  };
}

module.exports = { createOperationalAcceptanceReceiptFixture };
