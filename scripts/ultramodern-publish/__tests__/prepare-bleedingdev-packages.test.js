// Consumer: publish-bleedingdev.yml staging, publication, and registry gates.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '../../..');
const requireFromCreate = createRequire(
  path.join(repoRoot, 'packages/toolkit/create/package.json'),
);
const requireFromUltramodernCreate = createRequire(
  path.join(repoRoot, 'packages/toolkit/ultramodern-create/package.json'),
);
const sourceFrameworkVersion = requireFromCreate('./package.json').version;
const fixtureReleaseVersion = `${sourceFrameworkVersion}-ultramodern.1`;
const { yaml } = requireFromUltramodernCreate('@modern-js/utils');
const scriptPath = path.join(
  repoRoot,
  'scripts/ultramodern-publish/prepare-bleedingdev-packages.mjs',
);

const createTemplateRequiredFiles = [
  'template-workspace/.agents/agent-reference-repos.json',
  'template-workspace/.codex/rstackjs-agent-skills-LICENSE',
  'template-workspace/.codex/skills-lock.json',
  'template-workspace/.codex/hooks.json',
  'template-workspace/.github/renovate.json',
  'template-workspace/.github/workflows/ultramodern-workspace-gates.yml.handlebars',
  'template-workspace/.gitignore.handlebars',
  'template-workspace/.mise.toml.handlebars',
];

const makeTempDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'modern-prepare-publish-'));

const removeDir = directory => {
  fs.rmSync(directory, { recursive: true, force: true });
};

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeFile = (filePath, contents = 'fixture\n') => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

const makeCreateFixture = ({ includeTemplateDotFiles }) => {
  const root = makeTempDir();
  const packageDir = path.join(root, 'packages/create/package');
  writeJson(path.join(packageDir, 'package.json'), {
    name: '@bleedingdev/modern-js-ultramodern-create',
    version: fixtureReleaseVersion,
    publishConfig: {
      access: 'public',
    },
  });
  if (includeTemplateDotFiles) {
    for (const relativePath of createTemplateRequiredFiles) {
      writeFile(path.join(packageDir, relativePath));
    }
  }

  writeJson(path.join(root, 'manifest.json'), {
    schemaVersion: 1,
    generatedAt: '2026-06-04T00:00:00.000Z',
    scope: 'bleedingdev',
    prefix: 'modern-js-',
    version: fixtureReleaseVersion,
    dependencyVersion: fixtureReleaseVersion,
    tag: 'latest',
    aliases: {
      '@modern-js/ultramodern-create':
        '@bleedingdev/modern-js-ultramodern-create',
    },
    packages: [
      {
        sourceName: '@modern-js/ultramodern-create',
        targetName: '@bleedingdev/modern-js-ultramodern-create',
        version: fixtureReleaseVersion,
        packageDir: path.relative(repoRoot, packageDir),
      },
    ],
  });

  return root;
};

const runPublishExisting = (outDir, env = process.env) =>
  spawnSync(
    process.execPath,
    [
      scriptPath,
      '--publish-existing',
      '--version',
      fixtureReleaseVersion,
      '--out',
      outDir,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env,
    },
  );

test('release package rewriting canonicalizes dependency metadata order', async () => {
  const { rewritePackageJson } = await import(
    '../lib/prepare-bleedingdev-packages/rewrite.mjs'
  );
  const sourceNames = new Set([
    '@modern-js/rslib',
    '@modern-js/types',
    '@modern-js/utils',
  ]);
  const options = {
    bugsUrl: 'https://github.com/BleedingDev/ultramodern.js/issues',
    dependencyVersion: '3.5.0-ultramodern.75',
    homepage: 'https://github.com/BleedingDev/ultramodern.js',
    prefix: 'modern-js-',
    repositoryUrl: 'git+https://github.com/BleedingDev/ultramodern.js.git',
    scope: 'bleedingdev',
    version: '3.5.0-ultramodern.75',
  };
  const packageJson = dependencyOrder => ({
    name: '@modern-js/utils',
    version: '3.5.0',
    devDependencies: Object.fromEntries(
      dependencyOrder.map(name => [
        name,
        name.startsWith('@modern-js/') ? 'workspace:*' : '2.66.0',
      ]),
    ),
    peerDependenciesMeta: Object.fromEntries(
      [...dependencyOrder].reverse().map(name => [name, { optional: true }]),
    ),
  });
  const first = packageJson([
    '@modern-js/types',
    '@scripts/rstest-config',
    '@modern-js/rslib',
  ]);
  const second = packageJson([
    '@modern-js/rslib',
    '@scripts/rstest-config',
    '@modern-js/types',
  ]);

  rewritePackageJson(first, '@modern-js/utils', options, sourceNames);
  rewritePackageJson(second, '@modern-js/utils', options, sourceNames);

  assert.equal(
    `${JSON.stringify(first, null, 2)}\n`,
    `${JSON.stringify(second, null, 2)}\n`,
    'semantically identical release package metadata must produce identical bytes',
  );
  assert.deepEqual(Object.keys(first.devDependencies), [
    '@modern-js/rslib',
    '@modern-js/types',
    '@scripts/rstest-config',
  ]);
  assert.deepEqual(Object.keys(first.peerDependenciesMeta), [
    '@modern-js/rslib',
    '@modern-js/types',
    '@scripts/rstest-config',
  ]);
});

test('release metadata binds frameworkVersion only to the fork-owned generator', async () => {
  const { rewritePackageJson } = await import(
    '../lib/prepare-bleedingdev-packages/rewrite.mjs'
  );
  const options = {
    bugsUrl: 'https://github.com/BleedingDev/ultramodern.js/issues',
    dependencyVersion: '3.8.3-ultramodern.7',
    homepage: 'https://github.com/BleedingDev/ultramodern.js',
    prefix: 'modern-js-',
    repositoryUrl: 'git+https://github.com/BleedingDev/ultramodern.js.git',
    scope: 'bleedingdev',
    version: '3.8.3-ultramodern.7',
  };
  const sourceNames = new Set(['@modern-js/ultramodern-create']);
  const generator = {};
  const upstreamAnchor = {};

  rewritePackageJson(
    generator,
    '@modern-js/ultramodern-create',
    options,
    sourceNames,
  );
  rewritePackageJson(upstreamAnchor, '@modern-js/create', options, sourceNames);

  assert.equal(
    generator.ultramodern.frameworkVersion,
    options.dependencyVersion,
  );
  assert.equal(upstreamAnchor.ultramodern, undefined);
});

test('release cohort version base matches the incorporated Modern.js source', async () => {
  const { enforceSingleVersionPolicy } = await import(
    '../lib/prepare-bleedingdev-packages/rewrite.mjs'
  );
  const packages = [
    {
      packageJson: {
        name: '@modern-js/create',
        version: '3.8.1',
      },
    },
    {
      packageJson: {
        name: '@modern-js/plugin-tanstack',
        version: '3.2.0',
      },
    },
  ];

  assert.doesNotThrow(() =>
    enforceSingleVersionPolicy(
      {
        dependencyVersion: '3.8.1-ultramodern.1',
        version: '3.8.1-ultramodern.1',
      },
      packages,
      packages,
    ),
  );
  assert.throws(
    () =>
      enforceSingleVersionPolicy(
        {
          dependencyVersion: '3.5.0-ultramodern.103',
          version: '3.5.0-ultramodern.103',
        },
        packages,
        packages,
      ),
    /release base 3\.5\.0 does not match the incorporated Modern\.js source version 3\.8\.1/i,
  );
  assert.throws(
    () =>
      enforceSingleVersionPolicy(
        {
          dependencyVersion: '3.8.1',
          version: '3.8.1',
        },
        packages,
        packages,
      ),
    /must use the form 3\.8\.1-ultramodern\.<revision>/i,
  );
  assert.throws(
    () =>
      enforceSingleVersionPolicy(
        {
          dependencyVersion: '3.8.1-ultramodern.0',
          version: '3.8.1-ultramodern.0',
        },
        packages,
        packages,
      ),
    /must use the form 3\.8\.1-ultramodern\.<revision>/i,
  );
  assert.throws(
    () =>
      enforceSingleVersionPolicy(
        {
          dependencyVersion: '3.8.1-ultramodern.1',
          version: '3.8.1-ultramodern.1',
        },
        packages.slice(1),
        packages.slice(1),
      ),
    /cannot determine the incorporated Modern\.js source version/i,
  );
});

test('publish selection retains upstream create only as the version anchor', async () => {
  const { collectModernPackages } = await import(
    '../lib/prepare-bleedingdev-packages/rewrite.mjs'
  );
  const selection = collectModernPackages({
    prefix: 'modern-js-',
    scope: 'bleedingdev',
  });

  assert(
    selection.allPackages.some(
      item => item.packageJson.name === '@modern-js/create',
    ),
    'the incorporated upstream create package must remain available as the release-base anchor',
  );
  assert.equal(selection.aliases['@modern-js/create'], undefined);
  assert.equal(
    selection.packages.some(
      item => item.packageJson.name === '@modern-js/create',
    ),
    false,
  );
  assert.equal(
    selection.aliases['@modern-js/ultramodern-create'],
    '@bleedingdev/modern-js-ultramodern-create',
  );
  assert.equal(
    selection.packages.filter(
      item => item.packageJson.name === '@modern-js/ultramodern-create',
    ).length,
    1,
  );
});

test('RSC remains an explicit optional toolchain and is absent from the release cohort', () => {
  const upstreamRuntime = '0.1.0';
  const frameworkContracts = [
    {
      path: 'packages/cli/builder/package.json',
      optionalPeers: {
        'react-server-dom-rspack': upstreamRuntime,
        'rsbuild-plugin-rsc': '0.1.1',
      },
    },
    {
      path: 'packages/runtime/render/package.json',
      optionalPeers: { 'react-server-dom-rspack': upstreamRuntime },
    },
    {
      path: 'packages/runtime/plugin-tanstack/package.json',
      optionalPeers: { 'react-server-dom-rspack': upstreamRuntime },
    },
  ];

  for (const { path: relativePath, optionalPeers } of frameworkContracts) {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
    );
    for (const [packageName, version] of Object.entries(optionalPeers)) {
      assert.equal(
        packageJson.dependencies?.[packageName],
        undefined,
        `${relativePath} must not install ${packageName} for non-RSC consumers`,
      );
      assert.equal(packageJson.devDependencies?.[packageName], version);
      assert.equal(packageJson.peerDependencies?.[packageName], version);
      assert.equal(
        packageJson.peerDependenciesMeta?.[packageName]?.optional,
        true,
      );
    }
  }

  for (const relativePath of [
    'tests/integration/routes-tanstack-rsc/package.json',
    'tests/integration/rsc-csr-app/package.json',
    'tests/integration/rsc-csr-routes/package.json',
    'tests/integration/rsc-ssr-app/package.json',
    'tests/integration/rsc-ssr-routes/package.json',
    'tests/integration/ssr/fixtures/rsc-closing-tags/package.json',
  ]) {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
    );
    assert.equal(
      packageJson.dependencies?.['react-server-dom-rspack'],
      upstreamRuntime,
      `${relativePath} must exercise the audited upstream runtime directly`,
    );
  }

  assert.equal(
    fs.existsSync(
      path.join(
        repoRoot,
        'packages/runtime/react-server-dom-rspack/package.json',
      ),
    ),
    false,
    'the Modern.js release cohort must not contain a temporary RSDR package',
  );
});

const makeManifest = () => ({
  source: releaseSource,
  release: {
    tag: 'latest',
    version: '3.2.0-ultramodern.1',
  },
  aliases: {
    '@modern-js/ultramodern-create':
      '@bleedingdev/modern-js-ultramodern-create',
    '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
  },
  dependencyGraph: {
    '@bleedingdev/modern-js-ultramodern-create': [],
    '@bleedingdev/modern-js-runtime': [],
  },
  publishOrder: [
    '@bleedingdev/modern-js-runtime',
    '@bleedingdev/modern-js-ultramodern-create',
  ],
  packages: [
    {
      sourceName: '@modern-js/ultramodern-create',
      targetName: '@bleedingdev/modern-js-ultramodern-create',
      version: '3.2.0-ultramodern.1',
      integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
      shasum: 'a'.repeat(40),
    },
    {
      sourceName: '@modern-js/runtime',
      targetName: '@bleedingdev/modern-js-runtime',
      version: '3.2.0-ultramodern.1',
      integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
      shasum: 'b'.repeat(40),
    },
  ],
});

const makePublishOrderFixture = () => {
  const root = makeTempDir();
  const packages = [
    {
      sourceName: '@modern-js/ultramodern-create',
      targetName: '@bleedingdev/modern-js-ultramodern-create',
      dependencies: {
        '@modern-js/i18n-utils':
          'npm:@bleedingdev/modern-js-i18n-utils@3.2.0-ultramodern.1',
      },
    },
    {
      sourceName: '@modern-js/i18n-utils',
      targetName: '@bleedingdev/modern-js-i18n-utils',
      dependencies: {
        '@modern-js/utils':
          'npm:@bleedingdev/modern-js-utils@3.2.0-ultramodern.1',
      },
    },
    {
      sourceName: '@modern-js/runtime',
      targetName: '@bleedingdev/modern-js-runtime',
      dependencies: {},
    },
    {
      sourceName: '@modern-js/utils',
      targetName: '@bleedingdev/modern-js-utils',
      dependencies: {},
    },
  ].map(item => {
    const packageDir = path.join(
      root,
      item.targetName.replaceAll('/', '__'),
      'package',
    );
    writeJson(path.join(packageDir, 'package.json'), {
      name: item.targetName,
      version: '3.2.0-ultramodern.1',
      dependencies: item.dependencies,
      publishConfig: {
        access: 'public',
      },
    });

    return {
      sourceName: item.sourceName,
      targetName: item.targetName,
      version: '3.2.0-ultramodern.1',
      packageDir: path.relative(repoRoot, packageDir),
    };
  });

  return {
    root,
    manifest: {
      ...makeManifest(),
      dependencyGraph: undefined,
      aliases: {
        '@modern-js/ultramodern-create':
          '@bleedingdev/modern-js-ultramodern-create',
        '@modern-js/i18n-utils': '@bleedingdev/modern-js-i18n-utils',
        '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
        '@modern-js/utils': '@bleedingdev/modern-js-utils',
      },
      packages,
    },
  };
};

const releaseSource = {
  commit: 'a'.repeat(40),
  repository: 'BleedingDev/ultramodern.js',
};

const releaseTools = {
  node: process.version,
  npm: 'fixture-npm',
  pnpm: 'fixture-pnpm',
};

const dsseInTotoPayloadType = 'application/vnd.in-toto+json';
const githubActionsBuildType =
  'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1';
const inTotoStatementV1 = 'https://in-toto.io/Statement/v1';
const slsaProvenanceV1 = 'https://slsa.dev/provenance/v1';
const trustedOidcIssuer = 'https://token.actions.githubusercontent.com';
const trustedWorkflow = {
  path: '.github/workflows/publish-bleedingdev.yml',
  ref: 'refs/heads/main-ultramodern',
  repository: 'https://github.com/BleedingDev/ultramodern.js',
};

const npmPurl = item => {
  const [scope, name] = item.targetName.slice(1).split('/');
  return `pkg:npm/%40${scope}/${name}@${item.version}`;
};

const provenanceStatement = (
  item,
  { invocationId, sourceCommit = releaseSource.commit } = {},
) => {
  const statement = {
    _type: inTotoStatementV1,
    predicateType: slsaProvenanceV1,
    subject: [
      {
        name: npmPurl(item),
        digest: {
          sha512: Buffer.from(
            item.integrity.slice('sha512-'.length),
            'base64',
          ).toString('hex'),
        },
      },
    ],
    predicate: {
      buildDefinition: {
        buildType: githubActionsBuildType,
        externalParameters: {
          workflow: structuredClone(trustedWorkflow),
        },
        resolvedDependencies: [
          {
            uri: `git+https://github.com/BleedingDev/ultramodern.js@${trustedWorkflow.ref}`,
            digest: {
              gitCommit: sourceCommit,
            },
          },
        ],
      },
    },
  };
  if (invocationId !== undefined) {
    statement.predicate.runDetails = { metadata: { invocationId } };
  }
  return statement;
};

const provenanceDocument = statement => ({
  attestations: [
    {
      predicateType: slsaProvenanceV1,
      bundle: {
        mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
        dsseEnvelope: {
          payloadType: dsseInTotoPayloadType,
          payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
          signatures: [{ keyid: '', sig: 'fixture-signature' }],
        },
        verificationMaterial: {},
      },
    },
  ],
});

const provenanceResponse = document => ({
  ok: true,
  status: 200,
  json: async () => document,
});

const provenanceDist = {
  attestations: {
    provenance: { predicateType: slsaProvenanceV1 },
    url: 'https://registry.npmjs.org/-/npm/v1/attestations/@bleedingdev%2fmodern-js-runtime@3.2.0-ultramodern.1',
  },
};

const sigstoreVerificationResult = expectation => ({
  certificateIdentity: expectation.certificateIdentity,
  issuer: expectation.issuer,
  verifierVersion: 'fixture-sigstore',
});

const acceptSigstoreBundle = async (_bundle, expectation) =>
  sigstoreVerificationResult(expectation);

const registryTarballUrl = item => {
  const packageBaseName = item.targetName.slice(
    item.targetName.lastIndexOf('/') + 1,
  );
  return `https://registry.npmjs.org/${item.targetName}/-/${packageBaseName}-${item.version}.tgz`;
};

const registryDistFor = item => ({
  ...structuredClone(provenanceDist),
  integrity: item.integrity,
  shasum: item.shasum,
  tarball: registryTarballUrl(item),
});

const ledgerPackageName = '@bleedingdev/modern-js-create';
const firstPublishLedgerPackageName =
  '@bleedingdev/modern-js-ultramodern-create';
