import { parse } from '@babel/parser';
import traverse, { Hub, NodePath, type Visitor } from '@babel/traverse';
import * as t from '@babel/types';

/** Only JSX extensions enable JSX: generic arrows in .ts must remain valid. */
export const consumerParserPlugins = (
  filePath: string,
): ('typescript' | 'jsx')[] =>
  /\.[jt]sx$/u.test(filePath) ? ['typescript', 'jsx'] : ['typescript'];

/** Only parser/binder diagnostics are policy violations; tool failures escape. */
export class SourceSyntaxError extends Error {}

class SourceValidationHub extends Hub {
  override buildError(_node: t.Node | undefined, message: string): Error {
    return new SourceSyntaxError(message);
  }
}

export function parseSource(
  source: string,
  filename: string,
  syntaxMessage?: string,
): t.File {
  try {
    return parse(source, {
      sourceType: 'module',
      sourceFilename: filename,
      plugins: consumerParserPlugins(filename),
    });
  } catch (cause) {
    if (
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      cause.code === 'BABEL_PARSER_SYNTAX_ERROR' &&
      'reasonCode' in cause &&
      typeof cause.reasonCode === 'string'
    ) {
      throw new SourceSyntaxError(
        syntaxMessage ??
          (cause instanceof Error ? cause.message : String(cause)),
      );
    }
    throw cause;
  }
}

export function traverseSource(file: t.File, visitor: Visitor): void {
  const program = NodePath.get({
    hub: new SourceValidationHub(),
    parentPath: undefined,
    parent: file,
    container: file,
    key: 'program',
  });
  program.setContext();
  traverse(file, visitor, program.scope, undefined, program);
}

export function unwrapExpression(
  node: t.Node,
  includeAssertions = false,
): t.Node {
  while (
    t.isTSAsExpression(node) ||
    t.isParenthesizedExpression(node) ||
    t.isTSSatisfiesExpression(node) ||
    (includeAssertions &&
      (t.isTSTypeAssertion(node) || t.isTSNonNullExpression(node)))
  )
    node = node.expression;
  return node;
}
