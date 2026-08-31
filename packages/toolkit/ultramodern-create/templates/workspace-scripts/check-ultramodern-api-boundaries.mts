#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.env.ULTRAMODERN_WORKSPACE_ROOT ?? process.cwd();
const failures = [];

const ignoredDirectories = new Set([
  '.git',
  '.modern',
  '.output',
  'coverage',
  'dist',
  'node_modules',
  'repos',
]);

function normalize(filePath) {
  return filePath.split(path.sep).join('/');
}

function relative(filePath) {
  return normalize(path.relative(workspaceRoot, filePath));
}

function exists(relativePath) {
  return fs.existsSync(path.join(workspaceRoot, relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf8');
}

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function listFiles(startDirectory) {
  const absoluteStart = path.join(workspaceRoot, startDirectory);
  if (!fs.existsSync(absoluteStart)) {
    return [];
  }

  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }

      const absoluteEntry = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absoluteEntry);
        continue;
      }

      if (entry.isFile()) {
        files.push(relative(absoluteEntry));
      }
    }
  };

  visit(absoluteStart);
  return files;
}

function listDirectories(startDirectory) {
  const absoluteStart = path.join(workspaceRoot, startDirectory);
  if (!fs.existsSync(absoluteStart)) {
    return [];
  }

  return fs
    .readdirSync(absoluteStart, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !ignoredDirectories.has(entry.name))
    .map(entry => path.posix.join(startDirectory, entry.name));
}

function assertNoPath(relativePath, message) {
  if (exists(relativePath)) {
    fail(message);
  }
}

function assertNotContains(relativePath, content, pattern, message) {
  assert(!pattern.test(content), `${relativePath}: ${message}`);
}

