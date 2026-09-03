const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProcessEnv, runCommand } = require('../../lib/process-kit');

const contractPromise = import('../tractor-downstream/contract.mjs');
const runnerPromise = import('../tractor-downstream/main.mjs');

const stableRsbuildRspackSelectors = [
  '@rsbuild/core@2.2.0',
  '@rspack/binding-darwin-arm64@2.2.0',
  '@rspack/binding-darwin-x64@2.2.0',
  '@rspack/binding-linux-arm64-gnu@2.2.0',
  '@rspack/binding-linux-arm64-musl@2.2.0',
  '@rspack/binding-linux-ppc64-gnu@2.2.0',
  '@rspack/binding-linux-riscv64-gnu@2.2.0',
  '@rspack/binding-linux-riscv64-musl@2.2.0',
  '@rspack/binding-linux-s390x-gnu@2.2.0',
  '@rspack/binding-linux-x64-gnu@2.2.0',
  '@rspack/binding-linux-x64-musl@2.2.0',
  '@rspack/binding-wasm32-wasi@2.2.0',
  '@rspack/binding-win32-arm64-msvc@2.2.0',
  '@rspack/binding-win32-ia32-msvc@2.2.0',
  '@rspack/binding-win32-x64-msvc@2.2.0',
  '@rspack/binding@2.2.0',
  '@rspack/core@2.2.0',
].sort();

function releaseAgeEntry(selector, overrides = {}) {
  const separator = selector.lastIndexOf('@');
  return {
    approvedBy: 'Tractor release reviewer',
    evidence: {
      sha256: 'a'.repeat(64),
      uri: `https://github.com/BleedingDev/ultramodern.js/commit/${'b'.repeat(40)}`,
    },
    expiresAt: '2026-08-27T02:46:55.656Z',
    integrity: 'sha512-QUFBQQ==',
    package: selector.slice(0, separator),
    reviewedAt: '2026-08-26T10:06:26.000Z',
    version: selector.slice(separator + 1),
    ...overrides,
  };
}

function writeReleaseAgePolicy(root, entries) {
  const policyPath = path.join(root, 'release-age-policy.json');
  fs.writeFileSync(
    policyPath,
    `${JSON.stringify({
      schema: 'bleedingdev.ultramodern.release-age-exceptions',
      schemaVersion: 2,
      entries,
    })}\n`,
  );
  return policyPath;
}

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

