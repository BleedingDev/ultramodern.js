import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const runtimeVersion = (
  require('@modern-js/runtime/package.json') as { version: string }
).version;
const remotePort = Number(process.env.MF_REMOTE_PORT ?? 3010);
const remoteTwoPort = Number(process.env.MF_REMOTE_TWO_PORT ?? 3012);

export default createModuleFederationConfig({
  name: 'tanstackHost',
  treeShakingSharedExcludePlugins: ['RspackModuleFederationPlugin'],
  dev: {
    disableDynamicRemoteTypeHints: true,
  },
  remotes: {
    remote: `tanstackRemote@http://localhost:${remotePort}/mf-manifest.json`,
    remote2: `tanstackRemote2@http://localhost:${remoteTwoPort}/mf-manifest.json`,
  },
  shared: {
    react: {
      singleton: true,
      requiredVersion: dependencies.react,
      treeShaking: {
        mode: 'runtime-infer',
      },
    },
    'react-dom': {
      singleton: true,
      requiredVersion: dependencies['react-dom'],
      treeShaking: {
        mode: 'runtime-infer',
      },
    },
    '@tanstack/react-router': {
      singleton: true,
      requiredVersion: dependencies['@tanstack/react-router'],
      treeShaking: {
        mode: 'runtime-infer',
      },
    },
    '@modern-js/runtime': {
      singleton: true,
      requiredVersion: runtimeVersion,
      treeShaking: false,
    },
  },
});
