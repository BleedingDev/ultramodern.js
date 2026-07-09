import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@rstest/core';
import { merge } from 'ts-deepmerge';
import { type TsCheckerOptions, withTsgoDefaults } from '../src/shared/tsgo';

const testRequire = createRequire(__filename);
const rootPath = process.cwd();
let fixtureRoot = '';
let fixtureTsconfigPath = '';

const projectTypescriptPath = testRequire.resolve('typescript', {
  paths: [rootPath],
});
const tsgoPath = testRequire.resolve('typescript/package.json', {
  paths: [rootPath],
});
const normalizePath = (value: string | undefined) =>
  value?.replace(/\\/gu, '/');

// Mirrors how @rsbuild/plugin-type-check reduces its option chain.
const reduceChain = (
  chain: ReturnType<typeof withTsgoDefaults>,
  configFile?: string,
) => {
  const initial: TsCheckerOptions = {
    typescript: {
      tsgo: false,
      typescriptPath: projectTypescriptPath,
      ...(configFile ? { configFile } : {}),
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

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-builder-tsgo-'));
  fixtureTsconfigPath = path.join(fixtureRoot, 'tsconfig.json');
  fs.writeFileSync(
    fixtureTsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          baseUrl: './',
          moduleResolution: 'node10',
          paths: {
            '@/*': ['./src/*'],
          },
        },
        include: ['src'],
      },
      null,
      2,
    ),
  );
});

afterAll(() => {
  if (fixtureRoot) {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

describe('withTsgoDefaults', () => {
  it('should use stable TypeScript 7 fallback when project TypeScript is not TS7', () => {
    const result = reduceChain(withTsgoDefaults(undefined, rootPath));
    expect(result.typescript?.tsgo).toBe(true);
    expect(result.typescript?.typescriptPath).toBe(tsgoPath);
    expect(result.typescript?.configOverwrite?.compilerOptions).toMatchObject({
      baseUrl: null,
    });
  });

  it('should prefer project stable TypeScript 7 package', () => {
    const stableTypeScriptPackagePath = path.join(
      fixtureRoot,
      'node_modules/typescript/package.json',
    );
    fs.mkdirSync(path.dirname(stableTypeScriptPackagePath), {
      recursive: true,
    });
    fs.writeFileSync(
      stableTypeScriptPackagePath,
      `${JSON.stringify({ version: '7.0.2' }, null, 2)}\n`,
    );

    const result = reduceChain(withTsgoDefaults(undefined, fixtureRoot));
    expect(result.typescript?.tsgo).toBe(true);
    expect(result.typescript?.typescriptPath).toBe(
      fs.realpathSync(stableTypeScriptPackagePath),
    );
  });

  it('should point tsgo at a sanitized checker tsconfig', () => {
    const result = reduceChain(
      withTsgoDefaults(undefined, rootPath),
      fixtureTsconfigPath,
    );

    const checkerConfigPath = result.typescript?.configFile;
    expect(normalizePath(checkerConfigPath)).toContain('.modern-js/tsgo');
    expect(checkerConfigPath).not.toContain('node_modules');
    expect(checkerConfigPath).not.toBe(fixtureTsconfigPath);

    const checkerConfig = JSON.parse(
      fs.readFileSync(checkerConfigPath!, 'utf8'),
    );
    expect(checkerConfig.extends).toBe('../../tsconfig.json');
    expect(checkerConfig.compilerOptions).toEqual({
      baseUrl: null,
      moduleResolution: null,
    });
  });

  it('should resolve relative config files from the project root', () => {
    const result = reduceChain(
      withTsgoDefaults(undefined, fixtureRoot),
      'tsconfig.json',
    );

    const checkerConfigPath = result.typescript?.configFile;
    expect(normalizePath(checkerConfigPath)).toContain('.modern-js/tsgo');
    expect(checkerConfigPath).not.toContain('node_modules');

    const checkerConfig = JSON.parse(
      fs.readFileSync(checkerConfigPath!, 'utf8'),
    );
    expect(checkerConfig.extends).toBe('../../tsconfig.json');
  });

  it('should remove tsgo-incompatible compiler options from config overwrite', () => {
    const result = reduceChain(
      withTsgoDefaults(
        {
          typescript: {
            configOverwrite: {
              compilerOptions: {
                baseUrl: './',
                moduleResolution: 'node10',
                paths: {
                  '@/*': ['./src/*'],
                },
              },
            },
          },
        },
        rootPath,
      ),
    );

    expect(result.typescript?.configOverwrite?.compilerOptions).toMatchObject({
      baseUrl: null,
      moduleResolution: null,
      paths: {
        '@/*': ['./src/*'],
      },
    });
  });

  it('should restore the classic checker when the user opts out', () => {
    const result = reduceChain(
      withTsgoDefaults({ typescript: { tsgo: false } }, rootPath),
    );
    expect(result.typescript?.tsgo).toBe(false);
    expect(result.typescript?.typescriptPath).toBe(projectTypescriptPath);
    expect(result.typescript?.configOverwrite).toBeUndefined();
  });

  it('should keep the project config file when the user opts out', () => {
    const result = reduceChain(
      withTsgoDefaults({ typescript: { tsgo: false } }, rootPath),
      fixtureTsconfigPath,
    );
    expect(result.typescript?.tsgo).toBe(false);
    expect(result.typescript?.typescriptPath).toBe(projectTypescriptPath);
    expect(result.typescript?.configFile).toBe(fixtureTsconfigPath);
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
    expect(result.typescript?.configOverwrite).toBeUndefined();
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
