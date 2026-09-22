import { existsSync } from 'node:fs';
import path from 'node:path';

export function assertPluginDataLoaderRuntimeBuilt() {
  const runtimeEntry = path.resolve(
    __dirname,
    '../../../../packages/cli/plugin-data-loader/dist/esm/runtime/index.mjs',
  );
  if (!existsSync(runtimeEntry)) {
    throw new Error(
      'Missing plugin-data-loader runtime prerequisite. Run pnpm test:framework ' +
        'to build framework packages before starting integration workers.',
    );
  }
}
