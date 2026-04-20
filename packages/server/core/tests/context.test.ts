import type { Context } from 'hono';
import { createStorage } from '../src/utils/storage';

describe('server context storage', () => {
  it('shares keyed storage across duplicate module instances', async () => {
    const key = Symbol.for('modernjs.server-core.tests.honoContextStorage');
    const primaryStorage = createStorage<Context>(key);
    const duplicateStorage = createStorage<Context>(key);
    const context = {} as Context;

    await primaryStorage.run(context, async () => {
      expect(duplicateStorage.useContext()).toBe(context);
    });
  });
});
