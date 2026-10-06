import type {
  RegisteredRenderer,
  RendererBuildProfile,
} from '@modern-js/ultramodern-app-tools';
import { resolveRendererRouterFrameworks } from '@modern-js/ultramodern-app-tools';
import type { RendererGenerationProfile } from './types';
import { NODE_VERSION } from './versions';

export type NativeAppSourceOptions = {
  appId: string;
  title: string;
  entryName: string;
  sourceExtension: RendererGenerationProfile['sourceExtension'];
  jsxImportSource: string;
  capabilities: {
    ssr: boolean;
    federation: boolean;
  };
};

export type NativeAppSources = {
  sourceExtension: RendererGenerationProfile['sourceExtension'];
  jsxImportSource: string;
  artifacts: { path: string; content: string }[];
};

export type RendererGenerationAdapter = {
  renderer: RegisteredRenderer;
  createProfile(selected: RendererBuildProfile): RendererGenerationProfile;
} & (
  | { kind: 'react' }
  | {
      kind: 'native';
      generateAppSources(options: NativeAppSourceOptions): NativeAppSources;
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
      workers: selected.capabilities.worker,
      // Generated federation is the full MF application topology; a
      // client-only federated-component capability does not provide it.
      federation: selected.capabilities.moduleFederation === true,
      rsc: selected.capabilities.rsc,
    },
  };
}

export function nativeRendererDependencies(
  selected: RendererBuildProfile,
): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(selected.dependencies).filter(
        ([name]) => !name.startsWith('@modern-js/'),
      ),
    ),
    [selected.router.coreName]: selected.router.coreVersion,
  };
}
