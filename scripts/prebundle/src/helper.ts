import fs from 'fs-extra';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { DIST_DIR, PACKAGES_DIR, TASKS } from './constant';
import type { ParsedTask } from './types';

export function findDepPath(
  name: string,
  resolvedEntry = require.resolve(name),
) {
  let entry = dirname(resolvedEntry);
  while (true) {
    const manifest = join(entry, 'package.json');
    if (fs.existsSync(manifest) && fs.readJSONSync(manifest).name) return entry;
    const parent = dirname(entry);
    if (parent === entry) throw new Error(`Cannot locate package ${name}`);
    entry = parent;
  }
}

const resolveESMDependency = async (entry: string) => {
  const { moduleResolve } = await import('import-meta-resolve');
  const conditions = new Set(['import', 'module', 'default']);
  try {
    return fileURLToPath(
      moduleResolve(entry, pathToFileURL(`${__dirname}/`), conditions, false),
    );
  } catch {
    // ignore
  }
};

export async function parseTasks(dependency?: string) {
  const { findUp } = await import('find-up');
  const result: ParsedTask[] = [];

  for (const { packageName, packageDir, dependencies } of TASKS) {
    for (const dep of dependencies) {
      const depName = typeof dep === 'string' ? dep : dep.name;
      if (dependency && depName !== dependency) continue;
      const importPath = join(packageName, DIST_DIR, depName);
      const packagePath = join(PACKAGES_DIR, packageDir);
      const distPath = join(packagePath, DIST_DIR, depName);
      const depPath = findDepPath(depName);
      const depEntry = require.resolve(depName);
      const resolvedEsmEntry = await resolveESMDependency(depName);

      let depEsmEntry = '';
      if (resolvedEsmEntry) {
        if (resolvedEsmEntry !== depEntry) {
          depEsmEntry = resolvedEsmEntry;
        } else {
          // is esm package?
          const pkg = await findUp('package.json', {
            cwd: dirname(resolvedEsmEntry),
          });
          if (pkg) {
            const pkgJson = await fs.readJSON(pkg);
            if (pkgJson.type === 'module') {
              depEsmEntry = resolvedEsmEntry;
            }
          }
        }
      }

      const info = {
        depName,
        depPath,
        depEntry,
        depEsmEntry,
        distPath,
        importPath,
        packageDir,
        packagePath,
        packageName,
      };

      if (typeof dep === 'string') {
        result.push({
          minify: true,
          emitDts: true,
          clear: true,
          externals: {},
          emitFiles: [],
          packageJsonField: [],
          ...info,
        });
      } else {
        result.push({
          minify: dep.minify ?? true,
          ignoreDts: dep.ignoreDts,
          emitDts: dep.emitDts ?? true,
          clear: dep.clear ?? true,
          externals: dep.externals ?? {},
          emitFiles: dep.emitFiles ?? [],
          afterBundle: dep.afterBundle,
          beforeBundle: dep.beforeBundle,
          packageJsonField: dep.packageJsonField ?? [],
          ...info,
        });
      }
    }
  }

  if (dependency && result.length === 0) {
    throw new Error(`Unknown prebundle dependency: ${dependency}`);
  }
  return result;
}

export function pick<T, U extends keyof T>(obj: T, keys: ReadonlyArray<U>) {
  return keys.reduce(
    (ret, key) => {
      if (obj[key] !== undefined) {
        ret[key] = obj[key];
      }
      return ret;
    },
    {} as Pick<T, U>,
  );
}
