#!/usr/bin/env node
// Two-app Solid Module Federation proof, built from workspace source.
//
//   /Users/satan/bin/owned-temp-dir --run solid-federation-proof -- \
//     node tests/ultramodern-renderers/solid-federation/proof.mjs
//
// Builds a remote Solid app exposing ./Widget and a Solid host that renders it
// with federatedComponent(), serves both on random loopback ports, and drives
// a headless browser through agent-browser. A React-stamped publication of the
// same container must be rejected by the renderer runtime gate.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const temporary = process.env.OWNED_TEMP_DIR;
assert.ok(temporary, 'Run through owned-temp-dir so the apps have an owner.');
const appTools = path.join(root, 'packages/solutions/ultramodern-app-tools');
const rendererSolid = path.join(root, 'packages/runtime/renderer-solid');
const browserSession = `lane-mf-proof-${process.pid}`;
const real = (from, request) =>
  fs.realpath(path.join(from, 'node_modules', request));

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

// The workspace installs @module-federation/enhanced for the React MF plugin.
async function enhancedPackage() {
  const store = path.join(root, 'node_modules/.pnpm');
  const [candidate] = (await fs.readdir(store))
    .filter(name =>
      name.startsWith('@module-federation+enhanced@2.9.1_@rspack+core@2.2.7_'),
    )
    .sort();
  assert.ok(candidate, 'the workspace store has @module-federation/enhanced');
  return path.join(
    store,
    candidate,
    'node_modules/@module-federation/enhanced',
  );
}

async function linkDependencies(directory) {
  const links = {
    '@modern-js/ultramodern-app-tools': appTools,
    '@modern-js/renderer-solid': rendererSolid,
    '@modern-js/renderer-core': path.join(
      root,
      'packages/runtime/renderer-core',
    ),
    'solid-js': await real(rendererSolid, 'solid-js'),
    '@solidjs/web': await real(rendererSolid, '@solidjs/web'),
    '@solidjs/signals': await real(rendererSolid, '@solidjs/signals'),
    typescript: await real(appTools, 'typescript'),
    '@types/node': await real(appTools, '@types/node'),
    '@module-federation/enhanced': await enhancedPackage(),
  };
  for (const [name, target] of Object.entries(links)) {
    const link = path.join(directory, 'node_modules', name);
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(target, link, 'dir');
  }
}

async function writeApp(directory, files) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(directory, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  await linkDependencies(directory);
}

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: 'ESNext',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    jsx: 'preserve',
    jsxImportSource: '@solidjs/web',
    strict: true,
    noEmit: true,
    types: ['node'],
  },
  include: [
    'modern.config.ts',
    'module-federation.config.ts',
    'src',
    'node_modules/.modern-js',
  ],
});

const packageJson = name =>
  JSON.stringify({
    name,
    private: true,
    type: 'module',
    dependencies: {
      '@modern-js/ultramodern-app-tools': 'workspace',
      '@modern-js/renderer-solid': 'workspace',
      '@modern-js/renderer-core': 'workspace',
      '@module-federation/enhanced': '2.9.1',
      'solid-js': '2.0.0-rc.13',
      '@solidjs/web': '2.0.0-rc.13',
      '@solidjs/signals': '2.0.0-rc.13',
    },
  });

const layout = `import { Outlet } from '@modern-js/renderer-solid/router';
import type { JSX } from '@solidjs/web';
export default function Layout(): JSX.Element {
  return <main><Outlet /></main>;
}
`;

async function ultramodern(directory, command, env) {
  const result = await execute(
    process.execPath,
    [path.join(appTools, 'bin/ultramodern.mjs'), command],
    {
      cwd: directory,
      env: { ...process.env, NODE_PATH: '', ...env },
      maxBuffer: 32 * 1024 * 1024,
    },
  ).catch(error => {
    process.stderr.write(`${error.stdout ?? ''}${error.stderr ?? ''}`);
    throw error;
  });
  return result;
}

