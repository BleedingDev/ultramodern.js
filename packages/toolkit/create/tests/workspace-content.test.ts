import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { createAppEnvDts } from '../src/ultramodern-workspace/app-files';
import {
  createShellHost,
  createVerticalDescriptor,
} from '../src/ultramodern-workspace/descriptors';
import { generatedToolingCommands } from '../src/ultramodern-workspace/tooling-command-catalog';
import { createWorkspaceValidationContract } from '../src/ultramodern-workspace/workspace-validation-contract';

const fixturesDir = path.join(__dirname, 'fixtures');

/**
 * Full-content snapshots of the highest-risk rendered files. The manifest
 * snapshot (workspace-manifest.test.ts) only pins file *names*, so these
 * fixtures pin the rendered *bytes* of one representative file per risk
 * class:
 *
 * - shell-frame.tsx: verbatim template copy (templates/app/shell-frame.tsx)
 *   that must survive template moves unchanged.
 * - ultramodern-route-head.tsx: rendered through the {{placeholder}}
 *   renderer while containing literal `{{ ... }}` JSX text — the
 *   placeholder-collision risk class. The fixture proves intended
 *   placeholders are substituted and literal brace text is left intact.
 * - generated script wrappers: pinned with targeted assertions after a
 *   vertical joins. The placeholder-dense validator now lives in the
 *   versioned @modern-js/create tool surface instead of copied app source.
 * - verticals/catalog/shared/api.ts: fully code-generated API
 *   contract file (no template on disk), the pure-codegen risk class.
 * - verticals/catalog/src/api/catalog-client.ts: the generated Effect
 *   client. It once advertised locale/operationContext/traceparent options
 *   and silently dropped them; the snapshot pins the requestContext wiring
 *   into makeEffectHttpApiClient.
 * - verticals/catalog/src/routes/[lang]/page.tsx: the vertical page emitted
 *   by createRemotePage — inline-literal TSX codegen where an undeclared
 *   identifier (`supportedLanguages`) once shipped and broke typecheck of
 *   every --vertical workspace.
 *
 * Inputs are pinned (modernVersion, packageSource specifier, scope), so the
 * output is deterministic. If a content change is deliberate, regenerate the
 * fixture from a fresh scaffold with these exact inputs.
 */
const defaultScaffoldSnapshots = [
  'apps/shell-super-app/src/routes/shell-frame.tsx',
  'apps/shell-super-app/src/routes/ultramodern-route-head.tsx',
];

const catalogVerticalSnapshots = [
  'verticals/catalog/api/backend-federation.ts',
  'verticals/catalog/shared/api.ts',
  'verticals/catalog/src/api/catalog-client.ts',
  'verticals/catalog/src/routes/[lang]/page.tsx',
];

const readTextSnapshot = (filePath: string) =>
  fs.readFileSync(filePath, 'utf-8').replaceAll('\r\n', '\n');

const readJson = (filePath: string) =>
  JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;

function assertProjectReferenceEmitConfig(
  workspaceDir: string,
  packagePath: string,
) {
  const tsconfig = readJson(
    path.join(workspaceDir, packagePath, 'tsconfig.json'),
  );
  const compilerOptions = tsconfig.compilerOptions as Record<string, unknown>;
  const relativeRoot = path
    .relative(packagePath, '.')
    .split(path.sep)
    .join('/');
  const cacheKey = packagePath.replace(/[^a-zA-Z0-9._-]+/gu, '__');

  assert.equal(compilerOptions.composite, true);
  assert.equal(compilerOptions.declaration, true);
  assert.equal(compilerOptions.declarationMap, false);
  assert.equal(compilerOptions.emitDeclarationOnly, true);
  assert.equal(compilerOptions.noEmit, false);
  assert.equal(
    compilerOptions.outDir,
    `${relativeRoot}/node_modules/.cache/tsgo/declarations/${cacheKey}`,
  );
  assert.equal(
    compilerOptions.tsBuildInfoFile,
    `${relativeRoot}/node_modules/.cache/tsgo/${cacheKey}.tsbuildinfo`,
  );
}

function assertContentSnapshot(
  workspaceDir: string,
  fixtureGroup: string,
  relativePath: string,
) {
  const actual = readTextSnapshot(path.join(workspaceDir, relativePath));
  const expected = readTextSnapshot(
    path.join(fixturesDir, fixtureGroup, `${relativePath}.snap`),
  );
  assert.equal(
    actual,
    expected,
    `Rendered content of ${relativePath} diverged from tests/fixtures/${fixtureGroup}/${relativePath}.snap — update the fixture only for intentional output changes.`,
  );
}

