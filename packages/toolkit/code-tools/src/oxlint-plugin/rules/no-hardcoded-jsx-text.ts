import {
  expressionStringValue,
  getIgnorePattern,
  hasAllowedElementAncestor,
  hasIgnoreComment,
  hasLetters,
  normalizeVisibleText,
  reportVisibleText,
} from '../ast.ts';
import {
  commonOptionsSchema,
  DEFAULT_ALLOWED_ELEMENTS,
  DEFAULT_IGNORE_COMMENT_PATTERN,
  getCommonRuleOption,
} from '../options.ts';
import type { AstNode, Rule } from '../types.ts';

export const createNoHardcodedJsxTextRule = (): Rule => ({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow literal user-visible text in JSX children in UltraModern generated apps.',
    },
    schema: [commonOptionsSchema],
  },
  create(context) {
    const options = getCommonRuleOption(context, {
      allowElements: DEFAULT_ALLOWED_ELEMENTS,
      ignoreCommentPattern: DEFAULT_IGNORE_COMMENT_PATTERN,
    });
    const allowedElements = new Set(options.allowElements);
    const ignorePattern = getIgnorePattern(options);
    const shouldSkipNode = (node: AstNode): boolean =>
      hasAllowedElementAncestor(node, allowedElements) ||
      hasIgnoreComment(node, context, ignorePattern);

    return {
      JSXText(node) {
        const text = normalizeVisibleText(String(node.value ?? ''));
        if (!text || !hasLetters(text) || shouldSkipNode(node)) {
          return;
        }
        reportVisibleText(context, node, text);
      },
      JSXExpressionContainer(node) {
        if (
          node.parent?.type !== 'JSXElement' &&
          node.parent?.type !== 'JSXFragment'
        ) {
          return;
        }

        const text = normalizeVisibleText(
          expressionStringValue(node.expression) ?? '',
        );
        if (!text || !hasLetters(text) || shouldSkipNode(node)) {
          return;
        }
        reportVisibleText(context, node, text);
      },
    };
  },
});
