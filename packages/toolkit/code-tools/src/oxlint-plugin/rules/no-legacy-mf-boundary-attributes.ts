import { getNodeName } from '../ast.ts';
import type { AstNode, Rule } from '../types.ts';

export const createNoLegacyMfBoundaryAttributesRule = (): Rule => ({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow legacy Module Federation boundary attributes in generated UltraModern workspaces.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        const attributeName = getNodeName(node.name as AstNode | undefined);
        if (
          attributeName !== 'data-mf-boundary' &&
          attributeName !== 'data-mf-remote' &&
          attributeName !== 'data-mf-expose'
        ) {
          return;
        }

        context.report({
          node,
          message:
            'Use data-modern-boundary-id and data-modern-mf-expose instead of legacy data-mf-* boundary attributes.',
        });
      },
    };
  },
});
