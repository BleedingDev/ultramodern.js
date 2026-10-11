import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Each generated entry runs in its own process with a real HTTP server. Only
// the IPv6 socket binding is fault-injected; Node performs the actual fallback.
const childSource = String.raw`
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';

const { templateUrl, ipv6Unavailable, configuredPort } = JSON.parse(process.argv[1]);
let requestedPort = '0';
if (configuredPort) {
  const probe = createServer();
  try {
    const listening = once(probe, 'listening');
    probe.listen(0, '127.0.0.1');
    await listening;
    requestedPort = String(probe.address().port);
  } finally {
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
}
process.env.PORT = requestedPort;

const replacements = {
  p_genPluginImportsCode: '',
  p_ROUTE_SPEC_FILE: "'route.json'",
  p_dynamicProdOptions: '{}',
  p_sharedDirectory: "'shared'",
  p_apiDirectory: "'api'",
  p_lambdaDirectory: "'api/lambda'",
  p_bffRuntimeFramework: "'hono'",
  p_plugins: '[]',
  p_serverDirectory: "'server'",
};
const source = fs.readFileSync(new URL(templateUrl), 'utf8').replace(
  /\bp_[A-Za-z0-9_]+\b/g,
  placeholder => {
    assert.ok(Object.hasOwn(replacements, placeholder), placeholder);
    return replacements[placeholder];
  },
);
const entryUrl = new URL('./listener-test.' + (templateUrl.endsWith('.mjs') ? 'mjs' : 'cjs'), templateUrl).href;
const serverModuleUrl = 'node-deploy-test:prod-server';
const server = createServer((_request, response) => response.end('healthy'));
globalThis.nodeDeployTestServer = server;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === entryUrl) return { url: entryUrl, shortCircuit: true };
    if (specifier === '@modern-js/prod-server') return { url: serverModuleUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === entryUrl) return { format: templateUrl.endsWith('.mjs') ? 'module' : 'commonjs', source, shortCircuit: true };
    if (url === serverModuleUrl) return { format: 'commonjs', source: 'exports.createProdServer = async () => globalThis.nodeDeployTestServer;', shortCircuit: true };
    return nextLoad(url, context);
  },
});

const TCP = process.binding('tcp_wrap').TCP;
const originalBind6 = TCP.prototype.bind6;
let rejectedIpv6Binds = 0;
if (ipv6Unavailable) {
  TCP.prototype.bind6 = function () {
    rejectedIpv6Binds += 1;
    return process.binding('uv').UV_EAFNOSUPPORT;
  };
}
const messages = [];
const originalLog = console.log;
console.log = (...args) => messages.push(args.join(' '));
try {
  const listening = once(server, 'listening');
  await import(entryUrl);
  await listening;
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  assert.ok(address.port > 0);
  if (configuredPort) assert.equal(address.port, Number(requestedPort));
  if (ipv6Unavailable) {
    assert.ok(rejectedIpv6Binds > 0, 'the IPv6 bind must actually fail');
    assert.equal(address.family, 'IPv4');
    assert.equal(address.address, '0.0.0.0');
  } else {
    assert.ok(['::', '0.0.0.0'].includes(address.address));
  }
  const readiness = messages.filter(message => message.includes('Server is listening on'));
  assert.equal(readiness.length, 1);
  const url = readiness[0].match(/http:\/\/[^\s\x1b]+/)[0];
  const expectedHost = address.family === 'IPv6' ? '[::1]' : '127.0.0.1';
  assert.equal(url, 'http://' + expectedHost + ':' + address.port);
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'healthy');
  originalLog(JSON.stringify({ family: address.family, requestedPort, listeningPort: address.port, rejectedIpv6Binds, url }));
} finally {
  console.log = originalLog;
  TCP.prototype.bind6 = originalBind6;
  hooks.deregister();
  server.closeAllConnections();
  if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  delete globalThis.nodeDeployTestServer;
}
`;

for (const format of ['cjs', 'mjs']) {
  const templateUrl = new URL(
    `../../../packages/solutions/app-tools/src/plugins/deploy/platforms/templates/node-entry.${format}`,
    import.meta.url,
  ).href;
  for (const ipv6Unavailable of [false, true]) {
    for (const configuredPort of [false, true]) {
      test(`${format} serves its advertised ${configuredPort ? 'configured' : 'ephemeral'} port with ${ipv6Unavailable ? 'IPv6 unavailable' : 'normal socket support'}`, () => {
        const child = spawnSync(
          process.execPath,
          [
            '--input-type=module',
            '--eval',
            childSource,
            JSON.stringify({ templateUrl, ipv6Unavailable, configuredPort }),
          ],
          { encoding: 'utf8', timeout: 10_000 },
        );
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        const result = JSON.parse(child.stdout.trim());
        assert.ok(result.listeningPort > 0);
        if (ipv6Unavailable) {
          assert.equal(result.family, 'IPv4');
          assert.ok(result.rejectedIpv6Binds > 0);
        }
      });
    }
  }
}
