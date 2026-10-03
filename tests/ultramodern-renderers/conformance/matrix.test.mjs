import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  applicationIdentityKey,
  assertConformanceReceipt,
  conformanceMatrix,
  renderers,
} from '../../../scripts/ultramodern-renderers/acceptance/matrix.mts';

const identity = {
  sourceRevision: 'a'.repeat(40),
  profileDigest: 'b'.repeat(64),
  artifactDigests: ['c'.repeat(64)],
  hmrPolicies: {
    react: 'preserved',
    solid: 'may-reset',
    octane: 'may-reset',
  },
  applicationIdentities: Object.fromEntries(
    conformanceMatrix.map(row => {
      const key = applicationIdentityKey(row);
      return [
        key,
        {
          renderer: row.renderer,
          appId: `unit-${row.renderer}-${row.kind}`,
          entryName: row.dimension === 'csr' ? 'csr' : 'ssr',
          protocolVersion: 1,
          buildId: createHash('sha256').update(key).digest('hex'),
        },
      ];
    }),
  ),
};

function observations(dimension, environment, renderer) {
  const consoleErrors = [];
  if (dimension === 'csr') {
    return {
      consoleErrors,
      serverMarkerCount: 0,
      clientMarkerCount: 1,
      bootstrapCount: 1,
    };
  }
  if (dimension === 'navigation') {
    return {
      consoleErrors,
      documentBefore: 'same-document',
      documentAfter: 'same-document',
      nativeLink: true,
      urlBefore: '/home',
      urlAfter: '/about',
      historyBackUrl: '/home',
      historyForwardUrl: '/about',
      sourceMarker: 'Home route',
      destinationMarker: 'About route',
      expectedDestinationMarker: 'About route',
    };
  }
  if (dimension === 'data')
    return {
      consoleErrors,
      loaderValue: 'private-loader-value',
      expectedLoaderValue: 'private-loader-value',
      deferredCriticalVisible: true,
      nativeDeferredLink: true,
      deferredPendingVisible: true,
      deferredLateVisible: true,
      deferredLateBeforeRelease: '',
      deferredControlBeforeRelease: {
        released: false,
        activeRequests: 1,
        cleanupCount: 0,
        cancelled: false,
      },
      deferredControlAfterRelease: {
        released: true,
        activeRequests: 0,
        cleanupCount: 1,
        cancelled: false,
      },
      deferredDomCompletion: {
        lateSeenAt: 20,
        releaseDispatchedAt: 10,
        orderingClock: 'observed-browser-and-node-Date.now-ms',
      },
      deferredDocumentBefore: 'same-document',
      deferredDocumentAfter: 'same-document',
      deferredDocumentContinuityObserved: true,
      deferredTransport:
        renderer === 'react' ? 'react-modernjs-deferred' : 'native-data',
      deferredResponseStatus: 200,
      deferredResponseContentType:
        renderer === 'react'
          ? 'text/modernjs-deferred; charset=UTF-8'
          : 'application/vnd.ultramodern.data-stream+json; charset=utf-8',
      deferredNavigationUrl:
        'https://unit.test/ssr/?case=deferred&conformanceId=unit-native-link',
      deferredRequestUrl:
        'https://unit.test/ssr/?case=deferred&conformanceId=unit-native-link&__loader=page',
      notFoundStatus: 404,
      notFoundMarker: 'Native not found',
      thrownErrorMarker: 'Native route error',
      serverOnlyDataModulePresent: false,
    };
  if (dimension === 'action')
    return {
      consoleErrors,
      nativeForm: true,
      requestMethod: 'POST',
      submittedValue: 'typed-name',
      expectedSubmittedValue: 'typed-name',
      resultValue: 'saved-name',
      expectedResultValue: 'saved-name',
      validationStatus: 422,
      validationMarker: 'Name required',
      redirectTransportStatus: renderer === 'react' ? 204 : 200,
      redirectProtocol: renderer === 'react' ? 'react-header' : 'native-data',
      ...(renderer === 'react' ? {} : { redirectOutcomeStatus: 303 }),
      redirectTarget: '/about',
      redirectBeforeUrl: 'https://unit.test/form',
      redirectAfterUrl: 'https://unit.test/about',
      documentBefore: 'same-document',
      documentAfter: 'same-document',
      ...(renderer === 'solid'
        ? {
            submitterBaseHref: 'https://unit.test/items/',
            submitterFormAction: '99?intent=alternate',
            submitterRequestUrl:
              'https://unit.test/items/99?intent=alternate&__loader=items%2F%5Bid%5D%2Fpage',
            submitterFormIntent: 'alternate',
            submitterBoundRouteId: 'items/[id]/page',
          }
        : {}),
    };
  if (dimension === 'head-assets')
    return {
      consoleErrors,
      titleAfterNavigation: 'About conformance',
      expectedTitle: 'About conformance',
      computedStyleAfterNavigation: 'rgb(10, 20, 30)',
      expectedComputedStyle: 'rgb(10, 20, 30)',
      stylesheetCount: 2,
      uniqueStylesheetCount: 2,
      titleBeforeNavigation: 'Home conformance',
      titleNodeCount: 1,
      descriptionNodeCount: 1,
      descriptionAfterNavigation: 'Native renderer conformance',
      expectedDescription: 'Native renderer conformance',
      stylesheetUrls: [
        'https://unit.test/main.css',
        'https://unit.test/lazy.css',
      ],
      compiledStylesheetUrls: [
        'https://unit.test/main.css',
        'https://unit.test/lazy.css',
        'https://unit.test/unloaded-route.css',
      ],
      requiredStartupStylesheetUrls: [],
      compiledStylesheetAssets: [
        {
          href: 'https://unit.test/main.css',
          sha256: 'a'.repeat(64),
          size: 100,
        },
        {
          href: 'https://unit.test/lazy.css',
          sha256: 'b'.repeat(64),
          size: 200,
        },
        {
          href: 'https://unit.test/unloaded-route.css',
          sha256: 'c'.repeat(64),
          size: 300,
        },
      ],
      stylesheetSetWithinCompiledClosure: true,
      observedStylesheets: [
        {
          href: 'https://unit.test/main.css',
          loaded: true,
          sha256: 'a'.repeat(64),
          size: 100,
          status: 200,
          contentType: 'text/css',
        },
        {
          href: 'https://unit.test/lazy.css',
          loaded: true,
          sha256: 'b'.repeat(64),
          size: 200,
          status: 200,
          contentType: 'text/css; charset=utf-8',
        },
      ],
      ...(renderer === 'solid'
        ? {
            lazyCSSSemanticFacts: {
              visible: true,
              borderInlineStartWidth: '2px',
              paddingInlineStart: '16px',
              rootFontSize: '16px',
              paddingMatchesRootFontSize: true,
              authenticatedStylesheetUrls: ['https://unit.test/lazy.css'],
            },
            lazyCSSObservedStylesheets: [
              {
                href: 'https://unit.test/lazy.css',
                loaded: true,
                sha256: 'b'.repeat(64),
                size: 200,
                status: 200,
                contentType: 'text/css',
              },
            ],
          }
        : {}),
    };
  if (dimension === 'hydration') {
    return {
      consoleErrors,
      nodeBefore: 'server-node',
      nodeAfter: 'server-node',
      hydrated: true,
      bootstrapCount: 1,
    };
  }
  if (dimension === 'hmr') {
    if (environment === 'production') {
      return {
        consoleErrors,
        hmrClientPresent: false,
        hmrSocketCount: 0,
        activeRootCount: 1,
      };
    }
    return {
      consoleErrors,
      statePolicy: identity.hmrPolicies[renderer],
      stateBefore: 7,
      stateAfter: renderer === 'solid' ? 0 : 7,
      expectedInitialState: 0,
      unaffectedStateBefore: 'unchanged-router-state',
      unaffectedStateAfter: 'unchanged-router-state',
      documentBefore: 'same-document',
      documentAfter: 'same-document',
      nativeUpdate: true,
      updatedMarkerBefore: 'before-source-update',
      sourceBeforeSha256: 'd'.repeat(64),
      sourceAfterSha256: 'e'.repeat(64),
      updatedMarker: 'changed-source',
      activeRootCount: 1,
      activeResourceCount: 2,
      expectedActiveResourceCount: 2,
      unaffectedResourceCleanupCount: 0,
      oldResourceCleanupCount: 1,
    };
  }
  return { assertionCount: 1 };
}

