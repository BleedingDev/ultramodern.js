import { expressionStringValue, getCallExpressionName } from '../ast.ts';
import {
  DEFAULT_TRANSLATION_FUNCTIONS,
  getSplitTranslationKeyRuleOption,
  SPLIT_TRANSLATION_KEY_PATTERN,
  translationOptionsSchema,
} from '../options.ts';
import type { Rule } from '../types.ts';

export const createNoSplitTranslationKeysRule = (): Rule => ({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow split phrase translation key suffixes such as .prefix and .suffix.',
    },
    schema: [translationOptionsSchema],
  },
  create(context) {
    const options = getSplitTranslationKeyRuleOption(context, {
      translationFunctions: DEFAULT_TRANSLATION_FUNCTIONS,
    });
    const translationFunctions = new Set(options.translationFunctions);

    return {
      CallExpression(node) {
        const calleeName = getCallExpressionName(node.callee);
        if (!calleeName || !translationFunctions.has(calleeName)) {
          return;
        }

        const key = expressionStringValue(node.arguments?.[0]);
        if (!key || !SPLIT_TRANSLATION_KEY_PATTERN.test(key)) {
          return;
        }

        context.report({
          node,
          message:
            'Keep translator-owned phrases whole instead of using split translation keys.',
        });
      },
    };
  },
});
