import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';

const require = createRequire(import.meta.url);
const reactVersion = (require('react/package.json') as { version: string })
  .version;
const reactDomVersion = (
  require('react-dom/package.json') as { version: string }
).version;

export default createModuleFederationConfig({
  name: 'remote',
  manifest: {
    filePath: 'static',
  },
  filename: 'static/remoteEntry.js',
  exposes: {
    './app': './src/export-App.tsx',
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
    'react-dom/client': {
      singleton: true,
      requiredVersion: reactDomVersion,
      treeShaking: false,
    },
  },
});
