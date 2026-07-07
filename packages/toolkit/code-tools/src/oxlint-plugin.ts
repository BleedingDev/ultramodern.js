import { createNoHardcodedJsxTextRule } from './oxlint-plugin/rules/no-hardcoded-jsx-text.ts';
import { createNoLegacyMfBoundaryAttributesRule } from './oxlint-plugin/rules/no-legacy-mf-boundary-attributes.ts';
import { createNoLiteralVisibleJsxAttributesRule } from './oxlint-plugin/rules/no-literal-visible-jsx-attributes.ts';
import { createNoManualLocaleCopyBranchingRule } from './oxlint-plugin/rules/no-manual-locale-copy-branching.ts';
import { createNoSplitTranslationKeysRule } from './oxlint-plugin/rules/no-split-translation-keys.ts';
import { createStrictEffectApiBoundariesRule } from './oxlint-plugin/rules/strict-effect-api-boundaries.ts';

export * from './oxlint-plugin/ast.ts';
export * from './oxlint-plugin/options.ts';
export * from './oxlint-plugin/rules/no-hardcoded-jsx-text.ts';
export * from './oxlint-plugin/rules/no-legacy-mf-boundary-attributes.ts';
export * from './oxlint-plugin/rules/no-literal-visible-jsx-attributes.ts';
export * from './oxlint-plugin/rules/no-manual-locale-copy-branching.ts';
export * from './oxlint-plugin/rules/no-split-translation-keys.ts';
export * from './oxlint-plugin/rules/strict-effect-api-boundaries.ts';
export * from './oxlint-plugin/types.ts';

const plugin = {
  meta: {
    name: 'ultramodern',
  },
  rules: {
    'no-hardcoded-jsx-text': createNoHardcodedJsxTextRule(),
    'no-legacy-mf-boundary-attributes':
      createNoLegacyMfBoundaryAttributesRule(),
    'no-literal-visible-jsx-attributes':
      createNoLiteralVisibleJsxAttributesRule(),
    'no-manual-locale-copy-branching': createNoManualLocaleCopyBranchingRule(),
    'no-split-translation-keys': createNoSplitTranslationKeysRule(),
    'strict-effect-api-boundaries': createStrictEffectApiBoundariesRule(),
  },
};

export default plugin;
