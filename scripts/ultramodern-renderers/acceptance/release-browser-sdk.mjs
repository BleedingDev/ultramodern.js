import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// Operational standalone SDK probe. This file does not qualify an app build.
// The caller must authenticate the live roots with the common installed auditor.
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};
const jsFile = file => /\.[cm]?js$/u.test(file);

async function ordinary(file, boundary) {
  const stat = await fs.lstat(file);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink(),
    `SDK input must be an ordinary file: ${file}`,
  );
  const actual = await fs.realpath(file);
  assert.ok(inside(boundary, actual), `SDK input escaped its owner: ${file}`);
  return actual;
}

async function evidence(file, root) {
  const actual = await ordinary(file, root);
  const bytes = await fs.readFile(actual);
  return {
    path: path.relative(root, actual),
    sha256: sha256(bytes),
    size: bytes.length,
  };
}

async function installedPackage(require, specifier, boundary) {
  const name = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  for (const base of require.resolve.paths(name) ?? []) {
    const candidate = path.join(base, name, 'package.json');
    try {
      const manifestPath = await fs.realpath(candidate);
      assert.ok(
        inside(boundary, manifestPath),
        `Installed ${name} escaped the consumer`,
      );
      const bytes = await fs.readFile(manifestPath);
      const manifest = JSON.parse(bytes);
      const entry = await fs.realpath(require.resolve(specifier));
      assert.ok(
        inside(path.dirname(manifestPath), entry),
        `Public ${specifier} escaped its installed package`,
      );
      return {
        installationName: name,
        name: manifest.name,
        version: manifest.version,
        directory: path.dirname(manifestPath),
        manifest,
        manifestPath,
        manifestSha256: sha256(bytes),
        entry,
        entrySha256: sha256(await fs.readFile(entry)),
      };
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  throw new Error(
    `The SDK consumer lacks its actual public dependency ${specifier}`,
  );
}

function projectedSpecifier(sourceName, kind, releaseArtifacts) {
  const artifact = releaseArtifacts.artifacts?.find(
    item => item.sourceName === sourceName,
  );
  assert.ok(
    artifact?.targetName && artifact.name === artifact.targetName,
    `Missing authenticated SDK mapping for ${sourceName}`,
  );
  assert.ok(
    ['generated', 'hand-authored'].includes(kind),
    'SDK kind must be explicit',
  );
  return kind === 'generated' ? sourceName : artifact.targetName;
}

function execute(command, args, { cwd, signal, timeoutMs = 180_000, active }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    active.add(child);
    let stdout = '',
      stderr = '',
      failure,
      escalation;
    const kill = kind => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, kind);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    const terminate = error => {
      failure ??= error;
      kill('SIGTERM');
      escalation ??= setTimeout(() => kill('SIGKILL'), 1_000);
    };
    const timer = setTimeout(
      () => terminate(new Error('Standalone SDK process timed out')),
      timeoutMs,
    );
    const aborted = () =>
      terminate(signal.reason ?? new Error('Standalone SDK process aborted'));
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
    for (const [stream, append] of [
      [
        child.stdout,
        bytes => {
          stdout += bytes;
        },
      ],
      [
        child.stderr,
        bytes => {
          stderr += bytes;
        },
      ],
    ])
      stream.setEncoding('utf8').on('data', bytes => {
        append(bytes);
        if (stdout.length + stderr.length > 16 * 1024 * 1024)
          terminate(
            new Error(
              'Standalone SDK output exceeded its bounded receipt limit',
            ),
          );
      });
    child.on('error', error => {
      failure ??= error;
    });
    child.on('close', (exitCode, exitSignal) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      signal?.removeEventListener('abort', aborted);
      active.delete(child);
      if (failure) return reject(failure);
      resolve({ command, args, exitCode, signal: exitSignal, stdout, stderr });
    });
  });
}

function counterSource(renderer) {
  if (renderer === 'solid')
    return `import { createSignal } from 'solid-js';
export function Counter() {
  const [count, setCount] = createSignal(0);
  return <section><button type="button" data-sdk-counter onClick={() => setCount(count() + 1)}>Count: {count()}</button></section>;
}
`;
  return `${renderer === 'react' ? "import * as Native from 'react';" : "import { useState } from 'octane';"}
export function Counter() {
  const [count, setCount] = ${renderer === 'react' ? 'Native.useState' : 'useState'}(0);
  return <section><button type="button" data-sdk-counter onClick={() => ${renderer === 'react' ? 'setCount(value => value + 1)' : 'setCount(count + 1)'}}>Count: {count}</button></section>;
}
`;
}

