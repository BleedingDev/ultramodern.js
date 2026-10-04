import { ULTRAMODERN_PACKAGE_PINS } from '../../policy';
import {
  createRendererGenerationProfile,
  type RendererGenerationAdapter,
} from '../../renderer-generation-profile';

export const reactGeneration: RendererGenerationAdapter = {
  renderer: 'react',
  kind: 'react',
  createProfile: selected =>
    createRendererGenerationProfile('react', selected, {
      frameworkDependencies: [],
      dependencies: { ...ULTRAMODERN_PACKAGE_PINS.appDependencies },
      devDependencies: {
        '@types/react':
          ULTRAMODERN_PACKAGE_PINS.appDevDependencies['@types/react'],
        '@types/react-dom':
          ULTRAMODERN_PACKAGE_PINS.appDevDependencies['@types/react-dom'],
      },
    }),
};
