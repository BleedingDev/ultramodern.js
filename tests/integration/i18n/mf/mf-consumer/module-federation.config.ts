import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const reactVersion = dependencies.react;
const reactDomVersion = dependencies['react-dom'];

export default createModuleFederationConfig({
  name: 'consumer',
  dev: {
    disableDynamicRemoteTypeHints: true,
  },
  remotes: {
    componentRemote:
      'i18nComponentProvider@http://localhost:3006/mf-manifest.json',
    AppRemote: 'i18nAppProvider@http://localhost:3005/mf-manifest.json',
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
    'react-i18next': { singleton: true },
    i18next: { singleton: true },
  },
});