const ledgerGrandfatheredVersion = Object.freeze({
  integrity:
    'sha512-+ZyvnxrZouvlF5yqdw6rbtEB/+X8GJJLrBNzKVZhN7aSjYbBI1nVgugRE0IogCNtyQzibOfakbeWNKwKtEI62Q==',
  provenance: false,
  publishedAt: '2026-05-16T14:50:19.166Z',
  version: '3.2.0-ultramodern.0',
});
const ledgerCutoverAnchor = Object.freeze({
  integrity:
    'sha512-fK3mRQR/eyTRdgvuRb+Scg8lWS2ijqhAPy/d97SoRJ+12yFZHD/e4JWTQZcm9zxkOJn0kp4BJypVjwtlI63L6Q==',
  publishedAt: '2026-05-16T21:22:57.171Z',
  sourceCommit: '846d489312f17f48c5bfbf88d1d16164ffd6f465',
  version: '3.2.0-ultramodern.1',
});
const knownRegistryHistory = Object.freeze([
  ledgerGrandfatheredVersion,
  ledgerCutoverAnchor,
]);
const registryMetadataUrl = packageName =>
  `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
const registryAttestationsUrl = (packageName, version) => {
  const encodedName = encodeURIComponent(packageName)
    .replace(/^%40/u, '@')
    .replace(/%2F/giu, '%2f');
  return `https://registry.npmjs.org/-/npm/v1/attestations/${encodedName}@${encodeURIComponent(
    version,
  )}`;
};

const createRegistryLedger = (entries, packageName = ledgerPackageName) => {
  const chronologicalEntries = [...entries].sort(
    (left, right) =>
      Date.parse(left.publishedAt) - Date.parse(right.publishedAt),
  );
  const metadata = {
    name: packageName,
    time: {
      created: chronologicalEntries[0].publishedAt,
      modified: chronologicalEntries.at(-1).publishedAt,
    },
    versions: {},
  };
  const documents = new Map();
  for (const entry of entries) {
    const item = {
      integrity:
        entry.integrity ??
        `sha512-${crypto
          .createHash('sha512')
          .update(`${packageName}@${entry.version}`)
          .digest('base64')}`,
      targetName: packageName,
      version: entry.version,
    };
    const dist = { integrity: item.integrity };
    if (entry.provenance !== false) {
      dist.attestations = {
        provenance: { predicateType: slsaProvenanceV1 },
        url:
          entry.attestationsUrl ??
          registryAttestationsUrl(packageName, entry.version),
      };
      documents.set(
        registryAttestationsUrl(packageName, entry.version),
        provenanceDocument(
          provenanceStatement(item, {
            invocationId: entry.invocationId,
            sourceCommit: entry.sourceCommit,
          }),
        ),
      );
    }
    metadata.time[entry.version] = entry.publishedAt;
    metadata.versions[entry.version] = {
      dist,
      name: packageName,
      version: entry.version,
    };
  }
  return { documents, metadata };
};

const createRegistryLedgerFetch = (ledger, calls) => async (url, options) => {
  calls.push({ options, url });
  if (url === registryMetadataUrl(ledger.metadata.name)) {
    return provenanceResponse(ledger.metadata);
  }
  const document = ledger.documents.get(url);
  return document
    ? provenanceResponse(document)
    : { ok: false, status: 404, json: async () => ({}) };
};

const registryLedgerRequest = ({ env, ...overrides } = {}) => ({
  env: {
    GITHUB_REF: trustedWorkflow.ref,
    GITHUB_REPOSITORY: releaseSource.repository,
    ...env,
  },
  packageName: ledgerPackageName,
  requestedVersion: '9.0.0-ultramodern.1',
  sourceCommit: releaseSource.commit,
  sourceRepository: releaseSource.repository,
  ...overrides,
});

const tarballResponse = bytes => ({
  arrayBuffer: async () =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  ok: true,
  status: 200,
});

const artifactExpectations = aliases => ({
  aliases,
  source: releaseSource,
  sourceNames: Object.keys(aliases),
  tag: 'latest',
  version: '3.2.0-ultramodern.1',
});

const createArtifactFixture = async ({
  packageJsonTransform,
  scripts,
} = {}) => {
  const { createReleaseArtifacts } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const root = makeTempDir();
  const outDir = path.join(root, 'release');
  const markerPath = path.join(root, 'lifecycle-ran');
  const aliases = {
    '@modern-js/ultramodern-create':
      '@bleedingdev/modern-js-ultramodern-create',
    '@modern-js/runtime': '@bleedingdev/modern-js-runtime',
    '@modern-js/utils': '@bleedingdev/modern-js-utils',
  };
  const definitions = [
    {
      sourceName: '@modern-js/runtime',
      targetName: aliases['@modern-js/runtime'],
      dependencies: {
        '@modern-js/utils':
          'npm:@bleedingdev/modern-js-utils@3.2.0-ultramodern.1',
      },
      scripts: typeof scripts === 'function' ? scripts(markerPath) : scripts,
    },
    {
      sourceName: '@modern-js/utils',
      targetName: aliases['@modern-js/utils'],
      dependencies: {},
    },
    {
      sourceName: '@modern-js/ultramodern-create',
      targetName: aliases['@modern-js/ultramodern-create'],
      dependencies: {},
    },
  ];
  const packages = definitions.map(definition => {
    const packageDir = path.join(
      root,
      'staged',
      definition.targetName.replaceAll('/', '__'),
    );
    const packageJson = {
      name: definition.targetName,
      version: '3.2.0-ultramodern.1',
      dependencies: definition.dependencies,
      publishConfig: { access: 'public' },
      scripts: definition.scripts,
    };
    packageJsonTransform?.(packageJson, definition);
    writeJson(path.join(packageDir, 'package.json'), packageJson);
    writeFile(
      path.join(packageDir, 'index.js'),
      `module.exports = ${JSON.stringify(definition.sourceName)};\n`,
    );
    writeFile(
      path.join(
        packageDir,
        'nested',
        `${'long-path-segment-'.repeat(7)}fixture.txt`,
      ),
    );
    if (definition.sourceName === '@modern-js/ultramodern-create') {
      for (const relativePath of createTemplateRequiredFiles) {
        writeFile(path.join(packageDir, relativePath));
      }
    }
    return {
      packageDir: path.relative(repoRoot, packageDir),
      sourceName: definition.sourceName,
      targetName: definition.targetName,
      version: '3.2.0-ultramodern.1',
    };
  });
  const packCalls = [];
  let releaseArtifacts;
  try {
    releaseArtifacts = createReleaseArtifacts({
      aliases,
      command(command, args, options) {
        packCalls.push({ args: [...args], command, options });
        return execFileSync(command, args, options);
      },
      outDir,
      packages,
      source: releaseSource,
      tag: 'latest',
      tools: releaseTools,
      version: '3.2.0-ultramodern.1',
    });
  } catch (error) {
    removeDir(root);
    throw error;
  }

  return {
    aliases,
    markerPath,
    outDir,
    packCalls,
    packages,
    releaseArtifacts,
    root,
  };
};

test('publish-existing rejects legacy directory manifests before trusted publishing', t => {
  const outDir = makeCreateFixture({ includeTemplateDotFiles: true });
  const fakeGitRoot = makeTempDir();
  t.after(() => removeDir(fakeGitRoot));
  const binDir = path.join(fakeGitRoot, 'bin');
  fs.mkdirSync(binDir);
  const fakeGit = path.join(binDir, 'git');
  fs.writeFileSync(
    fakeGit,
    [
      '#!/bin/sh',
      'if [ "$1" = "status" ]; then',
      '  exit 0',
      'fi',
      'if [ "$1" = "rev-parse" ]; then',
      "  printf '%s\\n' ef882747ef26b96160f76b95146cdfe3ec3e3458",
      '  exit 0',
      'fi',
      'if [ "$1" = "remote" ]; then',
      "  printf '%s\\n' https://github.com/BleedingDev/ultramodern.js.git",
      '  exit 0',
      'fi',
      'exit 2',
      '',
    ].join('\n'),
  );
  fs.chmodSync(fakeGit, 0o755);

  try {
    const result = runPublishExisting(outDir, {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Detached release manifest SHA-256 is missing or is not a regular file/,
    );
    assert.doesNotMatch(result.stderr, /trusted publishing workflow/);
  } finally {
    removeDir(outDir);
  }
});

test('release preparation rejects dirty source before reading package inputs', t => {
  const root = makeTempDir();
  t.after(() => removeDir(root));
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir);
  const fakeGit = path.join(binDir, 'git');
  fs.writeFileSync(
    fakeGit,
    [
      '#!/bin/sh',
      'if [ "$1" = "rev-parse" ]; then',
      "  printf '%s\\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      '  exit 0',
      'fi',
      'if [ "$1" = "status" ]; then',
      "  printf ' M tracked.txt\\0?? untracked.txt\\0'",
      '  exit 0',
      'fi',
      'exit 2',
      '',
    ].join('\n'),
  );
  fs.chmodSync(fakeGit, 0o755);

  const result = spawnSync(
    process.execPath,
    [scriptPath, '--version', '3.5.0-ultramodern.49'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /release source worktree is not clean/i);
  assert.match(result.stderr, /tracked\.txt/);
  assert.match(result.stderr, /untracked\.txt/);
});

test('parseArgs rejects partial publish controls', async () => {
  const { parseArgs } = await import('../prepare-bleedingdev-packages.mjs');

  assert.throws(
    () =>
      parseArgs([
        '--version',
        '3.2.0-ultramodern.1',
        '--packages',
        '@modern-js/ultramodern-create',
      ]),
    /--packages is forbidden/,
  );
  assert.throws(
    () =>
      parseArgs([
        '--version',
        '3.2.0-ultramodern.1',
        '--dependency-version',
        '3.2.0-ultramodern.0',
      ]),
    /--dependency-version is forbidden/,
  );
  assert.throws(
    () => parseArgs(['--version', '3.2.0-ultramodern.1', '--no-skip-existing']),
    /--no-skip-existing is forbidden/,
  );
  assert.throws(
    () =>
      parseArgs([
        '--version',
        '3.2.0-ultramodern.1',
        '--acceptance-receipt',
        'acceptance-receipt.json',
      ]),
    /Unknown argument: --acceptance-receipt/,
  );
});

test('parseArgs confines destructive preparation to its owned output tree', async () => {
  const { parseArgs } = await import('../prepare-bleedingdev-packages.mjs');
  const ownedOutput = path.join(repoRoot, '.modern', 'bleedingdev-publish');
  const unsafeOutputs = [
    path.parse(repoRoot).root,
    path.dirname(repoRoot),
    repoRoot,
    path.join(repoRoot, '.modern', 'another-tool'),
    path.join(os.tmpdir(), 'arbitrary-publish-output'),
  ];

  for (const output of unsafeOutputs) {
    assert.throws(
      () => parseArgs(['--version', '3.2.0-ultramodern.1', '--out', output]),
      /--out for package preparation must be inside/,
    );
  }

  assert.equal(
    parseArgs(['--version', '3.2.0-ultramodern.1']).out,
    ownedOutput,
  );
  assert.equal(
    parseArgs([
      '--version',
      '3.2.0-ultramodern.1',
      '--out',
      path.join(ownedOutput, 'candidate'),
    ]).out,
    path.join(ownedOutput, 'candidate'),
  );

  const existingArtifacts = path.join(os.tmpdir(), 'accepted-release-bundle');
  assert.equal(
    parseArgs([
      '--version',
      '3.2.0-ultramodern.1',
      '--publish-existing',
      '--out',
      existingArtifacts,
    ]).out,
    existingArtifacts,
  );
});

test('parseArgs rejects destructive output through an owned-tree symlink', async t => {
  const { parseArgs } = await import('../prepare-bleedingdev-packages.mjs');
  const ownedOutput = path.join(repoRoot, '.modern', 'bleedingdev-publish');
  const ownedOutputExisted = fs.existsSync(ownedOutput);
  const symlinkTarget = makeTempDir();
  const sentinel = path.join(symlinkTarget, 'must-survive.txt');
  fs.writeFileSync(sentinel, 'outside owned output\n');
  const symlinkPath = path.join(
    ownedOutput,
    `outside-${process.pid}-${crypto.randomUUID()}`,
  );
  fs.mkdirSync(ownedOutput, { recursive: true });
  fs.symlinkSync(
    symlinkTarget,
    symlinkPath,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  t.after(() => {
    fs.unlinkSync(symlinkPath);
    removeDir(symlinkTarget);
    if (!ownedOutputExisted) {
      try {
        fs.rmdirSync(ownedOutput);
      } catch (error) {
        if (error.code !== 'ENOTEMPTY') {
          throw error;
        }
      }
    }
  });

  assert.throws(
    () =>
      parseArgs([
        '--version',
        '3.2.0-ultramodern.1',
        '--out',
        path.join(symlinkPath, 'victim'),
      ]),
    /--out for package preparation must not traverse a symbolic link/,
  );
  const existingArtifactPath = path.join(symlinkPath, 'accepted-release');
  assert.equal(
    parseArgs([
      '--version',
      '3.2.0-ultramodern.1',
      '--publish-existing',
      '--out',
      existingArtifactPath,
    ]).out,
    existingArtifactPath,
  );
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'outside owned output\n');
});

test('prepare workflow rejects unsafe output before inspecting or deleting source', async () => {
  const { prepareBleedingdevPackages } = await import(
    '../lib/prepare-bleedingdev-packages/workflow.mjs'
  );

  await assert.rejects(
    () =>
      prepareBleedingdevPackages({
        out: repoRoot,
        publishExisting: false,
      }),
    /--out for package preparation must be inside/,
  );
});

test('parseArgs preserves publish CLI conventions while using shared parser', async () => {
  const { parseArgs } = await import('../prepare-bleedingdev-packages.mjs');
  const options = parseArgs([
    '--',
    '--version',
    '3.2.0-ultramodern.1',
    '--scope',
    '@bleedingdev',
    '--out',
    '.modern/custom-publish',
    '--publish-existing',
    '--publish-concurrency',
    '2',
  ]);

  assert.equal(options.scope, 'bleedingdev');
  assert.equal(options.version, '3.2.0-ultramodern.1');
  assert.equal(options.dependencyVersion, '3.2.0-ultramodern.1');
  assert.equal(options.publish, true);
  assert.equal(options.publishExisting, true);
  assert.equal(options.publishConcurrency, 2);
  assert.equal(options.out, path.resolve(repoRoot, '.modern/custom-publish'));

  assert.equal(
    parseArgs(['--version', '3.2.0-ultramodern.1', '--tag', '--packages=x'])
      .tag,
    '--packages=x',
  );
  assert.throws(
    () => parseArgs(['--version=3.2.0-ultramodern.1']),
    /^Error: Unknown argument: --version=3.2.0-ultramodern.1$/,
  );
  assert.throws(
    () => parseArgs(['--version', '3.2.0-ultramodern.1', '--packages']),
    /--packages is forbidden/,
  );
});

test('validateFullCohortManifest rejects missing aliases', async () => {
  const { validateFullCohortManifest } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = makeManifest();
  manifest.packages = manifest.packages.filter(
    item => item.sourceName !== '@modern-js/runtime',
  );

  assert.throws(
    () => validateFullCohortManifest(manifest),
    /BleedingDev publish manifest is missing 1 public package/,
  );
});

test('publish manifest rejects the retired create target and requires the fork-owned generator', async () => {
  const { validateFullCohortManifest } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = makeManifest();
  assert.doesNotThrow(() => validateFullCohortManifest(manifest));

  const legacy = structuredClone(manifest);
  delete legacy.aliases['@modern-js/ultramodern-create'];
  legacy.aliases['@modern-js/create'] = '@bleedingdev/modern-js-create';
  legacy.packages[0].sourceName = '@modern-js/create';
  legacy.packages[0].targetName = '@bleedingdev/modern-js-create';

  assert.throws(
    () => validateFullCohortManifest(legacy),
    /@modern-js\/create is the release-base anchor and must never be published as @bleedingdev\/modern-js-create/u,
  );
});

test('validateRegistryCohort blocks success when any package is absent', async () => {
  const { validateRegistryCohort } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = makeManifest();

  await assert.rejects(
    () =>
      validateRegistryCohort(
        manifest,
        { dryRun: false, tag: 'latest' },
        {
          verifyRegistryDistTag: async () => {},
          verifyRegistryPackage: async item => {
            if (item.targetName === '@bleedingdev/modern-js-runtime') {
              throw new Error('not found');
            }
          },
        },
      ),
    /The latest dist-tag is not coherent for the full cohort/,
  );
});

test('validateRegistryCohort requires every package latest tag to point at the published version', async () => {
  const { validateRegistryCohort } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = makeManifest();

  await assert.rejects(
    () =>
      validateRegistryCohort(
        manifest,
        { dryRun: false, tag: 'latest' },
        {
          verifyRegistryPackage: async () => {},
          verifyRegistryDistTag: async packageName => {
            if (packageName === '@bleedingdev/modern-js-runtime') {
              throw new Error(
                '@bleedingdev/modern-js-runtime dist-tag latest points at 3.2.0-ultramodern.89, expected 3.2.0-ultramodern.1',
              );
            }
          },
        },
      ),
    /dist-tag latest points at 3\.2\.0-ultramodern\.89/,
  );
});

test('orderPublishItems publishes create last so users do not see an incomplete cohort', async () => {
  const { orderPublishItems } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = makeManifest();

  assert.deepEqual(
    orderPublishItems(manifest.packages, manifest).map(item => item.sourceName),
    ['@modern-js/runtime', '@modern-js/ultramodern-create'],
  );
});

test('orderPublishItems publishes hard dependencies before consumers', async () => {
  const { orderPublishItems } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = makePublishOrderFixture();

  try {
    const orderedSourceNames = orderPublishItems(
      fixture.manifest.packages,
      fixture.manifest,
    ).map(item => item.sourceName);
    assert(
      orderedSourceNames.indexOf('@modern-js/utils') <
        orderedSourceNames.indexOf('@modern-js/i18n-utils'),
    );
    assert(
      orderedSourceNames.indexOf('@modern-js/i18n-utils') <
        orderedSourceNames.indexOf('@modern-js/ultramodern-create'),
    );
    assert.equal(
      orderedSourceNames.at(-1),
      '@modern-js/ultramodern-create',
      'create must still publish last',
    );
  } finally {
    removeDir(fixture.root);
  }
});

test('release artifacts reject non-canonical dependency metadata order', async () => {
  await assert.rejects(
    () =>
      createArtifactFixture({
        packageJsonTransform(packageJson, definition) {
          if (definition.sourceName === '@modern-js/utils') {
            packageJson.devDependencies = {
              '@scripts/rstest-config': '2.66.0',
              '@modern-js/types':
                'npm:@bleedingdev/modern-js-types@3.2.0-ultramodern.1',
            };
          }
        },
      }),
    /modern-js-utils.*devDependencies keys must use canonical lexical order/u,
  );
});

test('verifyRegistryTarball downloads the pinned body and recomputes every accepted hash', async () => {
  const { verifyRegistryTarball } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages.find(
    item => item.sourceName === '@modern-js/utils',
  );
  const bytes = fs.readFileSync(artifact.artifactPath);
  const calls = [];

  try {
    const result = await verifyRegistryTarball(
      artifact,
      registryDistFor(artifact),
      async (url, options) => {
        calls.push({ options, url });
        return tarballResponse(bytes);
      },
    );
    assert.deepEqual(result, {
      integrity: artifact.integrity,
      sha256: artifact.sha256,
      shasum: artifact.shasum,
      size: artifact.size,
      tarballUrl: registryTarballUrl(artifact),
    });
    assert.deepEqual(calls, [
      {
        options: {
          headers: { accept: 'application/octet-stream' },
          method: 'GET',
          redirect: 'error',
        },
        url: registryTarballUrl(artifact),
      },
    ]);
  } finally {
    removeDir(fixture.root);
  }
});

test('verifyRegistryTarball rejects missing, unpinned, and byte-mismatched registry bodies', async () => {
  const { verifyRegistryTarball } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages[0];
  const bytes = fs.readFileSync(artifact.artifactPath);
  const tampered = Buffer.from(bytes);
  tampered[0] ^= 0xff;

  try {
    await assert.rejects(
      () =>
        verifyRegistryTarball(
          artifact,
          registryDistFor(artifact),
          async () => ({ ok: false, status: 404 }),
        ),
      /returned HTTP 404/,
    );
    await assert.rejects(
      () =>
        verifyRegistryTarball(
          artifact,
          {
            ...registryDistFor(artifact),
            tarball: `https://evil.example/${path.basename(
              artifact.artifactPath,
            )}`,
          },
          async () => {
            throw new Error('must not fetch an unpinned registry URL');
          },
        ),
      /not the pinned npm endpoint/,
    );
    await assert.rejects(
      () =>
        verifyRegistryTarball(artifact, registryDistFor(artifact), async () =>
          tarballResponse(tampered),
        ),
      /Registry tarball byte mismatch.*sha256.*shasum.*integrity/,
    );
  } finally {
    removeDir(fixture.root);
  }
});

test('verifyRegistryProvenance validates npm DSSE SLSA subject bytes and trusted source', async () => {
  const {
    createRegistryProvenanceExpectation,
    verifyRegistryPackageDist,
    verifyRegistryProvenance,
  } = await import('../prepare-bleedingdev-packages.mjs');
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages.find(
    item => item.sourceName === '@modern-js/runtime',
  );
  const expectation = createRegistryProvenanceExpectation(
    fixture.releaseArtifacts.manifest,
    {
      GITHUB_REF: trustedWorkflow.ref,
      GITHUB_REPOSITORY: 'BleedingDev/ultramodern.js',
    },
  );
  const document = provenanceDocument(provenanceStatement(artifact));
  const fetchCalls = [];
  const sigstoreCalls = [];

  try {
    const result = await verifyRegistryProvenance(
      artifact,
      provenanceDist,
      expectation,
      async (url, options) => {
        fetchCalls.push({ options, url });
        return provenanceResponse(document);
      },
      async (bundle, verifiedExpectation) => {
        sigstoreCalls.push({ bundle, expectation: verifiedExpectation });
        return sigstoreVerificationResult(verifiedExpectation);
      },
    );

    assert.equal(result.subject, npmPurl(artifact));
    assert.equal(result.sourceCommit, releaseSource.commit);
    assert.equal(
      result.subjectSha512,
      provenanceStatement(artifact).subject[0].digest.sha512,
    );
    assert.deepEqual(fetchCalls, [
      {
        options: {
          headers: { accept: 'application/json' },
          method: 'GET',
          redirect: 'error',
        },
        url: provenanceDist.attestations.url,
      },
    ]);
    assert.equal(sigstoreCalls.length, 1);
    assert.equal(sigstoreCalls[0].bundle, document.attestations[0].bundle);
    assert.equal(sigstoreCalls[0].expectation, expectation);
    assert.deepEqual(expectation, {
      certificateIdentity:
        'https://github.com/BleedingDev/ultramodern.js/.github/workflows/publish-bleedingdev.yml@refs/heads/main-ultramodern',
      issuer: trustedOidcIssuer,
      source: releaseSource,
      workflow: {
        path: trustedWorkflow.path,
        ref: trustedWorkflow.ref,
        repository: 'BleedingDev/ultramodern.js',
      },
    });

    let provenanceChecks = 0;
    let tarballChecks = 0;
    await verifyRegistryPackageDist(artifact, provenanceDist, expectation, {
      assertRegistryDistMatches: () => {},
      verifyRegistryTarball: async (verifiedItem, dist) => {
        tarballChecks += 1;
        assert.equal(verifiedItem, artifact);
        assert.equal(dist, provenanceDist);
      },
      verifyRegistryProvenance: async (
        verifiedItem,
        dist,
        verifiedExpectation,
      ) => {
        provenanceChecks += 1;
        assert.equal(verifiedItem, artifact);
        assert.equal(dist, provenanceDist);
        assert.equal(verifiedExpectation, expectation);
      },
    });
    assert.equal(tarballChecks, 1);
    assert.equal(provenanceChecks, 1);
  } finally {
    removeDir(fixture.root);
  }
});

test('verifyRegistryProvenance accepts only one unique npm SLSA bundle', async () => {
  const { createRegistryProvenanceExpectation, verifyRegistryProvenance } =
    await import('../prepare-bleedingdev-packages.mjs');
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages.find(
    item => item.sourceName === '@modern-js/runtime',
  );
  const expectation = createRegistryProvenanceExpectation(
    fixture.releaseArtifacts.manifest,
    {
      GITHUB_REF: trustedWorkflow.ref,
      GITHUB_REPOSITORY: 'BleedingDev/ultramodern.js',
    },
  );
  const document = provenanceDocument(provenanceStatement(artifact));
  document.attestations.push(structuredClone(document.attestations[0]));
  const verifiedBundles = [];

  try {
    await verifyRegistryProvenance(
      artifact,
      provenanceDist,
      expectation,
      async () => provenanceResponse(document),
      async (bundle, verifiedExpectation) => {
        verifiedBundles.push(bundle);
        return sigstoreVerificationResult(verifiedExpectation);
      },
    );
    assert.deepEqual(verifiedBundles, [document.attestations[0].bundle]);

    const conflictingDocument = structuredClone(document);
    conflictingDocument.attestations[1].bundle.dsseEnvelope.signatures[0].sig =
      'conflicting-signature';
    await assert.rejects(
      () =>
        verifyRegistryProvenance(
          artifact,
          provenanceDist,
          expectation,
          async () => provenanceResponse(conflictingDocument),
          acceptSigstoreBundle,
        ),
      /exactly one SLSA v1 attestation bundle identity; found 2 unique bundles across 2 records/,
    );
  } finally {
    removeDir(fixture.root);
  }
});

test('verifyRegistryProvenance rejects missing, malformed, or mismatched npm provenance', async () => {
  const { createRegistryProvenanceExpectation, verifyRegistryProvenance } =
    await import('../prepare-bleedingdev-packages.mjs');
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages.find(
    item => item.sourceName === '@modern-js/runtime',
  );
  const expectation = createRegistryProvenanceExpectation(
    fixture.releaseArtifacts.manifest,
    {
      GITHUB_REF: trustedWorkflow.ref,
      GITHUB_REPOSITORY: 'BleedingDev/ultramodern.js',
    },
  );

  const rejectsProvenance = async (
    { mutateDocument = () => {}, mutateStatement = () => {} },
    pattern,
  ) => {
    const statement = provenanceStatement(artifact);
    mutateStatement(statement);
    const document = provenanceDocument(statement);
    mutateDocument(document);
    await assert.rejects(
      () =>
        verifyRegistryProvenance(
          artifact,
          provenanceDist,
          expectation,
          async () => provenanceResponse(document),
          acceptSigstoreBundle,
        ),
      pattern,
    );
  };

  try {
    await assert.rejects(
      () =>
        verifyRegistryProvenance(artifact, {}, expectation, async () => {
          throw new Error('must not fetch without an attestations URL');
        }),
      /dist\.attestations/,
    );
    const ignoredUrlFetches = [];
    await verifyRegistryProvenance(
      artifact,
      {
        ...structuredClone(provenanceDist),
        attestations: {
          ...structuredClone(provenanceDist.attestations),
          url: 'https://evil.example/-/npm/v1/attestations/package@version',
        },
      },
      expectation,
      async (url, options) => {
        ignoredUrlFetches.push({ options, url });
        return provenanceResponse(
          provenanceDocument(provenanceStatement(artifact)),
        );
      },
      acceptSigstoreBundle,
    );
    assert.equal(ignoredUrlFetches.length, 1);
    assert.equal(ignoredUrlFetches[0].url, provenanceDist.attestations.url);
    await rejectsProvenance(
      {
        mutateDocument(document) {
          document.attestations = [];
        },
      },
      /exactly one SLSA v1 attestation/,
    );
    await rejectsProvenance(
      {
        mutateDocument(document) {
          document.attestations[0].bundle.dsseEnvelope.payload = 'not-base64';
        },
      },
      /canonical base64/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          statement.subject[0].name = statement.subject[0].name.replace(
            artifact.version,
            '3.2.0-ultramodern.2',
          );
        },
      },
      /does not match pkg:npm/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          statement.subject[0].digest.sha512 = '0'.repeat(128);
        },
      },
      /does not match the accepted tarball integrity/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          delete statement.predicate.buildDefinition.buildType;
        },
      },
      /SLSA buildType must be/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          delete statement.predicate.buildDefinition.resolvedDependencies;
        },
      },
      /resolvedDependencies must be a non-empty array/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit =
            'b'.repeat(40);
        },
      },
      /does not match accepted commit/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          statement.predicate.buildDefinition.resolvedDependencies[0].uri = `git+https://github.com/Other/repository@${trustedWorkflow.ref}`;
        },
      },
      /accepted source repository exactly once; found 0/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          statement.predicate.buildDefinition.externalParameters.workflow.repository =
            'https://github.com/Other/repository';
        },
      },
      /does not match trusted repository/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          delete statement.predicate.buildDefinition.externalParameters
            .workflow;
        },
      },
      /SLSA workflow must be a JSON object/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          delete statement.predicate.buildDefinition.externalParameters.workflow
            .repository;
        },
      },
      /workflow\.repository must be a non-empty trimmed string/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          statement.predicate.buildDefinition.externalParameters.workflow.path =
            '.github/workflows/other.yml';
        },
      },
      /does not match trusted path/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          statement.predicate.buildDefinition.externalParameters.workflow.ref =
            'refs/heads/other';
        },
      },
      /does not match trusted ref/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          delete statement.predicate.buildDefinition.externalParameters.workflow
            .path;
        },
      },
      /workflow\.path must be a non-empty trimmed string/,
    );
    await rejectsProvenance(
      {
        mutateStatement(statement) {
          delete statement.predicate.buildDefinition.externalParameters.workflow
            .ref;
        },
      },
      /workflow\.ref must be a non-empty trimmed string/,
    );
  } finally {
    removeDir(fixture.root);
  }
});

