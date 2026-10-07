import { createNativeEntryStubGenerator } from '../../native-composition/native-entry';
import type {
  NativeRendererAdapter,
  RendererRegistration,
} from '../../native-composition/renderer-registration';
import { solidCompilerArtifacts } from './artifacts';
import { solidCandidateProfile } from './profile';

export const solidNativeRendererAdapter = Object.freeze<NativeRendererAdapter>({
  renderer: 'solid',
  infrastructurePluginName: '@modern-js/renderer-solid-infrastructure',
  profile: solidCandidateProfile,
  compilerArtifacts: solidCompilerArtifacts,
  compiler: Object.freeze({
    schema: 'ultramodern-native-compiler-activation',
    version: 1,
    renderer: 'solid',
    operation: 'compiler',
    module: Object.freeze({
      source: './src/renderers/solid/compiler/index.ts',
      import: './dist/esm-node/renderers/solid/compiler/index.mjs',
      require: './dist/cjs/renderers/solid/compiler/index.js',
    }),
    export: 'pluginSolidRenderer',
  }),
  lazyStyles: 'renderer',
  createEntryGenerator: () => createNativeEntryStubGenerator('solid'),
});

export const solidRendererRegistration = Object.freeze({
  renderer: 'solid',
  kind: 'native',
  candidateProfile: solidCandidateProfile,
  routerFrameworks: solidCompilerArtifacts.routerFrameworks,
  frameworkModules: [
    {
      specifier: '@modern-js/renderer-solid',
      request: '@modern-js/renderer-solid/manifest',
    },
  ],
  supports: {
    reactCliPlugins: false,
    reactRuntimeDescriptors: false,
    reactCompiler: false,
    cssDeclarations: false,
  },
  nativeAdapter: solidNativeRendererAdapter,
} as const satisfies RendererRegistration);
