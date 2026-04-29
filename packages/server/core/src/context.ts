import type { Context } from 'hono';
import { createStorage } from './utils/storage';

const kHonoContextStorage = Symbol.for(
  'modernjs.server-core.honoContextStorage',
);

const { run, useContext: useHonoContext } =
  createStorage<Context>(kHonoContextStorage);

export { run, useHonoContext };
