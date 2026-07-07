import { asStringArray, isRecord } from './ast.ts';
import type {
  AttributeRuleOptions,
  CommonRuleOptions,
  RuleContext,
  SplitTranslationKeyRuleOptions,
} from './types.ts';

export const commonOptionsSchema = {
  type: 'object',
  properties: {
    allowElements: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    ignoreCommentPattern: {
      type: 'string',
    },
  },
  additionalProperties: false,
};

export const attributeOptionsSchema = {
  type: 'object',
  properties: {
    ...commonOptionsSchema.properties,
    visibleAttributes: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  additionalProperties: false,
};

export const translationOptionsSchema = {
  type: 'object',
  properties: {
    translationFunctions: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  additionalProperties: false,
};

export const DEFAULT_VISIBLE_ATTRIBUTES = [
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'alt',
  'placeholder',
  'title',
];

export const DEFAULT_ALLOWED_ELEMENTS = ['code', 'kbd', 'samp'];

export const DEFAULT_TRANSLATION_FUNCTIONS = ['t'];

export const DEFAULT_IGNORE_COMMENT_PATTERN = 'i18n-ignore';

export const LETTER_PATTERN = /\p{L}/u;

export const SPLIT_TRANSLATION_KEY_PATTERN =
  /\.(?:prefix|suffix|before|after)$/u;

export const API_SOURCE_FILE_PATTERN =
  /(?:^|\/)(?:api\/|shared\/api\.[cm]?[jt]sx?$)/u;
export const FORBIDDEN_GENERATED_EFFECT_PATH_PATTERN =
  /(?:^|\/)(?:(?:apps|verticals)\/[^/]+\/(?:api\/(?:effect|lambda)|shared\/effect|src\/effect))(?:\/|$)/u;
export const API_ENTRY_PATTERN =
  /(?:^|\/)(?:apps|verticals)\/[^/]+\/api\/index\.[cm]?[jt]sx?$/u;
export const SHARED_API_CONTRACT_PATTERN =
  /(?:^|\/)(?:apps|verticals)\/[^/]+\/shared\/api\.[cm]?[jt]sx?$/u;

export const getCommonRuleOption = (
  context: RuleContext,
  defaults: CommonRuleOptions,
): CommonRuleOptions => {
  const options = context.options?.[0];
  if (!isRecord(options)) {
    return defaults;
  }

  return {
    allowElements: asStringArray(options.allowElements, defaults.allowElements),
    ignoreCommentPattern:
      typeof options.ignoreCommentPattern === 'string'
        ? options.ignoreCommentPattern
        : defaults.ignoreCommentPattern,
  };
};

export const getAttributeRuleOption = (
  context: RuleContext,
  defaults: AttributeRuleOptions,
): AttributeRuleOptions => {
  const options = context.options?.[0];
  const commonOptions = getCommonRuleOption(context, defaults);

  return {
    ...commonOptions,
    visibleAttributes: isRecord(options)
      ? asStringArray(options.visibleAttributes, defaults.visibleAttributes)
      : defaults.visibleAttributes,
  };
};

export const getSplitTranslationKeyRuleOption = (
  context: RuleContext,
  defaults: SplitTranslationKeyRuleOptions,
): SplitTranslationKeyRuleOptions => {
  const options = context.options?.[0];
  if (!isRecord(options)) {
    return defaults;
  }

  return {
    translationFunctions: asStringArray(
      options.translationFunctions,
      defaults.translationFunctions,
    ),
  };
};