function clientSource({
  renderer,
  clientSpecifier,
  routerSpecifier,
  pluginSpecifier,
  clientExports,
}) {
  const native =
    renderer === 'react'
      ? `import * as Native from 'react';\nimport * as Plugins from ${JSON.stringify(pluginSpecifier)};`
      : renderer === 'octane'
        ? `import { useState } from 'octane';`
        : '';
  const state =
    renderer === 'solid'
      ? `const [count, setCount] = createSignal(0);`
      : `const [count, setCount] = ${renderer === 'react' ? 'Native.useState' : 'useState'}(0);`;
  const count = renderer === 'solid' ? 'count()' : 'count';
  const increment =
    renderer === 'solid'
      ? 'setCount(count() + 1)'
      : renderer === 'react'
        ? 'setCount(value => value + 1)'
        : 'setCount(count + 1)';
  const provider =
    renderer === 'react' ? 'Router.RouterProvider' : 'Router.ApplicationRouter';
  const routerFactory =
    renderer === 'react'
      ? 'Router.createRouter'
      : 'Router.createApplicationRouter';
  const mounting =
    renderer === 'react'
      ? `Plugins.registerPlugin([]);
  const mounted = await Client.render(<Counter />, mount);
  const hydrated = await Client.hydrateWithReact(<Counter />, hydrate);
  const disposeMounted = () => mounted.unmount();
  const disposeHydrated = () => hydrated.unmount();`
      : renderer === 'solid'
        ? `const bootstrap = Client.readSolidDocumentBootstrap(document, input.identity);
  const disposeMounted = Client.mountApplication(Counter, mount, { renderId: 'c2-sdk-mount:' });
  const disposeHydrated = Client.hydrateApplication(Counter, hydrate, { renderId: bootstrap.documentId });`
        : `const bootstrap = Client.readOctaneDocumentBootstrap(document, input.identity, input.nativeHydrationBuildId);
  const common = { identity: input.identity, nativeHydrationBuildId: input.nativeHydrationBuildId, load: async () => ({ default: Counter }) };
  const mounted = await Client.mountOctaneApplication({ ...common, container: mount });
  const hydrated = await Client.hydrateOctaneApplication({ ...common, container: hydrate, documentIdentity: bootstrap.identity, documentNativeHydrationBuildId: bootstrap.nativeHydrationBuildId, documentId: bootstrap.documentId, initialSignals: { version: 1, scopes: [] } });
  const disposeMounted = () => mounted.dispose();
  const disposeHydrated = () => hydrated.dispose();`;
  const routed =
    renderer === 'react'
      ? `const routed = await Client.render(view(), routerHost);
  const disposeRouter = () => routed.unmount();`
      : renderer === 'solid'
        ? `const disposeRouter = Client.mountApplication(view, routerHost, { renderId: 'c2-sdk-router:' });`
        : `const routed = await Client.mountOctaneApplication({ container: routerHost, identity: input.identity, nativeHydrationBuildId: input.nativeHydrationBuildId, load: async () => ({ default: () => view() }) });
  const disposeRouter = () => routed.dispose();`;
  return `${native}
${renderer === 'solid' ? "import { createSignal } from 'solid-js';" : ''}
import * as Client from ${JSON.stringify(clientSpecifier)};
import * as Router from ${JSON.stringify(routerSpecifier)};
import { Counter } from './counter.jsx';
const expectedClient = ${JSON.stringify(clientExports)};
for (const name of expectedClient) if (typeof Client[name] !== 'function') throw new Error('Missing public SDK client export: ' + name);
for (const name of ['Link', 'Outlet']) if (typeof Router[name] !== 'function') throw new Error('Missing public SDK router export: ' + name);
function element(id) { const found = document.getElementById(id); if (!found) throw new Error('Missing SDK element: ' + id); return found; }
function Layout() {
  ${state}
  return <main><button data-sdk-layout-count type="button" onClick={() => ${increment}}>Layout: {${count}}</button><Router.Link to="/next" data-sdk-link>Next</Router.Link><Router.Outlet /></main>;
}
async function start() {
  const input = Reflect.get(globalThis, '__C2_SDK_INPUT__');
  if (!input || input.identity.renderer !== ${JSON.stringify(renderer)}) throw new Error('SDK runtime identity is missing or wrong');
  const mount = element('sdk-mount'); const hydrate = element('sdk-hydrate'); const routerHost = element('sdk-router');
  const original = hydrate.querySelector('[data-sdk-counter]');
  if (!original) throw new Error('SDK native SSR did not emit its counter');
  ${mounting}
  const root = Router.createRootRoute({ component: Layout });
  const tree = root.addChildren([
    Router.createRoute({ getParentRoute: () => root, path: '/', component: () => <p data-sdk-route>Home</p> }),
    Router.createRoute({ getParentRoute: () => root, path: '/next', component: () => <p data-sdk-route>Next page</p> }),
  ]);
  const router = ${routerFactory}({ routeTree: tree, context: { ultramodern: { rendererIdentity: input.identity } }, isServer: false });
  await router.load();
  const view = () => <${provider} router={router} />;
  ${routed}
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (original !== hydrate.querySelector('[data-sdk-counter]')) throw new Error('SDK hydration replaced the actual server node');
  Reflect.set(globalThis, '__C2_SDK_READY__', {
    identity: input.identity,
    namespaceKeys: { client: Object.keys(Client).sort(), router: Object.keys(Router).sort() },
    publicExports: [
      { specifier: ${JSON.stringify(clientSpecifier)}, exports: expectedClient, condition: 'browser', executed: true },
      { specifier: ${JSON.stringify(routerSpecifier)}, exports: ['Link', 'Outlet'], condition: 'browser', executed: true },
    ],
    hydrationAdopted: true,
    dispose() { disposeMounted(); disposeHydrated(); disposeRouter(); },
  });
}
start().catch(error => { Reflect.set(globalThis, '__C2_SDK_FAILURE__', String(error?.stack ?? error)); throw error; });
`;
}

