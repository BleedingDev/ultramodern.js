import { createRequire } from 'node:module';
import { fs } from '@modern-js/utils';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { rewriteOutputSpecifiers } from '../src/compilers/typescript';
import { getNotAliasedPath } from '../src/compilers/typescript/tsconfigPathsPlugin';

describe('rewriteOutputSpecifiers', () => {
  const require = createRequire(import.meta.url);
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
      `module.exports = { copied, note, shared: index_1.shared, tpl };`,
      `//# sourceMappingURL=index.js.map`,
      ``,
    ].join('\n');

    const outputFile = path.join(distDir, 'api/index.js');
    await fs.outputFile(outputFile, emitted);
    await fs.outputFile(
      path.join(distDir, 'shared/index.js'),
      `exports.shared = 'shared-runtime';\n`,
    );
    await fs.outputFile(`${outputFile}.map`, '{"version":3,"mappings":""}');

    await rewriteOutputSpecifiers(appDir, distDir, appDir, paths);

    const runtime = require(outputFile);
    expect(runtime).toMatchObject({
      copied: [...'@shared/index'],
      note: "see require('@shared/index') for details",
      shared: 'shared-runtime',
      tpl: "import { x } from '@shared/index'",
    });
    // The rewritten file must not reference (or ship) a stale sourcemap.
    expect(await fs.pathExists(`${outputFile}.map`)).toBe(false);
  });

  it('rewrites .mjs outputs emitted from .mts sources', async () => {
    const outputFile = path.join(distDir, 'api/util.mjs');
    await fs.outputFile(
      outputFile,
      `import { shared } from '@shared/index';\nexport default shared;\n`,
    );

    await rewriteOutputSpecifiers(appDir, distDir, appDir, paths, 'module');

    await fs.outputJSON(path.join(distDir, 'package.json'), { type: 'module' });
    await fs.outputFile(
      path.join(distDir, 'shared/index.js'),
      `export const shared = 'shared-runtime';\n`,
    );
    await expect(import(pathToFileURL(outputFile).href)).resolves.toMatchObject(
      {
        default: 'shared-runtime',
      },
    );
  });

  it('keeps sourcemaps for outputs that are not rewritten', async () => {
    const emitted = `"use strict";\nconst x = 1;\n//# sourceMappingURL=plain.js.map\n`;
    const outputFile = path.join(distDir, 'api/plain.js');
    await fs.outputFile(outputFile, emitted);
    await fs.outputFile(`${outputFile}.map`, '{"version":3,"mappings":""}');
    const before = await fs.stat(outputFile);

    await rewriteOutputSpecifiers(appDir, distDir, appDir, paths);

    const after = await fs.stat(outputFile);
    expect(after).toMatchObject({
      ino: before.ino,
      mtimeMs: before.mtimeMs,
      size: before.size,
    });
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
