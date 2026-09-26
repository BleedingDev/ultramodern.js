import path from 'node:path';
import { normalizeModulePath } from '@modern-js/utils';

/**
 * The generated per-entry module (`<internalDirectory>/<entry>/index.jsx`,
 * where `<entry>` may be nested).
 * With `source.enableAsyncEntry` the build entry is `bootstrap.jsx`, whose only
 * statement is `import('./index')`; that import is the async-entry boundary
 * (Module Federation needs it to initialize shared scopes), not a code-split
 * point, so it must never be lazy.
 */
const ENTRY_POINT_FILE_NAME = 'index.jsx';

/**
 * Build the default `lazyCompilation.test`: every dynamically imported module
 * is lazy except the generated entry module under `internalDirectory`.
 * Otherwise the first page load triggers a rebuild of the whole entry
 * (`building .modern-js/<entry>/index.jsx`) and an extra HMR cycle.
 */
export function buildDefaultLazyCompilationTest(
  internalDirectory: string,
): (m: object) => boolean {
  // Resolved on first call: the directory does not exist yet at config time,
  // and Rspack reports real paths, so compare against the realpath.
  let internalDir: string | undefined;
  // Typed `object` so it is assignable to Rspack's `(module: Module) => boolean`;
  // only normal modules carry a `resource`.
  return (m: object) => {
    if (!('resource' in m) || typeof m.resource !== 'string') {
      return true;
    }
    const resource = m.resource.split('?')[0];
    internalDir ??= normalizeModulePath(internalDirectory);
    const file = resource.split(path.sep).join('/');
    // Entry names may be nested (`admin/dashboard`), so match any depth.
    return !(
      path.posix.basename(file) === ENTRY_POINT_FILE_NAME &&
      file.startsWith(`${internalDir}/`)
    );
  };
}
