import path from 'node:path';
import { setSuiteTimeout } from '../../../utils/setSuiteTimeout';
import { defineRendererSpecs } from '../../renderer-specs/specs';

setSuiteTimeout(1000 * 60 * 5);

defineRendererSpecs({
  renderer: 'react',
  appDir: path.resolve(__dirname, '..'),
  // The TanStack plugin renders Modern's DefaultNotFound for unmatched routes.
  notFoundMarker: '>404</div>',
});
