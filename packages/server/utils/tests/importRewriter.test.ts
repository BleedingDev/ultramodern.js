import { rewriteImportSpecifiers } from '../src/compilers/typescript/importRewriter';

const rewriteAlias = (specifier: string) =>
  specifier.startsWith('@a/') ? specifier.replace('@a/', './') : undefined;

const run = (content: string) => rewriteImportSpecifiers(content, rewriteAlias);

describe('rewriteImportSpecifiers', () => {
  it('rewrites static import, export-from, bare import, require and dynamic import', () => {
    const input = [
      `import x from '@a/x';`,
      `import { y } from "@a/y";`,
      `export { z } from '@a/z';`,
      `import '@a/side-effect';`,
      `const m = require('@a/m');`,
      `const d = await import('@a/d');`,
    ].join('\n');

    const { content, changed } = run(input);

    expect(changed).toBe(true);
    expect(content).toBe(
      [
        `import x from './x';`,
        `import { y } from "./y";`,
        `export { z } from './z';`,
        `import './side-effect';`,
        `const m = require('./m');`,
        `const d = await import('./d');`,
      ].join('\n'),
    );
  });

  it('handles whitespace between the callee and the specifier', () => {
    const { content } = run(
      `const m = require ( '@a/m' );\nimport(\n  '@a/d'\n);`,
    );

    expect(content).toContain(`require ( './m' )`);
    expect(content).toContain(`'./d'`);
  });

  it('does not rewrite a string fragment in a non-literal dynamic import', () => {
    const input = `const locale = import('@a/locales/' + lang + '.js');`;

    const { content, changed } = run(input);

    expect(changed).toBe(false);
    expect(content).toBe(input);
  });

  it('does not rewrite specifier-like text inside string literals', () => {
    const input = [
      `const a = "see require('@a/m') for details";`,
      `const b = 'import x from "@a/x"';`,
      `const c = 'don\\'t require(\\'@a/m\\')';`,
    ].join('\n');

    const { content, changed } = run(input);

    expect(changed).toBe(false);
    expect(content).toBe(input);
  });

  it('does not rewrite specifier-like text inside comments', () => {
    const input = [
      `// const a = require('@a/m');`,
      `/* import { b } from '@a/x' */`,
      `/**`,
      ` * import { c } from '@a/x'`,
      ` */`,
      `const ok = 1;`,
    ].join('\n');

    const { content, changed } = run(input);

    expect(changed).toBe(false);
    expect(content).toBe(input);
  });

  it('does not rewrite specifier-like text inside template literals', () => {
    const input = "const t = `import { x } from '@a/x'`;";

    const { content, changed } = run(input);

    expect(changed).toBe(false);
    expect(content).toBe(input);
  });

  it('rewrites dynamic imports inside template interpolations', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the raw `${...}` text is the input under test
    const input = "const t = `mod: ${import('@a/x')}`;";

    const { content } = run(input);

    // biome-ignore lint/suspicious/noTemplateCurlyInString: the raw `${...}` text is the expected output
    expect(content).toBe("const t = `mod: ${import('./x')}`;");
  });

  it('does not treat member calls or suffixed identifiers as module syntax', () => {
    const input = [
      `const a = Array.from('@a/x');`,
      `const b = foo.require('@a/x');`,
      `const c = foo?.import('@a/x');`,
      `const d = myrequire('@a/x');`,
      `const e = { import: '@a/x', from: '@a/y' };`,
    ].join('\n');

    const { content, changed } = run(input);

    expect(changed).toBe(false);
    expect(content).toBe(input);
  });

  it('is not derailed by regex literals containing quotes', () => {
    const input = `const re = /['"]/;\nimport x from '@a/x';`;

    const { content } = run(input);

    expect(content).toBe(`const re = /['"]/;\nimport x from './x';`);
  });

  it('keeps division expressions intact while still rewriting later imports', () => {
    const input = `const half = total / 2;\nconst m = require('@a/m');`;

    const { content } = run(input);

    expect(content).toBe(`const half = total / 2;\nconst m = require('./m');`);
  });

  it('leaves files without matching specifiers untouched', () => {
    const input = `import fs from 'node:fs';\nconst x = require('bare-package');`;

    const { content, changed } = run(input);

    expect(changed).toBe(false);
    expect(content).toBe(input);
  });
});
