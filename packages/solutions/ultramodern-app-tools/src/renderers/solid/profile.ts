import type { RendererBuildProfile } from '../../native-composition/renderer-profile';

export const solidCandidateProfile: RendererBuildProfile = {
  renderer: 'solid',
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
  compiler: { name: '@solidjs/compiler', version: '2.0.0-rc.13' },
  hydration: { name: '@solidjs/web', version: '2.0.0-rc.13' },
  router: {
    name: '@modern-js/renderer-solid',
    version: '3.8.3',
    coreName: '@tanstack/router-core',
    coreVersion: '1.171.32',
  },
  sourceExtensions: ['.tsx', '.ts', '.jsx', '.js'],
  jsxImportSource: '@solidjs/web',
  dependencies: {
    'solid-js': '2.0.0-rc.13',
    '@solidjs/web': '2.0.0-rc.13',
    '@solidjs/signals': '2.0.0-rc.13',
    '@solidjs/compiler': '2.0.0-rc.13',
    '@modern-js/renderer-solid': '3.8.3',
    seroval: '1.6.8',
    'seroval-plugins': '1.6.8',
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
