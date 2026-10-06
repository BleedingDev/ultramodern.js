import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const moduleExtensions = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);
const relativeSpecifier =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"]*)\2/gu;

/**
 * An entry copy sits one directory deeper than the source it was copied from,
 * so relative module specifiers that leave the source tree (for example the
 * generated `src/ultramodern-build.ts` re-exporting `../shared/ultramodern-build`)
 * must be re-anchored from the copy. Specifiers inside the tree move with it.
 */
async function rebaseEscapingSpecifiers(sourceRoot, copyRoot, finalRoot) {
  async function visit(relativeDirectory) {
    const directory = path.join(copyRoot, relativeDirectory);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(relative);
        continue;
      }
      if (!moduleExtensions.has(path.extname(entry.name))) continue;
      const file = path.join(copyRoot, relative);
      const original = path.dirname(path.join(sourceRoot, relative));
      const contents = await fs.readFile(file, 'utf8');
      const rebased = contents.replace(
        relativeSpecifier,
        (match, prefix, quote, specifier) => {
          const target = path.resolve(original, specifier);
          const inside = path.relative(sourceRoot, target);
          if (
            inside !== '..' &&
            !inside.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(inside)
          )
            return match;
          let next = path
            .relative(path.dirname(path.join(finalRoot, relative)), target)
            .split(path.sep)
            .join('/');
          if (!next.startsWith('.')) next = `./${next}`;
          if (specifier.endsWith('/') && !next.endsWith('/')) next += '/';
          return `${prefix}${quote}${next}${quote}`;
        },
      );
      if (rebased !== contents) await fs.writeFile(file, rebased);
    }
  }
  await visit('');
}

/**
 * Author the supported two-entry input before framework config capture/build.
 * `retainSource` keeps the original `src` tree in place and adds the entry
 * copies beside it, for generated apps whose starter source surface is guarded.
 */
export async function authorEntryVariants(
  applicationRoot,
  { compilerObservation = false, retainSource = false } = {},
) {
  const root = await fs.realpath(applicationRoot);
  const source = path.join(root, 'src');
  const config = path.join(root, 'modern.config.ts');
  const base = path.join(root, 'modern.entry-base.config.ts');
  if (
    !(await fs.lstat(source)).isDirectory() ||
    !(await fs.lstat(config)).isFile()
  )
    throw new Error('Entry authoring requires ordinary source/config input');
  async function assertOrdinaryTree(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory())
        await assertOrdinaryTree(path.join(directory, entry.name));
      else if (!entry.isFile())
        throw new Error(
          'Entry authoring refuses linked or special source files',
        );
    }
  }
  await assertOrdinaryTree(source);
  for (const target of [
    base,
    path.join(source, 'ssr'),
    path.join(source, 'csr'),
  ]) {
    if (
      await fs.lstat(target).catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      })
    )
      throw new Error('EEXIST: entry variants are already authored');
  }
  const originalConfig = await fs.readFile(config);
  const temporary = path.join(
    root,
    `.acceptance-entry-authoring-${randomUUID()}`,
  );
  await fs.mkdir(temporary);
  let sourceRetired = false;
  let newSourcePlaced = false;
  const placedEntries = [];
  let baseCreated = false;
  try {
    const authoredSource = path.join(temporary, 'new-src');
    await fs.mkdir(authoredSource);
    for (const entry of ['ssr', 'csr']) {
      await fs.cp(source, path.join(authoredSource, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      // Final location is <source>/<entry> in both placement modes.
      await rebaseEscapingSpecifiers(
        source,
        path.join(authoredSource, entry),
        path.join(source, entry),
      );
    }
    await fs.writeFile(base, originalConfig, { flag: 'wx' });
    baseCreated = true;
    if (retainSource)
      for (const entry of ['ssr', 'csr']) {
        await fs.rename(
          path.join(authoredSource, entry),
          path.join(source, entry),
        );
        placedEntries.push(path.join(source, entry));
      }
    else {
      await fs.rename(source, path.join(temporary, 'original-src'));
      sourceRetired = true;
      await fs.rename(authoredSource, source);
      newSourcePlaced = true;
    }
    await fs.writeFile(
      config,
      `import authoredConfig from './modern.entry-base.config';
${compilerObservation ? "import { observeNativeCompiler } from './observe-native-compiler';\n" : ''}

// The authored export is typed as a config or a config factory; entry authoring
// composes the plain config object the authored file actually exports.
if (typeof authoredConfig === 'function') {
  throw new Error('Conformance entry authoring requires an object configuration export.');
}
const authoredSSR = authoredConfig.server?.ssr;
if (['solid', 'octane'].includes(authoredConfig.renderer ?? '') && !authoredSSR) {
  throw new Error('Native generated source must enable SSR through server.ssr before conformance entry authoring.');
}
const ssr = authoredSSR || true;

export default {
  ...authoredConfig,
${compilerObservation ? '  builderPlugins: [...(authoredConfig.builderPlugins ?? []), observeNativeCompiler()],\n' : ''}  source: {
    ...authoredConfig.source,
    disableDefaultEntries: true,
    mainEntryName: 'ssr',
    entries: { ssr: './src/ssr/routes', csr: './src/csr/routes' },
  },
  server: {
    ...authoredConfig.server,
    ssr,
    ssrByEntries: { csr: false, ssr },
    routes: { ssr: '/ssr', csr: '/csr' },
  },
};
`,
    );
    return Object.fromEntries(
      ['ssr', 'csr'].map(entryName => [
        entryName,
        {
          entryName,
          sourceDirectory: `src/${entryName}/routes`,
          counterFile: `src/${entryName}/components/Counter.tsx`,
          routePrefix: `/${entryName}`,
        },
      ]),
    );
  } catch (error) {
    for (const placed of placedEntries)
      await fs.rm(placed, { recursive: true, force: true });
    if (newSourcePlaced) await fs.rm(source, { recursive: true, force: true });
    if (sourceRetired)
      await fs.rename(path.join(temporary, 'original-src'), source);
    await fs.writeFile(config, originalConfig);
    if (baseCreated) await fs.rm(base, { force: true });
    throw error;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
