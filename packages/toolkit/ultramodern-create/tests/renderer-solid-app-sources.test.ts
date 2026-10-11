import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { posix } from 'node:path';
import { parse } from '@babel/parser';
import { resolveRendererAdapter } from '@modern-js/ultramodern-app-tools';

/** The Solid adapter's create support generates these sources. */
function generateSolidAppSources(options: any) {
  const adapter = resolveRendererAdapter('solid');
  if (adapter.kind !== 'native' || !adapter.create)
    throw new Error('The solid adapter has no create support');
  return adapter.create.generateAppSources(options);
}

const options = {
  appId: 'solid-shell',
  title: 'Solid shell',
  capabilities: { ssr: false, federation: false },
};

function parseNativeRoutes(result) {
  return result.artifacts.map(artifact => ({
    path: artifact.path,
    program: parse(artifact.content, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    }).program,
  }));
}

test('native source imports resolve within the selected renderer module closure', () => {
  const result = generateSolidAppSources(options);
  const routes = parseNativeRoutes(result);
  assert.equal(result.sourceExtension, '.tsx');
  assert.equal(result.jsxImportSource, '@solidjs/web');
  assert.deepEqual(
    routes.map(route => route.path),
    [
      'src/routes/layout.tsx',
      'src/routes/page.tsx',
      'src/routes/page.head.ts',
      'src/routes/about/page.tsx',
      'src/routes/about/page.head.ts',
      'src/routes/page.data.ts',
      'src/routes/error.tsx',
      'src/routes/not-found.tsx',
      'src/components/Counter.tsx',
      'src/components/Stable.tsx',
    ],
  );
  const artifactPaths = new Set(routes.map(route => route.path));
  const nativeModules = new Set([
    '@solidjs/web',
    'solid-js',
    '@modern-js/renderer-solid/router',
    '@modern-js/renderer-core/data',
  ]);
  for (const { path, program } of routes) {
    const imports = program.body.filter(
      node => node.type === 'ImportDeclaration',
    );
    for (const imported of imports) {
      const source = imported.source.value;
      if (source.startsWith('.')) {
        const target = posix.join(posix.dirname(path), source);
        assert.ok(
          target === 'src/routes/index.css' ||
            artifactPaths.has(`${target}.tsx`) ||
            artifactPaths.has(`${target}.ts`),
          `${path} imports a missing source: ${source}`,
        );
      } else {
        assert.ok(nativeModules.has(source), `${path} imports ${source}`);
      }
    }
    if (path.endsWith('.tsx')) {
      // Route fallbacks (error.tsx, not-found.tsx) type themselves through
      // ErrorRouteComponent/NotFoundRouteComponent and never reference the
      // @solidjs/web JSX namespace directly.
      const jsxTypes = imports.find(
        node => node.source.value === '@solidjs/web',
      );
      if (jsxTypes) assert.equal(jsxTypes.importKind, 'type');
    }
  }
  const layout = routes[0].program.body[1];
  assert.deepEqual(
    layout.specifiers.map(specifier => specifier.imported.name),
    ['Link', 'Outlet'],
  );
});

test('separate state components and native data/action bindings are mounted', () => {
  const result = generateSolidAppSources(options);
  const sources = new Map(
    result.artifacts.map(artifact => [artifact.path, artifact.content]),
  );
  const parsed = parseNativeRoutes(result);
  const home = parsed.find(route => route.path === 'src/routes/page.tsx');
  const router = home.program.body.find(
    node =>
      node.type === 'ImportDeclaration' &&
      node.source.value === '@modern-js/renderer-solid/router',
  );
  assert.deepEqual(
    router.specifiers.map(specifier => specifier.imported.name),
    ['ActionForm', 'Link', 'useLoaderData', 'useRouteAction'],
  );
  assert.match(sources.get('src/routes/layout.tsx'), /<Stable \/>/);
  assert.match(sources.get('src/routes/page.tsx'), /<Counter \/>/);
  assert.match(
    sources.get('src/routes/page.tsx'),
    /<ActionForm action=\{action\}>/,
  );
  for (const accessor of ['pending', 'outcome', 'error']) {
    assert.ok(
      sources.get('src/routes/page.tsx').includes(`action.${accessor}()`),
    );
  }
  assert.match(
    sources.get('src/routes/page.tsx'),
    /JSON\.stringify\(data\(\)\)/,
  );
  for (const component of ['Counter', 'Stable']) {
    const source = sources.get(`src/components/${component}.tsx`);
    assert.match(source, /import \{ createSignal \} from 'solid-js'/);
    assert.match(source, /createSignal\(0\)/);
  }
});

