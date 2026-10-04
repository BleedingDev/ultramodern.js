import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  version = '1.0.0',
) {
  const root = path.join(directory, 'node_modules', key);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: owner,
      version,
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
    'serve',
  ])('captures the original load for framework command %s', async command => {
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

  it('loads a cold real public SDK descriptor from its canonical published slot', () => {
    const { root, app } = fixture({
      devDependencies: { [original]: 'workspace:*' },
    });
    const sdk = path.resolve(__dirname, '../../ultramodern-app-tools');
    const owner = path.join(root, 'published-sdk');
    fs.mkdirSync(owner);
    fs.cpSync(path.join(sdk, 'dist'), path.join(owner, 'dist'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(owner, 'package.json'),
      JSON.stringify({
        ...JSON.parse(fs.readFileSync(path.join(sdk, 'package.json'), 'utf8')),
        name: mapped,
      }),
    );
    fs.symlinkSync(
      path.join(sdk, 'node_modules'),
      path.join(owner, 'node_modules'),
      'dir',
    );
    const slot = path.join(app, 'node_modules', original);
    fs.mkdirSync(path.dirname(slot), { recursive: true });
    fs.symlinkSync(owner, slot, 'dir');
    const source = pathToFileURL(
      path.resolve(__dirname, '../src/native-config-load-provider.ts'),
    ).href;
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { resolveNativeConfigLoadProvider } from ${JSON.stringify(source)};
const app = ${JSON.stringify(app)};
const request = ${JSON.stringify(`${original}/native-config-load`)};
const require = createRequire(app + '/package.json');
const entry = fs.realpathSync(require.resolve(request));
assert.equal(require.cache[entry], undefined, 'public SDK must be cold');
const result = await resolveNativeConfigLoadProvider({ appDirectory: app, command: 'dev' });
assert.equal(typeof result.wrapConfigLoad, 'function');
assert.equal(result.internalPlugins.length, 1);
assert.equal(result.internalPlugins[0].name, '@modern-js/ultramodern-configuration-read-context');
assert.equal(typeof result.internalPlugins[0].setup, 'function');
assert.equal(require.cache[entry]?.loaded, true);
assert.equal(JSON.parse(fs.readFileSync(app + '/package.json', 'utf8')).devDependencies[${JSON.stringify(original)}], 'workspace:*');
process.stdout.write('cold published SDK provider resolved\\n');`,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
    expect(child.stdout).toContain('cold published SDK provider resolved');
  });

  it.each([
    'workspace:*',
    'workspace:^',
    '^3.9.0-ultramodern.2026100301',
  ])('accepts the exact maintained publication in a canonical %s slot', async version => {
    const { app } = fixture({ dependencies: { [original]: version } });
    provider(app, original, mapped, undefined, '3.9.0-ultramodern.2026100301');
    expect(
      (
        await resolveNativeConfigLoadProvider({
          appDirectory: app,
          command: 'build',
        })
      )?.internalPlugins?.[0]?.name,
    ).toBe('provider-context');
  });

  it('accepts legal build metadata in its published version', async () => {
    const version = '1.0.0+build.1';
    const { app } = fixture({
      dependencies: { [original]: `npm:${mapped}@${version}` },
    });
    provider(app, original, mapped, undefined, version);
    expect(
      (
        await resolveNativeConfigLoadProvider({
          appDirectory: app,
          command: 'build',
        })
      )?.internalPlugins?.[0]?.name,
    ).toBe('provider-context');
  });

  it.each([
    'v1.0.0',
    '1.0.0 ',
  ])('rejects a noncanonical installed version %s', async version => {
    const { app } = fixture({ dependencies: { [original]: 'workspace:*' } });
    provider(
      app,
      original,
      mapped,
      "throw new Error('Noncanonical version evaluated');",
      version,
    );
    await expect(
      resolveNativeConfigLoadProvider({ appDirectory: app, command: 'build' }),
    ).rejects.toThrow('Invalid declared native config provider owner');
  });

  it.each([
    {
      key: original,
      request: 'workspace:*',
      owner: '@foreign/ultramodern-app-tools',
      version: '1.0.0',
    },
    { key: mapped, request: '1.0.0', owner: original, version: '1.0.0' },
    {
      key: original,
      request: `npm:${original}@1.0.0`,
      owner: mapped,
      version: '1.0.0',
    },
    {
      key: original,
      request: `npm:${mapped}@1.0.0`,
      owner: mapped,
      version: '2.0.0',
    },
    {
      key: original,
      request: 'workspace:*',
      owner: mapped,
      version: 'not-a-version',
    },
    { key: original, request: 'workspace:*', owner: mapped, version: '' },
  ])('rejects an invalid published owner or version $owner@$version', async ({
    key,
    request,
    owner,
    version,
  }) => {
    const { app } = fixture({ dependencies: { [key]: request } });
    provider(
      app,
      key,
      owner,
      "throw new Error('Invalid published owner evaluated');",
      version,
    );
    await expect(
      resolveNativeConfigLoadProvider({ appDirectory: app, command: 'build' }),
    ).rejects.toThrow('Invalid declared native config provider owner');
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

  it.each([
    original,
    mapped,
  ])('rejects a public entry that escapes its canonical %s owner', async name => {
    const { root, app } = fixture({
      dependencies: { [original]: 'workspace:*' },
    });
    const owner = provider(app, original, name);
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
