import type {
  NativeRendererAdapter,
  RendererRegistration,
} from '../../native-composition/renderer-registration';
import { solidCompilerArtifacts } from './artifacts';
import { createSolidNativeEntryGenerator } from './entry';
import { solidCandidateProfile } from './profile';
import { emitSolidNativeRouteModule } from './routes';

export const solidNativeRendererAdapter: NativeRendererAdapter = {
  renderer: 'solid',
  infrastructurePluginName: '@modern-js/renderer-solid-infrastructure',
  profile: solidCandidateProfile,
  compilerArtifacts: solidCompilerArtifacts,
  createEntryGenerator: createSolidNativeEntryGenerator,
  emitRouteModule: emitSolidNativeRouteModule,
  async createCompiler(options) {
    return (await import('./compiler')).pluginSolidRenderer(options);
  },
};

export const solidRendererRegistration = {
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
} as const satisfies RendererRegistration;
