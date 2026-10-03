import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run through owned-temp-dir with the qualified PUPPETEER_EXECUTABLE_PATH.
// This tests the published vendor modules, independently of Ultra app admission.
const repo = fileURLToPath(new URL('../..', import.meta.url));
const fixtureRequire = createRequire(
  path.join(repo, 'tests/integration/routes-tanstack-mf/mf-host/package.json'),
);
const vendorRequire = createRequire(
  fixtureRequire.resolve('@module-federation/modern-js-v3/react'),
);
const testsRequire = createRequire(path.join(repo, 'tests/package.json'));
const React = fixtureRequire('react');
const { renderToString } = fixtureRequire('react-dom/server');
const { rspack } = vendorRequire('@rspack/core');
const puppeteer = testsRequire('puppeteer');
const forms = ['cjs', 'esm', 'esm-node'];
const roots = new Map();
const recoveries = new Map();
let directory;
let browser;
let server;
let origin;
let originalNodeEnv;
let originalShouldUpdate;

async function packageRoot(entry) {
  let candidate = path.dirname(entry);
  while (true) {
    try {
      await readFile(path.join(candidate, 'package.json'));
      return candidate;
    } catch {
      const parent = path.dirname(candidate);
      assert.notEqual(parent, candidate, `No package root for ${entry}`);
      candidate = parent;
    }
  }
}

async function linkDependency(name, resolved) {
  const target = path.join(directory, 'node_modules', name);
  await mkdir(path.dirname(target), { recursive: true });
  await symlink(await realpath(await packageRoot(resolved)), target, 'dir');
}

function captureRoot(plugin, App) {
  let Root;
  plugin.setup({
    onBeforeRender() {},
    wrapRoot(wrap) {
      Root = wrap(App);
    },
  });
  assert.equal(typeof Root, 'function');
  return Root;
}

function App() {
  const id = React.useId();
  const [count, setCount] = React.useState(0);
  return React.createElement(
    'button',
    { id: 'app', 'data-react-id': id, onClick: () => setCount(n => n + 1) },
    `counter:${count}`,
  );
}

async function compile(label, packageDirectory, form, mode) {
  const extension = form === 'cjs' ? 'js' : 'mjs';
  const pluginFile = path.join(
    packageDirectory,
    'dist',
    form,
    'ssr-runtime',
    `devPlugin.${extension}`,
  );
  const module = await import(pathToFileURL(pluginFile).href);
  roots.set(label, captureRoot(module.mfSSRDevPlugin(), App));
  const input = path.join(directory, `${label}.mjs`);
  await writeFile(
    input,
    `import React from 'react';
import {createRoot, hydrateRoot} from 'react-dom/client';
import {mfSSRDevPlugin} from ${JSON.stringify(pluginFile)};
function App() {
  const id = React.useId();
  const [count, setCount] = React.useState(0);
  return React.createElement('button', {id:'app', 'data-react-id':id, onClick:()=>setCount(n=>n+1)}, 'counter:'+count);
}
let Root;
mfSSRDevPlugin().setup({onBeforeRender(){},wrapRoot(wrap){Root=wrap(App)}});
window.recoverable=[];
window.startHydration=()=>{
  window.originalApp=document.getElementById('app');
  window.root=hydrateRoot(document.getElementById('root'),React.createElement(Root),{onRecoverableError:error=>window.recoverable.push(error.message)});
};
window.startCSR=()=>{
  window.root=createRoot(document.getElementById('root'));
  window.root.render(React.createElement(Root));
};
window.clientReady=true;
`,
  );
  const compiler = rspack({
    mode,
    context: directory,
    target: 'web',
    entry: input,
    output: { path: path.join(directory, 'build'), filename: `${label}.js` },
    devtool: false,
    optimization: { minimize: false },
    // This is the native MF CLI's browser external, not a fixture repair.
    externals: { '@module-federation/node/utils': 'NOT_USED_IN_BROWSER' },
  });
  try {
    await new Promise((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error) return reject(error);
        if (stats.hasErrors()) {
          return reject(
            new Error(stats.toString({ all: false, errors: true })),
          );
        }
        resolve();
      });
    });
  } finally {
    await new Promise((resolve, reject) =>
      compiler.close(error => (error ? reject(error) : resolve())),
    );
  }
}

