import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { SERVICE_WORKER_ENVIRONMENT_NAME } from '@modern-js/builder';
import { createRsbuild } from '@rsbuild/core';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { DEFAULT_COMPATIBILITY_DATE } from '../src/cloudflare/constants';
import {
  createAbsentOptionalDependencyFilter,
  getCloudflareBuilderEnvironments,
  getCloudflareWorkerRspackConfig,
} from '../src/cloudflare-builder';
import {
  CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS,
  CLOUDFLARE_WORKER_NODE_BUILTINS,
} from '../src/cloudflare-output-contract';

const require = createRequire(import.meta.url);
const WORKER_TIMEOUT = 120_000;

const createMiniflare = (
  options: Parameters<typeof convertV4MiniflareOptions>[0],
) =>
  new Miniflare(
    convertV4MiniflareOptions({
      compatibilityDate: DEFAULT_COMPATIBILITY_DATE,
      compatibilityFlags: [...CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS],
      ...options,
    }),
  );

const writeFile = (root: string, file: string, contents: string) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
};

const writePackage = (
  root: string,
  name: string,
  manifest: Record<string, unknown>,
  source: string,
) => {
  writeFile(
    root,
    `node_modules/${name}/package.json`,
    JSON.stringify({
      name,
      type: 'module',
      exports: './index.js',
      ...manifest,
    }),
  );
  writeFile(root, `node_modules/${name}/index.js`, source);
};