// Synthetic receipts below test rejection rules, not renderer capabilities.
function unitReceipt() {
  return {
    schemaVersion: 1,
    identity,
    evidence: conformanceMatrix.flatMap(specification =>
      (specification.proof === 'http-and-browser'
        ? ['http-driver', 't3-preview']
        : [specification.proof === 'http' ? 'http-driver' : 't3-preview']
      ).map(producer => ({
        ...identity,
        caseId: specification.id,
        producer,
        observations:
          producer === 'http-driver'
            ? { assertionCount: 1 }
            : {
                rendererIdentity: {
                  ...identity.applicationIdentities[
                    applicationIdentityKey(specification)
                  ],
                },
                ...observations(
                  specification.dimension,
                  specification.environment,
                  specification.renderer,
                ),
              },
      })),
    ),
    capabilities: renderers.flatMap(renderer =>
      ['worker', 'module-federation', 'rsc'].map(capability => ({
        ...identity,
        renderer,
        capability,
        disposition: renderer === 'react' ? 'supported' : 'unsupported',
        diagnostic:
          renderer === 'react'
            ? undefined
            : `Use an admitted ${capability} profile.`,
        evidenceId: `unit-only:${renderer}:${capability}`,
        observations: {
          assertionCount: 1,
          diagnosticCode: 'unsupported-renderer-capability',
          beforeRendererSetup: true,
          runtime: 'workerd',
          fetchStatus: 200,
          dispatchForms: ['fetch-export', 'request-handler'],
          hostRenderer: renderer,
          remoteRenderer: renderer,
          remoteInvocationCount: 1,
          ssrRendered: true,
          hydrated: true,
          protocolStatus: 200,
          contentType: 'text/x-component',
          reactRscLoaded: true,
          responseChunks: 1,
        },
      })),
    ),
  };
}

