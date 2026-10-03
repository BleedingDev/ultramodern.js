import { isDeepStrictEqual } from 'node:util';

export const renderers = ['react', 'solid', 'octane'] as const;
export const environments = ['development', 'production'] as const;
export const consumerKinds = ['generated', 'hand-authored'] as const;
export const dimensions = [
  'csr',
  'ssr',
  'stream',
  'navigation',
  'data',
  'action',
  'head-assets',
  'abort',
  'hmr',
  'hydration',
] as const;

export type Renderer = (typeof renderers)[number];
export type Environment = (typeof environments)[number];
export type ConsumerKind = (typeof consumerKinds)[number];
export type Dimension = (typeof dimensions)[number];
export type Proof = 'http' | 'browser' | 'http-and-browser';
export type PlatformCapability = 'worker' | 'module-federation' | 'rsc';
export type HmrStatePolicy = 'preserved' | 'may-reset';

export interface ConformanceCase {
  readonly id: string;
  readonly renderer: Renderer;
  readonly environment: Environment;
  readonly kind: ConsumerKind;
  readonly dimension: Dimension;
  readonly proof: Proof;
}

const browserDimensions = new Set<Dimension>([
  'csr',
  'navigation',
  'hmr',
  'hydration',
]);
const combinedDimensions = new Set<Dimension>([
  'data',
  'action',
  'head-assets',
]);

export const conformanceMatrix: readonly ConformanceCase[] = renderers.flatMap(
  renderer =>
    consumerKinds.flatMap(kind =>
      environments.flatMap(environment =>
        dimensions.map<ConformanceCase>(dimension => ({
          id: `${renderer}:${kind}:${environment}:${dimension}`,
          renderer,
          kind,
          environment,
          dimension,
          proof: combinedDimensions.has(dimension)
            ? 'http-and-browser'
            : browserDimensions.has(dimension)
              ? 'browser'
              : 'http',
        })),
      ),
    ),
);

export interface CapabilityDisposition extends CandidateIdentity {
  readonly renderer: Renderer;
  readonly capability: PlatformCapability;
  readonly disposition: 'supported' | 'unsupported';
  readonly diagnostic?: string;
  readonly evidenceId: string;
  readonly observations: Readonly<Record<string, unknown>>;
}

export interface ConformanceEvidence extends CandidateIdentity {
  readonly caseId: string;
  readonly sourceRevision: string;
  readonly profileDigest: string;
  readonly artifactDigests: readonly string[];
  readonly producer: 'http-driver' | 't3-preview' | 'browser-test';
  readonly observations: Readonly<Record<string, unknown>>;
}

export interface CandidateIdentity {
  readonly sourceRevision: string;
  readonly profileDigest: string;
  readonly artifactDigests: readonly string[];
  readonly hmrPolicies: Readonly<Record<Renderer, HmrStatePolicy>>;
  readonly applicationIdentities: Readonly<
    Record<string, RendererApplicationIdentity>
  >;
}

export interface RendererApplicationIdentity {
  readonly renderer: Renderer;
  readonly appId: string;
  readonly entryName: string;
  readonly protocolVersion: 1;
  readonly buildId: string;
}

export function applicationIdentityKey(specification: ConformanceCase) {
  const mode = specification.dimension === 'csr' ? 'csr' : 'ssr';
  return `${specification.renderer}:${specification.kind}:${specification.environment}:${mode}`;
}

export interface ConformanceReceipt {
  readonly schemaVersion: 1;
  readonly identity: CandidateIdentity;
  readonly evidence: readonly ConformanceEvidence[];
  readonly capabilities: readonly CapabilityDisposition[];
}

function fail(message: string): never {
  throw new Error(`renderer-acceptance: ${message}`);
}

function sameDigests(actual: readonly string[], expected: readonly string[]) {
  return (
    actual.length === expected.length &&
    [...actual]
      .sort()
      .every((digest, index) => digest === [...expected].sort()[index])
  );
}

