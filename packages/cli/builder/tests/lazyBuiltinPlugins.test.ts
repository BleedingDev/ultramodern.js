import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  createRsbuild,
  type RsbuildPlugin,
  type Rspack,
  rspack,
} from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import { parseCommonConfig } from '../src/shared/parseCommonConfig';
import type { BuilderConfig, CreateBuilderCommonOptions } from '../src/types';

const builderDirectory = path.resolve(__dirname, '..');

async function bundleActualParser(directory: string) {
  const compiler = rspack({
    context: builderDirectory,
    entry: path.join(builderDirectory, 'src/shared/parseCommonConfig.ts'),
    target: 'node',
    mode: 'development',
    devtool: false,
    externalsPresets: { node: true },
    externalsType: 'commonjs',
    externals: [
      ({ request }, callback) => {
        if (request && !request.startsWith('.') && !path.isAbsolute(request)) {
          callback(undefined, request);
        } else callback();
      },
    ],
    resolve: { extensions: ['.ts', '.js', '.json'] },
    module: {
      rules: [
        {
          test: /\.ts$/u,
          loader: 'builtin:swc-loader',
          options: { jsc: { parser: { syntax: 'typescript' } } },
        },
      ],
    },
    optimization: { minimize: false },
    output: {
      path: directory,
      filename: 'parser.cjs',
      library: { type: 'commonjs2' },
    },
  });
  try {
    await new Promise<void>((resolve, reject) =>
      compiler.run((error, stats) => {
        if (error) reject(error);
        else if (!stats || stats.hasErrors())
          reject(
            new Error(
              stats?.toString({ all: false, errors: true }) ??
                'Missing parser compilation stats',
            ),
          );
        else resolve();
      }),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      compiler.close(error => (error ? reject(error) : resolve())),
    );
  }
  return path.join(directory, 'parser.cjs');
}

