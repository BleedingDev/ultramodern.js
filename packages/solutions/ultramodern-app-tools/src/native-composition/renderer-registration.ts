import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import type { RouterFramework } from '@modern-js/backend-federation-contracts';
import type { Renderer, RendererIdentity } from '@modern-js/renderer-core';
import { octaneRendererRegistration } from '../renderers/octane/registration';
import { reactRendererRegistration } from '../renderers/react/registration';
import { solidRendererRegistration } from '../renderers/solid/registration';
import type { NativeCompilerArtifacts } from './compiler-artifacts';
import type { NativeEntryGenerator } from './native-infrastructure';
import type { NativeRouteEmissionOptions } from './native-routes';
import type { FrameworkModule } from './renderer-installed-profile';
import type { RendererBuildProfile } from './renderer-profile';

export interface RendererIntegrationCapabilities {
  readonly reactCliPlugins: boolean;
  readonly reactRuntimeDescriptors: boolean;
  readonly reactCompiler: boolean;
  readonly cssDeclarations: boolean;
}

export interface NativeRendererCompilerOptions {
  rendererIdentities(): Readonly<Record<string, RendererIdentity>>;
}

/** Source is provenance; activation loads the owning emitted Node compiler. */
export interface NativeRendererCompilerActivation {
  readonly schema: 'ultramodern-native-compiler-activation';
  readonly version: 1;
  readonly renderer: Renderer;
  readonly operation: 'compiler';
  readonly module: {
    readonly source: string;
    readonly import: string;
    readonly require: string;
  };
  readonly export: string;
}

export interface NativeRendererAdapter {
  readonly renderer: Renderer;
  readonly infrastructurePluginName: string;
  readonly profile: RendererBuildProfile;
  readonly compilerArtifacts: NativeCompilerArtifacts;
  readonly compiler: NativeRendererCompilerActivation;
  assertSupportedSource?(source: string | false | undefined): Promise<void>;
  createEntryGenerator(): NativeEntryGenerator;
  emitRouteModule(options: NativeRouteEmissionOptions): string;
}

interface RendererRegistrationMetadata {
  readonly renderer: Renderer;
  readonly candidateProfile: RendererBuildProfile;
  readonly routerFrameworks: readonly RouterFramework[];
  readonly frameworkModules: readonly {
    readonly specifier: string;
    readonly request: string;
  }[];
  resolveBuildFrameworkModules?(context: {
    readonly appDirectory: string;
    readonly registrarDirectory: string;
    readonly pluginNames: readonly string[];
  }): readonly FrameworkModule[];
  readonly supports: RendererIntegrationCapabilities;
}

export type RendererRegistration = RendererRegistrationMetadata &
  (
    | {
        readonly kind: 'native';
        readonly nativeAdapter: NativeRendererAdapter;
      }
    | {
        readonly kind: 'composed';
        compose(
          consumerPlugins: readonly CliPlugin<AppTools>[],
        ): CliPlugin<AppTools>;
      }
  );

// Adding a renderer requires its owner module and one explicit registration.
const registrations = [
  reactRendererRegistration,
  solidRendererRegistration,
  octaneRendererRegistration,
] as const satisfies readonly RendererRegistration[];

export type RegisteredRenderer = (typeof registrations)[number]['renderer'];
export const registeredRenderers: readonly RegisteredRenderer[] = Object.freeze(
  registrations.map(registration => registration.renderer),
);

/** Application admission is finite even though transport identities are generic. */
export function resolveRendererRegistration(
  value: unknown = 'react',
): (typeof registrations)[number] {
  const selected = registrations.find(
    registration => registration.renderer === value,
  );
  if (!selected)
    throw new Error(`Unsupported UltraModern renderer: ${String(value)}`);
  return selected;
}

export function resolveNativeRendererAdapter(
  renderer: Renderer,
): NativeRendererAdapter {
  const registration = registrations.find(
    candidate => candidate.renderer === renderer,
  );
  if (!registration || registration.kind !== 'native')
    throw new Error(
      `Unsupported UltraModern native renderer: ${String(renderer)}`,
    );
  return registration.nativeAdapter;
}
