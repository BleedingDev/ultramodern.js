import path from 'node:path';
import {
  createTanstackRscRouteLayerPlugin,
  TANSTACK_SERVER_ROUTES_FILE,
} from '../../src/cli/rscRouteLayer';

type LayerContext = Parameters<typeof createTanstackRscRouteLayerPlugin>[0];

function collectConfigHook(getContext: LayerContext) {
  const modifyRspackConfig = rstest.fn();
  createTanstackRscRouteLayerPlugin(getContext).setup?.({
    modifyRspackConfig,
  } as never);
  const registration = modifyRspackConfig.mock.calls[0]?.[0];
  if (!registration) throw new Error('Expected the route layer hook');
  expect(registration.order).toBe('post');
  return registration.handler;
}

function createCompilerConfig() {
  const existingPlugin = { name: 'existing' };
  const routeRule = {
    resource: /[/\\]routes\.js$/u,
    layer: 'react-server-components',
  };
  const loaderRule = {
    resource: /[/\\]__rsc_route_data__[/\\][^/\\]+\.js$/u,
    layer: 'react-server-components',
  };
  return {
    config: {
      target: 'web',
      plugins: [existingPlugin],
      module: { rules: [routeRule, loaderRule] },
    },
    existingPlugin,
    routeRule,
    loaderRule,
  };
}

class ModuleReplacement {
  constructor(
    readonly resource: RegExp,
    readonly replacement: string,
  ) {}
}

const internalDirectory = path.resolve('/app/[test]+/node_modules/.modern-js');
const serverUtils = {
  environment: { name: 'service-worker' },
  target: 'web',
  rspack: { NormalModuleReplacementPlugin: ModuleReplacement },
};

describe('TanStack native RSC compiler route phase', () => {
  test('selects the complete owned server table while preserving isolated Flight data', () => {
    const hook = collectConfigHook(() => ({
      internalDirectory,
      entryNames: ['index', 'admin'],
      rsc: { environments: { server: 'service-worker', client: 'client' } },
    }));
    const { config, existingPlugin, routeRule, loaderRule } =
      createCompilerConfig();
    hook(config, serverUtils);

    expect(config.plugins[0]).toBe(existingPlugin);
    expect(config.module.rules.slice(0, 2)).toEqual([routeRule, loaderRule]);
    for (const [offset, entryName] of ['index', 'admin'].entries()) {
      const replacement = config.plugins[
        offset + 1
      ] as unknown as ModuleReplacement;
      const serverRoutes = path.join(
        internalDirectory,
        entryName,
        TANSTACK_SERVER_ROUTES_FILE,
      );
      expect(replacement.replacement).toBe(serverRoutes);
      expect(
        replacement.resource.test(
          path.join(internalDirectory, entryName, 'routes.js'),
        ),
      ).toBe(true);
      expect(
        replacement.resource.test(
          path.join(internalDirectory, 'foreign', 'routes.js'),
        ),
      ).toBe(false);
      expect(
        replacement.resource.test(
          path.join(internalDirectory, entryName, 'routes.server.js'),
        ),
      ).toBe(false);
      expect(
        replacement.resource.test(
          path.join(
            internalDirectory,
            entryName,
            '__rsc_route_data__',
            'loader_0.js',
          ),
        ),
      ).toBe(false);

      const phaseRule = config.module.rules[offset + 2]!;
      expect(phaseRule.layer).toBe('server-side-rendering');
      expect(
        phaseRule.resource.test(
          path.join(internalDirectory, entryName, 'routes.js'),
        ),
      ).toBe(true);
      expect(phaseRule.resource.test(serverRoutes)).toBe(true);
      expect(phaseRule.resource.test(`${serverRoutes}.other`)).toBe(false);
      expect(
        phaseRule.resource.test(
          path.join(
            internalDirectory,
            entryName,
            '__rsc_route_data__',
            'loader_0.js',
          ),
        ),
      ).toBe(false);
      // Both client layout/page and ordinary server page implementations inherit
      // SSR from this table. Only its isolated loader imports override that layer.
      const loader = path.join(
        internalDirectory,
        entryName,
        '__rsc_route_data__',
        'loader_0.js',
      );
      expect(loaderRule.resource.test(loader)).toBe(true);
      expect(loaderRule.layer).toBe('react-server-components');
    }
  });

  test.each([
    {
      rsc: undefined,
      entryNames: ['index'],
      environment: 'service-worker',
      target: 'web',
    },
    {
      rsc: false,
      entryNames: ['index'],
      environment: 'service-worker',
      target: 'web',
    },
    { rsc: true, entryNames: [], environment: 'server', target: 'node' },
    { rsc: true, entryNames: ['index'], environment: 'client', target: 'web' },
    {
      rsc: true,
      entryNames: ['index'],
      environment: 'unrelated-worker',
      target: 'web',
    },
  ])(
    'preserves an unselected compiler: $environment/$target/$rsc',
    ({ rsc, entryNames, environment, target }) => {
      const hook = collectConfigHook(() => ({
        internalDirectory,
        entryNames,
        rsc,
      }));
      const { config, existingPlugin, routeRule, loaderRule } =
        createCompilerConfig();
      hook(config, {
        ...serverUtils,
        environment: { name: environment },
        target,
      });
      expect(config.plugins).toEqual([existingPlugin]);
      expect(config.module.rules).toEqual([routeRule, loaderRule]);
    },
  );

  test('uses the current selected entries and native Node SSR compiler', () => {
    let entryNames = ['index'];
    const hook = collectConfigHook(() => ({
      internalDirectory,
      entryNames,
      rsc: true,
    }));
    entryNames = ['replacement'];
    const { config } = createCompilerConfig();
    hook(config, {
      ...serverUtils,
      environment: { name: 'ssr' },
      target: 'node',
    });
    const replacement = config.plugins[1] as unknown as ModuleReplacement;
    expect(replacement.replacement).toBe(
      path.join(internalDirectory, 'replacement', TANSTACK_SERVER_ROUTES_FILE),
    );
    expect(
      replacement.resource.test(
        path.join(internalDirectory, 'index', 'routes.js'),
      ),
    ).toBe(false);
  });
});
