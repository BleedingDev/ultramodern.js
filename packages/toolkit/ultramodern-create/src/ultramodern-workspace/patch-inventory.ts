export default [
  {
    packageName: '@rsbuild/core',
    version: '2.2.11',
    path: 'patches/@rsbuild__core@2.2.11.patch',
    sha256: '246cd34ea87324a7f9e481b61ed5efea3f1de0543b0fe6f0a1aa338e41087c05',
    repository: true,
    workspace: null,
    reason:
      'Await the public final development compiler hook after native HMR and filesystem setup before completion and watch adapters attach.',
  },
  {
    packageName: '@module-federation/bridge-react',
    version: '2.9.2',
    path: 'patches/@module-federation__bridge-react@2.9.2.patch',
    sha256: '2d8a06e2ef045f877d6b0c5f741053dc8183cb6194f42b704357f426f315d0db',
    repository: true,
    workspace: null,
    reason:
      'Portable React declaration specifiers ([#5130](https://github.com/module-federation/core/pull/5130)).',
  },
  {
    packageName: '@module-federation/dts-plugin',
    version: '2.9.2',
    path: 'patches/@module-federation__dts-plugin@2.9.2.patch',
    sha256: 'f93107fb896839b94ca31491774b920c82a3cc31dda8fd9e53d06b47ad72cba0',
    repository: true,
    workspace: null,
    reason:
      'Bind the type server to port 0 and yield a busy broker port ([#5159](https://github.com/module-federation/core/pull/5159)); execute absolute compilerInstance paths without a shell ([#5131](https://github.com/module-federation/core/pull/5131)); pass the inferred rootDir to the list-files config (the rootDir hunk of [#4947](https://github.com/module-federation/core/pull/4947)). UltraModern renderer hunks: retry native API transport resets within the host attempt cap and report final failures through the public manager callback; await remote type consumption; skip unchanged native type materialization; publish the native DTS worker witness and close that exact worker during compiler shutdown; fork the ESM broker, dev worker and runtime plugin from their .mjs files.',
  },
  {
    packageName: '@module-federation/manifest',
    version: '2.9.2',
    path: 'patches/@module-federation__manifest@2.9.2.patch',
    sha256: 'bbb5b50645aa4f67570bf2a361f92cd24c15a90e471f81057b28e01abbd80f03',
    repository: true,
    workspace: null,
    reason:
      'Load dts-plugin lazily when DTS is disabled ([#5132](https://github.com/module-federation/core/pull/5132)).',
  },
  {
    packageName: '@module-federation/modern-js-v3',
    version: '2.9.2',
    path: 'patches/@module-federation__modern-js-v3@2.9.2.patch',
    sha256: 'fcc16b8d792e472d1491e9354a6968081cd47658197f2c0656469561991263f1',
    repository: true,
    workspace: null,
    reason:
      'Resolve CLI runtime plugins through createRequire in the ESM builds ([#5133](https://github.com/module-federation/core/pull/5133)); constrain stream SSR splitChunks filters ([#4851](https://github.com/module-federation/core/pull/4851)); reset the federation runtime on server repack ([#5152](https://github.com/module-federation/core/pull/5152)); keep SSR runtime plugins out of web-worker builds ([#5155](https://github.com/module-federation/core/pull/5155)); disable server splitChunks for SSR builds ([#5156](https://github.com/module-federation/core/pull/5156)); reload SSR dev pages through the dev-server socket instead of SSRLiveReload ([#5158](https://github.com/module-federation/core/pull/5158)). UltraModern renderer hunk: re-export the public React bridge base entry without React Router imports in every module format.',
  },
  {
    packageName: '@module-federation/node',
    version: '2.7.52',
    path: 'patches/@module-federation__node@2.7.52.patch',
    sha256: 'f54e44940ed53ee3ffd11428734c58a27c96d27374ea00596c746a2ab738a1a5',
    repository: true,
    workspace: null,
    reason:
      'Reset the federation runtime in performReload ([#5152](https://github.com/module-federation/core/pull/5152)) and guard the bundle-only module cache when called from plain Node ([#5158](https://github.com/module-federation/core/pull/5158)).',
  },
  {
    packageName: '@module-federation/rspack',
    version: '2.9.2',
    path: 'patches/@module-federation__rspack@2.9.2.patch',
    sha256: '06641dcd38197ccc8831f0dca7f6ff37b05ee2e771686816cc3d3f3c57c0e8af',
    repository: true,
    workspace: null,
    reason:
      'Load dts-plugin lazily when DTS is disabled ([#5132](https://github.com/module-federation/core/pull/5132)).',
  },
  {
    packageName: '@module-federation/runtime-core',
    version: '2.9.2',
    path: 'patches/@module-federation__runtime-core@2.9.2.patch',
    sha256: 'f7b9f3dcdb48ee9a00b2dfc858f2b403e00355b154142f876ac71648e27a9867',
    repository: true,
    workspace: null,
    reason:
      'Add helpers.global.resetFederationRuntime() for rebuilt server bundles ([#5152](https://github.com/module-federation/core/pull/5152)).',
  },
];
