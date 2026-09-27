import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement, useContext } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const srcDir = resolve(__dirname, '../../src');
const contextDir = join(srcDir, 'core/context');

const bundle = async (tempDir: string, name: string, entry: string) => {
  const outfile = resolve(tempDir, `${name}.mjs`);
  await build({
    entryPoints: [entry],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    outfile,
    // Resolve the self-reference like an installed package, not through the
    // package's own tsconfig `paths`.
    tsconfigRaw: {},
  });
  return import(pathToFileURL(outfile).href);
};

test('a separately bundled subpath reads the contexts through @modern-js/runtime/context', async () => {
  const tempDir = await mkdtemp(resolve(__dirname, '.runtime-resolver-'));
  try {
    const providerEntry = join(tempDir, 'provider.ts');
    await writeFile(
      providerEntry,
      "export * from '@modern-js/runtime/context';",
    );
    const provider = await bundle(tempDir, 'provider', providerEntry);
    const head = await bundle(tempDir, 'head', join(srcDir, 'exports/head.ts'));
    const Selected = ({ title }: { title: string }) => {
      const request = useContext(provider.RuntimeContext) as {
        requestId: string;
      };
      return createElement('p', null, `${request.requestId}:${title}`);
    };
    const request = (requestId: string) =>
      createElement(
        provider.RuntimeComponentResolverContext.Provider,
        { value: () => Selected },
        createElement(
          provider.RuntimeContext.Provider,
          { value: { requestId } },
          createElement(head.Helmet, { title: 'head' }),
        ),
      );
    expect(renderToStaticMarkup(request('first'))).toBe('<p>first:head</p>');
    expect(renderToStaticMarkup(request('second'))).toBe('<p>second:head</p>');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('each evaluation owns its contexts and publishes nothing on globalThis', async () => {
  const tempDir = await mkdtemp(resolve(__dirname, '.runtime-context-'));
  try {
    const entry = join(contextDir, 'runtime.ts');
    const before = await bundle(tempDir, 'before', entry);
    const after = await bundle(tempDir, 'after', entry);
    expect(after.RuntimeContext).not.toBe(before.RuntimeContext);
    expect(after.InternalRuntimeContext).not.toBe(
      before.InternalRuntimeContext,
    );
    expect(
      Object.getOwnPropertySymbols(globalThis).map(String),
    ).not.toContainEqual(expect.stringContaining('@modern-js/runtime'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

// Module Federation shares the contexts by the `@modern-js/runtime/context`
// request. A relative import from another subpath would give that subpath a
// private copy whenever the host does not share the same subpath.
test('only core/context imports the context definitions by relative path', () => {
  const definitions = new Set(
    ['index.ts', 'runtime.ts'].map(file => join(contextDir, file)),
  );
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      const file = join(dir, name);
      return statSync(file).isDirectory() ? files(file) : [file];
    });
  const violations = files(srcDir)
    .filter(file => /\.tsx?$/.test(file) && dirname(file) !== contextDir)
    .flatMap(file =>
      [
        ...readFileSync(file, 'utf8').matchAll(
          /^(?:import|export)\s+(type\s+)?[^;]*?from\s+'(\.[^']*)'/gms,
        ),
      ]
        .filter(([, typeOnly, specifier]) => {
          if (typeOnly) return false;
          const target = resolve(dirname(file), specifier);
          return [target, `${target}.ts`, join(target, 'index.ts')].some(
            candidate => definitions.has(candidate),
          );
        })
        .map(([, , specifier]) => `${relative(srcDir, file)} -> ${specifier}`),
    );
  expect(violations).toEqual([]);
});
