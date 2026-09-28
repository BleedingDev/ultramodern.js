import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRsbuild, type EnvironmentConfig } from '@rsbuild/core';
import { getCloudflareBuilderEnvironments } from '../src/cloudflare-builder';
import { CLOUDFLARE_WORKER_NODE_BUILTINS } from '../src/cloudflare-output-contract';
import { getTemplatePath } from '../src/read-template';

const cloudflareDeployTarget = {
  target: 'cloudflare',
  explicit: true,
} as const;

const createWorkerEnvironments = (
  entry = './src/bootstrap.jsx',
): Record<string, EnvironmentConfig> => ({
  client: { output: { target: 'web' } },
  workerSSR: {
    output: { target: 'web-worker' },
    source: { entry: { main: [entry] } },
  },
});

describe('Cloudflare builder environments', () => {
  it.each([
    { deployTarget: { target: 'cloudflare', explicit: true }, enabled: true },
    { deployTarget: { target: 'cloudflare', explicit: false }, enabled: true },
    { deployTarget: { target: 'node', explicit: true }, enabled: false },
    { deployTarget: undefined, enabled: false },
  ] as const)('selects Cloudflare worker output from the resolved deploy target', ({
    deployTarget,
    enabled,
  }) => {
    const environments = createWorkerEnvironments('./src/bootstrap.server.jsx');
    const result = getCloudflareBuilderEnvironments({
      appContext: {
        apiDirectory: '/app/api',
        appDirectory: '/app',
        deployTarget,
      },
      environments,
      normalizedConfig: {},
    });

    if (!enabled) {
      expect(result).toBe(environments);
      return;
    }

    expect(result).not.toBe(environments);
    expect(result.workerSSR?.output).toMatchObject({
      module: true,
      target: 'web',
    });
    expect(result.workerSSR?.source?.entry).toEqual({
      main: ['./src/index.server.jsx'],
    });
  });

  it('rewrites worker entries and adds an Effect BFF entry before user handlers', () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-cloudflare-builder-'),
    );
    const apiDirectory = path.join(appDirectory, 'api');

    try {
      fs.mkdirSync(apiDirectory, { recursive: true });
      fs.writeFileSync(path.join(apiDirectory, 'index.ts'), '');
      const result = getCloudflareBuilderEnvironments({
        appContext: {
          apiDirectory,
          appDirectory,
          deployTarget: cloudflareDeployTarget,
        },
        environments: createWorkerEnvironments(),
        normalizedConfig: {
          bff: { runtimeFramework: 'effect' },
        },
      });

      expect(result.workerSSR?.source?.entry).toEqual({
        main: ['./src/index.server.jsx'],
        __modern_bff_effect: [
          `${path.join(apiDirectory, 'index.ts')}?modern-bff-runtime`,
        ],
      });
      expect(result.workerSSR?.tools?.htmlPlugin).toBe(false);
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
    }
  });

  it('creates only a genuine Effect worker environment for a headless Cloudflare API', () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-cloudflare-headless-builder-'),
    );
    const apiDirectory = path.join(appDirectory, 'api');

    try {
      fs.mkdirSync(apiDirectory, { recursive: true });
      fs.writeFileSync(path.join(apiDirectory, 'index.ts'), '');
      const result = getCloudflareBuilderEnvironments({
        appContext: {
          apiOnly: true,
          apiDirectory,
          appDirectory,
          deployTarget: cloudflareDeployTarget,
        },
        environments: {
          client: { output: { target: 'web' }, source: { entry: {} } },
          server: { output: { target: 'node' }, source: { entry: {} } },
        },
        normalizedConfig: {
          bff: { runtimeFramework: 'effect' },
        },
      });

      expect(Object.keys(result)).toEqual(['workerSSR']);
      expect(result.workerSSR?.output).toMatchObject({
        module: true,
        target: 'web',
      });
      expect(result.workerSSR?.source?.entry).toEqual({
        __modern_bff_effect: [
          `${path.join(apiDirectory, 'index.ts')}?modern-bff-runtime`,
        ],
      });
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
    }
  });

  it('leaves Node built-ins and @loadable/server to externals and the real package', async () => {
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-cloudflare-builder-alias-'),
    );

    try {
      fs.mkdirSync(path.join(appDirectory, 'src'));
      fs.writeFileSync(path.join(appDirectory, 'src/index.server.jsx'), '');
      const environments = getCloudflareBuilderEnvironments({
        appContext: {
          apiDirectory: '/app/api',
          appDirectory,
          deployTarget: cloudflareDeployTarget,
        },
        environments: createWorkerEnvironments(),
        normalizedConfig: {},
      });
      const rsbuild = await createRsbuild({
        cwd: appDirectory,
        rsbuildConfig: { environments: { workerSSR: environments.workerSSR } },
      });
      const [config] = await rsbuild.initConfigs();
      const aliases = config.resolve?.alias as Record<string, unknown>;
      const aliasKeys = Object.keys(aliases).map(key =>
        key.replace(/\$$/u, ''),
      );
      const builtinRequests = CLOUDFLARE_WORKER_NODE_BUILTINS.flatMap(
        builtin => [builtin, `node:${builtin}`],
      );

      expect(aliasKeys.filter(key => builtinRequests.includes(key))).toEqual(
        [],
      );
      expect(aliasKeys).not.toContain('@loadable/server');
      // RSC and TanStack SSR entries resolve through package export
      // conditions (`workerd`), never through pinned dist files.
      expect(aliasKeys.filter(key => key.endsWith('.node'))).toEqual([]);
      expect(
        aliasKeys.filter(key =>
          /^(?:@modern-js\/render|@modern-js\/runtime\/rsc|@tanstack\/router-core)/u.test(
            key,
          ),
        ),
      ).toEqual([]);
      expect(config.resolve?.conditionNames).toContain('workerd');
      expect(
        Object.values(aliases).filter(
          target =>
            typeof target === 'string' &&
            target.startsWith(getTemplatePath('')),
        ),
      ).toEqual([]);
      // Module Federation's SSR runtime plugins resolve to its no-op worker
      // entries through the `worker` condition (module-federation/core#5155),
      // not through aliases to a local stub.
      expect(
        aliasKeys.filter(key => key.startsWith('@module-federation/')),
      ).toEqual([]);
      expect(config.resolve?.conditionNames).toContain('worker');
      expect(config.resolve?.fallback ?? {}).not.toHaveProperty('fs');
      expect(config.externals).toMatchObject({
        fs: 'module-import node:fs',
        'node:path': 'module-import node:path',
      });
    } finally {
      fs.rmSync(appDirectory, { force: true, recursive: true });
    }
  });
});
