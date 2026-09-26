import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const ignoredDirectories = new Set([
  '.git',
  '.output',
  'dist',
  'dist-cloudflare',
  'node_modules',
]);
const protectedUiRoots = Object.freeze(['apps', 'packages', 'verticals']);
const requiredTractorCheckIds = Object.freeze([
  'exact-create-validation',
  'exact-cohort',
  'install---frozen-lockfile',
  'format',
  'check',
  'promotable-application-source',
  'build',
  'node:proof',
  'node-backend-federation-executed',
  'node-server-rendered-ssr-executed',
  'node-visible-tractor-workflow',
  'cloudflare:build',
  'workerd-visible-tractor-workflow',
  'native-tanstack-search',
  'visible-tractor-ui',
]);
const requiredVisibleRuntimePlatforms = Object.freeze(['node', 'workerd']);
// The two lanes a Tractor acceptance can run in. `published` accepts the cohort
// as npm serves it and is the only promotable evidence there is; `source`
// rehearses the immutable release bundle against a throwaway loopback registry
// before publication. Same report shape, same check ids, same order — the mode
// is the one field that decides whether the report may be promoted at all.
const tractorAcceptanceModes = Object.freeze(['published', 'source']);
const promotableTractorAcceptanceMode = 'published';
const requiredTractorTopology = Object.freeze({
  backendAppIds: Object.freeze(['checkout', 'decide', 'explore']),
  visibleWorkflowRoutePatterns: Object.freeze([
    '^/en/tractors$',
    '^/en/tractors/[^/?#]+\\?sku=[^&#]+$',
    '^/en/cart\\?sku=[^&#]+$',
    '^/en/checkout$',
    '^/en/checkout/thank-you$',
  ]),
  shellRemoteBoundaryCandidates: Object.freeze({
    checkout: Object.freeze(['checkout', 'verticalCheckout']),
    decide: Object.freeze(['decide', 'verticalDecide']),
    explore: Object.freeze(['explore', 'verticalExplore']),
  }),
  ssrVerticalIds: Object.freeze(['checkout', 'decide', 'explore']),
});
const requiredUiControls = Object.freeze([
  ['link', 'Add to basket'],
  ['link', 'Checkout'],
  ['textbox', 'Name'],
  ['textbox', 'Email'],
  ['textbox', 'Delivery address'],
  ['button', 'Place order'],
  ['heading', 'Thank you for your order'],
]);
const requiredUiBoundaries = Object.freeze([
  ['explore', './ProductGrid'],
  ['decide', './ProductPage'],
  ['checkout', './CartPage'],
  ['checkout', './CheckoutPage'],
  ['checkout', './ThanksPage'],
]);
const requiredUiStyleSubjects = Object.freeze([
  'product-grid',
  'product-page',
  'cart-page',
  'checkout-page',
  'thanks-page',
]);
const requiredUiInteractionTypes = Object.freeze([
  'open-product',
  'add-to-basket',
  'begin-checkout',
  'place-order',
]);
const requiredNodeHttpAssertionTypes = Object.freeze([
  'ssr-route',
  'ui-marker-html',
  'css-root-marker',
  'mf-manifest',
  'mf-manifest-json',
  'locale-json',
]);
const requiredNodeNoJavaScriptAssertionTypes = Object.freeze([
  'no-js-ssr-css-root-marker',
  'no-js-stylesheet-href-dedupe',
  'no-js-ssr-failed-responses',
]);
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const visibleUiSummaryMinimums = Object.freeze({
  accessibilityCheckCount: requiredUiControls.length,
  boundaryCount: requiredUiBoundaries.length,
  computedStyleSampleCount: requiredUiStyleSubjects.length,
  runtimeInteractionCount: requiredUiInteractionTypes.length,
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasPassingAssertionTypes(assertions, reportedTypes, requiredTypes) {
  if (
    !Array.isArray(assertions) ||
    !Array.isArray(reportedTypes) ||
    assertions.some(
      assertion =>
        typeof assertion?.type !== 'string' || assertion.status !== 'pass',
    ) ||
    !isDeepStrictEqual(
      reportedTypes,
      assertions.map(assertion => assertion.type),
    )
  ) {
    return false;
  }
  return requiredTypes.every(type => reportedTypes.includes(type));
}

function hasExactStringSet(values, expected) {
  return (
    Array.isArray(values) &&
    values.every(value => typeof value === 'string' && value.length > 0) &&
    new Set(values).size === values.length &&
    isDeepStrictEqual([...values].sort(), [...expected].sort())
  );
}

function hasShellCompositionEvidence(
  assertions,
  expectedRemoteIds,
  boundaryCandidatesByRemoteId,
) {
  const composition = assertions?.find(
    assertion => assertion?.type === 'no-js-shell-composition-boundary',
  );
  const matched = composition?.matchedRemoteBoundaries;
  const tried = composition?.triedRemoteBoundaries;
  const triedByRemoteId = new Map(
    tried?.map(boundary => [boundary?.remoteId, boundary]),
  );
  return (
    composition?.status === 'pass' &&
    hasExactStringSet(composition.declaredRemoteIds, expectedRemoteIds) &&
    hasExactStringSet(
      matched?.map(boundary => boundary?.remoteId),
      expectedRemoteIds,
    ) &&
    matched.every(boundary => {
      const triedBoundary = triedByRemoteId.get(boundary.remoteId);
      return (
        typeof boundary.boundaryId === 'string' &&
        boundary.boundaryId.length > 0 &&
        triedBoundary?.matchedBoundaryId === boundary.boundaryId &&
        triedBoundary.triedBoundaryIds?.includes(boundary.boundaryId)
      );
    }) &&
    hasExactStringSet(
      tried?.map(boundary => boundary?.remoteId),
      expectedRemoteIds,
    ) &&
    tried.every(
      boundary =>
        typeof boundary.matchedBoundaryId === 'string' &&
        boundary.matchedBoundaryId.length > 0 &&
        isDeepStrictEqual(
          boundary.triedBoundaryIds,
          boundaryCandidatesByRemoteId[boundary.remoteId],
        ) &&
        boundary.triedBoundaryIds.includes(boundary.matchedBoundaryId),
    )
  );
}

function hasStrictNodeSsrEvidence(
  detail,
  expectedVerticalIds,
  boundaryCandidatesByRemoteId,
) {
  if (
    detail?.status !== 'pass' ||
    !Number.isSafeInteger(detail.appCount) ||
    detail.appCount !== expectedVerticalIds.length + 1 ||
    typeof detail.distributedSsrRoute !== 'string' ||
    detail.distributedSsrRoute.trim().length === 0 ||
    !detail.distributedSsrRoute.startsWith('/') ||
    !Array.isArray(detail.results) ||
    detail.results.length !== detail.appCount
  ) {
    return false;
  }
  const appIds = detail.results.map(result => result?.appId);
  const expectedAppIds = ['shell-super-app', ...expectedVerticalIds];
  const shellResult = detail.results.find(
    result => result?.appId === 'shell-super-app',
  );
  const assertedDistributedSsrRoute = shellResult?.noJavaScriptAssertions?.find(
    assertion => assertion?.type === 'no-js-distributed-ssr-route',
  )?.route;
  return (
    hasExactStringSet(appIds, expectedAppIds) &&
    detail.distributedSsrRoute === assertedDistributedSsrRoute &&
    detail.results.every(result => {
      const requiredNoJavaScriptTypes = [
        ...requiredNodeNoJavaScriptAssertionTypes,
        ...(result.appId === 'shell-super-app'
          ? ['no-js-distributed-ssr-route', 'no-js-shell-composition-boundary']
          : ['no-js-ssr-ui-marker']),
      ];
      return (
        hasPassingAssertionTypes(
          result.httpAssertions,
          result.httpAssertionTypes,
          requiredNodeHttpAssertionTypes,
        ) &&
        hasPassingAssertionTypes(
          result.noJavaScriptAssertions,
          result.noJavaScriptAssertionTypes,
          requiredNoJavaScriptTypes,
        ) &&
        (result.appId !== 'shell-super-app' ||
          hasShellCompositionEvidence(
            result.noJavaScriptAssertions,
            expectedVerticalIds,
            boundaryCandidatesByRemoteId,
          ))
      );
    })
  );
}

function collectFiles(root, predicate = () => true) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
      } else if (entry.isFile() && predicate(absolute)) {
        files.push(absolute);
      }
    }
  }
  return files.sort();
}

