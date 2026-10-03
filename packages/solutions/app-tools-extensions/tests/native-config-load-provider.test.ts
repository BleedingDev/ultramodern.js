import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@rstest/core';
import { resolveNativeConfigLoadProvider } from '../src/native-config-load-provider';

const original = '@modern-js/ultramodern-app-tools';
const mapped = '@bleedingdev/modern-js-ultramodern-app-tools';
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

function fixture(manifest: object) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-provider-'));
  fixtures.push(root);
  const app = path.join(root, 'app');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(
    path.join(app, 'modern.config.js'),
    "throw new Error('Application configuration must not be evaluated');\n",
  );
  return { root, app };
}

function provider(
  directory: string,
  key: string,
  owner = key,
  source = 'exports.createNativeConfigLoad = () => ({ wrapConfigLoad: async load => load(), internalPlugins: [{ name: "provider-context", setup() {} }] });',
) {
  const root = path.join(directory, 'node_modules', key);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: owner,
      version: '1.0.0',
      exports: { './native-config-load': './provider.cjs' },
    }),
  );
  fs.writeFileSync(path.join(root, 'provider.cjs'), source);
  return root;
}

describe('declared native config-load provider', () => {
  it.each([
    'dev',
    'start',
    'build',
    'inspect',
    'deploy',
    'dev-worker',
  ])('captures the original load for builder command %s', async command => {
    const { app } = fixture({ dependencies: { [original]: '1.0.0' } });
    provider(app, original);
    const result = await resolveNativeConfigLoadProvider({
      appDirectory: app,
      command,
    });
    expect(result?.internalPlugins?.[0]?.name).toBe('provider-context');
    const loaded = {
      packageName: 'app',
      configFile: false as const,
      config: {},
    };
    let loads = 0;
    expect(
      await result?.wrapConfigLoad?.(
        async () => {
          loads++;
          return loaded;
        },
        {
          appDirectory: app,
          configFile: false,
        },
      ),
    ).toBe(loaded);
    expect(loads).toBe(1);
  });

  it.each([
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ])('loads the original declaration from %s through the public subpath', async field => {
    const { app } = fixture({ [field]: { [original]: '1.0.0' } });
    provider(app, original);
    const result = await resolveNativeConfigLoadProvider({
      appDirectory: app,
      command: 'dev',
    });
    expect(result?.internalPlugins?.[0]?.name).toBe('provider-context');
    const loaded = {
      packageName: 'app',
      configFile: false as const,
      config: {},
    };
    expect(
      await result?.wrapConfigLoad?.(async () => loaded, {
        appDirectory: app,
        configFile: false,
      }),
    ).toBe(loaded);
  });

  it('leaves an absent provider unchanged', async () => {
    const { app } = fixture({ name: 'vanilla-app' });
    expect(
      await resolveNativeConfigLoadProvider({
        appDirectory: app,
        command: 'build',
      }),
    ).toBeUndefined();
  });

  it('ignores an undeclared installed and hoisted transitive provider', async () => {
    const { root, app } = fixture({ dependencies: { unrelated: '1.0.0' } });
    provider(
      root,
      original,
      original,
      "throw new Error('Undeclared provider must not be loaded');",
    );
    expect(
      await resolveNativeConfigLoadProvider({
        appDirectory: app,
        command: 'build',
      }),
    ).toBeUndefined();
  });

  it.each([
    { key: mapped, version: '1.0.0', owner: mapped },
    { key: original, version: `npm:${mapped}@1.0.0`, owner: mapped },
    { key: 'native-ultra', version: `npm:${mapped}@1.0.0`, owner: mapped },
    { key: '@app/ultra', version: `npm:${original}@1.0.0`, owner: original },
  ])('loads the declared mapped owner or direct npm alias $key', async ({
    key,
    version,
    owner,
  }) => {
    const { app } = fixture({ dependencies: { [key]: version } });
    provider(app, key, owner);
    const result = await resolveNativeConfigLoadProvider({
      appDirectory: app,
      command: 'build',
    });
    expect(result?.internalPlugins?.[0]?.name).toBe('provider-context');
  });

  it('uses normal app-anchored resolution for a declared hoisted provider', async () => {
    const { root, app } = fixture({ dependencies: { [original]: '1.0.0' } });
    provider(root, original);
    expect(
      (
        await resolveNativeConfigLoadProvider({
          appDirectory: app,
          command: 'build',
        })
      )?.internalPlugins?.[0]?.name,
    ).toBe('provider-context');
  });

  it('rejects a missing declared provider instead of falling back to another namespace', async () => {
    const { app } = fixture({ dependencies: { [original]: '1.0.0' } });
    provider(app, mapped);
    await expect(
      resolveNativeConfigLoadProvider({ appDirectory: app, command: 'build' }),
    ).rejects.toThrow();
  });

  it('rejects a relative dependency alias before attempting public package resolution', async () => {
    const { app } = fixture({
      dependencies: { '../ultra': `npm:${mapped}@1.0.0` },
    });
    await expect(
      resolveNativeConfigLoadProvider({ appDirectory: app, command: 'build' }),
    ).rejects.toThrow('Invalid native config provider declaration');
  });

  it('rejects distinct declared provider owners before evaluating either factory', async () => {
    const { app } = fixture({
      dependencies: { [original]: '1.0.0', [mapped]: '1.0.0' },
    });
    const source =
      "throw new Error('Ambiguous provider must not be evaluated');";
    provider(app, original, original, source);
    provider(app, mapped, mapped, source);
    await expect(
      resolveNativeConfigLoadProvider({ appDirectory: app, command: 'build' }),
    ).rejects.toThrow(
      'Multiple declared native config providers are ambiguous',
    );
  });

  it('rejects an installed owner that differs from the declared npm target before evaluating it', async () => {
    const { app } = fixture({ dependencies: { ultra: `npm:${mapped}@1.0.0` } });
    provider(
      app,
      'ultra',
      original,
      "throw new Error('Wrong owner evaluated');",
    );
    await expect(
      resolveNativeConfigLoadProvider({ appDirectory: app, command: 'build' }),
    ).rejects.toThrow('Invalid declared native config provider owner');
  });

  it('rejects a public entry that escapes its canonical package owner', async () => {
    const { root, app } = fixture({ dependencies: { [original]: '1.0.0' } });
    const owner = provider(app, original);
    const outside = path.join(root, 'outside.cjs');
    fs.writeFileSync(outside, "throw new Error('Escaped entry evaluated');");
    fs.rmSync(path.join(owner, 'provider.cjs'));
    fs.symlinkSync(outside, path.join(owner, 'provider.cjs'));
    await expect(
      resolveNativeConfigLoadProvider({ appDirectory: app, command: 'build' }),
    ).rejects.toThrow('Invalid declared native config provider owner');
  });

  it.each([
    'exports.unrelated = true;',
    'exports.createNativeConfigLoad = () => ({ internalPlugins: [] });',
    'exports.createNativeConfigLoad = () => ({ wrapConfigLoad() {}, internalPlugins: [{}] });',
    'exports.createNativeConfigLoad = () => ({ wrapConfigLoad() {}, internalPlugins: new Array(1) });',
  ])('rejects a broken declared public factory', async source => {
    const { app } = fixture({ dependencies: { [original]: '1.0.0' } });
    provider(app, original, original, source);
    await expect(
      resolveNativeConfigLoadProvider({ appDirectory: app, command: 'build' }),
    ).rejects.toThrow(/Native config provider/);
  });

  it.each([
    'serve',
    'new',
    'routes-generate',
  ])('does not resolve providers or read a manifest for %s', async command => {
    expect(
      await resolveNativeConfigLoadProvider({
        appDirectory: 'not-resolved',
        command,
      }),
    ).toBeUndefined();
  });
});
