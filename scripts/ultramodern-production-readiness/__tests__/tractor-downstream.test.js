const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProcessEnv, runCommand } = require('../../lib/process-kit');

const cohortInstallPromise = import('../tractor-downstream/cohort-install.mjs');
const runnerPromise = import('../tractor-downstream/main.mjs');

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
        '@modern-js/runtime': 'catalog:ultramodern',
      },
    })}\n`,
  );
  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    "catalogs:\n  ultramodern:\n    '@modern-js/runtime': npm:@bleedingdev/modern-js-runtime@3.5.0-ultramodern.50\n",
  );
  fs.mkdirSync(path.join(root, 'node_modules/@modern-js/ultramodern-create'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, 'node_modules/@modern-js/runtime'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, 'node_modules/@modern-js/runtime/package.json'),
    JSON.stringify({
      name: '@bleedingdev/modern-js-runtime',
      version: '3.5.0-ultramodern.50',
    }),
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
  fs.writeFileSync(
    path.join(
      root,
      'node_modules/@modern-js/ultramodern-create/release-cohort.json',
    ),
    `${JSON.stringify(projection)}\n`,
  );
}

const bootstrapVersion = '3.5.0-ultramodern.77';
const bootstrapSpecifier = `@bleedingdev/modern-js-ultramodern-create@${bootstrapVersion}`;
const bootstrapExclude = [bootstrapSpecifier];
const exactPnpmExecutable = '/opt/pnpm-11.17.0/bin/pnpm';

function packageManagerOptions(overrides) {
  return {
    createPackage: {
      bootstrapReleaseAgePolicy: {
        minimumReleaseAge: 1440,
        minimumReleaseAgeExclude: bootstrapExclude,
        minimumReleaseAgeIgnoreMissingTime: false,
        minimumReleaseAgeStrict: true,
      },
      exactSpecifier: bootstrapSpecifier,
      version: bootstrapVersion,
    },
    expectedPnpmVersion: '11.17.0',
    minimumReleaseAgeExclude: bootstrapExclude,
    registryEnv: {
      npm_config_registry: 'https://registry.npmjs.org/',
      pnpm_config_registry: 'https://registry.npmjs.org/',
    },
    resolveExactPnpmExecutableImpl: () => exactPnpmExecutable,
    ...overrides,
  };
}

test('native catalog and installed framework bind to the exact release', async () => {
  const {
    assertAuthenticatedTractorCohort,
    assertExactModernDependencySpecifiers,
  } = await cohortInstallPromise;
  const root = fixture();
  try {
    writeAuthenticatedCohort(root);
    assert.equal(
      assertAuthenticatedTractorCohort(root, release).catalogCount,
      1,
    );
    assert.equal(
      assertExactModernDependencySpecifiers(root, release).length,
      1,
    );
    fs.mkdirSync(path.join(root, '.modernjs'));
    fs.writeFileSync(path.join(root, '.modernjs/release-cohort.json'), '{}');
    assert.throws(
      () => assertAuthenticatedTractorCohort(root, release),
      /still carries retired/u,
    );
    fs.rmSync(path.join(root, '.modernjs'), { recursive: true });
    const catalogPath = path.join(root, 'pnpm-workspace.yaml');
    const catalogText = fs.readFileSync(catalogPath, 'utf8');
    fs.writeFileSync(
      catalogPath,
      catalogText.replace('3.5.0-ultramodern.50', '3.5.0-ultramodern.49'),
    );
    assert.throws(
      () => assertAuthenticatedTractorCohort(root, release),
      /catalog.*exact release/u,
    );
    fs.writeFileSync(catalogPath, catalogText);
    const manifestPath = path.join(root, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.dependencies['@modern-js/runtime'] =
      'npm:@bleedingdev/modern-js-runtime@3.5.0-ultramodern.50';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
      () => assertExactModernDependencySpecifiers(root, release),
      /must use catalog:ultramodern/u,
    );
    manifest.dependencies['@modern-js/runtime'] = 'catalog:ultramodern';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    fs.writeFileSync(
      path.join(root, 'node_modules/@modern-js/runtime/package.json'),
      JSON.stringify({
        name: '@bleedingdev/modern-js-runtime',
        version: '3.5.0-ultramodern.49',
      }),
    );
    assert.throws(
      () => assertExactModernDependencySpecifiers(root, release),
      /installed identity\/version differs/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release-age exclusions are exact specifiers, sorted as specifiers, and reach pnpm dlx', async t => {
  const { createTractorPnpmDlxArgs, resolveTractorMinimumReleaseAgeExclude } =
    await runnerPromise;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tractor-dlx-policy-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  const releaseVersion = '3.8.2-ultramodern.15';
  // `-` sorts before `@`, so these two names sort differently as names than as
  // full `name@version` specifiers; pnpm only accepts the specifier order.
  const strictRelease = {
    packages: [
      { targetName: '@bleedingdev/modern-js-plugin', version: releaseVersion },
      {
        targetName: '@bleedingdev/modern-js-plugin-testing',
        version: releaseVersion,
      },
      {
        targetName: '@bleedingdev/modern-js-ultramodern-create',
        version: releaseVersion,
      },
    ],
    release: { version: releaseVersion },
  };
  const expected = [
    '@bleedingdev/modern-js-plugin-testing@3.8.2-ultramodern.15',
    '@bleedingdev/modern-js-plugin@3.8.2-ultramodern.15',
    '@bleedingdev/modern-js-ultramodern-create@3.8.2-ultramodern.15',
    '@rspack/core@2.2.0',
  ];

  // An empty policy must not resurrect retired third-party exceptions into a
  // release install.
  assert.deepEqual(
    resolveTractorMinimumReleaseAgeExclude({
      release: strictRelease,
      releaseAgePolicyPath: writeReleaseAgePolicy(root, []),
      now: new Date('2026-08-26T12:00:00.000Z'),
    }),
    expected.filter(selector => selector.startsWith('@bleedingdev/')),
  );

  const minimumReleaseAgeExclude = resolveTractorMinimumReleaseAgeExclude({
    release: strictRelease,
    releaseAgePolicyPath: writeReleaseAgePolicy(root, [
      releaseAgeEntry('@rspack/core@2.2.0'),
    ]),
    now: new Date('2026-08-26T12:00:00.000Z'),
  });
  assert.deepEqual(minimumReleaseAgeExclude, expected);

  const args = createTractorPnpmDlxArgs(
    {
      bootstrapReleaseAgePolicy: {
        minimumReleaseAge: 1440,
        minimumReleaseAgeExclude: [
          `@bleedingdev/modern-js-ultramodern-create@${releaseVersion}`,
        ],
        minimumReleaseAgeIgnoreMissingTime: false,
        minimumReleaseAgeStrict: true,
      },
      exactSpecifier: `@bleedingdev/modern-js-ultramodern-create@${releaseVersion}`,
      version: releaseVersion,
    },
    minimumReleaseAgeExclude,
    ['ultramodern', 'validate'],
  );
  assert.deepEqual(
    args.filter(argument =>
      argument.startsWith('--config.minimum-release-age-exclude='),
    ),
    expected.map(
      selector => `--config.minimum-release-age-exclude=${selector}`,
    ),
  );
  assert.deepEqual(args.slice(-2), ['ultramodern', 'validate']);
});

test('Tractor bootstrap rejects wildcard, future-dated and unbound release-age approvals', async t => {
  const { resolveTractorMinimumReleaseAgeExclude } = await runnerPromise;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tractor-dlx-invalid-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const now = new Date('2026-08-26T12:00:00.000Z');
  const strictRelease = {
    packages: [
      {
        targetName: '@bleedingdev/modern-js-ultramodern-create',
        version: '3.8.2-ultramodern.15',
      },
    ],
    release: { version: '3.8.2-ultramodern.15' },
  };

  assert.throws(
    () =>
      resolveTractorMinimumReleaseAgeExclude({
        release: strictRelease,
        releaseAgePolicyPath: writeReleaseAgePolicy(root, [
          releaseAgeEntry('@rspack/core@2.2.0', { package: '@rspack/*' }),
        ]),
        now,
      }),
    /must be one exact npm package name/u,
  );

  assert.throws(
    () =>
      resolveTractorMinimumReleaseAgeExclude({
        release: strictRelease,
        releaseAgePolicyPath: writeReleaseAgePolicy(root, [
          releaseAgeEntry('@rspack/core@2.2.0', {
            expiresAt: '2026-08-28T12:00:00.000Z',
            reviewedAt: '2026-08-27T12:00:00.000Z',
          }),
        ]),
        now,
      }),
    /reviewedAt must not be in the future/u,
  );

  assert.throws(
    () =>
      resolveTractorMinimumReleaseAgeExclude({
        release: {
          ...strictRelease,
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

test('runner CLI has no bypass flag and builds a hermetic package-manager env', async () => {
  const { createTractorPackageManagerContext, parseArgs } = await runnerPromise;
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
  const packageManager = createTractorPackageManagerContext(
    packageManagerOptions({
      packageManagerRoot,
      runImpl: () => {
        throw new Error('resolver stub must own executable discovery');
      },
    }),
  );
  // The resolved pnpm wins over anything already on PATH, the install stays
  // aged and strict, and no trust-policy escape hatch reaches the child.
  assert.equal(packageManager.pnpmExecutable, exactPnpmExecutable);
  assert.equal(
    packageManager.env.PATH.split(path.delimiter)[0],
    path.dirname(exactPnpmExecutable),
  );
  assert.equal(
    packageManager.env.pnpm_config_minimum_release_age_exclude,
    JSON.stringify(bootstrapExclude),
  );
  assert.equal(packageManager.env.pnpm_config_minimum_release_age, '1440');
  assert.equal(
    packageManager.env.pnpm_config_minimum_release_age_strict,
    'true',
  );
  assert.equal(packageManager.env.pnpm_config_trust_policy_exclude, undefined);
});

test('runner rejects inherited release-age bypasses and preserves verified source selectors', async () => {
  const { createTractorPackageManagerContext } = await runnerPromise;
  // One representative per casing family: the child env is filtered
  // case-insensitively, so a poisoned parent cannot widen the install.
  const inheritedKeys = [
    'NPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE',
    'npm_config_trust_policy_exclude',
    'PnPm_Config_Minimum_Release_Age_Exclude',
    'pnpm_config_trust_policy_exclude',
  ];
  const inherited = Object.fromEntries(
    inheritedKeys.map(name => [name, process.env[name]]),
  );
  try {
    for (const name of inheritedKeys) {
      process.env[name] = '*';
    }
    for (const sourceSelectors of [
      undefined,
      JSON.stringify(bootstrapExclude),
    ]) {
      const packageManager = createTractorPackageManagerContext(
        packageManagerOptions({
          packageManagerRoot: path.join(
            os.tmpdir(),
            'tractor-poisoned-package-manager-context',
          ),
          registryEnv: {
            npm_config_registry: 'https://registry.npmjs.org/',
            pnpm_config_registry: 'https://registry.npmjs.org/',
            PNPM_CONFIG_TRUST_POLICY_EXCLUDE: sourceSelectors,
          },
        }),
      );
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
        ...(sourceSelectors && {
          pnpm_config_trust_policy_exclude: sourceSelectors,
        }),
        pnpm_config_minimum_release_age_exclude:
          JSON.stringify(bootstrapExclude),
      });
    }
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
        styling: { federation: { rootSelector: '[data-app-id="explore"]' } },
      },
      baseUrl: 'http://localhost:3021',
      routes: { distributedSsr: '/en', ssr: '/en' },
    },
    {
      app: {
        id: 'shell-super-app',
        kind: 'shell',
        moduleFederation: { verticalRefs: ['explore'] },
        styling: {
          federation: { rootSelector: '[data-app-id="shell-super-app"]' },
        },
      },
      baseUrl: 'http://localhost:3020',
      routes: { distributedSsr: '/en/tractors/CL-08-GR', ssr: '/en' },
    },
  ];
  const pass = type => ({ status: 'pass', type });
  const validateHttpTargetImpl = async target => [
    pass('ssr-route'),
    pass('ui-marker-html'),
    pass('css-root-marker'),
    ...(target.app.api ? [pass('effect-readiness')] : []),
  ];
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

  const prove = overrides =>
    proveNodeServerRenderedSsr({
      artifactDir: root,
      browser: {},
      targets,
      validateHttpTargetImpl,
      validateNoJavaScriptSsrTargetImpl: validNoJavaScriptSsr,
      ...overrides,
    });

  try {
    assert.equal((await prove({})).status, 'pass');

    // A shell that renders none of its verticals with JavaScript disabled.
    await assert.rejects(
      () =>
        prove({
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

    // An empty server-rendered document that only hydrates client-side.
    await assert.rejects(
      () =>
        prove({
          validateHttpTargetImpl: async target => [
            pass('ssr-route'),
            pass('css-root-marker'),
            ...(target.app.api ? [pass('effect-readiness')] : []),
          ],
        }),
      /missing required ui-marker-html evidence/u,
    );

    // Proving SSR on the shell's own landing route instead of a federated one.
    const csrOnlyTargets = structuredClone(targets);
    csrOnlyTargets[1].routes.distributedSsr = csrOnlyTargets[1].routes.ssr;
    await assert.rejects(
      () => prove({ targets: csrOnlyTargets }),
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
  const writeProof = proof =>
    fs.writeFileSync(evidencePath, `${JSON.stringify(proof)}\n`);
  try {
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.mkdirSync(path.join(root, 'topology'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'topology/reference-topology.json'),
      `${JSON.stringify({
        verticals: [
          { api: {}, id: 'explore', kind: 'vertical' },
          { api: {}, id: 'decide', kind: 'vertical' },
          { api: {}, id: 'checkout', kind: 'vertical' },
          { id: 'content', kind: 'vertical' },
        ],
      })}\n`,
    );

    // A skipped backend run must never read as proof.
    writeProof({ results: [], status: 'skipped' });
    assert.throws(
      () => readPassingNodeBackendProof(root),
      /was skipped or has no executed results/u,
    );

    // Silently dropping API-bearing verticals must not pass either.
    writeProof({
      results: [{ appId: 'explore', status: 'pass' }],
      status: 'pass',
    });
    assert.throws(
      () => readPassingNodeBackendProof(root),
      /app set must exactly match API-bearing MicroVerticals/u,
    );

    // A top-level `pass` must not outrank a failing per-app result.
    writeProof({
      results: [
        { appId: 'explore', status: 'pass' },
        { appId: 'decide', status: 'fail' },
        { appId: 'checkout', status: 'pass' },
      ],
      status: 'pass',
    });
    assert.throws(
      () => readPassingNodeBackendProof(root),
      /duplicate, malformed, or failing results/u,
    );

    writeProof({
      results: [
        { appId: 'explore', status: 'pass' },
        { appId: 'decide', status: 'pass' },
        { appId: 'checkout', status: 'pass' },
      ],
      status: 'pass',
    });
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

test('Tractor stops on formatter failure without reporting format or running checks/builds', async () => {
  const { executeTractorCommands } = await runnerPromise;
  const report = { checks: [] };
  const calls = [];
  const failure = new Error('consumer formatter rejected a source file');
  const iterator = executeTractorCommands({
    workspace: '/tractor-format-failure-fixture',
    env: {},
    report,
    runImpl(command, args) {
      calls.push([command, ...args]);
      if (args[0] === 'format') throw failure;
    },
  });
  assert.throws(
    () => Array.from(iterator),
    error => error === failure,
  );
  assert.deepEqual(calls, [
    ['pnpm', 'install', '--frozen-lockfile'],
    ['pnpm', 'exec', 'playwright', 'install', '--with-deps', 'chromium'],
    ['pnpm', 'format'],
  ]);
  assert.deepEqual(
    report.checks.map(check => check.id),
    ['install---frozen-lockfile'],
  );
});

test('source-candidate rehearsal is bound to a loopback ephemeral registry', async () => {
  const {
    assertAcceptanceRegistry,
    parseArgs,
    runTractorDownstreamAcceptance,
  } = await runnerPromise;
  const manifestPath = path.join(os.tmpdir(), 'release', 'manifest.json');
  const argv = (...extra) => [
    '--manifest',
    manifestPath,
    '--workspace',
    os.tmpdir(),
    ...extra,
  ];

  // The published lane keeps its npmjs default.
  const published = parseArgs(argv());
  assert.equal(published.mode, 'published');
  assert.equal(published.registryUrl, 'https://registry.npmjs.org/');

  // A rehearsal names no registry: accepting a URL here is exactly how a
  // rehearsal could be pointed at real npm.
  const rehearsal = parseArgs(argv('--mode', 'source'));
  assert.equal(rehearsal.mode, 'source');
  assert.equal(rehearsal.registryUrl, undefined);
  assert.throws(
    () =>
      parseArgs(
        argv(
          '--mode',
          'source',
          '--registry-url',
          'https://registry.npmjs.org/',
        ),
      ),
    /--registry-url is decided by the ephemeral registry in source mode/u,
  );
  assert.throws(
    () => parseArgs(argv('--mode', 'rehearsal')),
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
    () => assertAcceptanceRegistry('published', 'http://127.0.0.1:4873/'),
    /never the ephemeral rehearsal registry/u,
  );

  // The acceptance settles mode and registry together, before it reads the
  // manifest or touches a workspace, so a rehearsal cannot reach real npm.
  await assert.rejects(
    runTractorDownstreamAcceptance({
      manifestPath: path.join(os.tmpdir(), 'absent', 'manifest.json'),
      mode: 'source',
      registryUrl: 'https://registry.npmjs.org/',
    }),
    /must target the loopback ephemeral registry/u,
  );
});

test('source-candidate rehearsal tears down its registry and refuses an escaped one', async t => {
  const { parseArgs, withSourceCandidateRegistry } = await runnerPromise;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tractor-rehearsal-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  const releaseVersion = '3.8.2-ultramodern.15';
  const rehearsalRelease = {
    packages: [
      {
        targetName: '@bleedingdev/modern-js-ultramodern-create',
        version: releaseVersion,
      },
    ],
    release: { version: releaseVersion },
    tools: { node: process.version, npm: '11.10.1', pnpm: '11.17.0' },
  };
  const options = parseArgs([
    '--mode',
    'source',
    '--manifest',
    path.join(root, 'release', 'manifest.json'),
    '--workspace',
    root,
  ]);
  const seededEnv = {
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_userconfig: path.join(root, '.npmrc'),
  };

  const starts = [];
  let stopped = 0;
  const observedRegistryEnvs = [];
  const returned = await withSourceCandidateRegistry(
    options,
    (registryUrl, registryEnv) => {
      assert.equal(registryUrl, 'http://127.0.0.1:4873/');
      observedRegistryEnvs.push(registryEnv);
      return 'accepted';
    },
    {
      readReleaseManifestImpl: () => rehearsalRelease,
      startEphemeralRegistryImpl: async started => {
        starts.push(started);
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
  assert.equal(starts.length, 1);
  assert.equal(stopped, 1);
  assert.equal(fs.existsSync(starts[0].rootDir), false);

  // The seeder's scoped user config reaches the acceptance verbatim, and
  // nothing in it names a registry globally, so unrelated dependencies are
  // still fetched from npmjs.
  assert.deepEqual(observedRegistryEnvs, [seededEnv]);
  for (const name of ['npm_config_registry', 'pnpm_config_registry']) {
    assert.equal(observedRegistryEnvs[0][name], undefined, name);
  }

  // A registry that came up anywhere but loopback is refused before any
  // downstream work runs, and is still torn down.
  let escapedRootDir;
  let escapedStops = 0;
  await assert.rejects(
    withSourceCandidateRegistry(options, () => 'must not run', {
      readReleaseManifestImpl: () => rehearsalRelease,
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

  // A registry seeded with a global override never reaches the acceptance.
  let overriddenStops = 0;
  await assert.rejects(
    withSourceCandidateRegistry(options, () => 'must not run', {
      readReleaseManifestImpl: () => rehearsalRelease,
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
      readReleaseManifestImpl: () => rehearsalRelease,
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
});

test('cohort installation updates native catalog to exact bundle without changing authored Tractor source', async () => {
  const { prepareTractorCohortInstallation } = await import(
    '../tractor-downstream/cohort-install.mjs'
  );
  const root = fixture();
  try {
    writeAuthenticatedCohort(root);
    const next = structuredClone(release);
    next.release.version = '3.9.0-ultramodern.6';
    next.publishOrder = Object.values(next.aliases);
    next.cohortProjection.value.release.version = next.release.version;
    next.cohortProjection.value.packages[0].version = next.release.version;
    const { inspectNpmTarball } = await import(
      '../../ultramodern-publish/lib/prepare-bleedingdev-packages/release-artifacts.mjs'
    );
    const { createTemplateRequiredFiles } = await import(
      '../../ultramodern-publish/lib/prepare-bleedingdev-packages/constants.mjs'
    );
    const packageDir = path.join(root, 'candidate/package');
    fs.mkdirSync(packageDir, { recursive: true });
    for (const relativePath of createTemplateRequiredFiles) {
      const file = path.join(packageDir, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'candidate template content');
    }
    fs.writeFileSync(
      path.join(packageDir, 'release-cohort.json'),
      JSON.stringify(next.cohortProjection.value),
    );
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: '@bleedingdev/modern-js-ultramodern-create',
        version: next.release.version,
        publishConfig: { access: 'public' },
      }),
    );
    const artifactPath = path.join(root, 'candidate.tgz');
    const priorCopyfile = process.env.COPYFILE_DISABLE;
    process.env.COPYFILE_DISABLE = '1';
    try {
      runCommand('tar', [
        '-czf',
        artifactPath,
        '-C',
        path.dirname(packageDir),
        'package',
      ]);
    } finally {
      if (priorCopyfile === undefined) delete process.env.COPYFILE_DISABLE;
      else process.env.COPYFILE_DISABLE = priorCopyfile;
    }
    const bytes = fs.readFileSync(artifactPath);
    next.createPackage = {
      ...inspectNpmTarball(bytes),
      sourceName: '@modern-js/ultramodern-create',
      targetName: '@bleedingdev/modern-js-ultramodern-create',
      version: next.release.version,
      artifactPath,
      size: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      shasum: crypto.createHash('sha1').update(bytes).digest('hex'),
      integrity: `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`,
    };
    const uiFile = path.join(
      root,
      'apps/shell-super-app/locales/en/shell.json',
    );
    const beforeUi = fs.readFileSync(uiFile, 'utf8');
    const beforeManifest = fs.readFileSync(
      path.join(root, 'package.json'),
      'utf8',
    );
    const result = prepareTractorCohortInstallation(root, next);
    assert.equal(result.dependencyCount, 1);
    assert.match(
      fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'),
      /npm:@bleedingdev\/modern-js-runtime@3\.9\.0-ultramodern\.6/u,
    );
    assert.equal(fs.readFileSync(uiFile, 'utf8'), beforeUi);
    assert.equal(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
      beforeManifest,
    );
    assert.equal(
      fs.existsSync(path.join(root, '.modernjs/ultramodern.json')),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(root, '.modernjs/release-cohort.json')),
      false,
    );
    fs.appendFileSync(artifactPath, 'tampered');
    assert.throws(
      () => prepareTractorCohortInstallation(root, next),
      /tarball size mismatch/u,
    );
    fs.writeFileSync(artifactPath, bytes);
    const manifest = JSON.parse(beforeManifest);
    manifest.dependencies['@modern-js/unknown'] = 'catalog:ultramodern';
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
    const beforeRejectedPolicy = fs.readFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      'utf8',
    );
    assert.throws(
      () => prepareTractorCohortInstallation(root, next),
      /absent from the release cohort/u,
    );
    assert.equal(
      fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'),
      beforeRejectedPolicy,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
