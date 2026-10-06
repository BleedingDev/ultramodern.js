// Characterization is a requirement inventory. Test references are not passing receipts.
const app = 'packages/solutions/app-tools/src/types/config';
const server = 'packages/server/core/src/types/config';
const composition =
  'packages/solutions/ultramodern-app-tools/src/native-composition/index.ts';
const builderTypes = 'packages/cli/builder/src/types.ts';
const builder = 'packages/cli/builder/src/shared/parseCommonConfig.ts';
const tanstack = 'packages/runtime/plugin-tanstack';
const data = 'packages/cli/plugin-data-loader';
const extensions = 'packages/solutions/app-tools-extensions';
const goldens = 'tests/ultramodern-renderers/characterization';

const configSections = [
  [
    'resolve',
    'ResolveUserConfig',
    `${app}/resolve.ts`,
    "BuilderConfig['resolve']",
    'builder',
  ],
  [
    'server',
    'ServerUserConfig',
    `${server}/server.ts`,
    'ServerUserConfig',
    'server-core',
  ],
  [
    'source',
    'SourceUserConfig',
    `${app}/source.ts`,
    "NonNullable<BuilderConfig['source']>",
    'app-tools/builder',
  ],
  [
    'output',
    'OutputUserConfig',
    `${app}/output.ts`,
    "UnwrapBuilderConfig<BuilderConfig, 'output'>",
    'app-tools/builder',
  ],
  [
    'experiments',
    'ExperimentsUserConfig',
    `${app}/experiments.ts`,
    "Required<BuilderConfig>['experiments']",
    'builder',
  ],
  [
    'bff',
    'BffUserConfig',
    `${server}/bff.ts`,
    'BffUserConfig; requires the BFF plugin',
    'server-core/BFF plugin',
  ],
  [
    'dev',
    'DevUserConfig',
    `${app}/dev.ts`,
    "Omit<NonNullable<BuilderConfig['dev']>, 'setupMiddlewares'>",
    'app-tools/builder',
  ],
  [
    'deploy',
    'DeployUserConfig',
    `${app}/deploy.ts`,
    'DeployUserConfig; fork deployment contract',
    'app-tools-extensions/deploy-output',
  ],
  [
    'html',
    'HtmlUserConfig',
    `${app}/html.ts`,
    "UnwrapBuilderConfig<BuilderConfig, 'html'>",
    'builder',
  ],
  [
    'tools',
    'ToolsUserConfig',
    `${app}/tools.ts`,
    "Omit<UnwrapBuilderConfig<BuilderConfig, 'tools'>, 'swc'>",
    'builder',
  ],
  [
    'security',
    'SecurityUserConfig',
    `${app}/security.ts`,
    "Required<BuilderConfig>['security']",
    'builder/server-core',
  ],
  [
    'testing',
    'TestingUserConfig',
    `${app}/testing.ts`,
    'TestingUserConfig',
    'app-tools/test plugin',
  ],
  [
    'builderPlugins',
    'AppToolsBuilderPlugins',
    `${app}/index.ts`,
    "NonNullable<RsbuildConfig['plugins']>",
    'Rsbuild/plugin composition',
  ],
  [
    'performance',
    'PerformanceUserConfig',
    `${app}/performance.ts`,
    "UnwrapBuilderConfig<BuilderConfig, 'performance'>",
    'builder',
  ],
  [
    'environments',
    null,
    `${app}/index.ts`,
    "RsbuildConfig['environments']",
    'Rsbuild',
  ],
  [
    'splitChunks',
    null,
    `${app}/index.ts`,
    "RsbuildConfig['splitChunks']",
    'Rsbuild',
  ],
  [
    'plugins',
    'CliPlugin',
    `${app}/index.ts`,
    'CliPlugin<AppTools>[]',
    'CLI plugin manager',
  ],
].map(([key, type, source, inheritedSurface, owner]) => ({
  key,
  type,
  source,
  inheritedSurface,
  owner,
  treatment:
    'Retain the declared type and provider surface; renderer-owned claims must be validated before registration.',
  proofGate: 'modernjs-dnpv3.2',
}));

const typeKeys = [
  [
    `${app}/index.ts`,
    'AppToolsUserConfig',
    configSections.map(section => section.key),
  ],
  [
    `${app}/source.ts`,
    'SourceUserConfig',
    [
      'preEntry',
      'entries',
      'mainEntryName',
      'enableAsyncEntry',
      'enableAsyncPreEntry',
      'disableDefaultEntries',
      'entriesDir',
      'configDir',
    ],
  ],
  [
    `${app}/output.ts`,
    'OutputUserConfig',
    [
      'ssg',
      'ssgByEntries',
      'splitRouteChunks',
      'enableInlineRouteManifests',
      'disableInlineRouteManifests',
      'tempDir',
    ],
  ],
  [
    `${app}/deploy.ts`,
    'DeployUserConfig',
    ['target', 'microFrontend', 'worker'],
  ],
  [
    `${app}/deploy.ts`,
    'MicroFrontend',
    ['enableHtmlEntry', 'externalBasicLibrary', 'moduleApp'],
  ],
  [
    `${app}/dev.ts`,
    'DevServerUserConfig',
    ['cors', 'compress', 'headers', 'historyApiFallback', 'proxy', 'watch'],
  ],
  [`${app}/dev.ts`, 'DevUserConfig', ['mockDir', 'setupMiddlewares', 'server']],
  [`${app}/tools.ts`, 'ToolsUserConfig', ['jest', 'swc']],
  [`${app}/testing.ts`, 'TestingUserConfig', ['transformer']],
  [
    `${server}/server.ts`,
    'ServerUserConfig',
    [
      'publicDir',
      'routes',
      'ssrByRouteIds',
      'publicRoutes',
      'ssr',
      'ssrByEntries',
      'rsc',
      'baseUrl',
      'port',
      'watchOptions',
      'compiler',
      'useJsonScript',
      'logger',
      'disableHook',
      'tsconfigPath',
    ],
  ],
  [
    `${server}/server.ts`,
    'SSR',
    [
      'forceCSR',
      'mode',
      'preload',
      'inlineScript',
      'disablePrerender',
      'unsafeHeaders',
      'loaderFailureMode',
      'moduleFederationAppSSR',
    ],
  ],
  [
    `${server}/bff.ts`,
    'BffUserConfig',
    [
      'prefix',
      'httpMethodDecider',
      'enableHandleWeb',
      'crossProject',
      'isCrossProjectServer',
      'requestId',
      'runtimeCreateRequest',
      'requestCreator',
      'clientCodegenPlugin',
      'fetcher',
      'runtimeFramework',
    ],
  ],
].map(([source, symbol, declaredKeys]) => ({ source, symbol, declaredKeys }));

