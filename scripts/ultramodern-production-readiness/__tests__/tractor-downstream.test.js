const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const contractPromise = import('../tractor-downstream/contract.mjs');
const runnerPromise = import('../tractor-downstream/main.mjs');

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tractor-downstream-contract-'),
  );
  fs.mkdirSync(path.join(root, 'apps/shell-super-app/locales/en'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({
      dependencies: {
        '@modern-js/runtime':
          'npm:@bleedingdev/modern-js-runtime@3.5.0-ultramodern.50',
      },
    })}\n`,
  );
  fs.writeFileSync(
    path.join(root, 'apps/shell-super-app/locales/en/shell.json'),
    '{"heading":"Tractor Store"}\n',
  );
  return root;
}

const release = {
  aliases: {
    '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
  },
  release: {
    version: '3.5.0-ultramodern.50',
  },
};

function writeAuthenticatedCohort(root) {
  const projection = {
    aliases: release.aliases,
    packages: [
      {
        sourceName: '@modern-js/runtime',
        targetName: '@bleedingdev/modern-js-runtime',
        version: release.release.version,
      },
    ],
    release: release.release,
    schema: 'bleedingdev.ultramodern.release-cohort',
    schemaVersion: 1,
  };
  release.cohortProjection = { value: projection };
  fs.mkdirSync(path.join(root, '.modernjs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.modernjs/release-cohort.json'),
    `${JSON.stringify(projection)}\n`,
  );
  fs.writeFileSync(
    path.join(root, '.modernjs/ultramodern.json'),
    `${JSON.stringify({
      generator: { version: release.release.version },
      packageSource: {
        modernPackageVersion: release.release.version,
        strategy: 'install',
      },
    })}\n`,
  );
}

function nativeSearchEvidence() {
  const product = {
    detailName: 'Sapphire Sunworker 460R',
    sku: 'AU-04-RD',
    slug: 'sapphire-sunworker-460r',
  };
  return {
    assertions: [
      {
        route: '/en/tractors',
        status: 'pass',
        type: 'product-grid-not-checkout',
      },
      {
        route: `/en/tractors/${product.slug}?sku=${product.sku}`,
        status: 'pass',
        type: 'product-detail',
      },
      {
        cartLine: {
          id: product.sku,
          name: product.detailName,
          quantity: 1,
          slug: product.slug,
        },
        route: `/en/cart?sku=${product.sku}`,
        status: 'pass',
        type: 'cart-product-match',
      },
      {
        route: '/en/checkout',
        status: 'pass',
        type: 'checkout-page',
      },
      {
        route: '/en/checkout/thank-you',
        status: 'pass',
        type: 'thank-you-page',
      },
    ],
    product,
    status: 'pass',
    ui: {
      accessibility: {
        controls: [
          {
            name: 'Add to basket',
            role: 'link',
            route: `/en/tractors/${product.slug}?sku=${product.sku}`,
            status: 'pass',
          },
          {
            name: 'Checkout',
            role: 'link',
            route: `/en/cart?sku=${product.sku}`,
            status: 'pass',
          },
          {
            name: 'Name',
            role: 'textbox',
            route: '/en/checkout',
            status: 'pass',
          },
          {
            name: 'Email',
            role: 'textbox',
            route: '/en/checkout',
            status: 'pass',
          },
          {
            name: 'Delivery address',
            role: 'textbox',
            route: '/en/checkout',
            status: 'pass',
          },
          {
            name: 'Place order',
            role: 'button',
            route: '/en/checkout',
            status: 'pass',
          },
          {
            name: 'Thank you for your order',
            role: 'heading',
            route: '/en/checkout/thank-you',
            status: 'pass',
          },
        ],
        status: 'pass',
      },
      computedStyles: {
        samples: [
          {
            display: 'grid',
            opacity: 1,
            route: '/en/tractors',
            subject: 'product-grid',
            visibility: 'visible',
          },
          {
            display: 'block',
            opacity: 1,
            route: `/en/tractors/${product.slug}?sku=${product.sku}`,
            subject: 'product-page',
            visibility: 'visible',
          },
          {
            display: 'block',
            opacity: 1,
            route: `/en/cart?sku=${product.sku}`,
            subject: 'cart-page',
            visibility: 'visible',
          },
          {
            display: 'block',
            opacity: 1,
            route: '/en/checkout',
            subject: 'checkout-page',
            visibility: 'visible',
          },
          {
            display: 'block',
            opacity: 1,
            route: '/en/checkout/thank-you',
            subject: 'thanks-page',
            visibility: 'visible',
          },
        ],
        status: 'pass',
      },
      dom: {
        boundaries: [
          {
            boundaryId: 'explore',
            expose: './ProductGrid',
            route: '/en/tractors',
            visible: true,
          },
          {
            boundaryId: 'decide',
            expose: './ProductPage',
            route: `/en/tractors/${product.slug}?sku=${product.sku}`,
            visible: true,
          },
          {
            boundaryId: 'checkout',
            expose: './CartPage',
            route: `/en/cart?sku=${product.sku}`,
            visible: true,
          },
          {
            boundaryId: 'checkout',
            expose: './CheckoutPage',
            route: '/en/checkout',
            visible: true,
          },
          {
            boundaryId: 'checkout',
            expose: './ThanksPage',
            route: '/en/checkout/thank-you',
            visible: true,
          },
        ],
        status: 'pass',
      },
      runtime: {
        interactions: [
          { status: 'pass', type: 'open-product' },
          { status: 'pass', type: 'add-to-basket' },
          { status: 'pass', type: 'begin-checkout' },
          { status: 'pass', type: 'place-order' },
        ],
        status: 'pass',
      },
      status: 'pass',
    },
  };
}

test('requires the exact release cohort in every Tractor package manifest', async () => {
  const {
    assertAuthenticatedTractorCohort,
    assertExactModernDependencySpecifiers,
  } = await contractPromise;
  const root = fixture();
  try {
    writeAuthenticatedCohort(root);
    assert.equal(
      assertAuthenticatedTractorCohort(root, release).packageCount,
      1,
    );
    assert.equal(
      assertExactModernDependencySpecifiers(root, release).length,
      1,
    );
    fs.mkdirSync(path.join(root, 'repos/reference'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'repos/reference/package.json'),
      `${JSON.stringify({
        dependencies: { '@modern-js/runtime': 'workspace:*' },
      })}\n`,
    );
    assert.equal(
      assertExactModernDependencySpecifiers(root, release).length,
      1,
    );
    const manifestPath = path.join(root, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.dependencies['@modern-js/runtime'] =
      'npm:@bleedingdev/modern-js-runtime@3.5.0-ultramodern.49';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    assert.throws(
      () => assertExactModernDependencySpecifiers(root, release),
      /must be npm:@bleedingdev\/modern-js-runtime@3\.5\.0-ultramodern\.50/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requires exact versions for arbitrary aliases to cohort packages', async () => {
  const { assertExactModernDependencySpecifiers } = await contractPromise;
  const root = fixture();
  try {
    writeAuthenticatedCohort(root);
    const manifestPath = path.join(root, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.dependencies['framework-runtime'] =
      'npm:@bleedingdev/modern-js-runtime@3.5.0-ultramodern.50';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    assert.deepEqual(
      assertExactModernDependencySpecifiers(root, release).find(
        observation => observation.dependencyName === 'framework-runtime',
      ),
      {
        blockName: 'dependencies',
        dependencyName: 'framework-runtime',
        packageFile: 'package.json',
        specifier: 'npm:@bleedingdev/modern-js-runtime@3.5.0-ultramodern.50',
        targetName: '@bleedingdev/modern-js-runtime',
      },
    );

    manifest.dependencies['framework-runtime'] =
      'npm:@bleedingdev/modern-js-runtime@~3.5.0-ultramodern.50';
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    assert.throws(
      () => assertExactModernDependencySpecifiers(root, release),
      /dependencies\.framework-runtime must be npm:@bleedingdev\/modern-js-runtime@3\.5\.0-ultramodern\.50, found npm:@bleedingdev\/modern-js-runtime@~3\.5\.0-ultramodern\.50/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requires browser-visible native search continuity into the cart', async () => {
  const { assertNativeTanStackSearch } = await contractPromise;
  const evidence = nativeSearchEvidence();

  assert.deepEqual(assertNativeTanStackSearch(evidence), {
    cartRoute: '/en/cart?sku=AU-04-RD',
    productRoute: '/en/tractors/sapphire-sunworker-460r?sku=AU-04-RD',
    sku: 'AU-04-RD',
    status: 'native-typed-search',
  });

  const wrongProductSearch = structuredClone(evidence);
  wrongProductSearch.assertions.find(
    assertion => assertion.type === 'product-detail',
  ).route = '/en/tractors/sapphire-sunworker-460r?sku=CL-08-GR';
  assert.throws(
    () => assertNativeTanStackSearch(wrongProductSearch),
    /product-detail route must carry the selected product sku/u,
  );

  const wrongCartIdentity = structuredClone(evidence);
  wrongCartIdentity.assertions.find(
    assertion => assertion.type === 'cart-product-match',
  ).cartLine.id = 'CL-08-GR';
  assert.throws(
    () => assertNativeTanStackSearch(wrongCartIdentity),
    /cart evidence must preserve the selected product identity/u,
  );
});

test('validates native search from the emitted Playwright workflow artifact', async () => {
  const { runVisibleWorkflow } = await runnerPromise;
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tractor-native-search-workflow-'),
  );
  try {
    const runImpl = (_command, args, options) => {
      assert.equal(
        options.env.ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP,
        'http://127.0.0.1:4173',
      );
      fs.writeFileSync(
        args.at(-1),
        `${JSON.stringify(nativeSearchEvidence())}\n`,
      );
    };
    const result = runVisibleWorkflow({
      artifactDir: root,
      baseUrl: 'http://127.0.0.1:4173',
      env: {},
      platform: 'node',
      runImpl,
      workspace: root,
    });

    assert.equal(result.platform, 'node');
    assert.equal(result.assertionCount, 5);
    assert.equal(result.nativeSearch.status, 'native-typed-search');
    assert.equal(result.nativeSearch.sku, 'AU-04-RD');
    assert.deepEqual(result.ui, {
      accessibilityCheckCount: 7,
      boundaryCount: 5,
      computedStyleSampleCount: 5,
      runtimeInteractionCount: 4,
      status: 'visible-ui-contract',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('requires structured visible UI behavior evidence', async () => {
  const { assertVisibleTractorUi } = await contractPromise;
  const evidence = nativeSearchEvidence();
  assert.deepEqual(assertVisibleTractorUi(evidence), {
    accessibilityCheckCount: 7,
    boundaryCount: 5,
    computedStyleSampleCount: 5,
    runtimeInteractionCount: 4,
    status: 'visible-ui-contract',
  });

  const inaccessible = structuredClone(evidence);
  inaccessible.ui.accessibility.controls =
    inaccessible.ui.accessibility.controls.filter(
      control => control.name !== 'Place order',
    );
  assert.throws(
    () => assertVisibleTractorUi(inaccessible),
    /accessible button named Place order/u,
  );

  const visuallyHidden = structuredClone(evidence);
  visuallyHidden.ui.computedStyles.samples.find(
    sample => sample.subject === 'product-grid',
  ).display = 'none';
  assert.throws(
    () => assertVisibleTractorUi(visuallyHidden),
    /computed style for product-grid is not visibly rendered/u,
  );

  const missingRemoteUi = structuredClone(evidence);
  missingRemoteUi.ui.dom.boundaries.find(
    boundary => boundary.expose === './ProductPage',
  ).visible = false;
  assert.throws(
    () => assertVisibleTractorUi(missingRemoteUi),
    /visible DOM boundary decide \.\/ProductPage/u,
  );

  const brokenInteraction = structuredClone(evidence);
  brokenInteraction.ui.runtime.interactions.find(
    interaction => interaction.type === 'place-order',
  ).status = 'fail';
  assert.throws(
    () => assertVisibleTractorUi(brokenInteraction),
    /passing place-order runtime interaction/u,
  );
});

test('runner has no bypass for Node or workerd release gates', async () => {
  const {
    createTractorPackageManagerContext,
    parseArgs,
    requiredCommands,
    requiredTractorCheckIds,
    requiredVisibleRuntimePlatforms,
    runTractorDownstreamAcceptance,
  } = await runnerPromise;
  assert.deepEqual(requiredCommands, [
    ['pnpm', ['install', '--frozen-lockfile']],
    ['pnpm', ['check']],
    ['pnpm', ['build']],
    ['pnpm', ['node:proof']],
    ['pnpm', ['cloudflare:build']],
  ]);
  assert.deepEqual(requiredVisibleRuntimePlatforms, ['node', 'workerd']);
  assert.deepEqual(requiredTractorCheckIds, [
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
  assert.equal(typeof runTractorDownstreamAcceptance, 'function');
  assert.throws(() => parseArgs([]), /--manifest is required/u);
  assert.throws(
    () =>
      parseArgs([
        '--manifest',
        '/tmp/release/manifest.json',
        '--workspace',
        '/tmp',
        '--skip-browser',
      ]),
    /Unknown argument: --skip-browser/u,
  );

  const packageManagerRoot = path.join(
    os.tmpdir(),
    'tractor-package-manager-context',
  );
  const exactPnpmExecutable = '/opt/pnpm-11.17.0/bin/pnpm';
  const calls = [];
  const packageManager = createTractorPackageManagerContext({
    createPackage: {
      exactSpecifier: '@bleedingdev/modern-js-create@3.5.0-ultramodern.77',
    },
    expectedPnpmVersion: '11.17.0',
    packageManagerRoot,
    registryUrl: 'https://registry.npmjs.org/',
    resolveExactPnpmExecutableImpl: (...args) => {
      calls.push(args);
      return exactPnpmExecutable;
    },
    runImpl: () => {
      throw new Error('resolver stub must own executable discovery');
    },
  });
  assert.equal(packageManager.pnpmExecutable, exactPnpmExecutable);
  assert.equal(
    packageManager.env.PATH.split(path.delimiter)[0],
    path.dirname(exactPnpmExecutable),
  );
  assert.equal(
    packageManager.env.pnpm_config_minimum_release_age_exclude,
    '@bleedingdev/*',
  );
  assert.equal(packageManager.env.pnpm_config_pm_on_fail, 'ignore');
  assert.equal(
    packageManager.env.pnpm_config_trust_policy_exclude,
    '@bleedingdev/*',
  );
  assert.equal(
    packageManager.env.pnpm_config_registry,
    'https://registry.npmjs.org/',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], '11.17.0');
  assert.equal(calls[0][3], packageManagerRoot);
});

test('Node runtime targets use release-envelope markers instead of generation markers', async () => {
  const { createReleaseBoundNodeSmokeTargets } = await runnerPromise;
  const contract = {
    apps: [
      {
        id: 'explore',
        marker: { build: 'generation-marker' },
      },
    ],
  };
  const releaseBoundContract = {
    apps: [
      {
        id: 'explore',
        marker: { build: 'release-envelope-marker' },
      },
    ],
  };
  const calls = [];

  const result = createReleaseBoundNodeSmokeTargets(
    {
      contract,
      projectDir: '/tmp/tractor-release-bound-node-targets',
    },
    {
      bindContractToReleaseIdentityImpl: options => {
        calls.push(['bind', options]);
        return releaseBoundContract;
      },
      createSmokeTargetsImpl: (value, options) => {
        calls.push(['targets', value, options]);
        return {
          skipped: [],
          targets: value.apps.map(app => ({ app })),
        };
      },
    },
  );

  assert.equal(result.targets[0].app.marker.build, 'release-envelope-marker');
  assert.deepEqual(calls, [
    [
      'bind',
      {
        contract,
        platform: 'node',
        projectDir: '/tmp/tractor-release-bound-node-targets',
      },
    ],
    ['targets', releaseBoundContract, { mode: 'local' }],
  ]);
});

test('Node acceptance rejects hydrated CSR without authoritative no-JS distributed SSR evidence', async () => {
  const { proveNodeServerRenderedSsr } = await runnerPromise;
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tractor-node-ssr-contract-'),
  );
  const targets = [
    {
      app: {
        id: 'explore',
        kind: 'vertical',
        api: { prefix: '/explore-api', stem: 'explore' },
        styling: {
          federation: { rootSelector: '[data-app-id="explore"]' },
        },
      },
      baseUrl: 'http://localhost:3021',
      routes: {
        distributedSsr: '/en',
        ssr: '/en',
      },
    },
    {
      app: {
        id: 'shell-super-app',
        kind: 'shell',
        moduleFederation: {
          verticalRefs: ['explore'],
        },
        styling: {
          federation: { rootSelector: '[data-app-id="shell-super-app"]' },
        },
      },
      baseUrl: 'http://localhost:3020',
      routes: {
        distributedSsr: '/en/tractors/CL-08-GR',
        ssr: '/en',
      },
    },
  ];
  const pass = type => ({ status: 'pass', type });
  const httpValidationCalls = [];
  const validateHttpTargetImpl = async (target, options) => {
    httpValidationCalls.push({ options, target });
    return [
      pass('ssr-route'),
      pass('ui-marker-html'),
      pass('css-root-marker'),
      ...(target.app.api ? [pass('effect-readiness')] : []),
    ];
  };
  const validNoJavaScriptSsr = async target =>
    target.app.kind === 'shell'
      ? [
          pass('no-js-distributed-ssr-route'),
          pass('no-js-shell-composition-boundary'),
          pass('no-js-ssr-css-root-marker'),
          pass('no-js-ssr-failed-responses'),
        ]
      : [
          pass('no-js-ssr-ui-marker'),
          pass('no-js-ssr-css-root-marker'),
          pass('no-js-ssr-failed-responses'),
        ];

  try {
    const evidence = await proveNodeServerRenderedSsr({
      artifactDir: root,
      browser: {},
      targets,
      validateHttpTargetImpl,
      validateNoJavaScriptSsrTargetImpl: validNoJavaScriptSsr,
    });
    assert.equal(evidence.status, 'pass');
    assert.equal(evidence.appCount, 2);
    assert.equal(evidence.distributedSsrRoute, '/en/tractors/CL-08-GR');
    assert.equal(httpValidationCalls.length, 2);
    assert.equal(
      httpValidationCalls.every(
        call => call.options.includeCloudflareJsonSmokeChecks === false,
      ),
      true,
    );
    assert.equal(
      evidence.results
        .find(result => result.appId === 'shell-super-app')
        .noJavaScriptAssertions.some(
          assertion =>
            assertion.type === 'no-js-shell-composition-boundary' &&
            assertion.status === 'pass',
        ),
      true,
    );

    await assert.rejects(
      () =>
        proveNodeServerRenderedSsr({
          artifactDir: root,
          browser: {},
          targets,
          validateHttpTargetImpl,
          validateNoJavaScriptSsrTargetImpl: async target =>
            target.app.kind === 'shell'
              ? [
                  pass('no-js-distributed-ssr-route'),
                  pass('no-js-ssr-css-root-marker'),
                  pass('no-js-ssr-failed-responses'),
                ]
              : validNoJavaScriptSsr(target),
        }),
      /missing required no-js-shell-composition-boundary evidence/u,
    );

    await assert.rejects(
      () =>
        proveNodeServerRenderedSsr({
          artifactDir: root,
          browser: {},
          targets,
          validateHttpTargetImpl: async target => [
            pass('ssr-route'),
            pass('css-root-marker'),
            ...(target.app.api ? [pass('effect-readiness')] : []),
          ],
          validateNoJavaScriptSsrTargetImpl: validNoJavaScriptSsr,
        }),
      /missing required ui-marker-html evidence/u,
    );

    const csrOnlyTargets = structuredClone(targets);
    csrOnlyTargets[1].routes.distributedSsr = csrOnlyTargets[1].routes.ssr;
    await assert.rejects(
      () =>
        proveNodeServerRenderedSsr({
          artifactDir: root,
          browser: {},
          targets: csrOnlyTargets,
          validateHttpTargetImpl,
          validateNoJavaScriptSsrTargetImpl: validNoJavaScriptSsr,
        }),
      /requires a dedicated distributed-SSR route/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Node backend proof requires every API-bearing MicroVertical exactly once and passing', async () => {
  const { readPassingNodeBackendProof } = await runnerPromise;
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tractor-node-proof-contract-'),
  );
  const evidencePath = path.join(
    root,
    '.codex/reports/node-backend-federation-proof/proof.json',
  );
  try {
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.mkdirSync(path.join(root, '.modernjs'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.modernjs/ultramodern.json'),
      `${JSON.stringify({
        topology: {
          apps: [
            { id: 'shell-super-app', kind: 'shell' },
            { api: {}, id: 'explore', kind: 'vertical' },
            { api: {}, id: 'decide', kind: 'vertical' },
            { api: {}, id: 'checkout', kind: 'vertical' },
            { id: 'content', kind: 'vertical' },
          ],
        },
      })}\n`,
    );
    fs.writeFileSync(
      evidencePath,
      `${JSON.stringify({ results: [], status: 'skipped' })}\n`,
    );
    assert.throws(
      () => readPassingNodeBackendProof(root),
      /was skipped or has no executed results/u,
    );
    fs.writeFileSync(
      evidencePath,
      `${JSON.stringify({
        results: [{ appId: 'explore', status: 'pass' }],
        status: 'pass',
      })}\n`,
    );
    assert.throws(
      () => readPassingNodeBackendProof(root),
      /app set must exactly match API-bearing MicroVerticals/u,
    );

    fs.writeFileSync(
      evidencePath,
      `${JSON.stringify({
        results: [
          { appId: 'explore', status: 'pass' },
          { appId: 'decide', status: 'fail' },
          { appId: 'checkout', status: 'pass' },
        ],
        status: 'pass',
      })}\n`,
    );
    assert.throws(
      () => readPassingNodeBackendProof(root),
      /duplicate, malformed, or failing results/u,
    );

    fs.writeFileSync(
      evidencePath,
      `${JSON.stringify({
        results: [
          { appId: 'explore', status: 'pass' },
          { appId: 'decide', status: 'pass' },
          { appId: 'decide', status: 'pass' },
        ],
        status: 'pass',
      })}\n`,
    );
    assert.throws(
      () => readPassingNodeBackendProof(root),
      /duplicate, malformed, or failing results/u,
    );

    fs.writeFileSync(
      evidencePath,
      `${JSON.stringify({
        results: [
          { appId: 'explore', status: 'pass' },
          { appId: 'decide', status: 'pass' },
          { appId: 'checkout', status: 'pass' },
        ],
        status: 'pass',
      })}\n`,
    );
    assert.deepEqual(readPassingNodeBackendProof(root), {
      appIds: ['checkout', 'decide', 'explore'],
      evidencePath: '.codex/reports/node-backend-federation-proof/proof.json',
      resultCount: 3,
      status: 'pass',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
