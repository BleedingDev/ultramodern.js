import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import { describe, expect, it, rstest } from '@rstest/core';
import {
  type ConfigParams,
  createDefineConfig,
  loadUltramodernConfigFile,
  resolveUltramodernConfig,
  type SelectedCompositionFactory,
} from '../../src/native-composition/config';
import { ULTRAMODERN_BASE_PLUGIN } from '../../src/native-composition/renderer-selection';

function createFactory() {
  return rstest.fn<SelectedCompositionFactory>(renderer => ({
    name: ULTRAMODERN_BASE_PLUGIN,
    usePlugins: [{ name: `fixture:${renderer}:host` }],
  }));
}

describe('renderer configuration materialization', () => {
  it.each([
    'react',
    'solid',
    'octane',
  ] as const)('selects %s once and retains authored configuration and consumer plugins', async renderer => {
    const consumer: CliPlugin<AppTools> = { name: 'fixture:consumer' };
    const plugins = [consumer];
    const html = { title: 'Authored title' };
    const factory = createFactory();
    const input = { renderer, plugins, html };
    const selected = createDefineConfig(factory)(input);
    expect(typeof selected).toBe('object');
    const config = await resolveUltramodernConfig(selected, {
      env: 'production',
      command: 'build',
    });

    expect(config).not.toBe(input);
    expect(config.renderer).toBe(renderer);
    expect(config.html).toBe(html);
    expect(config.plugins?.map(plugin => plugin.name)).toEqual([
      ULTRAMODERN_BASE_PLUGIN,
      'fixture:consumer',
    ]);
    expect(config.plugins?.[1]).toBe(consumer);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(renderer, plugins);
    expect(input.plugins).toEqual([consumer]);
  });

  it('selects React when renderer is omitted', async () => {
    const factory = createFactory();
    const config = await resolveUltramodernConfig(
      createDefineConfig(factory)({}),
      { env: 'development', command: 'dev' },
    );
    expect(config.renderer).toBe('react');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith('react', []);
  });

  it.each([
    false,
    true,
  ])('evaluates an authored callback exactly once with the exact context, async=%s', async asynchronous => {
    const context = { env: 'test', command: 'inspect' };
    const factory = createFactory();
    const consumer: CliPlugin<AppTools> = { name: 'fixture:callback-consumer' };
    const result = { renderer: 'solid' as const, plugins: [consumer] };
    const callback = rstest.fn((received: ConfigParams) => {
      expect(received).toBe(context);
      return asynchronous ? Promise.resolve(result) : result;
    });
    const selected = createDefineConfig(factory)(callback);
    expect(typeof selected).toBe('function');
    expect(callback).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();

    const config = await resolveUltramodernConfig(selected, context);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(context);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith('solid', result.plugins);
    expect(config.plugins?.[1]).toBe(consumer);
  });

  it('keeps synchronous callbacks synchronous and asynchronous callbacks awaitable', async () => {
    const defineConfig = createDefineConfig(createFactory());
    const synchronous = defineConfig(() => ({ renderer: 'octane' }));
    const asynchronous = defineConfig(async () => ({ renderer: 'solid' }));
    if (
      typeof synchronous !== 'function' ||
      typeof asynchronous !== 'function'
    ) {
      throw new Error('Configuration callback was evaluated too early');
    }
    const context = { env: 'development', command: 'dev' };
    expect(synchronous(context)).not.toBeInstanceOf(Promise);
    const promise = asynchronous(context);
    expect(promise).toBeInstanceOf(Promise);
    expect((await promise).renderer).toBe('solid');
  });

  it.each([
    ULTRAMODERN_BASE_PLUGIN,
    '@modern-js/app-tools',
  ])('rejects an additional %s base before constructing a composition', name => {
    const factory = createFactory();
    const defineConfig = createDefineConfig(factory);
    expect(() => defineConfig({ plugins: [{ name }] })).toThrow(
      'defineConfig owns the UltraModern base composition',
    );
    expect(() =>
      defineConfig({
        plugins: [{ name: 'fixture:wrapper', usePlugins: [{ name }] }],
      }),
    ).toThrow('defineConfig owns the UltraModern base composition');
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects unknown renderers before constructing a composition', () => {
    const factory = createFactory();
    expect(() =>
      // @ts-expect-error Exercise invalid authored JavaScript configuration.
      createDefineConfig(factory)({ renderer: 'vue' }),
    ).toThrow('Unsupported UltraModern renderer: vue');
    expect(factory).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'null', value: null },
    { label: 'array', value: [] },
    { label: 'number', value: 42 },
  ])('rejects a non-object configuration: $label', ({ value }) => {
    expect(() =>
      // @ts-expect-error Exercise invalid authored JavaScript configuration.
      createDefineConfig(createFactory())(value),
    ).toThrow('UltraModern configuration must be an object');
  });
});