test('Sigstore verification pins Fulcio identity, source OIDs, CT log, and Rekor before policy checks', async () => {
  const {
    createRegistryProvenanceExpectation,
    loadNpmSigstoreVerifier,
    verifyRegistryProvenance,
    verifySigstoreBundle,
  } = await import('../prepare-bleedingdev-packages.mjs');
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages.find(
    item => item.sourceName === '@modern-js/runtime',
  );
  const expectation = createRegistryProvenanceExpectation(
    fixture.releaseArtifacts.manifest,
    {
      GITHUB_REF: trustedWorkflow.ref,
      GITHUB_REPOSITORY: 'BleedingDev/ultramodern.js',
    },
  );
  const bundle = provenanceDocument(provenanceStatement(artifact))
    .attestations[0].bundle;
  const calls = [];

  try {
    const result = await verifySigstoreBundle(bundle, expectation, () => ({
      verify: async (verifiedBundle, options) => {
        calls.push({ bundle: verifiedBundle, options });
        return {
          identity: {
            extensions: { issuer: expectation.issuer },
            subjectAlternativeName: expectation.certificateIdentity,
          },
        };
      },
      version: 'fixture-sigstore',
    }));
    assert.deepEqual(result, sigstoreVerificationResult(expectation));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bundle, bundle);
    assert.deepEqual(calls[0].options, {
      certificateIdentityURI:
        '^https://github\\.com/BleedingDev/ultramodern\\.js/\\.github/workflows/publish-bleedingdev\\.yml@refs/heads/main-ultramodern$',
      certificateIssuer: trustedOidcIssuer,
      certificateOIDs: {
        '1.3.6.1.4.1.57264.1.3': releaseSource.commit,
        '1.3.6.1.4.1.57264.1.5': releaseSource.repository,
        '1.3.6.1.4.1.57264.1.6': trustedWorkflow.ref,
      },
      ctLogThreshold: 1,
      tlogThreshold: 1,
    });

    await assert.rejects(
      () =>
        verifySigstoreBundle(bundle, expectation, () => ({
          verify: async () => {
            throw new Error('fixture signature rejection');
          },
          version: 'fixture-sigstore',
        })),
      /Sigstore\/Fulcio\/Rekor verification failed: fixture signature rejection/,
    );
    await assert.rejects(
      () =>
        verifySigstoreBundle(bundle, expectation, () => ({
          verify: async () => ({ identity: {} }),
          version: 'fixture-sigstore',
        })),
      /did not return the required Fulcio issuer and certificate identity/,
    );

    const invalidPolicyStatement = provenanceStatement(artifact);
    invalidPolicyStatement.subject[0].name = 'pkg:npm/attacker@1.0.0';
    await assert.rejects(
      () =>
        verifyRegistryProvenance(
          artifact,
          provenanceDist,
          expectation,
          async () =>
            provenanceResponse(provenanceDocument(invalidPolicyStatement)),
          async () => {
            throw new Error('cryptographic verification ran first');
          },
        ),
      /cryptographic verification ran first/,
    );

    const npmSigstore = loadNpmSigstoreVerifier();
    assert.equal(typeof npmSigstore.verify, 'function');
    assert.match(npmSigstore.version, /^\d+\.\d+\.\d+/u);
  } finally {
    removeDir(fixture.root);
  }
});

test('registry source ledger accepts known history and grandfathers only independently authorized versions', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const ledger = createRegistryLedger([
    {
      attestationsUrl: 'https://evil.example/untrusted-attestation',
      publishedAt: '2026-05-17T00:00:00.000Z',
      sourceCommit: 'c'.repeat(40),
      version: '3.2.0-ultramodern.2',
    },
    ...knownRegistryHistory,
  ]);
  const calls = [];
  const authenticatedCommits = [];

  const result = await assertRegistrySourceCommitUnpublished(
    registryLedgerRequest(),
    {
      bundleVerifier: async (_bundle, expectation) => {
        authenticatedCommits.push(expectation.source.commit);
        return sigstoreVerificationResult(expectation);
      },
      fetchImpl: createRegistryLedgerFetch(ledger, calls),
    },
  );

  assert.deepEqual(result, {
    cutover: {
      publishedAt: ledgerCutoverAnchor.publishedAt,
      version: ledgerCutoverAnchor.version,
    },
    exactVersionAuthenticated: false,
    grandfatheredCount: 1,
    inspectedCount: 2,
    packageName: ledgerPackageName,
    requestedVersion: '9.0.0-ultramodern.1',
    sourceCommit: releaseSource.commit,
    versionCount: 3,
  });
  assert.deepEqual(authenticatedCommits, [
    ledgerCutoverAnchor.sourceCommit,
    'c'.repeat(40),
  ]);
  assert.deepEqual(
    calls.map(call => call.url),
    [
      registryMetadataUrl(ledgerPackageName),
      registryAttestationsUrl(ledgerPackageName, ledgerCutoverAnchor.version),
      registryAttestationsUrl(ledgerPackageName, '3.2.0-ultramodern.2'),
    ],
  );
  for (const call of calls) {
    assert.deepEqual(call.options, {
      headers: { accept: 'application/json' },
      method: 'GET',
      redirect: 'error',
    });
  }
});

test('registry source ledger accepts an empty first-publish identity only on registry 404', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const calls = [];
  const result = await assertRegistrySourceCommitUnpublished(
    registryLedgerRequest({ packageName: firstPublishLedgerPackageName }),
    {
      fetchImpl: async (url, options) => {
        calls.push({ options, url });
        return { ok: false, status: 404, json: async () => ({}) };
      },
    },
  );

  assert.deepEqual(result, {
    cutover: null,
    exactVersionAuthenticated: false,
    grandfatheredCount: 0,
    inspectedCount: 0,
    packageName: firstPublishLedgerPackageName,
    requestedVersion: '9.0.0-ultramodern.1',
    sourceCommit: releaseSource.commit,
    versionCount: 0,
  });
  assert.deepEqual(calls, [
    {
      options: {
        headers: { accept: 'application/json' },
        method: 'GET',
        redirect: 'error',
      },
      url: registryMetadataUrl(firstPublishLedgerPackageName),
    },
  ]);
});

