import { describe, expect, it } from '@rstest/core';
import {
  createRscLayerMatchers,
  enrichServerOnlyDiagnostics,
  getRscPlugins,
} from '../src/plugins/rscConfig';

describe('getRscPlugins', () => {
  const internalDir = '/tmp/internal';

  it('returns no plugins when RSC is disabled', async () => {
    const plugins = await getRscPlugins(false, internalDir);
    expect(plugins).toHaveLength(0);
  });

  it('returns the RSC plugins when enabled (default environments)', async () => {
    const plugins = await getRscPlugins(true, internalDir);
    expect(plugins).toHaveLength(2);
    expect(plugins.map(p => p.name)).toContain('builder:rsc-config');
  });

  it('accepts a custom environments mapping without throwing', async () => {
    const plugins = await getRscPlugins(true, internalDir, {
      server: 'Server',
      client: 'Render',
    });
    expect(plugins).toHaveLength(2);
    expect(plugins.map(p => p.name)).toContain('builder:rsc-config');
  });

  it.each([
    {
      internalDir: '/repo/node_modules/.modern-js',
      route: '/repo/node_modules/.modern-js/main/routes/reviews/page.tsx',
    },
    {
      internalDir: String.raw`C:\repo\node_modules\.modern-js`,
      route: String.raw`C:\repo\node_modules\.modern-js\main\routes\reviews\page.tsx`,
    },
  ])('classifies generated conventional routes as RSC modules', ({
    internalDir,
    route,
  }) => {
    const matchers = createRscLayerMatchers(internalDir);
    expect(matchers.some(matcher => matcher.test(route))).toBe(true);
  });

  it('classifies route data modules outside the generated directory as RSC modules', () => {
    const matchers = createRscLayerMatchers('/repo/node_modules/.modern-js');
    expect(
      matchers.some(matcher =>
        matcher.test('/repo/src/routes/reviews/page.loader.ts?build=client'),
      ),
    ).toBe(true);
  });
});

describe('enrichServerOnlyDiagnostics', () => {
  it('adds environment, layer, and importer chain context to server-only marker diagnostics', () => {
    const appModule = {
      layer: 'client',
      resource: '/repo/src/App.tsx',
    };
    const routeModule = {
      layer: 'ssr',
      resource: '/repo/src/routes/page.tsx',
    };
    const markerModule = {
      layer: 'rsc-common',
      resource: '/repo/node_modules/server-only/index.js',
    };
    const warning = new Error(
      'Critical dependency: the request of a dependency is an expression',
    ) as Error & {
      details?: string;
      module?: typeof markerModule;
    };
    warning.module = markerModule;

    enrichServerOnlyDiagnostics(
      {
        errors: [],
        moduleGraph: {
          getIssuer(module) {
            if (module === markerModule) {
              return routeModule;
            }
            if (module === routeModule) {
              return appModule;
            }
            return null;
          },
        },
        warnings: [warning],
      },
      'web',
    );

    expect(warning.details).toContain(
      '[Modern.js RSC server-only diagnostic context]',
    );
    expect(warning.details).toContain('Environment: web');
    expect(warning.details).toContain(
      'Matched module: /repo/node_modules/server-only/index.js [layer: rsc-common]',
    );
    expect(warning.details).toContain(
      'Importer chain: /repo/src/routes/page.tsx [layer: ssr] -> /repo/src/App.tsx [layer: client]',
    );
  });

  it('adds importer context when the server-only marker message is on an error', () => {
    const markerModule = {
      layer: 'react-server-components',
      resource: '/repo/src/server/db.ts',
    };
    const importerModule = {
      layer: 'client',
      resource: '/repo/src/client.tsx',
    };
    const error = new Error(
      'This module uses server-only and cannot be imported from a Client Component.',
    ) as Error & {
      details?: string;
      module?: typeof markerModule;
    };
    error.module = markerModule;

    enrichServerOnlyDiagnostics(
      {
        errors: [error],
        moduleGraph: {
          getIssuer(module) {
            return module === markerModule ? importerModule : null;
          },
        },
        warnings: [],
      },
      'client',
    );

    expect(error.details).toContain('Environment: client');
    expect(error.details).toContain('/repo/src/server/db.ts');
    expect(error.details).toContain('/repo/src/client.tsx [layer: client]');
  });

  it('leaves unrelated diagnostics unchanged', () => {
    const warning = new Error('A CSS asset warning') as Error & {
      details?: string;
      module?: { layer: string; resource: string };
    };
    warning.details = 'Original warning details';
    warning.module = {
      layer: 'client',
      resource: '/repo/src/styles.css',
    };

    enrichServerOnlyDiagnostics(
      {
        errors: [],
        warnings: [warning],
      },
      'web',
    );

    expect(warning.details).toBe('Original warning details');
  });
});