before(async () => {
  assert.ok(process.env.OWNED_TEMP_DIR, 'Use owned-temp-dir for this test');
  assert.ok(process.env.PUPPETEER_EXECUTABLE_PATH, 'Use qualified Chrome');
  directory = path.join(process.env.OWNED_TEMP_DIR, 'mf-live-reload');
  await mkdir(directory);
  originalNodeEnv = process.env.NODE_ENV;
  originalShouldUpdate = globalThis.shouldUpdate;
  const metadataResponse = await fetch(
    'https://registry.npmjs.org/@module-federation%2fmodern-js-v3/2.9.1',
  );
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  const archiveResponse = await fetch(metadata.dist.tarball);
  assert.equal(archiveResponse.status, 200);
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  const [algorithm, digest] = metadata.dist.integrity.split('-');
  assert.equal(createHash(algorithm).update(archive).digest('base64'), digest);
  await writeFile(path.join(directory, 'official.tgz'), archive);
  execFileSync('tar', [
    '-xzf',
    path.join(directory, 'official.tgz'),
    '-C',
    directory,
  ]);
  const pristine = path.join(directory, 'package');
  const patched = path.join(directory, 'patched');
  await cp(pristine, patched, { recursive: true });
  const patch = path.join(
    repo,
    'patches/@module-federation__modern-js-v3@2.9.1.patch',
  );
  execFileSync('git', ['apply', '--check', patch], { cwd: patched });
  execFileSync('git', ['apply', patch], { cwd: patched });
  console.log(
    JSON.stringify({
      officialArchive: metadata.dist.tarball,
      integrity: metadata.dist.integrity,
      patchSha256: createHash('sha256')
        .update(await readFile(patch))
        .digest('hex'),
    }),
  );
  await linkDependency('react', fixtureRequire.resolve('react'));
  await linkDependency('react-dom', fixtureRequire.resolve('react-dom/client'));
  await linkDependency(
    '@swc/helpers',
    vendorRequire.resolve('@swc/helpers/package.json'),
  );
  await linkDependency(
    '@module-federation/bridge-react',
    vendorRequire.resolve('@module-federation/bridge-react/data-fetch'),
  );
  for (const form of forms) {
    await compile(`${form}-development`, patched, form, 'development');
    await compile(`${form}-production`, patched, form, 'production');
  }
  await compile('pristine-development', pristine, 'esm', 'development');
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://fixture');
      if (url.pathname.endsWith('.js')) {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(
          await readFile(
            path.join(directory, 'build', path.basename(url.pathname)),
          ),
        );
        return;
      }
      const label = url.searchParams.get('label');
      const Root = roots.get(label);
      assert.ok(Root, `Unknown fixture ${label}`);
      const mode = label.endsWith('production') ? 'production' : 'development';
      process.env.NODE_ENV = mode;
      const count = recoveries.get(label) ?? 0;
      const reload = url.pathname === '/reload';
      if (reload) recoveries.set(label, count + 1);
      globalThis.shouldUpdate = reload && count === 0;
      const html =
        url.pathname === '/csr'
          ? ''
          : renderToString(React.createElement(Root));
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><div id="root">${html}</div><script src="/${label}.js" defer></script>`,
      );
    } catch (error) {
      response.statusCode = 500;
      response.end(error.stack);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: true,
    args: ['--no-sandbox'],
  });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalShouldUpdate === undefined) delete globalThis.shouldUpdate;
  else globalThis.shouldUpdate = originalShouldUpdate;
});

async function openPage(route, label, check) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${origin}${route}?label=${label}`, {
      waitUntil: 'networkidle0',
    });
    await page.waitForFunction(() => window.clientReady === true);
    await check(page, errors);
  } finally {
    await page.close();
  }
}

for (const form of forms) {
  test(`${form}: server script removes itself before native hydration`, async () => {
    await openPage('/ssr', `${form}-development`, async (page, errors) => {
      assert.equal(
        await page.$$eval('#root script', scripts => scripts.length),
        0,
      );
      const initialId = await page.$eval(
        '#app',
        element => element.dataset.reactId,
      );
      await page.evaluate(() => window.startHydration());
      await page.click('#app');
      await page.waitForFunction(
        () => document.getElementById('app').textContent === 'counter:1',
      );
      assert.equal(
        await page.evaluate(
          () => window.originalApp === document.getElementById('app'),
        ),
        true,
      );
      assert.equal(
        await page.$eval('#app', element => element.dataset.reactId),
        initialId,
      );
      assert.deepEqual(await page.evaluate(() => window.recoverable), []);
      assert.deepEqual(errors, []);
    });
  });

  test(`${form}: client mounting creates no executable reload script`, async () => {
    await openPage('/csr', `${form}-development`, async (page, errors) => {
      await page.evaluate(() => window.startCSR());
      await page.waitForSelector('#app');
      assert.equal(
        await page.$$eval('#root script', scripts => scripts.length),
        0,
      );
      assert.deepEqual(errors, []);
    });
  });

  test(`${form}: true server flag performs one native reload`, async () => {
    const label = `${form}-development`;
    recoveries.delete(label);
    await openPage('/reload', label, async (page, errors) => {
      assert.equal(recoveries.get(label), 2);
      assert.equal(
        await page.$$eval('#root script', scripts => scripts.length),
        0,
      );
      assert.deepEqual(errors, []);
    });
  });

  test(`${form}: production SSR and hydration remain script-free`, async () => {
    await openPage('/ssr', `${form}-production`, async (page, errors) => {
      assert.equal(
        await page.$$eval('#root script', scripts => scripts.length),
        0,
      );
      await page.evaluate(() => window.startHydration());
      await page.click('#app');
      await page.waitForFunction(
        () => document.getElementById('app').textContent === 'counter:1',
      );
      assert.equal(
        await page.evaluate(
          () => window.originalApp === document.getElementById('app'),
        ),
        true,
      );
      assert.deepEqual(await page.evaluate(() => window.recoverable), []);
      assert.deepEqual(errors, []);
    });
  });
}

test('pristine native browser module reproduces the rejected script', async () => {
  await openPage('/csr', 'pristine-development', async (page, errors) => {
    await page.evaluate(() => window.startCSR());
    await page.waitForSelector('#app');
    assert.equal(
      await page.$$eval('#root script', scripts => scripts.length),
      1,
    );
    assert.equal(errors.length, 1);
    assert.match(
      errors[0],
      /Encountered a script tag while rendering React component/,
    );
  });
});