function assertIdentity(
  actual: CandidateIdentity,
  expected: CandidateIdentity,
) {
  if (
    actual?.sourceRevision !== expected.sourceRevision ||
    actual?.profileDigest !== expected.profileDigest ||
    !Array.isArray(actual?.artifactDigests) ||
    !sameDigests(actual.artifactDigests, expected.artifactDigests) ||
    renderers.some(
      renderer =>
        actual.hmrPolicies?.[renderer] !== expected.hmrPolicies?.[renderer],
    ) ||
    !isDeepStrictEqual(
      actual.applicationIdentities,
      expected.applicationIdentities,
    )
  ) {
    fail('evidence does not belong to the exact candidate');
  }
}

function controlledProducer(value: unknown, released: boolean) {
  return (
    value !== null &&
    typeof value === 'object' &&
    'released' in value &&
    value.released === released &&
    'activeRequests' in value &&
    value.activeRequests === (released ? 0 : 1) &&
    'cleanupCount' in value &&
    value.cleanupCount === (released ? 1 : 0) &&
    'cancelled' in value &&
    value.cancelled === false
  );
}

function deferredCompletion(value: unknown) {
  return (
    value !== null &&
    typeof value === 'object' &&
    'lateSeenAt' in value &&
    typeof value.lateSeenAt === 'number' &&
    Number.isFinite(value.lateSeenAt) &&
    'releaseDispatchedAt' in value &&
    typeof value.releaseDispatchedAt === 'number' &&
    Number.isFinite(value.releaseDispatchedAt) &&
    value.lateSeenAt > value.releaseDispatchedAt &&
    'orderingClock' in value &&
    value.orderingClock === 'observed-browser-and-node-Date.now-ms'
  );
}