function collectPackageJsonFiles(workspace) {
  return [
    path.join(workspace, 'package.json'),
    ...protectedUiRoots.flatMap(root =>
      collectFiles(
        path.join(workspace, root),
        file => path.basename(file) === 'package.json',
      ),
    ),
  ]
    .filter((file, index, files) => files.indexOf(file) === index)
    .sort();
}

function assertNativeTanStackSearch(workflow) {
  assert(
    workflow && typeof workflow === 'object',
    'Tractor native search proof must be structured workflow evidence',
  );
  assert(
    workflow.status === 'pass',
    'Tractor native search proof must come from a passing browser workflow',
  );
  assert(
    workflow.product && typeof workflow.product === 'object',
    'Tractor native search proof is missing the selected product',
  );
  const { detailName, sku, slug } = workflow.product;
  assert(
    [detailName, sku, slug].every(
      value => typeof value === 'string' && value.length > 0,
    ),
    'Tractor native search proof has an invalid selected product identity',
  );
  assert(
    Array.isArray(workflow.assertions),
    'Tractor native search proof is missing browser assertions',
  );

  const assertionsByType = new Map();
  for (const assertion of workflow.assertions) {
    assert(
      assertion &&
        typeof assertion.type === 'string' &&
        assertion.status === 'pass',
      'Tractor native search proof contains malformed or failing browser evidence',
    );
    assert(
      !assertionsByType.has(assertion.type),
      `Tractor native search proof contains duplicate ${assertion.type} evidence`,
    );
    assertionsByType.set(assertion.type, assertion);
  }

  const productDetail = assertionsByType.get('product-detail');
  const cartProduct = assertionsByType.get('cart-product-match');
  assert(
    typeof productDetail?.route === 'string',
    'Tractor native search proof is missing product-detail browser evidence',
  );
  assert(
    typeof cartProduct?.route === 'string',
    'Tractor native search proof is missing cart-product-match browser evidence',
  );

  const productUrl = new URL(productDetail.route, 'https://tractor.invalid');
  assert(
    productUrl.pathname === `/en/tractors/${slug}` &&
      productUrl.searchParams.getAll('sku').length === 1 &&
      productUrl.searchParams.get('sku') === sku,
    'Tractor product-detail route must carry the selected product sku',
  );
  const cartUrl = new URL(cartProduct.route, 'https://tractor.invalid');
  assert(
    cartUrl.pathname === '/en/cart' &&
      cartUrl.searchParams.getAll('sku').length === 1 &&
      cartUrl.searchParams.get('sku') === sku,
    'Tractor cart route must preserve the selected product sku',
  );
  assert(
    cartProduct.cartLine?.id === sku &&
      cartProduct.cartLine?.slug === slug &&
      cartProduct.cartLine?.name === detailName,
    'Tractor cart evidence must preserve the selected product identity',
  );

  return {
    cartRoute: cartProduct.route,
    productRoute: productDetail.route,
    sku,
    status: 'native-typed-search',
  };
}

