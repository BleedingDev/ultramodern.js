import {
  createRendererGenerationProfile,
  nativeRendererDependencies,
  type RendererGenerationAdapter,
} from '../../renderer-generation-profile';
import { TYPESCRIPT_VERSION } from '../../versions';
import { generateOctaneAppSources } from './index';

export const octaneGeneration: RendererGenerationAdapter = {
  renderer: 'octane',
  kind: 'native',
  createProfile: selected =>
    createRendererGenerationProfile('octane', selected, {
      frameworkDependencies: [
        '@modern-js/renderer-core',
        '@modern-js/renderer-octane',
      ],
      dependencies: nativeRendererDependencies(selected),
      devDependencies: {
        [selected.compiler.name]: selected.compiler.version,
        typescript: TYPESCRIPT_VERSION,
      },
      typecheckCommand: 'octane-tsc --noEmit --project tsconfig.json',
      tsconfig: {
        tsrx: {
          compiler: 'octane/compiler/volar',
          platform: 'web',
        },
      },
    }),
  generateAppSources: generateOctaneAppSources,
};