function serverSource({ renderer, serverSpecifier, coreSpecifier }) {
  if (renderer === 'react')
    return `import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { Counter } from './counter.jsx';
export async function renderSdkDocument() {
  const body = renderToString(<Counter />, { identifierPrefix: 'modern-js-' });
  return '<!doctype html><html><head><title>Public React SDK</title></head><body><div id="sdk-hydrate">' + body + '</div></body></html>';
}
`;
  return `${renderer === 'octane' ? "import * as Native from 'octane';" : ''}
import { createRequestSession } from ${JSON.stringify(`${coreSpecifier}/session`)};
import * as Server from ${JSON.stringify(serverSpecifier)};
import { Counter } from './counter.jsx';
export async function renderSdkDocument(input) {
  const session = createRequestSession({ request: new Request(input.url, { signal: input.signal }), identity: input.identity, platform: { kind: 'node', bindings: {} } });
  const policy = { kind: 'document', status: 200, statusText: 'OK', headers: [['content-type', 'text/html; charset=utf-8']], cache: { mode: 'no-store' } };
  ${
    renderer === 'solid'
      ? `session.resolveResponse(policy);
  const response = await Server.runApplicationRequest(session, () => Server.renderDocumentApplication({ session, view: () => <Counter />, document: { rootId: 'sdk-hydrate', renderId: 'c2-sdk-hydrate:' } }));`
      : `const response = await Server.renderOctaneApplication({ session, App: Counter, responsePolicy: policy, document: { rootId: 'sdk-hydrate', documentId: input.documentId, nativeHydrationBuildId: input.nativeHydrationBuildId } });`
  }
  if (response.status !== 200) throw new Error('SDK native SSR returned ' + response.status);
  const html = await response.text();
  if ((await session.completion).state !== 'completed') throw new Error('SDK native SSR request did not complete');
  return html;
}
`;
}

const buildWorker = String.raw`import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const input = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const require = createRequire(path.join(input.applicationRoot, 'package.json'));
const rsbuildApi = await import(pathToFileURL(input.rsbuild.entry).href);
const createRsbuild = rsbuildApi.createRsbuild ?? rsbuildApi.default?.createRsbuild;
const rspack = rsbuildApi.rspack ?? rsbuildApi.default?.rspack;
assert.equal(typeof createRsbuild, 'function', 'Actual public Rsbuild createRsbuild API required');
const compilerApi = await import(pathToFileURL(input.compiler.entry).href);
const compiler = compilerApi.default ?? compilerApi;
let nativePlugin;
if (input.renderer === 'react') {
  const pluginReact = compilerApi.pluginReact ?? compiler.pluginReact;
  assert.equal(typeof pluginReact, 'function', 'Actual selected public React compiler API required');
  nativePlugin = pluginReact();
} else if (input.renderer === 'solid') {
  for (const name of ['transformLazy', 'transform']) assert.equal(typeof (compilerApi[name] ?? compiler[name]), 'function', 'Actual selected Solid compiler public API required');
} else {
  const OctaneRspackPlugin = compilerApi.OctaneRspackPlugin ?? compiler.OctaneRspackPlugin;
  const inferRspackEnvironment = compilerApi.inferRspackEnvironment ?? compiler.inferRspackEnvironment;
  assert.equal(typeof OctaneRspackPlugin, 'function'); assert.equal(typeof inferRspackEnvironment, 'function');
  nativePlugin = { name: 'c2-public-octane-sdk-compiler', setup(api) {
    api.modifyRsbuildConfig(config => { config.source ??= {}; config.source.include = [...(config.source.include ?? []), /[/\\]@octanejs[/\\]/u]; });
    api.modifyRspackConfig(config => {
      config.plugins ??= []; config.plugins.push(new OctaneRspackPlugin({ root: input.applicationRoot, environment: inferRspackEnvironment(config.target), transpile: false }));
      config.module ??= {}; config.module.rules ??= [];
      config.module.rules.push({ test: /\.tsrx$/u, type: 'javascript/auto', use: [{ loader: 'builtin:swc-loader', options: { detectSyntax: 'auto' } }] });
    });
  } };
}
const publicStats = [];
const observer = { name: 'c2-sdk-public-stats', setup(api) { api.onAfterBuild(({ stats }) => {
  assert.ok(stats && !stats.hasErrors(), 'SDK compiler returned real errors');
  publicStats.push(stats.toJson({ all: false, hash: true, assets: true, children: true, modules: true, nestedModules: true, errors: true, errorDetails: true }));
}); } };
const host = await createRsbuild({ cwd: input.applicationRoot, rsbuildConfig: {
  mode: 'production', plugins: [...(nativePlugin ? [nativePlugin] : []), observer],
  source: { define: input.renderer === 'react' ? { 'process.env.IS_REACT18': JSON.stringify('true') } : {} },
  environments: {
    client: { source: { entry: { sdk: input.client } }, output: { target: 'web', distPath: { root: input.clientOutput }, filename: { js: '[name].js' }, cleanDistPath: false } },
    server: { source: { entry: { sdk: input.server } }, output: { target: 'node', distPath: { root: input.serverOutput }, filename: { js: '[name].cjs' }, cleanDistPath: false } },
  },
  tools: { rspack(config, { environment }) {
    config.plugins ??= [];
    assert.equal(typeof rspack?.optimize?.LimitChunkCountPlugin, 'function', 'Actual public Rspack chunk limiting API required');
    config.plugins.push(new rspack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }));
    config.optimization ??= {}; config.optimization.runtimeChunk = false; config.optimization.splitChunks = false;
    if (environment.name === 'server') { config.output ??= {}; config.output.library = { type: 'commonjs2' }; }
    if (input.renderer === 'solid') {
      config.resolve ??= {}; config.resolve.conditionNames = ['solid', environment.name === 'client' ? 'browser' : 'node', 'import', 'default'];
      config.module ??= {}; config.module.rules ??= [];
      config.module.rules.unshift({ test: /\.jsx$/u, include: input.sourceDirectory, enforce: 'pre', use: [{ loader: input.solidLoader, options: { compilerPath: input.compiler.entry, server: environment.name === 'server' } }] });
    }
    return config;
  } },
} });
try { await host.build(); } finally { if (typeof host.close === 'function') await host.close(); }
assert.ok(publicStats.length, 'SDK compilation omitted public Stats receipt');
await fs.writeFile(input.statsFile, JSON.stringify(publicStats), { flag: 'wx' });
`;