const configAliases = [
  ['ResolveUserConfig', `${app}/resolve.ts`],
  ['ExperimentsUserConfig', `${app}/experiments.ts`],
  ['HtmlUserConfig', `${app}/html.ts`],
  ['PerformanceUserConfig', `${app}/performance.ts`],
  ['SecurityUserConfig', `${app}/security.ts`],
  ['AppToolsBuilderPlugins', `${app}/index.ts`],
  ['CliPlugin', `${app}/index.ts`],
  ['Entry', `${app}/source.ts`],
  ['Entries', `${app}/source.ts`],
  ['Routes', `${server}/server.ts`],
  ['SSRByEntries', `${server}/server.ts`],
  ['SSGConfig', `${app}/output.ts`],
  ['SSGMultiEntryOptions', `${app}/output.ts`],
  ['SSGRouteOptions', `${app}/output.ts`],
  ['SSGSingleEntryOptions', `${app}/output.ts`],
].map(([symbol, source]) => ({ symbol, source }));

const runtimeTest = (path, assertion) => ({
  path,
  kind: 'runtime-test',
  assertion,
});
const configTest = (path, assertion) => ({
  path,
  kind: 'configuration-test',
  assertion,
});
const structuralTest = (path, assertion) => ({
  path,
  kind: 'structural-test',
  assertion,
});
const sourceEvidence = (path, assertion) => ({
  path,
  kind: 'source-only',
  assertion,
});

function required(
  id,
  owner,
  sources,
  evidence,
  assertion,
  gate = 'modernjs-dnpv3.19',
  nativeStatus = 'preview-after-proof',
) {
  const expected = (renderer, status) => ({
    status,
    expectedTest: {
      kind:
        status === 'explicitly-unsupported' ? 'rejection' : 'positive-runtime',
      assertion,
      owner: renderer === 'react' ? owner : `${renderer} application adapter`,
      gate:
        renderer === 'react'
          ? 'modernjs-dnpv3.14'
          : renderer === 'octane' && gate === 'modernjs-dnpv3.26'
            ? 'modernjs-dnpv3.27'
            : gate,
    },
  });
  return {
    id,
    owner,
    sources,
    evidence,
    renderers: {
      react: expected('react', 'required'),
      solid: expected('solid', nativeStatus),
      octane: expected('octane', nativeStatus),
    },
  };
}