test('registry source ledger authenticates provenance from a new identity first version', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const firstPublishedVersion = {
    publishedAt: '2026-08-31T18:00:00.000Z',
    sourceCommit: 'd'.repeat(40),
    version: '3.8.2-ultramodern.0',
  };
  const ledger = createRegistryLedger(
    [firstPublishedVersion],
    firstPublishLedgerPackageName,
  );

  const result = await assertRegistrySourceCommitUnpublished(
    registryLedgerRequest({ packageName: firstPublishLedgerPackageName }),
    {
      bundleVerifier: acceptSigstoreBundle,
      fetchImpl: createRegistryLedgerFetch(ledger, []),
    },
  );

  assert.deepEqual(result.cutover, {
    publishedAt: firstPublishedVersion.publishedAt,
    version: firstPublishedVersion.version,
  });
  assert.equal(result.grandfatheredCount, 0);
  assert.equal(result.inspectedCount, 1);
  assert.equal(result.versionCount, 1);
});

test('registry source ledger rejects missing first-version provenance and non-404 metadata failures', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const firstPublishedVersion = {
    provenance: false,
    publishedAt: '2026-08-31T18:00:00.000Z',
    version: '3.8.2-ultramodern.0',
  };
  const ledger = createRegistryLedger(
    [firstPublishedVersion],
    firstPublishLedgerPackageName,
  );

  await assert.rejects(
    () =>
      assertRegistrySourceCommitUnpublished(
        registryLedgerRequest({ packageName: firstPublishLedgerPackageName }),
        {
          bundleVerifier: acceptSigstoreBundle,
          fetchImpl: createRegistryLedgerFetch(ledger, []),
        },
      ),
    /modern-js-ultramodern-create@3\.8\.2-ultramodern\.0 is missing SLSA v1 provenance; this identity requires provenance from its first published version/u,
  );

  for (const { packageName, status } of [
    { packageName: firstPublishLedgerPackageName, status: 500 },
    { packageName: ledgerPackageName, status: 404 },
  ]) {
    await assert.rejects(
      () =>
        assertRegistrySourceCommitUnpublished(
          registryLedgerRequest({ packageName }),
          {
            fetchImpl: async () => ({
              ok: false,
              status,
              json: async () => ({}),
            }),
          },
        ),
      new RegExp(`registry metadata returned HTTP ${String(status)}`, 'u'),
    );
  }
});

test('registry source ledger fails closed when all provenance declarations disappear', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const ledger = createRegistryLedger(knownRegistryHistory);
  for (const published of Object.values(ledger.metadata.versions)) {
    delete published.dist.attestations;
  }
  const calls = [];

  await assert.rejects(
    () =>
      assertRegistrySourceCommitUnpublished(registryLedgerRequest(), {
        bundleVerifier: acceptSigstoreBundle,
        fetchImpl: createRegistryLedgerFetch(ledger, calls),
      }),
    /authenticated provenance cutover anchor is missing its SLSA v1 declaration/,
  );
  assert.deepEqual(
    calls.map(call => call.url),
    [registryMetadataUrl(ledgerPackageName)],
  );
});

test('registry source ledger rejects a response that omits the independent cutover anchor', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const ledger = createRegistryLedger(knownRegistryHistory);
  delete ledger.metadata.versions[ledgerCutoverAnchor.version];
  delete ledger.metadata.time[ledgerCutoverAnchor.version];

  await assert.rejects(
    () =>
      assertRegistrySourceCommitUnpublished(registryLedgerRequest(), {
        bundleVerifier: acceptSigstoreBundle,
        fetchImpl: createRegistryLedgerFetch(ledger, []),
      }),
    /registry chronology is missing independently maintained provenance cutover anchor 3\.2\.0-ultramodern\.1/,
  );
});

test('registry source ledger requires exact versions and time chronology agreement', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const trailingVersion = {
    publishedAt: '2026-05-17T00:00:00.000Z',
    sourceCommit: 'c'.repeat(40),
    version: '3.2.0-ultramodern.2',
  };
  const cases = [
    {
      mutate(metadata) {
        delete metadata.time[trailingVersion.version];
      },
      pattern:
        /versions missing from time \[3\.2\.0-ultramodern\.2\]; time versions missing from versions \[\]/,
    },
    {
      mutate(metadata) {
        delete metadata.versions[trailingVersion.version];
      },
      pattern:
        /versions missing from time \[\]; time versions missing from versions \[3\.2\.0-ultramodern\.2\]/,
    },
  ];

  for (const { mutate, pattern } of cases) {
    const ledger = createRegistryLedger([
      ...knownRegistryHistory,
      trailingVersion,
    ]);
    mutate(ledger.metadata);
    await assert.rejects(
      () =>
        assertRegistrySourceCommitUnpublished(registryLedgerRequest(), {
          bundleVerifier: acceptSigstoreBundle,
          fetchImpl: createRegistryLedgerFetch(ledger, []),
        }),
      pattern,
    );
  }
});

test('registry source ledger rejects invalid or ambiguous publication chronology', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const entries = [
    ...knownRegistryHistory,
    {
      publishedAt: '2026-05-17T00:00:00.000Z',
      sourceCommit: 'c'.repeat(40),
      version: '3.2.0-ultramodern.2',
    },
  ];
  const invalid = createRegistryLedger(entries);
  invalid.metadata.time[ledgerGrandfatheredVersion.version] = 'not-a-timestamp';
  await assert.rejects(
    () =>
      assertRegistrySourceCommitUnpublished(registryLedgerRequest(), {
        bundleVerifier: acceptSigstoreBundle,
        fetchImpl: createRegistryLedgerFetch(invalid, []),
      }),
    /canonical ISO-8601 timestamp/,
  );

  const ambiguous = createRegistryLedger(entries);
  ambiguous.metadata.time['3.2.0-ultramodern.2'] =
    ambiguous.metadata.time[ledgerCutoverAnchor.version];
  await assert.rejects(
    () =>
      assertRegistrySourceCommitUnpublished(registryLedgerRequest(), {
        bundleVerifier: acceptSigstoreBundle,
        fetchImpl: createRegistryLedgerFetch(ambiguous, []),
      }),
    /version chronology is ambiguous/,
  );
});

test('registry source ledger fails closed when provenance is missing after cutover', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const ledger = createRegistryLedger([
    ...knownRegistryHistory,
    {
      provenance: false,
      publishedAt: '2026-05-17T00:00:00.000Z',
      version: '3.2.0-ultramodern.2',
    },
  ]);
  const calls = [];

  await assert.rejects(
    () =>
      assertRegistrySourceCommitUnpublished(registryLedgerRequest(), {
        bundleVerifier: acceptSigstoreBundle,
        fetchImpl: createRegistryLedgerFetch(ledger, calls),
      }),
    /3\.2\.0-ultramodern\.2 is missing SLSA v1 provenance after the 3\.2\.0-ultramodern\.1 cutover/,
  );
  assert.deepEqual(
    calls.map(call => call.url),
    [
      registryMetadataUrl(ledgerPackageName),
      registryAttestationsUrl(ledgerPackageName, ledgerCutoverAnchor.version),
    ],
  );
});

test('registry source ledger reports throttled attestations instead of missing provenance', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const ledger = createRegistryLedger([
    ...knownRegistryHistory,
    {
      publishedAt: '2026-05-17T00:00:00.000Z',
      sourceCommit: 'c'.repeat(40),
      version: '3.2.0-ultramodern.2',
    },
  ]);
  const calls = [];
  const waits = [];

  await assert.rejects(
    () =>
      assertRegistrySourceCommitUnpublished(registryLedgerRequest(), {
        bundleVerifier: acceptSigstoreBundle,
        fetchImpl: async (url, options) => {
          calls.push({ options, url });
          if (url === registryMetadataUrl(ledgerPackageName)) {
            return provenanceResponse(ledger.metadata);
          }
          return { ok: false, status: 429, json: async () => ({}) };
        },
        wait: async ms => {
          waits.push(ms);
        },
      }),
    error => {
      assert.match(
        error.message,
        new RegExp(
          `${ledgerPackageName}@${ledgerCutoverAnchor.version.replace(/\./gu, '\\.')} registry provenance is throttled`,
          'u',
        ),
      );
      assert.doesNotMatch(error.message, /missing SLSA v1 provenance/u);
      assert.match(
        error.cause.message,
        /registry provenance returned HTTP 429/u,
      );
      return true;
    },
  );
  // A persistently throttled attestation endpoint is retried with backoff
  // before the gate fails closed. The two entries verify concurrently, so
  // only per-URL counts are deterministic.
  assert.deepEqual(calls[0].url, registryMetadataUrl(ledgerPackageName));
  const attestationCounts = new Map();
  for (const call of calls.slice(1)) {
    attestationCounts.set(call.url, (attestationCounts.get(call.url) ?? 0) + 1);
  }
  assert.deepEqual(
    [...attestationCounts.entries()].sort(),
    [
      [registryAttestationsUrl(ledgerPackageName, '3.2.0-ultramodern.2'), 4],
      [
        registryAttestationsUrl(ledgerPackageName, ledgerCutoverAnchor.version),
        4,
      ],
    ].sort(),
  );
  assert.deepEqual(waits.sort(), [1000, 1000, 2000, 2000, 3000, 3000]);
});

test('registry source ledger rejects a source commit authenticated under another version', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const ledger = createRegistryLedger([
    ...knownRegistryHistory,
    {
      publishedAt: '2026-05-17T00:00:00.000Z',
      sourceCommit: releaseSource.commit,
      version: '3.2.0-ultramodern.2',
    },
  ]);

  await assert.rejects(
    () =>
      assertRegistrySourceCommitUnpublished(registryLedgerRequest(), {
        bundleVerifier: acceptSigstoreBundle,
        fetchImpl: createRegistryLedgerFetch(ledger, []),
      }),
    new RegExp(
      `Source commit ${releaseSource.commit} is already authenticated and published as @bleedingdev/modern-js-create@3\\.2\\.0-ultramodern\\.2`,
      'u',
    ),
  );
});

test('registry source ledger fetches each pinned attestation once and rejects redirects', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const version = ledgerCutoverAnchor.version;
  const ledger = createRegistryLedger([
    ledgerGrandfatheredVersion,
    {
      ...ledgerCutoverAnchor,
      attestationsUrl: 'https://evil.example/redirect-me',
    },
  ]);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ options, url });
    if (url === registryMetadataUrl(ledgerPackageName)) {
      return provenanceResponse(ledger.metadata);
    }
    return { ok: false, status: 302, json: async () => ({}) };
  };

  await assert.rejects(
    () =>
      assertRegistrySourceCommitUnpublished(registryLedgerRequest(), {
        bundleVerifier: acceptSigstoreBundle,
        fetchImpl,
      }),
    /registry provenance returned HTTP 302/,
  );
  assert.deepEqual(
    calls.map(call => call.url),
    [
      registryMetadataUrl(ledgerPackageName),
      registryAttestationsUrl(ledgerPackageName, version),
    ],
  );
  assert.equal(
    calls.filter(
      call => call.url === registryAttestationsUrl(ledgerPackageName, version),
    ).length,
    1,
  );
  for (const call of calls) {
    assert.equal(call.options.redirect, 'error');
  }
});

test('registry source ledger accepts an exact-version retry from an older attempt in the same run', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const requestedVersion = '3.2.0-ultramodern.2';
  const ledger = createRegistryLedger([
    ...knownRegistryHistory,
    {
      invocationId:
        'https://github.com/BleedingDev/ultramodern.js/actions/runs/123/attempts/1',
      publishedAt: '2026-05-17T00:00:00.000Z',
      sourceCommit: releaseSource.commit,
      version: requestedVersion,
    },
  ]);

  const result = await assertRegistrySourceCommitUnpublished(
    registryLedgerRequest({
      env: { GITHUB_RUN_ATTEMPT: '2', GITHUB_RUN_ID: '123' },
      requestedVersion,
    }),
    {
      bundleVerifier: acceptSigstoreBundle,
      fetchImpl: createRegistryLedgerFetch(ledger, []),
    },
  );

  assert.equal(result.exactVersionAuthenticated, true);
  assert.equal(result.inspectedCount, 2);
  assert.deepEqual(result.cutover, {
    publishedAt: ledgerCutoverAnchor.publishedAt,
    version: ledgerCutoverAnchor.version,
  });
});

test('registry source ledger rejects cross-run, future-attempt, and malformed exact-version provenance', async () => {
  const { assertRegistrySourceCommitUnpublished } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const requestedVersion = '3.2.0-ultramodern.2';
  const cases = [
    {
      invocationId:
        'https://github.com/BleedingDev/ultramodern.js/actions/runs/999/attempts/1',
      pattern: /belongs to workflow run 999, expected 123/,
    },
    {
      invocationId:
        'https://github.com/BleedingDev/ultramodern.js/actions/runs/123/attempts/3',
      pattern: /attempt 3 is newer than current run attempt 2/,
    },
    {
      invocationId: 'not-a-github-invocation',
      pattern: /invocationId must be a GitHub Actions invocation URL/,
    },
    {
      invocationId:
        'https://github.com/Other/repository/actions/runs/123/attempts/1',
      pattern:
        /invocation repository Other\/repository does not match trusted repository/,
    },
  ];

  for (const { invocationId, pattern } of cases) {
    const ledger = createRegistryLedger([
      ...knownRegistryHistory,
      {
        invocationId,
        publishedAt: '2026-05-17T00:00:00.000Z',
        sourceCommit: releaseSource.commit,
        version: requestedVersion,
      },
    ]);
    await assert.rejects(
      () =>
        assertRegistrySourceCommitUnpublished(
          registryLedgerRequest({
            env: { GITHUB_RUN_ATTEMPT: '2', GITHUB_RUN_ID: '123' },
            requestedVersion,
          }),
          {
            bundleVerifier: acceptSigstoreBundle,
            fetchImpl: createRegistryLedgerFetch(ledger, []),
          },
        ),
      pattern,
    );
  }

  await assert.rejects(
    () =>
      assertRegistrySourceCommitUnpublished(
        registryLedgerRequest({ env: { GITHUB_RUN_ID: '123' } }),
        {
          bundleVerifier: acceptSigstoreBundle,
          fetchImpl: async () => {
            throw new Error('must reject incomplete invocation before fetch');
          },
        },
      ),
    /GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT must be supplied together/,
  );
});

test('validateRegistryCohort accepts a coherent latest-tagged full cohort', async () => {
  const { validateRegistryCohort } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = makeManifest();

  await validateRegistryCohort(
    manifest,
    { dryRun: false, tag: 'latest' },
    {
      verifyRegistryPackage: async () => {},
      verifyRegistryDistTag: async (_packageName, tag, version) => {
        assert.equal(tag, 'latest');
        assert.equal(version, '3.2.0-ultramodern.1');
      },
    },
  );
});

test('isTransientNpmPublishError recognizes provenance and registry transport failures', async () => {
  const { isTransientNpmPublishError } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );

  assert.equal(
    isTransientNpmPublishError({
      stderr:
        'npm error code TLOG_CREATE_ENTRY_ERROR\nnpm error error creating tlog entry\nInvalid response body while trying to fetch https://rekor.sigstore.dev/api/v1/log/entries: aborted',
    }),
    true,
  );
  assert.equal(
    isTransientNpmPublishError({
      stderr:
        'npm error code E403\nnpm error You cannot publish over a version',
    }),
    false,
  );
});

test('publishPackage retries transient provenance failures', async () => {
  const { publishPackage } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages[0];
  artifact.packageJson = {
    ...artifact.packageJson,
    publishCachePoison: true,
  };
  const calls = [];

  try {
    const publishedName = await publishPackage(
      artifact,
      { dryRun: false, tag: 'latest' },
      {
        publishAcceptedPackage: async (item, acceptedBytes, options) => {
          calls.push({
            acceptedBytes: Buffer.from(acceptedBytes),
            item,
            options,
          });
          if (calls.length === 1) {
            const error = new Error('npm publish failed with 1');
            error.stderr =
              'npm error code TLOG_CREATE_ENTRY_ERROR\nnpm error error creating tlog entry';
            throw error;
          }
        },
        wait: async () => {},
      },
    );

    assert.equal(publishedName, artifact.targetName);
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].item, artifact);
    assert.notEqual(calls[1].item, artifact);
    assert.equal(calls[0].item.packageJson.publishCachePoison, undefined);
    assert.deepEqual(calls[1].item.packageJson, calls[0].item.packageJson);
    assert.deepEqual(
      calls[0].acceptedBytes,
      fs.readFileSync(artifact.artifactPath),
    );
    assert.deepEqual(calls[1].acceptedBytes, calls[0].acceptedBytes);
    assert.equal(calls[0].options.tag, 'latest');
  } finally {
    removeDir(fixture.root);
  }
});

test('buffer publisher exchanges GitHub OIDC and sends only accepted bytes to libnpmpublish', async () => {
  const { publishAcceptedPackage } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages[0];
  const acceptedBytes = fs.readFileSync(artifact.artifactPath);
  const requests = [];
  let published;

  try {
    const result = await publishAcceptedPackage(
      artifact,
      acceptedBytes,
      {
        acceptedTools: {
          node: process.version,
          npm: '11.17.0',
          pnpm: '10.28.2',
        },
        tag: 'latest',
      },
      {
        env: {
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-request-token',
          ACTIONS_ID_TOKEN_REQUEST_URL:
            'https://pipelines.actions.githubusercontent.com/example/oidc?api-version=2.0',
          GITHUB_ACTIONS: 'true',
        },
        fetchImpl: async (url, options) => {
          requests.push({ options, url: new URL(url).href });
          return requests.length === 1
            ? {
                ok: true,
                json: async () => ({ value: 'github.oidc.token' }),
              }
            : {
                ok: true,
                json: async () => ({ token: 'npm-publish-token' }),
              };
        },
        loadRuntime: () => ({
          libnpmpublishVersion: '11.2.0',
          npmVersion: '11.17.0',
          publish: async (manifest, bytes, options) => {
            published = {
              bytes: Buffer.from(bytes),
              manifest,
              options,
            };
          },
        }),
      },
    );

    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /audience=npm%3Aregistry\.npmjs\.org/u);
    assert.equal(
      requests[0].options.headers.authorization,
      'Bearer github-request-token',
    );
    assert.equal(requests[1].options.method, 'POST');
    assert.equal(
      new URL(requests[1].url).pathname,
      `/-/npm/v1/oidc/token/exchange/package/${artifact.targetName.replace('/', '%2f')}`,
    );
    assert.equal(
      requests[1].options.headers.authorization,
      'Bearer github.oidc.token',
    );
    assert.deepEqual(published.bytes, acceptedBytes);
    assert.notEqual(published.bytes, acceptedBytes);
    assert.equal(published.manifest.name, artifact.targetName);
    assert.equal(published.manifest.version, artifact.version);
    assert.equal(published.options.access, 'public');
    assert.equal(published.options.defaultTag, 'latest');
    assert.equal(published.options.provenance, true);
    assert.equal(
      published.options['//registry.npmjs.org/:_authToken'],
      'npm-publish-token',
    );
    assert.deepEqual(result, {
      libnpmpublishVersion: '11.2.0',
      npmVersion: '11.17.0',
    });
  } finally {
    removeDir(fixture.root);
  }
});