function projectConfig(config: Rspack.Configuration) {
  const swc: unknown[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (
      typeof record.loader === 'string' &&
      record.loader.includes('swc-loader')
    )
      swc.push(record.options);
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(config.module?.rules);
  const projection = {
    swc,
    svg: config.module?.rules?.filter(
      rule =>
        rule &&
        typeof rule === 'object' &&
        rule.test instanceof RegExp &&
        rule.test.test('fixture.svg'),
    ),
    alias: config.resolve?.alias,
    splitChunks: config.optimization?.splitChunks,
    plugins: config.plugins?.map(plugin => plugin?.constructor.name),
  };
  return JSON.parse(
    JSON.stringify(projection, (_key, value) =>
      value instanceof RegExp
        ? value.toString()
        : typeof value === 'function'
          ? value.toString()
          : value,
    ),
  );
}

describe('lazy default React and SVGR plugins', () => {
  it('honors late global removal without resolving or evaluating either optional compiler package', async () => {
    const fixture = await fs.mkdtemp(
      path.join(os.tmpdir(), 'modern-lazy-builtins-'),
    );
    try {
      const parser = await bundleActualParser(fixture);
      await fs.writeFile(
        path.join(fixture, 'entry.js'),
        'export const value = 42;\n',
      );
      const script = `
const assert = require('node:assert/strict');
const { createRequire, registerHooks } = require('node:module');
const ownerRequire = createRequire(${JSON.stringify(path.join(builderDirectory, 'package.json'))});
const blocked = [];
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@rsbuild/plugin-react' || specifier === '@rsbuild/plugin-svgr' || /(?:@rsbuild[\\/](?:plugin-react|plugin-svgr)|@rsbuild\\+(?:plugin-react|plugin-svgr)@)/u.test(specifier)) {
    blocked.push(specifier);
    throw new Error('Removed compiler package was requested: ' + specifier);
  }
  return nextResolve(specifier, context);
} });
(async () => {
  try {
    const { parseCommonConfig } = require(${JSON.stringify(parser)});
    const { createRsbuild } = ownerRequire('@rsbuild/core');
    const parsed = await parseCommonConfig({ output: { disableTsChecker: true } }, { cwd: ${JSON.stringify(fixture)} });
    assert(parsed.rsbuildPlugins.some(plugin => plugin.name === 'rsbuild:react'));
    assert(parsed.rsbuildPlugins.some(plugin => plugin.name === 'rsbuild:svgr'));
    const rsbuild = await createRsbuild({ cwd: ${JSON.stringify(fixture)}, rsbuildConfig: {
      ...parsed.rsbuildConfig,
      source: { entry: { main: ${JSON.stringify(path.join(fixture, 'entry.js'))} } },
      plugins: parsed.rsbuildPlugins,
      mode: 'development',
    } });
    // App-tools adds consumer builder plugins after createBuilder returns.
    rsbuild.addPlugins([{ name: 'fixture:compiler-owner', remove: ['rsbuild:react', 'rsbuild:svgr'], setup() {} }]);
    const configs = await rsbuild.initConfigs();
    assert.equal(configs.length, 1);
    assert(!configs[0].plugins.some(plugin => plugin?.constructor.name === 'ReactRefreshRspackPlugin'));
    assert(!JSON.stringify(configs[0].module.rules).includes('plugin-svgr'));
    assert.deepEqual(blocked, []);
    process.stdout.write(JSON.stringify({ configs: configs.length, requestedCompilerPackages: blocked }));
  } finally { hooks.deregister(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
`;
      const child = spawnSync(process.execPath, ['-e', script], {
        cwd: builderDirectory,
        env: {
          ...process.env,
          NODE_PATH: [
            path.join(builderDirectory, 'node_modules'),
            process.env.NODE_PATH,
          ]
            .filter(Boolean)
            .join(path.delimiter),
        },
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({
        configs: 1,
        requestedCompilerPackages: [],
      });
    } finally {
      await fs.rm(fixture, { recursive: true, force: true });
    }
  }, 40_000);

  it.each([
    {
      mode: 'development',
      svgDefaultExport: 'component',
      reactCompiler: { target: '18', compilationMode: 'annotation' },
      disableReactCompiler: false,
    },
    {
      mode: 'production',
      svgDefaultExport: 'url',
      reactCompiler: true,
      disableReactCompiler: true,
    },
  ] as const)('matches original initialized compiler factories in $mode', async ({
    mode,
    svgDefaultExport,
    reactCompiler,
    disableReactCompiler,
  }) => {
    const { pluginReact } = await import('@rsbuild/plugin-react');
    const { pluginSvgr } = await import('@rsbuild/plugin-svgr');
    const builderConfig: BuilderConfig = {
      output: { disableTsChecker: true, svgDefaultExport },
      source: { reactCompiler },
    };
    const options: CreateBuilderCommonOptions = {
      cwd: builderDirectory,
      disableReactCompiler,
    };
    const parsed = await parseCommonConfig(builderConfig, options);
    expect(
      parsed.rsbuildPlugins.find(plugin => plugin.name === 'rsbuild:svgr')?.pre,
    ).toEqual(['rsbuild:react']);
    const original: RsbuildPlugin[] = parsed.rsbuildPlugins.map(plugin => {
      if (plugin.name === 'rsbuild:react')
        return pluginReact(disableReactCompiler ? {} : { reactCompiler });
      if (plugin.name === 'rsbuild:svgr')
        return pluginSvgr({
          mixedImport: true,
          parallel: true,
          svgrOptions: {
            exportType: svgDefaultExport === 'component' ? 'default' : 'named',
          },
        });
      return plugin;
    });
    const initialize = async (plugins: RsbuildPlugin[]) => {
      const rsbuild = await createRsbuild({
        cwd: builderDirectory,
        rsbuildConfig: { ...parsed.rsbuildConfig, mode, plugins },
      });
      return (await rsbuild.initConfigs())[0];
    };
    const deferredConfig = await initialize(parsed.rsbuildPlugins);
    const originalConfig = await initialize(original);
    expect(projectConfig(deferredConfig)).toEqual(
      projectConfig(originalConfig),
    );
    if (mode === 'development') {
      expect(
        deferredConfig.plugins?.map(plugin => plugin?.constructor.name),
      ).toContain('ReactRefreshRspackPlugin');
    }
    expect(JSON.stringify(projectConfig(deferredConfig).svg)).toContain(
      'plugin-svgr',
    );
  }, 30_000);

  it('preserves output.disableSvgr', async () => {
    const parsed = await parseCommonConfig({
      output: { disableTsChecker: true, disableSvgr: true },
    });
    expect(parsed.rsbuildPlugins.map(plugin => plugin.name)).toContain(
      'rsbuild:react',
    );
    expect(parsed.rsbuildPlugins.map(plugin => plugin.name)).not.toContain(
      'rsbuild:svgr',
    );
  });
});