test('matrix requires every renderer in development and production', () => {
  assert.equal(conformanceMatrix.length, 120);
  assert.equal(new Set(conformanceMatrix.map(row => row.id)).size, 120);
  assert.equal(Object.keys(identity.applicationIdentities).length, 24);
  assert.deepEqual(assertConformanceReceipt(unitReceipt(), identity), {
    caseCount: 120,
    proofCount: 156,
    capabilityCount: 9,
  });
});

test('deferred browser data requires a controlled real native link, pending DOM and one producer cleanup', () => {
  for (const [field, value] of [
    ['nativeDeferredLink', false],
    ['deferredPendingVisible', false],
    ['deferredLateBeforeRelease', 'already-settled'],
    ['deferredDocumentAfter', 'new-document'],
    [
      'deferredControlBeforeRelease',
      { released: false, activeRequests: 0, cleanupCount: 0, cancelled: false },
    ],
    [
      'deferredControlAfterRelease',
      { released: true, activeRequests: 0, cleanupCount: 2, cancelled: false },
    ],
    [
      'deferredDomCompletion',
      {
        lateSeenAt: 5,
        releaseDispatchedAt: 10,
        orderingClock: 'observed-browser-and-node-Date.now-ms',
      },
    ],
    [
      'deferredDomCompletion',
      {
        lateSeenAt: 10,
        releaseDispatchedAt: 10,
        orderingClock: 'observed-browser-and-node-Date.now-ms',
      },
    ],
    ['deferredResponseContentType', 'text/html'],
    ['deferredResponseContentType', undefined],
    [
      'deferredRequestUrl',
      'https://unit.test/ssr/?case=deferred&conformanceId=unit-native-link',
    ],
    [
      'deferredRequestUrl',
      'https://unit.test/ssr/?case=stream&conformanceId=unit-native-link',
    ],
    [
      'deferredRequestUrl',
      'https://unit.test/ssr/?case=deferred&conformanceId=foreign',
    ],
    ['deferredTransport', 'unrecognized-json'],
  ]) {
    const receipt = unitReceipt();
    receipt.evidence.find(
      row =>
        row.caseId === 'react:generated:production:data' &&
        row.producer === 't3-preview',
    ).observations[field] = value;
    assert.throws(
      () => assertConformanceReceipt(receipt, identity),
      /data requires|data deferred/u,
    );
  }
});