function assertUniqueEvidence(items, key, label, requirePassing = false) {
  assert(Array.isArray(items), `Tractor ${label} evidence must be an array`);
  const byKey = new Map();
  for (const item of items) {
    const value = item?.[key];
    assert(
      typeof value === 'string' &&
        value.length > 0 &&
        (!requirePassing || item.status === 'pass'),
      `Tractor ${label} evidence contains a malformed${requirePassing ? ' or failing' : ''} item`,
    );
    assert(!byKey.has(value), `Tractor ${label} evidence duplicates ${value}`);
    byKey.set(value, item);
  }
  return byKey;
}

function assertVisibleTractorUi(workflow) {
  const ui = workflow?.ui;
  assert(
    ui?.status === 'pass',
    'Tractor visible UI proof must come from a passing browser workflow',
  );

  assert(
    ui.accessibility?.status === 'pass',
    'Tractor visible UI proof is missing passing accessibility evidence',
  );
  const controls = Array.isArray(ui.accessibility.controls)
    ? ui.accessibility.controls
    : [];
  for (const [role, name] of requiredUiControls) {
    const matches = controls.filter(
      control =>
        control?.role === role &&
        control.name === name &&
        control.status === 'pass',
    );
    assert(
      matches.length === 1,
      `Tractor visible UI proof requires exactly one accessible ${role} named ${name}`,
    );
  }

  assert(
    ui.computedStyles?.status === 'pass',
    'Tractor visible UI proof is missing passing computed-style evidence',
  );
  const styles = assertUniqueEvidence(
    ui.computedStyles.samples,
    'subject',
    'computed-style',
  );
  for (const subject of requiredUiStyleSubjects) {
    const sample = styles.get(subject);
    assert(sample, `Tractor visible UI proof is missing ${subject} style`);
    assert(
      sample.display !== 'none' &&
        sample.visibility !== 'hidden' &&
        sample.visibility !== 'collapse' &&
        typeof sample.opacity === 'number' &&
        sample.opacity > 0,
      `Tractor computed style for ${subject} is not visibly rendered`,
    );
  }

  assert(
    ui.dom?.status === 'pass' && Array.isArray(ui.dom.boundaries),
    'Tractor visible UI proof is missing passing DOM boundary evidence',
  );
  for (const [boundaryId, expose] of requiredUiBoundaries) {
    const matches = ui.dom.boundaries.filter(
      boundary =>
        boundary?.boundaryId === boundaryId &&
        boundary.expose === expose &&
        boundary.visible === true,
    );
    assert(
      matches.length === 1,
      `Tractor visible UI proof requires exactly one visible DOM boundary ${boundaryId} ${expose}`,
    );
  }

  assert(
    ui.runtime?.status === 'pass',
    'Tractor visible UI proof is missing passing runtime evidence',
  );
  const interactions = assertUniqueEvidence(
    ui.runtime.interactions,
    'type',
    'runtime interaction',
  );
  for (const type of requiredUiInteractionTypes) {
    assert(
      interactions.get(type)?.status === 'pass',
      `Tractor visible UI proof requires exactly one passing ${type} runtime interaction`,
    );
  }

  return {
    accessibilityCheckCount: controls.length,
    boundaryCount: ui.dom.boundaries.length,
    computedStyleSampleCount: ui.computedStyles.samples.length,
    runtimeInteractionCount: ui.runtime.interactions.length,
    status: 'visible-ui-contract',
  };
}