describe('Cloudflare worker Node.js compatibility', () => {
  it(
    'lists exactly the Node.js built-ins that workerd provides under nodejs_compat',
    async () => {
      const candidates = [
        ...new Set(builtinModules.map(name => name.replace(/^node:/u, ''))),
      ];
      const worker = createMiniflare({
        modules: true,
        script: `export default { async fetch(request) {
          const available = [];
          for (const name of await request.json()) {
            try { await import('node:' + name); available.push(name); } catch {}
          }
          return Response.json(available);
        } };`,
      });
      try {
        const response = await worker.dispatchFetch('http://worker/', {
          body: JSON.stringify(candidates),
          method: 'POST',
        });
        const available = (await response.json()) as string[];
        expect([...available].sort()).toEqual(
          [...CLOUDFLARE_WORKER_NODE_BUILTINS].sort(),
        );
      } finally {
        await worker.dispose();
      }
    },
    WORKER_TIMEOUT,
  );

  it('externalizes bare built-ins only where Node accepts the bare name', () => {
    const { externals } = getCloudflareWorkerRspackConfig(['worker']);

    for (const builtin of [
      'console',
      'diagnostics_channel',
      'perf_hooks',
      'querystring',
    ]) {
      expect(externals[builtin]).toBe(`module-import node:${builtin}`);
      expect(externals[`node:${builtin}`]).toBe(
        `module-import node:${builtin}`,
      );
    }
    expect(externals['node:sqlite']).toBe('module-import node:sqlite');
    expect(externals).not.toHaveProperty('sqlite');
    expect(externals).not.toHaveProperty('test');
    expect(externals['cloudflare:sockets']).toBe(
      'module-import cloudflare:sockets',
    );
  });

  it('leaves only absent optional dependencies missing at runtime', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-optional-'));
    try {
      writePackage(
        root,
        'consumer',
        {
          optionalDependencies: { 'absent-optional': '*' },
          peerDependencies: {
            'absent-peer': '*',
            'installed-peer': '*',
            'required-peer': '*',
          },
          peerDependenciesMeta: {
            'absent-peer': { optional: true },
            'installed-peer': { optional: true },
          },
        },
        '',
      );
      writePackage(root, 'installed-peer', {}, '');
      const isIgnored = createAbsentOptionalDependencyFilter();
      const context = path.join(root, 'node_modules/consumer');

      expect(isIgnored('absent-peer', context)).toBe(true);
      expect(isIgnored('absent-peer/subpath', context)).toBe(true);
      expect(isIgnored('absent-optional', context)).toBe(true);
      expect(isIgnored('installed-peer', context)).toBe(false);
      expect(isIgnored('required-peer', context)).toBe(false);
      expect(isIgnored('./absent-peer', context)).toBe(false);
      expect(isIgnored('absent-peer', root)).toBe(false);
    } finally {
      fs.rmSync(root, { force: true, recursive: true });
    }
  });

  it(
    'bundles pg, the added built-ins, and an absent optional peer into a worker that loads in workerd',
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-pg-worker-'));
      let worker: Miniflare | undefined;
      try {
        fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
        fs.symlinkSync(
          path.dirname(require.resolve('pg/package.json')),
          path.join(root, 'node_modules/pg'),
          'junction',
        );
        // Mirrors `@redis/client`, which guards an import of its optional
        // `@node-rs/xxhash` peer.
        writePackage(
          root,
          'optional-peer-consumer',
          {
            peerDependencies: { 'absent-optional-peer': '*' },
            peerDependenciesMeta: {
              'absent-optional-peer': { optional: true },
            },
          },
          `export const loadOptionalPeer = async () => {
            try { return (await import('absent-optional-peer')).value; }
            catch (error) { return error.code; }
          };`,
        );
        writeFile(
          root,
          'worker.ts',
          `import { Console } from 'console';
import diagnosticsChannel from 'node:diagnostics_channel';
import { performance } from 'perf_hooks';
import querystring from 'node:querystring';
import pg from 'pg';
import { loadOptionalPeer } from 'optional-peer-consumer';

export default {
  async fetch() {
    const pool = new pg.Pool({
      connectionString: 'postgres://user:secret@127.0.0.1:9/database',
      connectionTimeoutMillis: 5000,
    });
    const query = await pool.query('select 1').then(
      () => 'connected',
      error => String(error?.message ?? error),
    );
    await pool.end();
    return Response.json({
      channel: typeof diagnosticsChannel.channel('probe').publish,
      client: typeof pg.Client,
      console: typeof Console,
      now: typeof performance.now(),
      optionalPeer: await loadOptionalPeer(),
      query,
      search: querystring.stringify({ worker: 'workerd' }),
    });
  },
};
`,
        );
        const environments = getCloudflareBuilderEnvironments({
          appContext: {
            apiDirectory: path.join(root, 'api'),
            appDirectory: root,
          },
          environments: {
            [SERVICE_WORKER_ENVIRONMENT_NAME]: {
              output: { target: 'web-worker' },
              source: { entry: { worker: path.join(root, 'worker.ts') } },
            },
          },
          normalizedConfig: { deploy: { target: 'cloudflare' } },
        });
        const rsbuild = await createRsbuild({
          cwd: root,
          rsbuildConfig: {
            environments: Object.fromEntries(
              Object.entries(environments).map(([name, environment]) => [
                name,
                {
                  ...environment,
                  output: {
                    ...environment.output,
                    distPath: { root: 'dist', js: 'worker' },
                    filenameHash: false,
                    minify: false,
                  },
                },
              ]),
            ),
            mode: 'production',
          },
        });
        await rsbuild.build();

        const outputDirectory = path.join(root, 'dist/worker');
        const chunks = fs
          .readdirSync(outputDirectory)
          .filter(file => file.endsWith('.js'));
        const bundle = chunks
          .map(file =>
            fs.readFileSync(path.join(outputDirectory, file), 'utf8'),
          )
          .join('\n');
        expect(bundle).toContain('from "node:perf_hooks"');
        expect(bundle).toContain('"cloudflare:sockets"');
        expect(bundle).not.toContain('pg-cloudflare/dist/empty.js');
        writeFile(
          outputDirectory,
          'main.mjs',
          "import handler from './worker.js';\nexport default handler;\n",
        );
        worker = createMiniflare({
          modules: ['main.mjs', ...chunks].map(file => ({
            path: path.join(outputDirectory, file),
            type: 'ESModule' as const,
          })),
          modulesRoot: outputDirectory,
        });
        const response = await worker.dispatchFetch('http://worker/');
        expect(response.status).toBe(200);
        const result = (await response.json()) as Record<string, string>;
        expect(result).toMatchObject({
          channel: 'function',
          client: 'function',
          console: 'function',
          now: 'number',
          optionalPeer: 'MODULE_NOT_FOUND',
          search: 'worker=workerd',
        });
        // The query reaches workerd's `cloudflare:sockets` connect through
        // `pg-cloudflare`; only the network refusal remains.
        expect(result.query).not.toMatch(
          /not a constructor|require is not defined|No such module/u,
        );
        expect(result.query).not.toBe('connected');
      } finally {
        await worker?.dispose();
        fs.rmSync(root, { force: true, recursive: true });
      }
    },
    WORKER_TIMEOUT,
  );
});
