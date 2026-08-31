import path from 'node:path';
import { fs as fse } from '@modern-js/utils';

export const getTemplatePath = (file: string) =>
  path.join(__dirname, 'templates', file);

export const readTemplate = async (file: string) =>
  (await fse.readFile(getTemplatePath(file))).toString();