const capabilities = [
  required(
    'node-csr',
    'runtime/react/browser',
    ['packages/runtime/plugin-runtime/src/core/browser/index.tsx'],
    [
      runtimeTest(
        'tests/integration/basic-app/tests/index.test.ts',
        'Browser boots the current React application.',
      ),
    ],
    'Dev and packed production native entries mount once, navigate and dispose correctly.',
  ),
  required(
    'node-ssr',
    'server/render and runtime SSR',
    ['packages/server/core/src/plugins/render/ssrRender.ts'],
    [
      runtimeTest(
        'tests/integration/ssr/tests/base.test.ts',
        'SSR document and hydrated React browser assertions.',
      ),
    ],
    'Dev/prod SSR emits matching native markup and hydrates without mismatch or a second root.',
  ),
  required(
    'streaming-shell',
    'server/render streaming transport',
    ['packages/server/core/src/plugins/render/render.ts'],
    [
      runtimeTest(
        'tests/integration/ssr/tests/streaming.test.ts',
        'Streaming response, route CSS and browser behavior.',
      ),
      runtimeTest(
        'tests/integration/ssr/tests/streaming-lazy.test.ts',
        'Lazy streaming boundary and asset behavior.',
      ),
    ],
    'Non-deferred HTTP outcomes precede header commit; lazy stream content matches and hydrates the native shell.',
  ),
  required(
    'native-hmr',
    'renderer compiler and browser runtime',
    [builder],
    [
      runtimeTest(
        'tests/integration/basic-app/tests/index.test.ts',
        'Existing React development browser coverage; state-preserving native refresh needs its own proof.',
      ),
    ],
    'Native HMR updates the actual UltraModern entry, retains appropriate state and disposes old roots/listeners once.',
    'modernjs-dnpv3.26',
  ),
  required(
    'filesystem-routes',
    'plugin-router route IR and native router',
    [
      'packages/runtime/plugin-runtime/src/router/cli/code/nestedRoutes.ts',
      `${tanstack}/src/runtime/routeTree/index.ts`,
    ],
    [
      runtimeTest(
        'tests/integration/routes-tanstack/tests/index.test.ts',
        'Nested, dynamic, optional and splat routes navigate in the browser.',
      ),
    ],
    'Native matching preserves layouts/pathless/dotted/dynamic/optional/splat/data/loading/error/search conventions.',
  ),
  required(
    'router-preload-cancel',
    'plugin-tanstack native matching and preload',
    [`${tanstack}/src/runtime/loaderBridge.ts`],
    [
      runtimeTest(
        `${tanstack}/tests/router/loaderBridge.test.ts`,
        'Real bridge executes loaders with native params and outcomes.',
      ),
    ],
    'Per-request native matching/preload propagates abort and prevents stale navigation results.',
  ),
  required(
    'prefetch',
    'plugin-tanstack Link and preload',
    [`${tanstack}/src/runtime/prefetchLink.tsx`],
    [
      runtimeTest(
        'tests/integration/routes-tanstack/tests/index.test.ts',
        'supports link prefetch alias (intent)',
      ),
      runtimeTest(
        `${tanstack}/tests/router/prefetchLinkPreload.test.tsx`,
        'Native Link preload behavior.',
      ),
    ],
    'Native intent/viewport/render policy preloads the expected route/data without spurious navigation.',
  ),
  required(
    'data-http',
    'plugin-data-loader runtime and client request helpers',
    [`${data}/src/runtime/index.ts`, `${data}/src/cli/createRequest.ts`],
    [
      runtimeTest(
        `${goldens}/react-wire.test.ts`,
        'Actual handleRequest/createRequest HTTP boundary preserves wire status, cookies, redirect/error/catch markers and encoded selectors.',
      ),
    ],
    'Preserve current returned/thrown outcome semantics, basename redirects, repeated cookies, cache headers and route-ID authorization.',
    'modernjs-dnpv3.4',
  ),
  required(
    'server-only-data',
    'plugin-data-loader compiler',
    [`${data}/src/cli/loader.ts`, `${data}/src/cli/generateClient.ts`],
    [
      runtimeTest(
        `${goldens}/client-data-compilation.test.ts`,
        'Calls the real compiler loader/generator for browser versus server/worker output.',
      ),
    ],
    'Server-only data bodies stay out of browser output; server/worker retain the real handlers.',
    'modernjs-dnpv3.4',
  ),
  required(
    'client-data-overrides',
    'plugin-data-loader browser compilation',
    [`${data}/src/cli/loader.ts`],
    [
      runtimeTest(
        `${goldens}/client-data-compilation.test.ts`,
        'Calls actual .data.client browser selection and server/worker bypass APIs.',
      ),
    ],
    'Browser .data.client selection and HMR work while Node and worker bypass client overrides.',
    'modernjs-dnpv3.4',
  ),
  required(
    'actions-forms-fetchers',
    'plugin-tanstack framework-owned action bindings',
    [
      `${tanstack}/src/runtime/submitAction.ts`,
      `${tanstack}/src/runtime/dataMutation.tsx`,
    ],
    [
      runtimeTest(
        `${goldens}/react-native-actions.test.ts`,
        'Actual submitRouteAction tests GET/POST, request bodies, invalidation and returned versus thrown non-2xx responses; no redirect or concurrency proof is claimed.',
      ),
      runtimeTest(
        `${tanstack}/tests/router/dataMutation.test.tsx`,
        'Current React TanStack Form/useFetcher bindings exercise non-2xx and overlapping submissions with mocked hooks/router methods; no useSubmit binding exists.',
      ),
    ],
    'Framework-owned native Form/useSubmit/useFetcher distinguish GET loader and POST action, form versus fetcher errors, redirects and revalidation.',
    'modernjs-dnpv3.4',
  ),
  required(
    'invalidation-concurrency',
    'plugin-tanstack submitAction',
    [`${tanstack}/src/runtime/submitAction.ts`],
    [
      runtimeTest(
        `${tanstack}/tests/router/dataMutation.test.tsx`,
        'Phase/overlap unit evidence uses mocked hooks/router methods; native concurrent invalidation remains a downstream assertion.',
      ),
    ],
    'Concurrent actions invalidate the native router without dropping a later result or publishing stale pending state.',
    'modernjs-dnpv3.4',
  ),
  required(
    'deferred-data-abort',
    'plugin-data-loader deferred response protocol',
    [`${data}/src/runtime/response.ts`, `${data}/src/cli/data.ts`],
    [
      runtimeTest(
        `${goldens}/react-wire.test.ts`,
        'Real DeferredData encoder/decoder round trips and abort rejects unresolved values.',
      ),
    ],
    'Deferred values round trip; abort reaches loaders and streams; late failures do not mutate committed HTTP headers.',
    'modernjs-dnpv3.4',
  ),
  required(
    'localized-route-id-access',
    'i18n integration and plugin-data-loader',
    [`${data}/src/runtime/index.ts`],
    [
      runtimeTest(
        `${goldens}/react-wire.test.ts`,
        'Request-isolated route-ID resolvers and path authorization.',
      ),
      runtimeTest(
        'tests/integration/i18n/routes-tanstack-localised/tests/index.test.ts',
        'Localized native route navigation/data URLs.',
      ),
    ],
    'Localized route IDs resolve within the request and cannot load another matched route or leak between requests.',
    'modernjs-dnpv3.4',
  ),
  required(
    'data-hydration-reuse',
    'plugin-tanstack hydration',
    [`${tanstack}/src/runtime/loaderBridge.ts`],
    [
      runtimeTest(
        `${tanstack}/tests/router/clientHydration.test.tsx`,
        'Existing hydration-state unit test mocks native hydration; ordinary .data first-request reuse requires a counted browser network golden.',
      ),
    ],
    'Hydration reuses ordinary server .data results without an immediate duplicate loader request.',
  ),
  required(
    'head-assets-css',
    'runtime renderer-extensions and renderer document owner',
    ['packages/runtime/renderer-extensions/src/runtimePlugin.ts'],
    [
      runtimeTest(
        'tests/integration/ssr/tests/streaming.test.ts',
        'Streaming route CSS and prefetch links.',
      ),
      runtimeTest(
        'tests/integration/app-document/tests/index.test.ts',
        'Current custom document browser/HTML behavior.',
      ),
    ],
    'Native head/CSS/assets append and deduplicate in defined order and obey hydration placement.',
    'modernjs-dnpv3.13',
  ),
  required(
    'nonce-payload-framing',
    'runtime SSR document serialization',
    ['packages/server/core/src/plugins/render/render.ts'],
    [
      runtimeTest(
        'tests/integration/ssr/tests/rsc-closing-tags.test.ts',
        'Payload closing-tag regression in real streamed RSC SSR.',
      ),
    ],
    'CSP nonce propagates to native bootstrap; inline data escapes closing scripts including split stream chunks.',
    'modernjs-dnpv3.13',
  ),
  required(
    'ssr-cache',
    'server/render SSR cache',
    ['packages/server/core/src/plugins/render/ssrRender.ts'],
    [
      runtimeTest(
        'tests/integration/ssr/tests/base.test.ts',
        'Existing SSR cache policy assertions and no-ssr-cache fixture.',
      ),
    ],
    'Cache keys include app/entry, renderer, protocol and hydration build before lookup; failed/fallback/aborted streams do not enter success cache.',
    'modernjs-dnpv3.28',
  ),
  required(
    'render-level',
    'server/render cache and fallback policy',
    ['packages/server/core/src/plugins/render/render.ts'],
    [
      runtimeTest(
        'tests/integration/ssr/tests/base-fallback.test.ts',
        'Current SSR failure fallback HTTP behavior.',
      ),
    ],
    'Current renderLevel/no-ssr-cache behavior remains explicit and does not cache a fallback as successful SSR.',
    'modernjs-dnpv3.28',
  ),
  required(
    'ssr-fallback',
    'server/render loaderFailureMode and forceCSR',
    [
      'packages/server/core/src/plugins/render/render.ts',
      `${server}/server.ts`,
    ],
    [
      runtimeTest(
        'tests/integration/ssr/tests/base-fallback.test.ts',
        'Failure path remains a rendered response instead of a broken stream.',
      ),
    ],
    'forceCSR and loaderFailureMode preserve deliberate client-render versus error-boundary outcomes.',
    'modernjs-dnpv3.28',
  ),
  required(
    'ssr-by-route-ids',
    'server/render route policy',
    [
      `${server}/server.ts`,
      'packages/server/core/src/plugins/render/render.ts',
    ],
    [
      runtimeTest(
        'tests/integration/ssr/tests/partial.test.ts',
        'Partial SSR policy selects routes.',
      ),
    ],
    'Selected native route IDs use the correct per-route SSR policy without React Router matching.',
    'modernjs-dnpv3.28',
  ),
  required(
    'ssg',
    'plugin-ssr static generator',
    [
      `${app}/output.ts`,
      'packages/solutions/ultramodern-app-tools/src/native-composition/native-prerender.ts',
    ],
    [
      runtimeTest(
        'tests/integration/ssg/tests/simple.test.ts',
        'Generated static HTML is served and checked.',
      ),
      runtimeTest(
        'tests/integration/ssg/tests/nested-routes.test.ts',
        'Conventional nested/data routes prerender.',
      ),
      runtimeTest(
        'packages/solutions/ultramodern-app-tools/tests/native-composition/native-prerender.test.ts',
        'Solid and Octane SSG routes prerender through the native handler and replay loader payloads on navigation.',
      ),
      runtimeTest(
        'packages/runtime/renderer-core/tests/data/static.test.ts',
        'Native static data client round trip for prerendered documents.',
      ),
    ],
    'output.ssg/staticGenerate emit correct native documents and data for dynamic route parameters.',
    'modernjs-dnpv3.19',
  ),
  required(
    'ssg-by-entries',
    'plugin-ssr per-entry static generator',
    [`${app}/output.ts`],
    [
      sourceEvidence(
        `${app}/output.ts`,
        'ssgByEntries precedence is declared; declaration alone does not prove mixed policies.',
      ),
    ],
    'output.ssgByEntries takes precedence over output.ssg and generates only the selected entries.',
    'modernjs-dnpv3.19',
    'unresolved',
  ),
  required(
    'ssr-by-entries',
    'app-tools entry policy and server-core',
    [`${server}/server.ts`],
    [
      runtimeTest(
        'tests/integration/entries/tests/app-entry.test.ts',
        'Existing multi-entry application build and serve behavior.',
      ),
    ],
    'server.ssrByEntries retains independent per-entry native SSR/CSR policies.',
    'modernjs-dnpv3.19',
    'unresolved',
  ),
  required(
    'mixed-ssg-ssr-csr',
    'app-tools entry policy and deployment',
    [`${app}/output.ts`, `${server}/server.ts`],
    [
      sourceEvidence(`${app}/output.ts`, 'SSG is configurable per entry.'),
      sourceEvidence(`${server}/server.ts`, 'SSR is configurable per entry.'),
    ],
    'One application proves mixed SSG/SSR/CSR entries with entry-specific status, artifacts, hydration and cache behavior.',
    'modernjs-dnpv3.19',
    'unresolved',
  ),
  required(
    'i18n',
    'ultramodern i18n integration',
    ['packages/runtime/i18n-integration/src/cli.ts'],
    [
      runtimeTest(
        'tests/integration/i18n/routes-tanstack-localised/tests/index.test.ts',
        'Localized native route/data navigation.',
      ),
      runtimeTest(
        'tests/integration/i18n/routes-ssr/test/ssg.test.ts',
        'Localized SSG routes.',
      ),
    ],
    'Native locale detection/messages/HTML language and localized route/data identity work without React i18n imports.',
  ),
  required(
    'svg-assets',
    'builder SVG policy',
    [builder, builderTypes],
    [
      sourceEvidence(
        builder,
        'The upstream builder currently registers svgr and supports disableSvgr/svgDefaultExport.',
      ),
    ],
    'SVG URL assets work and duplicate transform claimants fail before compilation.',
    'modernjs-dnpv3.2',
  ),
  required(
    'svg-components',
    'renderer compiler SVG claimant',
    [
      builder,
      builderTypes,
      'packages/solutions/ultramodern-app-tools/src/native-composition/svg-components.ts',
    ],
    [
      sourceEvidence(
        builder,
        'Default component transform is React svgr; Solid/Octane claim their own native SVG component compiler instead.',
      ),
      runtimeTest(
        'packages/solutions/ultramodern-app-tools/tests/native-composition/svg-components.test.ts',
        'Solid and Octane claim ?component/default SVG imports and compile a renderer-native module; Octane still rejects React-only ?react imports.',
      ),
    ],
    'Selected renderer compiles native SVG components without React output, or rejects component SVG mode before writes.',
    'modernjs-dnpv3.19',
  ),
  required(
    'source-build',
    'builder sourceBuild',
    [builder, builderTypes],
    [
      runtimeTest(
        'tests/integration/source-code-build/index.test.ts',
        'Workspace source dependencies build and serve.',
      ),
    ],
    'experiments.sourceBuild compiles native source dependencies and preserves the renderer/module closure.',
  ),
  required(
    'custom-ui-entries',
    'app-tools analyze and entry generation',
    [`${app}/source.ts`],
    [
      runtimeTest(
        'tests/integration/entries/tests/app-custom-entries.test.ts',
        'Explicit source.entries and generated application entries.',
      ),
    ],
    'Custom UI and plain JS/TS infrastructure entries follow the selected descriptor without React injection.',
  ),
  required(
    'custom-server-entry',
    'server-core custom entry dispatch',
    ['packages/server/core/src/serverBase.ts'],
    [
      runtimeTest(
        'tests/integration/entries/tests/app-server-entry.test.ts',
        'Custom server entry is built and served.',
      ),
    ],
    'Custom server entry preserves static/API/custom middleware and native render/data HTTP outcomes.',
    'modernjs-dnpv3.28',
  ),
  required(
    'request-context-cleanup',
    'server-core and renderer request lifecycle',
    ['packages/server/core/src/serverBase.ts'],
    [
      runtimeTest(
        `${goldens}/react-wire.test.ts`,
        'Real request-owned loader context is isolated across concurrent dispatches.',
      ),
    ],
    'Per-request platform context survives proved async operations and cleanup runs once on every completion/failure/abort.',
    'modernjs-dnpv3.13',
  ),
  required(
    'worker-request-handler',
    'app-tools-extensions Cloudflare adapter',
    [
      `${extensions}/src/templates/cloudflare-entry.004-rendering-css.mjs`,
      'packages/solutions/ultramodern-app-tools/src/native-composition/native-worker.ts',
    ],
    [
      structuralTest(
        `${extensions}/tests/cloudflare-builder.test.ts`,
        'Generated worker requestHandler code is inspected; this does not execute a deployment.',
      ),
      runtimeTest(
        'packages/solutions/app-tools-extensions/tests/deploy-output/cloudflare-native-worker-dispatch.test.ts',
        'React, Solid and Octane native server handlers answer document/loader/action requests on local workerd instead of 501.',
      ),
      runtimeTest(
        'packages/runtime/renderer-core/tests/server/worker.test.ts',
        'dispatchNativeWorkerRequest binds env as the worker platform, keeps cleanup alive via ctx.waitUntil and rejects RSC headers.',
      ),
      runtimeTest(
        'packages/solutions/ultramodern-app-tools/tests/native-composition/native-worker.test.ts',
        'Worker build selects the native server transform by the workerSSR environment and writes build-validated assets/manifest.',
      ),
    ],
    'Generated requestHandler runs in the actual worker runtime with data/actions/native SSR, assets and cleanup.',
    'modernjs-dnpv3.20',
  ),
  required(
    'worker-fetch-export',
    'app-tools-extensions Cloudflare dispatch',
    [`${extensions}/src/templates/cloudflare-entry.005-worker-dispatch.mjs`],
    [
      structuralTest(
        'tests/integration/routes-tanstack-mf/tests/cloudflare-worker-contract.test.ts',
        'Cloudflare worker contract/source artifact validation; deployment is a separate gate.',
      ),
    ],
    'Direct Fetch export dispatch runs in the actual worker runtime and cannot bypass renderer/RSC/context guards.',
    'modernjs-dnpv3.20',
    'unresolved',
  ),
  required(
    'headless-worker',
    'headless Cloudflare CLI composition',
    [composition, `${extensions}/src/cloudflare-builder.ts`],
    [
      configTest(
        `${extensions}/tests/cloudflare-builder.test.ts`,
        'Worker-only entry configuration is exercised.',
      ),
    ],
    'API-only worker builds omit UI runtime and serve Effect/BFF/services/security in the worker runtime.',
    'modernjs-dnpv3.20',
    'unresolved',
  ),
  required(
    'worker-bindings-artifacts',
    'Cloudflare deploy-output',
    [`${app}/deploy.ts`, `${extensions}/src/cloudflare/wrangler-config.ts`],
    [
      configTest(
        `${extensions}/tests/deploy-output/cloudflare-delivery-unit-profile.test.ts`,
        'Bindings/security/artifact profile contract is checked.',
      ),
    ],
    'Worker D1/service bindings, public assets, staged artifacts, exclusions, security and compatibility date remain correct.',
    'modernjs-dnpv3.20',
    'unresolved',
  ),
  required(
    'provider-output-artifacts',
    'app-tools-extensions deployment outputs',
    [
      `${extensions}/src/deploy-output/plugin.ts`,
      `${extensions}/src/deploy-output/target.ts`,
    ],
    [
      runtimeTest(
        'tests/integration/deploy-csr/tests/index.test.ts',
        'Existing deployment output integration assertions.',
      ),
      configTest(
        `${extensions}/tests/deploy-output/npm-aliases.test.ts`,
        'Published deployment alias configuration; this is not a provider deployment receipt.',
      ),
    ],
    'Vercel, Netlify and GitHub Pages output layouts retain entry/assets/SSR policy and deploy-target precedence for selected native artifacts.',
    'modernjs-dnpv3.19',
    'unresolved',
  ),
  required(
    'same-renderer-federation',
    'server-runtime-extensions and Module Federation native bridge',
    [
      'packages/server/runtime-extensions/src/index.ts',
      'packages/solutions/ultramodern-app-tools/src/native-composition/native-module-federation.ts',
    ],
    [
      runtimeTest(
        'tests/integration/routes-tanstack-mf/test/index.test.ts',
        'React host/remotes exercise SSR/navigation/data/actions and mutations.',
      ),
      runtimeTest(
        'packages/solutions/ultramodern-app-tools/tests/native-composition/native-module-federation.test.ts',
        'Solid native Module Federation renderer plugin wiring and manifest validation.',
      ),
      sourceEvidence(
        'tests/ultramodern-renderers/solid-federation/proof.mjs',
        'Browser proof script (not a unit test file): a Solid host renders a Solid remote widget under a single shared solid-js (CSR-only); SSR renders only the fallback and a React-stamped publication is rejected.',
      ),
    ],
    'Same-renderer host/remotes prove native SSR, navigation, shared data, cancellation and unmount, or reject unsupported preview configuration.',
    'modernjs-dnpv3.21',
  ),
  required(
    'react-rsc',
    'React RSC CLI/runtime/server',
    ['packages/runtime/plugin-runtime/src/rsc/client.ts'],
    [
      runtimeTest(
        'tests/integration/routes-tanstack-rsc/tests/index.test.ts',
        'TanStack React RSC payload/browser flow.',
      ),
      runtimeTest(
        'tests/integration/rsc-ssr-routes/tests/index.test.ts',
        'React RSC SSR routes/data.',
      ),
    ],
    'React RSC and server actions retain current behavior; Solid/Octane configuration and protocol requests reject before React import/execution.',
    'modernjs-dnpv3.22',
    'explicitly-unsupported',
  ),
  required(
    'worker-react-rsc',
    'Cloudflare adapter and React RSC runtime',
    [`${extensions}/src/templates/cloudflare-entry.004-rendering-css.mjs`],
    [
      sourceEvidence(
        `${extensions}/src/templates/cloudflare-entry.004-rendering-css.mjs`,
        'Worker dispatch exists; source alone establishes no worker RSC execution.',
      ),
    ],
    'Current React worker RSC capability is resolved with actual worker artifacts/runtime; non-React protocol requests reject deterministically.',
    'modernjs-dnpv3.22',
    'explicitly-unsupported',
  ),
  required(
    'generator-identity',
    'ultramodern-create and delivery-unit-schema',
    ['packages/toolkit/ultramodern-create/src/index.ts'],
    [
      runtimeTest(
        'tests/integration/create-ultramodern-workspace/tests/index.test.ts',
        'Current native create/add application flow.',
      ),
    ],
    'Renderer comes from evaluated app configuration; generated metadata is an atomic projection; reload/add commands preserve it.',
    'modernjs-dnpv3.7',
  ),
  required(
    'packed-consumers',
    'ultramodern-publish and package acceptance',
    ['scripts/ultramodern-publish/prepare-bleedingdev-packages.mjs'],
    [
      runtimeTest(
        'scripts/prebundle/ultramodern/packed-runtime-consumer.test.mjs',
        'Packed package runtime consumer executes in isolation.',
      ),
    ],
    'Registry-mapped packed apps load isolated native type/entry/dependency graphs and record exact candidate digests.',
    'modernjs-dnpv3.18',
  ),
  required(
    'tractor-downstream',
    'release acceptance and Tractor application',
    [
      'scripts/ultramodern-production-readiness/run-tractor-downstream-acceptance.mjs',
    ],
    [
      structuralTest(
        'scripts/ultramodern-production-readiness/__tests__/tractor-downstream.test.js',
        'Acceptance harness contract; no current downstream/browser pass is implied.',
      ),
    ],
    'Update the existing Tractor demo with final candidate packages and verify the preserved UI/HTTP/platform behavior.',
    'modernjs-dnpv3.23',
    'unresolved',
  ),
];