function assertModuleFederationWarningHygiene(modernConfig: string) {
  assert.match(
    modernConfig,
    /const moduleFederationDevServerOrigin =\s*envValue\('ULTRAMODERN_MF_DEV_ORIGIN'\) \|\| 'http:\/\/localhost:3020';/,
    'generated Modern config must default MF dev CORS to the local shell origin, with an explicit trusted-origin override',
  );
  assert.match(
    modernConfig,
    /splitChunks:\s*\{\s*chunks:\s*'async',\s*\},/,
    'generated Modern config must set stream-SSR-compatible splitChunks defaults before MF mutates the bundler chain',
  );
  assert.match(
    modernConfig,
    /const buildTarget = cloudflareDeployEnabled \? 'cloudflare' : 'web';/,
    'generated Modern config must derive mutable build paths from the active target',
  );
  assert.match(
    modernConfig,
    /const buildOutputRoot = cloudflareDeployEnabled \? 'dist-cloudflare' : 'dist';/,
    'generated Modern config must isolate normal and Cloudflare output roots',
  );
  assert.match(
    modernConfig,
    /const buildTempDirectory = `node_modules\/\.modern-js-\$\{appId\}-\$\{buildTarget\}`;/,
    'generated Modern config must isolate normal and Cloudflare Modern temp directories',
  );
  assert.match(
    modernConfig,
    /const buildCacheDirectory = `node_modules\/\.cache\/rspack-\$\{appId\}-\$\{buildTarget\}`;/,
    'generated Modern config must provide a per-app/per-target Rspack cache base directory',
  );
  assert.match(
    modernConfig,
    /root: buildOutputRoot,/,
    'generated Modern config must pass the per-target output root to the builder',
  );
  assert.match(
    modernConfig,
    /tempDir: buildTempDirectory,/,
    'generated Modern config must pass the per-target Modern temp directory to the builder',
  );
  assert.match(
    modernConfig,
    /cacheDigest: \[appId, buildTarget\],/,
    'generated Modern config must include the build target in the Rspack cache digest',
  );
  assert.match(
    modernConfig,
    /cacheDirectory: buildCacheDirectory,/,
    'generated Modern config must pass the per-target Rspack cache base directory to the builder',
  );
  assert.match(
    modernConfig,
    /devServer:\s*\{\s*headers:\s*\{\s*'Access-Control-Allow-Headers':\s*'Accept, Authorization, Content-Type, X-Requested-With',\s*'Access-Control-Allow-Methods':\s*'GET, HEAD, OPTIONS',\s*'Access-Control-Allow-Origin':\s*moduleFederationDevServerOrigin,\s*\},\s*\},/,
    'generated Modern config must provide explicit devServer headers so MF does not inject wildcard CORS defaults',
  );
  assert.doesNotMatch(
    modernConfig,
    /'Access-Control-Allow-(?:Headers|Origin)':\s*'\*'/,
    'generated Modern config must not emit wildcard MF dev CORS headers',
  );
  assert.doesNotMatch(
    modernConfig,
    /devServer:\s*\{\s*headers:\s*\{\s*\}\s*\}/,
    'generated Modern config must not leave devServer.headers empty',
  );
  assert.doesNotMatch(
    modernConfig,
    /splitChunks:\s*false/,
    'generated Modern config must not disable splitChunks to hide stream SSR warnings',
  );
}

function assertShellDevAssetPrefix(modernConfig: string) {
  assert.match(
    modernConfig,
    /dev:\s*\{\s*\/\/ Keep shell dev assets origin-relative[\s\S]*?assetPrefix:\s*'\/',\s*\}/,
    'generated shell Modern config must keep shell dev assets origin-relative',
  );
}

function assertRemoteDevAssetPrefix(modernConfig: string) {
  assert.match(
    modernConfig,
    /dev:\s*\{\s*\/\/ Remote dev manifests must publish an absolute publicPath[\s\S]*?assetPrefix,\s*\}/,
    'generated remote Modern config must publish dev assets from its own remote origin',
  );
  assert.doesNotMatch(
    modernConfig,
    /dev:\s*\{[\s\S]*?assetPrefix:\s*'\/',\s*\}/,
    'generated remote Modern config must not publish origin-relative dev assets',
  );
}

