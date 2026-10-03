import type { AppContext, CLIPluginExtends } from '@modern-js/plugin/cli';
import type { Entrypoint } from '@modern-js/types/cli/base';
import {
  ensureAbsolutePath,
  findExists,
  JS_EXTENSIONS,
} from '@modern-js/utils';
import fs from 'fs';
import path from 'path';
import type { AppToolsNormalizedConfig } from '../../types/config/base';
import type { AppToolsExtendHooksBase } from '../../types/plugin-base';
import { ENTRY_FILE_NAME } from './constants';

export type { Entrypoint };

export const hasEntry = (dir: string) =>
  findExists(
    JS_EXTENSIONS.map(ext => path.resolve(dir, `${ENTRY_FILE_NAME}${ext}`)),
  );

export const hasServerEntry = (dir: string) =>
  findExists(
    JS_EXTENSIONS.map(ext =>
      path.resolve(dir, `${ENTRY_FILE_NAME}.server${ext}`),
    ),
  );

const isBundleEntry = async (
  hooks: Pick<AppToolsExtendHooksBase<never>, 'checkEntryPoint'>,
  dir: string,
) => {
  const { entry } = await hooks.checkEntryPoint.call({
    path: dir,
    entry: false,
  });
  if (entry) {
    return entry;
  }
  const customEntry = hasEntry(dir);
  if (customEntry) {
    return customEntry;
  }
  return false;
};

const scanDir = async (
  hooks: Pick<AppToolsExtendHooksBase<never>, 'checkEntryPoint'>,
  dirs: string[],
): Promise<Entrypoint[]> => {
  const entries = await Promise.all(
    dirs.map(async (dir: string) => {
      const entryName = path.basename(dir);
      const customEntryFile = hasEntry(dir);
      const customServerEntry = hasServerEntry(dir);

      const entryFile = (
        await hooks.checkEntryPoint.call({
          path: dir,
          entry: false,
        })
      ).entry;

      if (entryFile) {
        return {
          entryName,
          isMainEntry: false,
          entry: customEntryFile || entryFile,
          customServerEntry,
          absoluteEntryDir: path.resolve(dir),
          isAutoMount: true,
          customEntry: Boolean(customEntryFile),
        };
      }

      if (customEntryFile) {
        return {
          entryName,
          isMainEntry: false,
          entry: customEntryFile,
          customServerEntry,
          absoluteEntryDir: path.resolve(dir),
          isAutoMount: false,
          customEntry: Boolean(customEntryFile),
        };
      }

      return false;
    }),
  ).then(entries => entries.filter(Boolean) as Entrypoint[]);
  if (entries.length === 0) {
    throw Error('There is no valid entry point in the current project!');
  }
  return entries;
};

export const getFileSystemEntry = async (
  hooks: Pick<AppToolsExtendHooksBase<never>, 'checkEntryPoint'>,
  appContext: Pick<
    AppContext<CLIPluginExtends>,
    'appDirectory' | 'packageMetadataRead'
  >,
  config: Pick<AppToolsNormalizedConfig, 'source'>,
): Promise<Entrypoint[]> => {
  const { appDirectory, packageMetadataRead } = appContext;

  const {
    source: { entriesDir },
  } = config;

  const src = ensureAbsolutePath(appDirectory, entriesDir || '');

  const exists = () => fs.existsSync(src);
  if (
    packageMetadataRead?.entryPathRead
      ? packageMetadataRead.entryPathRead(exists)
      : exists()
  ) {
    const isDirectory = () => fs.statSync(src).isDirectory();
    if (
      packageMetadataRead?.entryPathRead
        ? packageMetadataRead.entryPathRead(isDirectory)
        : isDirectory()
    ) {
      if (await isBundleEntry(hooks, src)) {
        return scanDir(hooks, [src]);
      }
      const dirs: string[] = [];
      await Promise.all(
        fs.readdirSync(src).map(async filename => {
          const file = path.join(src, filename);
          if (
            fs.statSync(file).isDirectory() &&
            (await isBundleEntry(hooks, file))
          ) {
            dirs.push(file);
          }
        }),
      );
      return scanDir(hooks, dirs);
    } else {
      throw Error(`source.entriesDir accept a directory.`);
    }
  } else {
    throw Error(`src dir ${entriesDir} not found.`);
  }
};
