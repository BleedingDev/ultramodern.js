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

  it('does not treat a regex after a control-flow condition as module syntax', () => {
    const source = `if (true) /from '@shared'/.test('x');`;

    expect(
      rewriteImportSpecifiers(source, specifier =>
        specifier === '@shared' ? './shared.js' : undefined,
      ),
    ).toEqual({ content: source, changed: false });
  });

  it('rewrites imports in JavaScript output that preserves JSX', () => {
    const source = [
      `import Widget from '@a/widget';`,
      `export const view = <Widget source="@a/runtime-data" />;`,
    ].join('\n');

    expect(run(source)).toEqual({
      content: [
        `import Widget from './widget.js';`,
        `export const view = <Widget source="@a/runtime-data" />;`,
      ].join('\n'),
      changed: true,
    });
  });

  it('rewrites module calls nested inside another call argument', () => {
    const source = [
      `const x = __importDefault(require('@a/x'));`,
      `const y = Promise.resolve().then(() => require('@a/y'));`,
    ].join('\n');

    expect(run(source)).toEqual({
      content: [
        `const x = __importDefault(require('./x.js'));`,
        `const y = Promise.resolve().then(() => require('./y.js'));`,
      ].join('\n'),
      changed: true,
    });
  });

  it('keeps UTF-8 spans exact across multiple rewritten specifiers', () => {
    const source = [
      `const label = '💥漢';`,
      `import rocket from '@a/💥';`,
      `export { rocket as han } from '@a/漢';`,
    ].join('\n');

    expect(run(source)).toEqual({
      content: [
        `const label = '💥漢';`,
        `import rocket from './💥.js';`,
        `export { rocket as han } from './漢.js';`,
      ].join('\n'),
      changed: true,
    });
  });

  it('rewrites TypeScript declaration module references', () => {
    const source = [
      `import type { Input } from '@a/input';`,
      `export type { Output } from '@a/output';`,
      `type Lazy = import('@a/lazy').Lazy;`,
      `type Factory = typeof import('@a/factory');`,
      `import Legacy = require('@a/legacy');`,
    ].join('\n');

    expect(run(source)).toEqual({
      content: [
        `import type { Input } from './input.js';`,
        `export type { Output } from './output.js';`,
        `type Lazy = import('./lazy.js').Lazy;`,
        `type Factory = typeof import('./factory.js');`,
        `import Legacy = require('./legacy.js');`,
      ].join('\n'),
      changed: true,
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
