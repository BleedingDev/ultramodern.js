import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const runtimeVersion = (
  require('@modern-js/runtime/package.json') as { version: string }
).version;
const reactVersion = (require('react/package.json') as { version: string })
  .version;
const reactDomVersion = (
  require('react-dom/package.json') as { version: string }
).version;

export default createModuleFederationConfig({
  name: 'tanstackRemote2',
  treeShakingSharedExcludePlugins: ['RspackModuleFederationPlugin'],
  dev: {
    disableDynamicRemoteTypeHints: true,
  },
  dts: true,
  filename: 'remoteEntry.js',
  exposes: {
    './App': './src/components/RuntimeApp.tsx',
    './Panel': './src/components/Panel.tsx',
  },
  shared: {
    react: {
      singleton: true,
      requiredVersion: reactVersion,
      treeShaking: false,
    },
    'react-dom': {
      singleton: true,
      requiredVersion: reactDomVersion,
      treeShaking: false,
    },
    '@tanstack/react-router': {
      singleton: true,
      requiredVersion: dependencies['@tanstack/react-router'],
      treeShaking: false,
    },
    '@modern-js/runtime': {
      singleton: true,
      requiredVersion: runtimeVersion,
      treeShaking: false,
    },
  },
});
