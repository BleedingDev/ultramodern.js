import type { ServerPluginExtends } from '../../types/server/plugin';
import { createServer } from './create';

export const server: ReturnType<typeof createServer<ServerPluginExtends>> =
  createServer();

export type { ServerCreateOptions } from './types';
export { createServer };
