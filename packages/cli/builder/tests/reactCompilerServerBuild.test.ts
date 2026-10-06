import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from '@rstest/core';
import { createBuilder } from '../src';

// A long fluent chain, as in API-only BFF modules that compose many
// `.addHttpApi(...)` groups. React Compiler's recursive pass overflows the
// default 2 MiB thread stack on this shape and aborts Rspack with SIGILL.
const HTTP_API_CHAIN_LENGTH = 300;

const createChainModule = () => {
  let source = 'const api = { addHttpApi: () => api };\nexport const Api = api';
  for (let index = 0; index < HTTP_API_CHAIN_LENGTH; index++) {
    source += `.addHttpApi(${index})`;
  }
  return `${source};\n`;
};

describe('source.reactCompiler server builds', () => {
  const cwds: string[] = [];

  afterAll(async () => {
    await Promise.all(
      cwds.map(cwd => rm(cwd, { recursive: true, force: true })),
    );
  });

  test('builds a long addHttpApi chain for node and worker SSR targets', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'modern-builder-react-compiler-'));
    cwds.push(cwd);
    const entry = join(cwd, 'api.ts');
    await writeFile(entry, createChainModule());

    const builder = await createBuilder({
      bundlerType: 'rspack',
      cwd,
      config: {
        source: { reactCompiler: true },
        output: { disableTsChecker: true },
        environments: {
          server: {
            source: { entry: { api: entry } },
            output: { target: 'node', distPath: { root: 'dist/server' } },
          },
          workerSSR: {
            source: { entry: { api: entry } },
            output: {
              target: 'web-worker',
              distPath: { root: 'dist/worker' },
            },
          },
        },
      },
    });

    const result = await builder.build();

    expect(result.stats?.hasErrors()).toBe(false);
    await result.close();
  });

  test('builds a long addHttpApi chain for the Cloudflare web-target worker', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'modern-builder-react-compiler-'));
    cwds.push(cwd);
    const entry = join(cwd, 'api.ts');
    await writeFile(entry, createChainModule());

    // Cloudflare deploys rewrite workerSSR to output.target 'web'.
    const builder = await createBuilder({
      bundlerType: 'rspack',
      cwd,
      config: {
        source: { reactCompiler: true },
        output: { disableTsChecker: true },
        environments: {
          workerSSR: {
            source: { entry: { api: entry } },
            output: {
              target: 'web',
              module: true,
              distPath: { root: 'dist/worker' },
            },
          },
        },
      },
    });

    const result = await builder.build();

    expect(result.stats?.hasErrors()).toBe(false);
    await result.close();
  });
});