for (const id of ['react-rsc', 'worker-react-rsc']) {
  const capability = capabilities.find(row => row.id === id);
  for (const renderer of ['solid', 'octane']) {
    capability.renderers[renderer].expectedTest.owner =
      'descriptor/node-dispatch/worker-certification guards';
    capability.renderers[renderer].expectedTest.assertion =
      'Configuration/build reject before outputs; Node/custom-entry and both worker dispatch paths return 400 unsupported-renderer-capability before React RSC import/execution.';
  }
}

// The admitted first native profile is Node. Unsupported requests fail at their owner.
// ssg, svg-components and worker-request-handler (Cloudflare SSR) are no longer
// in this list: Solid and Octane profiles now declare them supported (see
// packages/solutions/ultramodern-app-tools/src/renderers/{solid,octane}/profile.ts)
// and keep their own `required()` native status above.
for (const id of [
  'ssg-by-entries',
  'mixed-ssg-ssr-csr',
  'i18n',
  'worker-fetch-export',
  'headless-worker',
  'worker-bindings-artifacts',
]) {
  const capability = capabilities.find(row => row.id === id);
  for (const renderer of ['solid', 'octane']) {
    const worker = id.includes('worker');
    capability.renderers[renderer] = {
      status: 'explicitly-unsupported',
      expectedTest: {
        kind: 'rejection',
        assertion: `Reject ${id} for ${renderer} before output writes or unsupported platform dispatch; React behavior remains required.`,
        owner: worker
          ? 'descriptor and worker capability guards'
          : 'renderer descriptor capability guard',
        gate: worker ? 'modernjs-dnpv3.20' : 'modernjs-dnpv3.2',
      },
    };
  }
}

