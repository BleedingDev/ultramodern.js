import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import * as identityModule from '@modern-js/renderer-core/identity';
import { rspack } from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import { nativeCustomServerEntrySource } from '../../src/native-composition/native-infrastructure';

const identity: RendererIdentity = {
  renderer: 'solid',
  appId: 'custom-server',
  entryName: 'main',
  protocolVersion: 1,
  buildId: 'a'.repeat(64),
};

const AUTHORED = '/app/src/index.server.ts';

async function wrapper(authored: Record<string, unknown>) {
  const { code } = await rspack.experiments.swc.transform(
    nativeCustomServerEntrySource(identity, AUTHORED),
    {
      jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' },
      module: { type: 'commonjs' },
    },
  );
  const modules: Record<string, unknown> = {
    '@modern-js/renderer-core/identity': identityModule,
    '@modern-js/renderer-core/server': {
      rejectNativeRscRequest: () => undefined,
    },
    [AUTHORED]: { __esModule: true, ...authored },
  };
  const exports: Record<string, any> = {};
  new Function('require', 'exports', code)((name: string) => {
    if (name in modules) return modules[name];
    throw new Error(`Unexpected generated import: ${name}`);
  }, exports);
  return exports;
}

const request = new Request('https://example.test/items');
const context = {
  entry: identity,
  session: { identity },
} as never;

describe('native custom server entry', () => {
  it('forwards the authored route matcher for ssrByRouteIds', async () => {
    const entry = await wrapper({
      default: () => new Response('custom'),
      nativeMatchRouteIds: async () => ['layout', 'page'],
    });
    expect(await entry.nativeMatchRouteIds(request, context)).toEqual([
      'layout',
      'page',
    ]);
    expect(
      await (await entry.nativeRequestHandler(request, context)).text(),
    ).toBe('custom');
  });

  it('serves CSR documents through the authored CSR handler when it has one', async () => {
    const split = await wrapper({
      nativeRequestHandler: () => new Response('ssr'),
      nativeCSRRequestHandler: () => new Response('csr'),
    });
    expect(
      await (await split.nativeCSRRequestHandler(request, context)).text(),
    ).toBe('csr');
    expect(
      await (await split.nativeRequestHandler(request, context)).text(),
    ).toBe('ssr');
    // Without one, the authored Fetch handler renders every document.
    const single = await wrapper({ default: () => new Response('custom') });
    expect(
      await (await single.nativeCSRRequestHandler(request, context)).text(),
    ).toBe('custom');
  });

  it('names the missing matcher when selective SSR needs one', async () => {
    const entry = await wrapper({ default: () => new Response('custom') });
    await expect(entry.nativeMatchRouteIds(request, context)).rejects.toThrow(
      'ssrByRouteIds requires the native custom server entry to export nativeMatchRouteIds',
    );
  });
});
