const http = require('node:http');

const [runtimePath, recoveryPluginPath, remotePortArgument] =
  process.argv.slice(2);
const { createInstance } = require(runtimePath);
const createManifestRecoveryPlugin =
  require(recoveryPluginPath).default ??
  require(recoveryPluginPath).createModuleFederationManifestRecoveryPlugin;

const remotePort = Number(remotePortArgument);
const remoteOrigin = `http://127.0.0.1:${remotePort}`;
let remoteMode = 'invalid';
let remoteServer;

const healthyManifest = {
  id: 'inventory',
  name: 'inventory',
  metaData: {
    name: 'inventory',
    type: 'app',
    buildInfo: {
      buildVersion: '1.0.0',
      buildName: 'inventory',
    },
    remoteEntry: {
      name: 'remoteEntry.cjs',
      path: '',
      type: 'commonjs-module',
    },
    ssrRemoteEntry: {
      name: 'remoteEntry.cjs',
      path: '',
      type: 'commonjs-module',
    },
    globalName: 'inventory',
    pluginVersion: '2.8.2',
    publicPath: `${remoteOrigin}/`,
    ssrPublicPath: `${remoteOrigin}/`,
  },
  shared: [],
  remotes: [],
  exposes: [
    {
      id: 'inventory:Widget',
      name: 'Widget',
      path: './Widget',
      assets: {
        js: { sync: [], async: [] },
        css: { sync: [], async: [] },
      },
    },
  ],
};

const federation = createInstance({
  name: 'shell',
  remotes: [
    {
      name: 'inventory',
      entry: `${remoteOrigin}/mf-manifest.json`,
    },
  ],
  plugins: [
    createManifestRecoveryPlugin({
      attempts: 2,
      retryDelayMs: 5,
      timeoutMs: 100,
    }),
  ],
});

const extractRuntimeCode = error => {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/RUNTIME-\d+/)?.[0] ?? 'UNKNOWN';
};

const shellServer = http.createServer(async (_request, response) => {
  try {
    const remoteModule = await federation.loadRemote('inventory/Widget');
    response.statusCode = 200;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<main data-mf-status="ready">${remoteModule.default}</main>`);
  } catch (error) {
    const runtimeCode = extractRuntimeCode(error);
    response.statusCode = runtimeCode === 'RUNTIME-003' ? 503 : 500;
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(
      `<main data-mf-status="degraded" data-mf-error="${runtimeCode}">remote unavailable</main>`,
    );
  }
});

const startRemoteServer = () =>
  new Promise(resolve => {
    if (remoteServer) {
      resolve();
      return;
    }

    remoteServer = http.createServer((request, response) => {
      if (request.url === '/mf-manifest.json') {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify(
            remoteMode === 'healthy'
              ? healthyManifest
              : { id: 'inventory', name: 'inventory' },
          ),
        );
        return;
      }

      if (request.url === '/remoteEntry.cjs') {
        response.setHeader('content-type', 'text/javascript');
        response.end(
          'module.exports={init:async()=>{},get:async()=>()=>({default:\'<section data-remote="inventory">inventory live</section>\'})};',
        );
        return;
      }

      response.statusCode = 404;
      response.end('not found');
    });
    remoteServer.listen(remotePort, '127.0.0.1', resolve);
  });

process.on('message', async message => {
  if (message === 'remote-invalid') {
    remoteMode = 'invalid';
    await startRemoteServer();
    process.send?.({ type: 'remote-ready', mode: remoteMode });
  } else if (message === 'remote-healthy') {
    remoteMode = 'healthy';
    await startRemoteServer();
    process.send?.({ type: 'remote-ready', mode: remoteMode });
  } else if (message === 'stop') {
    await Promise.all([
      new Promise(resolve => shellServer.close(resolve)),
      remoteServer
        ? new Promise(resolve => remoteServer.close(resolve))
        : Promise.resolve(),
    ]);
    process.exit(0);
  }
});

shellServer.listen(0, '127.0.0.1', () => {
  process.send?.({
    type: 'shell-ready',
    port: shellServer.address().port,
    pid: process.pid,
  });
});