const solidLoader = `module.exports = function publicSolidSdk(source) {
  const { compilerPath, server } = this.getOptions();
  const compiler = require(compilerPath);
  const filename = this.resourcePath;
  const lazy = compiler.transformLazy(source, { filename, sourceMap: false });
  return compiler.transform(lazy.code, { filename, moduleName: '@solidjs/web', generate: server ? 'ssr' : 'dom', hydratable: true, sourceMap: false }).code;
};
`;

async function filesIn(directory) {
  const files = [];
  async function visit(current) {
    for (const name of (await fs.readdir(current)).sort()) {
      const absolute = path.join(current, name);
      const stat = await fs.lstat(absolute);
      if (stat.isDirectory()) await visit(absolute);
      else {
        assert.ok(
          stat.isFile() && !stat.isSymbolicLink(),
          'SDK outputs cannot be symlinks',
        );
        files.push(absolute);
      }
    }
  }
  await visit(directory);
  return files;
}

function nativeSourcePaths(stats) {
  const files = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (
      typeof value.nameForCondition === 'string' &&
      /\.tsrx(?:\?|$)/u.test(value.nameForCondition)
    )
      files.add(value.nameForCondition.split('?')[0]);
    for (const name of ['children', 'modules'])
      for (const child of value[name] ?? []) visit(child);
  }
  for (const value of stats) visit(value);
  return [...files].sort();
}

async function authenticatedNativeSources(consumer, root, releaseArtifacts) {
  const proofs = consumer.installed?.nativeCompilerProofs;
  assert.ok(
    Array.isArray(proofs) && proofs.length,
    'Octane SDK source admission requires the actual already-audited app native compiler proofs',
  );
  const allowed = new Map();
  for (const proof of proofs) {
    const manifestFile = await ordinary(
      path.resolve(root, proof.manifestPath),
      root,
    );
    const bytes = await fs.readFile(manifestFile);
    assert.equal(
      sha256(bytes),
      proof.manifestSha256,
      'Authenticated app native source manifest changed',
    );
    const manifest = JSON.parse(bytes);
    assert.ok(
      isDeepStrictEqual(manifest.rendererIdentity, proof.rendererIdentity),
      'App native source identity changed',
    );
    for (const source of proof.sourceModules) {
      const file = await fs.realpath(path.resolve(root, source.path));
      assert.ok(
        inside(root, file),
        'Authenticated app source escaped its actual consumer',
      );
      if (
        !file.endsWith('.tsrx') ||
        !file.includes(`${path.sep}node_modules${path.sep}`)
      )
        continue;
      assert.equal(
        sha256(await fs.readFile(file)),
        source.sourceSha256,
        'Authenticated installed native source changed',
      );
      assert.ok(
        manifest.sourceModules.some(
          item =>
            item.resource === source.resource &&
            item.sourceSha256 === source.sourceSha256,
        ),
        'Native source proof is absent from its authentic app manifest',
      );
      const owners = (consumer.installed.closure ?? [])
        .filter(
          item =>
            typeof item.path === 'string' &&
            inside(path.resolve(root, item.path), file),
        )
        .sort((left, right) => right.path.length - left.path.length);
      const owner = owners[0];
      assert.ok(
        owner,
        'SDK native source has no authenticated physical installed-package owner',
      );
      const packageManifest = await ordinary(
        path.join(root, owner.path, 'package.json'),
        root,
      );
      const packageBytes = await fs.readFile(packageManifest);
      const packageValue = JSON.parse(packageBytes);
      assert.equal(
        sha256(packageBytes),
        owner.manifestSha256,
        'SDK native installed-package manifest changed',
      );
      assert.equal(packageValue.name, owner.name);
      assert.equal(packageValue.version, owner.version);
      const artifact = releaseArtifacts.artifacts.find(
        item => item.targetName === owner.name,
      );
      const pin =
        consumer.installed.exactPackages?.[owner.name] ??
        (artifact && consumer.installed.exactPackages?.[artifact.sourceName]);
      assert.equal(
        pin,
        owner.version,
        'SDK native installed source lacks its unchanged exact C2 package pin',
      );
      allowed.set(file, {
        sourceSha256: source.sourceSha256,
        appManifestPath: proof.manifestPath,
        appManifestSha256: proof.manifestSha256,
        package: {
          name: owner.name,
          version: owner.version,
          path: owner.path,
          manifestSha256: owner.manifestSha256,
          pin,
        },
      });
    }
  }
  return allowed;
}

