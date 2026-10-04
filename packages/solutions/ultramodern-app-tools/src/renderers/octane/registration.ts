import type {
  NativeRendererAdapter,
  RendererRegistration,
} from '../../native-composition/renderer-registration';
import { octaneCompilerArtifacts } from './artifacts';
import { createOctaneNativeEntryGenerator } from './entry';
import { octaneCandidateProfile } from './profile';
import { emitOctaneNativeRouteModule } from './routes';
import { assertOctaneEntrySource } from './source';

export const octaneNativeRendererAdapter: NativeRendererAdapter = {
  renderer: 'octane',
  infrastructurePluginName: '@modern-js/renderer-octane-infrastructure',
  profile: octaneCandidateProfile,
  compilerArtifacts: octaneCompilerArtifacts,
  assertSupportedSource: assertOctaneEntrySource,
  createEntryGenerator: createOctaneNativeEntryGenerator,
  emitRouteModule: emitOctaneNativeRouteModule,
  async createCompiler(options) {
    return (await import('./compiler')).createOctaneCompilerPlugin(options);
  },
};

export const octaneRendererRegistration = {
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
} as const satisfies RendererRegistration;
