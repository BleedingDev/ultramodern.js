import { fs, logger } from '@modern-js/utils';
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
  afterEach(() => {
    spawnBehaviors.length = 0;
    rstest.restoreAllMocks();
  });

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

  it('throws instead of logging success when tsgo exits nonzero and the caller requested errors', async () => {
    const example = path.join(__dirname, './fixtures', './ts-example');
    const infoSpy = rstest.spyOn(logger, 'info').mockImplementation(() => {});
    const errorSpy = rstest.spyOn(logger, 'error').mockImplementation(() => {});

    // First spawn: `--showConfig` succeeds with the default hard-fail setting.
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
    // Second spawn: the actual compile reports TS diagnostics and exits
    // nonzero. This used to log both failure and success while returning.
    spawnBehaviors.push(child => {
      child.stderr.emit(
        'data',
        "api/effect/index.ts(1,1): error TS1295: ECMAScript imports and exports cannot be written in a CommonJS file under 'verbatimModuleSyntax'.\n",
      );
      child.emit('close', 1);
    });

    await expect(
      compileByTs(
        example,
        { alias: {} },
        {
          sourceDirs: [path.join(example, 'api')],
          distDir: path.join(example, 'dist-tsgo-failure'),
          tsconfigPath: path.join(example, 'tsconfig.json'),
          throwErrorInsteadOfExit: true,
        },
      ),
    ).rejects.toThrow('TS1295');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('TS1295'));
    expect(errorSpy).toHaveBeenCalledWith('TS-Go compilation failed');
    expect(infoSpy).not.toHaveBeenCalledWith('TS-Go compile succeed');
  });
});
