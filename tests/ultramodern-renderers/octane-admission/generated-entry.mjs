import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const admissionRoot = process.cwd();
const workspace = process.argv[2];
assert.ok(workspace, 'Pass the actual owning UltraModern worktree path.');
const require = createRequire(import.meta.url);
const core = path.join(workspace, 'packages/runtime/renderer-core');
const adapter = path.join(workspace, 'packages/runtime/renderer-octane');
const tools = path.join(workspace, 'packages/solutions/ultramodern-app-tools');
const extensions = path.join(
  workspace,
  'packages/solutions/app-tools-extensions',
);
const {
  generatedEntryWorkerProbe,
  pruneRemovedGeneratedEntryArtifact,
  runGeneratedEntryController,
} = await import(
  pathToFileURL(
    path.join(
      workspace,
      'tests/ultramodern-renderers/octane-admission/generated-entry-lifecycle.mjs',
    ),
  )
);
const workerProbe = generatedEntryWorkerProbe();
if (!workerProbe) {
  const { createAdmissionProcessScope } = await import(
    pathToFileURL(
      path.join(
        workspace,
        'tests/ultramodern-renderers/solid-admission/processes.mjs',
      ),
    )
  );
  const artifactCommand = async args => {
    const commands = createAdmissionProcessScope();
    let primary;
    let result;
    try {
      result = await commands.execute('disk-guardian-artifacts', args, {
        timeout: 10_000,
      });
    } catch (error) {
      primary = error;
    }
    try {
      await commands.dispose();
    } catch (error) {
      primary ??= error;
    }
    if (primary) throw primary;
    return result;
  };
  await runGeneratedEntryController({
    script: fileURLToPath(import.meta.url),
    args: [workspace],
    admissionRoot,
    probeParent: path.join(tools, 'node_modules/.cache'),
    register: (probe, ownerPid) =>
      artifactCommand([
        'register',
        probe,
        '--owner',
        'octane-generated-entry-admission',
        '--kind',
        'build',
        '--owner-pid',
        String(ownerPid),
        '--grace-hours',
        '0',
      ]),
    release: probe =>
      pruneRemovedGeneratedEntryArtifact(probe, artifactCommand),
    launchBrowser: () =>
      chromium.launchServer({ headless: true, timeout: 10_000 }),
  });
} else {
  // This source probe follows the owning package's real installed graph. Loading
  // a second private builder or native runtime would invalidate the composition.
  const toolsRequire = createRequire(path.join(tools, 'package.json'));
  const { createRsbuild } = await import(
    pathToFileURL(toolsRequire.resolve('@rsbuild/core'))
  );
  const rsbuildDirectory = path.dirname(
    toolsRequire.resolve('@rsbuild/core/package.json'),
  );
  const { createJiti } = await import(
    pathToFileURL(path.join(rsbuildDirectory, 'compiled/jiti/lib/jiti.mjs'))
  );
  // An owning-source probe uses explicit source exports. This is not packed proof.
  const sourceExports = {
    '@modern-js/renderer-core': path.join(core, 'src/index.ts'),
    '@modern-js/renderer-core/identity': path.join(core, 'src/identity.ts'),
    '@modern-js/renderer-core/session': path.join(core, 'src/session/index.ts'),
    '@modern-js/renderer-core/data': path.join(core, 'src/data/index.ts'),
    '@modern-js/renderer-octane/client': path.join(adapter, 'src/client.ts'),
    '@modern-js/renderer-octane/server': path.join(adapter, 'src/server.ts'),
    '@modern-js/renderer-octane/manifest': path.join(
      adapter,
      'src/manifest.ts',
    ),
  };
  const jiti = createJiti(import.meta.url, {
    tryNative: false,
    alias: sourceExports,
  });
  const { createOctaneCompilerPlugin } = await jiti.import(
    path.join(tools, 'src/renderers/octane/compiler/index.ts'),
  );
  const { createNativeEntryGenerator } = await jiti.import(
    path.join(tools, 'src/native-composition/native-entry.ts'),
  );
  const { resolveRendererProfile } = await jiti.import(
    path.join(tools, 'src/native-composition/renderer-profile.ts'),
  );
  const { defineConfig, resolveUltramodernEntryIdentities } = await jiti.import(
    path.join(tools, 'src/native-composition/index.ts'),
  );
  const { resolveRendererBuildIdentities } = await jiti.import(
    path.join(extensions, 'src/renderer-build-identity.ts'),
  );
  const { createRequestSession } = await jiti.import(
    path.join(core, 'src/session/index.ts'),
  );
  const { validateOctaneModuleManifest, octaneModuleManifestFileName } =
    await jiti.import(path.join(adapter, 'src/manifest.ts'));
  let browser;
  let browserClosure;
  let server;
  let devServer;
  let partialDevServer;
  let devCreation;
  let failure;
  let interruption;
  const interrupted = new AbortController();
  const buildResults = [];
  const nativeShutdownFailures = [];
  const checkpoint = () => {
    if (interruption) throw interruption;
  };
  const closeBrowser = () => {
    if (!browser) return Promise.resolve();
    return (browserClosure ??= (async () => {
      const releases = await Promise.allSettled([
        Promise.resolve().then(() => browser?.close()),
      ]);
      const errors = releases
        .filter(result => result.status === 'rejected')
        .map(result => result.reason);
      if (errors.length)
        throw new AggregateError(
          errors,
          'Generated-entry browser cleanup failed.',
        );
    })());
  };
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      interruption ??= new Error(
        `Generated-entry admission interrupted by ${signal}`,
      );
      interrupted.abort(interruption);
      void closeBrowser().catch(error => nativeShutdownFailures.push(error));
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  const evidence = {
    passed: false,
    owningSourceProbe: true,
    packedPublicProof: false,
  };
  // The controller allocated and registered this exact leaf before worker imports.
  // Native Rsbuild may exit on SIGTERM; its controller still closes owned process
  // groups before removing outputs and releasing the registration.
  const probe = workerProbe;
  assert.ok(
    process.connected,
    'The native worker must have its owning controller.',
  );
  assert.equal(path.dirname(probe), path.join(tools, 'node_modules/.cache'));
  assert.ok(
    path.basename(probe).startsWith('target-ultramodern-octane-generated-'),
  );
  try {
    checkpoint();
    fs.mkdirSync(path.join(probe, 'src'));
    fs.writeFileSync(
      path.join(probe, 'package.json'),
      JSON.stringify({
        name: 'ultramodern-octane-generated-admission',
        version: '1.0.0',
        private: true,
      }),
    );
    const appRequire = createRequire(path.join(probe, 'package.json'));
    const adapterRequire = createRequire(path.join(adapter, 'package.json'));
    const applicationRuntime = fs.realpathSync(appRequire.resolve('octane'));
    assert.equal(
      applicationRuntime,
      fs.realpathSync(adapterRequire.resolve('octane')),
      'The application and owning native adapter must share the real runtime.',
    );
    assert.equal(
      applicationRuntime,
      fs.realpathSync(toolsRequire.resolve('octane')),
      'The application and owning compiler host must share the real runtime.',
    );
    for (const file of ['App.tsx', 'Counter.tsrx', 'plain.ts', 'Lazy.tsx']) {
      let bytes = fs.readFileSync(
        path.join(admissionRoot, 'src', file),
        'utf8',
      );
      if (file === 'App.tsx') bytes += '\nexport { App as default };\n';
      fs.writeFileSync(path.join(probe, 'src', file), bytes);
    }
    const profile = resolveRendererProfile('octane');
    const sourceHostConfigInput = {
      renderer: 'octane',
      source: { entriesDir: './src' },
      server: { ssr: true },
      html: { mountId: 'root' },
    };
    const sourceHostConfigFile = path.join(probe, 'ultramodern.config.ts');
    fs.writeFileSync(
      sourceHostConfigFile,
      `import { defineConfig } from '@modern-js/ultramodern-app-tools';\nexport default defineConfig(${JSON.stringify(sourceHostConfigInput, null, 2)});\n`,
    );
    // Resolve the actual native entry hooks/provider registry. A renderer
    // profile or an installed router import is not provider admission evidence.
    const sourceHostMetadata = await resolveUltramodernEntryIdentities({
      appDirectory: probe,
      config: defineConfig(sourceHostConfigInput),
      command: 'build',
      configFile: sourceHostConfigFile,
    });
    assert.deepEqual(
      sourceHostMetadata.entries.map(entry => entry.entryName),
      ['main'],
    );
    assert.deepEqual(Object.keys(sourceHostMetadata.routerBindings), ['main']);
    checkpoint();
    const packageDirectories = {
      '@modern-js/ultramodern-app-tools': tools,
      '@modern-js/builder': path.join(workspace, 'packages/cli/builder'),
      '@modern-js/renderer-core': core,
      '@modern-js/renderer-octane': adapter,
    };
    const identityOptions = {
      projectRoot: probe,
      renderer: 'octane',
      profile,
      entryNames: ['main'],
      routerBindings: sourceHostMetadata.routerBindings,
      mode: 'production',
      packageName: 'ultramodern-octane-generated-admission',
      inputDirectories: ['src'],
      excludedDirectories: [
        path.join(probe, 'internal'),
        path.join(probe, 'internal-hmr'),
        path.join(probe, 'dist'),
      ],
      configuration: {
        renderer: 'octane',
        source: sourceHostConfigInput.source,
        output: {
          targets: ['web', 'node'],
          distPath: 'dist',
          assetPrefix: '/assets/',
          minimize: false,
        },
        server: { ssr: true },
        html: { mountId: 'root' },
        router: null,
        bff: null,
        deploy: null,
        experiments: {},
      },
      packageDirectories,
      packageResolutionRoots: [tools, adapter],
      frameworkPackages: [
        '@modern-js/ultramodern-app-tools',
        '@modern-js/builder',
        '@modern-js/renderer-core',
        '@modern-js/renderer-octane',
      ],
    };
    const resolved = await resolveRendererBuildIdentities(identityOptions);
    assert.deepEqual(
      resolved.routerBindings,
      sourceHostMetadata.routerBindings,
    );
    const identity = resolved.identities.main;
    const internal = path.join(probe, 'internal');
    const context = {
      renderer: 'octane',
      rendererIdentity: identity,
      profile,
      documentSSR: true,
      basePath: '/',
      appDirectory: probe,
      internalDirectory: internal,
      entrypoint: {
        entry: path.join(probe, 'src/App.tsx'),
        entryName: 'main',
        isMainEntry: true,
        isAutoMount: true,
      },
      modifyRoutes: async routes => routes,
    };
    const generator = createNativeEntryGenerator('octane');
    const entryDirectory = path.join(internal, 'octane/main');
    const clientEntry = path.join(entryDirectory, 'index.ts');
    const serverEntry = path.join(entryDirectory, 'index.server.ts');
    fs.writeFileSync(clientEntry, await generator.client(context));
    fs.writeFileSync(serverEntry, await generator.server(context));
    const alias = Object.fromEntries(
      Object.entries(sourceExports).map(([name, file]) => [`${name}$`, file]),
    );
    const compilations = {};
    for (const target of ['web', 'node']) {
      const host = await createRsbuild({
        cwd: probe,
        rsbuildConfig: {
          plugins: [
            createOctaneCompilerPlugin({
              rendererIdentities: () => resolved.identities,
            }),
            {
              name: `admission:generated-${target}`,
              setup(api) {
                api.onAfterBuild(({ stats }) => {
                  compilations[target] = stats.stats
                    ? stats.stats[0].compilation
                    : stats.compilation;
                });
              },
            },
          ],
          source: {
            entry: { main: target === 'web' ? clientEntry : serverEntry },
            include: [probe],
          },
          output: {
            target,
            assetPrefix: '/assets/',
            distPath: { root: `dist/${target}` },
          },
          tools: {
            rspack: {
              resolve: { alias },
              optimization: { minimize: false },
              ...(target === 'node'
                ? { externals: [], output: { library: { type: 'commonjs2' } } }
                : {}),
            },
          },
        },
      });
      buildResults.push(await host.build());
      checkpoint();
    }
    assert.deepEqual(
      await resolveRendererBuildIdentities(identityOptions),
      resolved,
      'The actual application and framework cohort must stay immutable through production compilation.',
    );
    const clientOutput = path.join(probe, 'dist/web');
    const nativeBuild = JSON.parse(
      fs.readFileSync(
        path.join(clientOutput, 'octane-client-build.json'),
        'utf8',
      ),
    );
    const manifest = validateOctaneModuleManifest(
      JSON.parse(
        fs.readFileSync(
          path.join(clientOutput, octaneModuleManifestFileName('main')),
          'utf8',
        ),
      ),
      identity,
      nativeBuild.buildId,
    );
    assert.notEqual(identity.buildId, nativeBuild.buildId);
    const moduleIdentifiers = Object.values(compilations).flatMap(compilation =>
      [...compilation.modules].map(module => module.identifier()),
    );
    assert.equal(
      moduleIdentifiers.some(id =>
        /node_modules[/\\](?:react|react-dom)(?:[/\\]|$)/u.test(id),
      ),
      false,
    );
    const clientAssets = compilations.web.entrypoints
      .get('main')
      .getFiles()
      .filter(file => file.endsWith('.js'))
      .map(file => ({
        kind: 'script',
        href: `/assets/${file}`,
        scriptType: 'classic',
      }));
    const applicationAssets = new Set(
      manifest.sourceModules
        .filter(
          source =>
            path.resolve(probe, source.resource.split('?')[0]) ===
            path.join(probe, 'src/App.tsx'),
        )
        .flatMap(source => source.assets),
    );
    assert.ok(
      applicationAssets.size > 0,
      'The compiler must identify the actual authored application assets.',
    );
    assert.equal(
      clientAssets.some(asset =>
        applicationAssets.has(asset.href.slice('/assets/'.length)),
      ),
      false,
      'The authored application must load through the generated startup callback.',
    );
    const serverAsset = compilations.node.entrypoints
      .get('main')
      .getFiles()
      .find(file => file.endsWith('.js'));
    const generated = require(path.join(probe, 'dist/node', serverAsset));
    assert.deepEqual(generated.rendererIdentity, identity);
    const render = async (route = '/') => {
      const request = new Request(`http://localhost${route}`);
      const session = createRequestSession({
        request,
        identity,
        platform: { kind: 'node', bindings: {} },
      });
      const context = {
        entry: identity,
        session,
        nativeManifest: manifest,
        assets: clientAssets,
      };
      const response = await (route.startsWith('/csr')
        ? generated.nativeCSRRequestHandler
        : generated.nativeRequestHandler)(request, context);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.equal((await session.completion).state, 'completed');
      return html;
    };
    const ssr = await render();
    assert.match(ssr, /Count: 0/u);
    assert.match(ssr, /Native lazy component/u);
    assert.match(ssr, /<title>Octane admission<\/title>/u);
    const csr = await render('/csr');
    assert.doesNotMatch(csr, /Count: 0/u);
    const bootstrap =
      /(<script[^>]*id="__ULTRAMODERN_RENDERER__"[^>]*>)(.*?)(<\/script>)/su;
    assert.match(ssr, bootstrap);
    const stale = (html, kind) =>
      html.replace(bootstrap, (_, open, value, close) => {
        const data = JSON.parse(value);
        if (kind === 'shared') data.identity.buildId = 'stale-shared-release';
        else data.nativeHydrationBuildId = 'stale-native-compilation';
        return open + JSON.stringify(data) + close;
      });
    server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname.startsWith('/assets/')) {
        const file = path.resolve(
          clientOutput,
          url.pathname.slice('/assets/'.length),
        );
        if (
          !file.startsWith(`${clientOutput}${path.sep}`) ||
          !fs.existsSync(file)
        ) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, {
          'content-type': file.endsWith('.js')
            ? 'text/javascript'
            : 'application/octet-stream',
        });
        response.end(fs.readFileSync(file));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        url.pathname === '/csr'
          ? csr
          : url.pathname === '/stale-shared'
            ? stale(ssr, 'shared')
            : url.pathname === '/stale-native'
              ? stale(ssr, 'native')
              : ssr,
      );
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browserEndpoint = await new Promise((resolve, reject) => {
      const abort = () => {
        process.removeListener('message', ready);
        reject(interruption);
      };
      const ready = message => {
        if (message?.type !== 'generated-entry-browser-ready') return;
        process.removeListener('message', ready);
        interrupted.signal.removeEventListener('abort', abort);
        resolve(message.endpoint);
      };
      process.on('message', ready);
      interrupted.signal.addEventListener('abort', abort, { once: true });
      if (interrupted.signal.aborted) {
        abort();
        return;
      }
      process.send({ type: 'generated-entry-request-browser' }, error => {
        if (error) {
          process.removeListener('message', ready);
          interrupted.signal.removeEventListener('abort', abort);
          reject(error);
        }
      });
    });
    checkpoint();
    browser = await chromium.connect(browserEndpoint, { timeout: 10_000 });
    checkpoint();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let releaseClient;
    const held = new Promise(resolve => {
      releaseClient = resolve;
    });
    await page.route('**/*.js', async route => {
      const file = new URL(route.request().url()).pathname.slice(
        '/assets/'.length,
      );
      if (applicationAssets.has(file)) await held;
      await route.continue();
    });
    await page.goto(origin, { waitUntil: 'commit' });
    await page.locator('[data-testid="counter"]').waitFor();
    await page.locator('[data-testid="lazy"]').waitFor();
    await page.evaluate(() => {
      globalThis.generatedServerCounter = document.querySelector(
        '[data-testid="counter"]',
      );
      globalThis.generatedServerLazy = document.querySelector(
        '[data-testid="lazy"]',
      );
    });
    releaseClient();
    await page.waitForFunction(
      () => globalThis.admissionCounterLifecycle?.mounts === 1,
    );
    await page.locator('[data-testid="lazy"]').waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          globalThis.generatedServerCounter ===
            document.querySelector('[data-testid="counter"]') &&
          globalThis.generatedServerLazy ===
            document.querySelector('[data-testid="lazy"]'),
      ),
      true,
    );
    await page.locator('[data-testid="counter"]').click();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-testid="counter"]')
        ?.textContent.includes('Count: 1'),
    );
    assert.equal(await page.locator('[data-testid="counter"]').count(), 1);
    assert.deepEqual(errors, []);
    await page.close();
    const csrPage = await browser.newPage();
    csrPage.on('pageerror', error => errors.push(error.message));
    await csrPage.goto(`${origin}/csr`);
    await csrPage.locator('[data-testid="counter"]').click();
    await csrPage.waitForFunction(() =>
      document
        .querySelector('[data-testid="counter"]')
        ?.textContent.includes('Count: 1'),
    );
    assert.deepEqual(errors, []);
    await csrPage.close();
    for (const kind of ['shared', 'native']) {
      const rejected = await browser.newPage();
      const failures = [];
      let applicationRequests = 0;
      rejected.on('pageerror', error => failures.push(error.message));
      rejected.on('request', request => {
        const file = new URL(request.url()).pathname.slice('/assets/'.length);
        if (applicationAssets.has(file)) applicationRequests++;
      });
      await rejected.goto(`${origin}/stale-${kind}`);
      await rejected.waitForFunction(
        () => globalThis.admissionCounterLifecycle === undefined,
      );
      assert.ok(
        failures.some(message =>
          /identity|buildId|build id|compilation/iu.test(message),
        ),
        JSON.stringify(failures),
      );
      assert.equal(applicationRequests, 0);
      assert.equal(
        await rejected.evaluate(() => globalThis.admissionCounterLifecycle),
        undefined,
      );
      assert.equal(
        await rejected.locator('[data-testid="counter"]').count(),
        1,
      );
      await rejected.close();
    }
    const devResolved = await resolveRendererBuildIdentities({
      ...identityOptions,
      mode: 'development',
      configuration: {
        renderer: 'octane',
        source: sourceHostConfigInput.source,
        output: { target: 'web', distPath: 'dist/hmr' },
        server: { host: '127.0.0.1', port: 0 },
        html: { mountId: 'root' },
      },
    });
    assert.deepEqual(
      devResolved.routerBindings,
      sourceHostMetadata.routerBindings,
    );
    const devEntry = path.join(probe, 'internal-hmr/octane/main/index.ts');
    const devContext = {
      ...context,
      rendererIdentity: devResolved.identities.main,
      internalDirectory: path.join(probe, 'internal-hmr'),
    };
    fs.writeFileSync(devEntry, await generator.client(devContext));
    const hmrHost = await createRsbuild({
      cwd: probe,
      rsbuildConfig: {
        plugins: [
          createOctaneCompilerPlugin({
            rendererIdentities: () => devResolved.identities,
          }),
        ],
        source: { entry: { main: devEntry }, include: [probe] },
        html: { mountId: 'root' },
        server: { host: '127.0.0.1', port: 0 },
        output: { distPath: { root: 'dist/hmr' } },
        tools: { rspack: { resolve: { alias } } },
      },
    });
    // Creation and listen are the two native steps used by startDevServer().
    // Await creation (never listen) inside the native close hook: listen's own
    // error handler awaits server.close() and would otherwise create a cycle.
    hmrHost.onBeforeStartDevServer(({ server: created }) => {
      partialDevServer = created;
    });
    hmrHost.onCloseDevServer(async () => {
      await devCreation?.catch(() => {});
      try {
        await closeBrowser();
      } catch (error) {
        nativeShutdownFailures.push(error);
      }
    });
    checkpoint();
    devCreation = hmrHost.createDevServer();
    partialDevServer = await devCreation;
    checkpoint();
    devServer = await partialDevServer.listen();
    checkpoint();
    const hmrPage = await browser.newPage();
    const hmrErrors = [];
    hmrPage.on('pageerror', error => hmrErrors.push(error.message));
    await hmrPage.goto(devServer.urls[0], { waitUntil: 'networkidle' });
    await hmrPage.locator('[data-testid="lazy"]').waitFor();
    await hmrPage.waitForFunction(
      () => globalThis.admissionCounterLifecycle?.mounts === 1,
    );
    await hmrPage.locator('[data-testid="counter"]').click();
    await hmrPage.waitForFunction(() =>
      document
        .querySelector('[data-testid="counter"]')
        ?.textContent.includes('Count: 1'),
    );
    const sentinel = await hmrPage.evaluate(() => {
      globalThis.generatedDocumentSentinel = crypto.randomUUID();
      return {
        sentinel: globalThis.generatedDocumentSentinel,
        timeOrigin: performance.timeOrigin,
        location: location.href,
      };
    });
    const counterFile = path.join(probe, 'src/Counter.tsrx');
    fs.writeFileSync(
      counterFile,
      fs.readFileSync(counterFile, 'utf8').replace('Count: ', 'Count HMR: '),
    );
    await hmrPage
      .locator('[data-testid="counter"]')
      .filter({ hasText: 'Count HMR: 1' })
      .waitFor();
    await hmrPage.waitForFunction(
      () => globalThis.admissionCounterLifecycle?.mounts === 2,
    );
    assert.deepEqual(
      await hmrPage.evaluate(() => globalThis.admissionCounterLifecycle),
      { mounts: 2, cleanups: 1 },
    );
    const lazyFile = path.join(probe, 'src/Lazy.tsx');
    fs.writeFileSync(
      lazyFile,
      fs
        .readFileSync(lazyFile, 'utf8')
        .replace('Native lazy component', 'Native lazy HMR'),
    );
    await hmrPage
      .locator('[data-testid="lazy"]')
      .filter({ hasText: 'Native lazy HMR' })
      .waitFor();
    assert.equal(
      await hmrPage.locator('[data-testid="counter"]').innerText(),
      'Count HMR: 1',
    );
    assert.deepEqual(
      await hmrPage.evaluate(() => globalThis.admissionCounterLifecycle),
      { mounts: 2, cleanups: 1 },
    );
    assert.deepEqual(
      await hmrPage.evaluate(() => ({
        sentinel: globalThis.generatedDocumentSentinel,
        timeOrigin: performance.timeOrigin,
        location: location.href,
      })),
      sentinel,
    );
    assert.equal(await hmrPage.locator('[data-testid="counter"]').count(), 1);
    assert.deepEqual(hmrErrors, []);
    await hmrPage.close();
    Object.assign(evidence, {
      passed: true,
      actualGeneratedEntries: true,
      actualFrameworkCohortIdentity: true,
      immutableProductionCohortRechecked: true,
      frameworkCohortDigest: resolved.frameworkCohortDigest,
      compilerDigest: resolved.compilerDigest,
      cacheAllowed: resolved.cacheAllowed,
      promotable: resolved.promotable,
      sharedBuildId: identity.buildId,
      nativeHydrationBuildId: nativeBuild.buildId,
      ssrCounterAndLazyNodesRetained: true,
      csrNativeInteraction: true,
      staleSharedAndNativeBootstrapRejectedBeforeApplicationLoad: true,
      reactRuntimeModules: false,
      nativeSourceModules: manifest.sourceModules.length,
      actualGeneratedEntryNativeLeafAndSiblingHmr: true,
      hmrEditedBoundaryDisposedOnce: true,
      hmrSameDocumentTimeOriginAndLocation: true,
      hmrUnaffectedStateRetained: true,
      hmrLifecycle: { mounts: 2, cleanups: 1 },
      hmrSharedBuildIdPolicy: 'initial-dev-session-snapshot',
      hmrSharedBuildId: devResolved.identities.main.buildId,
    });
  } catch (error) {
    failure = error;
    Object.assign(evidence, { passed: false, failure: String(error) });
  } finally {
    // Finish native creation before closing: an early memoized close cannot see
    // middleware/watchers assigned later. The controller bounds a stuck worker.
    await devCreation?.catch(() => {});
    const releases = await Promise.allSettled([
      closeBrowser(),
      Promise.resolve().then(() =>
        (devServer?.server ?? partialDevServer)?.close(),
      ),
      Promise.resolve().then(() => {
        if (!server) return;
        server.closeAllConnections();
        return new Promise((resolve, reject) =>
          server.close(error => (error ? reject(error) : resolve())),
        );
      }),
      ...buildResults.map(result =>
        Promise.resolve().then(() => result.close()),
      ),
    ]);
    for (const [signal, handler] of handlers)
      process.removeListener(signal, handler);
    const cleanupFailures = [
      ...nativeShutdownFailures,
      ...releases
        .filter(result => result.status === 'rejected')
        .map(result => result.reason),
    ].map(String);
    if (interruption) {
      failure ??= interruption;
      Object.assign(evidence, { passed: false, failure: String(failure) });
    }
    if (cleanupFailures.length) {
      Object.assign(evidence, { passed: false, cleanupFailures });
      failure ??= new Error(cleanupFailures.join('\n'));
    }
    if (process.connected) {
      try {
        await new Promise((resolve, reject) =>
          process.send({ type: 'generated-entry-evidence', evidence }, error =>
            error ? reject(error) : resolve(),
          ),
        );
      } catch (error) {
        failure ??= error;
      }
      process.disconnect();
    }
  }
  if (failure) throw failure;
}
