import {
  API_ENTRY_PATTERN,
  API_SOURCE_FILE_PATTERN,
  FORBIDDEN_GENERATED_EFFECT_PATH_PATTERN,
  LETTER_PATTERN,
  SHARED_API_CONTRACT_PATTERN,
} from './options.ts';
import type { AstNode, CommonRuleOptions, RuleContext } from './types.ts';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const asStringArray = (
  value: unknown,
  fallback: readonly string[],
): readonly string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value
    : fallback;

export const normalizeVisibleText = (value: string): string =>
  value.replaceAll(/\s+/gu, ' ').trim();

export const hasLetters = (value: string): boolean =>
  LETTER_PATTERN.test(value);

export const getNodeName = (node: AstNode | undefined): string | undefined => {
  if (!node) {
    return undefined;
  }

  if (typeof node.name === 'string') {
    return node.name;
  }

  if (
    node.type === 'JSXIdentifier' &&
    isRecord(node.name) &&
    typeof node.name.name === 'string'
  ) {
    return node.name.name;
  }

  if (node.type === 'JSXIdentifier' && typeof node.name === 'string') {
    return node.name;
  }

  if (
    (node.type === 'JSXMemberExpression' || node.type === 'MemberExpression') &&
    isRecord(node.property) &&
    node.computed !== true
  ) {
    const objectName = getNodeName(node.object);
    const propertyName = getNodeName(node.property);
    return objectName && propertyName
      ? `${objectName}.${propertyName}`
      : propertyName;
  }

  return undefined;
};

const getJsxElementName = (node: AstNode | undefined): string | undefined => {
  if (node?.type !== 'JSXElement') {
    return undefined;
  }

  return getNodeName(node.openingElement?.name as AstNode | undefined);
};

export const hasAllowedElementAncestor = (
  node: AstNode,
  allowedElements: ReadonlySet<string>,
): boolean => {
  let current: AstNode | undefined = node;

  while (current) {
    const elementName = getJsxElementName(current);
    if (elementName && allowedElements.has(elementName)) {
      return true;
    }
    current = current.parent;
  }

  return false;
};

const getTemplateLiteralValue = (node: AstNode): string | undefined => {
  if (node.type !== 'TemplateLiteral' || (node.expressions?.length ?? 0) > 0) {
    return undefined;
  }

  const quasi = node.quasis?.[0];
  if (!isRecord(quasi?.value)) {
    return undefined;
  }

  const cooked = quasi.value.cooked;
  const raw = quasi.value.raw;
  return typeof cooked === 'string'
    ? cooked
    : typeof raw === 'string'
      ? raw
      : undefined;
};

export const getStringLiteralValue = (
  node: AstNode | undefined,
): string | undefined => {
  if (!node) {
    return undefined;
  }

  if (
    (node.type === 'Literal' || node.type === 'StringLiteral') &&
    typeof node.value === 'string'
  ) {
    return node.value;
  }

  return getTemplateLiteralValue(node);
};

export const expressionStringValue = (
  node: AstNode | undefined,
): string | undefined =>
  getStringLiteralValue(
    node?.type === 'JSXExpressionContainer' ? node.expression : node,
  );

export const getLine = (node: AstNode): number | undefined =>
  node.loc?.start?.line;

export const hasIgnoreComment = (
  node: AstNode,
  context: RuleContext,
  pattern: RegExp,
): boolean => {
  const sourceCode = context.getSourceCode?.();
  const nodeLine = getLine(node);
  if (!sourceCode?.getAllComments || nodeLine === undefined) {
    return false;
  }

  return sourceCode.getAllComments().some(comment => {
    const commentValue = String(comment.value ?? '');
    if (!pattern.test(commentValue)) {
      return false;
    }

    const startLine = comment.loc?.start?.line;
    const endLine = comment.loc?.end?.line ?? startLine;
    return (
      startLine !== undefined &&
      endLine !== undefined &&
      startLine <= nodeLine + 1 &&
      endLine >= nodeLine - 1
    );
  });
};

export const getIgnorePattern = (options: CommonRuleOptions): RegExp =>
  new RegExp(options.ignoreCommentPattern, 'u');

export const reportVisibleText = (
  context: RuleContext,
  node: AstNode,
  text: string,
): void => {
  context.report({
    node,
    message: `Move user-visible JSX text to locale resources: ${JSON.stringify(text)}`,
  });
};

export const getSourceText = (context: RuleContext, node: AstNode): string =>
  context.getSourceCode?.().getText?.(node) ??
  context.getSourceCode?.().text ??
  '';

export const normalizeFilename = (filePath: string | undefined): string =>
  (filePath ?? '').replaceAll('\\', '/');

export const isApiSourceFile = (filePath: string | undefined): boolean =>
  API_SOURCE_FILE_PATTERN.test(normalizeFilename(filePath));

export const isForbiddenGeneratedEffectPath = (
  filePath: string | undefined,
): boolean =>
  FORBIDDEN_GENERATED_EFFECT_PATH_PATTERN.test(normalizeFilename(filePath));

export const isApiEntryFile = (filePath: string | undefined): boolean =>
  API_ENTRY_PATTERN.test(normalizeFilename(filePath));

export const isSharedApiContractFile = (
  filePath: string | undefined,
): boolean => SHARED_API_CONTRACT_PATTERN.test(normalizeFilename(filePath));

export const getCallExpressionName = (
  node: AstNode | undefined,
): string | undefined => getNodeName(node);

export const reportProgramPattern = (
  context: RuleContext,
  node: AstNode,
  source: string,
  pattern: RegExp,
  message: string,
): void => {
  if (pattern.test(source)) {
    context.report({ node, message });
  }
};

export const reportMissingProgramPattern = (
  context: RuleContext,
  node: AstNode,
  source: string,
  pattern: RegExp,
  message: string,
): void => {
  if (!pattern.test(source)) {
    context.report({ node, message });
  }
};
