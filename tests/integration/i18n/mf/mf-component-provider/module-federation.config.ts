import { resolveEffectTsgoCompiler } from '@modern-js/app-tools/config';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
import { dependencies } from './package.json';

const reactVersion = dependencies.react;
const reactDomVersion = dependencies['react-dom'];
const tsgoCompilerInstance = resolveEffectTsgoCompiler({
  from: import.meta.url,
});

export default createModuleFederationConfig({
  name: 'i18nComponentProvider',
  dev: {
    disableDynamicRemoteTypeHints: true,
  },
  dts: {
    generateTypes: {
      compilerInstance: tsgoCompilerInstance,
    },
    tsConfigPath: './tsconfig.mf-types.json',
  },
  filename: 'remoteEntry.js',
  exposes: {
    './Text': './src/components/Text.tsx',
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
      requiredVersion: dependencies['react-i18next'],
    },
    i18next: {
      singleton: true,
      requiredVersion: dependencies.i18next,
    },
  },
});