function stripComments(source, { maskStrings = false } = {}) {
  let output = '';
  let state = 'code';

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (state === 'line-comment') {
      if (current === '\n') {
        state = 'code';
        output += current;
      } else {
        output += ' ';
      }
      continue;
    }

    if (state === 'block-comment') {
      if (current === '*' && next === '/') {
        output += '  ';
        index += 1;
        state = 'code';
      } else {
        output += current === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (state !== 'code') {
      output += maskStrings ? (current === '\n' ? '\n' : ' ') : current;
      if (current === '\\') {
        output += maskStrings
          ? next === '\n'
            ? '\n'
            : ' '
          : (next ?? '');
        index += 1;
      } else if (
        (state === 'single-quote' && current === "'") ||
        (state === 'double-quote' && current === '"') ||
        (state === 'template' && current === '`')
      ) {
        state = 'code';
      }
      continue;
    }

    if (current === '/' && next === '/') {
      output += '  ';
      index += 1;
      state = 'line-comment';
    } else if (current === '/' && next === '*') {
      output += '  ';
      index += 1;
      state = 'block-comment';
    } else {
      if (current === "'") {
        output += maskStrings ? ' ' : current;
        state = 'single-quote';
      } else if (current === '"') {
        output += maskStrings ? ' ' : current;
        state = 'double-quote';
      } else if (current === '`') {
        output += maskStrings ? ' ' : current;
        state = 'template';
      } else {
        output += current;
      }
    }
  }

  return output;
}

function analyzeModule(relativePath) {
  const content = readText(relativePath);
  const source = stripComments(content);
  const code = stripComments(content, { maskStrings: true });
  const imports = new Map();
  const reexports = new Set();
  const importPattern =
    /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+(['"])([^'"]+)\2\s*;?/gu;

  for (const match of source.matchAll(importPattern)) {
    if (code.slice(match.index, match.index + 6) !== 'import') {
      continue;
    }
    const bindingClause = match[1];
    const namedBindings = bindingClause.match(/\{([\s\S]*?)\}/u)?.[1] ?? '';
    const names = new Set(
      namedBindings
        .split(',')
        .map(binding => binding.trim().split(/\s+as\s+/u)[1] ?? binding.trim())
        .filter(Boolean),
    );
    const existing = imports.get(match[3]) ?? new Set();
    for (const name of names) {
      existing.add(name);
    }
    imports.set(match[3], existing);
  }

  const reexportPattern =
    /\bexport\s*\{[\s\S]*?\}\s*from\s*(['"])([^'"]+)\1\s*;?/gu;
  for (const match of source.matchAll(reexportPattern)) {
    if (code.slice(match.index, match.index + 6) === 'export') {
      reexports.add(match[2]);
    }
  }

  return { imports, reexports, source: code };
}

function assertNamedImports(relativePath, analysis, moduleName, names) {
  assert(
    analysis.imports.has(moduleName),
    `${relativePath}: must import from ${moduleName}.`,
  );
  const importedNames = analysis.imports.get(moduleName) ?? new Set();
  for (const name of names) {
    assert(
      importedNames.has(name),
      `${relativePath}: must import ${name} from ${moduleName}.`,
    );
  }
}

function assertCallExpression(relativePath, analysis, callee, message) {
  const escapedCallee = callee.replaceAll('.', '\\s*\\.\\s*');
  assert(
    new RegExp(`\\b${escapedCallee}\\s*\\(`, 'u').test(analysis.source),
    `${relativePath}: ${message}`,
  );
}

function assertDefaultExport(relativePath, analysis, identifier) {
  assert(
    new RegExp(`\\bexport\\s+default\\s+${identifier}\\s*;`, 'u').test(
      analysis.source,
    ),
    `${relativePath}: must default-export ${identifier}.`,
  );
}

function assertModuleShape(
  relativePath,
  { imports = [], calls = [], patterns = [], defaultExport },
) {
  if (!exists(relativePath)) {
    return;
  }

  const analysis = analyzeModule(relativePath);
  for (const [moduleName, names] of imports) {
    assertNamedImports(relativePath, analysis, moduleName, names);
  }
  for (const [callee, message] of calls) {
    assertCallExpression(relativePath, analysis, callee, message);
  }
  for (const [pattern, message] of patterns) {
    assert(pattern.test(analysis.source), `${relativePath}: ${message}`);
  }
  if (defaultExport !== undefined) {
    assertDefaultExport(relativePath, analysis, defaultExport);
  }
}

function readConfiguredApps() {
  const configPath = '.modernjs/ultramodern.json';
  if (!exists(configPath)) {
    fail(`${configPath} is required to classify generated API surfaces.`);
    return [];
  }

  try {
    const config = JSON.parse(readText(configPath));
    if (!Array.isArray(config.topology?.apps)) {
      fail(`${configPath}: topology.apps must be an array.`);
      return [];
    }
    return config.topology.apps;
  } catch (error) {
    fail(
      `${configPath}: must contain valid JSON (${error instanceof Error ? error.message : String(error)}).`,
    );
    return [];
  }
}

const configuredApps = readConfiguredApps();
const configuredAppsByPath = new Map(
  configuredApps
    .filter(app => typeof app?.path === 'string')
    .map(app => [normalize(app.path).replace(/^\.\//u, ''), app]),
);

function configuredApp(appPath) {
  return configuredAppsByPath.get(normalize(appPath).replace(/^\.\//u, ''));
}

function appShouldEmitApi(app) {
  return (
    app?.kind === 'vertical' &&
    app.surfaceProfile !== 'ui-only' &&
    app.deliveryUnitKind !== 'horizontal-remote'
  );
}

function assertNoApiSurface(appPath, profile) {
  for (const relativePath of [
    `${appPath}/api/index.ts`,
    `${appPath}/api/effect-api.ts`,
    `${appPath}/shared/api.ts`,
    `${appPath}/shared/rpc.ts`,
    `${appPath}/src/api`,
  ]) {
    assertNoPath(
      relativePath,
      `Unexpected ${relativePath} for a ${profile} unit with no API surface.`,
    );
  }
}

for (const forbiddenPath of [
  ...listDirectories('apps').flatMap(appPath => [
    `${appPath}/api/effect`,
    `${appPath}/api/lambda`,
    `${appPath}/shared/effect`,
    `${appPath}/src/effect`,
  ]),
  ...listDirectories('verticals').flatMap(verticalPath => [
    `${verticalPath}/api/effect`,
    `${verticalPath}/api/lambda`,
    `${verticalPath}/shared/effect`,
    `${verticalPath}/src/effect`,
  ]),
]) {
  assertNoPath(
    forbiddenPath,
    `${forbiddenPath} is forbidden in UltraModern strictEffectApproach workspaces; use api/index.ts, shared/api.ts and src/api/* instead.`,
  );
}

const generatedFiles = [
  ...listFiles('apps'),
  ...listFiles('verticals'),
  ...listFiles('packages'),
];
const textFiles = generatedFiles.filter(file =>
  /\.(?:[cm]?[jt]sx?|json|md|mjs|mts|cts)$/u.test(file),
);

for (const file of textFiles) {
  const content = readText(file);

  if (/\/api\//u.test(file)) {
    assertNotContains(
      file,
      content,
      /\bnew\s+Response\s*\(|\bResponse\.json\s*\(/u,
      'API modules must not hand-build Response objects; model endpoints through Effect HttpApi and schemas.',
    );
    assertNotContains(
      file,
      content,
      /\b(?:request|req)\.(?:json|text|formData|arrayBuffer)\s*\(/u,
      'API modules must not manually parse request bodies; use HttpApiEndpoint payload/query/params schemas.',
    );
    assertNotContains(
      file,
      content,
      /\bexport\s+const\s+handler\b|\bexport\s+default\s+async\b/u,
      'API modules must not export raw request handlers; export defineEffectBff(...) from api/index.ts.',
    );
    assertNotContains(
      file,
      content,
      /\bcreateHandler\s*[:=]\s*(?!defineEffectBff\b)/u,
      'API modules must not define unbranded handler factories; use defineEffectBff(...).',
    );
    assertNotContains(
      file,
      content,
      /\bSchema\.(?:UnknownFromJsonString|Unknown|Any)\b/u,
      'API modules must use concrete request, response and error schemas; Schema.UnknownFromJsonString, Schema.Unknown and Schema.Any are forbidden in UltraModern API code.',
    );
  }

  assertNotContains(
    file,
    content,
    /@modern-js\/plugin-bff\/hono-server/u,
    'UltraModern API workspaces must not import Hono server helpers; use @modern-js/plugin-bff/effect-edge and HttpApi.',
  );
  assertNotContains(
    file,
    content,
    /\bruntimeFramework\s*(?::|=)\s*['"]hono['"]/u,
    'Generated UltraModern API apps must use the Effect runtime.',
  );
  assertNotContains(
    file,
    content,
    /\bstrictEffectApproach\s*(?::|=)\s*false\b/u,
    'Generated UltraModern API apps must keep strictEffectApproach enabled.',
  );
}

const verticalDirectories = listDirectories('verticals');
const shellClient = 'apps/shell-super-app/src/api/vertical-clients.ts';
const apiVerticalDirectories = verticalDirectories.filter(
  verticalPath => appShouldEmitApi(configuredApp(verticalPath)),
);
if (exists('apps/shell-super-app') && apiVerticalDirectories.length > 0) {
  assert(exists(shellClient), `${shellClient} must aggregate vertical API clients.`);
  if (exists(shellClient)) {
    const shellApi = analyzeModule(shellClient);
    for (const verticalPath of apiVerticalDirectories) {
      const vertical = configuredApp(verticalPath);
      const clientExport = `${vertical.package}/api/${
        (vertical.api?.protocol ?? 'rest') === 'rpc' ? 'rpc-client' : 'client'
      }`;
      assert(
        shellApi.reexports.has(clientExport),
        `${shellClient} must re-export ${clientExport}.`,
      );
    }
  }
}

function assertBackendEffectSurface(appPath) {
  const relativePath = `${appPath}/api/effect-api.ts`;
  if (!exists(relativePath)) {
    return;
  }

  const content = stripComments(readText(relativePath));
  for (const [pattern, message] of [
    [/\bbackendFederationContract\b/u, 'must export backendFederationContract metadata.'],
    [/role:\s*['"]microvertical-server['"]/u, 'must describe the MicroVertical server role.'],
    [/strictEffectApproach:\s*true/u, 'must preserve strict Effect backend execution.'],
    [
      /contractVersion:\s*['"]microvertical-server-effect-v1['"]/u,
      'must preserve the MicroVertical server contract version.',
    ],
    [
      /export\s*\{\s*default\s*,\s*default\s+as\s+runtime\s*\}\s+from\s+['"]\.\/index\.ts['"]/u,
      'must re-export the generated Effect BFF runtime as both default and runtime.',
    ],
  ]) {
    assert(pattern.test(content), `${relativePath}: ${message}`);
  }
  assert(
    !/\b(request|handler)\s*:\s*async\s*\(/u.test(content),
    `${relativePath}: must not expose raw request handlers.`,
  );
}

function assertEffectConfig(appPath) {
  const relativePath = `${appPath}/modern.config.ts`;
  if (!exists(relativePath)) {
    return;
  }

  const content = stripComments(readText(relativePath));
  for (const [pattern, message] of [
    [/runtimeFramework:\s*['"]effect['"]/u, 'must use bff.runtimeFramework: effect.'],
    [/entry:\s*['"]\.\/api\/index['"]/u, 'must point bff.effect.entry at ./api/index.'],
    [/strictEffectApproach:\s*true/u, 'must enable strictEffectApproach explicitly.'],
  ]) {
    assert(pattern.test(content), `${relativePath}: ${message}`);
  }
}

function assertRpcSurface(appPath, app) {
  const stem = app?.api?.stem ?? path.posix.basename(appPath);
  const apiEntry = `${appPath}/api/index.ts`;
  const sharedRpc = `${appPath}/shared/rpc.ts`;
  const rpcClient = `${appPath}/src/api/${stem}-rpc-client.ts`;
  const restContract = `${appPath}/shared/api.ts`;
  const restClient = `${appPath}/src/api/${stem}-client.ts`;
  const packageJsonPath = `${appPath}/package.json`;

  assert(exists(apiEntry), `${apiEntry} is required.`);
  assert(exists(sharedRpc), `${sharedRpc} is required.`);
  assert(exists(rpcClient), `Missing ${rpcClient}.`);
  assertNoPath(restContract, `${appPath} RPC unit must not emit ${restContract}.`);
  assertNoPath(restClient, `${appPath} RPC unit must not emit the REST API client.`);

  assertModuleShape(apiEntry, {
    imports: [
      [
        '@modern-js/plugin-bff/effect-edge',
        ['defineEffectBff', 'Effect', 'HttpApi', 'Layer'],
      ],
      ['../shared/rpc.ts', []],
    ],
    calls: [
      [
        'defineEffectBff',
        'must create the strict Effect runtime through defineEffectBff(...).',
      ],
      [
        'HttpApi.make',
        'must create the empty HttpApi transport marker for RPC discovery.',
      ],
    ],
    patterns: [
      [
        /\bconst\s+\w+RpcLayer\s*=\s*\w+RpcGroup\s*\.\s*toLayer\s*\(/u,
        'must implement the RPC group through RpcGroup.toLayer(...).',
      ],
      [
        /\brpc\s*:\s*\{[\s\S]*?\bgroup\s*:[\s\S]*?\blayer\s*:[\s\S]*?\bpath\s*:[\s\S]*?\bserialization\s*:/u,
        'defineEffectBff(...) must register the RPC group, layer, path and JSON serialization.',
      ],
    ],
    defaultExport: 'apiRuntime',
  });
  assertModuleShape(sharedRpc, {
    imports: [
      ['effect/unstable/rpc', ['Rpc', 'RpcGroup']],
      ['@modern-js/plugin-bff/effect-client', ['Schema']],
    ],
    calls: [
      ['RpcGroup.make', 'must declare the RPC group through RpcGroup.make(...).'],
      ['Rpc.make', 'must declare callable operations through Rpc.make(...).'],
      [
        'Schema.Struct',
        'must use concrete Schema.Struct request and response shapes.',
      ],
    ],
  });
  assertModuleShape(rpcClient, {
    imports: [
      [
        '@modern-js/plugin-bff/effect-client',
        ['Effect', 'makeEffectRpcClient'],
      ],
      ['../../shared/rpc.ts', []],
    ],
    calls: [
      [
        'makeEffectRpcClient',
        'must create the client from the generated RpcGroup contract.',
      ],
    ],
  });

  assertBackendEffectSurface(appPath);
  assertEffectConfig(appPath);

  if (exists(packageJsonPath)) {
    const packageJson = JSON.parse(readText(packageJsonPath));
    assert(
      packageJson.exports?.['./api'] === './shared/rpc.ts',
      `${packageJsonPath}: RPC package must export ./api from shared/rpc.ts.`,
    );
    assert(
      packageJson.exports?.['./api/rpc-client'] ===
        `./src/api/${stem}-rpc-client.ts`,
      `${packageJsonPath}: RPC package must export ./api/rpc-client from ${stem}-rpc-client.ts.`,
    );
    assert(
      packageJson.exports?.['./api/client'] === undefined,
      `${packageJsonPath}: RPC package must not expose the REST ./api/client export.`,
    );
  }
}

function assertApiSurface(appPath, app) {
  if ((app?.api?.protocol ?? 'rest') === 'rpc') {
    assertRpcSurface(appPath, app);
    return;
  }

  const apiEntry = `${appPath}/api/index.ts`;
  const sharedApi = `${appPath}/shared/api.ts`;
  const srcApiDirectory = `${appPath}/src/api`;
  const stem = app?.api?.stem ?? path.posix.basename(appPath);
  const clientPath = `${srcApiDirectory}/${stem}-client.ts`;
  const rpcContract = `${appPath}/shared/rpc.ts`;
  const rpcClient = `${srcApiDirectory}/${stem}-rpc-client.ts`;
  const packageJsonPath = `${appPath}/package.json`;

  assert(exists(apiEntry), `${apiEntry} is required.`);
  assert(exists(sharedApi), `${sharedApi} is required.`);
  assert(exists(srcApiDirectory), `${srcApiDirectory} is required.`);
  assert(exists(clientPath), `${clientPath} is required.`);
  assertNoPath(rpcContract, `${appPath} REST unit must not emit ${rpcContract}.`);
  assertNoPath(rpcClient, `${appPath} REST unit must not emit the RPC API client.`);

  assertModuleShape(apiEntry, {
    imports: [
      [
        '@modern-js/plugin-bff/effect-edge',
        ['defineEffectBff', 'Effect', 'HttpApiBuilder', 'Layer'],
      ],
      ['../shared/api.ts', []],
    ],
    calls: [
      [
        'defineEffectBff',
        'must create the strict Effect runtime through defineEffectBff(...).',
      ],
      [
        'HttpApiBuilder.group',
        'must implement handlers through HttpApiBuilder.group(...).',
      ],
      [
        'HttpApiBuilder.layer',
        'must assemble the HttpApi runtime through HttpApiBuilder.layer(...).',
      ],
      [
        'Layer.provide',
        'must compose the handler group through Effect Layer.provide(...).',
      ],
    ],
    defaultExport: 'apiRuntime',
  });
  assertBackendEffectSurface(appPath);

  assertModuleShape(sharedApi, {
    imports: [
      [
        '@modern-js/plugin-bff/effect-client',
        ['HttpApi', 'HttpApiEndpoint', 'HttpApiGroup', 'HttpApiSchema', 'Schema'],
      ],
    ],
    calls: [
      [
        'HttpApi.make',
        'must declare the HttpApi contract through HttpApi.make(...).',
      ],
      ['HttpApiGroup.make', 'must declare groups through HttpApiGroup.make(...).'],
      [
        'HttpApiEndpoint.get',
        'must declare GET endpoints through HttpApiEndpoint.get(...).',
      ],
      [
        'HttpApiEndpoint.post',
        'must declare POST endpoints through HttpApiEndpoint.post(...).',
      ],
      [
        'Schema.Struct',
        'must use concrete Schema.Struct request and response shapes.',
      ],
    ],
  });
  assertModuleShape(clientPath, {
    imports: [
      [
        '@modern-js/plugin-bff/effect-client',
        ['Effect', 'makeEffectHttpApiClient'],
      ],
      ['../../shared/api', []],
    ],
    calls: [
      [
        'makeEffectHttpApiClient',
        'must create the generated Effect HttpApi client.',
      ],
    ],
  });

  assertEffectConfig(appPath);

  if (exists(packageJsonPath)) {
    const packageJson = JSON.parse(readText(packageJsonPath));
    assert(
      packageJson.exports?.['./api'] === './shared/api.ts',
      `${packageJsonPath}: package must export ./api from shared/api.ts.`,
    );
    assert(
      packageJson.exports?.['./api/client'] === `./src/api/${stem}-client.ts`,
      `${packageJsonPath}: package must export ./api/client from ${stem}-client.ts.`,
    );
    assert(
      packageJson.exports?.['./api/rpc-client'] === undefined,
      `${packageJsonPath}: REST package must not expose the RPC ./api/rpc-client export.`,
    );
  }
}

for (const appPath of listDirectories('apps')) {
  const app = configuredApp(appPath);
  if (app?.kind === 'vertical' && appShouldEmitApi(app)) {
    assert(
      app.api !== undefined,
      `${appPath}: ${app.surfaceProfile ?? 'full-stack'} vertical must declare its Effect API in .modernjs/ultramodern.json.`,
    );
    assertApiSurface(appPath, app);
  } else if (app?.kind === 'vertical') {
    assert(
      app.api === undefined,
      `${appPath}: ${app.surfaceProfile ?? app.deliveryUnitKind ?? 'UI'} vertical must not declare an API.`,
    );
    assertNoApiSurface(appPath, app.surfaceProfile ?? app.deliveryUnitKind ?? 'UI');
  } else if (app?.api !== undefined) {
    assertApiSurface(appPath, app);
  } else if (
    app === undefined &&
    (exists(`${appPath}/api/index.ts`) || exists(`${appPath}/shared/api.ts`))
  ) {
    assertApiSurface(appPath, app);
  }
}

for (const verticalPath of verticalDirectories) {
  const app = configuredApp(verticalPath);
  if (app !== undefined && appShouldEmitApi(app)) {
    assert(
      app.api !== undefined,
      `${verticalPath}: ${app.surfaceProfile ?? 'full-stack'} vertical must declare its Effect API in .modernjs/ultramodern.json.`,
    );
    assertApiSurface(verticalPath, app);
  } else if (app !== undefined) {
    assert(
      app.api === undefined,
      `${verticalPath}: ${app.surfaceProfile ?? app.deliveryUnitKind ?? 'UI'} vertical must not declare an API.`,
    );
    assertNoApiSurface(
      verticalPath,
      app.surfaceProfile ?? app.deliveryUnitKind ?? 'UI',
    );
  } else {
    assertApiSurface(verticalPath, undefined);
  }
}

if (exists('apps/shell-super-app/package.json')) {
  const shellPackageJson = JSON.parse(
    readText('apps/shell-super-app/package.json'),
  );
  assert(
    shellPackageJson.exports?.['./api/clients'] ===
      './src/api/vertical-clients.ts',
    'apps/shell-super-app/package.json must export ./api/clients.',
  );
}

if (exists('package.json')) {
  const rootPackageJson = JSON.parse(readText('package.json'));
  assert(
    rootPackageJson.scripts?.['api:check'] ===
      'node ./scripts/check-ultramodern-api-boundaries.mts',
    'Root package.json must expose api:check.',
  );
  assert(
    rootPackageJson.scripts?.check?.includes('pnpm api:check'),
    'Root check script must include pnpm api:check.',
  );
}

if (exists('topology/reference-topology.json')) {
  const topology = JSON.parse(readText('topology/reference-topology.json'));
  for (const vertical of topology.verticals ?? []) {
    if (vertical.api?.runtime === 'effect') {
      assert(
        vertical.api.bff?.strictEffectApproach === true,
        `${vertical.id} topology must mark strictEffectApproach as true.`,
      );
      assert(
        typeof vertical.api.serverEntry === 'string' &&
          vertical.api.serverEntry.endsWith('/api/index.ts'),
        `${vertical.id} topology must use api/index.ts as the server entry.`,
      );
    }
    assert(
      !vertical.api?.effect,
      `${vertical.id} topology must describe the API directly, not under api.effect.`,
    );
  }
}

if (failures.length > 0) {
  console.error('UltraModern API boundary check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('UltraModern API boundary check passed.');
