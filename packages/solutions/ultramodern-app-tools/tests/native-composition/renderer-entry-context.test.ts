import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { transformSync } from '@swc/core';
import { emitNativeRouteModule } from '../../src/native-composition/native-routes';

interface FactoryOptions {
  request?: Request;
  context: unknown;
  getRouter?: () => unknown;
}

interface RouterOptions {
  context: {
    ultramodern: { rendererIdentity: RendererIdentity };
  };
  basepath: string;
}

describe('generated native route context boundary', () => {
  it.each([
    'solid',
    'octane',
  ] as const)('requires a callable named or default %s search validator', renderer => {
    const source = emitNativeRouteModule({
      renderer,
      routes: [
        {
          id: 'layout',
          isRoot: true,
          modules: { search: './layout.search.ts' },
          children: [],
        },
      ],
      mode: 'server',
      basePath: '/',
    });
    const code = transformSync(source, {
      jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
      module: { type: 'commonjs' },
    }).code;
    const evaluate = (searchModule: object) => {
      const exports: {
        routeModules?: Record<string, { validateSearch?: unknown }>;
      } = {};
      new Function('require', 'exports', code)((name: string) => {
        if (name === './layout.search.ts')
          return { __esModule: true, ...searchModule };
        if (name === `@modern-js/renderer-${renderer}/router`) return {};
        if (name === '@modern-js/renderer-core/data') return {};
        throw new Error(`Unexpected generated route import: ${name}`);
      }, exports);
      return exports.routeModules?.layout?.validateSearch;
    };
    const validateSearch = (search: Record<string, unknown>) => search;
    expect(evaluate({ validateSearch })).toBe(validateSearch);
    expect(evaluate({ default: validateSearch })).toBe(validateSearch);
    expect(() => evaluate({})).toThrow(
      'A native search module must export validateSearch or a default validator',
    );
    expect(() => evaluate({ validateSearch: 'invalid' })).toThrow(
      'A native search module must export validateSearch or a default validator',
    );
  });

  it.each([
    'solid',
    'octane',
  ] as const)('keeps %s private request bindings in loader closures and public identity in native state', renderer => {
    const source = emitNativeRouteModule({
      renderer,
      routes: [{ id: 'layout', isRoot: true, children: [] }],
      mode: 'server',
      basePath: '/catalog',
    });
    const factoryOptions: FactoryOptions[] = [];
    const routerOptions: RouterOptions[] = [];
    const nativeRuntime = {
      createFileSystemRouteTree(
        _routes: unknown,
        _modules: unknown,
        options: FactoryOptions,
      ) {
        factoryOptions.push(options);
        return {};
      },
      createApplicationRouter(options: RouterOptions) {
        routerOptions.push(options);
        return { options };
      },
      createMemoryHistory() {
        return {};
      },
    };
    const exports: {
      createNativeRouter?: (
        identity: RendererIdentity,
        request?: Request,
        context?: object,
      ) => unknown;
    } = {};
    const code = transformSync(source, {
      jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
      module: { type: 'commonjs' },
    }).code;
    // This executes the emitted infrastructure contract; native UI admission
    // remains the responsibility of the actual compiler and browser hosts.
    new Function('require', 'exports', code)((name: string) => {
      if (name === `@modern-js/renderer-${renderer}/router`)
        return nativeRuntime;
      if (name === '@modern-js/renderer-core/data') return {};
      throw new Error(`Unexpected generated route import: ${name}`);
    }, exports);
    const create = exports.createNativeRouter;
    if (!create) throw new Error('The emitted native factory is missing');
    const identity: RendererIdentity = {
      renderer,
      appId: 'context-contract',
      entryName: 'main',
      protocolVersion: 1,
      buildId: 'source-contract-digest',
    };
    const firstRequest = new Request('https://example.test/catalog/one');
    const firstPrivate = { secret: 'first-request', request: firstRequest };
    const firstRouter = create(identity, firstRequest, firstPrivate);
    const secondRequest = new Request('https://example.test/catalog/two');
    const secondPrivate = { secret: 'second-request', request: secondRequest };
    const secondRouter = create(identity, secondRequest, secondPrivate);

    expect(factoryOptions.map(options => options.context)).toEqual([
      firstPrivate,
      secondPrivate,
    ]);
    expect(factoryOptions[0].context).toBe(firstPrivate);
    expect(factoryOptions[1].context).toBe(secondPrivate);
    expect(factoryOptions.map(options => options.request)).toEqual([
      firstRequest,
      secondRequest,
    ]);
    for (const options of routerOptions) {
      expect(Object.keys(options.context)).toEqual(['ultramodern']);
      expect(options.context.ultramodern.rendererIdentity).toEqual(identity);
      expect(Object.isFrozen(options.context.ultramodern)).toBe(true);
      expect(
        Object.isFrozen(options.context.ultramodern.rendererIdentity),
      ).toBe(true);
      expect(options.basepath).toBe('/catalog');
    }
    expect(routerOptions[0].context).not.toBe(routerOptions[1].context);
    if (renderer === 'octane') {
      expect(factoryOptions[0].getRouter?.()).toBe(firstRouter);
      expect(factoryOptions[1].getRouter?.()).toBe(secondRouter);
    }
    expect(() => create(identity, firstRequest, { ultramodern: {} })).toThrow(
      'reserves ultramodern metadata',
    );
    expect(factoryOptions).toHaveLength(2);
  });
});
