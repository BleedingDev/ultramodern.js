import { fs } from '@modern-js/utils';
import os from 'os';
import path from 'path';
import { rewriteOutputSpecifiers } from '../src/compilers/typescript';
import { getNotAliasedPath } from '../src/compilers/typescript/tsconfigPathsPlugin';

describe('rewriteOutputSpecifiers', () => {
  let appDir: string;
  let distDir: string;

  const paths = { '@shared/*': ['./shared/*'] };

  beforeEach(async () => {
    appDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'server-utils-rewrite-')),
    );
    distDir = path.join(appDir, 'dist');

    // Source files: only used to map dist outputs back to their sources.
    await fs.outputFile(
      path.join(appDir, 'shared/index.ts'),
      `export const shared = 'shared';\n`,
    );
    await fs.outputFile(path.join(appDir, 'api/index.ts'), '// source\n');
    await fs.outputFile(path.join(appDir, 'api/util.mts'), '// source\n');
    await fs.outputFile(path.join(appDir, 'api/plain.ts'), '// source\n');
  });

  afterEach(async () => {
    await fs.remove(appDir);
  });

  it('rewrites only real module syntax and drops the stale sourcemap', async () => {
    const emitted = [
      `"use strict";`,
      `// commented: const a = require('@shared/index')`,
      `/* import { b } from '@shared/index' */`,
      `const note = "see require('@shared/index') for details";`,
      "const tpl = `import { x } from '@shared/index'`;",
      `const re = /['"]/;`,
      `const copied = Array.from('@shared/index');`,
      `const index_1 = require("@shared/index");`,
      `const dyn = () => import('@shared/index');`,
      `module.exports = index_1.shared;`,
      `//# sourceMappingURL=index.js.map`,
      ``,
    ].join('\n');

    const outputFile = path.join(distDir, 'api/index.js');
    await fs.outputFile(outputFile, emitted);
    await fs.outputFile(`${outputFile}.map`, '{"version":3,"mappings":""}');

    await rewriteOutputSpecifiers(appDir, distDir, appDir, paths);

    const content = await fs.readFile(outputFile, 'utf8');

    // Real module syntax is rewritten.
    expect(content).toContain(`const index_1 = require("../shared/index");`);
    expect(content).toContain(`const dyn = () => import('../shared/index');`);

    // Comments, strings and template literals are untouched.
    expect(content).toContain(
      `// commented: const a = require('@shared/index')`,
    );
    expect(content).toContain(`/* import { b } from '@shared/index' */`);
    expect(content).toContain(
      `const note = "see require('@shared/index') for details";`,
    );
    expect(content).toContain(
      "const tpl = `import { x } from '@shared/index'`;",
    );
    expect(content).toContain(`const copied = Array.from('@shared/index');`);

    // The rewritten file must not reference (or ship) a stale sourcemap.
    expect(content).not.toContain('sourceMappingURL');
    expect(await fs.pathExists(`${outputFile}.map`)).toBe(false);
  });

  it('rewrites .mjs outputs emitted from .mts sources', async () => {
    const outputFile = path.join(distDir, 'api/util.mjs');
    await fs.outputFile(
      outputFile,
      `import { shared } from '@shared/index';\nexport default shared;\n`,
    );

    await rewriteOutputSpecifiers(appDir, distDir, appDir, paths, 'module');

    const content = await fs.readFile(outputFile, 'utf8');
    expect(content).toContain(`from '../shared/index.js'`);
  });

  it('keeps sourcemaps for outputs that are not rewritten', async () => {
    const emitted = `"use strict";\nconst x = 1;\n//# sourceMappingURL=plain.js.map\n`;
    const outputFile = path.join(distDir, 'api/plain.js');
    await fs.outputFile(outputFile, emitted);
    await fs.outputFile(`${outputFile}.map`, '{"version":3,"mappings":""}');

    await rewriteOutputSpecifiers(appDir, distDir, appDir, paths);

    expect(await fs.readFile(outputFile, 'utf8')).toBe(emitted);
    expect(await fs.pathExists(`${outputFile}.map`)).toBe(true);
  });

  it('rewrites Windows absolute alias matches to relative specifiers', () => {
    const matcher = (() => 'D:\\repo\\app\\shared\\index') as any;

    expect(
      getNotAliasedPath(
        'D:\\repo\\app\\api\\index.ts',
        matcher,
        '@shared/index',
      ),
    ).toBe('../shared/index');
    expect(
      getNotAliasedPath(
        'D:\\repo\\app\\api\\index.ts',
        matcher,
        '@shared/index',
        'module',
      ),
    ).toBe('../shared/index.js');
  });
});
