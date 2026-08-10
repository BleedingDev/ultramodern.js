import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fs } from '@modern-js/utils';
import { rewriteImportSpecifiers } from '../src/compilers/typescript/importRewriter';

const require = createRequire(import.meta.url);

const rewriteAlias = (specifier: string) =>
  specifier.startsWith('@a/')
    ? `${specifier.replace('@a/', './')}.js`
    : undefined;

const run = (content: string) => rewriteImportSpecifiers(content, rewriteAlias);

describe('rewriteImportSpecifiers', () => {
  let fixtureDir: string;

  beforeEach(async () => {
    fixtureDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'server-utils-import-rewriter-')),
    );
    await fs.outputJSON(path.join(fixtureDir, 'package.json'), {
      type: 'module',
    });
  });

  afterEach(async () => {
    await fs.remove(fixtureDir);
  });

  it('produces an executable ESM graph for every supported import form', async () => {
    await Promise.all([
      fs.outputFile(path.join(fixtureDir, 'x.js'), `export default 'x';\n`),
      fs.outputFile(path.join(fixtureDir, 'y.js'), `export const y = 'y';\n`),
      fs.outputFile(path.join(fixtureDir, 'z.js'), `export const z = 'z';\n`),
      fs.outputFile(
        path.join(fixtureDir, 'side-effect.js'),
        `globalThis.__importRewriterSideEffect = 'loaded';\n`,
      ),
      fs.outputFile(path.join(fixtureDir, 'd.js'), `export const d = 'd';\n`),
    ]);

    const { content, changed } = run(
      [
        `import x from '@a/x';`,
        `import { y } from '@a/y';`,
        `export { z } from '@a/z';`,
        `import '@a/side-effect';`,
        `const dynamic = await import('@a/d');`,
        `export const template = \`mod: \${dynamic.d}\`;`,
        `export default { dynamic: dynamic.d, sideEffect: globalThis.__importRewriterSideEffect, x, y };`,
      ].join('\n'),
    );
    expect(changed).toBe(true);
    const entry = path.join(fixtureDir, 'entry.mjs');
    await fs.outputFile(entry, content);

    await expect(import(pathToFileURL(entry).href)).resolves.toMatchObject({
      default: {
        dynamic: 'd',
        sideEffect: 'loaded',
        x: 'x',
        y: 'y',
      },
      template: 'mod: d',
      z: 'z',
    });
  });

  it('produces executable CommonJS with whitespace around require', async () => {
    await fs.outputJSON(path.join(fixtureDir, 'package.json'), {
      type: 'commonjs',
    });
    await fs.outputFile(
      path.join(fixtureDir, 'm.js'),
      `module.exports = { value: 'required' };\n`,
    );
    const { content, changed } = run(`module.exports = require ( '@a/m' );`);
    expect(changed).toBe(true);
    const entry = path.join(fixtureDir, 'entry.cjs');
    await fs.outputFile(entry, content);

    expect(require(entry)).toEqual({ value: 'required' });
  });

  it('preserves runtime data and expressions that only resemble module syntax', async () => {
    const { content, changed } = run(
      [
        `const total = 8;`,
        `const helper = { require: value => value, import: value => value };`,
        `module.exports = {`,
        `  array: Array.from('@a/x'),`,
        `  division: total / 2,`,
        `  memberImport: helper.import('@a/x'),`,
        `  memberRequire: helper.require('@a/x'),`,
        `  regex: /['"]/.test('"'),`,
        `  string: "see require('@a/m') for details",`,
        `  template: \`import { x } from '@a/x'\`,`,
        `};`,
      ].join('\n'),
    );
    expect(changed).toBe(false);
    const entry = path.join(fixtureDir, 'data.cjs');
    await fs.outputFile(entry, content);

    expect(require(entry)).toEqual({
      array: [...'@a/x'],
      division: 4,
      memberImport: '@a/x',
      memberRequire: '@a/x',
      regex: true,
      string: "see require('@a/m') for details",
      template: "import { x } from '@a/x'",
    });
  });

  it('leaves computed package imports to the runtime resolver', async () => {
    const packageDir = path.join(fixtureDir, 'node_modules/@a/locales');
    await fs.outputJSON(path.join(packageDir, 'package.json'), {
      exports: { './en.js': './en.js' },
      name: '@a/locales',
      type: 'module',
    });
    await fs.outputFile(
      path.join(packageDir, 'en.js'),
      `export const locale = 'en';\n`,
    );

    const { content, changed } = run(
      `const lang = 'en';\nexport default import('@a/locales/' + lang + '.js');`,
    );
    expect(changed).toBe(false);
    const entry = path.join(fixtureDir, 'computed.mjs');
    await fs.outputFile(entry, content);
    const runtime = await import(pathToFileURL(entry).href);

    await expect(runtime.default).resolves.toMatchObject({ locale: 'en' });
  });
});
