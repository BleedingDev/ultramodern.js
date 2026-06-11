import { createRequire } from 'node:module';
import { describe, expect, it } from '@rstest/core';
import { merge } from 'ts-deepmerge';
import { type TsCheckerOptions, withTsgoDefaults } from '../src/shared/tsgo';

const testRequire = createRequire(__filename);
const rootPath = process.cwd();

const projectTypescriptPath = testRequire.resolve('typescript', {
  paths: [rootPath],
});
const tsgoPath = testRequire.resolve(
  '@typescript/native-preview/package.json',
  { paths: [rootPath] },
);

// Mirrors how @rsbuild/plugin-type-check reduces its option chain.
const reduceChain = (chain: ReturnType<typeof withTsgoDefaults>) => {
  const initial: TsCheckerOptions = {
    typescript: {
      tsgo: false,
      typescriptPath: projectTypescriptPath,
    },
  };
  const items = Array.isArray(chain) ? chain : [chain];
  return items.reduce<TsCheckerOptions>(
    (acc, item) =>
      typeof item === 'function'
        ? ((item as (c: TsCheckerOptions) => TsCheckerOptions)(acc) ?? acc)
        : (merge(acc, item) as TsCheckerOptions),
    initial,
  );
};

describe('withTsgoDefaults', () => {
  it('should enable tsgo with the native-preview package by default', () => {
    const result = reduceChain(withTsgoDefaults(undefined, rootPath));
    expect(result.typescript?.tsgo).toBe(true);
    expect(result.typescript?.typescriptPath).toBe(tsgoPath);
  });

  it('should restore the classic checker when the user opts out', () => {
    const result = reduceChain(
      withTsgoDefaults({ typescript: { tsgo: false } }, rootPath),
    );
    expect(result.typescript?.tsgo).toBe(false);
    expect(result.typescript?.typescriptPath).toBe(projectTypescriptPath);
  });

  it('should keep a user-configured typescriptPath', () => {
    const result = reduceChain(
      withTsgoDefaults(
        { typescript: { tsgo: false, typescriptPath: '/custom/tsc.js' } },
        rootPath,
      ),
    );
    expect(result.typescript?.tsgo).toBe(false);
    expect(result.typescript?.typescriptPath).toBe('/custom/tsc.js');
  });

  it('should apply user function chains before the opt-out fixup', () => {
    const result = reduceChain(
      withTsgoDefaults(config => {
        config.typescript ??= {};
        config.typescript.tsgo = false;
        return config;
      }, rootPath),
    );
    expect(result.typescript?.tsgo).toBe(false);
    expect(result.typescript?.typescriptPath).toBe(projectTypescriptPath);
  });
});