test('a missing proof or duplicate proof cannot certify a candidate', () => {
  const missing = unitReceipt();
  missing.evidence.pop();
  assert.throws(
    () => assertConformanceReceipt(missing, identity),
    /incomplete/,
  );
  const duplicate = unitReceipt();
  duplicate.evidence.push(duplicate.evidence[0]);
  assert.throws(
    () => assertConformanceReceipt(duplicate, identity),
    /duplicate/,
  );
});

test('evidence from another artifact, source or profile is rejected', () => {
  for (const field of ['sourceRevision', 'profileDigest', 'artifactDigests']) {
    const receipt = unitReceipt();
    receipt.evidence[0] = {
      ...receipt.evidence[0],
      [field]:
        field === 'artifactDigests'
          ? ['d'.repeat(64)]
          : 'd'.repeat(field === 'sourceRevision' ? 40 : 64),
    };
    assert.throws(
      () => assertConformanceReceipt(receipt, identity),
      /exact candidate/,
    );
  }
});

test('HTTP configuration evidence cannot stand in for a browser', () => {
  const receipt = unitReceipt();
  receipt.evidence.find(row => row.caseId.endsWith(':navigation')).producer =
    'http-driver';
  assert.throws(
    () => assertConformanceReceipt(receipt, identity),
    /browser observations/,
  );
});

test('document replacement and broken browser history fail native navigation', () => {
  for (const [field, value] of [
    ['documentAfter', 'new-document'],
    ['historyBackUrl', '/wrong'],
  ]) {
    const receipt = unitReceipt();
    receipt.evidence.find(row =>
      row.caseId.endsWith(':navigation'),
    ).observations[field] = value;
    assert.throws(
      () => assertConformanceReceipt(receipt, identity),
      /document continuity/,
    );
  }
});

test('replaced SSR nodes, duplicate roots and lost HMR state fail', () => {
  for (const [dimension, field, value] of [
    ['hydration', 'nodeAfter', 'new-node'],
    ['csr', 'bootstrapCount', 2],
    ['hmr', 'stateAfter', 0],
  ]) {
    const receipt = unitReceipt();
    receipt.evidence.find(row =>
      row.caseId.endsWith(`:${dimension}`),
    ).observations[field] = value;
    assert.throws(
      () => assertConformanceReceipt(receipt, identity),
      /requires/,
    );
  }
});

test('current React platform capabilities cannot be removed', () => {
  const receipt = unitReceipt();
  receipt.capabilities[0].disposition = 'unsupported';
  assert.throws(
    () => assertConformanceReceipt(receipt, identity),
    /React.*remain required/,
  );
});

test('unsupported native capabilities require executed early-rejection evidence', () => {
  const receipt = unitReceipt();
  const native = receipt.capabilities.find(row => row.renderer === 'solid');
  native.observations.beforeRendererSetup = false;
  assert.throws(
    () => assertConformanceReceipt(receipt, identity),
    /before renderer setup/,
  );
});

test('native HMR requires an actual edit, noninitial state, and preserved surrounding state', () => {
  for (const [field, value] of [
    ['updatedMarker', 'before-source-update'],
    ['sourceAfterSha256', 'd'.repeat(64)],
    ['stateBefore', 0],
    ['stateAfter', 3],
    ['unaffectedStateAfter', 'lost-router-state'],
    ['oldResourceCleanupCount', 2],
    ['activeResourceCount', 3],
    ['unaffectedResourceCleanupCount', 1],
    ['expectedInitialState', undefined],
  ]) {
    const receipt = unitReceipt();
    const hmr = receipt.evidence.find(
      row => row.caseId === 'solid:hand-authored:development:hmr',
    );
    hmr.observations[field] = value;
    assert.throws(
      () => assertConformanceReceipt(receipt, identity),
      /HMR requires/,
    );
  }
});

