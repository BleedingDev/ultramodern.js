import type { MicroVerticalReleaseUi } from '../src/release-envelope/types';

export const reactReleaseUi = (
  buildId: string,
  appId: string,
): MicroVerticalReleaseUi => ({
  rendererIdentity: {
    renderer: 'react',
    appId,
    entryName: 'main',
    protocolVersion: 1,
    buildId,
  },
  rendererProfile: {
    renderer: 'react',
    protocolVersion: 1,
    compiler: { name: '@rsbuild/plugin-react', version: '2.1.1' },
    hydration: { name: 'react-dom', version: '19.3.0' },
    router: {
      name: '@tanstack/react-router',
      version: '1.170.39',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.32',
    },
  },
  routerBindings: {
    main: {
      owner: '@modern-js/plugin-tanstack',
      evidence: 'file-routes',
      defaultProvider: {
        framework: 'tanstack',
        name: '@tanstack/react-router',
        version: '1.170.39',
        coreName: '@tanstack/router-core',
        coreVersion: '1.171.32',
      },
      providers: [
        {
          framework: 'tanstack',
          name: '@tanstack/react-router',
          version: '1.170.39',
          coreName: '@tanstack/router-core',
          coreVersion: '1.171.32',
        },
      ],
    },
  },
});

export const uiBuildArtifactOptions = (buildId: string, appId: string) => {
  const ui = reactReleaseUi(buildId, appId);
  return {
    ui: {
      identity: ui.rendererIdentity,
      profile: ui.rendererProfile,
      routerBindings: ui.routerBindings,
    },
  };
};
