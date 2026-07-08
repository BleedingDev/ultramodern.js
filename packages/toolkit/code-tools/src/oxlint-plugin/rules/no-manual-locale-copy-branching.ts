import { getSourceText, getStringLiteralValue } from '../ast.ts';
import type { AstNode, Rule, RuleContext } from '../types.ts';

const looksLikeLocaleTest = (context: RuleContext, node: AstNode): boolean => {
  const text = getSourceText(context, node);
  return (
    /\b(?:language|locale|lng|currentLanguage)\b/u.test(text) &&
    /(?:={2,3}|!==?|\.\s*startsWith\s*\()/u.test(text) &&
    /['"][a-z]{2}(?:-[A-Za-z0-9]+)?['"]/u.test(text)
  );
};

const isAllowedBranchLiteral = (text: string): boolean =>
  new Set(['page', 'undefined', 'null', 'true', 'false']).has(text);

export const createNoManualLocaleCopyBranchingRule = (): Rule => ({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow manual locale conditionals that choose user-visible copy.',
    },
    schema: [],
  },
  create(context) {
    const reportBranch = (node: AstNode, text: string): void => {
      context.report({
        node,
        message: `Move locale-specific copy branch to i18n resources: ${JSON.stringify(
          normalizeVisibleText(text),
        )}`,
      });
    };

    return {
      ConditionalExpression(node) {
        if (!node.test || !looksLikeLocaleTest(context, node.test)) {
          return;
        }

        for (const branch of [node.consequent, node.alternate]) {
          const text = expressionStringValue(branch);
          if (
            text &&
            hasLetters(text) &&
            !isAllowedBranchLiteral(text.trim())
          ) {
            reportBranch(branch as AstNode, text);
          }
        }
      },
    };
  },
});
