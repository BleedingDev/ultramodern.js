import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import {
  type MicroVerticalApiBaselineExpectation,
  microVerticalApiBaselineViolation,
} from './microvertical-api-baseline';
import {
  baselinePackage,
  resolveBaselinePackageDirectory,
} from './microvertical-api-owner';
import { consumerParserPlugins } from './source-analysis';
import {
  createEffectApiImportResolver,
  strictEffectRuntimeTopologyViolation,
} from './strict-effect-runtime';

export type {
  MicroVerticalApiBaselineExpectation,
  MicroVerticalTopologyEntry,
} from './microvertical-api-baseline';
export {
  configuredMicroVerticalApiStem,
  microVerticalApiBaselineViolation,
} from './microvertical-api-baseline';

export interface MicroVerticalConfiguredApp {
  readonly path: string;
  readonly id?: string;
  readonly kind?: string;
  readonly package?: string;
  readonly surfaceProfile?: string;
  readonly deliveryUnitKind?: string;
  readonly api?: {
    readonly stem?: string;
    readonly prefix?: string;
    readonly protocol?: 'rest' | 'rpc';
    readonly operationPaths?: Readonly<Record<string, string>>;
    readonly additionalPaths?: Readonly<Record<string, string>>;
  };
}
export interface MicroVerticalApiCheckOptions {
  readonly workspaceRoot: string;
  readonly configuredApps?: readonly MicroVerticalConfiguredApp[];
  /** Explicit expected installed owner, useful for isolated/non-hoisted installations. */
  readonly baselinePackageDirectory?: string;
}
export interface MicroVerticalApiCheckResult {
  readonly diagnostics: readonly string[];
  readonly toolErrors: readonly string[];
  readonly topologyFilesAnalyzed: number;
}
const ignored = new Set([
  '.git',
  '.modern',
  '.modernjs',
  '.output',
  'coverage',
  'dist',
  'node_modules',
  'repos',
]);
const normalize = (file: string) =>
  file.split(path.sep).join('/').replace(/^\.\//u, '');
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const apiApp = (app: MicroVerticalConfiguredApp) =>
  app.kind === 'vertical' &&
  app.surfaceProfile !== 'ui-only' &&
  app.deliveryUnitKind !== 'horizontal-remote';

interface ReferenceTopologyApp {
  readonly id?: string;
  readonly kind?: string;
  readonly path?: string;
  readonly package?: string;
  readonly surfaceProfile?: string;
  readonly deliveryUnitKind?: string;
  readonly api?: {
    readonly stem?: string;
    readonly protocol?: 'rest' | 'rpc';
    readonly bff?: { readonly prefix?: string };
    readonly readiness?: { readonly endpoint?: string };
  };
}

interface ReferenceTopology {
  readonly shell?: ReferenceTopologyApp;
  readonly shells?: readonly ReferenceTopologyApp[];
  readonly verticals?: readonly ReferenceTopologyApp[];
}

function configuredApps(
  root: string,
  supplied?: readonly MicroVerticalConfiguredApp[],
): readonly MicroVerticalConfiguredApp[] {
  const topology: ReferenceTopology | undefined = supplied
    ? undefined
    : JSON.parse(
        fs.readFileSync(
          path.join(root, 'topology/reference-topology.json'),
          'utf8',
        ),
      );
  if (
    topology &&
    (!topology.shell ||
      !Array.isArray(topology.verticals) ||
      (topology.shells !== undefined && !Array.isArray(topology.shells)))
  )
    throw new Error(
      'topology/reference-topology.json: shell and verticals must be present',
    );
  const entries = topology?.shell
    ? [
        topology.shell,
        ...(topology.shells ?? []),
        ...(topology.verticals ?? []),
      ]
    : undefined;
  const source: readonly MicroVerticalConfiguredApp[] | undefined =
    supplied ??
    entries?.map(entry => {
      if (
        !entry ||
        typeof entry.path !== 'string' ||
        !entry.path ||
        path.isAbsolute(entry.path) ||
        entry.path.split(/[\\/]/u).includes('..')
      )
        throw new Error(
          'topology/reference-topology.json: each app must have an explicit workspace path',
        );
      const packageFile = path.join(root, entry.path, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
      if (
        typeof manifest.name !== 'string' ||
        !manifest.name ||
        (entry.package !== undefined && entry.package !== manifest.name)
      )
        throw new Error(
          `${entry.path}/package.json: package name must match topology`,
        );
      const api = entry.api;
      const stem =
        api?.stem ??
        api?.readiness?.endpoint?.match(
          /^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/readiness$/u,
        )?.[1];
      return {
        id: entry.id,
        kind: entry.kind,
        path: entry.path,
        package: manifest.name,
        surfaceProfile: entry.surfaceProfile,
        deliveryUnitKind: entry.deliveryUnitKind,
        ...(api === undefined
          ? {}
          : {
              api: {
                stem,
                prefix: api.bff?.prefix,
                protocol: api.protocol,
              },
            }),
      };
    });
  if (!Array.isArray(source))
    throw new Error(
      'topology/reference-topology.json: shell and verticals must describe apps',
    );
  const paths = new Set<string>();
  for (const app of source) {
    if (
      !app ||
      typeof app !== 'object' ||
      typeof app.path !== 'string' ||
      !app.path ||
      path.isAbsolute(app.path) ||
      app.path.split(/[\\/]/u).includes('..')
    )
      throw new Error(
        'topology/reference-topology.json: each app must have a relative workspace path',
      );
    const key = normalize(app.path);
    if (paths.has(key))
      throw new Error(
        `topology/reference-topology.json: duplicate app path ${key}`,
      );
    paths.add(key);
    for (const name of [
      'id',
      'kind',
      'package',
      'surfaceProfile',
      'deliveryUnitKind',
    ] as const)
      if (app[name] !== undefined && typeof app[name] !== 'string')
        throw new Error(`${key}: ${name} must be a string`);
    const allowedFields = {
      kind: ['shell', 'vertical'],
      surfaceProfile: ['full-stack', 'api-only', 'ui-only'],
      deliveryUnitKind: ['microvertical', 'horizontal-remote'],
    } as const;
    for (const field of Object.keys(
      allowedFields,
    ) as (keyof typeof allowedFields)[]) {
      const value = app[field];
      if (
        value !== undefined &&
        !(allowedFields[field] as readonly string[]).includes(value)
      )
        throw new Error(`${key}: invalid ${field}`);
    }
    if (app.api !== undefined) {
      if (!app.api || typeof app.api !== 'object' || Array.isArray(app.api))
        throw new Error(`${key}: api must be an object`);
      if (
        app.api.protocol !== undefined &&
        !['rest', 'rpc'].includes(app.api.protocol)
      )
        throw new Error(`${key}: api.protocol must be rest or rpc`);
      if (
        app.api.stem !== undefined &&
        (typeof app.api.stem !== 'string' ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(app.api.stem))
      )
        throw new Error(`${key}: invalid api.stem`);
      if (
        app.api.prefix !== undefined &&
        (typeof app.api.prefix !== 'string' ||
          !/^\/[^\s?#]*$/u.test(app.api.prefix))
      )
        throw new Error(`${key}: invalid api.prefix`);
      for (const field of ['additionalPaths', 'operationPaths'] as const) {
        const value = app.api[field];
        if (
          value !== undefined &&
          (!value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            Object.values(value).some(entry => typeof entry !== 'string'))
        )
          throw new Error(`${key}: api.${field} must map names to paths`);
      }
    }
  }
  return source;
}

function check(
  options: MicroVerticalApiCheckOptions,
  topology: boolean,
): MicroVerticalApiCheckResult {
  const diagnostics: string[] = [];
  const toolErrors: string[] = [];
  let topologyFilesAnalyzed = 0;
  const root = path.resolve(options.workspaceRoot);
  const absolute = (file: string) => path.join(root, file);
  const exists = (file: string) => fs.existsSync(absolute(file));
  const read = (file: string) => fs.readFileSync(absolute(file), 'utf8');
  const assert = (value: unknown, message: string) => {
    if (!value) diagnostics.push(message);
  };
  const noPath = (file: string, reason: string) =>
    assert(!exists(file), `${file}: ${reason}`);
  const guarded = (file: string, work: () => void) => {
    try {
      work();
    } catch (error) {
      toolErrors.push(`${file}: ${errorMessage(error)}`);
    }
  };
  try {
    const apps = configuredApps(root, options.configuredApps);
    const byPath = new Map(apps.map(app => [normalize(app.path), app]));
    const directories = (base: string) =>
      exists(base)
        ? fs
            .readdirSync(absolute(base), { withFileTypes: true })
            .filter(entry => entry.isDirectory() && !ignored.has(entry.name))
            .map(entry => `${base}/${entry.name}`)
        : [];
    const walk = (directory: string): string[] =>
      exists(directory)
        ? fs
            .readdirSync(absolute(directory), { withFileTypes: true })
            .flatMap(entry => {
              if (
                ignored.has(entry.name) ||
                (entry.name === 'dist-cloudflare' && byPath.has(directory))
              )
                return [];
              const file = `${directory}/${entry.name}`;
              return entry.isDirectory()
                ? walk(file)
                : entry.isFile()
                  ? [file]
                  : [];
            })
        : [];
    const parsed = new Map<string, t.File | undefined>();
    const parseFile = (file: string): t.File | undefined => {
      if (parsed.has(file)) return parsed.get(file);
      if (fs.statSync(absolute(file)).size > 1_000_000)
        throw new Error('consumer source exceeds 1 MB analysis budget');
      try {
        const ast = parse(read(file), {
          sourceType: 'module',
          sourceFilename: file,
          plugins: consumerParserPlugins(file),
        });
        parsed.set(file, ast);
        return ast;
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'BABEL_PARSER_SYNTAX_ERROR'
        ) {
          diagnostics.push(
            `${file}: invalid source syntax (${errorMessage(error)})`,
          );
          parsed.set(file, undefined);
          return undefined;
        }
        throw error;
      }
    };
    /** Repo-relative target of a relative specifier, with TS extension rules. */
    const resolveRelative = (
      fromFile: string,
      specifier: string,
    ): string | undefined => {
      if (!/^\.\.?\//u.test(specifier)) return undefined;
      const base = path.posix
        .join(path.posix.dirname(fromFile), specifier)
        .replace(/\.(?:[cm]?[jt]sx?)$/u, '');
      return [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ].find(candidate => exists(candidate));
    };
    /**
     * A module plus everything it pulls in through relative imports and
     * re-exports. A consumer may split one governed surface across sibling
     * modules; the surface is still the union of what they import and call.
     */
    const composedModules = (file: string): string[] => {
      const order: string[] = [];
      const seen = new Set<string>();
      const queue = [file];
      while (queue.length > 0 && order.length < 128) {
        const current = queue.shift()!;
        if (seen.has(current)) continue;
        seen.add(current);
        order.push(current);
        const ast = parseFile(current);
        if (!ast) continue;
        for (const statement of ast.program.body) {
          const source =
            (t.isImportDeclaration(statement) ||
              t.isExportNamedDeclaration(statement) ||
              t.isExportAllDeclaration(statement)) &&
            statement.source
              ? statement.source.value
              : undefined;
          const resolved =
            source === undefined ? undefined : resolveRelative(current, source);
          if (resolved !== undefined && !seen.has(resolved))
            queue.push(resolved);
        }
      }
      return order;
    };
    const moduleShape = (
      file: string,
      imports: readonly (readonly [string, readonly string[]])[],
      calls: readonly string[],
      patterns: readonly (readonly [RegExp, string])[] = [],
      defaultExport?: string,
      composed = false,
    ) => {
      if (!exists(file)) return;
      const ast = parseFile(file);
      if (!ast) return;
      // Source-shape rules (`patterns`, `defaultExport`) stay on this file;
      // only imports and calls may be satisfied by a composed module.
      const shapeFiles = composed ? composedModules(file) : [file];
      const body = shapeFiles.flatMap(
        shapeFile => parseFile(shapeFile)?.program.body ?? [],
      );
      for (const [specifier, names] of imports) {
        // A relative specifier names a file, not a string: `../../shared/api`
        // and `../../shared/api.ts` are the same module, and a sibling reaches
        // it by its own path.
        const target = resolveRelative(file, specifier);
        const matchesSpecifier = (item: t.ImportDeclaration, from: string) =>
          target === undefined
            ? item.source.value === specifier
            : resolveRelative(from, item.source.value) === target;
        const imported = shapeFiles.flatMap(shapeFile =>
          (parseFile(shapeFile)?.program.body ?? []).filter(
            item =>
              t.isImportDeclaration(item) &&
              item.importKind !== 'type' &&
              matchesSpecifier(item, shapeFile),
          ),
        );
        assert(imported.length, `${file}: must import from ${specifier}`);
        for (const name of names)
          assert(
            imported.some(
              item =>
                t.isImportDeclaration(item) &&
                item.specifiers.some(
                  value =>
                    t.isImportSpecifier(value) &&
                    value.importKind !== 'type' &&
                    t.isIdentifier(value.imported, { name }) &&
                    t.isIdentifier(value.local, { name }),
                ),
            ),
            `${file}: must import ${name} from ${specifier}`,
          );
      }
      const found = new Set<string>();
      const collectCalls = (node: t.Node) => {
        if (!t.isCallExpression(node)) return;
        if (t.isIdentifier(node.callee)) found.add(node.callee.name);
        if (
          t.isMemberExpression(node.callee) &&
          !node.callee.computed &&
          t.isIdentifier(node.callee.object) &&
          t.isIdentifier(node.callee.property)
        )
          found.add(`${node.callee.object.name}.${node.callee.property.name}`);
      };
      for (const shapeFile of shapeFiles) {
        const shapeAst = parseFile(shapeFile);
        if (shapeAst) t.traverseFast(shapeAst, collectCalls);
      }
      for (const call of calls)
        assert(found.has(call), `${file}: must call ${call}(...)`);
      const source = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, '');
      for (const [pattern, reason] of patterns)
        assert(pattern.test(source), `${file}: ${reason}`);
      if (defaultExport)
        assert(
          body.some(
            item =>
              t.isExportDefaultDeclaration(item) &&
              t.isIdentifier(item.declaration, { name: defaultExport }),
          ),
          `${file}: must default-export ${defaultExport}`,
        );
    };
    const effect = '@modern-js/bff-effect/effect-client';
    const appDirectories = [
      ...new Set([
        ...directories('apps'),
        ...directories('verticals'),
        ...byPath.keys(),
      ]),
    ];
    for (const appPath of appDirectories)
      for (const suffix of [
        'api/effect',
        'api/lambda',
        'shared/effect',
        'src/effect',
      ])
        noPath(
          `${appPath}/${suffix}`,
          'legacy nested Effect paths are forbidden; use api/index.ts, shared/api.ts and src/api/*',
        );
    const sourceFiles = [
      ...new Set(
        ['apps', 'verticals', 'packages', ...byPath.keys()].flatMap(walk),
      ),
    ].filter(file => /\.(?:[cm]?[jt]sx?|json|md)$/u.test(file));
    for (const file of sourceFiles)
      guarded(file, () => {
        const source = read(file);
        const patterns: [RegExp, string][] = [
          [
            /@modern-js\/plugin-bff\/(?:server|hono-server)(?![\w-])/u,
            'use Effect HttpApi instead of Hono helpers',
          ],
          [
            /\bruntimeFramework\s*(?::|=)\s*['"]hono['"]/u,
            'must use the Effect runtime',
          ],
          [
            /\bstrictEffectApproach\s*(?::|=)\s*false\b/u,
            'must keep strictEffectApproach enabled',
          ],
        ];
        if (/\/api\//u.test(file))
          patterns.push(
            [
              /\bnew\s+Response\s*\(|\bResponse\.json\s*\(/u,
              'must not hand-build Response objects',
            ],
            [
              /\b(?:request|req)\.(?:json|text|formData|arrayBuffer)\s*\(/u,
              'must use endpoint payload/query/params schemas instead of parsing request bodies',
            ],
            [
              /\bexport\s+const\s+handler\b|\bexport\s+default\s+async\b/u,
              'must not export raw request handlers',
            ],
            [
              /\bcreateHandler\s*[:=]\s*(?!defineEffectBff\b)/u,
              'must use defineEffectBff instead of unbranded handler factories',
            ],
            [
              /\bSchema\.(?:UnknownFromJsonString|Unknown|Any)\b/u,
              'must use concrete request, response and error schemas',
            ],
          );
        for (const [pattern, reason] of patterns)
          assert(!pattern.test(source), `${file}: ${reason}`);
        if (topology && /\/api\/index\.ts$/u.test(file)) {
          topologyFilesAnalyzed += 1;
          const violation = strictEffectRuntimeTopologyViolation(
            source,
            createEffectApiImportResolver(absolute(file)),
          );
          if (violation) diagnostics.push(`${file}: ${violation}`);
        }
      });
    let owner: string | undefined;
    for (const appPath of appDirectories)
      guarded(appPath, () => {
        const app = byPath.get(appPath);
        const emits = app
          ? apiApp(app) || (app.kind !== 'vertical' && app.api !== undefined)
          : appPath.startsWith('verticals/') ||
            exists(`${appPath}/api/index.ts`) ||
            exists(`${appPath}/shared/api.ts`);
        if (!emits) {
          if (app?.kind === 'vertical') {
            assert(
              app.api === undefined,
              `${appPath}: UI/horizontal unit must not declare an API`,
            );
            for (const suffix of [
              'api/index.ts',
              'api/effect-api.ts',
              'shared/api.ts',
              'shared/rpc.ts',
              'src/api',
            ])
              noPath(`${appPath}/${suffix}`, 'unit has no API surface');
          }
          return;
        }
        if (app?.kind === 'vertical')
          assert(
            app.api !== undefined,
            `${appPath}: vertical must declare its Effect API in topology/reference-topology.json`,
          );
        const stem = app?.api?.stem ?? path.posix.basename(appPath);
        const rpc = app?.api?.protocol === 'rpc';
        const contract = `${appPath}/shared/${rpc ? 'rpc' : 'api'}.ts`;
        const client = `${appPath}/src/api/${stem}-${rpc ? 'rpc-client' : 'client'}.ts`;
        const entry = `${appPath}/api/index.ts`;
        for (const file of [entry, contract, client])
          assert(exists(file), `${file}: required API surface is missing`);
        noPath(
          `${appPath}/shared/${rpc ? 'api' : 'rpc'}.ts`,
          `must not emit a ${rpc ? 'REST' : 'RPC'} contract`,
        );
        noPath(
          `${appPath}/src/api/${stem}-${rpc ? 'client' : 'rpc-client'}.ts`,
          `must not emit a ${rpc ? 'REST' : 'RPC'} client`,
        );
        if (rpc) {
          moduleShape(
            entry,
            [
              [
                '@modern-js/bff-effect/effect-edge',
                ['defineEffectBff', 'Effect', 'HttpApi', 'Layer'],
              ],
              ['../shared/rpc.ts', []],
            ],
            ['defineEffectBff', 'HttpApi.make'],
            [
              [
                /\bconst\s+\w+RpcLayer\s*=\s*\w+RpcGroup\s*\.\s*toLayer\s*\(/u,
                'must implement RpcGroup.toLayer(...)',
              ],
              [
                /\brpc\s*:\s*\{[\s\S]*?\bgroup\s*:[\s\S]*?\blayer\s*:[\s\S]*?\bpath\s*:[\s\S]*?\bserialization\s*:/u,
                'must register RPC group, layer, path and serialization',
              ],
            ],
            'apiRuntime',
          );
          moduleShape(
            contract,
            [
              ['effect/unstable/rpc', ['Rpc', 'RpcGroup']],
              [effect, ['Schema']],
            ],
            ['RpcGroup.make', 'Rpc.make', 'Schema.Struct'],
          );
        } else if (exists(contract)) {
          owner ??=
            options.baselinePackageDirectory ??
            resolveBaselinePackageDirectory(path.join(root, 'package.json'));
          const apiPrefix = app?.api?.prefix ?? `/${stem}-api`;
          const basePath = `${apiPrefix}/${stem}`;
          const expectation: MicroVerticalApiBaselineExpectation = {
            operationPaths: app?.api?.operationPaths,
            additionalPaths: app?.api?.additionalPaths ?? {},
            apiPrefix,
            basePath,
            effectClientPackage: effect,
            ownerId: app?.id ?? path.posix.basename(appPath),
            readinessPath: `${basePath}/readiness`,
            baselinePackage,
            baselinePackageDirectory: owner,
          };
          const violation = microVerticalApiBaselineViolation(
            stem,
            absolute(contract),
            expectation,
          );
          if (violation) diagnostics.push(`${contract}: ${violation}`);
        }
        moduleShape(
          client,
          [
            [
              effect,
              [
                'Effect',
                rpc ? 'makeEffectRpcClient' : 'makeEffectHttpApiClient',
              ],
            ],
            [rpc ? '../../shared/rpc.ts' : '../../shared/api', []],
          ],
          [rpc ? 'makeEffectRpcClient' : 'makeEffectHttpApiClient'],
          [],
          undefined,
          true,
        );
        moduleShape(
          `${appPath}/api/effect-api.ts`,
          [],
          [],
          [
            [
              /\bbackendFederationContract\b/u,
              'must export backendFederationContract metadata',
            ],
            [
              /role:\s*['"]microvertical-server['"]/u,
              'must describe the MicroVertical server role',
            ],
            [
              /strictEffectApproach:\s*true/u,
              'must preserve strict Effect backend execution',
            ],
            [
              /contractVersion:\s*['"]microvertical-server-effect-v1['"]/u,
              'must preserve the server contract version',
            ],
            [
              /export\s*\{\s*default\s*,\s*default\s+as\s+runtime\s*\}\s+from\s+['"]\.\/index\.ts['"]/u,
              'must re-export the runtime as default and runtime',
            ],
            [
              /^(?![\s\S]*\b(request|handler)\s*:\s*async\s*\()/u,
              'must not expose raw request handlers',
            ],
          ],
        );
        moduleShape(
          `${appPath}/modern.config.ts`,
          [],
          [],
          [
            [
              /runtimeFramework:\s*['"]effect['"]/u,
              'must use bff.runtimeFramework: effect',
            ],
            [/entry:\s*['"]\.\/api\/index['"]/u, 'must use ./api/index'],
            [
              /strictEffectApproach:\s*true/u,
              'must enable strictEffectApproach',
            ],
          ],
        );
        const packageFile = `${appPath}/package.json`;
        if (exists(packageFile)) {
          const manifest = JSON.parse(read(packageFile));
          assert(
            manifest.exports?.['./api'] ===
              `./shared/${rpc ? 'rpc' : 'api'}.ts`,
            `${packageFile}: invalid ./api export`,
          );
          assert(
            manifest.exports?.[`./api/${rpc ? 'rpc-client' : 'client'}`] ===
              `./src/api/${stem}-${rpc ? 'rpc-client' : 'client'}.ts`,
            `${packageFile}: invalid API client export`,
          );
          assert(
            manifest.exports?.[`./api/${rpc ? 'client' : 'rpc-client'}`] ===
              undefined,
            `${packageFile}: forbidden opposite protocol client export`,
          );
        }
      });
    const shell = 'apps/shell-super-app';
    const verticals = apps.filter(
      app => app.path.startsWith('verticals/') && apiApp(app),
    );
    if (exists(shell) && verticals.length) {
      const file = `${shell}/src/api/vertical-clients.ts`;
      assert(exists(file), `${file}: must aggregate vertical API clients`);
      if (exists(file))
        guarded(file, () => {
          const ast = parseFile(file);
          for (const app of verticals) {
            const specifier = `${app.package}/api/${app.api?.protocol === 'rpc' ? 'rpc-client' : 'client'}`;
            assert(
              ast?.program.body.some(
                item =>
                  t.isExportNamedDeclaration(item) &&
                  item.source?.value === specifier,
              ),
              `${file}: must re-export ${specifier}`,
            );
          }
        });
    }
    if (exists(`${shell}/package.json`))
      guarded(`${shell}/package.json`, () =>
        assert(
          JSON.parse(read(`${shell}/package.json`)).exports?.[
            './api/clients'
          ] === './src/api/vertical-clients.ts',
          `${shell}/package.json: must export ./api/clients`,
        ),
      );
    if (exists('topology/reference-topology.json'))
      guarded('topology/reference-topology.json', () => {
        for (const vertical of JSON.parse(
          read('topology/reference-topology.json'),
        ).verticals ?? []) {
          if (vertical.api?.runtime === 'effect') {
            assert(
              vertical.api.bff?.strictEffectApproach === true,
              `${vertical.id}: topology must mark strictEffectApproach true`,
            );
            assert(
              typeof vertical.api.serverEntry === 'string' &&
                vertical.api.serverEntry.endsWith('/api/index.ts'),
              `${vertical.id}: topology must use api/index.ts`,
            );
          }
          assert(
            !vertical.api?.effect,
            `${vertical.id}: topology must describe API directly, not api.effect`,
          );
        }
      });
  } catch (error) {
    toolErrors.push(errorMessage(error));
  }
  return { diagnostics, toolErrors, topologyFilesAnalyzed };
}

/** Full standalone check: source runtime topology is analyzed once per entry. */
export const checkMicroVerticalApiBoundaries = (
  options: MicroVerticalApiCheckOptions,
): MicroVerticalApiCheckResult => check(options, true);
/** Consumer files/export/owner checks; caller must separately run runtime topology analysis. */
export const checkMicroVerticalApiConsumerFiles = (
  options: MicroVerticalApiCheckOptions,
): MicroVerticalApiCheckResult => check(options, false);
