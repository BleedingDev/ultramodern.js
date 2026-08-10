import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const dependencyBlocks = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const ignoredDirectories = new Set([
  '.git',
  '.output',
  'dist',
  'dist-cloudflare',
  'node_modules',
]);
const protectedUiRoots = Object.freeze(['apps', 'packages', 'verticals']);
const requiredTractorCheckIds = Object.freeze([
  'exact-create-migration',
  'exact-cohort',
  'install---frozen-lockfile',
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
const reviewedTractorTopology = Object.freeze({
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
const tractorTopologiesByBaseline = Object.freeze({
  '2cb6e1c939686b1dfd5cbfb594198512fa9d04f7': reviewedTractorTopology,
  '3a9ac349f8f52662d451030aa86ba142ca01973d': reviewedTractorTopology,
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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

function assertAuthenticatedTractorCohort(workspace, release) {
  const cohortPath = path.join(workspace, '.modernjs/release-cohort.json');
  const configPath = path.join(workspace, '.modernjs/ultramodern.json');
  assert(
    fs.existsSync(cohortPath),
    'Tractor authenticated release cohort projection is missing',
  );
  assert(fs.existsSync(configPath), 'Tractor UltraModern config is missing');
  const observed = readJson(cohortPath);
  const expected = release.cohortProjection?.value;
  assert(
    expected && typeof expected === 'object' && !Array.isArray(expected),
    'Strict release manifest cohort projection is missing',
  );
  assert(
    isDeepStrictEqual(observed, expected),
    'Tractor authenticated release cohort projection differs from the exact release manifest',
  );
  const config = readJson(configPath);
  const version = release.release?.version;
  assert(
    config.generator?.version === version,
    `Tractor generator version must be ${version}, found ${String(config.generator?.version)}`,
  );
  assert(
    config.packageSource?.strategy === 'install' &&
      config.packageSource?.modernPackageVersion === version,
    `Tractor install package source must use exact release ${version}`,
  );
  return {
    packageCount: observed.packages?.length,
    projectionSchema: observed.schema,
    projectionSchemaVersion: observed.schemaVersion,
    version,
  };
}

function assertExactModernDependencySpecifiers(workspace, release) {
  const version = release.release?.version;
  const aliases = release.aliases;
  assert(
    typeof version === 'string' && version.length > 0,
    'Release version is required for Tractor cohort validation',
  );
  assert(
    aliases && typeof aliases === 'object' && !Array.isArray(aliases),
    'Release aliases are required for Tractor cohort validation',
  );
  const cohortTargetNames = new Set(
    Object.values(aliases).filter(targetName => typeof targetName === 'string'),
  );

  const observations = [];
  for (const packageFile of collectPackageJsonFiles(workspace)) {
    const manifest = readJson(packageFile);
    for (const blockName of dependencyBlocks) {
      for (const [dependencyName, specifier] of Object.entries(
        manifest[blockName] ?? {},
      )) {
        const declaredTargetName = aliases[dependencyName];
        if (dependencyName.startsWith('@modern-js/')) {
          assert(
            typeof declaredTargetName === 'string',
            `${normalizePath(path.relative(workspace, packageFile))} ${blockName}.${dependencyName} is absent from the exact release cohort`,
          );
        }
        const targetName =
          declaredTargetName ??
          (typeof specifier === 'string' && specifier.startsWith('npm:')
            ? [...cohortTargetNames].find(candidate =>
                specifier.startsWith(`npm:${candidate}@`),
              )
            : undefined);
        if (typeof targetName !== 'string') {
          continue;
        }
        const expected = `npm:${targetName}@${version}`;
        assert(
          specifier === expected,
          `${normalizePath(path.relative(workspace, packageFile))} ${blockName}.${dependencyName} must be ${expected}, found ${String(specifier)}`,
        );
        observations.push({
          blockName,
          dependencyName,
          packageFile: normalizePath(path.relative(workspace, packageFile)),
          specifier,
          targetName,
        });
      }
    }
  }
  assert(
    observations.length > 0,
    'Tractor workspace contains no Modern.js dependencies to bind to the release cohort',
  );
  return observations;
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
  const requiredControls = [
    ['link', 'Add to basket'],
    ['link', 'Checkout'],
    ['textbox', 'Name'],
    ['textbox', 'Email'],
    ['textbox', 'Delivery address'],
    ['button', 'Place order'],
    ['heading', 'Thank you for your order'],
  ];
  for (const [role, name] of requiredControls) {
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
  for (const subject of [
    'product-grid',
    'product-page',
    'cart-page',
    'checkout-page',
    'thanks-page',
  ]) {
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
  const expectedBoundaries = [
    ['explore', './ProductGrid'],
    ['decide', './ProductPage'],
    ['checkout', './CartPage'],
    ['checkout', './CheckoutPage'],
    ['checkout', './ThanksPage'],
  ];
  for (const [boundaryId, expose] of expectedBoundaries) {
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
  for (const type of [
    'open-product',
    'add-to-basket',
    'begin-checkout',
    'place-order',
  ]) {
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

export {
  assertAuthenticatedTractorCohort,
  assertExactModernDependencySpecifiers,
  assertNativeTanStackSearch,
  assertVisibleTractorUi,
  requiredTractorCheckIds,
  requiredVisibleRuntimePlatforms,
  tractorTopologiesByBaseline,
};