test('published .15 Tractor bootstrap carries the full cohort and active audited closure', async t => {
  const {
    createTractorPackageManagerContext,
    createTractorPnpmDlxArgs,
    parseArgs,
    resolveTractorMinimumReleaseAgeExclude,
  } = await runnerPromise;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tractor-dlx-policy-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  const releaseVersion = '3.8.2-ultramodern.15';
  const firstPartyTargets = [
    '@bleedingdev/modern-js-ultramodern-create',
    '@bleedingdev/modern-js-i18n-utils',
    '@bleedingdev/modern-js-utils',
    ...Array.from(
      { length: 29 },
      (_, index) =>
        `@bleedingdev/modern-js-release-member-${String(index + 1).padStart(2, '0')}`,
    ),
  ];
  const strictRelease = {
    packages: firstPartyTargets.map(targetName => ({
      targetName,
      version: releaseVersion,
    })),
    release: { version: releaseVersion },
  };
  const staleSelector = 'baseline-browser-mapping@2.11.19';
  const policyPath = parseArgs([
    '--manifest',
    path.join(root, 'manifest.json'),
    '--workspace',
    root,
  ]).releaseAgePolicyPath;
  const minimumReleaseAgeExclude = resolveTractorMinimumReleaseAgeExclude({
    release: strictRelease,
    releaseAgePolicyPath: policyPath,
    now: new Date('2026-08-26T12:00:00.000Z'),
  });
  const expected = [
    ...firstPartyTargets.map(targetName => `${targetName}@${releaseVersion}`),
    ...stableRsbuildRspackSelectors,
  ].sort();
  assert.equal(expected.length, 49);
  assert.deepEqual(minimumReleaseAgeExclude, expected);
  assert.equal(minimumReleaseAgeExclude.includes(staleSelector), false);
  assert.equal(
    minimumReleaseAgeExclude.some(selector => /[*?]/u.test(selector)),
    false,
  );

  const createPackage = {
    bootstrapReleaseAgePolicy: {
      minimumReleaseAge: 1440,
      minimumReleaseAgeExclude: [
        `@bleedingdev/modern-js-i18n-utils@${releaseVersion}`,
        `@bleedingdev/modern-js-ultramodern-create@${releaseVersion}`,
        `@bleedingdev/modern-js-utils@${releaseVersion}`,
      ],
      minimumReleaseAgeIgnoreMissingTime: false,
      minimumReleaseAgeStrict: true,
    },
    exactSpecifier: `@bleedingdev/modern-js-ultramodern-create@${releaseVersion}`,
    version: releaseVersion,
  };
  const args = createTractorPnpmDlxArgs(
    createPackage,
    minimumReleaseAgeExclude,
    [
      'ultramodern',
      'migrate-strict-effect',
      '--version',
      releaseVersion,
      '--registry',
      'https://registry.npmjs.org/',
    ],
  );
  assert.deepEqual(
    args.filter(argument =>
      argument.startsWith('--config.minimum-release-age-exclude='),
    ),
    expected.map(
      selector => `--config.minimum-release-age-exclude=${selector}`,
    ),
  );
  assert.deepEqual(args.slice(-7), [
    '@bleedingdev/modern-js-ultramodern-create@3.8.2-ultramodern.15',
    'ultramodern',
    'migrate-strict-effect',
    '--version',
    releaseVersion,
    '--registry',
    'https://registry.npmjs.org/',
  ]);

  const packageManager = createTractorPackageManagerContext({
    createPackage,
    expectedPnpmVersion: '11.17.0',
    minimumReleaseAgeExclude,
    packageManagerRoot: root,
    registryUrl: 'https://registry.npmjs.org/',
    resolveExactPnpmExecutableImpl: () => '/opt/pnpm-11.17.0/bin/pnpm',
  });
  assert.deepEqual(
    JSON.parse(packageManager.env.pnpm_config_minimum_release_age_exclude),
    expected,
  );
  assert.equal(packageManager.env.pnpm_config_minimum_release_age, '1440');
  assert.equal(
    packageManager.env.pnpm_config_minimum_release_age_strict,
    'true',
  );
  assert.equal(
    packageManager.env.pnpm_config_minimum_release_age_ignore_missing_time,
    'false',
  );
});

test('Tractor bootstrap rejects malformed manifest and audited policy selectors', async t => {
  const { resolveTractorMinimumReleaseAgeExclude } = await runnerPromise;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tractor-dlx-invalid-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const now = new Date('2026-08-26T12:00:00.000Z');
  const release = {
    packages: [
      {
        targetName: '@bleedingdev/modern-js-ultramodern-create',
        version: '3.8.2-ultramodern.15',
      },
    ],
    release: { version: '3.8.2-ultramodern.15' },
  };

  const wildcardPolicyPath = writeReleaseAgePolicy(root, [
    releaseAgeEntry('@rspack/core@2.2.0', { package: '@rspack/*' }),
  ]);
  assert.throws(
    () =>
      resolveTractorMinimumReleaseAgeExclude({
        release,
        releaseAgePolicyPath: wildcardPolicyPath,
        now,
      }),
    /must be one exact npm package name/u,
  );

  const futurePolicyPath = writeReleaseAgePolicy(root, [
    releaseAgeEntry('@rspack/core@2.2.0', {
      expiresAt: '2026-08-28T12:00:00.000Z',
      reviewedAt: '2026-08-27T12:00:00.000Z',
    }),
  ]);
  assert.throws(
    () =>
      resolveTractorMinimumReleaseAgeExclude({
        release,
        releaseAgePolicyPath: futurePolicyPath,
        now,
      }),
    /reviewedAt must not be in the future/u,
  );

  assert.throws(
    () =>
      resolveTractorMinimumReleaseAgeExclude({
        release: {
          ...release,
          packages: [
            {
              targetName: '@bleedingdev/modern-js-ultramodern-create',
              version: '3.8.2-ultramodern.14',
            },
          ],
        },
        releaseAgePolicyPath: writeReleaseAgePolicy(root, []),
        now,
      }),
    /must bind targetName to release version/u,
  );
});

