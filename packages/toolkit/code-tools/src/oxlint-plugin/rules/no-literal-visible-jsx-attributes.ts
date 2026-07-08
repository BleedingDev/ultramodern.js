import {
  expressionStringValue,
  getIgnorePattern,
  getNodeName,
  hasAllowedElementAncestor,
  hasIgnoreComment,
  hasLetters,
  normalizeVisibleText,
} from '../ast.ts';
import {
  attributeOptionsSchema,
  DEFAULT_ALLOWED_ELEMENTS,
  DEFAULT_IGNORE_COMMENT_PATTERN,
  DEFAULT_VISIBLE_ATTRIBUTES,
  getAttributeRuleOption,
} from '../options.ts';
import type { AstNode, Rule } from '../types.ts';

export const createNoLiteralVisibleJsxAttributesRule = (): Rule => ({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow literal user-visible JSX attribute text in UltraModern generated apps.',
    },
    schema: [attributeOptionsSchema],
  },
  create(context) {
    const options = getAttributeRuleOption(context, {
      allowElements: DEFAULT_ALLOWED_ELEMENTS,
      ignoreCommentPattern: DEFAULT_IGNORE_COMMENT_PATTERN,
      visibleAttributes: DEFAULT_VISIBLE_ATTRIBUTES,
    });
    const visibleAttributes = new Set(options.visibleAttributes);
    const allowedElements = new Set(options.allowElements);
    const ignorePattern = getIgnorePattern(options);

    return {
      JSXAttribute(node) {
        const attributeName = getNodeName(node.name as AstNode | undefined);
        if (!attributeName || !visibleAttributes.has(attributeName)) {
          return;
        }

        const text = normalizeVisibleText(
          expressionStringValue(node.value as AstNode) ?? '',
        );
        if (
          !text ||
          !hasLetters(text) ||
          hasAllowedElementAncestor(node, allowedElements) ||
          hasIgnoreComment(node, context, ignorePattern)
        ) {
          return;
        }

        context.report({
          node,
          message: `Move literal ${attributeName} copy to locale resources: ${JSON.stringify(
            text,
          )}`,
        });
      },
    };
  },
});
