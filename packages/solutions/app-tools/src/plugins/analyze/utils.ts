import {
  getCommand,
  JS_EXTENSIONS,
  normalizeToPosixPath,
} from '@modern-js/utils';
import { parse } from 'es-module-lexer';
import { transform } from 'esbuild';
import fs from 'fs';
import path from 'path';

export const walkDirectory = (dir: string): string[] =>
  fs.readdirSync(dir).reduce<string[]>((previous, filename) => {
    const filePath = path.join(dir, filename);
    if (fs.statSync(filePath).isDirectory()) {
      return [...previous, ...walkDirectory(filePath)];
    } else {
      return [...previous, filePath];
    }
  }, []);

export const replaceWithAlias = (
  base: string,
  filePath: string,
  alias: string,
) => {
  if (filePath.includes(base)) {
    return normalizeToPosixPath(
      path.join(alias, path.relative(base, filePath)),
    );
  } else {
    return filePath;
  }
};

export const parseModule = async ({
  source,
  filename,
}: {
  source: string;
  filename: string;
}) => {
  let content = source;

  if (JS_EXTENSIONS.some(ext => filename.endsWith(ext))) {
    const ext = path.extname(filename);
    const result = await transform(content, {
      sourcefile: filename,
      format: 'esm',
      loader:
        ext === '.ts'
          ? 'ts'
          : ext === '.tsx'
            ? 'tsx'
            : ext === '.jsx'
              ? 'jsx'
              : 'js',
      target: 'es2022',
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true,
        },
      },
    });
    content = result.code;
  }

  return await parse(content);
};

export const getServerCombinedModuleFile = (
  internalDirectory: string,
  entryName: string,
) => {
  return path.join(internalDirectory, entryName, 'server-loader-combined.js');
};

export const checkIsBuildCommands = (contextCommand?: string) => {
  const buildCommands = [
    'dev',
    'start',
    'build',
    'inspect',
    'deploy',
    'dev-worker',
  ];
  const command = getCommand();

  if (buildCommands.includes(command)) {
    return true;
  }

  return (
    contextCommand === 'dev' ||
    contextCommand === 'start' ||
    contextCommand === 'build' ||
    contextCommand === 'deploy'
  );
};

export const checkIsServeCommand = () => {
  const command = getCommand();

  return command === 'serve';
};

export const isSubDirOrEqual = (parent: string, child: string): boolean => {
  if (parent === child) {
    return true;
  }
  const relative = path.relative(parent, child);
  const isSubdir =
    relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  return Boolean(isSubdir);
};
