import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSharedApi } from '../../ultramodern-create/src/ultramodern-workspace/api/shared';
import { runMicroVerticalApiCheckCli } from '../src/cli/microvertical-api-check';
import {
  checkMicroVerticalApiBoundaries,
  checkMicroVerticalApiConsumerFiles,
  type MicroVerticalApiBaselineExpectation,
  microVerticalApiBaselineViolation,
} from '../src/microvertical-api-boundary';

const baseline = '@modern-js/bff-effect/microvertical-api';
const exportsSource = `export const MicroVerticalBuildMarkerSchema = {}; export const MicroVerticalReadinessSchema = {}; export const createMicroVerticalOperationContext = input => input;`;
const contract = `import { HttpApi, HttpApiEndpoint, HttpApiGroup, Schema } from '@modern-js/bff-effect/effect-client';
import { MicroVerticalBuildMarkerSchema, MicroVerticalReadinessSchema, createMicroVerticalOperationContext } from '${baseline}';
export const catalogMarkerSchema = MicroVerticalBuildMarkerSchema;
export const catalogReadinessSchema = MicroVerticalReadinessSchema;
export const catalogFoundationApi = HttpApi.make('CatalogFoundationApi').add(HttpApiGroup.make('foundation').add(HttpApiEndpoint.get('readiness', '/catalog/readiness', { success: catalogReadinessSchema })));
export const catalogApi = HttpApi.make('CatalogApi').addHttpApi(catalogFoundationApi);
export const catalogOperationContexts = { readiness: createMicroVerticalOperationContext({method: 'GET', operationId: 'CatalogApi:/catalog/readiness', routePath: '/catalog/readiness'}) } as const;
export const catalogApiContract = { apiPrefix: '/catalog-api', basePath: '/catalog-api/catalog', ownerId: 'catalog', readinessPath: '/catalog-api/catalog/readiness' } as const;`;
/** A sub-API whose group uses every non-endpoint Effect combinator. */
const prefixedSearchApi =
  () => `import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';
import { CatalogAnnotation, CatalogAuthMiddleware } from '../middleware.ts';
export const catalogSearchApi = HttpApi.make('CatalogSearchApi').add(
  HttpApiGroup.make('catalogSearch')
    .add(HttpApiEndpoint.post('execute', '/catalog/search', { success: Schema.Unknown }))
    .middleware(CatalogAuthMiddleware)
    .prefix('/search')
    .annotate(CatalogAnnotation, 'value'),
);`;
const pascal = (name: string) =>
  `${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;
/** A root contract that composes two sub-APIs from sibling modules. */
const composed = contract.replace(
  `export const catalogApi = HttpApi.make('CatalogApi').addHttpApi(catalogFoundationApi);`,
  `import { catalogSearchApi } from './apis/catalog-search.ts';
