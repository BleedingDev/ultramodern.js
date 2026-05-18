// @effect-diagnostics nodeBuiltinImport:off
import { createDebugger, fs, JS_EXTENSIONS } from '@modern-js/utils';
import path from 'path';
import { FILE_SYSTEM_ROUTES_IGNORED_REGEX } from '../../constants';

const debug: (...args: unknown[]) => void = createDebugger('get-client-routes');

export { debug };

export const getRouteWeight = (route: string) =>
  route === '*' ? 999 : route.split(':').length - 1;

export const shouldSkip = (file: string): boolean => {
  // should not skip directory.
  if (fs.statSync(file).isDirectory()) {
    return false;
  }

  const ext = path.extname(file);

  if (
    FILE_SYSTEM_ROUTES_IGNORED_REGEX.test(file) ||
    !JS_EXTENSIONS.includes(ext)
  ) {
    return true;
  }

  return false;
};