// same-renderer-federation only has a renderer-neutral `moduleFederation`
// boolean in the candidate profile for octane (false); Solid's profile
// declares 'client', a narrower CSR-only same-renderer component federation,
// never application-SSR host/remote federation. Each renderer is handled on
// its own below instead of through the uniform unsupported loop.
{
  const capability = capabilities.find(
    row => row.id === 'same-renderer-federation',
  );
  capability.renderers.solid = {
    status: 'preview-after-proof',
    expectedTest: {
      kind: 'positive-runtime',
      assertion:
        'Solid admits same-renderer federated components between a workspace host and remote under a single shared solid-js; this is CSR-only, never application SSR host/remote federation.',
      owner: 'solid application adapter',
      gate: 'modernjs-dnpv3.21',
    },
  };
  capability.renderers.octane = {
    status: 'explicitly-unsupported',
    expectedTest: {
      kind: 'rejection',
      assertion:
        'Reject same-renderer-federation for octane before output writes or unsupported platform dispatch; React behavior remains required.',
      owner: 'descriptor and federation capability guards',
      gate: 'modernjs-dnpv3.21',
    },
  };
}

capabilities.push({
  id: 'cross-renderer-remotes',
  owner: 'renderer descriptor and federation admission',
  sources: [
    'packages/solutions/ultramodern-app-tools/src/native-composition/types.ts',
  ],
  evidence: [
    sourceEvidence(
      'packages/solutions/ultramodern-app-tools/src/native-composition/types.ts',
      'No cross-renderer component/app-mount protocol is implemented; release policy rejects it.',
    ),
  ],
  renderers: Object.fromEntries(
    ['react', 'solid', 'octane'].map(renderer => [
      renderer,
      {
        status: 'explicitly-unsupported',
        expectedTest: {
          kind: 'rejection',
          assertion:
            'Reject cross-renderer component remotes and isolated application mount bridges explicitly before writes/mount.',
          owner: 'descriptor and federation capability guards',
          gate: 'modernjs-dnpv3.21',
        },
      },
    ]),
  ),
});

