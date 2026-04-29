import type { ServerConfig } from '@modern-js/server-core';
import {
  CONFIG_FILE_EXTENSIONS,
  ensureAbsolutePath,
  fs,
  getServerConfig,
  OUTPUT_CONFIG_FILE,
} from '@modern-js/utils';
import { stringify } from 'flatted';
import * as path from 'path';
import type { AppNormalizedConfig } from '../types';

export const emitResolvedConfig = async (
  appDirectory: string,
  resolvedConfig: AppNormalizedConfig,
) => {
  const outputPath = ensureAbsolutePath(
    appDirectory,
    path.join(
      resolvedConfig.output.distPath?.root || './dist',
      OUTPUT_CONFIG_FILE,
    ),
  );

  const output: string = stringify(resolvedConfig);

  await fs.writeFile(outputPath, output, {
    encoding: 'utf-8',
  });
};
