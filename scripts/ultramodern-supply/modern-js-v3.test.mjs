import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const fixtureRequire = createRequire(
  new URL(
    '../../tests/integration/routes-tanstack-mf/mf-host/package.json',
    import.meta.url,
  ),
);

// Unpatched 2.9.1 wraps the root in SSRLiveReload, a <script> inside the React
// tree that React 19 reports on every client mount. The patch keeps only the
// server-side remote revalidation (module-federation/core#5158 moves the reload
// to the dev-server socket).
test('the SSR dev runtime plugin does not wrap the React root', async () => {
  const { mfSSRDevPlugin } = await import(
    pathToFileURL(
      fixtureRequire.resolve('@module-federation/modern-js-v3/ssr-dev-plugin'),
    ).href
  );
  const hooks = [];
  const record = name => callback => hooks.push({ name, callback });
  mfSSRDevPlugin().setup(
    new Proxy({}, { get: (_target, name) => record(String(name)) }),
  );

  assert.deepEqual(
    hooks.map(hook => hook.name),
    ['onBeforeRender'],
  );
  globalThis.window = {};
  try {
    await hooks[0].callback();
  } finally {
    delete globalThis.window;
  }
  assert.equal('shouldUpdate' in globalThis, false);
});
