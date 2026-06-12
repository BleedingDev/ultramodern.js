import { fs } from '@modern-js/utils';
import { EventEmitter } from 'events';
import path from 'path';
import { compileByTs } from '../src/compilers/typescript';

type SpawnBehavior = (child: {
  stdout: EventEmitter;
  stderr: EventEmitter;
  emit: (event: string, ...args: unknown[]) => boolean;
}) => void;

const spawnBehaviors: SpawnBehavior[] = [];

rstest.mock('child_process', () => ({
  __esModule: true,
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const behavior = spawnBehaviors.shift();
    setImmediate(() => behavior?.(child));
    return child;
  },
}));

describe('compileByTs temp config cleanup', () => {
  it('removes the resolved tsgo config when the compile process fails to spawn', async () => {
    const example = path.join(__dirname, './fixtures', './ts-example');

    // First spawn: `--showConfig` succeeds with a minimal config.
    spawnBehaviors.push(child => {
      child.stdout.emit(
        'data',
        JSON.stringify({
          compilerOptions: { module: 'commonjs' },
          files: ['./api/index.ts'],
        }),
      );
      child.emit('close', 0);
    });
    // Second spawn: the actual compile dies with a spawn error, which used to
    // skip the cleanup and leak `.tsgo.<pid>...resolved.json` into the app.
    spawnBehaviors.push(child => {
      child.emit('error', new Error('spawn ENOENT'));
    });

    await expect(
      compileByTs(
        example,
        { alias: {} },
        {
          sourceDirs: [path.join(example, 'api')],
          distDir: path.join(example, 'dist-cleanup'),
          tsconfigPath: path.join(example, 'tsconfig.json'),
        },
      ),
    ).rejects.toThrow('spawn ENOENT');

    const leftovers = (await fs.readdir(example)).filter(name =>
      name.endsWith('.resolved.json'),
    );
    expect(leftovers).toEqual([]);
  });
});