test('trusted publisher preflight discards its credential before the package publish', async () => {
  const { preflightTrustedPublishingPackages, publishAcceptedPackage } =
    await import(
      '../lib/prepare-bleedingdev-packages/npm-buffer-publisher.mjs'
    );
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages[0];
  const acceptedBytes = fs.readFileSync(artifact.artifactPath);
  const exchanges = [];
  let oidcRequests = 0;
  let publishedAuthToken;
  const env = {
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-request-token',
    ACTIONS_ID_TOKEN_REQUEST_URL:
      'https://pipelines.actions.githubusercontent.com/example/oidc?api-version=2.0',
    GITHUB_ACTIONS: 'true',
  };
  const fetchImpl = async url => {
    const requestUrl = new URL(url);
    if (requestUrl.hostname.endsWith('.actions.githubusercontent.com')) {
      oidcRequests += 1;
      return {
        ok: true,
        json: async () => ({ value: `github.oidc.token.${oidcRequests}` }),
      };
    }
    exchanges.push(decodeURIComponent(requestUrl.pathname.split('/').at(-1)));
    return {
      ok: true,
      json: async () => ({ token: `npm-publish-token-${exchanges.length}` }),
    };
  };
  const options = {
    acceptedTools: {
      node: process.version,
      npm: '11.17.0',
      pnpm: '10.28.2',
    },
    tag: 'latest',
  };

  try {
    await preflightTrustedPublishingPackages([artifact], options, {
      env,
      fetchImpl,
    });
    await publishAcceptedPackage(artifact, acceptedBytes, options, {
      env,
      fetchImpl,
      loadRuntime: () => ({
        libnpmpublishVersion: '11.2.0',
        npmVersion: '11.17.0',
        publish: async (_manifest, _bytes, publishOptions) => {
          publishedAuthToken =
            publishOptions['//registry.npmjs.org/:_authToken'];
        },
      }),
    });

    assert.deepEqual(exchanges, [artifact.targetName, artifact.targetName]);
    assert.equal(oidcRequests, 2);
    assert.equal(publishedAuthToken, 'npm-publish-token-2');
  } finally {
    removeDir(fixture.root);
  }
});

test('trusted publisher preflight aggregates every misconfigured package and retries throttling', async () => {
  const { preflightTrustedPublishingPackages } = await import(
    '../lib/prepare-bleedingdev-packages/npm-buffer-publisher.mjs'
  );
  const items = ['alpha', 'beta', 'gamma'].map(name => ({
    targetName: `@bleedingdev/modern-js-${name}`,
  }));
  const attempts = new Map();
  const requestToken = async (packageName, requestOptions) => {
    assert.equal(requestOptions.registryUrl, 'https://registry.npmjs.org/');
    const attempt = (attempts.get(packageName) ?? 0) + 1;
    attempts.set(packageName, attempt);
    if (packageName.endsWith('beta')) {
      throw new Error(
        `npm trusted publishing exchange for ${packageName} returned HTTP 429`,
      );
    }
    if (packageName.endsWith('gamma')) {
      throw new Error(
        `npm trusted publishing exchange for ${packageName} returned HTTP 403`,
      );
    }
    return `discarded-preflight-token-${packageName}`;
  };

  const waits = [];
  await assert.rejects(
    () =>
      preflightTrustedPublishingPackages(
        items,
        { publishConcurrency: 4 },
        {
          env: {},
          requestToken,
          wait: async ms => {
            waits.push(ms);
          },
        },
      ),
    error => {
      assert.deepEqual(error.message.split('\n'), [
        'npm trusted publishing preflight failed for 2 of 3 package(s):',
        '@bleedingdev/modern-js-beta: token exchange stayed throttled after 2 attempts; npm trusted publishing exchange for @bleedingdev/modern-js-beta returned HTTP 429',
        '@bleedingdev/modern-js-gamma: npm trusted publishing exchange for @bleedingdev/modern-js-gamma returned HTTP 403',
      ]);
      return true;
    },
  );
  // Throttling is retried once after a backoff delay; a configuration answer
  // is taken at face value.
  assert.deepEqual([...attempts.entries()].sort(), [
    ['@bleedingdev/modern-js-alpha', 1],
    ['@bleedingdev/modern-js-beta', 2],
    ['@bleedingdev/modern-js-gamma', 1],
  ]);
  assert.deepEqual(waits, [1000]);

  const recovered = [];
  const recoveryWaits = [];
  await preflightTrustedPublishingPackages(
    items,
    { publishConcurrency: 4 },
    {
      env: {},
      requestToken: async packageName => {
        recovered.push(packageName);
        if (
          packageName.endsWith('beta') &&
          recovered.filter(name => name === packageName).length === 1
        ) {
          throw new Error(
            `npm trusted publishing exchange for ${packageName} returned HTTP 503`,
          );
        }
        return `discarded-preflight-token-${packageName}`;
      },
      wait: async ms => {
        recoveryWaits.push(ms);
      },
    },
  );
  assert.equal(recovered.length, items.length + 1);
  assert.deepEqual(recoveryWaits, [1000]);
});

test('installed libnpmpublish binds buffer, tag, auth, and provenance mode', async () => {
  const { loadNpmPublishingRuntime, publishPackageBuffer } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages[0];
  const acceptedBytes = fs.readFileSync(artifact.artifactPath);
  const runtime = loadNpmPublishingRuntime();
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      requests.push({
        body: Buffer.concat(chunks),
        headers: request.headers,
        method: request.method,
        url: request.url,
      });
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const registryUrl = `http://127.0.0.1:${address.port}/`;
  const acceptedTools = {
    node: process.version,
    npm: runtime.npmVersion,
    pnpm: 'fixture-pnpm',
  };

  try {
    await publishPackageBuffer(
      artifact,
      acceptedBytes,
      {
        acceptedTools,
        authToken: 'offline-registry-token',
        provenance: false,
        registryUrl,
        tag: 'requested-tag',
      },
      { runtime },
    );

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.method, 'PUT');
    assert.equal(decodeURIComponent(request.url.slice(1)), artifact.targetName);
    assert.equal(
      request.headers.authorization,
      'Bearer offline-registry-token',
    );
    const body = JSON.parse(request.body.toString('utf8'));
    assert.equal(body['dist-tags']['requested-tag'], artifact.version);
    const attachmentName = `${artifact.targetName}-${artifact.version}.tgz`;
    assert.deepEqual(
      Buffer.from(body._attachments[attachmentName].data, 'base64'),
      acceptedBytes,
    );
    assert.equal(
      Object.keys(body._attachments).some(name => name.endsWith('.sigstore')),
      false,
    );

    const publisherUrl = pathToFileURL(
      path.join(
        repoRoot,
        'scripts/ultramodern-publish/lib/prepare-bleedingdev-packages/npm-buffer-publisher.mjs',
      ),
    ).href;
    const childScript = `
      import fs from 'node:fs';
      const { loadNpmPublishingRuntime, publishPackageBuffer } = await import(${JSON.stringify(
        publisherUrl,
      )});
      const item = JSON.parse(process.env.PUBLISH_ITEM);
      const childRuntime = loadNpmPublishingRuntime();
      try {
        await publishPackageBuffer(
          item,
          fs.readFileSync(item.artifactPath),
          {
            acceptedTools: {
              node: process.version,
              npm: childRuntime.npmVersion,
              pnpm: 'fixture-pnpm',
            },
            authToken: 'offline-registry-token',
            provenance: true,
            registryUrl: process.env.PUBLISH_REGISTRY,
            tag: 'requested-tag',
          },
          { runtime: childRuntime },
        );
        process.exitCode = 2;
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 42;
      }
    `;
    const provenanceResult = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', childScript],
      {
        encoding: 'utf8',
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          PUBLISH_ITEM: JSON.stringify(artifact),
          PUBLISH_REGISTRY: registryUrl,
          TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
        },
        timeout: 5_000,
      },
    );
    assert.equal(
      provenanceResult.status,
      42,
      provenanceResult.stderr || provenanceResult.stdout,
    );
    assert.match(
      provenanceResult.stderr,
      /Automatic provenance generation not supported/u,
    );
    assert.equal(
      requests.length,
      1,
      'failed provenance must not reach registry',
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    removeDir(fixture.root);
  }
});

test('buffer publisher rejects accepted toolchain drift before OIDC', async () => {
  const { publishAcceptedPackage } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages[0];
  const acceptedBytes = fs.readFileSync(artifact.artifactPath);
  let tokenRequests = 0;
  const overrides = {
    loadRuntime: () => ({
      libnpmpublishVersion: '11.2.0',
      npmVersion: '11.17.0',
      publish: async () => {
        throw new Error('must not publish');
      },
    }),
    requestToken: async () => {
      tokenRequests += 1;
      return 'must-not-be-requested';
    },
  };

  try {
    await assert.rejects(
      () =>
        publishAcceptedPackage(
          artifact,
          acceptedBytes,
          {
            acceptedTools: {
              node: 'v0.0.0',
              npm: '11.17.0',
              pnpm: '10.28.2',
            },
            tag: 'latest',
          },
          overrides,
        ),
      /Node\.js drift/u,
    );
    await assert.rejects(
      () =>
        publishAcceptedPackage(
          artifact,
          acceptedBytes,
          {
            acceptedTools: {
              node: process.version,
              npm: '0.0.0',
              pnpm: '10.28.2',
            },
            tag: 'latest',
          },
          overrides,
        ),
      /npm drift/u,
    );
    await assert.rejects(
      () =>
        publishAcceptedPackage(
          artifact,
          acceptedBytes,
          {
            acceptedTools: {
              node: process.version,
              npm: '11.17.0',
              pnpm: '10.28.2',
            },
            tag: '',
          },
          overrides,
        ),
      /Publish dist-tag/u,
    );
    assert.equal(tokenRequests, 0);
  } finally {
    removeDir(fixture.root);
  }
});

test('release artifacts reject package manifests with publish authority', async () => {
  const { createReleaseArtifacts } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = await createArtifactFixture();
  const packagePath = path.resolve(
    repoRoot,
    fixture.packages[0].packageDir,
    'package.json',
  );
  const originalPackageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const cases = [
    {
      mutate: packageJson => {
        packageJson.tag = 'attacker-tag';
      },
      pattern: /must not declare top-level tag/u,
    },
    {
      mutate: packageJson => {
        packageJson.publishConfig.tag = 'attacker-tag';
      },
      pattern: /publishConfig must not declare tag/u,
    },
    {
      mutate: packageJson => {
        packageJson.publishConfig.registry = 'https://attacker.example/';
      },
      pattern: /publishConfig must not declare registry/u,
    },
  ];

  try {
    for (const [index, testCase] of cases.entries()) {
      const packageJson = structuredClone(originalPackageJson);
      testCase.mutate(packageJson);
      writeJson(packagePath, packageJson);
      assert.throws(
        () =>
          createReleaseArtifacts({
            aliases: fixture.aliases,
            outDir: path.join(fixture.root, `rejected-release-${index}`),
            packages: fixture.packages,
            source: releaseSource,
            tag: 'latest',
            tools: releaseTools,
            version: '3.2.0-ultramodern.1',
          }),
        testCase.pattern,
      );
    }
  } finally {
    writeJson(packagePath, originalPackageJson);
    removeDir(fixture.root);
  }
});

test('buffer publisher fails closed without trusted GitHub OIDC inputs', async () => {
  const { requestTrustedPublishingToken } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );

  await assert.rejects(
    () =>
      requestTrustedPublishingToken(
        '@bleedingdev/modern-js-ultramodern-create',
        {
          env: {},
          fetchImpl: async () => {
            throw new Error('must not fetch');
          },
        },
      ),
    /requires GitHub Actions/u,
  );
  await assert.rejects(
    () =>
      requestTrustedPublishingToken(
        '@bleedingdev/modern-js-ultramodern-create',
        {
          env: {
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'token',
            ACTIONS_ID_TOKEN_REQUEST_URL: 'https://attacker.example/oidc',
            GITHUB_ACTIONS: 'true',
          },
          fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
        },
      ),
    /GitHub Actions HTTPS endpoint/u,
  );
});

test('dry-run validation cannot publish or request credentials', async () => {
  const { validateAcceptedPackageDryRun } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages[0];
  const acceptedBytes = fs.readFileSync(artifact.artifactPath);
  let credentialRequests = 0;
  let publishCalls = 0;

  try {
    const result = validateAcceptedPackageDryRun(
      artifact,
      acceptedBytes,
      {
        acceptedTools: releaseTools,
        tag: 'latest',
      },
      {
        loadRuntime: () => ({
          libnpmpublishVersion: 'fixture-libnpmpublish',
          npmVersion: releaseTools.npm,
          publish: async () => {
            publishCalls += 1;
          },
        }),
        requestToken: async () => {
          credentialRequests += 1;
          throw new Error('dry-run must not request credentials');
        },
      },
    );

    assert.deepEqual(result, {
      bytes: acceptedBytes.length,
      libnpmpublishVersion: 'fixture-libnpmpublish',
      manifest: {
        name: artifact.targetName,
        version: artifact.version,
      },
      npmVersion: releaseTools.npm,
      registry: 'https://registry.npmjs.org/',
      tag: 'latest',
    });
    assert.equal(credentialRequests, 0);
    assert.equal(publishCalls, 0);
  } finally {
    removeDir(fixture.root);
  }
});

test('final pack runs once and dry-run consumes accepted bytes without lifecycle scripts', async () => {
  const { publishPackage, verifyReleaseArtifacts } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = await createArtifactFixture({
    scripts: markerPath => {
      const mutation = `require('node:fs').writeFileSync(${JSON.stringify(
        markerPath,
      )}, 'ran')`;
      return {
        prepack: `node -e ${JSON.stringify(mutation)}`,
        prepublishOnly: `node -e ${JSON.stringify(mutation)}`,
      };
    },
  });

  try {
    assert.equal(fixture.packCalls.length, 3);
    for (const call of fixture.packCalls) {
      assert.equal(call.command, 'npm');
      assert.equal(call.args[0], 'pack');
      assert(call.args.includes('--ignore-scripts'));
      assert(call.args.includes('--json'));
      assert(call.args.includes('--pack-destination'));
    }
    assert.equal(fs.existsSync(fixture.markerPath), false);
    assert.equal(
      fs.existsSync(path.join(fixture.outDir, 'manifest.json.sha256')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(fixture.outDir, 'cohort.sha256')),
      true,
    );
    const manifest = fixture.releaseArtifacts.manifest;
    assert.equal(manifest.schema, 'bleedingdev.ultramodern.release-manifest');
    assert.equal(manifest.schemaVersion, 3);
    assert.deepEqual(Object.keys(manifest).sort(), [
      'aliases',
      'cohortDigest',
      'cohortProjection',
      'dependencyGraph',
      'packages',
      'publishOrder',
      'release',
      'schema',
      'schemaVersion',
      'sidecars',
      'source',
      'tools',
    ]);
    assert.equal(manifest.sidecars, null);
    assert.deepEqual(manifest.source, releaseSource);
    assert.deepEqual(manifest.release, {
      tag: 'latest',
      version: '3.2.0-ultramodern.1',
    });
    assert.deepEqual(manifest.tools, releaseTools);
    for (const item of manifest.packages) {
      assert.deepEqual(Object.keys(item).sort(), [
        'fileCount',
        'fileListSha256',
        'integrity',
        'packageJsonSha256',
        'sha256',
        'shasum',
        'size',
        'sourceName',
        'tarballPath',
        'targetName',
        'unpackedSize',
        'version',
      ]);
      assert.match(item.tarballPath, /^tarballs\/[^/]+\.tgz$/u);
      assert.equal(path.isAbsolute(item.tarballPath), false);
    }
    const manifestBytes = fs.readFileSync(
      path.join(fixture.outDir, 'manifest.json'),
    );
    const manifestSha256 = crypto
      .createHash('sha256')
      .update(manifestBytes)
      .digest('hex');
    assert.equal(
      fs.readFileSync(
        path.join(fixture.outDir, 'manifest.json.sha256'),
        'utf8',
      ),
      `${manifestSha256}  manifest.json\n`,
    );
    assert.equal(
      fs.readFileSync(path.join(fixture.outDir, 'cohort.sha256'), 'utf8'),
      `${manifest.cohortDigest}\n`,
    );
    assert.deepEqual(fixture.releaseArtifacts.manifest.publishOrder, [
      '@bleedingdev/modern-js-utils',
      '@bleedingdev/modern-js-runtime',
      '@bleedingdev/modern-js-ultramodern-create',
    ]);

    const artifact = fixture.releaseArtifacts.packages.find(
      item => item.sourceName === '@modern-js/runtime',
    );
    const before = crypto
      .createHash('sha256')
      .update(fs.readFileSync(artifact.artifactPath))
      .digest('hex');
    const acceptedBytes = fs.readFileSync(artifact.artifactPath);
    const publishCalls = [];
    await publishPackage(
      artifact,
      { dryRun: true, tag: 'latest' },
      {
        validateAcceptedPackageDryRun: async (item, bytes, options) => {
          publishCalls.push({ bytes: Buffer.from(bytes), item, options });
          fs.writeFileSync(artifact.artifactPath, 'mutated source path');
          assert.deepEqual(bytes, acceptedBytes);
        },
      },
    );

    assert.equal(publishCalls.length, 1);
    assert.notEqual(publishCalls[0].item, artifact);
    assert.deepEqual(publishCalls[0].item, artifact);
    assert.equal(publishCalls[0].options.dryRun, true);
    assert.deepEqual(publishCalls[0].bytes, acceptedBytes);
    assert.equal(fs.existsSync(fixture.markerPath), false);
    fs.writeFileSync(artifact.artifactPath, acceptedBytes);
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(artifact.artifactPath))
        .digest('hex'),
      before,
    );
    assert.doesNotThrow(() =>
      verifyReleaseArtifacts(
        fixture.outDir,
        artifactExpectations(fixture.aliases),
      ),
    );
  } finally {
    removeDir(fixture.root);
  }
});