test('runner has no bypass for Node or workerd release gates', async () => {
  const {
    createTractorPackageManagerContext,
    executionCommands,
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
  assert.deepEqual(
    executionCommands.map(({ command, report }) => ({ command, report })),
    [
      {
        command: ['pnpm', ['install', '--frozen-lockfile']],
        report: true,
      },
      {
        command: [
          'pnpm',
          ['exec', 'playwright', 'install', '--with-deps', 'chromium'],
        ],
        report: false,
      },
      { command: ['pnpm', ['check']], report: true },
      { command: ['pnpm', ['build']], report: true },
      { command: ['pnpm', ['node:proof']], report: true },
      { command: ['pnpm', ['cloudflare:build']], report: true },
    ],
  );
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
  const parsedPolicyPath = path.join(
    os.tmpdir(),
    'tractor-release-age-policy.json',
  );
  assert.equal(
    parseArgs([
      '--manifest',
      '/tmp/release/manifest.json',
      '--workspace',
      os.tmpdir(),
      '--release-age-policy',
      parsedPolicyPath,
    ]).releaseAgePolicyPath,
    parsedPolicyPath,
  );

  const packageManagerRoot = path.join(
    os.tmpdir(),
    'tractor-package-manager-context',
  );
  const exactPnpmExecutable = '/opt/pnpm-11.17.0/bin/pnpm';
  const minimumReleaseAgeExclude = [
    '@bleedingdev/modern-js-i18n-utils@3.5.0-ultramodern.77',
    '@bleedingdev/modern-js-ultramodern-create@3.5.0-ultramodern.77',
    '@bleedingdev/modern-js-utils@3.5.0-ultramodern.77',
  ];
  const calls = [];
  const packageManager = createTractorPackageManagerContext({
    createPackage: {
      bootstrapReleaseAgePolicy: {
        minimumReleaseAge: 1440,
        minimumReleaseAgeExclude,
        minimumReleaseAgeIgnoreMissingTime: false,
        minimumReleaseAgeStrict: true,
      },
      exactSpecifier:
        '@bleedingdev/modern-js-ultramodern-create@3.5.0-ultramodern.77',
      version: '3.5.0-ultramodern.77',
    },
    expectedPnpmVersion: '11.17.0',
    minimumReleaseAgeExclude,
    packageManagerRoot,
    registryEnv: {
      npm_config_registry: 'https://registry.npmjs.org/',
      pnpm_config_registry: 'https://registry.npmjs.org/',
    },
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
    JSON.stringify(minimumReleaseAgeExclude),
  );
  assert.equal(packageManager.env.pnpm_config_minimum_release_age, '1440');
  assert.equal(
    packageManager.env.pnpm_config_minimum_release_age_ignore_missing_time,
    'false',
  );
  assert.equal(
    packageManager.env.pnpm_config_minimum_release_age_strict,
    'true',
  );
  assert.equal(packageManager.env.pnpm_config_pm_on_fail, 'ignore');
  assert.equal(
    packageManager.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(packageManagerRoot, 'package-manager', 'xdg', 'ms-playwright'),
  );
  assert.equal(packageManager.env.pnpm_config_trust_policy_exclude, undefined);
  assert.equal(
    packageManager.env.pnpm_config_registry,
    'https://registry.npmjs.org/',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], '11.17.0');
  assert.equal(calls[0][3], packageManagerRoot);
});

test('runner launches Node proof from the installed Playwright browser path', async t => {
  const { launchWorkspaceBrowser } = await runnerPromise;
  const originalBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const inheritedBrowsersPath = path.join(os.tmpdir(), 'inherited-playwright');
  const installedBrowsersPath = path.join(os.tmpdir(), 'installed-playwright');
  process.env.PLAYWRIGHT_BROWSERS_PATH = inheritedBrowsersPath;
  t.after(() => {
    if (originalBrowsersPath === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = originalBrowsersPath;
    }
  });

  const browserProvider = {};
  const expectedBrowser = {};
  const browser = await launchWorkspaceBrowser(
    {
      browserProvider,
      processEnv: { PLAYWRIGHT_BROWSERS_PATH: installedBrowsersPath },
      workspace: os.tmpdir(),
    },
    {
      launchBrowserImpl: async observedProvider => {
        assert.equal(observedProvider, browserProvider);
        assert.equal(
          process.env.PLAYWRIGHT_BROWSERS_PATH,
          installedBrowsersPath,
        );
        return expectedBrowser;
      },
    },
  );

  assert.equal(browser, expectedBrowser);
  assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH, inheritedBrowsersPath);
});

