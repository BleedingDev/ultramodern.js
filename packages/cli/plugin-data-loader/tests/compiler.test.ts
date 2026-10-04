import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { type Rspack, rspack } from '@rsbuild/core';

const packageRequire = createRequire(
  path.resolve(__dirname, '../package.json'),
);
const serverValue = 'AUTHORED_SERVER_ONLY_INLINE_LOADER';
const routeId = 'main/item/page';
const dataEntry = `./route.data.js?loaderId=loader_0&inline=true&action=true&routeId=${routeId}`;

type CompilationCase = {
  serverTarget: 'node' | 'web';
  server?: boolean;
  clientEntry?: 'data' | 'ordinary';
};

async function withCompilation(
  options: CompilationCase,
  inspect: (stats: Rspack.MultiStats, bundle: string, source: string) => void,
) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-data-compiler-'),
  );
  let compiler: Rspack.MultiCompiler | undefined;
  try {
    const markerEntry = packageRequire.resolve('server-only');
    expect(fs.existsSync(markerEntry)).toBe(true);
    fs.mkdirSync(path.join(directory, 'node_modules'));
    fs.symlinkSync(
      path.dirname(markerEntry),
      path.join(directory, 'node_modules/server-only'),
      'dir',
    );
    fs.writeFileSync(
      path.join(directory, 'route.data.js'),
      `import 'server-only';
export async function loader() { return ${JSON.stringify(serverValue)}; }
export async function action() { return 'AUTHORED_SERVER_ACTION'; }`,
    );
    fs.writeFileSync(
      path.join(directory, 'ordinary.js'),
      `import 'server-only'; export const value = 'ordinary-browser-import';`,
    );
    fs.writeFileSync(
      path.join(directory, 'bootstrap.js'),
      `export const ready = 'native-rsc-companion';`,
    );

    const { Layers, createPlugins } = rspack.experiments.rsc;
    const { ServerPlugin, ClientPlugin } = createPlugins();
    const loaderPath = packageRequire.resolve(
      '@modern-js/plugin-data-loader/loader',
    );
    const configurations: Rspack.Configuration[] = ['server', 'client'].map(
      role => {
        const server = role === 'server';
        const entry = server
          ? options.clientEntry
            ? './bootstrap.js'
            : dataEntry
          : options.clientEntry === 'data'
            ? dataEntry
            : options.clientEntry === 'ordinary'
              ? './ordinary.js'
              : './bootstrap.js';
        return {
          name: role,
          context: directory,
          mode: 'production',
          target: server ? options.serverTarget : 'web',
          devtool: false,
          entry: {
            main: { import: entry, ...(server ? { layer: Layers.rsc } : {}) },
          },
          output: {
            path: path.join(directory, role),
            filename: 'bundle.cjs',
            library: { type: 'commonjs2' },
            globalObject: 'globalThis',
          },
          resolve: { extensions: ['.js', '.mjs', '.json'] },
          module: {
            rules: [
              {
                test: /\.data\.js$/,
                enforce: 'pre',
                use: [
                  {
                    loader: loaderPath,
                    options:
                      server && options.server !== undefined
                        ? { server: options.server }
                        : {},
                  },
                ],
              },
              {
                test: /\.[cm]?js$/,
                exclude: /node_modules/,
                use: [
                  {
                    loader: 'builtin:swc-loader',
                    options: {
                      jsc: {
                        parser: { syntax: 'ecmascript' },
                        target: 'es2022',
                      },
                      rspackExperiments: { reactServerComponents: true },
                    },
                  },
                ],
              },
              ...(server
                ? [
                    {
                      issuerLayer: Layers.rsc,
                      resolve: { conditionNames: ['react-server', '...'] },
                    },
                  ]
                : []),
            ],
          },
          optimization: { minimize: false },
          plugins: [server ? new ServerPlugin() : new ClientPlugin()],
        };
      },
    );
    // Native RSC plugins coordinate while both compilers run. A dependency
    // between them would prevent the companion from reaching that boundary.
    compiler = rspack(configurations);
    const stats = await new Promise<Rspack.MultiStats>((resolve, reject) => {
      compiler!.run((error, result) => {
        if (error) reject(error);
        else if (!result)
          reject(new Error('Native compiler returned no stats'));
        else resolve(result);
      });
    });
    const bundle = path.join(
      directory,
      options.clientEntry ? 'client' : 'server',
      'bundle.cjs',
    );
    inspect(
      stats,
      bundle,
      fs.existsSync(bundle) ? fs.readFileSync(bundle, 'utf8') : '',
    );
  } finally {
    try {
      if (compiler) {
        await new Promise<void>((resolve, reject) => {
          compiler!.close(error => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

function executeBundle(bundle: string, script: string) {
  const result = spawnSync(process.execPath, ['-e', script, bundle], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', NODE_PATH: '' },
  });
  if (result.status !== 0) {
    throw new Error(result.stdout + result.stderr, { cause: result.error });
  }
  return result.stdout;
}

describe('native data loader compilation', () => {
  test.each([
    { serverTarget: 'node' as const },
    { serverTarget: 'web' as const, server: true },
  ])('preserves the RSC inline loader with %j', async options => {
    await withCompilation(options, (stats, bundle, source) => {
      if (stats.hasErrors())
        throw new Error(stats.toString({ all: false, errors: true }));
      expect(source).toContain(serverValue);
      const output = executeBundle(
        bundle,
        `const { loader, action } = require(process.argv[1]);
(async () => {
  process.stdout.write(JSON.stringify({ loader: await loader(), action: await action() }));
})().catch(error => { console.error(error); process.exitCode = 1; });`,
      );
      expect(JSON.parse(output)).toEqual({
        loader: serverValue,
        action: 'AUTHORED_SERVER_ACTION',
      });
    });
  });

  test('compiles browser inline data to the executed RPC client before the native RSC guard', async () => {
    await withCompilation(
      { serverTarget: 'node', clientEntry: 'data' },
      (stats, bundle, source) => {
        if (stats.hasErrors())
          throw new Error(stats.toString({ all: false, errors: true }));
        expect(source).not.toContain(serverValue);
        expect(source).not.toContain('AUTHORED_SERVER_ACTION');
        const output = executeBundle(
          bundle,
          `const assert = require('node:assert/strict');
const http = require('node:http');
const { loader, action } = require(process.argv[1]);
const requests = [];
const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  requests.push({ method: request.method, url: request.url, type: request.headers['content-type'], body: Buffer.concat(chunks).toString() });
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ source: 'real-rpc-endpoint' }));
});
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/item?original=kept';
    const loaded = await loader({ params: {}, request: new Request(url) });
    assert.deepEqual(await loaded.json(), { source: 'real-rpc-endpoint' });
    const posted = await action({ params: {}, request: new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'posted' }) }) });
    assert.deepEqual(await posted.json(), { source: 'real-rpc-endpoint' });
    assert.deepEqual(requests.map(request => request.method), ['GET', 'POST']);
    for (const request of requests) {
      const received = new URL(request.url, url);
      assert.equal(received.searchParams.get('original'), 'kept');
      assert.equal(received.searchParams.get('__loader'), ${JSON.stringify(routeId)});
      assert.equal(received.searchParams.get('__ssrDirect'), 'true');
    }
    assert.equal(requests[1].type, 'application/json');
    assert.deepEqual(JSON.parse(requests[1].body), { value: 'posted' });
    process.stdout.write('native-rpc-executed');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });`,
        );
        expect(output).toBe('native-rpc-executed');
      },
    );
  });

  test('retains the native error for an ordinary browser import of server-only', async () => {
    await withCompilation(
      { serverTarget: 'node', clientEntry: 'ordinary' },
      stats => {
        expect(stats.hasErrors()).toBe(true);
        const error = stats.toString({ all: false, errors: true });
        expect(error).toContain('depends on "server-only"');
        expect(error).toContain('only works in a Server Component');
      },
    );
  });
});