import { catalogCommandsApi } from './commands';
export const catalogApi = HttpApi.make('CatalogApi').addHttpApi(catalogFoundationApi).addHttpApi(catalogSearchApi).addHttpApi(catalogCommandsApi);`,
);
const entry = `import { defineEffectBff, HttpApiBuilder, Layer } from '@modern-js/bff-effect/effect-edge'; import { catalogApi } from '../shared/api.ts'; const handlers = HttpApiBuilder.group(catalogApi, 'foundation', h => h.handle('readiness', () => undefined)); const layer = HttpApiBuilder.layer(catalogApi).pipe(Layer.provide(handlers)); export default defineEffectBff({api: catalogApi, layer});`;
let root: string;
let owner: string;
let file: string;
let expectation: MicroVerticalApiBaselineExpectation;
const write = (file: string, source: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
};
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'code-tools-api-boundary-'));
  owner = path.join(root, 'node_modules/@modern-js/bff-effect');
  write(
    path.join(owner, 'package.json'),
    JSON.stringify({
      name: '@modern-js/bff-effect',
      type: 'module',
      exports: {
        './microvertical-api': {
          types: './types.d.ts',
          import: './index.js',
          require: './index.js',
        },
      },
    }),
  );
  write(path.join(owner, 'index.js'), exportsSource);
  file = path.join(root, 'verticals/catalog/shared/api.ts');
  write(file, contract);
  write(
    path.join(root, 'apps/shell/package.json'),
    JSON.stringify({ name: '@fixture/shell' }),
  );
  write(
    path.join(root, 'verticals/catalog/package.json'),
    JSON.stringify({
      name: '@fixture/catalog',
      exports: {
        './api': './shared/api.ts',
        './api/client': './src/api/catalog-client.ts',
      },
    }),
  );
  write(
    path.join(root, 'topology/reference-topology.json'),
    JSON.stringify({
      shell: {
        id: 'shell',
        kind: 'shell',
        path: 'apps/shell',
        package: '@fixture/shell',
      },
      verticals: [
        {
          id: 'catalog',
          path: 'verticals/catalog',
          kind: 'vertical',
          package: '@fixture/catalog',
          api: {},
        },
      ],
    }),
  );
  write(path.join(root, 'verticals/catalog/api/index.ts'), entry);
  write(
    path.join(root, 'verticals/catalog/src/api/catalog-client.ts'),
    `import { Effect, makeEffectHttpApiClient } from '@modern-js/bff-effect/effect-client'; import { catalogApi } from '../../shared/api'; export const client = makeEffectHttpApiClient(catalogApi);`,
  );
  expectation = {
    additionalPaths: {},
    apiPrefix: '/catalog-api',
    basePath: '/catalog-api/catalog',
    ownerId: 'catalog',
    readinessPath: '/catalog-api/catalog/readiness',
    effectClientPackage: '@modern-js/bff-effect/effect-client',
    baselinePackage: baseline,
    baselinePackageDirectory: owner,
  };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const validate = (source = contract) => {
  write(file, source);
  return microVerticalApiBaselineViolation('catalog', file, expectation);
};

const subApi = (
  exportName: string,
  group: string,
  route: string,
  routeExpression = `'${route}'`,
) => `import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';
export const ${exportName} = HttpApi.make('${pascal(exportName)}').add(HttpApiGroup.make('${group}').add(HttpApiEndpoint.post('execute', ${routeExpression}, { success: Schema.Unknown })));`;

test('composes sub-APIs declared in sibling modules', () => {
  // A named import with an explicit `.ts` specifier, plus an extension-less
  // directory import whose index re-exports a third module: the shapes a
  // consumer reaches for when a root API outgrows one file.
  write(
    path.join(root, 'verticals/catalog/shared/apis/catalog-search.ts'),
    subApi('catalogSearchApi', 'catalogSearch', '/catalog/search'),
  );
  write(
    path.join(root, 'verticals/catalog/shared/commands/catalog-commands.ts'),
    subApi('catalogCommandsApi', 'catalogCommands', '/catalog/commands'),
  );
  write(
    path.join(root, 'verticals/catalog/shared/commands/index.ts'),
    `export { catalogCommandsApi } from './catalog-commands.ts';`,
  );
  expect(validate(composed)).toBeUndefined();
});

test('still rejects a composed identifier it cannot resolve', () => {
  write(
    path.join(root, 'verticals/catalog/shared/apis/catalog-search.ts'),
    subApi('catalogSearchApi', 'catalogSearch', '/catalog/search'),
  );
  // `./commands` is never created, so `catalogCommandsApi` stays unresolved.
  expect(validate(composed)).toContain('bounded native endpoint declarations');
});

test('resolves a public shared workspace export under an arbitrary scope', () => {
  write(
    path.join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - packages/*\n  - verticals/*\n',
  );
  const shared = path.join(root, 'packages/contracts');
  write(
    path.join(shared, 'package.json'),
    JSON.stringify({
      name: '@domain/shared-contracts',
      exports: {
        './catalog': {
          'modern:source': './src/catalog.ts',
          import: './dist/catalog.js',
        },
      },
    }),
  );
  write(
    path.join(shared, 'src/catalog.ts'),
    `export { catalogSearchApi } from './catalog-search.ts';`,
  );
  write(
    path.join(shared, 'src/catalog-search.ts'),
    subApi('catalogSearchApi', 'catalogSearch', '/catalog/search'),
  );
  const link = path.join(root, 'node_modules/@domain/shared-contracts');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(shared, link);
  write(
    path.join(root, 'verticals/catalog/shared/commands/index.ts'),
    subApi('catalogCommandsApi', 'catalogCommands', '/catalog/commands'),
  );
  const publicSource = composed.replace(
    "'./apis/catalog-search.ts'",
    "'@domain/shared-contracts/catalog'",
  );
  expect(validate(publicSource)).toBeUndefined();
  expect(validate(publicSource.replace("/catalog'", "/private'"))).toContain(
    'bounded native endpoint declarations',
  );
  expect(
    validate(
      publicSource.replace(
        "'@domain/shared-contracts/catalog'",
        "'@domain/shared-contracts/src/catalog-search'",
      ),
    ),
  ).toContain('bounded native endpoint declarations');
});

test('rejects private cross-owner paths and export cycles', () => {
  write(
    path.join(root, 'verticals/foreign/shared/api.ts'),
    subApi('catalogSearchApi', 'catalogSearch', '/catalog/search'),
  );
  write(
    path.join(root, 'verticals/catalog/shared/commands/index.ts'),
    subApi('catalogCommandsApi', 'catalogCommands', '/catalog/commands'),
  );
  expect(
    validate(
      composed.replace(
        "'./apis/catalog-search.ts'",
        "'../../foreign/shared/api.ts'",
      ),
    ),
  ).toContain('bounded native endpoint declarations');
  write(
    path.join(root, 'verticals/catalog/shared/apis/catalog-search.ts'),
    "export { catalogSearchApi } from './cycle.ts';",
  );
  write(
    path.join(root, 'verticals/catalog/shared/apis/cycle.ts'),
    "export { catalogSearchApi } from './catalog-search.ts';",
  );
  expect(validate(composed)).toContain('bounded native endpoint declarations');
});

test('still rejects an unbounded endpoint reached through an import', () => {
  write(
    path.join(root, 'verticals/catalog/shared/apis/catalog-search.ts'),
    // A computed route path is not a bounded endpoint identity, and importing
    // the declaration must not launder that.
    `const searchRoute = '/catalog/search';\n${subApi(
      'catalogSearchApi',
      'catalogSearch',
      '/catalog/search',
      'searchRoute',
    )}`,
  );
  write(
    path.join(root, 'verticals/catalog/shared/commands/catalog-commands.ts'),
    subApi('catalogCommandsApi', 'catalogCommands', '/catalog/commands'),
  );
  write(
    path.join(root, 'verticals/catalog/shared/commands/index.ts'),
    `export { catalogCommandsApi } from './catalog-commands.ts';`,
  );
  expect(validate(composed)).toContain('bounded native endpoint declarations');
});

test('accepts Effect combinators that add no endpoints, and applies prefix', () => {
  write(
    path.join(root, 'verticals/catalog/shared/apis/catalog-search.ts'),
    prefixedSearchApi(),
  );
  write(
    path.join(root, 'verticals/catalog/shared/commands/catalog-commands.ts'),
    subApi('catalogCommandsApi', 'catalogCommands', '/catalog/commands'),
  );
  write(
    path.join(root, 'verticals/catalog/shared/commands/index.ts'),
    `export { catalogCommandsApi } from './catalog-commands.ts';`,
  );
  // `searchPath` only matches a route the traversal actually prefixed, so this
  // fails if `.prefix` were merely tolerated and not applied.
  expect(
    validate(
      composed.replace(
        `readinessPath: '/catalog-api/catalog/readiness' } as const;`,
        `readinessPath: '/catalog-api/catalog/readiness', searchPath: '/catalog-api/search/catalog/search' } as const;`,
      ),
    ),
  ).toBeUndefined();
});

test('still rejects a chain combinator Effect does not define', () => {
  write(
    path.join(root, 'verticals/catalog/shared/apis/catalog-search.ts'),
    prefixedSearchApi().replace(
      `.annotate(CatalogAnnotation, 'value')`,
      '.decorate(CatalogAnnotation)',
    ),
  );
  write(
    path.join(root, 'verticals/catalog/shared/commands/catalog-commands.ts'),
    subApi('catalogCommandsApi', 'catalogCommands', '/catalog/commands'),
  );
  write(
    path.join(root, 'verticals/catalog/shared/commands/index.ts'),
    `export { catalogCommandsApi } from './catalog-commands.ts';`,
  );
  expect(validate(composed)).toContain('bounded native endpoint declarations');
});

test('resolves a generated client that composes per-operation modules', () => {
  const clientFile = path.join(
    root,
    'verticals/catalog/src/api/catalog-client.ts',
  );
  write(
    path.join(root, 'verticals/catalog/src/api/catalog-search-client.ts'),
    `import { Effect, makeEffectHttpApiClient } from '@modern-js/bff-effect/effect-client'; import { catalogApi } from '../../shared/api.ts'; export const searchClient = makeEffectHttpApiClient(catalogApi);`,
  );
  // The aggregate module re-exports the operation clients instead of calling
  // the factory itself; the governed surface is still fully present.
  write(
    clientFile,
    `export { searchClient } from './catalog-search-client.ts';`,
  );
  expect(
    checkMicroVerticalApiConsumerFiles({ workspaceRoot: root }).diagnostics,
  ).toEqual([]);

  write(clientFile, `export const client = undefined;`);
  expect(
    checkMicroVerticalApiConsumerFiles({
      workspaceRoot: root,
    }).diagnostics.join('\n'),
  ).toContain('must call makeEffectHttpApiClient(...)');
});

test('parses .ts as TypeScript without JSX and .tsx with JSX', () => {
  write(
    path.join(root, 'verticals/catalog/modern.config.ts'),
    `const whenEnabled = <Configuration>(enabled: boolean, configuration: Configuration) =>\n  enabled ? configuration : undefined;\nexport default whenEnabled(true, {});\n`,
  );
  write(
    path.join(root, 'verticals/catalog/src/components/catalog-widget.tsx'),
    `export default function CatalogWidget() {\n  return <span>catalog</span>;\n}\n`,
  );
  expect(
    checkMicroVerticalApiConsumerFiles({
      workspaceRoot: root,
    }).diagnostics.join('\n'),
  ).not.toContain('invalid source syntax');
});

test('checks consumer composition without inspecting framework implementation', () => {
  expect(validate()).toBeUndefined();
  expect(
    validate(
      contract
        .replace(
          '= MicroVerticalBuildMarkerSchema;',
          '= Schema.Struct({...MicroVerticalBuildMarkerSchema.fields});',
        )
        .replace(
          '= MicroVerticalReadinessSchema;',
          '= Schema.Struct({...MicroVerticalReadinessSchema.fields, marker: catalogMarkerSchema});',
        ),
    ),
  ).toBeUndefined();
});
test.each([
  ["ownerId: 'catalog'", "ownerId: 'foreign'", 'metadata'],
  ["method: 'GET'", "method: 'POST'", 'operation map'],
  [
    "operationId: 'CatalogApi:/catalog/readiness'",
    "operationId: 'ForeignApi:/catalog/readiness'",
    'operation map',
  ],
  [
    '.addHttpApi(catalogFoundationApi)',
    '.add(catalogFoundationApi)',
    'compose',
  ],
  ['success: catalogReadinessSchema', 'success: Schema.Unknown', 'foundation'],
  [
    '= MicroVerticalBuildMarkerSchema;',
    '= Schema.Struct({...MicroVerticalBuildMarkerSchema.fields, version: Schema.String});',
    'build marker',
  ],
  [
    '= MicroVerticalReadinessSchema;',
    '= Schema.Struct({...MicroVerticalReadinessSchema.fields, status: Schema.String, marker: catalogMarkerSchema});',
    'readiness schema',
  ],
  [
    'MicroVerticalReadinessSchema, createMicroVerticalOperationContext }',
    'fake as MicroVerticalReadinessSchema, createMicroVerticalOperationContext }',
    'exact baseline',
  ],
  [
    "from '@modern-js/bff-effect/microvertical-api'",
    "from 'foreign'",
    'exact baseline',
  ],
])('rejects %s', (before, after, reason) =>
  expect(validate(contract.replace(before, after))).toContain(reason));
test('additional metadata remains caller-owned', () => {
  expectation = {
    ...expectation,
    additionalPaths: { searchPath: '/catalog-api/catalog/search' },
  };
  expect(validate()).toBeUndefined();
  expect(
    validate(
      contract.replace(
        "ownerId: 'catalog'",
        "searchPath: '/catalog-api/catalog/search', ownerId: 'catalog'",
      ),
    ),
  ).toBeUndefined();
  expect(
    validate(
      contract.replace(
        "ownerId: 'catalog'",
        "searchPath: '/foreign', ownerId: 'catalog'",
      ),
    ),
  ).toContain('metadata');
});
test('accepts bounded barrels but rejects foreign, renamed, ambiguous and cyclic exports', () => {
  write(path.join(owner, 'index.js'), "export * from './barrel.js';");
  write(
    path.join(owner, 'barrel.js'),
    "export { MicroVerticalBuildMarkerSchema, MicroVerticalReadinessSchema, createMicroVerticalOperationContext } from './owner.js';",
  );
  write(path.join(owner, 'owner.js'), exportsSource);
  expect(validate()).toBeUndefined();
  for (const source of [
    "export * from 'foreign';",
    "export * from './owner.js'; const fake = {}; export { fake as MicroVerticalReadinessSchema };",
    "export * from './owner.js'; export * from './decoy.js';",
    "export * from './index.js';",
  ]) {
    write(path.join(owner, 'barrel.js'), source);
    write(path.join(owner, 'decoy.js'), exportsSource);
    expect(validate()).toContain('exact framework owner');
  }
});
test('rejects nested package decoys and escaping symlinks, accepts owner symlink', () => {
  const nested = path.join(
    root,
    'verticals/catalog/node_modules/@modern-js/bff-effect',
  );
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.symlinkSync(owner, nested);
  expect(validate()).toBeUndefined();
  fs.unlinkSync(nested);
  fs.cpSync(owner, nested, { recursive: true });
  expect(validate()).toContain('exact framework owner');
  fs.rmSync(nested, { recursive: true });
  write(path.join(root, 'outside.js'), exportsSource);
  fs.rmSync(path.join(owner, 'index.js'));
  fs.symlinkSync(path.join(root, 'outside.js'), path.join(owner, 'index.js'));
  expect(validate()).toContain('exact framework owner');
});
test('consumer syntax and binding errors are violations; owner parser failures throw', () => {
  expect(validate(`${contract}\nexport const invalid = ;`)).toContain(
    'valid TypeScript syntax',
  );
  expect(validate(`${contract}\nconst Schema = {};`)).toContain(
    'valid TypeScript syntax',
  );
  expect(validate(`${contract}\ncatalogApi = foreign;`)).toContain(
    'valid TypeScript syntax',
  );
  write(path.join(owner, 'index.js'), 'export const = ;');
  expect(() => validate()).toThrow();
});
test('full and files phases both report a clean workspace', () => {
  expect(
    checkMicroVerticalApiBoundaries({ workspaceRoot: root }),
  ).toMatchObject({ diagnostics: [], toolErrors: [] });
  expect(
    checkMicroVerticalApiConsumerFiles({ workspaceRoot: root }),
  ).toMatchObject({ diagnostics: [], toolErrors: [] });
  write(
    path.join(root, 'verticals/catalog/api/index.ts'),
    entry.replace('export default defineEffectBff', 'defineEffectBff'),
  );
  expect(
    checkMicroVerticalApiBoundaries({ workspaceRoot: root }).diagnostics.join(
      '\n',
    ),
  ).toContain('verticals/catalog/api/index.ts');
  expect(
    checkMicroVerticalApiConsumerFiles({ workspaceRoot: root }).diagnostics,
  ).toEqual([]);
});
test('config errors and missing owners fail closed as tool failures', () => {
  write(
    path.join(root, 'topology/reference-topology.json'),
    JSON.stringify({
      shell: { id: 'shell', kind: 'shell', package: '@fixture/shell' },
      verticals: [],
    }),
  );
  expect(
    checkMicroVerticalApiConsumerFiles({ workspaceRoot: root }).toolErrors.join(
      '\n',
    ),
  ).toContain('explicit workspace path');
  write(
    path.join(root, 'topology/reference-topology.json'),
    JSON.stringify({
      shell: {
        id: 'shell',
        kind: 'shell',
        path: 'apps/shell',
        package: '@foreign/shell',
      },
      verticals: [],
    }),
  );
  expect(
    checkMicroVerticalApiConsumerFiles({ workspaceRoot: root }).toolErrors.join(
      '\n',
    ),
  ).toContain('package name must match topology');
  write(path.join(root, 'topology/reference-topology.json'), '{');
  expect(
    checkMicroVerticalApiBoundaries({ workspaceRoot: root }).toolErrors.length,
  ).toBe(1);
  expect(
    checkMicroVerticalApiBoundaries({
      workspaceRoot: root,
      configuredApps: [{ path: '../escape' }],
    }).toolErrors.length,
  ).toBe(1);
  fs.rmSync(owner, { recursive: true });
  expect(
    checkMicroVerticalApiBoundaries({
      workspaceRoot: root,
      baselinePackageDirectory: owner,
      configuredApps: [
        { path: 'verticals/catalog', kind: 'vertical', api: {} },
      ],
    }).toolErrors.join('\n'),
  ).toContain('verticals/catalog');
});
test('CLI distinguishes success, consumer and infrastructure failures', () => {
  expect(runMicroVerticalApiCheckCli(['--workspace-root', root])).toBe(0);
  write(file, contract.replace("ownerId: 'catalog'", "ownerId: 'foreign'"));
  expect(runMicroVerticalApiCheckCli(['--workspace-root', root])).toBe(1);
  write(path.join(root, 'topology/reference-topology.json'), '{');
  expect(runMicroVerticalApiCheckCli(['--workspace-root', root])).toBe(2);
  expect(runMicroVerticalApiCheckCli(['--workspace-root'])).toBe(2);
});
test('UI-only units reject API surfaces', () => {
  const result = checkMicroVerticalApiConsumerFiles({
    workspaceRoot: root,
    configuredApps: [
      {
        path: 'verticals/catalog',
        kind: 'vertical',
        surfaceProfile: 'ui-only',
      },
    ],
  });
  expect(result.toolErrors).toEqual([]);
  expect(result.diagnostics.join('\n')).toContain('unit has no API surface');
});

test('API-only units resolve a callable app-owned client from the public export', () => {
  const topologyPath = path.join(root, 'topology/reference-topology.json');
  const topology = JSON.parse(fs.readFileSync(topologyPath, 'utf8'));
  topology.verticals[0].surfaceProfile = 'api-only';
  write(topologyPath, JSON.stringify(topology));
  fs.rmSync(path.join(root, 'verticals/catalog/src'), { recursive: true });
  const clientPath = path.join(
    root,
    'verticals/catalog/shared/catalog-client.ts',
  );
  write(
    clientPath,
    `import { Effect, makeEffectHttpApiClient } from '@modern-js/bff-effect/effect-client'; import { catalogApi } from './api'; export const client = makeEffectHttpApiClient(catalogApi);`,
  );
  const packagePath = path.join(root, 'verticals/catalog/package.json');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  manifest.exports['./api/client'] = './shared/catalog-client.ts';
  write(packagePath, JSON.stringify(manifest));

  const check = () => checkMicroVerticalApiBoundaries({ workspaceRoot: root });
  expect(check()).toEqual({
    diagnostics: [],
    toolErrors: [],
    topologyFilesAnalyzed: 1,
  });

  manifest.exports['./api/client'] = './shared/missing-client.ts';
  write(packagePath, JSON.stringify(manifest));
  expect(check().diagnostics.join('\n')).toContain('invalid API client export');
  manifest.exports['./api/client'] = './shared/catalog-client.ts';
  write(packagePath, JSON.stringify(manifest));

  const authoredClient = path.join(
    root,
    'verticals/catalog/src/api/public-catalog.ts',
  );
  write(
    authoredClient,
    `import { Effect, makeEffectHttpApiClient } from '@modern-js/bff-effect/effect-client'; import { catalogApi } from '../../shared/api'; export const client = makeEffectHttpApiClient(catalogApi);`,
  );
  manifest.exports['./api/client'] = './src/api/public-catalog.ts';
  write(packagePath, JSON.stringify(manifest));
  expect(check().diagnostics).toEqual([]);

  manifest.exports['./api/client'] = undefined;
  write(packagePath, JSON.stringify(manifest));
  expect(check().diagnostics.join('\n')).toContain('invalid API client export');
  manifest.exports['./api/client'] = './src/api/public-catalog.ts';
  write(packagePath, JSON.stringify(manifest));

  manifest.exports['./api/client'] = '../foreign-client.ts';
  write(packagePath, JSON.stringify(manifest));
  expect(check().diagnostics.join('\n')).toContain('invalid API client export');
  manifest.exports['./api/client'] = './src/api/public-catalog.ts';
  write(packagePath, JSON.stringify(manifest));

  const foreignClient = path.join(root, 'verticals/foreign-client.ts');
  write(foreignClient, fs.readFileSync(authoredClient, 'utf8'));
  const symlinkClient = path.join(
    root,
    'verticals/catalog/src/api/foreign-client.ts',
  );
  fs.symlinkSync(foreignClient, symlinkClient);
  manifest.exports['./api/client'] = './src/api/foreign-client.ts';
  write(packagePath, JSON.stringify(manifest));
  expect(check().diagnostics.join('\n')).toContain('invalid API client export');
  manifest.exports['./api/client'] = './src/api/public-catalog.ts';
  write(packagePath, JSON.stringify(manifest));

  write(authoredClient, `export { client } from '../../../foreign-client.ts';`);
  expect(check().diagnostics.join('\n')).toContain(
    'must call makeEffectHttpApiClient(...)',
  );
  write(authoredClient, fs.readFileSync(foreignClient, 'utf8'));

  write(
    authoredClient,
    fs
      .readFileSync(authoredClient, 'utf8')
      .replace("'../../shared/api'", "'../../shared/rpc'"),
  );
  expect(check().diagnostics.join('\n')).toContain('must import');
});

test('legacy operation mappings are explicit and business-agnostic', () => {
  const source = contract.replace(
    'readiness: createMicroVerticalOperationContext',
    "reindex: createMicroVerticalOperationContext({method: 'POST', operationId: 'CatalogApi:catalog:reindex', routePath: '/catalog/reindex'}), readiness: createMicroVerticalOperationContext",
  );
  expect(validate(source)).toContain('operation map');
  expectation = {
    ...expectation,
    operationPaths: { 'CatalogApi:catalog:reindex': '/catalog/reindex' },
  };
  expect(validate(source)).toBeUndefined();
  expect(
    validate(
      source.replace("routePath: '/catalog/reindex'", "routePath: '/foreign'"),
    ),
  ).toContain('operation map');
});

test('explicit owner directory supports isolated installation but cannot override consumer identity', () => {
  const result = checkMicroVerticalApiBoundaries({
    workspaceRoot: root,
    baselinePackageDirectory: owner,
  });
  expect(result.toolErrors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
  const fake = path.join(root, 'fake-owner');
  fs.cpSync(owner, fake, { recursive: true });
  expect(
    checkMicroVerticalApiBoundaries({
      workspaceRoot: root,
      baselinePackageDirectory: fake,
    }).diagnostics.join('\n'),
  ).toContain('exact framework owner');
});
test('classifies RPC surfaces and validates native RPC topology', () => {
  write(
    path.join(root, 'verticals/catalog/package.json'),
    JSON.stringify({
      name: '@fixture/catalog',
      exports: {
        './api': './shared/rpc.ts',
        './api/rpc-client': './src/api/catalog-rpc-client.ts',
      },
    }),
  );
  fs.rmSync(file);
  fs.rmSync(path.join(root, 'verticals/catalog/src/api/catalog-client.ts'));
  write(
    path.join(root, 'verticals/catalog/shared/rpc.ts'),
    `import { Rpc, RpcGroup } from 'effect/unstable/rpc'; import { Schema } from '@modern-js/bff-effect/effect-client'; export const CatalogRpcGroup = RpcGroup.make(Rpc.make('ping', { success: Schema.Struct({}) }));`,
  );
  write(
    path.join(root, 'verticals/catalog/src/api/catalog-rpc-client.ts'),
    `import { Effect, makeEffectRpcClient } from '@modern-js/bff-effect/effect-client'; import { CatalogRpcGroup } from '../../shared/rpc.ts'; export const client = makeEffectRpcClient(CatalogRpcGroup);`,
  );
  write(
    path.join(root, 'verticals/catalog/api/index.ts'),
    `import { defineEffectBff, Effect, HttpApi, Layer } from '@modern-js/bff-effect/effect-edge'; import { CatalogRpcGroup } from '../shared/rpc.ts'; const CatalogRpcLayer = CatalogRpcGroup.toLayer(CatalogRpcGroup.of({ ping: () => undefined })); const apiRuntime = defineEffectBff({api: HttpApi.make('CatalogRpcApi'), layer: Layer.empty, rpc: { group: CatalogRpcGroup, layer: CatalogRpcLayer, path: '/rpc', serialization: 'json' }}); export default apiRuntime;`,
  );
  const result = checkMicroVerticalApiBoundaries({
    workspaceRoot: root,
    configuredApps: [
      { path: 'verticals/catalog', kind: 'vertical', api: { protocol: 'rpc' } },
    ],
  });
  expect(result).toEqual({
    diagnostics: [],
    toolErrors: [],
    topologyFilesAnalyzed: 1,
  });
  const packagePath = path.join(root, 'verticals/catalog/package.json');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  manifest.exports['./api/rpc-client'] = './shared/public-rpc-client.ts';
  write(packagePath, JSON.stringify(manifest));
  write(
    path.join(root, 'verticals/catalog/shared/public-rpc-client.ts'),
    `import { Effect, makeEffectRpcClient } from '@modern-js/bff-effect/effect-client'; import { CatalogRpcGroup } from './rpc.ts'; export const client = makeEffectRpcClient(CatalogRpcGroup);`,
  );
  expect(
    checkMicroVerticalApiBoundaries({
      workspaceRoot: root,
      configuredApps: [
        {
          path: 'verticals/catalog',
          kind: 'vertical',
          api: { protocol: 'rpc' },
        },
      ],
    }).diagnostics,
  ).toEqual([]);
  manifest.exports['./api/client'] = './src/api/catalog-client.ts';
  write(packagePath, JSON.stringify(manifest));
  expect(
    checkMicroVerticalApiConsumerFiles({
      workspaceRoot: root,
      configuredApps: [
        {
          path: 'verticals/catalog',
          kind: 'vertical',
          api: { protocol: 'rpc' },
        },
      ],
    }).diagnostics.join('\n'),
  ).toContain('forbidden opposite protocol client export');
});

test.each([
  'catalog',
  'checkout',
])('preserves actual generated %s public operation IDs without config copies', stem => {
  const service = {
    id: stem,
    api: { consumedBy: [], prefix: `/${stem}-api`, stem },
  };
  const generated = createSharedApi(service, { scope: 'fixture' });
  write(file, generated);
  const expected = {
    ...expectation,
    apiPrefix: `/${stem}-api`,
    basePath: `/${stem}-api/${stem}`,
    ownerId: stem,
    readinessPath: `/${stem}-api/${stem}/readiness`,
  };
  expect(
    microVerticalApiBaselineViolation(stem, file, expected),
  ).toBeUndefined();
  const operationId =
    stem === 'checkout'
      ? 'CheckoutApi:checkout:getCart'
      : 'CatalogApi:catalog:list';
  write(file, generated.replace(operationId, `${operationId}Wrong`));
  expect(microVerticalApiBaselineViolation(stem, file, expected)).toContain(
    'operation map',
  );
  write(file, generated.replace("method: 'POST'", "method: 'GET'"));
  expect(microVerticalApiBaselineViolation(stem, file, expected)).toContain(
    'operation map',
  );
  write(
    file,
    generated.replace(`routePath: '/${stem}'`, "routePath: '/foreign'"),
  );
  expect(microVerticalApiBaselineViolation(stem, file, expected)).toContain(
    'operation map',
  );
  if (stem === 'checkout') {
    write(
      file,
      generated.replace(
        "checkoutCartPath: '/checkout-api/checkout/cart'",
        "checkoutCartPath: '/checkout-api/checkout/cartoon'",
      ),
    );
    expect(microVerticalApiBaselineViolation(stem, file, expected)).toContain(
      'metadata',
    );
  }
});

test('infers non-cart operations only from reachable named native endpoint groups', () => {
  const source = contract
    .replace(
      'export const catalogApi =',
      "const searchEndpoint = HttpApiEndpoint.post('reindex', '/catalog/search/reindex', { success: Schema.String }); const searchGroup = HttpApiGroup.make('search').add(searchEndpoint); export const catalogApi =",
    )
    .replace(
      '.addHttpApi(catalogFoundationApi);',
      '.addHttpApi(catalogFoundationApi).add(searchGroup);',
    )
    .replace(
      'readiness: createMicroVerticalOperationContext',
      "reindex: createMicroVerticalOperationContext({method: 'POST', operationId: 'CatalogApi:search:reindex', routePath: '/catalog/search/reindex'}), readiness: createMicroVerticalOperationContext",
    )
    .replace(
      "ownerId: 'catalog'",
      "searchPath: '/catalog-api/catalog/search', ownerId: 'catalog'",
    );
  expect(validate(source)).toBeUndefined();
  for (const [before, after] of [
    ["method: 'POST'", "method: 'GET'"],
    [
      "routePath: '/catalog/search/reindex'",
      "routePath: '/catalog/search/missing'",
    ],
    ['CatalogApi:search:reindex', 'CatalogApi:catalog:reindex'],
    ["HttpApiEndpoint.post('reindex'", "HttpApiEndpoint.post('decoy'"],
    [
      "searchPath: '/catalog-api/catalog/search'",
      "searchPath: '/catalog-api/catalog/sear'",
    ],
    ['.add(searchGroup)', ''],
  ])
    expect(validate(source.replace(before, after))).toBeDefined();
  // A correct-looking but disconnected endpoint must not lend identity to a connected wrong verb.
  expect(
    validate(
      source.replace(
        "HttpApiEndpoint.post('reindex'",
        "HttpApiEndpoint.get('reindex'",
      ) +
        "\nconst disconnected = HttpApiEndpoint.post('reindex', '/catalog/search/reindex', {success: Schema.String});",
    ),
  ).toContain('operation map');
});