describe('owning configuration loader', () => {
  it.each([
    'local',
    'programmatic',
  ] as const)('rejects a conflicting %s renderer after the owning loader merges config', async override => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'um-renderer-loader-conflict-'),
    );
    try {
      fs.writeFileSync(
        path.join(appDirectory, 'package.json'),
        JSON.stringify({ name: 'renderer-loader-conflict' }),
      );
      fs.writeFileSync(
        path.join(appDirectory, 'modern.config.js'),
        `
        const base = { name: ${JSON.stringify(ULTRAMODERN_BASE_PLUGIN)} };
        Object.defineProperty(base, Symbol.for('ultramodern.selected-renderer'), { value: 'solid', enumerable: true });
        module.exports = { renderer: 'solid', plugins: [base] };
      `,
      );
      if (override === 'local') {
        fs.writeFileSync(
          path.join(appDirectory, 'modern.config.local.js'),
          "module.exports = { renderer: 'octane' };\n",
        );
      }
      await expect(
        loadUltramodernConfigFile({
          appDirectory,
          env: 'development',
          command: 'dev',
          config:
            override === 'programmatic' ? { renderer: 'octane' } : undefined,
        }),
      ).rejects.toThrow(
        'Renderer changed from solid to octane after plugin selection',
      );
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });

  it('forwards env and command through the real loader and preserves local and programmatic merges', async () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'um-renderer-config-'),
    );
    try {
      fs.writeFileSync(
        path.join(appDirectory, 'package.json'),
        JSON.stringify({ name: 'renderer-config-owning-host' }),
      );
      fs.writeFileSync(
        path.join(appDirectory, 'modern.config.js'),
        `module.exports = async context => {
          require('node:fs').appendFileSync(${JSON.stringify(path.join(appDirectory, 'evaluations.txt'))}, 'evaluated\\n');
          const base = { name: ${JSON.stringify(ULTRAMODERN_BASE_PLUGIN)} };
          Object.defineProperty(base, Symbol.for('ultramodern.selected-renderer'), { value: 'solid' });
          return {
            renderer: 'solid',
            plugins: [base],
            html: { title: context.env + '/' + context.command },
            source: { define: { AUTHORED: '"source"' } }
          };
        };
        `,
      );
      fs.writeFileSync(
        path.join(appDirectory, 'modern.config.local.js'),
        'module.exports = { source: { define: { LOCAL: \'"local"\' } } };\n',
      );
      const loaded = await loadUltramodernConfigFile({
        appDirectory,
        env: 'fixture-env',
        command: 'dev',
        config: { source: { define: { PROGRAMMATIC: '"programmatic"' } } },
      });
      expect(loaded.config.renderer).toBe('solid');
      expect(loaded.config.html?.title).toBe('fixture-env/dev');
      expect(loaded.config.source?.define).toEqual({
        AUTHORED: '"source"',
        LOCAL: '"local"',
        PROGRAMMATIC: '"programmatic"',
      });
      expect(loaded.config.plugins?.map(plugin => plugin.name)).toEqual([
        ULTRAMODERN_BASE_PLUGIN,
      ]);
      expect(
        fs.readFileSync(path.join(appDirectory, 'evaluations.txt'), 'utf-8'),
      ).toBe('evaluated\n');
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });
});
