// @effect-diagnostics nodeBuiltinImport:off
import { findExists, JS_EXTENSIONS } from '@modern-js/utils';
import path from 'path';
import { APP_FILE_NAME } from './constants';

export const hasApp = (dir: string) =>
  findExists(
    JS_EXTENSIONS.map(ext => path.resolve(dir, `${APP_FILE_NAME}${ext}`)),
  );

export const isRuntimeEntry = (dir: string) => hasApp(dir);
