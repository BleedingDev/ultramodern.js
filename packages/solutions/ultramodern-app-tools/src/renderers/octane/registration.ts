import { createNativeEntryStubGenerator } from '../../native-composition/native-entry';
import type {
  NativeRendererAdapter,
  RendererRegistration,
} from '../../native-composition/renderer-registration';
import { octaneCompilerArtifacts } from './artifacts';
import { octaneCandidateProfile } from './profile';
import { assertOctaneEntrySource } from './source';

export const octaneNativeRendererAdapter = Object.freeze<NativeRendererAdapter>(
  {
    renderer: 'octane',
    infrastructurePluginName: '@modern-js/renderer-octane-infrastructure',
    profile: octaneCandidateProfile,
    compilerArtifacts: octaneCompilerArtifacts,
    compiler: Object.freeze({
      schema: 'ultramodern-native-compiler-activation',
      version: 1,
      renderer: 'octane',
      operation: 'compiler',
      module: Object.freeze({
        source: './src/renderers/octane/compiler/index.ts',
        import: './dist/esm-node/renderers/octane/compiler/index.mjs',
        require: './dist/cjs/renderers/octane/compiler/index.js',
      }),
      export: 'createOctaneCompilerPlugin',
    }),
    assertSupportedSource: assertOctaneEntrySource,
    lazyStyles: 'document',
    createEntryGenerator: () =>
      createNativeEntryStubGenerator('octane', {
        // Hydration bytes belong to this exact native client compilation.
        client: {
          declarations: 'declare const __webpack_hash__: string;\n',
          fields: { nativeHydrationBuildId: '__webpack_hash__' },
        },
      }),
  },
);

export const octaneRendererRegistration = Object.freeze({
  renderer: 'octane',
  kind: 'native',
  candidateProfile: octaneCandidateProfile,
  routerFrameworks: octaneCompilerArtifacts.routerFrameworks,
  frameworkModules: [
    {
      specifier: '@modern-js/renderer-octane',
      request: '@modern-js/renderer-octane/manifest',
    },
  ],
  supports: {
    reactCliPlugins: false,
    reactRuntimeDescriptors: false,
    reactCompiler: false,
    cssDeclarations: false,
  },
  nativeAdapter: octaneNativeRendererAdapter,
} as const satisfies RendererRegistration);
