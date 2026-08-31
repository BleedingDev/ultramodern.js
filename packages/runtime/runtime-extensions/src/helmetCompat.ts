type HeadTag = Record<string, unknown>;
type PriorityTagName = 'link' | 'meta' | 'script';

type ElementFactory<Element> = {
  createElement: (...args: never[]) => Element;
};

type HeadDatum<Element> = {
  toComponent: () => Element[];
  toString: () => string;
};

type MarkerProps = Record<'data-modern-helmet', string>;

const CONTENT_PROPERTIES = new Set(['innerHTML', 'cssText']);
const HTML_ATTRIBUTE_NAMES: Record<string, string> = {
  charSet: 'charset',
  className: 'class',
  contentEditable: 'contenteditable',
  httpEquiv: 'http-equiv',
  hrefLang: 'hreflang',
  itemProp: 'itemprop',
  tabIndex: 'tabindex',
};
const REACT_ATTRIBUTE_NAMES: Record<string, string> = {
  accesskey: 'accessKey',
  charset: 'charSet',
  class: 'className',
  contenteditable: 'contentEditable',
  contextmenu: 'contextMenu',
  'http-equiv': 'httpEquiv',
  itemprop: 'itemProp',
  tabindex: 'tabIndex',
};

const SEO_PRIORITY_VALUES: Record<PriorityTagName, Record<string, string[]>> = {
  link: { rel: ['amphtml', 'canonical', 'alternate'] },
  meta: {
    charset: [''],
    name: ['generator', 'robots', 'description'],
    property: [
      'og:type',
      'og:title',
      'og:url',
      'og:image',
      'og:image:alt',
      'og:description',
      'twitter:url',
      'twitter:title',
      'twitter:description',
      'twitter:image',
      'twitter:image:alt',
      'twitter:card',
      'twitter:site',
    ],
  },
  script: { type: ['application/ld+json'] },
};

const priorityRecords = new WeakSet<object>();
const priorityTags = new WeakSet<object>();

const createElementFactory = <Element>(react: ElementFactory<Element>) =>
  react.createElement as unknown as (
    type: string,
    props: Record<string, unknown>,
    ...children: unknown[]
  ) => Element;

export const renderHeadMarker = <Element>(
  react: ElementFactory<Element>,
  marker: MarkerProps | null | undefined,
): Element | null =>
  marker ? createElementFactory(react)('template', marker) : null;

const toReactProps = (tag: HeadTag, key: unknown): Record<string, unknown> => {
  const props: Record<string, unknown> = { key, 'data-rh': true };
  for (const [attribute, value] of Object.entries(tag)) {
    if (CONTENT_PROPERTIES.has(attribute)) {
      props.dangerouslySetInnerHTML = {
        __html: tag.innerHTML ?? tag.cssText ?? '',
      };
    } else {
      props[REACT_ATTRIBUTE_NAMES[attribute] ?? attribute] = value;
    }
  }
  return props;
};

const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const attributesToString = (tag: HeadTag): string => {
  const attributes = ['data-rh="true"'];
  for (const [name, value] of Object.entries(tag)) {
    if (
      CONTENT_PROPERTIES.has(name) ||
      value === false ||
      value === null ||
      value === undefined
    ) {
      continue;
    }
    const attribute = HTML_ATTRIBUTE_NAMES[name] ?? name;
    attributes.push(
      value === true ? attribute : `${attribute}="${escapeHtml(value)}"`,
    );
  }
  return attributes.join(' ');
};

const tagsToString = (tagName: PriorityTagName, tags: HeadTag[]): string =>
  tags
    .map(tag => {
      const attributes = attributesToString(tag);
      if (tagName === 'script') {
        return `<script ${attributes}>${typeof tag.innerHTML === 'string' ? tag.innerHTML : ''}</script>`;
      }
      return `<${tagName} ${attributes}>`;
    })
    .join('');

const normalizedEntries = (tag: HeadTag) =>
  Object.entries(tag).map(([name, value]) => [
    HTML_ATTRIBUTE_NAMES[name] ?? name.toLowerCase(),
    String(value).toLowerCase(),
  ]);

const isSeoPriorityTag = (tagName: PriorityTagName, tag: HeadTag): boolean => {
  const values = SEO_PRIORITY_VALUES[tagName];
  return normalizedEntries(tag).some(([name, value]) => {
    const allowed = values[name];
    return (
      allowed !== undefined && (name === 'charset' || allowed.includes(value))
    );
  });
};

export const markPriorityHeadRecord = (
  record: object,
  prioritize: boolean | undefined,
): void => {
  if (prioritize) {
    priorityRecords.add(record);
  }
};

export const isPriorityHeadTag = (tag: object): boolean =>
  priorityTags.has(tag);

export const headTagsToComponents = <Element>(
  react: ElementFactory<Element>,
  tagName: string,
  tags: HeadTag[],
): Element[] => {
  const createElement = createElementFactory(react);
  return tags
    .filter(tag => !priorityTags.has(tag))
    .map((tag, index) => createElement(tagName, toReactProps(tag, index)));
};

export const headTitleToComponent = <Element>(
  react: ElementFactory<Element>,
  title: string | undefined,
  attributes: HeadTag,
): Element[] => {
  if (!title) {
    return [];
  }
  const createElement = createElementFactory(react);
  return [createElement('title', toReactProps(attributes, title), title)];
};

export const createPriorityHeadDatum = <Element, RecordType>(
  react: ElementFactory<Element>,
  records: RecordType[],
  dedupe: (tagName: PriorityTagName, records: RecordType[]) => HeadTag[],
): HeadDatum<Element> => {
  if (
    !records.some(
      record =>
        typeof record === 'object' &&
        record !== null &&
        priorityRecords.has(record),
    )
  ) {
    return { toComponent: () => [], toString: () => '' };
  }

  const groups = (['meta', 'link', 'script'] as const).map(tagName => ({
    tagName,
    tags: dedupe(tagName, records).filter(tag =>
      isSeoPriorityTag(tagName, tag),
    ),
  }));
  for (const { tags } of groups) {
    for (const tag of tags) {
      priorityTags.add(tag);
    }
  }

  const createElement = createElementFactory(react);
  const components = groups.flatMap(({ tagName, tags }) =>
    tags.map((tag, index) =>
      createElement(tagName, toReactProps(tag, `${tagName}-${index}`)),
    ),
  );
  const html = groups
    .map(({ tagName, tags }) => tagsToString(tagName, tags))
    .join('');

  return {
    toComponent: () => components,
    toString: () => html,
  };
};
