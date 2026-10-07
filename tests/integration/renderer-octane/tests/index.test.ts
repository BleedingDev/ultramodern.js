import path from 'node:path';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import { defineRendererSpecs } from '../../renderer-specs/specs';

setSuiteTimeout(1000 * 60 * 5);

defineRendererSpecs({
  renderer: 'octane',
  appDir: path.resolve(__dirname, '..'),
  skip: {
    lazy: 'the Octane fixture has no lazy component',
    'dev-hmr':
      'an edit reloads the document: the streamed signal client build changes',
  },
});