test('rendered contents of the highest-risk generated files match the checked-in snapshots', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-workspace-content-'),
  );
  const workspaceDir = path.join(tempRoot, 'manifest-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'manifest-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    for (const relativePath of defaultScaffoldSnapshots) {
      assertContentSnapshot(workspaceDir, 'default-scaffold', relativePath);
    }

    const shellRouteHead = fs.readFileSync(
      path.join(
        workspaceDir,
        'apps/shell-super-app/src/routes/ultramodern-route-head.tsx',
      ),
      'utf-8',
    );
    const shellModernConfig = fs.readFileSync(
      path.join(workspaceDir, 'apps/shell-super-app/modern.config.ts'),
      'utf-8',
    );
    const shellModuleFederationConfig = fs.readFileSync(
      path.join(
        workspaceDir,
        'apps/shell-super-app/module-federation.config.ts',
      ),
      'utf-8',
    );
    const shellModernAppEnv = fs.readFileSync(
      path.join(workspaceDir, 'apps/shell-super-app/src/modern-app-env.d.ts'),
      'utf-8',
    );
    const gitignore = fs.readFileSync(
      path.join(workspaceDir, '.gitignore'),
      'utf-8',
    );
    assert.match(
      gitignore,
      /^\.mf\/$/mu,
      'generated workspaces must ignore root Module Federation diagnostics',
    );
    assert.match(
      gitignore,
      /^\*\*\/\.mf\/$/mu,
      'generated workspaces must ignore per-app Module Federation diagnostics',
    );
    assert.match(
      gitignore,
      /^dist-cloudflare\/$/mu,
      'generated workspaces must ignore Cloudflare build output',
    );
    assert.match(
      gitignore,
      /^\.zerops\/runtime\/$/mu,
      'generated workspaces must ignore Zerops materialized runtime artifacts',
    );
    assert.match(
      shellModernAppEnv,
      /\/\/\/ <reference types="@modern-js\/app-tools\/types" \/>/,
      'generated app env must reference the framework-owned app ambient type bundle without turning remote declarations into augmentations',
    );
    assert.match(
      shellModernAppEnv,
      /declare const ULTRAMODERN_SITE_URL: string;/,
      'generated app env must keep generated globals explicit in ambient scope',
    );
    assert.doesNotMatch(
      shellModernAppEnv,
      /declare module '\*\.(?:svg|css)'/,
      'generated app env must not redeclare framework-owned asset modules',
    );
    assert.match(
      shellModernConfig,
      /'@modern-js\/plugin-i18n\/runtime':\s*'@modern-js\/plugin-i18n\/runtime\/no-react-i18next'/,
      'generated UltraModern apps with reactI18next=false must alias public runtime imports to the no-adapter entry',
    );
    assert.match(
      shellModuleFederationConfig,
      /'@modern-js\/plugin-i18n\/runtime\/no-react-i18next': \{\s*requiredVersion: pluginI18nVersion,\s*singleton: true,\s*treeShaking: false,\s*\}/,
      'generated Module Federation shared config must publish the no-react i18n runtime as the canonical singleton',
    );
    assert.doesNotMatch(
      shellModuleFederationConfig,
      /'@modern-js\/plugin-i18n\/runtime': \{/,
      'generated Module Federation shared config must not publish the aliased public i18n runtime key',
    );
    assert.doesNotMatch(
      shellModernConfig,
      /ignoreWarnings|modern-js-plugin-i18n/,
      'generated Modern config must not suppress i18n bundler warnings',
    );
    assertModuleFederationWarningHygiene(shellModernConfig);
    assertShellDevAssetPrefix(shellModernConfig);
    assert.match(
      shellModuleFederationConfig,
      /tsConfigPath: '\.\/tsconfig\.mf-types\.json'/,
      'generated Module Federation config must use the dedicated DTS tsconfig',
    );
    assert.match(
      shellModuleFederationConfig,
      /consumeTypes: true,\s*generateTypes: false,/,
      'generated host-only shell Module Federation config must consume remote types instead of generating its own',
    );
    assert.match(
      shellModernConfig,
      /getBuildConfigEnvironment\(\s*'ZE_CI_TOKEN'\s*\)/,
      'generated Modern config must engage Zephyr only for a CI deploy (ZE_CI_TOKEN)',
    );
    assert.match(
      shellModernConfig,
      /withBuildConfigEnvironment\(\s*'ZE_FAIL_BUILD',\s*'true',\s*withZephyrRspack\(\),?\s*\)/,
      'generated Modern config must lease the native Zephyr fail-closed setting through the public config API when it does deploy',
    );
    assert.match(
      shellModernConfig,
      /\bwithBuildConfigEnvironment\b/,
      'generated Modern config must use the public scoped environment API',
    );
    assert.doesNotMatch(
      shellModernConfig,
      /ULTRAMODERN_ZEPHYR_TIMEOUT_MS|zephyrWarn|Promise\.race|modifyRspackConfig\(\s*(?:async\s+)?(?:config|\(config\))\s*=>/,
      'generated Modern config must not intercept Zephyr failures',
    );
    assert.doesNotMatch(
      shellModernConfig,
      /ULTRAMODERN_ZEPHYR/,
      'generated Modern config must not provide an opt-out from Zephyr native fail-closed configuration',
    );
    assert.deepEqual(
      readJson(
        path.join(workspaceDir, 'apps/shell-super-app/tsconfig.mf-types.json'),
      ),
      {
        extends: '../../tsconfig.base.json',
        include: ['src/modern-app-env.d.ts'],
      },
      'generated shell MF DTS tsconfig must not include app router ambient registrations',
    );
    assert.deepEqual(
      readJson(path.join(workspaceDir, 'apps/shell-super-app/tsconfig.json'))
        .include,
      ['src', 'locales/**/*.json', 'package.json', 'shared'],
      'generated shell app typecheck must not include Modern or Module Federation tool config declarations',
    );
    assert.match(
      shellRouteHead,
      /const jsonLd = route\?\.jsonLd;/,
      'generated route head must read JSON-LD only from explicit route metadata',
    );
    assert.match(
      shellRouteHead,
      /jsonLd === undefined \? null :/,
      'generated route head must render JSON-LD only after an explicit non-negated undefined check',
    );
    assert.doesNotMatch(
      shellRouteHead,
      /route \? t\(|jsonLd &&|jsonLd !== undefined|route\?\.public === true|route\?\.indexable === true/,
      'generated route head must avoid optional-object truthiness, negated JSON-LD checks, and literal route metadata comparisons',
    );
    assert.doesNotMatch(
      shellRouteHead,
      /'@type': 'WebPage'/,
      'generated route head must not infer WebPage JSON-LD automatically',
    );
    const shellRouteMetadata = fs.readFileSync(
      path.join(
        workspaceDir,
        'apps/shell-super-app/src/routes/ultramodern-route-metadata.ts',
      ),
      'utf-8',
    );
    assert.doesNotMatch(
      shellRouteMetadata,
      /jsonLd/u,
      'default private route metadata must not emit JSON-LD',
    );
    for (const packagePath of [
      'apps/shell-super-app',
      'packages/shared-contracts',
      'packages/shared-design-tokens',
    ] as const) {
      assertProjectReferenceEmitConfig(workspaceDir, packagePath);
    }
    const shellJsonLdHelpers = fs.readFileSync(
      path.join(
        workspaceDir,
        'apps/shell-super-app/src/routes/ultramodern-jsonld.ts',
      ),
      'utf-8',
    );
    for (const helperName of [
      'defineRouteJsonLd',
      'webPageJsonLd',
      'webApplicationJsonLd',
      'softwareApplicationJsonLd',
      'breadcrumbListJsonLd',
      'faqPageJsonLd',
      'organizationJsonLd',
    ] as const) {
      assert.match(
        shellJsonLdHelpers,
        new RegExp(`export const ${helperName}\\b`),
        `generated JSON-LD helper module must export ${helperName}`,
      );
    }

    // Provenance contract: fresh workspaces keep compact config in source and
    // leave large framework contract interpretation to @modern-js/create.
    const compactConfig = readJson(
      path.join(workspaceDir, '.modernjs/ultramodern.json'),
    );
    assert.equal(
      (compactConfig.generator as Record<string, unknown>).package,
      '@modern-js/create',
    );
    assert.equal(
      (compactConfig.generator as Record<string, unknown>).version,
      '3.2.1',
    );
    assert.equal(
      (compactConfig.packageSource as Record<string, unknown>)
        .modernPackageVersion,
      'workspace:*',
    );
    assert.equal(
      (compactConfig.packageSource as Record<string, unknown>).metadata,
      undefined,
    );
    assert.equal(
      (compactConfig.topology as Record<string, unknown>).source,
      './topology/reference-topology.json',
    );
    assert.doesNotMatch(
      JSON.stringify(compactConfig),
      /ultramodern-(?:generated-contract|package-source|workspace-template-manifest)\.json/,
    );
    assert.equal(
      (
        (compactConfig.tooling as Record<string, unknown>).wrappers as Record<
          string,
          unknown
        >
      ).cloudflareOutputVerify,
      'scripts/verify-cloudflare-output.mts',
    );
    assert.equal(
      (
        (compactConfig.tooling as Record<string, unknown>).wrappers as Record<
          string,
          unknown
        >
      ).routesGenerate,
      'scripts/generate-tanstack-routes.mts',
    );
    const rootPackage = readJson(path.join(workspaceDir, 'package.json'));
    assert.equal(
      (
        (rootPackage.modernjs as Record<string, unknown>)
          .packageSource as Record<string, unknown>
      ).config,
      './.modernjs/ultramodern.json',
    );

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    for (const relativePath of catalogVerticalSnapshots) {
      assertContentSnapshot(workspaceDir, 'catalog-vertical', relativePath);
    }
    const catalogModuleFederationConfig = fs.readFileSync(
      path.join(workspaceDir, 'verticals/catalog/module-federation.config.ts'),
      'utf-8',
    );
    assert.match(
      catalogModuleFederationConfig,
      /generateTypes: {/,
      'exposing vertical Module Federation config must still generate DTS',
    );
    assert.match(
      catalogModuleFederationConfig,
      /compilerInstance: tsgoCompilerInstance/,
      'exposing vertical Module Federation DTS generation must resolve the effect-tsgo compiler instance',
    );
    const validationWrapper = fs.readFileSync(
      path.join(workspaceDir, 'scripts/validate-ultramodern-workspace.mts'),
      'utf-8',
    );
    assert.match(validationWrapper, /modern-js-create/);
    assert.match(validationWrapper, /ULTRAMODERN_CREATE_BIN/);
    assert.match(validationWrapper, /'ultramodern'/);
    assert.match(
      validationWrapper,
      /workspaceValidationContract/,
      'workspace validation must embed the generated structured validation contract',
    );
    const cloudflareOutputWrapper = fs.readFileSync(
      path.join(workspaceDir, 'scripts/verify-cloudflare-output.mts'),
      'utf-8',
    );
    assert.match(cloudflareOutputWrapper, /modern-js-create/);
    assert.match(cloudflareOutputWrapper, /ULTRAMODERN_CREATE_BIN/);
    assert.match(cloudflareOutputWrapper, /'cloudflare-output-verify'/);
    for (const command of generatedToolingCommands.filter(
      command => command.id !== 'validate',
    )) {
      const wrapper = fs.readFileSync(
        path.join(workspaceDir, command.wrapperPath),
        'utf-8',
      );
      assert.match(wrapper, /modern-js-create/);
      assert.match(wrapper, new RegExp(`'${command.command}'`));
    }
    assert.deepEqual(
      readJson(
        path.join(workspaceDir, 'verticals/catalog/tsconfig.mf-types.json'),
      ),
      {
        extends: '../../tsconfig.base.json',
        include: [
          'src/federation-entry.tsx',
          'src/components/catalog-widget.tsx',
          'src/modern-app-env.d.ts',
        ],
      },
      'generated vertical MF DTS tsconfig must only include exposed public surfaces',
    );
    assert.deepEqual(
      readJson(path.join(workspaceDir, 'verticals/catalog/tsconfig.json'))
        .include,
      ['src', 'locales/**/*.json', 'package.json', 'shared', 'api'],
      'generated vertical app typecheck must not include Modern or Module Federation tool config declarations',
    );
    const verticalModernConfig = fs.readFileSync(
      path.join(workspaceDir, 'verticals/catalog/modern.config.ts'),
      'utf-8',
    );
    assertModuleFederationWarningHygiene(verticalModernConfig);
    assertRemoteDevAssetPrefix(verticalModernConfig);
    const verticalModernAppEnv = fs.readFileSync(
      path.join(workspaceDir, 'verticals/catalog/src/modern-app-env.d.ts'),
      'utf-8',
    );
    assert.match(
      verticalModernAppEnv,
      /\/\/\/ <reference types="@modern-js\/app-tools\/types" \/>/,
      'generated vertical env must reference the framework-owned app ambient type bundle',
    );
    assert.match(
      verticalModernAppEnv,
      /declare const ULTRAMODERN_SITE_URL: string;/,
      'generated vertical env must keep generated globals explicit in ambient scope',
    );
    assert.doesNotMatch(
      verticalModernAppEnv,
      /declare module '\*\.(?:svg|css)'/,
      'generated vertical env must not redeclare framework-owned asset modules',
    );

    // Regression: the vertical page once read the bare identifier
    // `supportedLanguages` without declaring it, so every --vertical
    // workspace failed `tsgo --noEmit` with TS2304 (ReferenceError at
    // render). Unlike the byte snapshot above, this assertion survives a
    // blind fixture regeneration: the identifier the page maps over must be
    // destructured from useModernI18n(), the same i18n runtime source the
    // page already uses for `t` and `language`.
    const verticalPage = fs.readFileSync(
      path.join(workspaceDir, 'verticals/catalog/src/routes/[lang]/page.tsx'),
      'utf-8',
    );
    assert.match(
      verticalPage,
      /\{supportedLanguages\.map\(/,
      'expected the vertical page to render the language switcher from supportedLanguages',
    );
    assert.match(
      verticalPage,
      /const \{[^}]*\bsupportedLanguages\b[^}]*\} = useModernI18n\(\);/,
      'supportedLanguages must be destructured from useModernI18n() — otherwise the generated page references an undeclared identifier',
    );
    const verticalComponents = fs.readFileSync(
      path.join(
        workspaceDir,
        'apps/shell-super-app/src/routes/vertical-components.tsx',
      ),
      'utf-8',
    );
    assert.match(
      verticalComponents,
      /import\s*\{\s*createLazyComponent\s*\}\s*from '@module-federation\/modern-js-v3\/react';/,
      'generated shell remotes must use the framework-owned Module Federation React primitive',
    );
    assert.match(
      verticalComponents,
      /import\s*\{\s*createDistributedSsrComponent\s*\}\s*from '@modern-js\/runtime\/module-federation';/,
      'generated shell remotes must use the framework-owned deferred distributed SSR component',
    );
    assert.match(
      verticalComponents,
      /createDistributedSsrComponent\(\{\s*createComponent: \(\) =>\s*createLazyComponent\(\{\s*export: 'default',\s*fallback: <RemoteUnavailable \/>,\s*instance: getInstance\(\),\s*loader,\s*loading: null,\s*\}\),\s*expose,\s*fallback: <RemoteUnavailable \/>,\s*remote,\s*\}\)/,
      'generated shell remotes must defer native Node/browser MF construction and delegate workerd SSR to distributed fragments',
    );
    assert.doesNotMatch(
      verticalComponents,
      /noSSR:\s*true/,
      'generated shell remotes must not disable server rendering',
    );
    assert.match(
      verticalComponents,
      /const CatalogWidget = createRemoteComponent\(\s*'catalog',\s*'\.\/Widget',\s*\(\) => import\('catalog\/Widget'\),?\s*\);/,
      'generated shell remotes must pass native dynamic imports directly to the Module Federation primitive',
    );
    assert.doesNotMatch(
      verticalComponents,
      /@module-federation\/bridge-react|classifyModuleFederationFallback|createModuleFederationFallbackTelemetry|emitModuleFederationFallbackTelemetry|toModuleFederationFallbackAttributes|createRemoteFallback|createHydratedRemote|loadRemote|telemetryEntry|telemetry\.entry|data-remote-error|typeof window|window\.location/,
      'generated app code must not recreate Module Federation fallback interception, telemetry, or hydration behavior',
    );
    const workerVerticalComponents = fs.readFileSync(
      path.join(
        workspaceDir,
        'apps/shell-super-app/src/routes/vertical-components.worker.tsx',
      ),
      'utf-8',
    );
    assert.match(
      workerVerticalComponents,
      /import\s*\{\s*DistributedSsrBoundary\s*\}\s*from '@modern-js\/runtime\/module-federation';/,
      'generated Worker SSR must use distributed fragment boundaries',
    );
    assert.match(
      workerVerticalComponents,
      /const CatalogWidget = createRemoteComponent\(\s*'catalog',\s*'\.\/Widget',?\s*\);/,
      'generated Worker SSR must declare the same remote boundary identity',
    );
    assert.doesNotMatch(
      workerVerticalComponents,
      /@module-federation|import\('catalog\/Widget'\)|createLazyComponent|getInstance/,
      'generated Worker SSR must not include native Module Federation runtime or remote imports',
    );
    const fragmentPage = fs.readFileSync(
      path.join(
        workspaceDir,
        'verticals/catalog/src/routes/[lang]/_mf/fragment/widget/page.tsx',
      ),
      'utf-8',
    );
    assert.match(
      fragmentPage,
      /import Widget from '\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/components\/catalog-widget';/,
      'generated verticals must expose a same-worker SSR route for their Widget',
    );
    assert.match(
      fragmentPage,
      /useDistributedSsrFragmentProps<ComponentProps<typeof Widget>>/,
      'generated fragment routes must recover typed props from the verified service request',
    );
    assert.match(
      fragmentPage,
      /from '@modern-js\/runtime\/module-federation\/distributed-ssr';/,
      'generated fragment routes must import the direct distributed SSR runtime entry',
    );
    assert.match(fragmentPage, /data-modern-distributed-ssr-marker="start"/);
    assert.match(fragmentPage, /data-modern-distributed-ssr-marker="end"/);
    assert.match(fragmentPage, /<Widget \{\.\.\.props\} \/>/);

    // Regression: the generated API client once accepted
    // locale/operationContext/traceparent options and then passed only
    // { baseUrl } to makeEffectHttpApiClient, so no operation-context header
    // was ever sent. Unlike the byte snapshot, these assertions survive a
    // blind fixture regeneration: the client must forward all three options
    // through the plugin-bff requestContext envelope.
    const generatedClient = fs.readFileSync(
      path.join(workspaceDir, 'verticals/catalog/src/api/catalog-client.ts'),
      'utf-8',
    );
    assert.match(
      generatedClient,
      /requestContext: \{/,
      'generated client must pass requestContext to makeEffectHttpApiClient',
    );
    for (const contextOption of [
      'locale',
      'operationContext',
      'traceparent',
    ] as const) {
      assert.match(
        generatedClient,
        new RegExp(`\\{ ${contextOption}: options\\.${contextOption} \\}`),
        `generated client must forward options.${contextOption} into requestContext`,
      );
    }
    assert.match(
      generatedClient,
      /import type \{[\s\S]*\bHttpClientError\b[\s\S]*\bSchema\b[\s\S]*\} from '@modern-js\/plugin-bff\/effect-client';/,
      'generated client must name public plugin-bff error types instead of leaking inferred Effect internals',
    );
    assert.match(
      generatedClient,
      /export type CatalogClientError =\s*\|\s*CatalogNotFound\s*\|\s*HttpClientError\.HttpClientError\s*\|\s*Schema\.SchemaError;/,
      'generated client must expose a stable client error union for declaration emit',
    );
    assert.match(
      generatedClient,
      /: CatalogClientEffect<CatalogClient> =>/,
      'generated client factory must have an explicit portable return type',
    );
    const generatedSharedApi = fs.readFileSync(
      path.join(workspaceDir, 'verticals/catalog/shared/api.ts'),
      'utf-8',
    );
    assert.doesNotMatch(
      generatedSharedApi,
      /ReadonlyArray</,
      'generated shared APIs must use readonly T[] array syntax so generated oxlint rules pass',
    );
    assert.doesNotMatch(
      generatedSharedApi,
      /Schema\.Schema</,
      'generated shared Effect schemas must preserve codec service channels so strict generated clients do not infer unknown requirements',
    );
    assert.match(
      generatedSharedApi,
      /export interface CatalogNotFound \{/,
      'generated shared API must expose a portable structural not-found error type',
    );
    assert.match(
      generatedSharedApi,
      /Schema\.TaggedStruct\(\s*'CatalogNotFound'/,
      'generated shared API must build not-found schemas without class inheritance',
    );
    assert.doesNotMatch(
      generatedSharedApi,
      /TaggedErrorClass/,
      'generated shared API must not emit Effect TaggedErrorClass placeholders',
    );
    const generatedEffectEntry = fs.readFileSync(
      path.join(workspaceDir, 'verticals/catalog/api/index.ts'),
      'utf-8',
    );
    assert.match(
      generatedEffectEntry,
      /const apiRuntime: EffectBffDefinition<typeof catalogApi, EffectRuntimeLayer> &\s*EffectBffRuntime<typeof catalogApi, EffectRuntimeLayer>/,
      'generated Effect entry must name its default export type for declaration emit',
    );
    assert.match(
      generatedEffectEntry,
      /from '\.\.\/shared\/ultramodern-build\.ts';/,
      'generated Effect entry must read build metadata from the BFF-visible shared boundary',
    );
    assert.doesNotMatch(
      generatedEffectEntry,
      /src\/ultramodern-build/,
      'generated Effect entry must not import app src modules during server compilation',
    );
    assert.doesNotMatch(
      generatedEffectEntry,
      /new CatalogNotFound/,
      'generated Effect entry must fail with structural errors rather than generated error classes',
    );
    assert.doesNotMatch(
      generatedEffectEntry,
      /backendFederationContract/,
      'generated Effect entry must keep backend federation metadata in the facade entry',
    );
    const generatedBackendFederationEntry = fs.readFileSync(
      path.join(workspaceDir, 'verticals/catalog/api/backend-federation.ts'),
      'utf-8',
    );
    assert.match(
      generatedBackendFederationEntry,
      /import \{ ultramodernApiMarker \} from '\.\.\/shared\/ultramodern-build\.ts'/,
      'backend federation facade must bind compatibility to generated build identity',
    );
    assert.match(
      generatedBackendFederationEntry,
      /export const backendFederationContract = \{/,
      'backend federation facade must export strict metadata',
    );
    assert.match(
      generatedBackendFederationEntry,
      /compatibility: \{/,
      'backend federation facade must declare loader compatibility metadata',
    );
    assert.match(
      generatedBackendFederationEntry,
      /build: ultramodernApiMarker\.build/,
      'backend federation facade must bind compatibility build to API marker',
    );
    assert.match(
      generatedBackendFederationEntry,
      /packageName: ultramodernApiMarker\.packageName/,
      'backend federation facade must bind compatibility package to API marker',
    );
    assert.match(
      generatedBackendFederationEntry,
      /name: 'verticalCatalogBackend'/,
      'backend federation facade must use stable generated backend name',
    );
    assert.match(
      generatedBackendFederationEntry,
      /runtimeFramework: 'effect'/,
      'backend federation facade must declare Effect runtime',
    );
    assert.match(
      generatedBackendFederationEntry,
      /strictEffectApproach: true/,
      'backend federation facade must require strict Effect runtime',
    );
    assert.match(
      generatedBackendFederationEntry,
      /export \{ default, default as runtime \} from '\.\/index\.ts';/,
      'backend federation facade must directly re-export the runtime',
    );
    assert.match(
      generatedBackendFederationEntry,
      /export \{[\s\S]*catalogApi as api,[\s\S]*catalogApiContract as contract,[\s\S]*catalogOperationContexts as operationContexts,[\s\S]*\} from '\.\.\/shared\/api\.ts';/,
      'backend federation facade must directly re-export the API contract surface',
    );
    assert.doesNotMatch(
      generatedBackendFederationEntry,
      /src\//,
      'backend federation facade must stay inside API/shared seams',
    );
    assert.doesNotMatch(
      generatedBackendFederationEntry,
      /dispatchEffectBffRequest|handler\.length/,
      'backend federation facade must not smuggle runtime dispatch helpers',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('remote app env declarations remain ambient and preserve workspace expose props', () => {
  const catalog = createVerticalDescriptor('catalog', 3031);
  const source = createAppEnvDts(
    createShellHost([catalog]),
    [catalog],
    'manifest-workspace',
  );

  assert.match(
    source,
    /declare module 'catalog\/Widget' \{\s*export \{ default \} from '@manifest-workspace\/catalog\/Widget';/u,
  );
  assert.doesNotMatch(source, /^import /mu);
});

test('validator template excludes generated Zerops runtime package artifacts', () => {
  const validatorTemplate = fs.readFileSync(
    path.join(
      __dirname,
      '../templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars',
    ),
    'utf-8',
  );

  assert.match(validatorTemplate, /'\.zerops'/);
});

test('workspace validation contract records Node toolchain metadata', () => {
  const contract = createWorkspaceValidationContract('tractor-store', true);

  assert.deepEqual(contract.node, {
    version: contract.versions.node,
    engineRange: '>=26',
  });
});

test('workspace validation contract scans nested federated hosts', () => {
  const explore = createVerticalDescriptor('explore', 3021);
  const checkout = createVerticalDescriptor('checkout', 3022);
  const decide = {
    ...createVerticalDescriptor('decide', 3023),
    verticalRefs: ['explore', 'checkout'],
  };
  const remotes = [explore, checkout, decide];
  const shell = createShellHost(remotes, ['decide']);
  const contract = createWorkspaceValidationContract(
    'tractor-store',
    true,
    remotes,
    undefined,
    [],
    shell,
  );

  assert.deepEqual(
    contract.federatedCompositionSourcePolicy.hosts.map(host => host.id),
    ['shell-super-app', 'decide'],
  );
  assert.deepEqual(
    contract.federatedCompositionSourcePolicy.hosts
      .find(host => host.id === 'decide')
      ?.remotes.map(remote => remote.packageName),
    ['@tractor-store/explore', '@tractor-store/checkout'],
  );
});

test('backend federation proof template resolves monorepo local plugin-bff runtime', () => {
  const proofTemplate = fs.readFileSync(
    path.join(
      __dirname,
      '../templates/workspace-scripts/proof-node-backend-federation.mjs',
    ),
    'utf-8',
  );

  assert.match(proofTemplate, /createRequire\(path\.join\(workspaceRoot/);
  assert.match(
    proofTemplate,
    /workspaceRequire\.resolve\('@modern-js\/plugin-bff\/effect'\)/,
  );
  assert.doesNotMatch(
    proofTemplate,
    /await import\('@modern-js\/plugin-bff\/effect'\)/,
  );
  assert.match(proofTemplate, /localRuntimeRelativePaths/);
  assert.match(
    proofTemplate,
    /'packages\/cli\/plugin-bff\/dist\/esm-node\/runtime\/effect\/index\.mjs'/,
  );
  assert.match(
    proofTemplate,
    /'cli\/plugin-bff\/dist\/esm-node\/runtime\/effect\/index\.mjs'/,
  );
  assert.match(proofTemplate, /function findLocalRuntimePath\(createBin\)/);
  assert.match(
    proofTemplate,
    /unitId: source\.match\(\/\\bunitId:\\s\*\['"\]\(\[\^'"\]\+\)\['"\]\/u\)\?\.\[1\]/,
  );
  assert.match(
    proofTemplate,
    /sourceRevision: source\.match\(\/\\bsourceRevision:\\s\*\['"\]\(\[\^'"\]\+\)\['"\]\/u\)\?\.\[1\]/,
  );
  assert.match(proofTemplate, /manifestDeliveryUnit/);
  assert.match(proofTemplate, /versionBoundaryDeliveryUnit/);
  assert.match(proofTemplate, /assertCompactDeliveryUnitMatchesBuild/);
  assert.match(
    proofTemplate,
    /targetApp\.backendFederation\?\.exposes\?\.\[backendExpose\]\?\.readiness/,
  );
  assert.match(proofTemplate, /id: `\$\{targetApp\.id\}-backend-readiness`/);
  assert.match(proofTemplate, /'checks\.api': 'ready'/);
  assert.match(proofTemplate, /backend runtime has no smoke checks/);
  assert.match(
    proofTemplate,
    /loaded\.contract\?\.servicePrefix \?\? loaded\.contract\?\.apiPrefix/,
  );
  assert.match(
    proofTemplate,
    /backendContract\.compatibility\.unitId,[\s\S]*?manifest\.backendFederation\?\.deliveryUnit\?\.unitId,/,
  );
});

test('backend federation generator accepts migrated app-level metadata', () => {
  const generatorTemplate = fs.readFileSync(
    path.join(
      __dirname,
      '../templates/workspace-scripts/generate-node-backend-federation.mjs',
    ),
    'utf-8',
  );

  assert.match(
    generatorTemplate,
    /return app\.backendFederation \?\? app\.api\?\.backendFederation;/,
  );
  assert.match(generatorTemplate, /Object\.keys\(backend\.exposes\)/);
  assert.match(generatorTemplate, /compactDeliveryUnit/);
  assert.match(generatorTemplate, /kind: 'microvertical-delivery-unit'/);
});
