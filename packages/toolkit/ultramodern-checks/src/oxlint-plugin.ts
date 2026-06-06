type AstNode = {
  readonly type?: string;
  readonly parent?: AstNode;
  readonly loc?: {
    readonly start?: { readonly line?: number };
    readonly end?: { readonly line?: number };
  };
  readonly range?: readonly [number, number];
  readonly value?: unknown;
  readonly name?: unknown;
  readonly openingElement?: AstNode;
  readonly expression?: AstNode;
  readonly expressions?: readonly AstNode[];
  readonly quasis?: readonly AstNode[];
  readonly test?: AstNode;
  readonly consequent?: AstNode;
  readonly alternate?: AstNode;
  readonly arguments?: readonly AstNode[];
  readonly callee?: AstNode;
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly computed?: boolean;
};

type RuleContext = {
  readonly options?: readonly unknown[];
  readonly filename?: string;
  getSourceCode?: () => {
    readonly text?: string;
    getAllComments?: () => readonly AstNode[];
    getText?: (node: AstNode) => string;
  };
  report: (descriptor: { node: AstNode; message: string }) => void;
};

type Rule = {
  readonly meta: {
    readonly type: string;
    readonly docs: { readonly description: string };
    readonly schema: unknown[];
  };
  create(context: RuleContext): Record<string, (node: AstNode) => void>;
};

type CommonOptions = {
  readonly allowElements?: readonly string[];
  readonly ignoreCommentPattern?: string;
};

type AttributeOptions = CommonOptions & {
  readonly visibleAttributes?: readonly string[];
};

type TranslationOptions = {
  readonly translationFunctions?: readonly string[];
};

const commonOptionsSchema = {
  type: 'object',
  properties: {
    allowElements: {
      type: 'array',
      items: { type: 'string' },
    },
    ignoreCommentPattern: { type: 'string' },
  },
  additionalProperties: false,
};

