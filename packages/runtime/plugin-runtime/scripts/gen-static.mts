import { fs } from '@modern-js/utils';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const {
  modernInline,
  runRouterDataFnStr,
  runWindowFnStr,
} = require('../dist/cjs/router/runtime/constants.js');

(async () => {
  const targetDir = path.join(import.meta.dirname, '../static');
  await fs.ensureDir(targetDir);

  const modernDefineInitPath = path.join(targetDir, 'modern-inline.js');
  await fs.writeFile(modernDefineInitPath, modernInline, 'utf-8');

  const runRouterDataFilePath = path.join(
    targetDir,
    'modern-run-router-data-fn.js',
  );
  await fs.writeFile(runRouterDataFilePath, runRouterDataFnStr, 'utf-8');

  const runWindowFilePath = path.join(targetDir, 'modern-run-window-fn.js');
  await fs.writeFile(runWindowFilePath, runWindowFnStr, 'utf-8');

  console.info('Generate static files successfully');
})();