function assertBrowserObservation(
  specification: ConformanceCase,
  value: Record<string, unknown>,
  expected: CandidateIdentity,
) {
  const { dimension, environment } = specification;
  const applicationIdentity =
    expected.applicationIdentities[applicationIdentityKey(specification)];
  if (
    !applicationIdentity ||
    !isDeepStrictEqual(value.rendererIdentity, applicationIdentity)
  )
    fail(
      `${dimension} browser observations do not belong to the actual application build`,
    );
  if (!Array.isArray(value.consoleErrors) || value.consoleErrors.length !== 0) {
    fail(`${dimension} requires an observed empty browser error list`);
  }
  if (dimension === 'csr') {
    if (
      value.serverMarkerCount !== 0 ||
      value.clientMarkerCount !== 1 ||
      value.bootstrapCount !== 1
    ) {
      fail(
        'CSR requires empty server content and exactly one observed client root',
      );
    }
  } else if (dimension === 'navigation') {
    if (
      typeof value.documentBefore !== 'string' ||
      !value.documentBefore ||
      value.documentBefore !== value.documentAfter ||
      value.nativeLink !== true ||
      typeof value.urlBefore !== 'string' ||
      typeof value.urlAfter !== 'string' ||
      value.urlBefore === value.urlAfter ||
      value.historyBackUrl !== value.urlBefore ||
      value.historyForwardUrl !== value.urlAfter ||
      typeof value.destinationMarker !== 'string' ||
      !value.destinationMarker ||
      value.destinationMarker !== value.expectedDestinationMarker ||
      value.destinationMarker === value.sourceMarker
    ) {
      fail(
        'navigation requires native links, document continuity and browser history',
      );
    }
  } else if (dimension === 'hydration') {
    if (
      typeof value.nodeBefore !== 'string' ||
      !value.nodeBefore ||
      value.nodeBefore !== value.nodeAfter ||
      value.hydrated !== true ||
      value.bootstrapCount !== 1
    ) {
      fail(
        'hydration requires preserved server DOM and exactly one observed bootstrap',
      );
    }
  } else if (dimension === 'data') {
    if (
      typeof value.loaderValue !== 'string' ||
      !value.loaderValue ||
      value.loaderValue !== value.expectedLoaderValue ||
      value.deferredCriticalVisible !== true ||
      value.nativeDeferredLink !== true ||
      value.deferredPendingVisible !== true ||
      value.deferredLateVisible !== true ||
      value.deferredLateBeforeRelease !== '' ||
      !controlledProducer(value.deferredControlBeforeRelease, false) ||
      !controlledProducer(value.deferredControlAfterRelease, true) ||
      !deferredCompletion(value.deferredDomCompletion) ||
      typeof value.deferredDocumentBefore !== 'string' ||
      !value.deferredDocumentBefore ||
      value.deferredDocumentBefore !== value.deferredDocumentAfter ||
      value.deferredDocumentContinuityObserved !== true ||
      value.deferredTransport !==
        (specification.renderer === 'react'
          ? 'react-modernjs-deferred'
          : 'native-data') ||
      value.deferredResponseStatus !== 200 ||
      typeof value.deferredResponseContentType !== 'string' ||
      !(
        specification.renderer === 'react'
          ? /^text\/modernjs-deferred(?:;|$)/iu
          : /^application\/vnd\.ultramodern\.data-stream\+json(?:;|$)/iu
      ).test(value.deferredResponseContentType) ||
      typeof value.deferredNavigationUrl !== 'string' ||
      typeof value.deferredRequestUrl !== 'string' ||
      value.notFoundStatus !== 404 ||
      typeof value.notFoundMarker !== 'string' ||
      !value.notFoundMarker ||
      typeof value.thrownErrorMarker !== 'string' ||
      !value.thrownErrorMarker ||
      value.serverOnlyDataModulePresent !== false
    )
      fail(
        'data requires browser loader/deferred values, native error UI and server-only module isolation',
      );
    try {
      const navigation = new URL(value.deferredNavigationUrl);
      const request = new URL(value.deferredRequestUrl);
      if (
        !['http:', 'https:'].includes(navigation.protocol) ||
        navigation.origin !== request.origin ||
        navigation.pathname !== request.pathname ||
        navigation.searchParams.get('case') !== 'deferred' ||
        request.searchParams.get('case') !== 'deferred' ||
        !request.searchParams.get('__loader') ||
        !navigation.searchParams.get('conformanceId') ||
        navigation.searchParams.get('conformanceId') !==
          request.searchParams.get('conformanceId')
      )
        fail(
          'data deferred navigation must use the actual query-bearing native link and controlled request',
        );
    } catch {
      fail(
        'data deferred navigation requires actual absolute browser/request URLs',
      );
    }
  } else if (dimension === 'action') {
    if (
      value.nativeForm !== true ||
      value.requestMethod !== 'POST' ||
      typeof value.submittedValue !== 'string' ||
      !value.submittedValue ||
      value.submittedValue !== value.expectedSubmittedValue ||
      value.resultValue !== value.expectedResultValue ||
      typeof value.resultValue !== 'string' ||
      !value.resultValue ||
      value.validationStatus !== 422 ||
      typeof value.validationMarker !== 'string' ||
      !value.validationMarker ||
      value.redirectProtocol !==
        (specification.renderer === 'react' ? 'react-header' : 'native-data') ||
      value.redirectTransportStatus !==
        (specification.renderer === 'react' ? 204 : 200) ||
      (specification.renderer === 'react'
        ? value.redirectOutcomeStatus !== undefined
        : value.redirectOutcomeStatus !== 303) ||
      typeof value.redirectTarget !== 'string' ||
      !value.redirectTarget ||
      typeof value.redirectBeforeUrl !== 'string' ||
      typeof value.redirectAfterUrl !== 'string' ||
      value.redirectBeforeUrl === value.redirectAfterUrl ||
      typeof value.documentBefore !== 'string' ||
      !value.documentBefore ||
      value.documentBefore !== value.documentAfter
    )
      fail(
        'action requires native form submission, rendered result/validation and document-preserving redirect',
      );
    try {
      const before = new URL(value.redirectBeforeUrl);
      const after = new URL(value.redirectAfterUrl);
      const target = new URL(value.redirectTarget, before);
      if (
        !['http:', 'https:'].includes(before.protocol) ||
        target.origin !== before.origin ||
        target.href !== after.href
      )
        fail(
          'action redirect must navigate to its actual native protocol target',
        );
    } catch {
      fail('action redirect requires actual absolute browser URLs');
    }
    if (specification.renderer === 'solid') {
      if (
        typeof value.submitterBaseHref !== 'string' ||
        typeof value.submitterRequestUrl !== 'string' ||
        value.submitterFormAction !== '99?intent=alternate' ||
        value.submitterFormIntent !== 'alternate' ||
        typeof value.submitterBoundRouteId !== 'string' ||
        !value.submitterBoundRouteId
      )
        fail(
          'Solid action requires a real relative native submitter and document base',
        );
      let base: URL;
      let actual: URL;
      try {
        base = new URL(value.submitterBaseHref);
        actual = new URL(value.submitterRequestUrl);
      } catch {
        fail(
          'Solid native submitter observations must contain actual absolute URLs',
        );
      }
      const target = new URL(value.submitterFormAction, base);
      if (
        !['http:', 'https:'].includes(base.protocol) ||
        !base.pathname.endsWith('/items/') ||
        actual.origin !== target.origin ||
        actual.pathname !== target.pathname ||
        actual.searchParams.get('intent') !== 'alternate' ||
        actual.searchParams.get('__loader') !== value.submitterBoundRouteId
      )
        fail(
          'Solid relative native submitter must POST to the browser base-resolved authorized route',
        );
    }
  } else if (dimension === 'head-assets') {
    const stylesheetUrls = value.stylesheetUrls;
    const compiledUrls = value.compiledStylesheetUrls;
    const startupUrls = value.requiredStartupStylesheetUrls;
    const compiledAssets = value.compiledStylesheetAssets;
    const observedStyles = value.observedStylesheets;
    const uniqueUrls = (urls: unknown): urls is string[] =>
      Array.isArray(urls) &&
      new Set(urls).size === urls.length &&
      urls.every(url => {
        if (typeof url !== 'string' || !url) return false;
        try {
          return ['http:', 'https:'].includes(new URL(url).protocol);
        } catch {
          return false;
        }
      });
    const actualStyle = (style: unknown): style is Record<string, unknown> =>
      !!style &&
      typeof style === 'object' &&
      'href' in style &&
      typeof style.href === 'string' &&
      'sha256' in style &&
      typeof style.sha256 === 'string' &&
      /^[a-f0-9]{64}$/u.test(style.sha256) &&
      'size' in style &&
      Number.isSafeInteger(style.size) &&
      Number(style.size) > 0;
    const authenticatedStyles = (styles: unknown) =>
      Array.isArray(styles) &&
      uniqueUrls(styles.map(style => style?.href)) &&
      styles.every(
        style =>
          actualStyle(style) &&
          style.loaded === true &&
          style.status === 200 &&
          typeof style.contentType === 'string' &&
          /^text\/css(?:;|$)/iu.test(style.contentType) &&
          Array.isArray(compiledAssets) &&
          compiledAssets.some(
            asset =>
              actualStyle(asset) &&
              asset.href === style.href &&
              asset.sha256 === style.sha256 &&
              asset.size === style.size,
          ),
      );
    if (
      typeof value.titleAfterNavigation !== 'string' ||
      !value.titleAfterNavigation ||
      value.titleAfterNavigation !== value.expectedTitle ||
      typeof value.computedStyleAfterNavigation !== 'string' ||
      !value.computedStyleAfterNavigation ||
      value.computedStyleAfterNavigation !== value.expectedComputedStyle ||
      !Number.isInteger(value.stylesheetCount) ||
      Number(value.stylesheetCount) < 1 ||
      value.uniqueStylesheetCount !== value.stylesheetCount ||
      value.titleNodeCount !== 1 ||
      value.descriptionNodeCount !== 1 ||
      typeof value.descriptionAfterNavigation !== 'string' ||
      !value.descriptionAfterNavigation ||
      value.descriptionAfterNavigation !== value.expectedDescription ||
      typeof value.titleBeforeNavigation !== 'string' ||
      !value.titleBeforeNavigation ||
      value.titleBeforeNavigation === value.titleAfterNavigation ||
      value.stylesheetSetWithinCompiledClosure !== true ||
      !uniqueUrls(stylesheetUrls) ||
      !uniqueUrls(compiledUrls) ||
      !compiledUrls.length ||
      !uniqueUrls(startupUrls) ||
      !stylesheetUrls.every(url => compiledUrls.includes(url)) ||
      !startupUrls.every(url => stylesheetUrls.includes(url)) ||
      stylesheetUrls.length !== value.stylesheetCount ||
      !Array.isArray(compiledAssets) ||
      compiledAssets.some(asset => !actualStyle(asset)) ||
      !isDeepStrictEqual(
        compiledAssets.map(asset => asset.href).sort(),
        [...compiledUrls].sort(),
      ) ||
      !authenticatedStyles(observedStyles) ||
      !Array.isArray(observedStyles) ||
      !isDeepStrictEqual(
        observedStyles.map(style => style.href).sort(),
        [...stylesheetUrls].sort(),
      )
    )
      fail(
        'head/assets require changed native metadata, unique loaded CSS within the actual compiler closure, required startup CSS and authenticated response bytes',
      );
    if (specification.renderer === 'solid') {
      const lazy = value.lazyCSSSemanticFacts;
      const lazyStyles = value.lazyCSSObservedStylesheets;
      if (
        !lazy ||
        typeof lazy !== 'object' ||
        !('visible' in lazy) ||
        lazy.visible !== true ||
        !('borderInlineStartWidth' in lazy) ||
        lazy.borderInlineStartWidth !== '2px' ||
        !('paddingInlineStart' in lazy) ||
        typeof lazy.paddingInlineStart !== 'string' ||
        !('rootFontSize' in lazy) ||
        typeof lazy.rootFontSize !== 'string' ||
        lazy.paddingInlineStart !== lazy.rootFontSize ||
        !('paddingMatchesRootFontSize' in lazy) ||
        lazy.paddingMatchesRootFontSize !== true ||
        !('authenticatedStylesheetUrls' in lazy) ||
        !uniqueUrls(lazy.authenticatedStylesheetUrls) ||
        !lazy.authenticatedStylesheetUrls.length ||
        !authenticatedStyles(lazyStyles) ||
        !Array.isArray(lazyStyles) ||
        !lazy.authenticatedStylesheetUrls.every(url =>
          lazyStyles.some(style => style.href === url),
        )
      )
        fail(
          'Solid lazy CSS requires a visible native lazy component, actual loaded authenticated CSS and its border/padding semantics',
        );
    }
  } else if (dimension === 'hmr') {
    if (environment === 'production') {
      if (
        value.hmrClientPresent !== false ||
        value.hmrSocketCount !== 0 ||
        value.activeRootCount !== 1
      ) {
        fail('production requires disabled HMR and one active root');
      }
      return;
    }
    if (
      typeof value.updatedMarker !== 'string' ||
      !value.updatedMarker ||
      value.statePolicy !== expected.hmrPolicies[specification.renderer] ||
      value.expectedInitialState === undefined ||
      value.stateBefore === undefined ||
      isDeepStrictEqual(value.stateBefore, value.expectedInitialState) ||
      value.stateAfter === undefined ||
      (value.statePolicy === 'preserved' &&
        !isDeepStrictEqual(value.stateBefore, value.stateAfter)) ||
      (value.statePolicy === 'may-reset' &&
        !isDeepStrictEqual(value.stateAfter, value.expectedInitialState) &&
        !isDeepStrictEqual(value.stateAfter, value.stateBefore)) ||
      value.unaffectedStateBefore === undefined ||
      !isDeepStrictEqual(
        value.unaffectedStateBefore,
        value.unaffectedStateAfter,
      ) ||
      typeof value.documentBefore !== 'string' ||
      !value.documentBefore ||
      value.documentBefore !== value.documentAfter ||
      value.nativeUpdate !== true ||
      typeof value.updatedMarkerBefore !== 'string' ||
      !value.updatedMarkerBefore ||
      value.updatedMarkerBefore === value.updatedMarker ||
      typeof value.sourceBeforeSha256 !== 'string' ||
      !/^[a-f\d]{64}$/u.test(value.sourceBeforeSha256) ||
      typeof value.sourceAfterSha256 !== 'string' ||
      !/^[a-f\d]{64}$/u.test(value.sourceAfterSha256) ||
      value.sourceBeforeSha256 === value.sourceAfterSha256 ||
      value.activeRootCount !== 1 ||
      !Number.isInteger(value.expectedActiveResourceCount) ||
      Number(value.expectedActiveResourceCount) < 1 ||
      value.activeResourceCount !== value.expectedActiveResourceCount ||
      value.unaffectedResourceCleanupCount !== 0 ||
      value.oldResourceCleanupCount !== 1
    ) {
      fail(
        'HMR requires admitted native state behavior, unchanged surrounding state/document, one root and one cleanup',
      );
    }
  }
}

