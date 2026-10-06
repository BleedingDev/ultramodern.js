import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

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
    for (const entry of ['ssr', 'csr'])
      await fs.cp(source, path.join(authoredSource, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
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

const authoredSSR = authoredConfig.server?.ssr;
if (['solid', 'octane'].includes(authoredConfig.renderer) && !authoredSSR) {
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