test('runner rejects inherited package-manager release-age bypasses', async () => {
  const { createTractorPackageManagerContext } = await runnerPromise;
  const inheritedKeys = [
    'NPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE',
    'NPM_CONFIG_TRUST_POLICY_EXCLUDE',
    'PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE',
    'PNPM_CONFIG_TRUST_POLICY_EXCLUDE',
    'npm_config_minimum_release_age_exclude',
    'npm_config_trust_policy_exclude',
    'pnpm_config_minimum_release_age_exclude',
    'pnpm_config_trust_policy_exclude',
    'NpM_Config_Minimum_Release_Age_Exclude',
    'nPm_Config_Trust_Policy_Exclude',
    'PnPm_Config_Minimum_Release_Age_Exclude',
    'pNpM_Config_Trust_Policy_Exclude',
  ];
  const inherited = Object.fromEntries(
    inheritedKeys.map(name => [name, process.env[name]]),
  );
  const minimumReleaseAgeExclude = [
    '@bleedingdev/modern-js-i18n-utils@3.5.0-ultramodern.77',
    '@bleedingdev/modern-js-ultramodern-create@3.5.0-ultramodern.77',
    '@bleedingdev/modern-js-utils@3.5.0-ultramodern.77',
  ];
  try {
    for (const name of inheritedKeys) {
      process.env[name] = '*';
    }
    const packageManager = createTractorPackageManagerContext({
      createPackage: {
        bootstrapReleaseAgePolicy: {
          minimumReleaseAge: 1440,
          minimumReleaseAgeExclude,
          minimumReleaseAgeIgnoreMissingTime: false,
          minimumReleaseAgeStrict: true,
        },
        exactSpecifier:
          '@bleedingdev/modern-js-ultramodern-create@3.5.0-ultramodern.77',
        version: '3.5.0-ultramodern.77',
      },
      expectedPnpmVersion: '11.17.0',
      minimumReleaseAgeExclude,
      packageManagerRoot: path.join(
        os.tmpdir(),
        'tractor-poisoned-package-manager-context',
      ),
      registryEnv: {
        npm_config_registry: 'https://registry.npmjs.org/',
        pnpm_config_registry: 'https://registry.npmjs.org/',
      },
      resolveExactPnpmExecutableImpl: () => '/opt/pnpm-11.17.0/bin/pnpm',
    });
    const child = runCommand(
      process.execPath,
      [
        '-e',
        `process.stdout.write(JSON.stringify(Object.fromEntries(
          Object.entries(process.env).filter(([name]) =>
            /^(?:npm|pnpm)_config_(?:minimum_release_age|trust_policy)_exclude$/iu.test(name),
          ),
        )))`,
      ],
      {
        encoding: 'utf8',
        env: createProcessEnv(packageManager.env),
        stdio: 'pipe',
      },
    );
    assert.equal(child.exitCode, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      pnpm_config_minimum_release_age_exclude: JSON.stringify(
        minimumReleaseAgeExclude,
      ),
    });
  } finally {
    for (const [name, value] of Object.entries(inherited)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
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

test('Tractor delegates its whole runtime context to the shared acceptance owner', async t => {
  const {
    createTractorPackageManagerContext,
    executionCommands,
    launchWorkspaceBrowser,
  } = await runnerPromise;
  const { acceptancePlaywrightInstallArgs, createAcceptanceRuntimeContext } =
    await import('../published-create-proof/acceptance-profile.mjs');

  const packageManagerRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tractor-runtime-delegate-'),
  );
  t.after(() =>
    fs.rmSync(packageManagerRoot, { force: true, recursive: true }),
  );
  const pnpmExecutable = '/opt/pnpm-11.17.0/bin/pnpm';
  const registryUrl = 'https://registry.npmjs.org/';
  const minimumReleaseAgeExclude = [
    '@bleedingdev/modern-js-i18n-utils@3.5.0-ultramodern.77',
    '@bleedingdev/modern-js-ultramodern-create@3.5.0-ultramodern.77',
    '@bleedingdev/modern-js-utils@3.5.0-ultramodern.77',
  ];
  const packageManager = createTractorPackageManagerContext({
    createPackage: {
      bootstrapReleaseAgePolicy: {
        minimumReleaseAge: 1440,
        minimumReleaseAgeExclude,
        minimumReleaseAgeIgnoreMissingTime: false,
        minimumReleaseAgeStrict: true,
      },
      exactSpecifier:
        '@bleedingdev/modern-js-ultramodern-create@3.5.0-ultramodern.77',
      version: '3.5.0-ultramodern.77',
    },
    expectedPnpmVersion: '11.17.0',
    minimumReleaseAgeExclude,
    packageManagerRoot,
    registryEnv: {
      npm_config_registry: registryUrl,
      pnpm_config_registry: registryUrl,
    },
    resolveExactPnpmExecutableImpl: () => pnpmExecutable,
  });
  const owner = createAcceptanceRuntimeContext({
    browsers: 'isolated',
    environment: { PATH: process.env.PATH },
    expectedPnpmVersion: '11.17.0',
    registryEnv: {
      npm_config_registry: registryUrl,
      pnpm_config_registry: registryUrl,
    },
    resolveExactPnpmExecutableImpl: () => pnpmExecutable,
    workDir: packageManagerRoot,
  });

  // Nothing here is computed twice: every runtime-context value the Tractor
  // context exposes is the owner's value.
  for (const name of [
    'PATH',
    'PLAYWRIGHT_BROWSERS_PATH',
    'XDG_CACHE_HOME',
    'npm_config_cache',
    'npm_config_registry',
    'npm_config_store_dir',
    'pnpm_config_registry',
    'pnpm_config_store_dir',
  ]) {
    assert.equal(packageManager.env[name], owner.env[name], name);
  }
  assert.equal(packageManager.pnpmExecutable, owner.pnpmExecutable);

  // Install/launch coherence, observed rather than reconstructed: the browsers
  // path carried by the env that runs `pnpm exec playwright install` is the
  // path the in-process launch actually sees, and the parent process is
  // restored afterwards.
  const originalBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(
    os.tmpdir(),
    'parent-playwright',
  );
  t.after(() => {
    if (originalBrowsersPath === undefined) {
      delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    } else {
      process.env.PLAYWRIGHT_BROWSERS_PATH = originalBrowsersPath;
    }
  });
  const observedBrowsersPaths = [];
  await launchWorkspaceBrowser(
    {
      browserProvider: {},
      processEnv: packageManager.env,
      workspace: os.tmpdir(),
    },
    {
      launchBrowserImpl: async () => {
        observedBrowsersPaths.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
        return {};
      },
    },
  );
  assert.deepEqual(observedBrowsersPaths, [
    packageManager.env.PLAYWRIGHT_BROWSERS_PATH,
  ]);
  assert.equal(
    observedBrowsersPaths[0].startsWith(
      `${path.join(packageManagerRoot, 'package-manager')}${path.sep}`,
    ),
    true,
    'the launch reads browsers from inside the disposable Tractor root',
  );
  assert.equal(
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.tmpdir(), 'parent-playwright'),
  );

  // The Playwright provisioning stays operational: it is the shared owner's
  // pnpm exec invocation, it runs after the frozen install, and it reports no
  // acceptance check of its own.
  const playwrightCommands = executionCommands.filter(
    entry => entry.command[1][0] === 'exec',
  );
  assert.equal(playwrightCommands.length, 1);
  assert.deepEqual(
    [...playwrightCommands[0].command[1]],
    [...acceptancePlaywrightInstallArgs],
  );
  assert.equal(playwrightCommands[0].report, false);
  assert.equal(
    executionCommands.indexOf(playwrightCommands[0]),
    1,
    'browsers install after the frozen lockfile install resolves them',
  );
});

test('Tractor evidence ids and order are unchanged by runtime-context ownership', async () => {
  const { requiredTractorCheckIds } = await contractPromise;
  const { executionCommands, requiredCommands } = await runnerPromise;

  assert.deepEqual(
    [...requiredTractorCheckIds],
    [
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
    ],
  );
  assert.deepEqual(
    executionCommands
      .filter(entry => entry.report)
      .map(entry => entry.command[1].join('-')),
    [
      'install---frozen-lockfile',
      'check',
      'build',
      'node:proof',
      'cloudflare:build',
    ],
    'every reported command id must still come from a required Tractor command',
  );
  assert.deepEqual(
    executionCommands.filter(entry => entry.report).map(entry => entry.command),
    [...requiredCommands],
  );
});

test('source-candidate rehearsal is bound to a loopback ephemeral registry', async () => {
  const {
    assertAcceptanceRegistry,
    parseArgs,
    promotableTractorAcceptanceMode,
    tractorAcceptanceModes,
  } = await runnerPromise;
  const manifestPath = path.join(os.tmpdir(), 'release', 'manifest.json');

  assert.deepEqual([...tractorAcceptanceModes], ['published', 'source']);
  assert.equal(promotableTractorAcceptanceMode, 'published');

  // The published lane is untouched by the new mode: same default, same
  // registry, and the release dir is still derived from the manifest.
  const published = parseArgs([
    '--manifest',
    manifestPath,
    '--workspace',
    os.tmpdir(),
  ]);
  assert.equal(published.mode, 'published');
  assert.equal(published.registryUrl, 'https://registry.npmjs.org/');
  assert.equal(published.releaseDir, path.dirname(manifestPath));

  // A rehearsal names no registry: the ephemeral one does not exist until this
  // process starts it, and accepting a URL here is exactly how a rehearsal
  // could be pointed at npm.
  const rehearsal = parseArgs([
    '--mode',
    'source',
    '--manifest',
    manifestPath,
    '--workspace',
    os.tmpdir(),
  ]);
  assert.equal(rehearsal.mode, 'source');
  assert.equal(rehearsal.registryUrl, undefined);
  assert.equal(rehearsal.releaseDir, path.dirname(manifestPath));
  assert.throws(
    () =>
      parseArgs([
        '--mode',
        'source',
        '--manifest',
        manifestPath,
        '--workspace',
        os.tmpdir(),
        '--registry-url',
        'https://registry.npmjs.org/',
      ]),
    /--registry-url is decided by the ephemeral registry in source mode/u,
  );
  assert.throws(
    () =>
      parseArgs([
        '--mode',
        'rehearsal',
        '--manifest',
        manifestPath,
        '--workspace',
        os.tmpdir(),
      ]),
    /--mode must be published or source/u,
  );

  // Both directions of the mode/registry pairing fail closed.
  assert.equal(
    assertAcceptanceRegistry('source', 'http://127.0.0.1:4873/'),
    'http://127.0.0.1:4873/',
  );
  assert.throws(
    () => assertAcceptanceRegistry('source', 'https://registry.npmjs.org/'),
    /must target the loopback ephemeral registry/u,
  );
  assert.throws(
    () => assertAcceptanceRegistry('source', 'https://127.0.0.1:4873/'),
    /must target the loopback ephemeral registry/u,
  );
  assert.throws(
    () => assertAcceptanceRegistry('published', 'http://127.0.0.1:4873/'),
    /never the ephemeral rehearsal registry/u,
  );
  assert.throws(
    () => assertAcceptanceRegistry('source', undefined),
    /requires an exact registry URL/u,
  );

  // The acceptance itself settles mode and registry together, before it reads
  // the manifest or touches a workspace: the one `mode` that picks the registry
  // is the same one stamped on the report, so a rehearsal cannot report itself
  // as published or read a published registry.
  const { runTractorDownstreamAcceptance } = await runnerPromise;
  await assert.rejects(
    runTractorDownstreamAcceptance({
      manifestPath: path.join(os.tmpdir(), 'absent', 'manifest.json'),
      mode: 'rehearsal',
      registryUrl: 'http://127.0.0.1:4873/',
    }),
    /Tractor acceptance mode must be published or source, found rehearsal/u,
  );
  await assert.rejects(
    runTractorDownstreamAcceptance({
      manifestPath: path.join(os.tmpdir(), 'absent', 'manifest.json'),
      mode: 'source',
      registryUrl: 'https://registry.npmjs.org/',
    }),
    /must target the loopback ephemeral registry/u,
  );
  await assert.rejects(
    runTractorDownstreamAcceptance({
      manifestPath: path.join(os.tmpdir(), 'absent', 'manifest.json'),
      mode: 'published',
      registryUrl: 'http://127.0.0.1:4873/',
    }),
    /never the ephemeral rehearsal registry/u,
  );
});

test('source-candidate rehearsal seeds only the verified immutable bundle', async t => {
  const {
    parseArgs,
    resolveTractorMinimumReleaseAgeExclude,
    withSourceCandidateRegistry,
  } = await runnerPromise;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tractor-rehearsal-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  const releaseVersion = '3.8.2-ultramodern.15';
  const release = {
    packages: [
      {
        targetName: '@bleedingdev/modern-js-ultramodern-create',
        version: releaseVersion,
      },
      { targetName: '@bleedingdev/modern-js-image', version: releaseVersion },
    ],
    release: { version: releaseVersion },
    // The accepted toolchain the producer recorded. The seeder republishes the
    // accepted bytes through the exact-artifact publisher, which refuses any
    // other Node.js, so the rehearsal must run under this one.
    tools: { node: process.version, npm: '11.10.1', pnpm: '11.17.0' },
    // Sidecars keep their own stable versions and are seeded into the ephemeral
    // registry moments before the install, so their registry publish time is
    // always "now".
    sidecars: {
      packages: [
        { name: '@bleedingdev/ipx', version: '3.1.2' },
        { name: '@bleedingdev/image-size', version: '2.0.2' },
      ],
    },
  };
  const releaseAgePolicyPath = writeReleaseAgePolicy(root, []);
  const now = new Date('2026-08-26T12:00:00.000Z');

  const publishedExclusions = resolveTractorMinimumReleaseAgeExclude({
    mode: 'published',
    release,
    releaseAgePolicyPath,
    now,
  });
  assert.deepEqual(publishedExclusions, [
    `@bleedingdev/modern-js-image@${releaseVersion}`,
    `@bleedingdev/modern-js-ultramodern-create@${releaseVersion}`,
  ]);
  assert.deepEqual(
    resolveTractorMinimumReleaseAgeExclude({
      release,
      releaseAgePolicyPath,
      now,
    }),
    publishedExclusions,
    'the default lane is still the published one',
  );

  assert.deepEqual(
    resolveTractorMinimumReleaseAgeExclude({
      mode: 'source',
      release,
      releaseAgePolicyPath,
      now,
    }),
    [
      '@bleedingdev/image-size@2.0.2',
      '@bleedingdev/ipx@3.1.2',
      `@bleedingdev/modern-js-image@${releaseVersion}`,
      `@bleedingdev/modern-js-ultramodern-create@${releaseVersion}`,
    ],
  );
  assert.throws(
    () =>
      resolveTractorMinimumReleaseAgeExclude({
        mode: 'source',
        release: { ...release, sidecars: { packages: [{ name: 'x' }] } },
        releaseAgePolicyPath,
        now,
      }),
    /must bind an exact name and version/u,
  );

  // The registry lifecycle is the exact-artifact acceptance's own: one fresh
  // instance seeded from the immutable bundle this process downloaded, stopped
  // and removed afterwards, never shared across jobs.
  const options = parseArgs([
    '--mode',
    'source',
    '--manifest',
    path.join(root, 'release', 'manifest.json'),
    '--workspace',
    root,
  ]);
  const starts = [];
  let stopped = 0;
  const observedRegistryUrls = [];
  const observedRegistryEnvs = [];
  const inheritedPath = process.env.PATH;
  let seedPath;
  let actionPath;
  const seededEnv = {
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_userconfig: path.join(root, '.npmrc'),
  };
  const returned = await withSourceCandidateRegistry(
    options,
    (registryUrl, registryEnv) => {
      observedRegistryUrls.push(registryUrl);
      observedRegistryEnvs.push(registryEnv);
      actionPath = process.env.PATH;
      return 'accepted';
    },
    {
      readReleaseManifestImpl: () => release,
      startEphemeralRegistryImpl: async started => {
        starts.push(started);
        seedPath = process.env.PATH;
        assert.equal(fs.existsSync(started.rootDir), true);
        return {
          env: seededEnv,
          registryUrl: 'http://127.0.0.1:4873/',
          stop: () => {
            stopped += 1;
          },
        };
      },
    },
  );
  assert.equal(returned, 'accepted');
  assert.deepEqual(observedRegistryUrls, ['http://127.0.0.1:4873/']);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].release, release);
  assert.equal(starts[0].releaseDir, options.releaseDir);
  assert.equal(stopped, 1);
  assert.equal(fs.existsSync(starts[0].rootDir), false);

  // The seeder's own scoped user config reaches the acceptance verbatim, and
  // nothing in it names a registry globally: only `@<targetScope>` is routed to
  // loopback, so unrelated dependencies are still fetched from npmjs directly.
  assert.deepEqual(observedRegistryEnvs, [seededEnv]);
  assert.notEqual(observedRegistryEnvs[0], seededEnv);
  for (const name of ['npm_config_registry', 'pnpm_config_registry']) {
    assert.equal(observedRegistryEnvs[0][name], undefined, name);
  }

  // The interpreter's own bin dir is on PATH while the registry is seeded -
  // that is where the `npm` the accepted toolchain names lives - and the
  // acceptance that follows runs on the PATH the job gave it, exactly as the
  // published lane does.
  assert.equal(
    seedPath,
    [path.dirname(process.execPath), inheritedPath]
      .filter(Boolean)
      .join(path.delimiter),
  );
  assert.equal(actionPath, inheritedPath);
  assert.equal(process.env.PATH, inheritedPath);

  // A registry that came up anywhere but loopback is refused before any
  // downstream work runs, and is still torn down.
  let escapedRootDir;
  let escapedStops = 0;
  await assert.rejects(
    withSourceCandidateRegistry(options, () => 'must not run', {
      readReleaseManifestImpl: () => release,
      startEphemeralRegistryImpl: async started => {
        escapedRootDir = started.rootDir;
        return {
          env: seededEnv,
          registryUrl: 'https://registry.npmjs.org/',
          stop: () => {
            escapedStops += 1;
          },
        };
      },
    }),
    /must target the loopback ephemeral registry/u,
  );
  assert.equal(escapedStops, 1);
  assert.equal(fs.existsSync(escapedRootDir), false);

  // A registry seeded with a global override never reaches the acceptance
  // either, and is torn down the same way.
  let overriddenStops = 0;
  await assert.rejects(
    withSourceCandidateRegistry(options, () => 'must not run', {
      readReleaseManifestImpl: () => release,
      startEphemeralRegistryImpl: async () => ({
        env: { ...seededEnv, npm_config_registry: 'http://127.0.0.1:4873/' },
        registryUrl: 'http://127.0.0.1:4873/',
        stop: () => {
          overriddenStops += 1;
        },
      }),
    }),
    /must not name a global registry \(npm_config_registry\)/u,
  );
  assert.equal(overriddenStops, 1);

  // The rehearsal refuses to seed under any interpreter but the one the
  // accepted manifest recorded, before a registry is ever started.
  let driftedStarts = 0;
  await assert.rejects(
    withSourceCandidateRegistry(options, () => 'must not run', {
      nodeVersion: 'v20.0.0',
      readReleaseManifestImpl: () => release,
      startEphemeralRegistryImpl: async () => {
        driftedStarts += 1;
        return { registryUrl: 'http://127.0.0.1:4873/', stop: () => {} };
      },
    }),
    new RegExp(
      `must seed under the accepted release Node\\.js ${process.version.replaceAll('.', '\\.')}`,
      'u',
    ),
  );
  assert.equal(driftedStarts, 0);
  await assert.rejects(
    withSourceCandidateRegistry(options, () => 'must not run', {
      readReleaseManifestImpl: () => ({ ...release, tools: undefined }),
      startEphemeralRegistryImpl: async () => {
        driftedStarts += 1;
        return { registryUrl: 'http://127.0.0.1:4873/', stop: () => {} };
      },
    }),
    /requires the accepted release Node\.js version/u,
  );
  assert.equal(driftedStarts, 0);
});