export const inventory = {
  schemaVersion: 1,
  characterizationBase: '42ced9b2e58ac14644f46ea5ec54cf78730b61ec',
  scope:
    'Current configuration, composition and required acceptance; test references are definitions, not execution receipts.',
  config: {
    source: `${app}/index.ts`,
    symbol: 'AppToolsUserConfig',
    sections: configSections,
    declaredTypes: typeKeys,
    nestedTypes: [
      {
        // DeployUserConfig.worker references this extension-owned interface.
        source: `${extensions}/src/config.ts`,
        symbol: 'CloudflareWorkerDeployConfig',
        pathPrefix: 'worker',
        declaredPaths: [
          'worker.name',
          'worker.compatibilityDate',
          'worker.ssr',
          'worker.security',
          'worker.wrangler',
          'worker.artifacts',
          'worker.publicAssets',
          'worker.d1Databases',
          'worker.services',
          'worker.vpcServices',
          'worker.publicAssetExcludes',
        ],
      },
      {
        source: `${server}/server.ts`,
        symbol: 'ServerUserConfig',
        declaredPaths: [
          'rsc.environments',
          'rsc.environments.server',
          'rsc.environments.client',
        ],
      },
    ],
    aliases: configAliases,
    deployTargets: {
      source: `${extensions}/src/deploy-output/target.ts`,
      symbol: 'DEPLOY_TARGETS',
      values: ['node', 'vercel', 'netlify', 'ghPages', 'cloudflare'],
    },
    forwardedProviders: [
      {
        source: builderTypes,
        symbols: ['BuilderConfig', 'BuilderExtraConfig'],
        provider: '@rsbuild/core',
        treatment:
          'Inherited provider keys retain their declared source/toolchain types; no renderer-neutral reinterpretation.',
      },
    ],
  },
  composedPlugins: [
    [
      'appTools',
      '@modern-js/app-tools',
      'upstream application/build/CLI composition',
    ],
    [
      'ultramodernI18nIntegrationPlugin',
      '@modern-js/i18n-integration',
      'current React i18n CLI/runtime integration',
    ],
    [
      'ultramodernRouterIntegrationPlugin',
      composition,
      'current React TanStack router integration',
    ],
    [
      'ultramodernSSRIntegrationPlugin',
      composition,
      'current React SSR/router bridge',
    ],
    [
      'backendFederationBuildPlugin',
      '@modern-js/app-tools-extensions/backend-federation-build',
      'backend federation compilation',
    ],
    [
      'createCloudflareBuilderPlugin',
      '@modern-js/app-tools-extensions/cloudflare-builder',
      'worker compilation/deployment',
    ],
    [
      'headlessCloudflareWorkerPlugin',
      composition,
      'API-only worker-only build',
    ],
    [
      'createDeployOutputAliasesPlugin',
      '@modern-js/app-tools-extensions/deploy-output/plugin',
      'deployment artifact aliases',
    ],
    [
      'ultramodernReleaseEnvelopePlugin',
      composition,
      'release envelope generation',
    ],
  ].map(([factory, owner, purpose]) => ({
    factory,
    owner,
    purpose,
    source: composition,
    proofGate: 'modernjs-dnpv3.14',
  })),
  additionalDescriptors: [
    {
      id: 'runtime-module-resolution',
      source: composition,
      owner: 'app-tools-extensions',
      condition: 'runtime package module directories exist',
      proofGate: 'modernjs-dnpv3.2',
    },
    {
      id: 'rsc-disabled-runtime',
      source: composition,
      owner: 'ultramodern-app-tools',
      condition: '!server.rsc',
      proofGate: 'modernjs-dnpv3.2',
    },
    {
      id: 'server-extensions',
      source: composition,
      owner: 'server-runtime-extensions',
      condition: 'always renamed/added through _internalServerPlugins',
      proofGate: 'modernjs-dnpv3.28',
    },
    {
      id: 'renderer-head',
      source: composition,
      owner: 'renderer-extensions',
      condition: 'current fixed React runtime descriptor',
      proofGate: 'modernjs-dnpv3.2',
    },
    {
      id: 'react-compiler-refresh',
      source: builder,
      owner: '@rsbuild/plugin-react',
      condition: 'current global builder React transform',
      proofGate: 'modernjs-dnpv3.2',
    },
    {
      id: 'react-svg',
      source: builder,
      owner: '@rsbuild/plugin-svgr',
      condition: '!output.disableSvgr',
      proofGate: 'modernjs-dnpv3.2',
    },
  ],
  deploymentProfiles: [
    {
      id: 'node-csr',
      target: 'node',
      owner: 'server-core/app-tools',
      source: `${app}/deploy.ts`,
      capabilityIds: ['node-csr', 'custom-server-entry', 'custom-ui-entries'],
      proofGate: 'modernjs-dnpv3.19',
    },
    {
      id: 'node-ssr-streaming',
      target: 'node',
      owner: 'server/render/runtime',
      source: `${server}/server.ts`,
      capabilityIds: [
        'node-ssr',
        'streaming-shell',
        'data-http',
        'ssr-cache',
        'ssr-fallback',
      ],
      proofGate: 'modernjs-dnpv3.19',
    },
    {
      id: 'static-ssg',
      owner: 'plugin-ssr',
      source: `${app}/output.ts`,
      capabilityIds: ['ssg', 'ssg-by-entries', 'mixed-ssg-ssr-csr'],
      proofGate: 'modernjs-dnpv3.19',
    },
    {
      id: 'cloudflare-ui-worker',
      target: 'cloudflare',
      owner: 'app-tools-extensions',
      source: `${extensions}/src/cloudflare-builder.ts`,
      capabilityIds: [
        'worker-request-handler',
        'worker-fetch-export',
        'worker-bindings-artifacts',
        'worker-react-rsc',
      ],
      proofGate: 'modernjs-dnpv3.20',
    },
    {
      id: 'cloudflare-headless',
      target: 'cloudflare',
      owner: 'headlessCloudflareWorkerPlugin',
      source: composition,
      capabilityIds: ['headless-worker', 'worker-bindings-artifacts'],
      proofGate: 'modernjs-dnpv3.20',
    },
    ...['vercel', 'netlify', 'ghPages'].map(target => ({
      id: `${target}-output`,
      target,
      owner: 'app-tools-extensions deployment outputs',
      source: `${extensions}/src/deploy-output/plugin.ts`,
      capabilityIds: ['provider-output-artifacts'],
      proofGate: 'modernjs-dnpv3.19',
    })),
    {
      id: 'federated-react',
      owner: 'server-runtime-extensions',
      source: 'packages/server/runtime-extensions/src/index.ts',
      capabilityIds: ['same-renderer-federation', 'cross-renderer-remotes'],
      proofGate: 'modernjs-dnpv3.21',
    },
    {
      id: 'react-rsc',
      owner: 'plugin-runtime/server/render',
      source: 'packages/runtime/plugin-runtime/src/rsc/client.ts',
      capabilityIds: ['react-rsc', 'worker-react-rsc'],
      proofGate: 'modernjs-dnpv3.22',
    },
  ],
  actionProtocol: {
    owner:
      'plugin-data-loader HTTP protocol and framework-owned native router bindings',
    currentAPIs: [
      {
        name: 'createRequest',
        source: `${data}/src/cli/createRequest.ts`,
        role: 'browser loader proxy; __loader/__ssrDirect selectors, current response markers, abort',
      },
      {
        name: 'createActionRequest',
        source: `${data}/src/cli/createRequest.ts`,
        role: 'browser action proxy; request body, method, non-2xx raw Response semantics',
      },
      {
        name: 'modernLoaderToTanstack',
        source: `${tanstack}/src/runtime/loaderBridge.ts`,
        role: 'native TanStack loader request/params/context/outcome bridge',
      },
      {
        name: 'submitRouteAction',
        source: `${tanstack}/src/runtime/submitAction.ts`,
        role: 'GET/POST dispatch, response parsing, redirect and native invalidation',
      },
      ...['Form', 'useFetcher'].map(name => ({
        name,
        source: `${tanstack}/src/runtime/dataMutation.tsx`,
        role: 'current React public action/form/fetcher binding',
      })),
    ],
    nativeBindings: ['Form', 'useSubmit', 'useFetcher'],
    nativeStatus:
      'Names define the framework-owned contract; no Solid/Octane binding is claimed implemented by characterization.',
    proofGate: 'modernjs-dnpv3.4',
  },
  explicitGaps: [
    {
      id: 'worker-rsc-runtime',
      capabilityId: 'worker-react-rsc',
      reason:
        'Existing worker source/contract tests do not prove React RSC in an actual worker runtime.',
      gate: 'modernjs-dnpv3.22',
    },
    {
      id: 'native-svg-runtime',
      capabilityId: 'svg-components',
      reason:
        'Current svgr emits React components; native compiler/runtime evidence or early rejection is required.',
      gate: 'modernjs-dnpv3.19',
    },
    {
      id: 'mixed-entry-runtime',
      capabilityId: 'mixed-ssg-ssr-csr',
      reason:
        'Separate SSG/SSR declarations and tests do not certify one mixed SSG/SSR/CSR application.',
      gate: 'modernjs-dnpv3.19',
    },
    {
      id: 'ordinary-data-hydration-reuse',
      capabilityId: 'data-hydration-reuse',
      reason:
        'Hydration-state tests do not replace a counted first-hydration network test for ordinary .data handlers.',
      gate: 'modernjs-dnpv3.19',
    },
    {
      id: 'native-worker-and-federation',
      capabilityId: 'same-renderer-federation',
      reason:
        'React bridge and structural worker evidence cannot certify native workers or same-renderer native remotes.',
      gate: 'modernjs-dnpv3.21',
    },
    {
      id: 'tanstack-use-submit-binding',
      capabilityId: 'actions-forms-fetchers',
      reason:
        'The current TanStack runtime exports Form/useFetcher, but no framework-owned useSubmit binding. Its proposed native contract must be implemented and tested explicitly.',
      gate: 'modernjs-dnpv3.4',
    },
  ],
  capabilities,
};
