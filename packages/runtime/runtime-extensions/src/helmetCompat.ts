type HeadTag = Record<string, unknown>;
type HelmetTagName = 'base' | 'link' | 'meta' | 'noscript' | 'script' | 'style';
type PriorityTagName = 'link' | 'meta' | 'script';
type DedupableTagName = Exclude<HelmetTagName, 'base'>;

type ElementFactory<Element> = {
  createElement: (...args: never[]) => Element;
};

type ReactAdapter<Element, Child> = ElementFactory<Element> & {
  Children: {
    forEach: (
      children: Child | undefined,
      visit: (child: unknown) => void,
    ) => void;
    toArray: (children: Child | undefined) => unknown[];
  };
  Fragment: unknown;
  isValidElement: (value: unknown) => boolean;
};

type HeadElement<Child> = {
  props: HeadTag & { children?: Child };
  type: unknown;
};

type HeadDatum<Element> = {
  toComponent: () => Element[];
  toString: () => string;
};

type HeadAttributeDatum = {
  toComponent: () => Record<string, unknown>;
  toString: () => string;
};

type MarkerProps = Record<'data-modern-helmet', string>;

export type HelmetCompatProps<Child = unknown> = {
  base?: object;
  bodyAttributes?: object;
  children?: Child;
  defaultTitle?: string;
  htmlAttributes?: object;
  link?: object[];
  meta?: object[];
  noscript?: object[];
  prioritizeSeoTags?: boolean;
  script?: object[];
  style?: object[];
  title?: unknown;
  titleAttributes?: object;
  titleTemplate?: string;
};

export type HelmetCompatRecord = {
  base: HeadTag[];
  bodyAttributes?: HeadTag;
  defaultTitle?: string;
  htmlAttributes?: HeadTag;
  link: HeadTag[];
  meta: HeadTag[];
  noscript: HeadTag[];
  prioritizeSeoTags: boolean;
  script: HeadTag[];
  style: HeadTag[];
  title?: string;
  titleAttributes: HeadTag;
  titleTemplate?: string;
};

export type HelmetCompatState<Element> = {
  base: HeadDatum<Element>;
  bodyAttributes: HeadAttributeDatum;
  htmlAttributes: HeadAttributeDatum;
  link: HeadDatum<Element>;
  meta: HeadDatum<Element>;
  noscript: HeadDatum<Element>;
  priority: HeadDatum<Element>;
  script: HeadDatum<Element>;
  style: HeadDatum<Element>;
  title: HeadDatum<Element>;
};

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
  hreflang: 'hrefLang',
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

const TAG_PRIMARY_ATTRIBUTES: Record<DedupableTagName, string[]> = {
  link: ['rel', 'href'],
  meta: ['name', 'charset', 'http-equiv', 'property', 'itemprop'],
  noscript: ['innerHTML'],
  script: ['src', 'innerHTML'],
  style: ['cssText'],
};

const priorityRecords = new WeakSet<object>();
const priorityTags = new WeakSet<object>();
const immediateRecords = new WeakMap<object, HelmetCompatRecord[]>();

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

const toReactAttributes = (tag: HeadTag): Record<string, unknown> => {
  const props: Record<string, unknown> = {};
  for (const [attribute, value] of Object.entries(tag)) {
    if (!CONTENT_PROPERTIES.has(attribute)) {
      props[REACT_ATTRIBUTE_NAMES[attribute] ?? attribute] = value;
    }
  }
  return props;
};

const toReactProps = (tag: HeadTag, key: unknown): Record<string, unknown> => {
  const props: Record<string, unknown> = {
    ...toReactAttributes(tag),
    key,
    'data-rh': true,
  };
  if ('innerHTML' in tag || 'cssText' in tag) {
    props.dangerouslySetInnerHTML = {
      __html: tag.innerHTML ?? tag.cssText ?? '',
    };
  }
  return props;
};

const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const toHtmlAttributeName = (name: string): string =>
  HTML_ATTRIBUTE_NAMES[name] ?? name;

const attributesToString = (
  tag: HeadTag,
  includeHelmetAttribute = false,
): string => {
  const attributes = includeHelmetAttribute ? ['data-rh="true"'] : [];
  for (const [name, value] of Object.entries(tag)) {
    if (
      CONTENT_PROPERTIES.has(name) ||
      value === false ||
      value === null ||
      value === undefined
    ) {
      continue;
    }
    const attribute = toHtmlAttributeName(name);
    attributes.push(
      value === true ? attribute : `${attribute}="${escapeHtml(value)}"`,
    );
  }
  return attributes.join(' ');
};

const tagsToString = (tagName: HelmetTagName, tags: HeadTag[]): string =>
  tags
    .map(tag => {
      const attributes = attributesToString(tag, true);
      if (
        (tagName === 'script' || tagName === 'noscript') &&
        typeof tag.innerHTML === 'string'
      ) {
        return `<${tagName} ${attributes}>${tag.innerHTML}</${tagName}>`;
      }
      if (tagName === 'style' && typeof tag.cssText === 'string') {
        return `<style ${attributes}>${tag.cssText}</style>`;
      }
      return `<${tagName} ${attributes}>`;
    })
    .join('');

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