/** Reject incomplete or stale evidence; this never executes or certifies an app. */
export function assertConformanceReceipt(
  receipt: ConformanceReceipt,
  expected: CandidateIdentity,
  selected: readonly ConformanceCase[] = conformanceMatrix,
) {
  if (receipt?.schemaVersion !== 1) fail('receipt schemaVersion must be 1');
  if (!/^[a-f\d]{40,64}$/u.test(expected.sourceRevision))
    fail('invalid source revision');
  if (!/^[a-f\d]{64}$/u.test(expected.profileDigest))
    fail('invalid profile digest');
  if (
    renderers.some(
      renderer =>
        !['preserved', 'may-reset'].includes(expected.hmrPolicies?.[renderer]),
    )
  ) {
    fail('candidate must declare each admitted native HMR state policy');
  }
  if (
    !Array.isArray(expected.artifactDigests) ||
    expected.artifactDigests.length === 0 ||
    expected.artifactDigests.some(value => !/^[a-f\d]{64}$/u.test(value)) ||
    new Set(expected.artifactDigests).size !== expected.artifactDigests.length
  ) {
    fail('candidate must bind unique SHA-256 artifact digests');
  }
  assertIdentity(receipt.identity, expected);
  if (!Array.isArray(receipt.evidence))
    fail('receipt evidence must be an array');
  const cases = new Map(selected.map(value => [value.id, value]));
  const applicationKeys = new Set(selected.map(applicationIdentityKey));
  if (
    !expected.applicationIdentities ||
    Object.keys(expected.applicationIdentities).length !== applicationKeys.size
  )
    fail('candidate must bind every actual application build identity');
  for (const key of applicationKeys) {
    const value = expected.applicationIdentities[key];
    if (
      !value ||
      value.renderer !== key.split(':')[0] ||
      typeof value.appId !== 'string' ||
      !value.appId ||
      typeof value.entryName !== 'string' ||
      !value.entryName ||
      value.protocolVersion !== 1 ||
      !/^[a-f\d]{64}$/u.test(value.buildId)
    )
      fail('candidate application build identity is invalid');
  }
  const seen = new Set<string>();
  for (const evidence of receipt.evidence) {
    const specification = cases.get(evidence.caseId);
    const browserProof =
      evidence.producer === 't3-preview' ||
      evidence.producer === 'browser-test';
    const proofKey = `${evidence.caseId}:${browserProof ? 'browser' : 'http'}`;
    if (!specification || seen.has(proofKey))
      fail('unknown or duplicate case evidence');
    seen.add(proofKey);
    assertIdentity(evidence, expected);
    if (
      !evidence.observations ||
      Object.keys(evidence.observations).length === 0
    ) {
      fail(`${evidence.caseId} has no observations`);
    }
    if (browserProof) {
      if (specification.proof === 'http')
        fail(`${evidence.caseId} requires HTTP driver observations`);
      if (
        evidence.producer !== 't3-preview' &&
        evidence.producer !== 'browser-test'
      ) {
        fail(`${evidence.caseId} requires browser observations`);
      }
      assertBrowserObservation(specification, evidence.observations, expected);
    } else {
      if (specification.proof === 'browser')
        fail(`${evidence.caseId} requires browser observations`);
      if (
        evidence.producer !== 'http-driver' ||
        evidence.observations.assertionCount === undefined
      ) {
        fail(`${evidence.caseId} requires HTTP driver observations`);
      }
      if (
        !Number.isInteger(evidence.observations.assertionCount) ||
        Number(evidence.observations.assertionCount) < 1
      ) {
        fail(`${evidence.caseId} requires executed HTTP assertions`);
      }
    }
  }
  const requiredProofCount = [...cases.values()].reduce(
    (count, specification) =>
      count + (specification.proof === 'http-and-browser' ? 2 : 1),
    0,
  );
  if (seen.size !== requiredProofCount)
    fail('candidate conformance evidence is incomplete');
  if (!Array.isArray(receipt.capabilities))
    fail('capability dispositions are required');
  const capabilities = new Set<string>();
  for (const row of receipt.capabilities) {
    const key = `${row.renderer}:${row.capability}`;
    if (
      !renderers.includes(row.renderer) ||
      !['worker', 'module-federation', 'rsc'].includes(row.capability) ||
      capabilities.has(key) ||
      !row.evidenceId
    ) {
      fail('unknown, duplicate or unproved capability disposition');
    }
    capabilities.add(key);
    assertIdentity(row, expected);
    if (row.renderer === 'react' && row.disposition !== 'supported') {
      fail(
        'existing React worker, federation and RSC capabilities remain required',
      );
    }
    if (row.disposition === 'unsupported' && !row.diagnostic?.trim()) {
      fail('unsupported capabilities require a tested actionable diagnostic');
    }
    if (row.disposition !== 'supported' && row.disposition !== 'unsupported') {
      fail('capability disposition must be supported or unsupported');
    }
    if (
      !row.observations ||
      !Number.isInteger(row.observations.assertionCount) ||
      Number(row.observations.assertionCount) < 1
    ) {
      fail('capability disposition requires executed assertions');
    }
    if (
      row.disposition === 'unsupported' &&
      (typeof row.observations.diagnosticCode !== 'string' ||
        !row.observations.diagnosticCode ||
        row.observations.beforeRendererSetup !== true)
    ) {
      fail('unsupported capability must be rejected before renderer setup');
    }
    if (row.disposition === 'supported') {
      if (
        row.capability === 'worker' &&
        (row.observations.runtime !== 'workerd' ||
          row.observations.fetchStatus !== 200 ||
          !Array.isArray(row.observations.dispatchForms) ||
          !['fetch-export', 'request-handler'].every(form =>
            row.observations.dispatchForms.includes(form),
          ))
      ) {
        fail('worker support requires both real workerd dispatch forms');
      }
      if (
        row.capability === 'module-federation' &&
        (row.observations.hostRenderer !== row.renderer ||
          row.observations.remoteRenderer !== row.renderer ||
          !Number.isInteger(row.observations.remoteInvocationCount) ||
          Number(row.observations.remoteInvocationCount) < 1 ||
          row.observations.ssrRendered !== true ||
          row.observations.hydrated !== true)
      ) {
        fail(
          'federation support requires native remote execution, SSR and hydration',
        );
      }
      if (
        row.capability === 'rsc' &&
        (row.renderer !== 'react' ||
          row.observations.protocolStatus !== 200 ||
          typeof row.observations.contentType !== 'string' ||
          !row.observations.contentType.startsWith('text/x-component') ||
          row.observations.reactRscLoaded !== true ||
          !Number.isInteger(row.observations.responseChunks) ||
          Number(row.observations.responseChunks) < 1)
      ) {
        fail('RSC support requires an executed native React Flight response');
      }
    }
  }
  if (capabilities.size !== renderers.length * 3)
    fail('capability matrix is incomplete');
  return {
    caseCount: cases.size,
    proofCount: seen.size,
    capabilityCount: capabilities.size,
  };
}
