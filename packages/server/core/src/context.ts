import type { Context } from 'hono';
import { createStorage } from './utils/storage';

const { run, useContext: useHonoContext } = createStorage<Context>();

export { run, useHonoContext };
