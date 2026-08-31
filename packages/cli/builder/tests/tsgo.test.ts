import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { createBuilder } from '../src';

const createTypeCheckedCompiler = async (tsgo?: boolean) => {
  const rsbuild = await createBuilder({
    bundlerType: 'rspack',
    config: {
      tools: {
        tsChecker: {
          typescript: {
            ...(tsgo === undefined ? {} : { tsgo }),
            memoryLimit: 2048,
          },
        },
      },
    },
    cwd: join(__dirname, '..'),
  });
  const compiler = await rsbuild.createCompiler();
  return 'compilers' in compiler ? compiler.compilers[0] : compiler;
};

describe('native TypeScript checker integration', () => {
  it('selects tsgo automatically for the installed TypeScript 7 package', async () => {
    const compiler = await createTypeCheckedCompiler();
    const typeCheckTap = compiler.hooks.run.taps.find(
      tap => tap.name === 'TsCheckerRspackPlugin',
    );

    expect(typeCheckTap?.type).toBe('promise');
  });

  it('preserves an explicit classic-checker configuration', async () => {
    const compiler = await createTypeCheckedCompiler(false);
    const typeCheckTap = compiler.hooks.run.taps.find(
      tap => tap.name === 'TsCheckerRspackPlugin',
    );
    const checker = compiler.options.plugins?.find(
      plugin => plugin?.constructor?.name === 'TsCheckerRspackPlugin',
    ) as { options?: { typescript?: Record<string, unknown> } } | undefined;

    expect(typeCheckTap?.type).toBe('sync');
    expect(checker?.options?.typescript).toMatchObject({
      memoryLimit: 2048,
      tsgo: false,
    });
    expect(checker?.options?.typescript).not.toHaveProperty('typescriptPath');
  });
});
