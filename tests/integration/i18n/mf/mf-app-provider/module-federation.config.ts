import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const reactVersion = dependencies.react;
const reactDomVersion = dependencies['react-dom'];

export default createModuleFederationConfig({
  name: 'i18nAppProvider',
  dev: {
    disableDynamicRemoteTypeHints: true,
  },
  filename: 'remoteEntry.js',
  exposes: {
    './export-app': './src/i18n-mf-app-provider/export-app.tsx',
    './export-app-custom': './src/custom/export-app.tsx',
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
    'react-dom/server': {
      singleton: true,
      requiredVersion: reactDomVersion,
      treeShaking: false,
    },
    'react-i18next': {
      singleton: true,
    },
    i18next: {
      singleton: true,
    },
  },
});