// Acceptance reports carry only the summary assertVisibleTractorUi returns;
// the raw browser evidence stays with the downstream run. Post-publish
// validation therefore re-checks the summary shape, not the raw proof.
function assertVisibleTractorUiSummary(summary) {
  assert(
    summary !== null && typeof summary === 'object' && !Array.isArray(summary),
    'Tractor visible UI summary must be structured contract evidence',
  );
  const expectedKeys = [...Object.keys(visibleUiSummaryMinimums), 'status'];
  assert(
    isDeepStrictEqual(Object.keys(summary).sort(), [...expectedKeys].sort()),
    'Tractor visible UI summary has unknown or missing fields',
  );
  assert(
    summary.status === 'visible-ui-contract',
    'Tractor visible UI summary must attest the executed visible UI contract',
  );
  for (const [key, minimum] of Object.entries(visibleUiSummaryMinimums)) {
    assert(
      Number.isSafeInteger(summary[key]) && summary[key] >= minimum,
      `Tractor visible UI summary ${key} must cover at least ${minimum} evidence items`,
    );
  }
}

// The one Tractor acceptance report contract. The producer asserts it on the
// report it is about to mark passed, so the source-mode rehearsal exercises it
// before anything is published; the publish-outcome recorder asserts it again
// on the published-mode report it promotes. `manifest` is the strict release
// manifest (readReleaseManifest) and `baselineRevision` the Tractor commit the
// report must be bound to.
function assertTractorAcceptanceReport(
  report,
  { baselineRevision, manifest, mode },
) {
  const version = manifest.release.version;
  if (
    report?.schema !==
      'bleedingdev.ultramodern.tractor-downstream-acceptance' ||
    report.schemaVersion !== 1 ||
    report.mode !== mode ||
    report.status !== 'passed' ||
    report.release?.cohortDigest !== manifest.cohortDigest ||
    report.release?.manifestSha256 !== manifest.manifestSha256 ||
    report.release?.sourceRevision !== manifest.source.commit ||
    report.release?.version !== version ||
    typeof baselineRevision !== 'string' ||
    !commitPattern.test(baselineRevision) ||
    report.tractor?.baselineRevision !== baselineRevision ||
    !Array.isArray(report.checks)
  ) {
    throw new Error(
      'Tractor acceptance report is not a passing report for the exact release and baseline',
    );
  }
  const checkIds = report.checks.map(check => check?.id);
  if (JSON.stringify(checkIds) !== JSON.stringify(requiredTractorCheckIds)) {
    throw new Error(
      'Tractor acceptance report must contain every required check exactly once and in contract order',
    );
  }
  const checksById = new Map();
  for (const check of report.checks) {
    if (
      typeof check?.id !== 'string' ||
      checksById.has(check.id) ||
      check.status !== 'passed'
    ) {
      throw new Error(
        'Tractor acceptance report contains duplicate, malformed, or failing checks',
      );
    }
    checksById.set(check.id, check);
  }
  const createValidation = checksById.get('exact-create-validation')?.detail;
  if (
    createValidation?.createPackage !==
      manifest.packageChecks.create.exactSpecifier ||
    createValidation?.version !== version
  ) {
    throw new Error(
      'Tractor acceptance report exact-create validation does not match the strict release manifest',
    );
  }
  const exactCohort = checksById.get('exact-cohort')?.detail;
  if (
    !Number.isSafeInteger(exactCohort?.dependencyObservationCount) ||
    exactCohort.dependencyObservationCount < 1 ||
    // assertAuthenticatedTractorCohort reports the native catalog it proved:
    // one exact `npm:<alias>@<version>` entry per release alias.
    exactCohort.generatedCohort?.catalogCount !==
      Object.keys(manifest.aliases).length ||
    exactCohort.generatedCohort?.version !== version
  ) {
    throw new Error(
      'Tractor acceptance report exact cohort does not match the strict release manifest',
    );
  }
  for (const [id, platform] of [
    ['node-visible-tractor-workflow', 'node'],
    ['workerd-visible-tractor-workflow', 'workerd'],
  ]) {
    const detail = checksById.get(id)?.detail;
    if (
      detail?.platform !== platform ||
      !Number.isSafeInteger(detail.assertionCount) ||
      detail.assertionCount !==
        requiredTractorTopology.visibleWorkflowRoutePatterns.length ||
      !Array.isArray(detail.routes) ||
      detail.routes.length !== detail.assertionCount ||
      !detail.routes.every(
        (route, index) =>
          typeof route === 'string' &&
          new RegExp(
            requiredTractorTopology.visibleWorkflowRoutePatterns[index],
            'u',
          ).test(route),
      )
    ) {
      throw new Error(
        `Tractor acceptance report is missing executed ${platform} browser workflow evidence`,
      );
    }
  }
  const nodeBackend = checksById.get(
    'node-backend-federation-executed',
  )?.detail;
  if (
    nodeBackend?.status !== 'pass' ||
    !Number.isSafeInteger(nodeBackend.resultCount) ||
    nodeBackend.resultCount !== requiredTractorTopology.backendAppIds.length ||
    !hasExactStringSet(
      nodeBackend.appIds,
      requiredTractorTopology.backendAppIds,
    )
  ) {
    throw new Error(
      'Tractor acceptance report is missing executed Node backend-federation evidence for the reviewed topology',
    );
  }
  const nodeSsr = checksById.get('node-server-rendered-ssr-executed')?.detail;
  if (
    !hasStrictNodeSsrEvidence(
      nodeSsr,
      requiredTractorTopology.ssrVerticalIds,
      requiredTractorTopology.shellRemoteBoundaryCandidates,
    )
  ) {
    throw new Error(
      'Tractor acceptance report is missing executed Node server-rendered SSR evidence',
    );
  }
  const visibleUi = checksById.get('visible-tractor-ui')?.detail;
  if (
    !visibleUi ||
    !hasExactStringSet(Object.keys(visibleUi), requiredVisibleRuntimePlatforms)
  ) {
    throw new Error(
      'Tractor acceptance report is missing exact visible UI platform evidence',
    );
  }
  for (const platform of requiredVisibleRuntimePlatforms) {
    const workflow = checksById.get(
      `${platform}-visible-tractor-workflow`,
    )?.detail;
    if (!isDeepStrictEqual(visibleUi[platform], workflow?.ui)) {
      throw new Error(
        `Tractor ${platform} visible UI summary differs from its executed browser workflow`,
      );
    }
    assertVisibleTractorUiSummary(workflow.ui);
  }
}

export {
  assertNativeTanStackSearch,
  assertTractorAcceptanceReport,
  assertVisibleTractorUi,
  assertVisibleTractorUiSummary,
  collectPackageJsonFiles,
  promotableTractorAcceptanceMode,
  requiredTractorCheckIds,
  requiredTractorTopology,
  requiredVisibleRuntimePlatforms,
  tractorAcceptanceModes,
};
