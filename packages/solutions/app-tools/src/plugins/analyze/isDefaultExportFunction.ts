import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import fs from 'fs';

const isFunction = (
  node:
    | t.FunctionDeclaration
    | t.ClassDeclaration
    | t.TSDeclareFunction
    | t.Expression,
) =>
  t.isFunctionDeclaration(node) ||
  t.isFunctionExpression(node) ||
  t.isArrowFunctionExpression(node);

export const isDefaultExportFunction = (file: string | false): boolean => {
  if (!file || !fs.existsSync(file)) {
    return false;
  }

  const ast = parse(fs.readFileSync(file, 'utf8'), {
    sourceType: 'unambiguous',
    plugins: [
      'jsx',
      'typescript',
      'exportDefaultFrom',
      'decorators-legacy',
      'functionBind',
      ['pipelineOperator', { proposal: 'fsharp' }],
    ],
  });

  let isExportFunction = false;
  traverse(ast as any, {
    ExportDefaultDeclaration: path => {
      const { declaration } = path.node;
      if (isFunction(declaration as any)) {
        isExportFunction = true;
      }
    },
  });
  return isExportFunction;
};