test('emitted loaders preserve request data, not-found, errors and redirects', async () => {
  const source = generateSolidAppSources(options).artifacts.find(
    artifact => artifact.path === 'src/routes/page.data.ts',
  ).content;
  const javascript = stripTypeScriptTypes(source);
  const { loader } = await import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
  );
  assert.deepEqual(
    loader({
      request: new Request('http://localhost/', {
        headers: { 'x-conformance-private': 'private-first' },
      }),
    }),
    { message: 'Native loader value', privateValue: 'private-first' },
  );
  assert.throws(
    () => loader({ request: new Request('http://localhost/?case=not-found') }),
    error => error instanceof Response && error.status === 404,
  );
  assert.throws(
    () => loader({ request: new Request('http://localhost/?case=error') }),
    /Native loader failure/,
  );
  const redirect = loader({
    request: new Request('http://localhost/?case=redirect'),
  });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/about');
});

test('emitted actions preserve validation, redirects, cookies and failures', async () => {
  const source = generateSolidAppSources(options).artifacts.find(
    artifact => artifact.path === 'src/routes/page.data.ts',
  ).content;
  const javascript = stripTypeScriptTypes(source);
  const { action } = await import(
    `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`
  );
  const request = values =>
    new Request('http://localhost/', {
      method: 'POST',
      body: new URLSearchParams(values),
      headers: { 'x-conformance-private': 'private-action' },
    });
  assert.deepEqual(await action({ request: request({ name: 'Ada' }) }), {
    saved: 'Ada',
    privateValue: 'private-action',
  });
  const invalid = await action({ request: request({ name: ' ' }) });
  assert.equal(invalid.status, 422);
  assert.deepEqual(await invalid.json(), {
    fieldErrors: { name: 'Name required' },
  });
  const redirect = await action({
    request: request({ name: 'Ada', intent: 'redirect' }),
  });
  assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get('location'), '/about');
  assert.equal(
    redirect.headers.get('set-cookie'),
    'conformance-saved=1; Path=/; SameSite=Lax',
  );
  await assert.rejects(
    action({ request: request({ name: 'Ada', intent: 'throw' }) }),
    /Native action failure/,
  );
});

test('user-supplied names remain data in valid TypeScript JSX', () => {
  const supplied = {
    ...options,
    appId: 'shell"; throw new Error("injected"); //',
    title: 'A "quoted" title\n</script><script>bad()</script>\u2028',
  };
  const routes = parseNativeRoutes(generateSolidAppSources(supplied));
  const home = routes.find(route => route.path === 'src/routes/page.tsx');
  const declarations = home.program.body.filter(
    node => node.type === 'VariableDeclaration',
  );
  assert.deepEqual(
    declarations.map(node => node.declarations[0].init.value),
    [supplied.appId, supplied.title],
  );
});

test('the same native components serve admitted CSR and SSR hosts', () => {
  assert.deepEqual(
    generateSolidAppSources(options),
    generateSolidAppSources({
      ...options,
      entryName: 'main',
      capabilities: { ssr: true, federation: false },
    }),
  );
});

test('unsupported entry requests fail before artifacts exist', () => {
  assert.throws(
    () => generateSolidAppSources({ ...options, entryName: 'admin' }),
    /main entry only/,
  );
});

test('admitted federation templates keep native routes and expose navigation', () => {
  const sources = parseNativeRoutes(
    generateSolidAppSources({
      ...options,
      capabilities: { ssr: true, federation: true },
    }),
  );
  assert.equal(
    sources.length,
    generateSolidAppSources(options).artifacts.length,
  );
  assert.ok(
    sources
      .find(route => route.path === 'src/routes/layout.tsx')
      .program.body.some(
        node =>
          node.type === 'ImportDeclaration' &&
          node.source.value === '@modern-js/renderer-solid/router',
      ),
  );
});
