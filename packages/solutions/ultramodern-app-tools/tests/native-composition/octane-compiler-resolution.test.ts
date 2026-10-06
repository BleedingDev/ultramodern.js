import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRsbuild } from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import { createOctaneCompilerPlugin } from '../../src/renderers/octane/compiler';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function write(filename: string, source: string) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
}

describe('Octane compiler module resolution', () => {
  it('resolves extensionless TypeScript modules before case-colliding TSRX components', async () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(
        path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'octane-ext-'),
      ),
    );
    roots.push(root);
    write(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'octane-extension-order', private: true }),
    );
    // Released Octane bindings ship both link.ts and Link.tsrx; on a
    // case-insensitive file system './link' must still select link.ts.
    const router = path.join(root, 'node_modules/@octanejs/fixture-router/src');
    write(path.join(router, 'link.ts'), 'export const linkOptions = 1;\n');
    write(path.join(router, 'Link.tsrx'), 'export const Link = 1;\n');
    write(path.join(root, 'src/Counter.tsrx'), 'export const Counter = 1;\n');
    write(path.join(root, 'src/index.ts'), 'export {};\n');

    const rsbuild = await createRsbuild({
      cwd: root,
      rsbuildConfig: {
        source: { entry: { index: './src/index.ts' } },
        plugins: [
          createOctaneCompilerPlugin({ rendererIdentities: () => ({}) }),
        ],
      },
    });
    const compiler = await rsbuild.createCompiler();
    const single = 'compilers' in compiler ? compiler.compilers[0] : compiler;
    const extensions = single.options.resolve.extensions ?? [];
    expect(extensions.indexOf('.tsrx')).toBeGreaterThan(
      Math.max(extensions.indexOf('.ts'), extensions.indexOf('.tsx')),
    );
    const resolver = single.resolverFactory.get('normal', {
      ...single.options.resolve,
      dependencyType: 'esm',
    });
    expect(resolver.resolveSync({}, router, './link')).toBe(
      path.join(router, 'link.ts'),
    );
    expect(resolver.resolveSync({}, path.join(root, 'src'), './Counter')).toBe(
      path.join(root, 'src/Counter.tsrx'),
    );
    await new Promise<void>((resolve, reject) =>
      compiler.close(error => (error ? reject(error) : resolve())),
    );
  }, 120_000);
});
