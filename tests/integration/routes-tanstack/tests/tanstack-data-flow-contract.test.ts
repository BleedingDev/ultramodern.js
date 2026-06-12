/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../../..');

const readFixture = (relativePath: string) =>
  fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

// The loader bridge semantics (request construction, splat mapping,
// redirect/notFound translation) live in the package runtime since the
// generated routers stopped inlining them — bridge fixes ship with the
// package instead of requiring every app to regenerate.
const loaderBridgeSource = readFixture(
  '../packages/runtime/plugin-tanstack/src/runtime/loaderBridge.ts',
);

const assertTanstackLoaderContract = (code: string) => {
  // Generated routers import the bridge helpers from the runtime module.
  expect(code).toMatch(
    /import \{[^}]*\bmodernLoaderToTanstack\b[^}]*\} from '@modern-js\/plugin-tanstack\/runtime';/s,
  );
  expect(code).toMatch(
    /import \{[^}]*\bcreateRouteStaticData\b[^}]*\} from '@modern-js\/plugin-tanstack\/runtime';/s,
  );
  expect(code).toMatch(
    /import \{[^}]*\btype ModernRouterContext\b[^}]*\} from '@modern-js\/plugin-tanstack\/runtime';/s,
  );
  expect(code).not.toContain('@modern-js/runtime/tanstack-router');

  // The helpers must not be re-inlined into the generated file.
  expect(code).not.toContain('function modernLoaderToTanstack');
  expect(code).not.toContain('function createRouteStaticData');

  // Every data route binds its modern loader through the bridge and records
  // the modern route identity as static data.
  expect(code).toContain('loader: modernLoaderToTanstack({ hasSplat:');
  expect(code).toContain('staticData: createRouteStaticData({');
  expect(code).toContain('modernRouteId:');
  expect(code).toContain('modernRouteLoader:');
};

const assertLoaderBridgeRuntimeContract = () => {
  // Abort signal handoff and Request construction.
  expect(loaderBridgeSource).toContain(
    'export function modernLoaderToTanstack',
  );
  expect(loaderBridgeSource).toContain('ctx?.abortController?.signal');
  expect(loaderBridgeSource).toContain('ctx?.signal instanceof AbortSignal');
  expect(loaderBridgeSource).toContain('new Request(href, { signal })');

  // TanStack `_splat` params are mapped back to the React Router `*` param
  // that modern loaders expect.
  expect(loaderBridgeSource).toContain('mapSplatParamsForModernLoader');
  expect(loaderBridgeSource).toContain("return { ...rest, '*': _splat }");

  // Response redirects/404s are translated into TanStack semantics for both
  // returned and thrown responses.
  expect(loaderBridgeSource).toContain('if (isRedirectResponse(result))');
  expect(loaderBridgeSource).toContain('throwTanstackRedirect(location)');
  expect(loaderBridgeSource).toContain('if (result.status === 404)');
  expect(loaderBridgeSource).toContain('throw notFound()');
};

describe('tanstack generated data-flow contracts', () => {
  test('string mode router bridges modern loaders to tanstack semantics', () => {
    const code = readFixture(
      'integration/routes-tanstack/src/modern-tanstack/string/router.gen.ts',
    );

    assertTanstackLoaderContract(code);
    assertLoaderBridgeRuntimeContract();
    expect(code).toContain('path: "mutation"');
    expect(code).toContain('route_string_mutation_page');
    expect(code).toContain('createRouter({');
  });

  test('stream mode router preserves redirect and notFound mappings', () => {
    const code = readFixture(
      'integration/routes-tanstack/src/modern-tanstack/stream/router.gen.ts',
    );

    assertTanstackLoaderContract(code);
    assertLoaderBridgeRuntimeContract();
    expect(code).toContain('route_stream_redirect_page');
    expect(code).toContain('route_stream_user__id__page');
    expect(code).toContain('createRouter({');
  });
});