test('local acceptance publishes verified buffers even when source paths mutate', async () => {
  const { publishReleaseTarballs } = await import(
    '../lib/source-create-proof/runtime-proof/registry.mjs'
  );
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages[0];
  const acceptedBytes = fs.readFileSync(artifact.artifactPath);
  const publishCalls = [];

  try {
    const published = await publishReleaseTarballs(
      {
        packages: [artifact],
        publishOrder: [artifact.targetName],
        release: fixture.releaseArtifacts.manifest.release,
        tools: fixture.releaseArtifacts.manifest.tools,
      },
      {
        registryUrl: 'http://127.0.0.1:4873/',
        userConfigPath: path.join(fixture.root, '.npmrc'),
      },
      'ephemeral-registry-token',
      {
        publishPackageBufferImpl: async (item, bytes, options) => {
          publishCalls.push({
            bytes: Buffer.from(bytes),
            item,
            options,
          });
          fs.writeFileSync(item.artifactPath, 'mutated source path');
        },
        readRegistryDistImpl: () => ({
          integrity: artifact.integrity,
          shasum: artifact.shasum,
        }),
      },
    );

    assert.equal(publishCalls.length, 1);
    assert.deepEqual(publishCalls[0].bytes, acceptedBytes);
    assert.notDeepEqual(fs.readFileSync(artifact.artifactPath), acceptedBytes);
    assert.deepEqual(
      publishCalls[0].options.acceptedTools,
      fixture.releaseArtifacts.manifest.tools,
    );
    assert.equal(publishCalls[0].options.authToken, 'ephemeral-registry-token');
    assert.equal(publishCalls[0].options.provenance, false);
    assert.equal(publishCalls[0].options.tag, 'latest');
    assert.deepEqual(published, [
      {
        integrity: artifact.integrity,
        shasum: artifact.shasum,
        sourceName: artifact.sourceName,
        targetName: artifact.targetName,
        version: artifact.version,
      },
    ]);
    assert.equal(
      JSON.stringify(published).includes('ephemeral-registry-token'),
      false,
    );
  } finally {
    removeDir(fixture.root);
  }
});

