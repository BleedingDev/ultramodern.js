import type { BffCompilation } from '@modern-js/app-tools';
import type { CLIPluginExtends } from '@modern-js/plugin/cli';

export interface BffRuntimeBuildIdentity {
  readonly buildMarker: string;
  readonly sourceRevision: string;
}

export type BffRuntimeBuildIdentityProvider = (
  compilation: BffCompilation,
) => Promise<BffRuntimeBuildIdentity>;

export type WithBffRuntimeBuildIdentity<Extends extends CLIPluginExtends> =
  Extends & {
    extendContext: Extends['extendContext'] & {
      resolveBffRuntimeBuildIdentity?: BffRuntimeBuildIdentityProvider;
    };
  };

declare module '@modern-js/app-tools' {
  interface AppToolsExtendContext {
    resolveBffRuntimeBuildIdentity?: BffRuntimeBuildIdentityProvider;
  }
}
