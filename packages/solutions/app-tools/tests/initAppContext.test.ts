import path from 'node:path';
import { initAppContext } from '../src/utils/initAppContext';

const appDirectory = path.resolve(__dirname, '..');

describe('initAppContext', () => {
  it('defaults unresolved bff runtime to hono', () => {
    const context = initAppContext({
      metaName: 'modern-js',
      appDirectory,
      runtimeConfigFile: 'runtime.ts',
    });

    expect(context.bffRuntimeFramework).toBe('hono');
  });

  it('preserves explicit effect runtime', () => {
    const context = initAppContext({
      metaName: 'modern-js',
      appDirectory,
      runtimeConfigFile: 'runtime.ts',
      options: {
        bffRuntimeFramework: 'effect',
      },
    });

    expect(context.bffRuntimeFramework).toBe('effect');
  });
});
