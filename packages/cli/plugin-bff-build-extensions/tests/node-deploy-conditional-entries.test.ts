import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fs } from '@modern-js/utils';
import { resolveESMDependency } from '../../../solutions/app-tools/src/plugins/deploy/utils';

const requireFromAppTools = createRequire(
  path.resolve(__dirname, '../../../solutions/app-tools/package.json'),
);
const { nodeFileTrace } = requireFromAppTools('ndepe') as {
  nodeFileTrace: (
    entries: string[],
    options: { base: string },
  ) => Promise<{ fileList: Set<string> }>;
};

test('the real Hono binder remains available through Node import and require', async () => {
  const imported = await import('@modern-js/plugin-bff-extensions/hono/node');
  const required = createRequire(import.meta.url)(
    '@modern-js/plugin-bff-extensions/hono/node',
  ) as typeof imported;
  expect(typeof imported.createHonoRouteBinder).toBe('function');
  expect(typeof required.createHonoRouteBinder).toBe('function');
});

test('Node deploy traces both runtime conditions for a declared Hono binder', async () => {
  const appDirectory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'hono deploy # conditions-')),
  );
  try {
    const packageDirectory = path.join(
      appDirectory,
      'node_modules/@modern-js/plugin-bff-extensions',
    );
    await fs.outputJSON(path.join(packageDirectory, 'package.json'), {
      name: '@modern-js/plugin-bff-extensions',
      exports: {
        './hono/node': {
          node: {
            import: './dist/esm-node/hono/node.mjs',
            require: './dist/cjs/hono/node.js',
          },
        },
      },
    });
    await fs.outputFile(
      path.join(packageDirectory, 'dist/esm-node/hono/node.mjs'),
      'export const createHonoRouteBinder = () => {};',
    );
    await fs.outputFile(
      path.join(packageDirectory, 'dist/cjs/hono/node.js'),
      'exports.createHonoRouteBinder = () => {};',
    );
    await fs.outputJSON(path.join(appDirectory, 'package.json'), {
      type: 'module',
    });
    const entry = path.join(appDirectory, 'index.js');
    await fs.outputFile(
      entry,
      "const binder = '@modern-js/plugin-bff-extensions/hono/node'; console.log(binder);",
    );

    const specifier = '@modern-js/plugin-bff-extensions/hono/node';
    const requireEntry = createRequire(
      path.join(appDirectory, 'package.json'),
    ).resolve(specifier);
    const importEntry = await resolveESMDependency(specifier, appDirectory);
    expect(path.normalize(importEntry!)).toBe(
      path.join(packageDirectory, 'dist/esm-node/hono/node.mjs'),
    );
    const trace = await nodeFileTrace([entry, requireEntry, importEntry], {
      base: appDirectory,
    });
    expect([...trace.fileList].map(file => file.replace(/\\/g, '/'))).toEqual(
      expect.arrayContaining([
        'node_modules/@modern-js/plugin-bff-extensions/dist/cjs/hono/node.js',
        'node_modules/@modern-js/plugin-bff-extensions/dist/esm-node/hono/node.mjs',
      ]),
    );
  } finally {
    await fs.remove(appDirectory);
  }
});
