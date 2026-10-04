import {
  createRendererGenerationProfile,
  nativeRendererDependencies,
  type RendererGenerationAdapter,
} from '../../renderer-generation-profile';
import { generateSolidAppSources } from './index';

export const solidGeneration: RendererGenerationAdapter = {
  renderer: 'solid',
  kind: 'native',
  createProfile: selected =>
    createRendererGenerationProfile('solid', selected, {
      frameworkDependencies: [
        '@modern-js/renderer-core',
        '@modern-js/renderer-solid',
      ],
      dependencies: {
        ...nativeRendererDependencies(selected),
        'solid-js': selected.hydration.version,
        '@solidjs/signals': selected.hydration.version,
      },
      devDependencies: {
        [selected.compiler.name]: selected.compiler.version,
        '@solidjs/babel-plugin': selected.compiler.version,
      },
    }),
  generateAppSources: generateSolidAppSources,
};
