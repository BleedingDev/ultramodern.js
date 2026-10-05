import { rspack } from '@rsbuild/core';
import { emitSolidNativeRouteModule } from '../../src/renderers/solid/routes';

/** Evaluate the generated server router factory against a recording router. */
async function serverRouterFactory() {
  const source = emitSolidNativeRouteModule({
    routes: [{ id: 'layout', isRoot: true, children: [] }],
    mode: 'server',
    basePath: '/admin',
  });
  const { code } = await rspack.experiments.swc.transform(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
    configFile: false,
    swcrc: false,
  });
  const created: Record<string, unknown>[] = [];
  const modules: Record<string, unknown> = {
    '@modern-js/renderer-solid/router': {
      createFileSystemRouteTree: () => ({}),
      createMemoryHistory: (options: unknown) => options,
      createApplicationRouter: (options: Record<string, unknown>) => {
        created.push(options);
        return {};
      },
    },
    '@modern-js/renderer-core/data': { invokeRouteData: () => undefined },
  };
  const exports: Record<string, unknown> = {};
  new Function('require', 'exports', code)(
    (specifier: string) => modules[specifier],
    exports,
  );
  return {
    created,
    createNativeRouter: exports.createNativeRouter as (
      ...args: unknown[]
    ) => unknown,
  };
}

const identity = {
  renderer: 'solid',
  appId: 'nonce-app',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'nonce-build',
};

describe('generated Solid native route module', () => {
  it('gives the per-request server router the document CSP nonce for its scripts', async () => {
    const { created, createNativeRouter } = await serverRouterFactory();
    const request = new Request('https://shop.test/admin/items');
    createNativeRouter(
      identity,
      request,
      {},
      undefined,
      undefined,
      'request-nonce',
    );
    createNativeRouter(identity, request, {});
    expect(created[0]).toMatchObject({
      basepath: '/admin',
      ssr: { nonce: 'request-nonce' },
    });
    expect(created[1]).not.toHaveProperty('ssr');
  });
});
