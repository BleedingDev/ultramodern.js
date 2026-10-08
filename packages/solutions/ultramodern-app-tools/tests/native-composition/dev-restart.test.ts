import path from 'node:path';
import { appTools } from '@modern-js/app-tools';
import { runtimePlugin } from '../../../../runtime/plugin-runtime/src/cli';

// The ESM builds resolve CommonJS paths through createRequire, which finds no
// index.js in a bundleless directory such as `plugins/analyze`. A restart step
// that resolved one crashed `ultramodern dev` on every modern.config.ts edit.
// The test bundler compiles require.resolve away, so assert no such step exists.
function restartSteps(setup: ((api: never) => unknown) | undefined) {
  const steps: unknown[] = [];
  const appContext = {
    metaName: 'modern-js',
    appDirectory: __dirname,
    distDirectory: path.join(__dirname, 'dist'),
    command: 'dev',
  };
  const api = new Proxy(
    {},
    {
      get: (_target, name) =>
        name === 'onBeforeRestart'
          ? (step: unknown) => steps.push(step)
          : name === 'getAppContext'
            ? () => appContext
            : name === 'getConfig' || name === 'getNormalizedConfig'
              ? () => ({})
              : () => {},
    },
  );
  setup?.(api as never);
  return steps;
}

describe('dev restart', () => {
  it('app tools register no CommonJS require-cache step', () => {
    expect(restartSteps(appTools().setup)).toEqual([]);
  });

  it('the React runtime plugin registers no CommonJS require-cache step', () => {
    expect(restartSteps(runtimePlugin().setup)).toEqual([]);
  });
});