/** Called only after root authorizes SDK compilation and passes actual C2 facts. */
export async function prepareBrowserSdkProbe({
  consumer,
  row,
  hosts,
  handoff,
  releaseArtifacts,
  qualifiedNode,
  outputRoot,
  signal,
}) {
  assert.ok(['react', 'solid', 'octane'].includes(consumer.renderer));
  const renderer = consumer.renderer;
  const kind = consumer.kind;
  const root = await fs.realpath(row.consumerRoot);
  const app = await fs.realpath(row.appRoot ?? consumer.applicationRoot);
  assert.ok(
    inside(root, app),
    'SDK application escaped the actual C2 consumer',
  );
  assert.equal(
    await fs.realpath(process.execPath),
    await fs.realpath(qualifiedNode),
    'SDK orchestrator must run under the root-qualified Node',
  );
  assert.equal(
    releaseArtifacts.sourceRevision,
    handoff.identity.sourceRevision,
    'SDK source candidate differs from actual C2 release',
  );
  signal?.throwIfAborted();
  const environments = hosts.environments ?? hosts;
  const baseline = [];
  for (const environment of ['development', 'production']) {
    const host = environments[environment];
    assert.ok(
      host?.metadataFile && host.csrIdentity,
      'SDK probe requires the actual owning app manifests and CSR identities',
    );
    const filename = await ordinary(
      path.resolve(root, host.metadataFile),
      root,
    );
    const bytes = await fs.readFile(filename);
    const manifest = JSON.parse(bytes);
    assert.ok(
      isDeepStrictEqual(
        manifest.identities[host.csrIdentity.entryName],
        host.csrIdentity,
      ),
      'SDK identity differs from the actual owning app manifest',
    );
    baseline.push({ environment, filename, sha256: sha256(bytes) });
  }
  const require = createRequire(path.join(app, 'package.json'));
  const selected = consumer.admittedProfile ?? row.profile;
  assert.equal(
    selected.renderer,
    renderer,
    'SDK compiler profile differs from selected renderer',
  );
  assert.equal(
    process.versions.node,
    selected.minimumNode,
    'SDK compilation requires the exact admitted minimum Node',
  );
  const clientProbe = row.exportProbes.find(
    probe => probe.role === 'client-runtime',
  );
  const routerProbe = row.exportProbes.find(probe => probe.role === 'router');
  const serverProbe = row.exportProbes.find(
    probe => probe.role === 'server-runtime',
  );
  assert.ok(
    clientProbe?.specifier && routerProbe?.specifier && serverProbe?.specifier,
    'Actual C2 public SDK probe declarations required',
  );
  const runtimeName =
    renderer === 'react'
      ? '@modern-js/runtime'
      : `@modern-js/renderer-${renderer}`;
  assert.equal(
    clientProbe.specifier,
    `${projectedSpecifier(runtimeName, kind, releaseArtifacts)}/${renderer === 'react' ? 'browser' : 'client'}`,
  );
  assert.equal(
    routerProbe.specifier,
    renderer === 'react'
      ? `${projectedSpecifier('@modern-js/plugin-tanstack', kind, releaseArtifacts)}/runtime`
      : `${projectedSpecifier(runtimeName, kind, releaseArtifacts)}/router`,
  );
  assert.equal(
    serverProbe.specifier,
    `${projectedSpecifier(runtimeName, kind, releaseArtifacts)}/${renderer === 'react' ? 'ssr/server' : 'server'}`,
  );
  const core = projectedSpecifier(
    '@modern-js/renderer-core',
    kind,
    releaseArtifacts,
  );
  const ultra = await installedPackage(
    require,
    projectedSpecifier(
      '@modern-js/ultramodern-app-tools',
      kind,
      releaseArtifacts,
    ),
    root,
  );
  const toolRequire = createRequire(ultra.entry);
  const ultraArtifact = releaseArtifacts.artifacts.find(
    item => item.sourceName === '@modern-js/ultramodern-app-tools',
  );
  assert.equal(ultra.name, ultraArtifact.targetName);
  assert.equal(ultra.version, ultraArtifact.version);
  const rsbuild = await installedPackage(toolRequire, '@rsbuild/core', root);
  assert.equal(rsbuild.name, '@rsbuild/core');
  assert.equal(
    rsbuild.version,
    ultra.manifest.dependencies['@rsbuild/core'],
    'SDK Rsbuild must be the owning installed framework tool version',
  );
  const compiler = await installedPackage(
    require,
    selected.compiler.name,
    root,
  );
  assert.equal(
    compiler.name,
    selected.compiler.name,
    'SDK compiler public package identity differs from the admitted provider',
  );
  assert.equal(
    compiler.version,
    selected.compiler.version,
    'SDK compiler differs from the exact admitted tuple',
  );
  for (const [specifier, sourceName] of [
    [clientProbe.specifier, runtimeName],
    [
      routerProbe.specifier,
      renderer === 'react' ? '@modern-js/plugin-tanstack' : runtimeName,
    ],
    [serverProbe.specifier, runtimeName],
  ]) {
    const actual = await installedPackage(require, specifier, root);
    const artifact = releaseArtifacts.artifacts.find(
      item => item.sourceName === sourceName,
    );
    assert.equal(actual.name, artifact.targetName);
    assert.equal(actual.version, artifact.version);
  }
  if (renderer !== 'react')
    for (const name of ['react', 'react-dom'])
      assert.throws(
        () => require.resolve(name),
        { code: 'MODULE_NOT_FOUND' },
        'Native SDK cannot acquire React runtime',
      );
  const nativeAllowed =
    renderer === 'octane'
      ? await authenticatedNativeSources(consumer, root, releaseArtifacts)
      : new Map();
  const base = await fs.realpath(outputRoot);
  assert.ok(
    inside(path.join(app, 'dist'), base),
    'Standalone SDK output must be inside the actual app dist lease',
  );
  const owned = await fs.mkdtemp(
    path.join(base, 'target-release-sdk-browser-'),
  );
  const active = new Set();
  const pages = new Set();
  let stopped = false,
    installedAudit,
    server,
    serverApi;
  const baselineUnchanged = async () => {
    for (const item of baseline)
      assert.equal(
        sha256(await fs.readFile(item.filename)),
        item.sha256,
        'SDK probe changed an owning app production/development manifest',
      );
  };
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    const failures = [];
    for (const page of pages)
      try {
        await page.close();
      } catch (error) {
        failures.push(error);
      }
    for (const child of active) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') failures.push(error);
      }
    }
    if (active.size) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      for (const child of active)
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') failures.push(error);
        }
    }
    if (server)
      await new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
      });
    try {
      await baselineUnchanged();
    } catch (error) {
      failures.push(error);
    }
    try {
      await fs.rm(owned, { recursive: true, force: true });
    } catch (error) {
      failures.push(error);
    }
    if (failures.length)
      throw new AggregateError(failures, 'Standalone SDK cleanup failed');
  };
  try {
    const sourceDirectory = path.join(owned, 'source');
    const clientOutput = path.join(owned, 'client');
    const serverOutput = path.join(owned, 'server');
    await fs.mkdir(sourceDirectory);
    await fs.mkdir(clientOutput);
    await fs.mkdir(serverOutput);
    const client = path.join(sourceDirectory, 'client.jsx'),
      serverEntry = path.join(sourceDirectory, 'server.jsx');
    const contents = {
      'counter.jsx': counterSource(renderer),
      'client.jsx': clientSource({
        renderer,
        clientSpecifier: clientProbe.specifier,
        routerSpecifier: routerProbe.specifier,
        pluginSpecifier:
          renderer === 'react'
            ? `${projectedSpecifier('@modern-js/runtime', kind, releaseArtifacts)}/plugin`
            : undefined,
        clientExports: clientProbe.exports,
      }),
      'server.jsx': serverSource({
        renderer,
        serverSpecifier: serverProbe.specifier,
        coreSpecifier: core,
      }),
    };
    for (const [name, source] of Object.entries(contents))
      await fs.writeFile(path.join(sourceDirectory, name), source, {
        flag: 'wx',
      });
    const worker = path.join(owned, 'compile.mjs'),
      loader = path.join(owned, 'solid-loader.cjs'),
      statsFile = path.join(owned, 'sdk-public-stats.json');
    await fs.writeFile(worker, buildWorker, { flag: 'wx' });
    await fs.writeFile(loader, solidLoader, { flag: 'wx' });
    const input = {
      renderer,
      applicationRoot: app,
      compiler,
      rsbuild,
      sourceDirectory,
      client,
      server: serverEntry,
      clientOutput,
      serverOutput,
      solidLoader: loader,
      statsFile,
    };
    const inputFile = path.join(owned, 'compiler-input.json');
    await fs.writeFile(inputFile, JSON.stringify(input), { flag: 'wx' });
    const execution = await execute(qualifiedNode, [worker, inputFile], {
      cwd: app,
      signal,
      timeoutMs: 180_000,
      active,
    });
    assert.equal(
      execution.exitCode,
      0,
      `Actual selected public SDK compiler failed:\n${execution.stdout}${execution.stderr}`,
    );
    await baselineUnchanged();
    const outputs = [
      ...(await filesIn(clientOutput)),
      ...(await filesIn(serverOutput)),
    ];
    const emitted = outputs.filter(jsFile);
    assert.ok(
      emitted.length >= 2,
      'SDK compilation omitted actual client/server JavaScript',
    );
    const serverFiles = emitted.filter(
      file => inside(serverOutput, file) && path.basename(file) === 'sdk.cjs',
    );
    assert.equal(
      serverFiles.length,
      1,
      'SDK server public entry must compile to exactly one canonical sdk.cjs',
    );
    const clientFiles = emitted.filter(
      file => inside(clientOutput, file) && path.basename(file) === 'sdk.js',
    );
    assert.equal(
      clientFiles.length,
      1,
      'SDK client public entry must compile to exactly one canonical sdk.js',
    );
    const sourceFacts = await Promise.all(
      Object.keys(contents).map(name =>
        evidence(path.join(sourceDirectory, name), root),
      ),
    );
    const outputFacts = await Promise.all(
      outputs.map(file => evidence(file, root)),
    );
    const stats = JSON.parse(await fs.readFile(statsFile, 'utf8'));
    const sourceAdmission = [];
    for (const filename of nativeSourcePaths(stats)) {
      const file = await fs.realpath(filename);
      assert.ok(
        inside(root, file),
        'SDK native source escaped the actual C2 consumer',
      );
      const existing = nativeAllowed.get(file);
      assert.ok(
        existing,
        'SDK installed TSRX source is absent from the authenticated app source admission',
      );
      const digest = sha256(await fs.readFile(file));
      assert.equal(
        digest,
        existing.sourceSha256,
        'SDK installed TSRX source differs from admitted bytes',
      );
      sourceAdmission.push({
        path: path.relative(root, file),
        sourceSha256: digest,
        ...existing,
        authority: 'authenticated-app-installed-source-only',
      });
    }
    let nativeBuild;
    if (renderer === 'octane') {
      const nativeFile = path.join(clientOutput, 'octane-client-build.json');
      nativeBuild = JSON.parse(
        await fs.readFile(await ordinary(nativeFile, owned), 'utf8'),
      );
      assert.equal(nativeBuild.version, 1);
      assert.match(nativeBuild.buildId, /^[a-f0-9]{1,64}$/u);
      const compilationHashes = [];
      const collectHashes = value => {
        if (typeof value.hash === 'string') compilationHashes.push(value.hash);
        for (const child of value.children ?? []) collectHashes(child);
      };
      for (const value of stats) collectHashes(value);
      assert.ok(
        compilationHashes.includes(nativeBuild.buildId),
        'SDK native client build hash is absent from its actual public compiler Stats',
      );
      assert.ok(
        sourceAdmission.length > 0,
        'SDK native compiler Stats omitted installed TSRX source admission',
      );
    }
    const receipt = {
      kind: 'standalone-installed-public-sdk-browser-compilation',
      renderer,
      consumerKind: kind,
      sourceRevision: releaseArtifacts.sourceRevision,
      producerManifestSha256: releaseArtifacts.manifestSha256,
      profile: selected,
      owner,
      ownerPid: Number(ownerPid),
      compilationMode: 'production',
      sources: sourceFacts,
      outputs: outputFacts,
      compilerStats: await evidence(statsFile, root),
      tooling: {
        node: {
          path: qualifiedNode,
          version: process.version,
          sha256: sha256(await fs.readFile(qualifiedNode)),
        },
        compiler: {
          name: compiler.name,
          version: compiler.version,
          entry: path.relative(root, compiler.entry),
          entrySha256: compiler.entrySha256,
          manifestSha256: compiler.manifestSha256,
        },
        rsbuild: {
          name: rsbuild.name,
          version: rsbuild.version,
          entry: path.relative(root, rsbuild.entry),
          entrySha256: rsbuild.entrySha256,
          manifestSha256: rsbuild.manifestSha256,
        },
        driver: await evidence(worker, root),
        loader: await evidence(loader, root),
      },
      command: {
        command: qualifiedNode,
        args: [worker, inputFile],
        exitCode: execution.exitCode,
        stdoutSha256: sha256(execution.stdout),
        stderrSha256: sha256(execution.stderr),
      },
      nativeBuild: nativeBuild
        ? {
            metadata: await evidence(
              path.join(clientOutput, 'octane-client-build.json'),
              root,
            ),
            nativeHydrationBuildId: nativeBuild.buildId,
          }
        : undefined,
      sourceAdmission,
      emissionAuthority:
        'actual-standalone-sdk-javascript-and-public-compiler-build-metadata',
      appNativeManifestScope: 'installed-source-admission-only',
    };
    const entryFiles = [
      ...sourceFacts.map(item => item.path),
      ...emitted.map(file => path.relative(root, file)),
    ];
    const confirmInstalledAudit = audit => {
      assert.equal(audit.renderer, renderer);
      const closure = new Map(
        audit.entryClosure.map(item => [item.path, item.sha256]),
      );
      for (const fact of [
        ...sourceFacts,
        ...outputFacts.filter(item => jsFile(item.path)),
      ])
        assert.equal(
          closure.get(fact.path),
          fact.sha256,
          'Same central auditor did not authenticate every live SDK source and emitted JS file',
        );
      for (const item of sourceAdmission)
        assert.equal(
          closure.get(item.path),
          item.sourceSha256,
          'Same central auditor omitted actual admitted installed TSRX source',
        );
      installedAudit = audit;
    };
    const inputs = new Map();
    const run = async ({
      browser,
      environment,
      identity,
      timeoutMs = 30_000,
    }) => {
      assert.ok(
        !stopped && installedAudit,
        'SDK execution requires its live common installed-artifact audit',
      );
      assert.ok(['development', 'production'].includes(environment));
      assert.ok(
        isDeepStrictEqual(identity, environments[environment].csrIdentity),
        'SDK runtime identity must be the actual owning C2 CSR identity',
      );
      signal?.throwIfAborted();
      await baselineUnchanged();
      for (const fact of [...sourceFacts, ...outputFacts])
        assert.equal(
          sha256(await fs.readFile(path.resolve(root, fact.path))),
          fact.sha256,
          'Live SDK source/output changed before browser execution',
        );
      for (const fact of sourceAdmission) {
        assert.equal(
          sha256(
            await fs.readFile(
              await ordinary(path.resolve(root, fact.path), root),
            ),
          ),
          fact.sourceSha256,
          'Live SDK admitted native source changed before browser execution',
        );
        assert.equal(
          sha256(
            await fs.readFile(
              await ordinary(
                path.join(root, fact.package.path, 'package.json'),
                root,
              ),
            ),
          ),
          fact.package.manifestSha256,
          'Live SDK admitted native package changed before browser execution',
        );
        assert.equal(
          sha256(
            await fs.readFile(
              await ordinary(path.resolve(root, fact.appManifestPath), root),
            ),
          ),
          fact.appManifestSha256,
          'Live SDK app source-admission manifest changed before browser execution',
        );
      }
      if (!serverApi) {
        const actual = await import(pathToFileURL(serverFiles[0]).href);
        serverApi = actual.renderSdkDocument ? actual : actual.default;
        assert.equal(
          typeof serverApi?.renderSdkDocument,
          'function',
          'SDK server compiled public export is missing',
        );
      }
      if (!server) {
        server = http.createServer(async (request, response) => {
          try {
            const url = new URL(request.url, 'http://localhost');
            if (url.pathname === '/favicon.ico') {
              response.statusCode = 204;
              response.end();
              return;
            }
            if (url.pathname.startsWith('/sdk-assets/')) {
              const relative = decodeURIComponent(
                url.pathname.slice('/sdk-assets/'.length),
              );
              assert.ok(
                relative &&
                  !relative
                    .split('/')
                    .some(part => !part || part === '.' || part === '..') &&
                  !relative.includes('\\'),
              );
              const file = await ordinary(
                path.resolve(clientOutput, relative),
                clientOutput,
              );
              response.setHeader(
                'content-type',
                jsFile(file)
                  ? 'text/javascript; charset=utf-8'
                  : file.endsWith('.css')
                    ? 'text/css'
                    : 'application/octet-stream',
              );
              response.end(await fs.readFile(file));
              return;
            }
            const input = inputs.get(url.searchParams.get('c2-sdk'));
            assert.ok(
              input,
              'SDK document request lacks its exact owned run token',
            );
            const html = await serverApi.renderSdkDocument(input);
            const scripts = clientFiles;
            const browserInput = { ...input };
            delete browserInput.signal;
            const prelude = JSON.stringify(browserInput).replaceAll(
              '<',
              '\\u003c',
            );
            const tail =
              '<div id="sdk-mount"></div><div id="sdk-router"></div><script>globalThis.__C2_SDK_INPUT__=' +
              prelude +
              ';globalThis.__C2_SDK_DOCUMENT_MARKER__=' +
              JSON.stringify(input.documentId) +
              ';</script>' +
              scripts
                .map(
                  file =>
                    '<script defer src="/sdk-assets/' +
                    path
                      .relative(clientOutput, file)
                      .split(path.sep)
                      .join('/') +
                    '"></script>',
                )
                .join('');
            assert.ok(
              html.includes('</body>'),
              'SDK owning SSR did not return a real document',
            );
            response.setHeader('content-type', 'text/html; charset=utf-8');
            response.setHeader('cache-control', 'no-store');
            response.end(html.replace('</body>', tail + '</body>'));
          } catch (error) {
            response.statusCode = 500;
            response.end(String(error?.stack ?? error));
          }
        });
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        });
      }
      const token = randomUUID();
      const requestController = new AbortController();
      const abortRequest = () =>
        requestController.abort(
          signal.reason ??
            new Error('Standalone SDK browser execution aborted'),
        );
      signal?.addEventListener('abort', abortRequest, { once: true });
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const input = {
        renderer,
        environment,
        identity,
        documentId: `c2-sdk-${token}`,
        nativeHydrationBuildId: nativeBuild?.buildId,
        url: `${baseUrl}/`,
        signal: requestController.signal,
      };
      inputs.set(token, input);
      const page = await browser.newPage();
      pages.add(page);
      const errors = [];
      page.on('pageerror', error => errors.push(String(error?.stack ?? error)));
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
      });
      try {
        const response = await page.goto(`${baseUrl}/?c2-sdk=${token}`, {
          waitUntil: 'networkidle0',
          timeout: timeoutMs,
        });
        assert.equal(response.status(), 200, 'SDK owning SSR document failed');
        await page.waitForFunction(
          () =>
            Reflect.get(globalThis, '__C2_SDK_READY__') ||
            Reflect.get(globalThis, '__C2_SDK_FAILURE__'),
          { timeout: timeoutMs },
        );
        assert.equal(
          await page.evaluate(() =>
            Reflect.get(globalThis, '__C2_SDK_FAILURE__'),
          ),
          undefined,
          'SDK browser public program failed',
        );
        const before = await page.evaluate(() => ({
          marker: Reflect.get(globalThis, '__C2_SDK_DOCUMENT_MARKER__'),
          adopted: Reflect.get(globalThis, '__C2_SDK_READY__').hydrationAdopted,
        }));
        assert.equal(before.adopted, true);
        for (const id of ['sdk-mount', 'sdk-hydrate']) {
          await page.click(`#${id} [data-sdk-counter]`);
          await page.waitForFunction(
            id =>
              document.getElementById(id)?.querySelector('[data-sdk-counter]')
                ?.textContent === 'Count: 1',
            { timeout: timeoutMs },
            id,
          );
        }
        await page.click('[data-sdk-layout-count]');
        await page.waitForFunction(
          () =>
            document.querySelector('[data-sdk-layout-count]')?.textContent ===
            'Layout: 1',
          { timeout: timeoutMs },
        );
        await page.click('[data-sdk-link]');
        await page.waitForFunction(
          () =>
            location.pathname === '/next' &&
            document.querySelector('[data-sdk-route]')?.textContent ===
              'Next page',
          { timeout: timeoutMs },
        );
        const result = await page.evaluate(() => {
          const ready = Reflect.get(globalThis, '__C2_SDK_READY__');
          return {
            identity: ready.identity,
            publicExports: ready.publicExports,
            namespaceKeys: ready.namespaceKeys,
            hydrationAdopted: ready.hydrationAdopted,
            marker: Reflect.get(globalThis, '__C2_SDK_DOCUMENT_MARKER__'),
            pathname: location.pathname,
            outlet: document.querySelector('[data-sdk-route]')?.textContent,
            layout: document.querySelector('[data-sdk-layout-count]')
              ?.textContent,
          };
        });
        assert.ok(isDeepStrictEqual(result.identity, identity));
        assert.equal(
          result.marker,
          before.marker,
          'SDK Link replaced its document',
        );
        assert.equal(
          result.layout,
          'Layout: 1',
          'SDK navigation reset its layout',
        );
        await page.evaluate(() =>
          Reflect.get(globalThis, '__C2_SDK_READY__').dispose(),
        );
        await page.waitForFunction(
          () =>
            ['sdk-mount', 'sdk-hydrate', 'sdk-router'].every(
              id => document.getElementById(id)?.childNodes.length === 0,
            ),
          { timeout: timeoutMs },
        );
        assert.deepEqual(errors, [], 'SDK browser execution reported errors');
        await baselineUnchanged();
        return {
          publicExports: result.publicExports,
          sdkRuntimeReceipt: {
            kind: 'actual-installed-public-sdk-browser-execution',
            renderer,
            consumerKind: kind,
            environment,
            identity,
            compilation: receipt,
            observations: {
              namespaceKeys: result.namespaceKeys,
              hydrationAdopted: result.hydrationAdopted,
              mountedCounter: 1,
              hydratedCounter: 1,
              routerLinkOutlet: {
                pathname: result.pathname,
                outlet: result.outlet,
                layout: result.layout,
                documentPreserved: result.marker === before.marker,
              },
              rootsRetired: true,
              browserErrors: errors,
            },
          },
        };
      } finally {
        requestController.abort(
          new Error('Standalone SDK browser execution retired'),
        );
        signal?.removeEventListener('abort', abortRequest);
        inputs.delete(token);
        pages.delete(page);
        await page.close();
      }
    };
    return {
      entryFiles,
      receipt,
      sourceAdmission,
      confirmInstalledAudit,
      run,
      stop,
    };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Standalone SDK preparation and cleanup failed',
      );
    }
    throw error;
  }
}