function staticServer(directory, extra) {
  const types = {
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.html': 'text/html',
  };
  return createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    const pathname = decodeURIComponent(
      new URL(request.url, 'http://x').pathname,
    );
    if (extra[pathname]) {
      response.setHeader('content-type', 'application/json');
      response.end(extra[pathname]);
      return;
    }
    const file = path.join(directory, path.normalize(pathname));
    if (!file.startsWith(directory)) return void response.writeHead(403).end();
    try {
      const body = await fs.readFile(file);
      response.setHeader(
        'content-type',
        types[path.extname(file)] ?? 'application/octet-stream',
      );
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
}

async function browser(...args) {
  const { stdout } = await execute('agent-browser', args, {
    env: {
      ...process.env,
      AGENT_BROWSER_SESSION: browserSession,
      AGENT_BROWSER_HEADED: 'false',
    },
    maxBuffer: 8 * 1024 * 1024,
    timeout: 60_000,
  });
  return stdout.trim();
}

async function waitFor(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out waiting for ${label}${last ? `: ${last.message}` : ''}`,
  );
}

async function verifyInBrowser() {
  await browser('open', hostUrl);
  await waitFor(
    async () =>
      (await browser('get', 'count', '[data-testid="remote-widget"]')) === '1',
    'remote widget',
  );
  results.owner = await browser(
    'get',
    'attr',
    '[data-testid="remote-widget"]',
    'data-owner',
  );
  results.labelBefore = await browser(
    'get',
    'text',
    '[data-testid="remote-label"]',
  );
  await browser('click', '[data-testid="remote-increment"]');
  await browser('click', '[data-testid="remote-increment"]');
  results.counter = await browser(
    'get',
    'text',
    '[data-testid="remote-increment"]',
  );
  await browser('click', '[data-testid="host-relabel"]');
  results.labelAfter = await browser(
    'get',
    'text',
    '[data-testid="remote-label"]',
  );
  results.reactRejected = await waitFor(
    async () => browser('get', 'text', '[data-testid="react-rejected"]'),
    'React remote rejection',
  );
  results.shareScope = JSON.parse(
    JSON.parse(
      await browser(
        'eval',
        `JSON.stringify((() => {
          const instance = globalThis.__FEDERATION__.__INSTANCES__.find(item => item.name === 'host');
          const scope = instance.shareScopeMap.default;
          return Object.fromEntries(['solid-js', '@solidjs/web', '@solidjs/signals'].map(name => [
            name,
            Object.entries(scope[name] ?? {}).map(([version, shared]) => ({ version, from: shared.from, useIn: shared.useIn, loaded: Boolean(shared.loaded || shared.lib) })),
          ]));
        })())`,
      ),
    ),
  );
  results.pageErrors = await browser('errors');

  assert.equal(results.ssr.fallback, true, 'SSR renders the remote fallback');
  assert.equal(results.ssr.widget, false, 'SSR never renders the remote');
  assert.equal(results.owner, 'host-owned');
  assert.equal(results.labelBefore, 'from host');
  assert.equal(results.counter, 'Count 2');
  assert.equal(results.labelAfter, 'relabelled');
  assert.match(results.reactRejected, /Renderer federation manifest contract/u);
  for (const [name, versions] of Object.entries(results.shareScope))
    assert.equal(versions.length, 1, `${name} has exactly one shared version`);
  results.verdict = 'PASS';
}

const remotePort = await freePort();
const hostPort = await freePort();
const remoteUrl = `http://127.0.0.1:${remotePort}`;
const hostUrl = `http://127.0.0.1:${hostPort}`;
const remoteDirectory = path.join(temporary, 'remote');
const hostDirectory = path.join(temporary, 'host');
let remoteServer;
let host;
const results = {};

try {
  await writeApp(remoteDirectory, {
    'package.json': packageJson('mf-proof-remote'),
    'tsconfig.json': tsconfig,
    'modern.config.ts': `import { defineConfig } from '@modern-js/ultramodern-app-tools';
export default defineConfig({ renderer: 'solid', output: { assetPrefix: '${remoteUrl}/' } });
`,
    'module-federation.config.ts': `export default {
  name: 'remote',
  exposes: { './Widget': './src/components/Widget.tsx' },
};
`,
    'src/routes/layout.tsx': layout,
    'src/routes/page.tsx': `import Widget from '../components/Widget';
export default function Page() { return <Widget label="standalone" />; }
`,
    'src/components/Widget.tsx': `import { createSignal, getOwner } from 'solid-js';
import type { JSX } from '@solidjs/web';
export default function Widget(props: { label: string }): JSX.Element {
  const [count, setCount] = createSignal(0);
  // A second solid-js copy would have no owner: the host renders this component.
  const owner = getOwner() ? 'host-owned' : 'detached';
  return (
    <div data-testid="remote-widget" data-owner={owner}>
      <span data-testid="remote-label">{props.label}</span>
      <button type="button" data-testid="remote-increment" onClick={() => setCount(value => value + 1)}>
        Count {count()}
      </button>
    </div>
  );
}
`,
  });
  await writeApp(hostDirectory, {
    'package.json': packageJson('mf-proof-host'),
    'tsconfig.json': tsconfig,
    'modern.config.ts': `import { defineConfig } from '@modern-js/ultramodern-app-tools';
export default defineConfig({ renderer: 'solid', server: { ssr: true }, output: { assetPrefix: '/' } });
`,
    'module-federation.config.ts': `export default {
  name: 'host',
  remotes: {
    remote: 'remote@${remoteUrl}/mf-manifest.json',
    reactremote: 'reactremote@${remoteUrl}/react/mf-manifest.json',
  },
};
`,
    'src/routes/layout.tsx': layout,
    'src/routes/page.tsx': `import { federatedComponent } from '@modern-js/renderer-solid/federation';
import type { JSX } from '@solidjs/web';
import { createSignal, Errored } from 'solid-js';

const RemoteWidget = federatedComponent<{ label: string }>('remote/Widget', {
  fallback: () => <p data-testid="remote-fallback">Loading remote</p>,
});
const ReactWidget = federatedComponent<{ label: string }>('reactremote/Widget');

export default function Home(): JSX.Element {
  const [label, setLabel] = createSignal('from host');
  return (
    <section>
      <h1 data-testid="host-title">Solid host</h1>
      <button type="button" data-testid="host-relabel" onClick={() => setLabel('relabelled')}>Relabel</button>
      <RemoteWidget label={label()} />
      <Errored fallback={error => <p data-testid="react-rejected">{String(typeof error === 'function' ? error() : error)}</p>}>
        <ReactWidget label="react" />
      </Errored>
    </section>
  );
}
`,
  });

  await ultramodern(remoteDirectory, 'build', { REMOTE_URL: remoteUrl });
  const remoteDist = path.join(remoteDirectory, 'dist');
  const manifest = JSON.parse(
    await fs.readFile(path.join(remoteDist, 'mf-manifest.json'), 'utf8'),
  );
  results.remoteManifest = {
    remoteEntry: manifest.metaData.remoteEntry,
    publicPath: manifest.metaData.publicPath,
    renderer: manifest.metaData.ultramodernRenderer?.profile?.renderer,
    runtime: manifest.metaData.ultramodernRenderer?.runtime,
    shared: manifest.shared.map(item => `${item.name}@${item.version}`).sort(),
  };
  assert.equal(results.remoteManifest.renderer, 'solid');

  // The same container, published under the React renderer tuple.
  const { resolveReactFederationCompatibility } = await import(
    pathToFileURL(
      path.join(
        appTools,
        'dist/esm-node/native-composition/module-federation-renderer-plugin.mjs',
      ),
    ).href
  );
  const react = resolveReactFederationCompatibility();
  const reactManifest = structuredClone(manifest);
  const contract = reactManifest.metaData.ultramodernRenderer;
  reactManifest.name = 'reactremote';
  reactManifest.metaData.name = 'reactremote';
  reactManifest.metaData.ultramodernRenderer = {
    ...contract,
    ...react,
    identities: Object.fromEntries(
      Object.entries(contract.identities).map(([entry, identity]) => [
        entry,
        { ...identity, renderer: 'react' },
      ]),
    ),
  };
  remoteServer = staticServer(remoteDist, {
    '/react/mf-manifest.json': JSON.stringify(reactManifest),
  });
  await new Promise(resolve =>
    remoteServer.listen(remotePort, '127.0.0.1', resolve),
  );

  await ultramodern(hostDirectory, 'build', { REMOTE_URL: remoteUrl });
  host = spawn(
    process.execPath,
    [path.join(appTools, 'bin/ultramodern.mjs'), 'serve'],
    {
      cwd: hostDirectory,
      env: {
        ...process.env,
        NODE_PATH: '',
        PORT: String(hostPort),
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let hostLog = '';
  host.stdout.on('data', chunk => (hostLog += chunk));
  host.stderr.on('data', chunk => (hostLog += chunk));
  const ssr = await waitFor(async () => {
    const response = await fetch(hostUrl);
    return response.ok ? response.text() : undefined;
  }, 'host server').catch(error => {
    process.stderr.write(hostLog);
    throw error;
  });
  results.ssr = {
    fallback: ssr.includes('data-testid="remote-fallback"'),
    widget: ssr.includes('data-testid="remote-widget"'),
  };

  if (process.env.MF_PROOF_HOLD) {
    // Debugging: keep both servers up until this process is terminated.
    process.stdout.write(
      `${JSON.stringify({ hostUrl, remoteUrl, temporary })}\n`,
    );
    await new Promise(resolve => process.once('SIGTERM', resolve));
    results.verdict = 'HELD';
  } else await verifyInBrowser();
} finally {
  if (!results.verdict) {
    results.verdict = 'FAIL';
    results.console = await browser('console').catch(error => String(error));
    results.pageErrors = await browser('errors').catch(error => String(error));
    results.html = await browser('get', 'html', 'body').catch(error =>
      String(error),
    );
    results.probe = await browser(
      'eval',
      `Promise.all([...document.querySelectorAll('script[type=module][src]')].map(script => import(script.src).then(() => script.src + ' ok', error => script.src + ' ' + error.stack))).then(lines => JSON.stringify({ lines, federation: globalThis.__FEDERATION__?.__INSTANCES__?.map(item => item.name) }))`,
    ).catch(error => String(error));
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  await browser('close').catch(() => {});
  host?.kill('SIGTERM');
  await new Promise(resolve =>
    remoteServer ? remoteServer.close(resolve) : resolve(),
  );
}