test('native may-reset policy admits either native retention or initial-state replacement', () => {
  for (const stateAfter of [0, 7]) {
    const receipt = unitReceipt();
    receipt.evidence.find(
      row => row.caseId === 'solid:hand-authored:development:hmr',
    ).observations.stateAfter = stateAfter;
    assert.doesNotThrow(() => assertConformanceReceipt(receipt, identity));
  }
});

test('Solid submitter overrides use the actual document base and canonical action authorization', () => {
  for (const [field, value] of [
    ['submitterBaseHref', 'https://unit.test/wrong/'],
    [
      'submitterRequestUrl',
      'https://unit.test/current/99?intent=alternate&__loader=items%2F%5Bid%5D%2Fpage',
    ],
    ['submitterBoundRouteId', 'another-route'],
    ['submitterFormIntent', ''],
  ]) {
    const receipt = unitReceipt();
    receipt.evidence.find(
      row =>
        row.caseId === 'solid:hand-authored:development:action' &&
        row.producer === 't3-preview',
    ).observations[field] = value;
    assert.throws(
      () => assertConformanceReceipt(receipt, identity),
      /Solid.*submitter/u,
    );
  }
});

test('browser evidence cannot be relabeled across application builds', () => {
  const receipt = unitReceipt();
  const browser = receipt.evidence.find(
    row => row.caseId === 'solid:hand-authored:development:csr',
  );
  browser.observations.rendererIdentity =
    identity.applicationIdentities['solid:generated:production:ssr'];
  assert.throws(
    () => assertConformanceReceipt(receipt, identity),
    /actual application build/,
  );
});

test('native head keeps unique metadata and authentic loaded subset, permitting empty startup and unloaded compiled lazy routes', () => {
  assert.doesNotThrow(() => assertConformanceReceipt(unitReceipt(), identity));
  for (const [field, value] of [
    ['stylesheetCount', 3],
    ['uniqueStylesheetCount', 1],
    ['requiredStartupStylesheetUrls', ['https://unit.test/unloaded-route.css']],
    [
      'compiledStylesheetAssets',
      [
        {
          href: 'https://unit.test/main.css',
          sha256: 'd'.repeat(64),
          size: 100,
        },
        {
          href: 'https://unit.test/lazy.css',
          sha256: 'b'.repeat(64),
          size: 200,
        },
        {
          href: 'https://unit.test/unloaded-route.css',
          sha256: 'c'.repeat(64),
          size: 300,
        },
      ],
    ],
    ['titleNodeCount', 2],
    ['descriptionNodeCount', 2],
    ['descriptionAfterNavigation', 'stale description'],
    ['titleBeforeNavigation', 'About conformance'],
    ['stylesheetSetWithinCompiledClosure', false],
    [
      'observedStylesheets',
      [
        { href: 'https://unit.test/main.css', loaded: true },
        { href: 'https://unit.test/lazy.css', loaded: false },
      ],
    ],
    [
      'observedStylesheets',
      [
        { href: 'https://unit.test/main.css', loaded: true },
        { href: 'https://unit.test/main.css', loaded: true },
      ],
    ],
    [
      'stylesheetUrls',
      ['https://unit.test/main.css', 'https://unit.test/foreign.css'],
    ],
  ]) {
    const receipt = unitReceipt();
    receipt.evidence.find(
      row =>
        row.caseId === 'solid:hand-authored:development:head-assets' &&
        row.producer === 't3-preview',
    ).observations[field] = value;
    assert.throws(
      () => assertConformanceReceipt(receipt, identity),
      /head|stylesheet/u,
    );
  }
});

