import type { Context } from 'hono';
import { createStorage } from './utils/storage';

const { run, useContext: useBackendContext } = createStorage<Context>();

export { run, useBackendContext };