const normalizedEntries = (tag: HeadTag) =>
  Object.entries(tag).map(([name, value]) => [
    toHtmlAttributeName(name).toLowerCase(),
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
  return {
    toComponent: () =>
      groups.flatMap(({ tagName, tags }) =>
        tags.map((tag, index) =>
          createElement(tagName, toReactProps(tag, `${tagName}-${index}`)),
        ),
      ),
    toString: () =>
      groups.map(({ tagName, tags }) => tagsToString(tagName, tags)).join(''),
  };
};

const createDatum = <Element>(
  react: ElementFactory<Element>,
  tagName: HelmetTagName,
  tags: HeadTag[],
): HeadDatum<Element> => ({
  toComponent: () => headTagsToComponents(react, tagName, tags),
  toString: () =>
    tagsToString(
      tagName,
      tags.filter(tag => !priorityTags.has(tag)),
    ),
});

const createAttributeDatum = (attributes: HeadTag): HeadAttributeDatum => ({
  toComponent: () => toReactAttributes(attributes),
  toString: () => attributesToString(attributes),
});

const createTitleDatum = <Element>(
  react: ElementFactory<Element>,
  title: string | undefined,
  attributes: HeadTag,
): HeadDatum<Element> => ({
  toComponent: () => headTitleToComponent(react, title, attributes),
  toString: () => {
    if (!title) {
      return '';
    }
    const serialized = attributesToString(attributes, true);
    return `<title ${serialized}>${escapeHtml(title)}</title>`;
  },
});

const normalizeHelmetTitle = (title: unknown): string | undefined => {
  if (typeof title === 'string') {
    return title;
  }
  if (Array.isArray(title)) {
    return title.map(part => String(part)).join('');
  }
  return undefined;
};

const mergeAttributes = (
  current: HeadTag,
  next: HeadTag | undefined,
): HeadTag => ({ ...current, ...(next ?? {}) });

const isHeadElement = <Child>(value: unknown): value is HeadElement<Child> =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  'props' in value &&
  typeof value.props === 'object' &&
  value.props !== null;

const collectChildren = <Element, Child>(
  react: ReactAdapter<Element, Child>,
  children: Child | undefined,
  draft: Omit<
    HelmetCompatRecord,
    'defaultTitle' | 'prioritizeSeoTags' | 'titleTemplate'
  >,
): void => {
  react.Children.forEach(children, child => {
    if (!react.isValidElement(child) || !isHeadElement<Child>(child)) {
      return;
    }
    const element = child;
    if (element.type === react.Fragment) {
      collectChildren(react, element.props.children, draft);
      return;
    }
    if (typeof element.type !== 'string') {
      return;
    }

    const { children: nestedChildren, ...props } = element.props;
    if (element.type === 'title') {
      draft.title = react.Children.toArray(nestedChildren).join('');
      draft.titleAttributes = mergeAttributes(draft.titleAttributes, props);
      return;
    }
    if (element.type === 'html') {
      draft.htmlAttributes = mergeAttributes(draft.htmlAttributes ?? {}, props);
      return;
    }
    if (element.type === 'body') {
      draft.bodyAttributes = mergeAttributes(draft.bodyAttributes ?? {}, props);
      return;
    }
    if (
      element.type === 'base' ||
      element.type === 'link' ||
      element.type === 'meta' ||
      element.type === 'noscript' ||
      element.type === 'script' ||
      element.type === 'style'
    ) {
      const tag = { ...props };
      if (
        (element.type === 'script' ||
          element.type === 'style' ||
          element.type === 'noscript') &&
        typeof nestedChildren === 'string'
      ) {
        tag[element.type === 'style' ? 'cssText' : 'innerHTML'] =
          nestedChildren;
      }
      draft[element.type].push(tag);
    }
  });
};

export const createHelmetRecord = <Element, Child>(
  reactValue: ReactAdapter<Element, Child>,
  props: HelmetCompatProps<Child>,
): HelmetCompatRecord => {
  const draft: Omit<
    HelmetCompatRecord,
    'defaultTitle' | 'prioritizeSeoTags' | 'titleTemplate'
  > = {
    base: props.base === undefined ? [] : [{ ...props.base }],
    bodyAttributes:
      props.bodyAttributes === undefined
        ? undefined
        : { ...props.bodyAttributes },
    htmlAttributes:
      props.htmlAttributes === undefined
        ? undefined
        : { ...props.htmlAttributes },
    link: (props.link ?? []).map(tag => ({ ...tag })),
    meta: (props.meta ?? []).map(tag => ({ ...tag })),
    noscript: (props.noscript ?? []).map(tag => ({ ...tag })),
    script: (props.script ?? []).map(tag => ({ ...tag })),
    style: (props.style ?? []).map(tag => ({ ...tag })),
    title: normalizeHelmetTitle(props.title),
    titleAttributes: { ...(props.titleAttributes ?? {}) },
  };

  collectChildren(reactValue, props.children, draft);
  const record: HelmetCompatRecord = {
    ...draft,
    defaultTitle: props.defaultTitle,
    prioritizeSeoTags: props.prioritizeSeoTags === true,
    titleTemplate: props.titleTemplate,
  };
  markPriorityHeadRecord(record, record.prioritizeSeoTags);
  return record;
};

const getInnermostDefined = <T>(
  records: HelmetCompatRecord[],
  pick: (record: HelmetCompatRecord) => T | undefined,
): T | undefined => {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const value = pick(records[index]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
};

const deriveTitle = (records: HelmetCompatRecord[]): string | undefined => {
  const title = getInnermostDefined(records, record => record.title);
  const template = getInnermostDefined(records, record => record.titleTemplate);
  if (template && title) {
    return template.replaceAll('%s', title);
  }
  return title || getInnermostDefined(records, record => record.defaultTitle);
};

const mergeRecordAttributes = (
  records: HelmetCompatRecord[],
  pick: (record: HelmetCompatRecord) => HeadTag | undefined,
): HeadTag =>
  records.reduce<HeadTag>(
    (merged, record) => mergeAttributes(merged, pick(record)),
    {},
  );

const deriveBaseTags = (records: HelmetCompatRecord[]): HeadTag[] => {
  for (let recordIndex = records.length - 1; recordIndex >= 0; recordIndex--) {
    const tags = records[recordIndex].base;
    for (let tagIndex = tags.length - 1; tagIndex >= 0; tagIndex--) {
      if (tags[tagIndex].href) {
        return [tags[tagIndex]];
      }
    }
  }
  return [];
};

const getPrimaryAttribute = (
  tagName: DedupableTagName,
  tag: HeadTag,
): { key: string; value: string } | undefined => {
  const candidates = TAG_PRIMARY_ATTRIBUTES[tagName];
  let selectedKey: string | undefined;
  let selectedValue: unknown;

  for (const [key, value] of Object.entries(tag)) {
    const normalizedKey = CONTENT_PROPERTIES.has(key)
      ? key
      : toHtmlAttributeName(key).toLowerCase();
    if (!candidates.includes(normalizedKey)) {
      continue;
    }
    if (
      selectedKey === 'rel' &&
      String(selectedValue).toLowerCase() === 'canonical'
    ) {
      continue;
    }
    if (
      normalizedKey === 'rel' &&
      String(value).toLowerCase() === 'stylesheet'
    ) {
      continue;
    }
    selectedKey = normalizedKey;
    selectedValue = value;
  }

  if (selectedKey === undefined || !selectedValue) {
    return undefined;
  }
  return { key: selectedKey, value: String(selectedValue).toLowerCase() };
};

const dedupeTags = (
  tagName: DedupableTagName,
  records: HelmetCompatRecord[],
): HeadTag[] => {
  const approvedValues = new Map<string, Set<string>>();
  const approved: HeadTag[] = [];

  for (let index = records.length - 1; index >= 0; index -= 1) {
    const instanceValues = new Map<string, Set<string>>();
    const kept: HeadTag[] = [];
    for (const tag of records[index][tagName]) {
      const primary = getPrimaryAttribute(tagName, tag);
      if (
        primary === undefined ||
        approvedValues.get(primary.key)?.has(primary.value)
      ) {
        continue;
      }
      const seen = instanceValues.get(primary.key) ?? new Set<string>();
      seen.add(primary.value);
      instanceValues.set(primary.key, seen);
      kept.push(tag);
    }
    approved.unshift(...kept);
    for (const [key, values] of instanceValues) {
      const target = approvedValues.get(key);
      if (target === undefined) {
        approvedValues.set(key, values);
      } else {
        for (const value of values) {
          target.add(value);
        }
      }
    }
  }
  return approved;
};

export const deriveHelmetServerState = <Element>(
  react: ElementFactory<Element>,
  records: HelmetCompatRecord[],
): HelmetCompatState<Element> => {
  const priority = createPriorityHeadDatum(react, records, dedupeTags);
  return {
    base: createDatum(react, 'base', deriveBaseTags(records)),
    bodyAttributes: createAttributeDatum(
      mergeRecordAttributes(records, record => record.bodyAttributes),
    ),
    htmlAttributes: createAttributeDatum(
      mergeRecordAttributes(records, record => record.htmlAttributes),
    ),
    link: createDatum(react, 'link', dedupeTags('link', records)),
    meta: createDatum(react, 'meta', dedupeTags('meta', records)),
    noscript: createDatum(react, 'noscript', dedupeTags('noscript', records)),
    priority,
    script: createDatum(react, 'script', dedupeTags('script', records)),
    style: createDatum(react, 'style', dedupeTags('style', records)),
    title: createTitleDatum(
      react,
      deriveTitle(records),
      mergeRecordAttributes(records, record => record.titleAttributes),
    ),
  };
};

export const collectImmediateHelmetState = <Element>(
  react: ElementFactory<Element>,
  context: object,
  record: HelmetCompatRecord,
): HelmetCompatState<Element> => {
  const records = immediateRecords.get(context) ?? [];
  if (!immediateRecords.has(context)) {
    immediateRecords.set(context, records);
  }
  records.push(record);
  return deriveHelmetServerState(react, records);
};