test('Solid lazy CSS cannot pass from a selector marker without loaded bytes and actual style semantics', () => {
  for (const patch of [
    { visible: false },
    { borderInlineStartWidth: '0px' },
    { paddingInlineStart: '0px' },
    { authenticatedStylesheetUrls: ['https://unit.test/foreign.css'] },
  ]) {
    const receipt = unitReceipt();
    const value = receipt.evidence.find(
      row =>
        row.caseId === 'solid:hand-authored:development:head-assets' &&
        row.producer === 't3-preview',
    ).observations;
    Object.assign(value.lazyCSSSemanticFacts, patch);
    assert.throws(
      () => assertConformanceReceipt(receipt, identity),
      /lazy CSS/u,
    );
  }
  for (const patch of [
    { sha256: 'd'.repeat(64) },
    { size: 199 },
    { status: 404 },
    { contentType: 'text/html' },
    { loaded: false },
  ]) {
    const receipt = unitReceipt();
    const value = receipt.evidence.find(
      row =>
        row.caseId === 'solid:hand-authored:development:head-assets' &&
        row.producer === 't3-preview',
    ).observations;
    Object.assign(value.lazyCSSObservedStylesheets[0], patch);
    assert.throws(
      () => assertConformanceReceipt(receipt, identity),
      /lazy CSS/u,
    );
  }
});

test('browser redirects preserve renderer-native wire semantics and navigate to their actual target', () => {
  for (const renderer of ['react', 'solid', 'octane']) {
    const positive = unitReceipt();
    assert.doesNotThrow(() => assertConformanceReceipt(positive, identity));
    for (const [field, value] of [
      ['redirectTransportStatus', renderer === 'react' ? 303 : 204],
      [
        'redirectProtocol',
        renderer === 'react' ? 'native-data' : 'react-header',
      ],
      ['redirectTarget', '/wrong-target'],
      ['redirectTarget', 'https://foreign.test/about'],
      ['redirectAfterUrl', 'https://unit.test/unchanged'],
      ['redirectOutcomeStatus', renderer === 'react' ? 303 : 302],
    ]) {
      const receipt = unitReceipt();
      receipt.evidence.find(
        row =>
          row.caseId === `${renderer}:hand-authored:development:action` &&
          row.producer === 't3-preview',
      ).observations[field] = value;
      assert.throws(
        () => assertConformanceReceipt(receipt, identity),
        /action.*redirect|action requires/u,
      );
    }
  }
});

test('a hydrated SSR entry cannot substitute for the actual CSR entry', () => {
  const receipt = unitReceipt();
  receipt.evidence.find(
    row => row.caseId === 'solid:hand-authored:development:csr',
  ).observations.rendererIdentity =
    identity.applicationIdentities['solid:hand-authored:development:ssr'];
  assert.throws(
    () => assertConformanceReceipt(receipt, identity),
    /actual application build/u,
  );
});

test('native navigation must render its destination and browser data/action/head proofs are mandatory', () => {
  const oldRoute = unitReceipt();
  oldRoute.evidence.find(row =>
    row.caseId.endsWith(':navigation'),
  ).observations.destinationMarker = 'Home route';
  assert.throws(
    () => assertConformanceReceipt(oldRoute, identity),
    /native links/,
  );
  for (const dimension of ['data', 'action', 'head-assets']) {
    const missing = unitReceipt();
    const index = missing.evidence.findIndex(
      row =>
        row.producer === 't3-preview' && row.caseId.endsWith(`:${dimension}`),
    );
    missing.evidence.splice(index, 1);
    assert.throws(
      () => assertConformanceReceipt(missing, identity),
      /incomplete/,
    );
  }
});

test('native replacement state policy compares actual structured values', () => {
  const receipt = unitReceipt();
  const hmr = receipt.evidence.find(
    row => row.caseId === 'solid:hand-authored:development:hmr',
  );
  hmr.observations.stateBefore = { counter: 7 };
  hmr.observations.expectedInitialState = { counter: 0 };
  hmr.observations.stateAfter = { counter: 0 };
  hmr.observations.unaffectedStateBefore = {
    route: '/about',
    search: { preserved: true },
  };
  hmr.observations.unaffectedStateAfter = {
    route: '/about',
    search: { preserved: true },
  };
  assert.equal(assertConformanceReceipt(receipt, identity).caseCount, 120);
});

test('generic positive capability counts cannot substitute for runtime outcomes', () => {
  for (const capability of ['worker', 'module-federation', 'rsc']) {
    const receipt = unitReceipt();
    const row = receipt.capabilities.find(
      value => value.renderer === 'react' && value.capability === capability,
    );
    row.observations = { assertionCount: 99 };
    assert.throws(
      () => assertConformanceReceipt(receipt, identity),
      /support requires/,
    );
  }
});