test('local acceptance seeds staged sidecars before the exact cohort', async () => {
  const { publishStagedSidecars } = await import(
    '../lib/source-create-proof/runtime-proof/registry.mjs'
  );
  const fixture = await createArtifactFixture();
  const bytes = Buffer.from('sidecar tarball bytes');
  const integrity = `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;
  const shasum = crypto.createHash('sha1').update(bytes).digest('hex');
  const sidecar = {
    bytes,
    integrity,
    name: '@bleedingdev/ipx',
    shasum,
    version: '3.2.0',
    packageJson: {
      name: '@bleedingdev/ipx',
      version: '3.2.0',
      publishConfig: {
        access: 'public',
        registry: 'https://registry.npmjs.org/',
      },
    },
  };
  const publishCalls = [];

  try {
    const published = await publishStagedSidecars(
      fixture.outDir,
      fixture.releaseArtifacts.manifest.tools,
      {
        registryUrl: 'http://127.0.0.1:4873/',
        userConfigPath: path.join(fixture.root, '.npmrc'),
      },
      'ephemeral-registry-token',
      {
        loadRuntime: () => ({
          libnpmpublishVersion: 'test',
          npmVersion: fixture.releaseArtifacts.manifest.tools.npm,
          publish: async (manifest, publishedBytes, options) => {
            publishCalls.push({
              bytes: Buffer.from(publishedBytes),
              manifest,
              options,
            });
          },
        }),
        readRegistryDistImpl: async () => ({ integrity, shasum }),
        readSidecars: () => ({ sidecars: [sidecar] }),
      },
    );

    assert.equal(publishCalls.length, 1);
    assert.deepEqual(publishCalls[0].bytes, bytes);
    assert.equal(publishCalls[0].options.registry, 'http://127.0.0.1:4873/');
    assert.equal(
      publishCalls[0].options['//127.0.0.1:4873/:_authToken'],
      'ephemeral-registry-token',
    );
    assert.deepEqual(published, [
      {
        name: sidecar.name,
        version: sidecar.version,
        integrity,
        shasum,
      },
    ]);
  } finally {
    removeDir(fixture.root);
  }
});

test('local acceptance registry tolerates transient npm uplink failures', async () => {
  const { createVerdaccioConfig } = await import(
    '../lib/source-create-proof/runtime-proof/registry.mjs'
  );
  const config = createVerdaccioConfig({
    storageDir: '/tmp/registry-storage',
    htpasswdPath: '/tmp/registry-htpasswd',
    scope: 'bleedingdev',
  });

  assert.deepEqual(yaml.load(config).uplinks.npmjs, {
    url: 'https://registry.npmjs.org/',
    timeout: '10m',
    max_fails: 100,
    fail_timeout: '1s',
  });
});

test('local acceptance registry keeps the catch-all npmjs proxy for audit fallback', async () => {
  const { createVerdaccioConfig } = await import(
    '../lib/source-create-proof/runtime-proof/registry.mjs'
  );
  const config = yaml.load(
    createVerdaccioConfig({
      storageDir: '/tmp/registry-storage',
      htpasswdPath: '/tmp/registry-htpasswd',
      scope: 'bleedingdev',
    }),
  );

  // The scoped .npmrc keeps install traffic for external packages off the
  // ephemeral registry, but the catch-all proxy must survive so release-age
  // audit fallbacks through Verdaccio still resolve.
  assert.deepEqual(config.packages['@bleedingdev/*'], {
    access: '$all',
    publish: '$authenticated',
    unpublish: '$authenticated',
  });
  assert.deepEqual(config.packages['**'], {
    access: '$all',
    proxy: 'npmjs',
  });
});

test('local acceptance user config scopes the ephemeral registry and keeps npmjs as the default', async () => {
  const { writeRegistryUserConfig } = await import(
    '../lib/source-create-proof/runtime-proof/registry.mjs'
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-userconfig-'));
  const userConfigPath = path.join(root, '.npmrc');
  try {
    writeRegistryUserConfig(
      userConfigPath,
      'http://127.0.0.1:4873/',
      'ephemeral-registry-token',
      'bleedingdev',
    );
    const lines = fs.readFileSync(userConfigPath, 'utf8').split('\n');
    assert.deepEqual(lines, [
      'registry=https://registry.npmjs.org/',
      '@bleedingdev:registry=http://127.0.0.1:4873/',
      '//127.0.0.1:4873/:_authToken=ephemeral-registry-token',
      '',
    ]);
  } finally {
    removeDir(root);
  }
});

test('local acceptance registry env carries no registry override keys', async () => {
  const { createRegistryEnv } = await import(
    '../lib/source-create-proof/runtime-proof/registry.mjs'
  );
  const env = createRegistryEnv({
    userConfigPath: '/tmp/registry/.npmrc',
    cacheDir: '/tmp/registry/npm-cache',
  });

  assert.deepEqual(env, {
    npm_config_cache: '/tmp/registry/npm-cache',
    npm_config_userconfig: '/tmp/registry/.npmrc',
  });
  // Registry routing lives exclusively in the scoped user config: an env-level
  // registry override would send external packages through the ephemeral
  // registry again.
  assert.deepEqual(
    Object.keys(env).filter(key => key.toLowerCase().includes('registry')),
    [],
  );
});

test('local acceptance packument reader verifies seeded dist metadata and fails closed', async () => {
  const { readRegistryDistFromPackument } = await import(
    '../lib/source-create-proof/runtime-proof/registry.mjs'
  );
  const registry = { registryUrl: 'http://127.0.0.1:4873/' };
  const requests = [];
  const dist = await readRegistryDistFromPackument(
    '@bleedingdev/modern-js-runtime@3.8.2-ultramodern.4',
    registry,
    async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(
        JSON.stringify({
          versions: {
            '3.8.2-ultramodern.4': {
              dist: { integrity: 'sha512-Y2FuZGlkYXRl', shasum: 'abc' },
            },
          },
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      );
    },
  );
  assert.deepEqual(dist, { integrity: 'sha512-Y2FuZGlkYXRl', shasum: 'abc' });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'http://127.0.0.1:4873/@bleedingdev%2fmodern-js-runtime',
  );

  await assert.rejects(
    readRegistryDistFromPackument(
      '@bleedingdev/modern-js-runtime@3.8.2-ultramodern.4',
      registry,
      async () => new Response('missing', { status: 404 }),
    ),
    /returned HTTP 404/,
  );

  await assert.rejects(
    readRegistryDistFromPackument(
      '@bleedingdev/modern-js-runtime@3.8.2-ultramodern.4',
      registry,
      async () =>
        new Response(JSON.stringify({ versions: {} }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    ),
    /is missing dist metadata/,
  );
});

test('registry preflight accepts a revision reset on a newer Modern.js base', async () => {
  const { preflightRegistryPackages } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const targetName = '@bleedingdev/modern-js-create';
  const version = '3.8.1-ultramodern.1';

  const states = await preflightRegistryPackages(
    [{ targetName, version }],
    { dryRun: true, tag: 'latest', version },
    {},
    {
      lookupRegistryDistTag: async () => '3.5.0-ultramodern.103',
      lookupRegistryPackageDist: async () => null,
      verifyRegistryPackageDist: async () => {
        throw new Error('absent candidates have no registry bytes to verify');
      },
    },
  );

  assert.deepEqual(states.get(targetName), {
    currentTag: '3.5.0-ultramodern.103',
    dist: null,
    exists: false,
  });
});

test('registry preflight rejects a non-forward candidate before publication', async () => {
  const { preflightRegistryPackages } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const targetName = '@bleedingdev/modern-js-create';
  const version = '3.5.0-ultramodern.102';

  await assert.rejects(
    () =>
      preflightRegistryPackages(
        [{ targetName, version }],
        { dryRun: false, tag: 'latest', version },
        {},
        {
          lookupRegistryDistTag: async () => '3.5.0-ultramodern.103',
          lookupRegistryPackageDist: async () => null,
          verifyRegistryPackageDist: async () => {
            throw new Error(
              'absent candidates have no registry bytes to verify',
            );
          },
        },
      ),
    /must be greater than current latest 3\.5\.0-ultramodern\.103/u,
  );
});

test('registry preflight rejects a carried-over revision on a newer Modern.js base', async () => {
  const { preflightRegistryPackages } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const targetName = '@bleedingdev/modern-js-create';
  // Forward semver, so plain ordering accepts it, but it claims a release
  // history 3.8.2 never had.
  const version = '3.8.2-ultramodern.6';

  await assert.rejects(
    () =>
      preflightRegistryPackages(
        [{ targetName, version }],
        { dryRun: false, tag: 'latest', version },
        {},
        {
          lookupRegistryDistTag: async () => '3.8.1-ultramodern.5',
          lookupRegistryPackageDist: async () => null,
          verifyRegistryPackageDist: async () => {
            throw new Error(
              'absent candidates have no registry bytes to verify',
            );
          },
        },
      ),
    /the only valid next version on a base change is 3\.8\.2-ultramodern\.1/u,
  );
});

test('registry preflight lets a recovery cohort claim the next free revision after a partial publish', async () => {
  const { preflightRegistryPackages } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  // A crashed cohort attempt left one member already tagged on the new base,
  // burning `.1` for everyone; the recovery cohort moves together at `.2`.
  const version = '3.8.2-ultramodern.2';
  const tagsByPackage = {
    '@bleedingdev/modern-js-utils': '3.8.2-ultramodern.1',
    '@bleedingdev/modern-js-create': '3.8.1-ultramodern.5',
  };

  const states = await preflightRegistryPackages(
    [
      { targetName: '@bleedingdev/modern-js-utils', version },
      { targetName: '@bleedingdev/modern-js-create', version },
    ],
    { dryRun: true, tag: 'latest', version },
    {},
    {
      lookupRegistryDistTag: async name => tagsByPackage[name],
      lookupRegistryPackageDist: async () => null,
      verifyRegistryPackageDist: async () => {
        throw new Error('absent candidates have no registry bytes to verify');
      },
    },
  );

  assert.equal(
    states.get('@bleedingdev/modern-js-create').currentTag,
    '3.8.1-ultramodern.5',
  );
});

test('registry preflight converges a cohort whose own version is already partially published', async () => {
  const { preflightRegistryPackages } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  // The recovery cohort itself crashed mid-publish: one member already sits at
  // the cohort version. That member is this cohort placed, not a burned
  // remnant, so the stragglers still on the old base publish at the SAME
  // cohort version instead of being pushed to yet another revision.
  const version = '3.8.2-ultramodern.2';
  const tagsByPackage = {
    '@bleedingdev/modern-js-utils': '3.8.2-ultramodern.2',
    '@bleedingdev/modern-js-create': '3.8.1-ultramodern.5',
  };
  const utilsDist = { shasum: 'abc', integrity: 'sha512-abc' };

  const states = await preflightRegistryPackages(
    [
      { targetName: '@bleedingdev/modern-js-utils', version },
      { targetName: '@bleedingdev/modern-js-create', version },
    ],
    { dryRun: true, tag: 'latest', version },
    {},
    {
      lookupRegistryDistTag: async name => tagsByPackage[name],
      lookupRegistryPackageDist: async name =>
        name === '@bleedingdev/modern-js-utils' ? utilsDist : null,
      verifyRegistryPackageDist: async () => utilsDist,
    },
  );

  assert.equal(states.get('@bleedingdev/modern-js-utils').exists, true);
  assert.equal(states.get('@bleedingdev/modern-js-create').exists, false);
  assert.equal(
    states.get('@bleedingdev/modern-js-create').currentTag,
    '3.8.1-ultramodern.5',
  );
});

test('registry preflight still rejects revisions past the next free one after a partial publish', async () => {
  const { preflightRegistryPackages } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const version = '3.8.2-ultramodern.3';
  const tagsByPackage = {
    '@bleedingdev/modern-js-utils': '3.8.2-ultramodern.1',
    '@bleedingdev/modern-js-create': '3.8.1-ultramodern.5',
  };

  await assert.rejects(
    () =>
      preflightRegistryPackages(
        [
          { targetName: '@bleedingdev/modern-js-utils', version },
          { targetName: '@bleedingdev/modern-js-create', version },
        ],
        { dryRun: false, tag: 'latest', version },
        {},
        {
          lookupRegistryDistTag: async name => tagsByPackage[name],
          lookupRegistryPackageDist: async () => null,
          verifyRegistryPackageDist: async () => {
            throw new Error(
              'absent candidates have no registry bytes to verify',
            );
          },
        },
      ),
    /the only valid next version on a base change is 3\.8\.2-ultramodern\.2 \(lower revisions at base 3\.8\.2 are burned by a partially published cohort\)/u,
  );
});

test('registry preflight keeps ordinary same-base revisions moving forward', async () => {
  const { preflightRegistryPackages } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const targetName = '@bleedingdev/modern-js-create';
  const version = '3.8.2-ultramodern.2';

  const states = await preflightRegistryPackages(
    [{ targetName, version }],
    { dryRun: true, tag: 'latest', version },
    {},
    {
      lookupRegistryDistTag: async () => '3.8.2-ultramodern.1',
      lookupRegistryPackageDist: async () => null,
      verifyRegistryPackageDist: async () => {
        throw new Error('absent candidates have no registry bytes to verify');
      },
    },
  );

  assert.equal(states.get(targetName).currentTag, '3.8.2-ultramodern.1');
});

test('registry preflight resolves both phases from the package packument', async () => {
  const {
    lookupRegistryDistTag,
    lookupRegistryPackageDist,
    preflightRegistryPackages,
  } = await import('../lib/prepare-bleedingdev-packages/registry.mjs');
  const version = '3.8.2-ultramodern.2';
  const targetName = '@bleedingdev/modern-js-utils';
  const dist = { integrity: 'sha512-utils', shasum: 'c'.repeat(40) };
  const packumentCalls = [];
  const verifiedDists = [];

  const states = await preflightRegistryPackages(
    [{ targetName, version }],
    { dryRun: true, publishConcurrency: 4, tag: 'latest', version },
    {},
    {
      lookupRegistryDistTag,
      lookupRegistryPackageDist,
      lookupRegistryPackument: async packageName => {
        packumentCalls.push(packageName);
        return {
          'dist-tags': { latest: version, next: '9.9.9' },
          versions: { [version]: { dist } },
        };
      },
      verifyRegistryPackageDist: async (_item, resolvedDist) => {
        verifiedDists.push(resolvedDist);
      },
    },
  );

  // Both phases read the packument; the default lookup memoizes the request.
  assert.deepEqual(packumentCalls, [targetName, targetName]);
  assert.deepEqual(verifiedDists, [dist]);
  assert.deepEqual(states.get(targetName), {
    currentTag: version,
    dist,
    exists: true,
  });
});

test('registry preflight treats a 404 packument as an absent package', async () => {
  const {
    lookupRegistryDistTag,
    lookupRegistryPackageDist,
    preflightRegistryPackages,
  } = await import('../lib/prepare-bleedingdev-packages/registry.mjs');
  const version = '3.8.2-ultramodern.2';
  const targetName = '@bleedingdev/modern-js-utils';

  const states = await preflightRegistryPackages(
    [{ targetName, version }],
    { dryRun: true, publishConcurrency: 4, tag: 'latest', version },
    {},
    {
      lookupRegistryDistTag,
      lookupRegistryPackageDist,
      lookupRegistryPackument: async packageName => {
        throw new Error(`${packageName} registry metadata returned HTTP 404`);
      },
      verifyRegistryPackageDist: async () => {
        throw new Error('absent candidates have no registry bytes to verify');
      },
    },
  );

  assert.deepEqual(states.get(targetName), {
    currentTag: undefined,
    dist: null,
    exists: false,
  });
});

test('registry preflight fails closed on malformed packument version metadata', async () => {
  const {
    lookupRegistryDistTag,
    lookupRegistryPackageDist,
    preflightRegistryPackages,
  } = await import('../lib/prepare-bleedingdev-packages/registry.mjs');
  const version = '3.8.2-ultramodern.2';
  const targetName = '@bleedingdev/modern-js-utils';
  const preflightWithPackument = packument =>
    preflightRegistryPackages(
      [{ targetName, version }],
      { dryRun: true, publishConcurrency: 4, tag: 'latest', version },
      {},
      {
        lookupRegistryDistTag,
        lookupRegistryPackageDist,
        lookupRegistryPackument: async () => packument,
        verifyRegistryPackageDist: async () => {
          throw new Error('malformed metadata must never reach verification');
        },
      },
    );

  // Neither malformed shape may collapse to "absent": that answer would let
  // the cohort claim a revision on data it never actually inspected.
  await assert.rejects(
    () => preflightWithPackument({ 'dist-tags': {}, versions: 'corrupt' }),
    new RegExp(
      `${targetName}@${version.replace(/\./gu, '\\.')}: ${targetName} returned invalid registry versions metadata`,
      'u',
    ),
  );
  await assert.rejects(
    () =>
      preflightWithPackument({
        'dist-tags': {},
        versions: { [version]: { dist: 'corrupt' } },
      }),
    new RegExp(
      `${targetName}@${version.replace(/\./gu, '\\.')} registry version entry has no dist metadata`,
      'u',
    ),
  );
});

test('registry preflight fails closed when the packument stays throttled', async () => {
  const {
    lookupRegistryDistTag,
    lookupRegistryPackageDist,
    lookupRegistryPackument,
    preflightRegistryPackages,
  } = await import('../lib/prepare-bleedingdev-packages/registry.mjs');
  const version = '3.8.2-ultramodern.2';
  const targetName = '@bleedingdev/modern-js-utils';
  let fetchCalls = 0;

  await assert.rejects(
    () =>
      preflightRegistryPackages(
        [{ targetName, version }],
        { dryRun: false, publishConcurrency: 8, tag: 'latest', version },
        {},
        {
          lookupRegistryDistTag,
          lookupRegistryPackageDist,
          lookupRegistryPackument: packageName =>
            lookupRegistryPackument(packageName, {
              fetchImpl: async () => {
                fetchCalls += 1;
                return { ok: false, status: 429 };
              },
              wait: async () => {},
            }),
          verifyRegistryPackageDist: async () => {},
        },
      ),
    /registry metadata stayed throttled after 4 attempts/u,
  );
  assert.equal(fetchCalls, 4);
});

test('packument lookup retries transient registry responses', async () => {
  const { lookupRegistryPackument } = await import(
    '../lib/prepare-bleedingdev-packages/registry.mjs'
  );
  const packument = { 'dist-tags': { latest: '3.8.2-ultramodern.2' } };
  const statuses = [503, 429];
  let fetchCalls = 0;
  const waits = [];

  const resolved = await lookupRegistryPackument(
    '@bleedingdev/modern-js-utils',
    {
      fetchImpl: async (url, requestOptions) => {
        fetchCalls += 1;
        assert.equal(
          url,
          'https://registry.npmjs.org/%40bleedingdev%2Fmodern-js-utils',
        );
        assert.equal(requestOptions.redirect, 'error');
        const status = statuses.shift();
        return status
          ? { ok: false, status }
          : { ok: true, json: async () => packument };
      },
      wait: async ms => {
        waits.push(ms);
      },
    },
  );

  assert.deepEqual(resolved, packument);
  assert.equal(fetchCalls, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('mapWithConcurrency preserves order while bounding in-flight work', async () => {
  const { mapWithConcurrency } = await import(
    '../lib/prepare-bleedingdev-packages/registry.mjs'
  );
  let inFlight = 0;
  let peak = 0;

  const results = await mapWithConcurrency(
    [1, 2, 3, 4, 5, 6, 7],
    3,
    async value => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, (8 - value) * 2));
      inFlight -= 1;
      return value * 10;
    },
  );

  assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70]);
  assert.equal(peak, 3);
});

test('validateRegistryCohort verifies members concurrently and reports failures in manifest order', async () => {
  const { validateRegistryCohort } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = {
    ...makeManifest(),
    packages: ['alpha', 'beta', 'gamma', 'delta'].map(name => ({
      sourceName: `@modern-js/${name}`,
      targetName: `@bleedingdev/modern-js-${name}`,
      version: '3.2.0-ultramodern.1',
    })),
  };
  const verified = [];
  let inFlight = 0;
  let peak = 0;

  await assert.rejects(
    () =>
      validateRegistryCohort(
        manifest,
        { dryRun: false, publishConcurrency: 4, tag: 'latest' },
        {
          verifyRegistryDistTag: async () => {},
          verifyRegistryPackage: async item => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            verified.push(item.targetName);
            // The later member fails first, so a completion-ordered report
            // would invert the manifest ordering.
            const failing = item.targetName.endsWith('alpha')
              ? { delayMs: 20, fail: true }
              : item.targetName.endsWith('gamma')
                ? { delayMs: 0, fail: true }
                : { delayMs: 10, fail: false };
            await new Promise(resolve => setTimeout(resolve, failing.delayMs));
            inFlight -= 1;
            if (failing.fail) {
              throw new Error(`${item.targetName} is not present`);
            }
          },
        },
      ),
    error => {
      assert.deepEqual(error.message.split('\n').slice(2), [
        '@bleedingdev/modern-js-alpha@3.2.0-ultramodern.1: @bleedingdev/modern-js-alpha is not present',
        '@bleedingdev/modern-js-gamma@3.2.0-ultramodern.1: @bleedingdev/modern-js-gamma is not present',
      ]);
      return true;
    },
  );

  assert.deepEqual(verified.sort(), [
    '@bleedingdev/modern-js-alpha',
    '@bleedingdev/modern-js-beta',
    '@bleedingdev/modern-js-delta',
    '@bleedingdev/modern-js-gamma',
  ]);
  assert.equal(peak, 4);
});

test('post-publish verification re-resolves the dist every attempt and downloads the tarball once', async () => {
  const {
    registryVerificationRetryDelaysMs,
    verifyRegistryPackage,
    verifyRegistryPackageDist,
  } = await import('../lib/prepare-bleedingdev-packages/registry.mjs');

  // The propagation window itself is a hard release invariant: 36 attempts and
  // at least 350s of cumulative sleep across the 35 delays the loop can spend.
  assert.equal(registryVerificationRetryDelaysMs.length, 36);
  assert(
    registryVerificationRetryDelaysMs
      .slice(0, 35)
      .reduce((total, delayMs) => total + delayMs, 0) >= 350000,
  );

  const item = {
    integrity: 'sha512-fixture',
    shasum: 'fixture-shasum',
    targetName: '@bleedingdev/modern-js-utils',
    version: '3.2.0-ultramodern.1',
  };
  const pinnedTarball =
    'https://registry.npmjs.org/@bleedingdev/modern-js-utils/-/modern-js-utils-3.2.0-ultramodern.1.tgz';
  const lookups = [];
  let tarballDownloads = 0;
  let provenanceChecks = 0;
  const startedAt = Date.now();

  const dist = await verifyRegistryPackage(
    item,
    { issuer: 'fixture-issuer' },
    {
      assertRegistryDistMatches: () => {},
      lookupRegistryPackageDist: async (packageName, version) => {
        lookups.push(`${packageName}@${version}`);
        // A lagging publish only grows attestations on a later lookup.
        return lookups.length === 1
          ? {
              integrity: item.integrity,
              shasum: item.shasum,
              tarball: pinnedTarball,
            }
          : {
              attestations: { provenance: {} },
              integrity: item.integrity,
              shasum: item.shasum,
              tarball: pinnedTarball,
            };
      },
      verifyRegistryPackageDist,
      verifyRegistryProvenance: async (_item, resolvedDist) => {
        provenanceChecks += 1;
        if (!resolvedDist.attestations) {
          throw new Error('registry dist.attestations must be a plain object');
        }
      },
      verifyRegistryTarball: async () => {
        tarballDownloads += 1;
      },
    },
  );

  assert.deepEqual(dist.attestations, { provenance: {} });
  assert.deepEqual(lookups, [
    '@bleedingdev/modern-js-utils@3.2.0-ultramodern.1',
    '@bleedingdev/modern-js-utils@3.2.0-ultramodern.1',
  ]);
  assert.equal(provenanceChecks, 2);
  assert.equal(tarballDownloads, 1);
  const elapsed = Date.now() - startedAt;
  assert(elapsed >= registryVerificationRetryDelaysMs[0]);
  assert(elapsed < 10000);
});

test('post-publish verification re-pins the tarball URL after the download is memoized', async () => {
  const { verifyRegistryPackage, verifyRegistryPackageDist } = await import(
    '../lib/prepare-bleedingdev-packages/registry.mjs'
  );
  const item = {
    integrity: 'sha512-fixture',
    shasum: 'fixture-shasum',
    targetName: '@bleedingdev/modern-js-utils',
    version: '3.2.0-ultramodern.1',
  };
  const pinnedTarball =
    'https://registry.npmjs.org/@bleedingdev/modern-js-utils/-/modern-js-utils-3.2.0-ultramodern.1.tgz';
  let lookupCount = 0;
  let tarballDownloads = 0;
  let provenanceChecks = 0;

  const dist = await verifyRegistryPackage(
    item,
    { issuer: 'fixture-issuer' },
    {
      assertRegistryDistMatches: () => {},
      lookupRegistryPackageDist: async () => {
        lookupCount += 1;
        // Attempt 2 swaps in an unpinned tarball URL after the bytes already
        // matched once; the memoized download must not vouch for it.
        return {
          attestations: lookupCount === 1 ? undefined : { provenance: {} },
          integrity: item.integrity,
          shasum: item.shasum,
          tarball:
            lookupCount === 2
              ? 'https://tarballs.example.com/modern-js-utils-3.2.0-ultramodern.1.tgz'
              : pinnedTarball,
        };
      },
      verifyRegistryPackageDist,
      verifyRegistryProvenance: async (_item, resolvedDist) => {
        provenanceChecks += 1;
        if (!resolvedDist.attestations) {
          throw new Error('registry dist.attestations must be a plain object');
        }
      },
      verifyRegistryTarball: async () => {
        tarballDownloads += 1;
      },
    },
  );

  assert.deepEqual(dist.attestations, { provenance: {} });
  assert.equal(lookupCount, 3);
  assert.equal(tarballDownloads, 1);
  // Attempt 2 dies on the unpinned URL before provenance is consulted.
  assert.equal(provenanceChecks, 2);
});

test('validateRegistryCohort stops launching windows after three failed members', async () => {
  const { validateRegistryCohort } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const manifest = {
    ...makeManifest(),
    packages: Array.from({ length: 8 }, (_value, index) => ({
      sourceName: `@modern-js/pkg-${index}`,
      targetName: `@bleedingdev/modern-js-pkg-${index}`,
      version: '3.2.0-ultramodern.1',
    })),
  };
  const attempted = [];

  await assert.rejects(
    () =>
      validateRegistryCohort(
        manifest,
        { dryRun: false, publishConcurrency: 1, tag: 'latest' },
        {
          verifyRegistryDistTag: async () => {},
          verifyRegistryPackage: async item => {
            attempted.push(item.targetName);
            throw new Error(`${item.targetName} did not verify on npm`);
          },
        },
      ),
    /Stopped after 3 failed members; 5 remaining member\(s\) were left unverified\./u,
  );

  assert.deepEqual(attempted, [
    '@bleedingdev/modern-js-pkg-0',
    '@bleedingdev/modern-js-pkg-1',
    '@bleedingdev/modern-js-pkg-2',
  ]);
});

test('the release validator tracks the merged Modern.js source version', async () => {
  const { enforceSingleVersionPolicy } = await import(
    '../lib/prepare-bleedingdev-packages/rewrite.mjs'
  );
  // Read straight from the repository so the merged upstream baseline — not a
  // hand-written fixture — decides which release versions are legal.
  const packages = [
    {
      packageJson: {
        name: '@modern-js/create',
        version: sourceFrameworkVersion,
      },
    },
  ];
  const accept = version =>
    enforceSingleVersionPolicy(
      { dependencyVersion: version, version },
      packages,
      packages,
    );

  assert.equal(sourceFrameworkVersion, '3.8.3');
  assert.doesNotThrow(() => accept('3.8.3-ultramodern.1'));
  for (const stale of ['3.8.2-ultramodern.1', '3.8.2-ultramodern.16']) {
    assert.throws(
      () => accept(stale),
      /release base 3\.8\.2 does not match the incorporated Modern\.js source version 3\.8\.3/i,
      `expected ${stale} to be rejected after the 3.8.3 merge`,
    );
  }
});

test('dry-run preflights absent versions and publishes every exact snapshot without claiming provenance', async () => {
  const { publishManifestPackages, publishPackage, verifyPackageArtifact } =
    await import('../prepare-bleedingdev-packages.mjs');
  const fixture = await createArtifactFixture();
  const npmCalls = [];
  const packageLookups = [];
  const tagLookups = [];
  const logs = [];
  let cohortValidationCalls = 0;
  let localVerificationCalls = 0;
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    await publishManifestPackages(
      fixture.releaseArtifacts,
      {
        dryRun: true,
        publishConcurrency: 1,
        tag: 'latest',
        version: '3.2.0-ultramodern.1',
      },
      {
        lookupRegistryDistTag: async (packageName, tag) => {
          tagLookups.push({ packageName, tag });
          return '3.1.0-ultramodern.44';
        },
        lookupRegistryPackageDist: async (packageName, version) => {
          packageLookups.push({ packageName, version });
          return null;
        },
        publishPackage: (artifact, options) =>
          publishPackage(artifact, options, {
            validateAcceptedPackageDryRun: async (
              item,
              bytes,
              publishOptions,
            ) => {
              npmCalls.push({
                acceptedTools: publishOptions.acceptedTools,
                bytes: Buffer.from(bytes),
                targetName: item.targetName,
              });
            },
          }),
        validateRegistryCohort: async () => {
          cohortValidationCalls += 1;
        },
        verifyPackageArtifact: (artifact, artifactPath) => {
          localVerificationCalls += 1;
          return verifyPackageArtifact(artifact, artifactPath);
        },
        verifyRegistryDistTag: async () => {
          throw new Error('dry-run must not perform final tag assertion');
        },
        verifyRegistryPackage: async () => {
          throw new Error('absent dry-run cannot perform post-publish checks');
        },
        verifyRegistryPackageDist: async () => {
          throw new Error('absent versions have no registry bytes to verify');
        },
      },
    );

    assert.equal(cohortValidationCalls, 0);
    assert.equal(
      localVerificationCalls,
      fixture.releaseArtifacts.packages.length * 2,
    );
    assert.equal(
      packageLookups.length,
      fixture.releaseArtifacts.packages.length,
    );
    assert.equal(tagLookups.length, fixture.releaseArtifacts.packages.length);
    assert.equal(npmCalls.length, fixture.releaseArtifacts.packages.length);
    assert.deepEqual(
      npmCalls.map(call => call.targetName),
      fixture.releaseArtifacts.manifest.publishOrder,
    );
    for (const call of npmCalls) {
      const artifact = fixture.releaseArtifacts.packages.find(
        item => item.targetName === call.targetName,
      );
      assert.deepEqual(
        call.acceptedTools,
        fixture.releaseArtifacts.manifest.tools,
      );
      assert.deepEqual(call.bytes, fs.readFileSync(artifact.artifactPath));
    }
    assert.equal(
      logs.filter(message =>
        message.includes('provenance equivalence cannot be asserted'),
      ).length,
      fixture.releaseArtifacts.packages.length,
    );
  } finally {
    console.log = originalLog;
    removeDir(fixture.root);
  }
});

test('dry-run fully verifies existing registry versions and tags before invoking npm for every tarball', async () => {
  const { publishManifestPackages } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = await createArtifactFixture();
  const preflightChecks = [];
  const npmCalls = [];

  try {
    await publishManifestPackages(
      fixture.releaseArtifacts,
      {
        dryRun: true,
        publishConcurrency: 1,
        tag: 'latest',
        version: '3.2.0-ultramodern.1',
      },
      {
        lookupRegistryDistTag: async (_packageName, _tag) =>
          '3.2.0-ultramodern.1',
        lookupRegistryPackageDist: async packageName => {
          const artifact = fixture.releaseArtifacts.packages.find(
            item => item.targetName === packageName,
          );
          return registryDistFor(artifact);
        },
        publishPackage: async (artifact, options) => {
          npmCalls.push({ artifact, options });
          return artifact.targetName;
        },
        verifyRegistryPackageDist: async (artifact, dist, expectation) => {
          preflightChecks.push({ artifact, dist, expectation });
        },
      },
    );

    assert.equal(
      preflightChecks.length,
      fixture.releaseArtifacts.packages.length,
    );
    assert.equal(npmCalls.length, fixture.releaseArtifacts.packages.length);
    for (const check of preflightChecks) {
      assert.equal(check.dist.integrity, check.artifact.integrity);
      assert.equal(check.dist.shasum, check.artifact.shasum);
      assert.equal(check.expectation.issuer, trustedOidcIssuer);
      assert.equal(
        check.expectation.certificateIdentity,
        'https://github.com/BleedingDev/ultramodern.js/.github/workflows/publish-bleedingdev.yml@refs/heads/main-ultramodern',
      );
    }
    assert(npmCalls.every(call => call.options.dryRun));
  } finally {
    removeDir(fixture.root);
  }
});

test('trusted publishing rejects the entire absent cohort before the first registry mutation', async () => {
  const { publishManifestPackages } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = await createArtifactFixture();
  const exchangeRequests = [];
  const registryMutations = [];

  try {
    await assert.rejects(
      () =>
        publishManifestPackages(
          fixture.releaseArtifacts,
          {
            dryRun: false,
            publishConcurrency: 1,
            tag: 'latest',
            version: '3.2.0-ultramodern.1',
          },
          {
            lookupRegistryDistTag: async () => '3.1.0-ultramodern.previous',
            lookupRegistryPackageDist: async () => null,
            publishPackage: async artifact => {
              registryMutations.push(artifact.targetName);
              return artifact.targetName;
            },
            trustedPublishing: {
              env: {
                ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-request-token',
                ACTIONS_ID_TOKEN_REQUEST_URL:
                  'https://pipelines.actions.githubusercontent.com/example/oidc?api-version=2.0',
                GITHUB_ACTIONS: 'true',
              },
              fetchImpl: async url => {
                const requestUrl = new URL(url);
                if (
                  requestUrl.hostname.endsWith('.actions.githubusercontent.com')
                ) {
                  return {
                    ok: true,
                    json: async () => ({
                      value: `github.oidc.token.${exchangeRequests.length + 1}`,
                    }),
                  };
                }
                exchangeRequests.push(requestUrl.pathname);
                return exchangeRequests.length === 2
                  ? { ok: false, status: 403 }
                  : {
                      ok: true,
                      json: async () => ({
                        token: `discarded-preflight-token-${exchangeRequests.length}`,
                      }),
                    };
              },
            },
            verifyRegistryPackage: async () => {},
          },
        ),
      error => {
        assert.match(error.message, /returned HTTP 403/u);
        assert.match(
          error.message,
          new RegExp(
            `npm trusted publishing preflight failed for 1 of ${fixture.releaseArtifacts.manifest.publishOrder.length} package\\(s\\):`,
            'u',
          ),
        );
        assert.match(
          error.message,
          new RegExp(
            `^${fixture.releaseArtifacts.manifest.publishOrder[1]}: `,
            'mu',
          ),
        );
        assert.doesNotMatch(error.message, /throttled/u);
        return true;
      },
    );

    assert.deepEqual(
      exchangeRequests,
      fixture.releaseArtifacts.manifest.publishOrder.map(
        packageName =>
          `/-/npm/v1/oidc/token/exchange/package/${packageName.replace('/', '%2f')}`,
      ),
    );
    assert.deepEqual(registryMutations, []);
  } finally {
    removeDir(fixture.root);
  }
});

test('trusted publishing authorizes every absent package before publishing any of them', async () => {
  const { publishManifestPackages } = await import(
    '../prepare-bleedingdev-packages.mjs'
  );
  const fixture = await createArtifactFixture();
  const [existingTarget, ...absentTargets] =
    fixture.releaseArtifacts.manifest.publishOrder;
  const events = [];

  try {
    await publishManifestPackages(
      fixture.releaseArtifacts,
      {
        dryRun: false,
        publishConcurrency: 1,
        tag: 'latest',
        version: '3.2.0-ultramodern.1',
      },
      {
        lookupRegistryDistTag: async packageName =>
          packageName === existingTarget
            ? '3.2.0-ultramodern.1'
            : '3.1.0-ultramodern.previous',
        lookupRegistryPackageDist: async packageName => {
          if (packageName !== existingTarget) {
            return null;
          }
          const artifact = fixture.releaseArtifacts.packages.find(
            item => item.targetName === packageName,
          );
          return registryDistFor(artifact);
        },
        publishPackage: async artifact => {
          events.push({ kind: 'registry-mutation', name: artifact.targetName });
          return artifact.targetName;
        },
        trustedPublishing: {
          env: {
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-request-token',
            ACTIONS_ID_TOKEN_REQUEST_URL:
              'https://pipelines.actions.githubusercontent.com/example/oidc?api-version=2.0',
            GITHUB_ACTIONS: 'true',
          },
          fetchImpl: async url => {
            const requestUrl = new URL(url);
            if (
              requestUrl.hostname.endsWith('.actions.githubusercontent.com')
            ) {
              return {
                ok: true,
                json: async () => ({ value: 'fresh-github-oidc-token' }),
              };
            }
            const targetName = decodeURIComponent(
              requestUrl.pathname.split('/').at(-1),
            );
            events.push({ kind: 'publisher-authorized', name: targetName });
            return {
              ok: true,
              json: async () => ({
                token: `discarded-token-for-${targetName}`,
              }),
            };
          },
        },
        validateRegistryCohort: async () => {},
        verifyRegistryPackage: async () => {},
        verifyRegistryPackageDist: async () => {},
      },
    );

    assert.deepEqual(events, [
      ...absentTargets.map(name => ({
        kind: 'publisher-authorized',
        name,
      })),
      ...absentTargets.map(name => ({ kind: 'registry-mutation', name })),
    ]);
  } finally {
    removeDir(fixture.root);
  }
});

test('real publish verifies every published package once in the cohort pass', async () => {
  const {
    publishManifestPackages,
    validateRegistryCohort,
    verifyPackageArtifact,
  } = await import('../prepare-bleedingdev-packages.mjs');
  const fixture = await createArtifactFixture();
  const events = [];

  try {
    await publishManifestPackages(
      fixture.releaseArtifacts,
      {
        dryRun: false,
        publishConcurrency: 1,
        tag: 'latest',
        version: '3.2.0-ultramodern.1',
      },
      {
        assertRegistryDistMatches: () => {},
        lookupRegistryDistTag: async () => '3.1.0-ultramodern.44',
        lookupRegistryPackageDist: async () => null,
        publishPackage: async artifact => {
          events.push({
            artifactPath: artifact.artifactPath,
            kind: 'publish',
            targetName: artifact.targetName,
          });
          return artifact.targetName;
        },
        validateRegistryCohort: async (
          cohortManifest,
          cohortOptions,
          cohortRegistry,
        ) => {
          assert.equal(cohortOptions.dryRun, false);
          events.push({ kind: 'cohort' });
          await validateRegistryCohort(
            cohortManifest,
            cohortOptions,
            cohortRegistry,
          );
        },
        trustedPublishing: {
          env: {
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'github-request-token',
            ACTIONS_ID_TOKEN_REQUEST_URL:
              'https://pipelines.actions.githubusercontent.com/example/oidc?api-version=2.0',
            GITHUB_ACTIONS: 'true',
          },
          fetchImpl: async url =>
            new URL(url).hostname.endsWith('.actions.githubusercontent.com')
              ? {
                  ok: true,
                  json: async () => ({ value: 'github.oidc.token' }),
                }
              : {
                  ok: true,
                  json: async () => ({ token: 'discarded-preflight-token' }),
                },
        },
        verifyPackageArtifact,
        verifyRegistryDistTag: async (packageName, tag, version) => {
          assert.equal(tag, 'latest');
          assert.equal(version, '3.2.0-ultramodern.1');
          events.push({ kind: 'dist-tag', targetName: packageName });
        },
        verifyRegistryPackage: async (artifact, expectation) => {
          assert.deepEqual(expectation.source, releaseSource);
          assert.equal(
            expectation.workflow.path,
            '.github/workflows/publish-bleedingdev.yml',
          );
          events.push({ kind: 'provenance', targetName: artifact.targetName });
        },
      },
    );

    const artifactsByTarget = new Map(
      fixture.releaseArtifacts.packages.map(item => [item.targetName, item]),
    );
    // Registry verification happens exactly once per package, inside the cohort
    // pass; the publish loop only re-checks the local artifact bytes.
    assert.deepEqual(
      events,
      fixture.releaseArtifacts.manifest.publishOrder
        .map(targetName => ({
          artifactPath: artifactsByTarget.get(targetName).artifactPath,
          kind: 'publish',
          targetName,
        }))
        .concat({ kind: 'cohort' })
        .concat(
          fixture.releaseArtifacts.manifest.packages.flatMap(item => [
            { kind: 'provenance', targetName: item.targetName },
            { kind: 'dist-tag', targetName: item.targetName },
          ]),
        ),
    );
    assert.deepEqual(
      events
        .filter(event => event.kind === 'provenance')
        .map(event => event.targetName)
        .sort(),
      [...fixture.releaseArtifacts.manifest.publishOrder].sort(),
    );
  } finally {
    removeDir(fixture.root);
  }
});

test('release verifier rejects schema, cohort, path, detached digest, and tarball tampering', async () => {
  const {
    computeCohortDigest,
    validateReleaseManifest,
    verifyReleaseArtifacts,
  } = await import('../prepare-bleedingdev-packages.mjs');
  const { validateReleaseCohortProjection } = await import(
    '../lib/prepare-bleedingdev-packages/release-artifacts.mjs'
  );
  const fixture = await createArtifactFixture();
  const expected = artifactExpectations(fixture.aliases);
  const manifest = fixture.releaseArtifacts.manifest;
  const projection = fixture.releaseArtifacts.cohortProjection.value;

  try {
    assert.doesNotThrow(() => verifyReleaseArtifacts(fixture.outDir, expected));
    assert.doesNotThrow(() =>
      validateReleaseCohortProjection(projection, manifest),
    );

    const projectionOmission = structuredClone(projection);
    projectionOmission.packages.pop();
    assert.throws(
      () => validateReleaseCohortProjection(projectionOmission, manifest),
      /Release cohort projection does not match the accepted release identity/u,
    );
    const projectionAddition = structuredClone(projection);
    projectionAddition.packages.push(structuredClone(projection.packages[0]));
    assert.throws(
      () => validateReleaseCohortProjection(projectionAddition, manifest),
      /Release cohort projection does not match the accepted release identity/u,
    );
    const projectionVersionDrift = structuredClone(projection);
    projectionVersionDrift.packages[0].version = '3.2.0-ultramodern.2';
    assert.throws(
      () => validateReleaseCohortProjection(projectionVersionDrift, manifest),
      /Release cohort projection does not match the accepted release identity/u,
    );
    const projectionAliasDrift = structuredClone(projection);
    projectionAliasDrift.aliases['@modern-js/ultramodern-create'] =
      '@bleedingdev/modern-js-attacker';
    assert.throws(
      () => validateReleaseCohortProjection(projectionAliasDrift, manifest),
      /Release cohort projection does not match the accepted release identity/u,
    );
    const projectionSourceDrift = structuredClone(projection);
    projectionSourceDrift.source.commit = 'b'.repeat(40);
    assert.throws(
      () => validateReleaseCohortProjection(projectionSourceDrift, manifest),
      /Release cohort projection does not match the accepted release identity/u,
    );
    const unknownProjectionSchema = structuredClone(projection);
    unknownProjectionSchema.schemaVersion = 2;
    assert.throws(
      () => validateReleaseCohortProjection(unknownProjectionSchema, manifest),
      /Unknown release cohort projection schema/u,
    );

    const mixedSchema = structuredClone(manifest);
    mixedSchema.generatedAt = '2026-07-10T00:00:00.000Z';
    assert.throws(
      () => validateReleaseManifest(mixedSchema, expected),
      /unknown or missing fields/,
    );

    const duplicate = structuredClone(manifest);
    duplicate.packages.push(structuredClone(duplicate.packages[0]));
    assert.throws(
      () => validateReleaseManifest(duplicate, expected),
      /duplicates/,
    );

    const omitted = structuredClone(manifest);
    omitted.packages = omitted.packages.slice(0, 1);
    assert.throws(
      () => validateReleaseManifest(omitted, expected),
      /accepted release identity/,
    );

    const escaped = structuredClone(manifest);
    escaped.packages[0].tarballPath = '../outside.tgz';
    assert.throws(
      () => validateReleaseManifest(escaped, expected),
      /tarballPath/,
    );

    const wrongVersion = structuredClone(manifest);
    wrongVersion.packages[0].version = '3.2.0-ultramodern.2';
    assert.throws(
      () => validateReleaseManifest(wrongVersion, expected),
      /does not match release/,
    );
    const changedTools = structuredClone(manifest);
    changedTools.tools.npm = 'different-npm-version';
    assert.notEqual(computeCohortDigest(changedTools), manifest.cohortDigest);
    assert.throws(
      () => validateReleaseManifest(changedTools, expected),
      /Release cohort digest mismatch/,
    );
    const attachedSidecars = structuredClone(manifest);
    attachedSidecars.sidecars = {
      manifestPath: 'sidecars.json',
      sha256: 'a'.repeat(64),
    };
    assert.notEqual(
      computeCohortDigest(attachedSidecars),
      manifest.cohortDigest,
    );
    assert.throws(
      () => validateReleaseManifest(attachedSidecars, expected),
      /Release cohort digest mismatch/,
    );
    assert.throws(
      () =>
        validateReleaseManifest(manifest, {
          ...expected,
          source: { ...releaseSource, commit: 'b'.repeat(40) },
        }),
      /Release source does not match/,
    );

    const extraTarball = path.join(fixture.outDir, 'tarballs', 'extra.tgz');
    writeFile(extraTarball);
    assert.throws(
      () => verifyReleaseArtifacts(fixture.outDir, expected),
      /Release tarball set mismatch/,
    );
    fs.rmSync(extraTarball);

    const artifact = fixture.releaseArtifacts.packages[0];
    const acceptedBytes = fs.readFileSync(artifact.artifactPath);
    fs.rmSync(artifact.artifactPath);
    assert.throws(
      () => verifyReleaseArtifacts(fixture.outDir, expected),
      /Release tarball set mismatch/,
    );
    fs.writeFileSync(artifact.artifactPath, acceptedBytes);

    const manifestPath = path.join(fixture.outDir, 'manifest.json');
    const manifestBytes = fs.readFileSync(manifestPath);
    fs.appendFileSync(manifestPath, ' ');
    assert.throws(
      () => verifyReleaseArtifacts(fixture.outDir, expected),
      /Detached release manifest SHA-256 mismatch/,
    );
    fs.writeFileSync(manifestPath, manifestBytes);

    const cohortDigestPath = path.join(fixture.outDir, 'cohort.sha256');
    const cohortDigestBytes = fs.readFileSync(cohortDigestPath);
    fs.rmSync(cohortDigestPath);
    assert.throws(
      () => verifyReleaseArtifacts(fixture.outDir, expected),
      /Detached release cohort digest is missing/,
    );
    fs.writeFileSync(cohortDigestPath, cohortDigestBytes);

    fs.appendFileSync(artifact.artifactPath, 'tampered');
    assert.throws(
      () => verifyReleaseArtifacts(fixture.outDir, expected),
      /tarball size mismatch/,
    );
  } finally {
    removeDir(fixture.root);
  }
});

test('existing-version reuse rejects metadata, body, provenance, and registry uncertainty before publish', async () => {
  const {
    assertRegistryDistMatches,
    createRegistryProvenanceExpectation,
    publishManifestPackages,
    publishPackage,
  } = await import('../prepare-bleedingdev-packages.mjs');
  const fixture = await createArtifactFixture();
  const artifact = fixture.releaseArtifacts.packages[0];
  const expectation = createRegistryProvenanceExpectation(
    fixture.releaseArtifacts.manifest,
    {
      GITHUB_REF: trustedWorkflow.ref,
      GITHUB_REPOSITORY: 'BleedingDev/ultramodern.js',
    },
  );
  const publishError = new Error('npm publish failed with E403');
  publishError.stderr = 'npm error code E403';
  let attemptedPublishes = 0;
  const publishOptions = {
    dryRun: false,
    publishConcurrency: 1,
    tag: 'latest',
    version: '3.2.0-ultramodern.1',
  };
  const baseOverrides = {
    lookupRegistryDistTag: async () => publishOptions.version,
    lookupRegistryPackageDist: async packageName => {
      const existingArtifact = fixture.releaseArtifacts.packages.find(
        item => item.targetName === packageName,
      );
      return registryDistFor(existingArtifact);
    },
    publishPackage: async () => {
      attemptedPublishes += 1;
    },
  };

  try {
    await assert.rejects(
      () =>
        publishManifestPackages(fixture.releaseArtifacts, publishOptions, {
          ...baseOverrides,
          lookupRegistryPackageDist: async packageName => {
            const existingArtifact = fixture.releaseArtifacts.packages.find(
              item => item.targetName === packageName,
            );
            return {
              ...registryDistFor(existingArtifact),
              shasum: '0'.repeat(40),
            };
          },
          verifyRegistryPackageDist: async (item, dist) =>
            assertRegistryDistMatches(item, dist),
        }),
      /Registry artifact identity mismatch/,
    );
    assert.equal(attemptedPublishes, 0);

    await assert.rejects(
      () =>
        publishManifestPackages(fixture.releaseArtifacts, publishOptions, {
          ...baseOverrides,
          verifyRegistryPackageDist: async () => {
            throw new Error('registry tarball byte mismatch');
          },
        }),
      /registry tarball byte mismatch/,
    );
    assert.equal(attemptedPublishes, 0);

    await assert.rejects(
      () =>
        publishManifestPackages(fixture.releaseArtifacts, publishOptions, {
          ...baseOverrides,
          verifyRegistryPackageDist: async () => {
            throw new Error('registry provenance mismatch');
          },
        }),
      /registry provenance mismatch/,
    );
    assert.equal(attemptedPublishes, 0);

    await assert.rejects(
      () =>
        publishManifestPackages(fixture.releaseArtifacts, publishOptions, {
          ...baseOverrides,
          lookupRegistryPackageDist: async () => {
            throw new Error('registry state is uncertain');
          },
        }),
      /registry state is uncertain/,
    );
    assert.equal(attemptedPublishes, 0);

    await assert.rejects(
      () =>
        publishPackage(
          artifact,
          {
            dryRun: false,
            provenanceExpectation: expectation,
            tag: 'latest',
          },
          {
            publishAcceptedPackage: async () => {
              throw publishError;
            },
            wait: async () => {},
            registry: {
              assertRegistryDistMatches: () => {},
              lookupRegistryPackageDist: async () => {
                throw new Error('registry state is uncertain');
              },
              verifyRegistryPackageDist: async () => {},
            },
          },
        ),
      /registry state is uncertain/,
    );
  } finally {
    removeDir(fixture.root);
  }
});
