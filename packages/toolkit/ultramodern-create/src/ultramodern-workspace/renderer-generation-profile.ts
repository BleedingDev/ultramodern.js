import type {
  RendererAppSourceOptions,
  RendererAppSources,
} from '@modern-js/renderer-core/adapter';
import type {
  RegisteredRenderer,
  RendererBuildProfile,
} from '@modern-js/ultramodern-app-tools';
import { resolveRendererRouterFrameworks } from '@modern-js/ultramodern-app-tools';
import type { RendererGenerationProfile } from './types';
import { NODE_VERSION } from './versions';

export type RendererGenerationAdapter = {
  renderer: RegisteredRenderer;
  createProfile(selected: RendererBuildProfile): RendererGenerationProfile;
} & (
  | { kind: 'react' }
  | {
      kind: 'native';
      generateAppSources(options: RendererAppSourceOptions): RendererAppSources;
    }
);

export function createRendererGenerationProfile(
  renderer: RegisteredRenderer,
  selected: RendererBuildProfile,
  packages: Pick<
    RendererGenerationProfile,
    'frameworkDependencies' | 'dependencies' | 'devDependencies'
  > &
    Pick<RendererGenerationProfile, 'typecheckCommand' | 'tsconfig'>,
  templates: { federation: boolean; workers: boolean } = {
    federation: false,
    workers: false,
  },
): RendererGenerationProfile {
  return {
    renderer,
    profile: {
      renderer,
      protocolVersion: selected.protocolVersion,
      compiler: { ...selected.compiler },
      hydration: { ...selected.hydration },
      router: { ...selected.router },
    },
    sourceExtension: '.tsx',
    jsxImportSource: selected.jsxImportSource,
    nodeVersion: NODE_VERSION,
    routerFrameworks: resolveRendererRouterFrameworks(renderer),
    ...packages,
    capabilities: {
      ssr: true,
      streaming: true,
      // Generated workers and federation scaffold whole deployment and MF
      // topologies; they need runtime support and templates that emit them.
      workers: templates.workers && selected.capabilities.worker,
      federation:
        templates.federation && selected.capabilities.moduleFederation === true,
      rsc: selected.capabilities.rsc,
    },
  };
}
