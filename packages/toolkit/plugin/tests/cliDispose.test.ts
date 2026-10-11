import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, rstest } from '@rstest/core';
import { createCli } from '../src/cli';
import type { CLIPlugin } from '../src/types/cli';

describe('CLI host disposal', () => {
  it('removes only its own handlers after repeated init and prepare failures', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'modern-cli-dispose-'));
    await writeFile(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'cli-dispose-test' }),
    );
    const cli = createCli();
    const completed: string[] = [];
    let hostSignals = 0;
    const hostListener = () => {
      hostSignals += 1;
    };
    process.on('SIGTERM', hostListener);
    const onSpy = rstest.spyOn(process, 'on');
    const exitSpy = rstest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('A disposed CLI tried to exit its host');
    });
    const events = [
      'SIGINT',
      'SIGTERM',
      'unhandledRejection',
      'uncaughtException',
    ];
    try {
      const names = ['first', 'second', 'prepare failure'];
      for (const [index, name] of names.entries()) {
        let finish: (() => Promise<unknown>) | undefined;
        const plugin: CLIPlugin = {
          name,
          setup(api) {
            finish = () => api.getHooks().onBeforeExit.call();
            api.onBeforeExit(() => {
              completed.push(name);
            });
            api.onPrepare(() => {
              if (name === 'prepare failure') throw new Error(name);
            });
          },
        };
        const task = cli.init({
          cwd,
          command: 'routes-generate',
          configFile: false,
          config: {},
          internalPlugins: [plugin],
        });
        if (name === 'prepare failure') {
          await expect(task).rejects.toThrow(name);
        } else {
          await task;
        }
        await finish?.();
        // Reinitialization must replace the first context's handlers before
        // the explicit disposer releases the second and failing contexts.
        if (index === 0) continue;
        cli.dispose();
        cli.dispose();
        for (const [event, listener] of onSpy.mock.calls) {
          if (events.includes(event)) {
            expect(process.listeners(event)).not.toContain(listener);
          }
        }
        expect(process.listeners('SIGTERM')).toContain(hostListener);
        process.emit('SIGTERM');
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(completed).toEqual(names.slice(0, index + 1));
        expect(exitSpy).not.toHaveBeenCalled();
      }
      expect(hostSignals).toBe(2);
    } finally {
      cli.dispose();
      onSpy.mockRestore();
      exitSpy.mockRestore();
      process.off('SIGTERM', hostListener);
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
