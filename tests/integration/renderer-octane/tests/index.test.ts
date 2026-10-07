import path from 'node:path';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import { defineRendererSpecs } from '../../renderer-specs/specs';

setSuiteTimeout(1000 * 60 * 5);

defineRendererSpecs({
  renderer: 'octane',
  appDir: path.resolve(__dirname, '..'),
  skip: {
    lazy: 'the Octane fixture has no lazy component',
    'ssr-css':
      'route CSS loads only with the client bundle, so the first paint is unstyled',
  },
});
