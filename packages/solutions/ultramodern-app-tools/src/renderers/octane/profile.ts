import type { RendererBuildProfile } from '../../native-composition/renderer-profile';

export const octaneCandidateProfile: RendererBuildProfile = {
  renderer: 'octane',
  status: 'preview',
  protocolVersion: 1,
  minimumNode: '26.7.0',
  hmr: {
    editedBoundary: 'may-reset',
    unaffectedComponents: 'preserved',
    document: 'preserved',
    roots: 'single',
    cleanup: 'exactly-once',
  },
  compiler: { name: '@octanejs/rspack-plugin', version: '0.1.55' },
  hydration: {
    name: 'octane',
    version: '0.7.1+ultramodern.f75bf12ac8be',
  },
  router: {
    name: '@octanejs/tanstack-router',
    version: '0.1.60+ultramodern.6c31d4be4768',
    coreName: '@tanstack/router-core',
    coreVersion: '1.171.15',
  },
  sourceExtensions: ['.tsx', '.tsrx', '.ts', '.js'],
  jsxImportSource: 'octane',
  dependencies: {
    octane:
      'https://github.com/bleedingdev/octane/releases/download/octane%400.7.1%2Bultramodern.f75bf12ac8be/octane-0.7.1%2Bultramodern.f75bf12ac8be.tgz',
    '@octanejs/tanstack-router':
      'https://github.com/bleedingdev/octane/releases/download/%40octanejs%2Ftanstack-router%400.1.60%2Bultramodern.6c31d4be4768/octanejs-tanstack-router-0.1.60%2Bultramodern.6c31d4be4768.tgz',
    '@octanejs/rspack-plugin': '0.1.55',
    '@modern-js/renderer-octane': '3.8.3',
    seroval: '1.6.8',
    'seroval-plugins': '1.6.8',
  },
  capabilities: {
    worker: true,
    moduleFederation: false,
    rsc: false,
    ssg: true,
    i18n: false,
    svgComponent: true,
  },
};
