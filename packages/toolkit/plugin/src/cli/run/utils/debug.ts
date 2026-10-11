import { createDebugger } from '@modern-js/utils/cli-common';

export const debug: ReturnType<typeof createDebugger> =
  createDebugger('plugin');
