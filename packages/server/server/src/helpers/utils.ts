import { createDebugger } from '@modern-js/utils';

export const debug: ReturnType<typeof createDebugger> =
  createDebugger('server');
