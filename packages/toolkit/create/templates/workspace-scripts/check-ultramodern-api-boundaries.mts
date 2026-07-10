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

function assertContains(relativePath, content, pattern, message) {
  assert(pattern.test(content), `${relativePath}: ${message}`);
}

function assertNotContains(relativePath, content, pattern, message) {
  assert(!pattern.test(content), `${relativePath}: ${message}`);
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
if (exists('apps/shell-super-app') && verticalDirectories.length > 0) {
  assert(exists(shellClient), `${shellClient} must aggregate vertical API clients.`);
}

function assertApiSurface(appPath) {
  const apiEntry = `${appPath}/api/index.ts`;
  const backendEffectExpose = `${appPath}/api/effect-api.ts`;
  const sharedApi = `${appPath}/shared/api.ts`;
  const srcApiDirectory = `${appPath}/src/api`;
  const modernConfig = `${appPath}/modern.config.ts`;
  const packageJsonPath = `${appPath}/package.json`;

  assert(exists(apiEntry), `${apiEntry} is required.`);
  assert(exists(sharedApi), `${sharedApi} is required.`);
  assert(exists(srcApiDirectory), `${srcApiDirectory} is required.`);

  if (exists(srcApiDirectory)) {
    const clientFiles = listFiles(srcApiDirectory).filter(file =>
      /-client\.ts$/u.test(file),
    );
    assert(
      clientFiles.length > 0,
      `${srcApiDirectory} must contain a generated API client.`,
    );
  }

  if (exists(apiEntry)) {
    const entry = readText(apiEntry);
    assertContains(
      apiEntry,
      entry,
      /\bdefineEffectBff\b/u,
      'must export a defineEffectBff(...) runtime definition.',
    );
    assertContains(
      apiEntry,
      entry,
      /\bHttpApiBuilder\b/u,
      'must implement handlers through HttpApiBuilder.',
    );
    assertContains(
      apiEntry,
      entry,
      /\bLayer\b/u,
      'must compose dependencies with Effect Layer.',
    );
    assertContains(
      apiEntry,
      entry,
      /from ['"]\.\.\/shared\/api\.ts['"]/u,
      'must import the contract from ../shared/api.ts.',
    );
  }
 if (exists(backendEffectExpose)) {
 const backendExpose = readText(backendEffectExpose);
 assertContains(
 backendEffectExpose,
 backendExpose,
 /backendFederationContract/u,
 'must export backendFederationContract metadata.',
 );
 assertContains(
 backendEffectExpose,
 backendExpose,
 /role:\s*['"]microvertical-server['"]/u,
 'must describe the MicroVertical server role.',
 );
 assertContains(
 backendEffectExpose,
 backendExpose,
 /strictEffectApproach:\s*true/u,
 'must preserve strict Effect backend execution.',
 );
 assertContains(
 backendEffectExpose,
 backendExpose,
 /contractVersion:\s*['"]microvertical-server-effect-v1['"]/u,
 'must preserve the MicroVertical server contract version.',
 );
 assertContains(
 backendEffectExpose,
 backendExpose,
 /export\s*\{\s*default\s*,\s*default\s+as\s+runtime\s*\}\s+from\s+['"]\.\/index\.ts['"]/u,
 'must re-export the generated Effect BFF runtime as both default and runtime.',
 );
 assert(
 !/\b(request|handler)\s*:\s*async\s*\(/u.test(backendExpose),
 `${backendEffectExpose}: must not expose raw request handlers.`,
 );
 }

 if (exists(sharedApi)) {
    const contract = readText(sharedApi);
    assertContains(
      sharedApi,
      contract,
      /\bHttpApi\.make\b/u,
      'must declare the HttpApi contract.',
    );
    assertContains(
      sharedApi,
      contract,
      /\bHttpApiGroup\.make\b/u,
      'must declare HttpApi groups.',
    );
    assertContains(
      sharedApi,
      contract,
      /\bHttpApiEndpoint\./u,
      'must declare endpoints through HttpApiEndpoint.',
    );
    assertContains(
      sharedApi,
      contract,
      /\bSchema\./u,
      'must use Schema for request, response and error shapes.',
    );
  }

  if (exists(modernConfig)) {
    const config = readText(modernConfig);
    assertContains(
      modernConfig,
      config,
      /runtimeFramework:\s*['"]effect['"]/u,
      'must use bff.runtimeFramework: effect.',
    );
    assertContains(
      modernConfig,
      config,
      /entry:\s*['"]\.\/api\/index['"]/u,
      'must point bff.effect.entry at ./api/index.',
    );
    assertContains(
      modernConfig,
      config,
      /strictEffectApproach:\s*true/u,
      'must enable strictEffectApproach explicitly.',
    );
  }

  if (exists(packageJsonPath)) {
    const packageJson = JSON.parse(readText(packageJsonPath));
    assert(
      packageJson.exports?.['./api'] === './shared/api.ts',
      `${packageJsonPath}: package must export ./api from shared/api.ts.`,
    );
    assert(
      typeof packageJson.exports?.['./api/client'] === 'string' &&
        packageJson.exports['./api/client'].startsWith('./src/api/'),
      `${packageJsonPath}: package must export ./api/client from src/api/*.`,
    );
  }
}

for (const appPath of listDirectories('apps')) {
  if (exists(`${appPath}/api/index.ts`) || exists(`${appPath}/shared/api.ts`)) {
    assertApiSurface(appPath);
  }
}

for (const verticalPath of verticalDirectories) {
  assertApiSurface(verticalPath);
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
