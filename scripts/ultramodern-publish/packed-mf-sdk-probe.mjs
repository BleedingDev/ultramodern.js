// Serialized into a clean installed workspace by sidecar qualification.
export async function packedMfSdkProbeMain(format) {
  const assert = (await import('node:assert/strict')).default;
  if (format === undefined) {
    const { spawn } = await import('node:child_process');
    for (const condition of ['CJS', 'ESM']) {
      await new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.NODE_PATH;
        delete env.NODE_OPTIONS;
        const child = spawn(
          process.execPath,
          [
            '--experimental-vm-modules',
            '--input-type=module',
            '--eval',
            `await (${packedMfSdkProbeMain.toString()})(${JSON.stringify(condition)});`,
          ],
          { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        let failure;
        let escalation;
        const timer = setTimeout(() => {
          failure = new Error(`${condition} SDK probe timed out`);
          child.kill('SIGTERM');
          escalation = setTimeout(() => child.kill('SIGKILL'), 1_000);
        }, 30_000);
        child.stdout.on('data', data => {
          stdout = (stdout + data).slice(-65_536);
        });
        child.stderr.on('data', data => {
          stderr = (stderr + data).slice(-65_536);
        });
        child.once('error', error => {
          failure = error;
        });
        child.once('close', code => {
          clearTimeout(timer);
          clearTimeout(escalation);
          if (failure || code !== 0) {
            reject(
              new Error(
                `${condition} SDK probe failed (${code})\n${stderr}\n${stdout}`,
                { cause: failure },
              ),
            );
          } else {
            process.stdout.write(stdout);
            resolve();
          }
        });
      });
    }
    return;
  }

  assert.ok(['CJS', 'ESM'].includes(format), 'Unknown SDK export condition');
  const fs = (await import('node:fs')).default;
  const path = (await import('node:path')).default;
  const { createRequire } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const http = (await import('node:http')).default;
  const vm = await import('node:vm');
  assert.equal(
    typeof vm.SourceTextModule,
    'function',
    'SDK qualification requires --experimental-vm-modules',
  );
  const root = fs.realpathSync(process.cwd());
  const name = '@bleedingdev/mf-sdk';
  const installedRequire = createRequire(path.join(root, 'package.json'));
  const cjsPath = fs.realpathSync(installedRequire.resolve(name));
  const esmPath = fs.realpathSync(fileURLToPath(import.meta.resolve(name)));
  for (const entry of [cjsPath, esmPath]) {
    const relative = path.relative(root, entry);
    assert.ok(
      relative.startsWith(`node_modules${path.sep}`),
      'SDK export escaped the clean installed workspace',
    );
  }
  assert.notEqual(cjsPath, esmPath, 'SDK import condition resolved to CJS');
  assert.equal(path.extname(cjsPath), '.cjs', 'SDK require condition drift');
  assert.equal(path.extname(esmPath), '.js', 'SDK import condition drift');
  let packageDirectory = path.dirname(esmPath);
  while (!fs.existsSync(path.join(packageDirectory, 'package.json'))) {
    const parent = path.dirname(packageDirectory);
    assert.notEqual(
      parent,
      packageDirectory,
      'SDK export has no package owner',
    );
    packageDirectory = parent;
  }
  const esmManifest = JSON.parse(
    fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
  );
  assert.equal(esmManifest.name, name, 'SDK import package owner drift');
  assert.equal(
    esmManifest.type,
    'module',
    'SDK import condition is not native ESM',
  );
  const sdk =
    format === 'CJS'
      ? installedRequire(name)
      : await import('@bleedingdev/mf-sdk');
  assert.equal(typeof sdk.loadScriptNode, 'function');

  const routes = new Map();
  let sequence = 0;
  let origin;
  const server = http.createServer((request, response) => {
    const route = routes.get(request.url);
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    route.requests += 1;
    response.once('close', () => {
      route.closed += 1;
    });
    if (route.mode === 'headers-hang') return;
    response.writeHead(route.mode === '503' ? 503 : 200, {
      'content-type': 'application/javascript',
      'x-sdk-probe': route.name,
    });
    if (route.mode === 'body-hang') {
      response.write('/* incomplete remote response */\n');
      return;
    }
    response.end(
      route.mode === 'syntax-error' ? 'export const value =' : route.source,
    );
  });
  const checks = [];
  const entry = (mode = 'healthy', source) => {
    const id = `mf_sdk_probe_${format}_${process.pid}_${++sequence}`;
    const pathname = `/entry-${sequence}.js`;
    const route = {
      name: id,
      mode,
      requests: 0,
      closed: 0,
      source:
        source ?? `module.exports = {renderer: 'octane', value: 'healthy'};`,
    };
    routes.set(pathname, route);
    return { route, url: `${origin}${pathname}` };
  };
  const load = (fixture, fetchHook, type) =>
    sdk.loadScriptNode(fixture.url, {
      attrs: {
        name: fixture.route.name,
        globalName: fixture.route.name,
        ...(type ? { type } : {}),
      },
      ...(fetchHook ? { loaderHook: { fetch: fetchHook } } : {}),
    });
  const boundedFetch =
    (deadline = 250) =>
    async ([url, init]) => {
      assert.deepEqual(init, {}, 'SDK fetch init drift');
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(deadline),
      });
      assert.ok(response.ok, `Remote entry returned HTTP ${response.status}`);
      return response;
    };
  const bounded = async promise => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('SDK API did not settle after cancellation')),
            5_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const waitForClosure = async (fixture, count) => {
    const deadline = Date.now() + 2_000;
    while (fixture.route.closed < count) {
      assert.ok(Date.now() < deadline, 'Cancelled HTTP response stayed open');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const esmGraph = failure => {
    const remote = entry();
    const child = entry();
    const leaf = entry(failure === 'evaluation-error' ? 'healthy' : failure);
    remote.route.source = `
import { value } from './${path.basename(new URL(child.url).pathname)}';
export { value };
export function init() {}
export function get() { return () => value; }`;
    child.route.source = `export { value } from './${path.basename(new URL(leaf.url).pathname)}';`;
    leaf.route.source =
      failure === 'evaluation-error'
        ? "throw new Error('remote evaluation failed'); export const value = 'healthy';"
        : "export const value = 'healthy';";
    return { remote, child, leaf };
  };

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;

    const supplied = entry('healthy', 'throw new Error("Original body ran");');
    const controller = new AbortController();
    let tuple;
    let nativeResponse;
    const suppliedResult = await bounded(
      load(supplied, async args => {
        tuple = args;
        nativeResponse = await fetch(args[0], {
          ...args[1],
          signal: controller.signal,
        });
        assert.equal(
          nativeResponse.headers.get('x-sdk-probe'),
          supplied.route.name,
        );
        await nativeResponse.text();
        return new Response('module.exports = {value: "hook-response"};');
      }),
    );
    assert.deepEqual(tuple, [supplied.url, {}]);
    assert.deepEqual(suppliedResult, { value: 'hook-response' });
    assert.equal(supplied.route.requests, 1);
    checks.push('declared-fetch-tuple-and-returned-response');

    for (const declined of [false, undefined]) {
      const fallback = entry();
      let calls = 0;
      assert.deepEqual(
        await bounded(
          load(fallback, args => {
            calls += 1;
            assert.deepEqual(args, [fallback.url, {}]);
            return declined;
          }),
        ),
        { renderer: 'octane', value: 'healthy' },
      );
      assert.equal(calls, 1);
      assert.equal(fallback.route.requests, 1);
    }
    checks.push('declined-fetch-hook-fallback');

    for (const mode of ['headers-hang', 'body-hang']) {
      const fixture = entry(mode);
      const aborter = new AbortController();
      const reason = new Error(`SDK ${mode} supplied signal cancelled`);
      let timer;
      let bodyStatus;
      try {
        await assert.rejects(
          bounded(
            load(fixture, async ([url, init]) => {
              assert.deepEqual(init, {});
              timer = setTimeout(() => aborter.abort(reason), 150);
              const response = await fetch(url, {
                ...init,
                signal: aborter.signal,
              });
              bodyStatus = response.status;
              return response;
            }),
          ),
          error => error.message.includes(reason.message),
        );
      } finally {
        clearTimeout(timer);
        if (!aborter.signal.aborted) aborter.abort(reason);
      }
      assert.ok(aborter.signal.aborted);
      assert.equal(fixture.route.requests, 1);
      assert.equal(globalThis[fixture.route.name], undefined);
      if (mode === 'body-hang') assert.equal(bodyStatus, 200);
      await waitForClosure(fixture, 1);
      fixture.route.mode = 'healthy';
      assert.equal(
        (await bounded(load(fixture, boundedFetch(1_000)))).value,
        'healthy',
      );
      assert.equal(fixture.route.requests, 2);
      checks.push(`supplied-signal-${mode}-abort-and-retry`);
    }

    const unavailable = entry('503');
    await assert.rejects(
      bounded(load(unavailable, boundedFetch())),
      /Remote entry returned HTTP 503/u,
    );
    assert.equal(globalThis[unavailable.route.name], undefined);
    unavailable.route.mode = 'healthy';
    assert.equal(
      (await bounded(load(unavailable, boundedFetch(1_000)))).value,
      'healthy',
    );
    assert.equal(unavailable.route.requests, 2);
    checks.push('fetch-hook-http-status-and-retry');

    for (const failure of [
      'headers-hang',
      'body-hang',
      'syntax-error',
      'evaluation-error',
    ]) {
      const { remote, child, leaf } = esmGraph(failure);
      await assert.rejects(bounded(load(remote, boundedFetch(), 'esm')));
      assert.equal(remote.route.requests, 1);
      assert.equal(child.route.requests, 1);
      assert.equal(leaf.route.requests, 1);
      assert.equal(globalThis[remote.route.name], undefined);
      leaf.route.mode = 'healthy';
      leaf.route.source = "export const value = 'healthy';";
      const recovered = await bounded(load(remote, boundedFetch(1_000), 'esm'));
      assert.equal(recovered.value, 'healthy');
      assert.equal(remote.route.requests, 2);
      assert.equal(child.route.requests, 2);
      assert.equal(leaf.route.requests, 2);
      checks.push(`esm-import-${failure}-retry`);
    }

    const healthy = entry();
    const stable = entry();
    const evaluations = `${stable.route.name}_evaluations`;
    stable.route.source = `
globalThis[${JSON.stringify(evaluations)}] = (globalThis[${JSON.stringify(evaluations)}] || 0) + 1;
export const value = 'retained';`;
    healthy.route.source = `
export { value } from './${path.basename(new URL(stable.url).pathname)}';`;
    const retained = await bounded(load(healthy, boundedFetch(1_000), 'esm'));
    assert.equal(retained.value, 'retained');
    assert.equal(globalThis[evaluations], 1);
    const { remote, child, leaf } = esmGraph('headers-hang');
    remote.route.source =
      `import './${path.basename(new URL(stable.url).pathname)}';\n` +
      remote.route.source;
    const [bad, good] = await Promise.allSettled([
      bounded(load(remote, boundedFetch(), 'esm')),
      bounded(load(healthy, boundedFetch(1_000), 'esm')),
    ]);
    assert.equal(bad.status, 'rejected');
    assert.equal(good.status, 'fulfilled');
    assert.equal(good.value, retained);
    const stableRequests = stable.route.requests;
    leaf.route.mode = 'healthy';
    assert.equal(
      (await bounded(load(remote, boundedFetch(1_000), 'esm'))).value,
      'healthy',
    );
    assert.equal(child.route.requests, 2);
    assert.equal(stable.route.requests, stableRequests);
    assert.equal(globalThis[evaluations], 1);
    assert.equal(
      await bounded(load(healthy, boundedFetch(1_000), 'esm')),
      retained,
    );
    assert.equal(healthy.route.requests, 1);
    checks.push('failed-esm-graph-preserves-healthy-module-cache');
    process.stdout.write(
      `${JSON.stringify({ probe: 'mf-sdk-node-loader', format, checks })}\n`,
    );
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
  }
}
