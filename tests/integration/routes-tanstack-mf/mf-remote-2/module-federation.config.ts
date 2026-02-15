import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const require = createRequire(import.meta.url);
const runtimeVersion = (
  require('@modern-js/runtime/package.json') as { version: string }
).version;

export default createModuleFederationConfig({
  name: 'tanstackRemote2',
  dev: {
    disableDynamicRemoteTypeHints: true,
  },
  filename: 'remoteEntry.js',
  exposes: {
    './Panel': './src/components/Panel.tsx',
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
