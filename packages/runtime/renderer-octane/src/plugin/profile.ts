import type { RendererBuildProfile } from '@modern-js/renderer-core/adapter';

export const octaneProfile: RendererBuildProfile<'octane'> = {
  renderer: 'octane',
  status: 'preview',
  protocolVersion: 1,
  minimumNode: '26.12.0',
  hmr: {
    editedBoundary: 'may-reset',
    unaffectedComponents: 'preserved',
    document: 'preserved',
    roots: 'single',
    cleanup: 'exactly-once',
  },
  compiler: { name: '@octanejs/rspack-plugin', version: '0.2.4' },
  hydration: {
    name: 'octane',
    version: '0.13.8',
  },
  router: {
    name: '@octanejs/tanstack-router',
    version: '0.2.10',
    coreName: '@tanstack/router-core',
    coreVersion: '1.171.37',
  },
  sourceExtensions: ['.tsx', '.tsrx', '.ts', '.js'],
  jsxImportSource: 'octane',
  dependencies: {
    octane: '0.13.8',
    '@tsrx/oxc': '0.21.0',
    '@octanejs/tanstack-router': '0.2.10',
    '@octanejs/rspack-plugin': '0.2.4',
    '@modern-js/renderer-octane': '3.8.3',
    seroval: '1.6.9',
    'seroval-plugins': '1.6.9',
  },
  capabilities: {
    worker: true,
    moduleFederation: true,
    rsc: false,
    ssg: true,
    i18n: true,
    svgComponent: true,
  },
};