const attributeOptionsSchema = {
  type: 'object',
  properties: {
    ...commonOptionsSchema.properties,
    visibleAttributes: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  additionalProperties: false,
};

const DEFAULT_VISIBLE_ATTRIBUTES = [
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'alt',
  'placeholder',
  'title',
] as const;

const DEFAULT_ALLOWED_ELEMENTS = ['code', 'kbd', 'samp'] as const;
const DEFAULT_TRANSLATION_FUNCTIONS = ['t'] as const;
const DEFAULT_IGNORE_COMMENT_PATTERN = 'i18n-ignore';
const LETTER_PATTERN = /\p{L}/u;
const SPLIT_TRANSLATION_KEY_PATTERN = /\.(?:prefix|suffix|before|after)$/u;

const getRuleOption = <T extends object>(
  context: RuleContext,
  defaults: T,
): T => ({
  ...defaults,
  ...((context.options?.[0] ?? {}) as T),
});

const normalizeVisibleText = (value: string) =>
  value.replaceAll(/\s+/gu, ' ').trim();

const hasLetters = (value: string) => LETTER_PATTERN.test(value);

const getNodeName = (node: AstNode | undefined): string | undefined => {
  if (!node) {
    return undefined;
  }
  if (typeof node.name === 'string') {
    return node.name;
  }
  if (node.type === 'JSXIdentifier' && typeof node.name === 'string') {
    return node.name;
  }
  if (
    node.type === 'JSXMemberExpression' &&
    typeof node.property === 'object'
  ) {
    const objectName = getNodeName(node.object);
    const propertyName = getNodeName(node.property);
    return objectName && propertyName
      ? `${objectName}.${propertyName}`
      : propertyName;
  }
  if (
    node.type === 'MemberExpression' &&
    typeof node.property === 'object' &&
    !node.computed
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

const hasAllowedElementAncestor = (
  node: AstNode,
  allowedElements: ReadonlySet<string>,
) => {
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

const getStringLiteralValue = (
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
  if (
    node.type === 'TemplateLiteral' &&
    (node.expressions?.length ?? 0) === 0
  ) {
    const quasi = node.quasis?.[0] as
      | (AstNode & {
          readonly value?: { readonly cooked?: string; readonly raw?: string };
        })
      | undefined;
    return quasi?.value?.cooked ?? quasi?.value?.raw;
  }
  return undefined;
};

const expressionStringValue = (node: AstNode | undefined) =>
  getStringLiteralValue(
    node?.type === 'JSXExpressionContainer' ? node.expression : node,
  );

const getLine = (node: AstNode) => node.loc?.start?.line;

const hasIgnoreComment = (
  node: AstNode,
  context: RuleContext,
  pattern: RegExp,
) => {
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

const getIgnorePattern = (options: CommonOptions) =>
  new RegExp(
    options.ignoreCommentPattern ?? DEFAULT_IGNORE_COMMENT_PATTERN,
    'u',
  );

const reportVisibleText = (
  context: RuleContext,
  node: AstNode,
  text: string,
) => {
  context.report({
    node,
    message: `Move user-visible JSX text to locale resources: ${JSON.stringify(
      text,
    )}`,
  });
};

const createNoHardcodedJsxTextRule = (): Rule => ({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow literal user-visible text in JSX children in UltraModern generated apps.',
    },
    schema: [],
  },
  create(context) {
    const options = getRuleOption<CommonOptions>(context, {
      allowElements: DEFAULT_ALLOWED_ELEMENTS,
      ignoreCommentPattern: DEFAULT_IGNORE_COMMENT_PATTERN,
    });
    const allowedElements = new Set(options.allowElements);
    const ignorePattern = getIgnorePattern(options);

    const shouldSkipNode = (node: AstNode) =>
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

const createNoLiteralVisibleJsxAttributesRule = (): Rule => ({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow literal user-visible JSX attribute text in UltraModern generated apps.',
    },
    schema: [attributeOptionsSchema],
  },
  create(context) {
    const options = getRuleOption<AttributeOptions>(context, {
      allowElements: DEFAULT_ALLOWED_ELEMENTS,
      ignoreCommentPattern: DEFAULT_IGNORE_COMMENT_PATTERN,
      visibleAttributes: DEFAULT_VISIBLE_ATTRIBUTES,
    });
    const visibleAttributes = new Set(options.visibleAttributes);
    const ignorePattern = getIgnorePattern(options);

    return {
      JSXAttribute(node) {
        const attributeName = getNodeName(node.name as AstNode | undefined);
        if (!attributeName || !visibleAttributes.has(attributeName)) {
          return;
        }
        const text = normalizeVisibleText(
          expressionStringValue(node.value as AstNode | undefined) ?? '',
        );
        if (
          !text ||
          !hasLetters(text) ||
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

const getSourceText = (context: RuleContext, node: AstNode) =>
  context.getSourceCode?.().getText?.(node) ?? '';

const looksLikeLocaleTest = (context: RuleContext, node: AstNode) => {
  const text = getSourceText(context, node);
  return (
    /\b(?:language|locale|lng|currentLanguage)\b/u.test(text) &&
    /(?:={2,3}|!==?)/u.test(text) &&
    /['"][a-z]{2}(?:-[A-Za-z0-9]+)?['"]/u.test(text)
  );
};

const isAllowedBranchLiteral = (text: string) =>
  new Set(['page', 'undefined', 'null', 'true', 'false']).has(text);

const createNoManualLocaleCopyBranchingRule = (): Rule => ({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow manual locale conditionals that choose user-visible copy.',
    },
    schema: [],
  },
  create(context) {
    const reportBranch = (node: AstNode, text: string) => {
      context.report({
        node,
        message: `Move locale-specific copy branch to i18n resources: ${JSON.stringify(
          normalizeVisibleText(text),
        )}`,
      });
    };

    return {
      ConditionalExpression(node) {
        if (!looksLikeLocaleTest(context, node.test as AstNode)) {
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

const getCallExpressionName = (node: AstNode | undefined) => getNodeName(node);

const createNoSplitTranslationKeysRule = (): Rule => ({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow split phrase translation key suffixes such as .prefix and .suffix.',
    },
    schema: [],
  },
  create(context) {
    const options = getRuleOption<TranslationOptions>(context, {
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

const createNoLegacyMfBoundaryAttributesRule = (): Rule => ({
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
  },
};

export default plugin;
