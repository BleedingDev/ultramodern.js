import path from 'path';
import { fs } from '../compiled';
import { normalizeOutputPath } from './path';

const memo = <T extends (...args: any[]) => any>(fn: T) => {
  const cache = new Map();

  return (...params: Parameters<T>): ReturnType<T> => {
    const stringifiedParams = JSON.stringify(params);
    const cachedResult = cache.get(stringifiedParams);

    if (cachedResult) {
      return cachedResult;
    }

    const res = fn(...params);
    cache.set(stringifiedParams, res);

    return res;
  };
};

const ensureRuntimeExportsFile = (filepath: string) => {
  fs.ensureDirSync(path.dirname(filepath));

  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, 'export {};\n');
  }
};

const formatRuntimeExports = (exportsList: string[]) => {
  if (exportsList.length === 0) {
    return 'export {};\n';
  }

  return `${exportsList.join('\n')}\n`;
};

const flushRuntimeExports = (filepath: string, exportsSet: Set<string>) => {
  fs.writeFileSync(filepath, formatRuntimeExports(Array.from(exportsSet)));
};

export const createRuntimeExportsUtils = memo(
  (internalDirectory: string, filename: string) => {
    const filepath = path.resolve(internalDirectory, `${filename}.ts`);
    const exportsSet = new Set<string>();

    ensureRuntimeExportsFile(filepath);

    return {
      addExport(exportStatement: string) {
        const normalized = exportStatement?.trim();
        if (!normalized) {
          return;
        }

        exportsSet.add(normalized);
        flushRuntimeExports(filepath, exportsSet);
      },
      getPath() {
        return normalizeOutputPath(filepath);
      },
    };
  },
);

export type RuntimeExportsUtils = ReturnType<typeof createRuntimeExportsUtils>;
