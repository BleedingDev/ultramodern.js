// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off processEnv:off strictBooleanExpressions:off
import { fs } from '@modern-js/utils';
import path from 'path';
import {
  EXPORT_PREFIX,
  GENERATED_RUNTIME_DIRS,
  TYPE_PREFIX,
  toPosixPath,
} from './files';

export type PackageJsonLike = {
  files?: string[];
  typesVersions?: Record<string, Record<string, string[]>>;
  exports?: Record<
    string,
    {
      import?: string;
      require?: string;
      types?: string;
    }
  >;
};

export function getPackageName(appDirectory: string): string | undefined {
  try {
    const packageJsonPath = path.resolve(appDirectory, './package.json');
    const packageJson = fs.readJSONSync(packageJsonPath) as {
      name?: string;
    };
    return packageJson.name;
  } catch {
    return undefined;
  }
}

export function mergePackageJson(
  packageJson: PackageJsonLike,
  files: string[],
  typesVersion: Record<string, Record<string, string[]>>,
  exports: Record<
    string,
    {
      import?: string;
      require?: string;
      types?: string;
    }
  >,
  relativeDistPath: string,
) {
  const distPrefix = toPosixPath(`./${relativeDistPath}/`);
  const generatedPrefixes = GENERATED_RUNTIME_DIRS.map(dir =>
    toPosixPath(`${distPrefix}${dir}/`),
  );
  const isManagedExportEntry = (
    value:
      | {
          import?: string;
          require?: string;
          types?: string;
        }
      | undefined,
  ) => {
    if (!value) {
      return false;
    }
    const values = [value.import, value.require, value.types].filter(
      Boolean,
    ) as string[];
    return values.every(entry =>
      generatedPrefixes.some(prefix => entry.startsWith(prefix)),
    );
  };
  const isManagedTypeEntry = (value: string[] | undefined) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(entry =>
      generatedPrefixes.some(prefix => entry.startsWith(prefix)),
    );
  const normalizedFiles = [...new Set(files.map(file => toPosixPath(file)))];
  const currentFiles = packageJson.files || [];
  packageJson.files = [
    ...new Set([
      ...currentFiles.map(file => toPosixPath(file)),
      ...normalizedFiles,
    ]),
  ];

  packageJson.typesVersions ??= {};
  const typesVersions = packageJson.typesVersions;
  const starTypes = typesVersions['*'] || {};
  const generatedTypeEntries = typesVersion['*'] || {};
  const generatedTypeKeys = new Set(Object.keys(generatedTypeEntries));
  const typeConflicts = Object.entries(starTypes)
    .filter(([key, value]) => {
      if (!generatedTypeKeys.has(key) && !key.startsWith(TYPE_PREFIX)) {
        return false;
      }

      const generatedValue = generatedTypeEntries[key];
      if (generatedValue) {
        return (
          JSON.stringify(value) !== JSON.stringify(generatedValue) &&
          !isManagedTypeEntry(value)
        );
      }

      return !isManagedTypeEntry(value);
    })
    .map(([key]) => key);

  if (typeConflicts.length > 0) {
    throw new Error(
      `[plugin-bff] package.json typesVersions conflict on keys: ${typeConflicts.sort().join(', ')}. Rename these keys or move them outside "${TYPE_PREFIX}" namespace.`,
    );
  }

  Object.keys(starTypes).forEach(key => {
    if (generatedTypeKeys.has(key) || key.startsWith(TYPE_PREFIX)) {
      delete starTypes[key];
    }
  });
  typesVersions['*'] = {
    ...starTypes,
    ...generatedTypeEntries,
  };

  packageJson.exports ??= {};
  const packageExports = packageJson.exports;
  const generatedExportKeys = new Set(Object.keys(exports));
  const exportConflicts = Object.entries(packageExports)
    .filter(([key, value]) => {
      if (!generatedExportKeys.has(key) && !key.startsWith(EXPORT_PREFIX)) {
        return false;
      }

      const generatedValue = exports[key];
      if (generatedValue) {
        return (
          JSON.stringify(value) !== JSON.stringify(generatedValue) &&
          !isManagedExportEntry(value)
        );
      }

      return !isManagedExportEntry(value);
    })
    .map(([key]) => key);

  if (exportConflicts.length > 0) {
    throw new Error(
      `[plugin-bff] package.json exports conflict on keys: ${exportConflicts.sort().join(', ')}. Rename these exports or move them outside "${EXPORT_PREFIX}" namespace.`,
    );
  }

  Object.keys(packageExports).forEach(key => {
    if (generatedExportKeys.has(key) || key.startsWith(EXPORT_PREFIX)) {
      delete packageExports[key];
    }
  });
  Object.assign(packageExports, exports);
}

export function getClientPackageName(appDirectory: string): string {
  const packageName =
    getPackageName(appDirectory) || path.basename(appDirectory);

  if (packageName.startsWith('@') && packageName.includes('/')) {
    const [scope, name] = packageName.split('/');
    return `${scope}/${name}-bff-client`;
  }

  return `${packageName}-bff-client`;
}