test('source-candidate rehearsal reuses the exact-artifact acceptance seeder', async () => {
  const { sourceCandidateRegistryPath } = await runnerPromise;
  const registry = await import(
    '../../ultramodern-publish/lib/source-create-proof/runtime-proof/registry.mjs'
  );

  // The rehearsal reuses the seeder the exact-artifact acceptance already owns:
  // exact accepted tarball bytes, strictly in release publishOrder, sidecars
  // first, with registry integrity and shasum re-read afterwards.
  assert.equal(typeof registry.startEphemeralRegistry, 'function');
  assert.equal(typeof registry.publishReleaseTarballs, 'function');
  assert.equal(typeof registry.publishStagedSidecars, 'function');

  // The seeder spawns bare `pnpm`, so a provisioned manifest pnpm wins over the
  // ambient PATH; a local run without one still gets the seeding interpreter's
  // own bin dir (where its bundled npm lives) ahead of the inherited PATH.
  const execPath = '/opt/node-26.7.0/bin/node';
  assert.equal(
    sourceCandidateRegistryPath({ PATH: '/usr/bin' }, execPath),
    ['/opt/node-26.7.0/bin', '/usr/bin'].join(path.delimiter),
  );
  assert.equal(
    sourceCandidateRegistryPath(
      {
        PATH: '/usr/bin',
        ULTRAMODERN_PNPM_EXECUTABLE: '/opt/pnpm-11.17.0/bin/pnpm',
      },
      execPath,
    ),
    ['/opt/pnpm-11.17.0/bin', '/opt/node-26.7.0/bin', '/usr/bin'].join(
      path.delimiter,
    ),
  );
  assert.throws(
    () =>
      sourceCandidateRegistryPath(
        {
          PATH: '/usr/bin',
          ULTRAMODERN_PNPM_EXECUTABLE: 'pnpm',
        },
        execPath,
      ),
    /must be absolute/u,
  );
  assert.throws(
    () => sourceCandidateRegistryPath({ PATH: '/usr/bin' }, 'node'),
    /Source-candidate seeding interpreter must be absolute/u,
  );
});
