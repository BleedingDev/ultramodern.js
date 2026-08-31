// @effect-diagnostics strictBooleanExpressions:off
'use client';
import * as head from '@modern-js/runtime-extensions';
import React from 'react';
import {
  Helmet as AsyncHelmet,
  HelmetData as AsyncHelmetData,
  type HelmetDatum,
  type HelmetHTMLBodyDatum,
  type HelmetHTMLElementDatum,
  type HelmetProps,
  HelmetProvider,
  type HelmetServerState,
  type HelmetTags,
} from 'react-helmet-async';
import { InternalRuntimeContext } from '../core/context';
import {
  ensureHelmetContext,
  type HelmetContextSlot,
} from '../core/context/helmetContext';

type HelmetTagName = 'base' | 'link' | 'meta' | 'noscript' | 'script' | 'style';

type TagRecord = Record<string, unknown>;

const ATTRIBUTE_NAME_MAP: Record<string, string> = {
  charSet: 'charset',
  className: 'class',
  contentEditable: 'contenteditable',
  httpEquiv: 'http-equiv',
  hrefLang: 'hreflang',
  itemProp: 'itemprop',
  tabIndex: 'tabindex',
};

/**
 * `innerHTML`/`cssText` carry tag content, not attributes — they are rendered
 * as element children and must never be serialized as attributes
 * (react-helmet-async behaves the same way).
 */
const CONTENT_PROPERTIES = new Set(['innerHTML', 'cssText']);

const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const toHtmlAttributeName = (name: string): string =>
  ATTRIBUTE_NAME_MAP[name] ?? name;

const attributesToString = (
  attributes: TagRecord | undefined,
  includeHelmetAttribute = false,
): string => {
  const pairs: string[] = [];
  if (includeHelmetAttribute) {
    pairs.push('data-rh="true"');
  }

  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (value === false || value === null || value === undefined) {
      continue;
    }
    if (CONTENT_PROPERTIES.has(name)) {
      continue;
    }
    const htmlName = toHtmlAttributeName(name);
    if (value === true) {
      pairs.push(htmlName);
    } else {
      pairs.push(`${htmlName}="${escapeHtml(value)}"`);
    }
  }

  return pairs.join(' ');
};

const createDatum = (
  tagName: HelmetTagName,
  tags: TagRecord[],
): HelmetDatum => ({
  toComponent: () => [],
  toString: () =>
    tags
      .map(tag => {
        const attrs = attributesToString(tag, true);
        if (tagName === 'script' && typeof tag.innerHTML === 'string') {
          return `<script ${attrs}>${tag.innerHTML}</script>`;
        }
        if (tagName === 'style' && typeof tag.cssText === 'string') {
          return `<style ${attrs}>${tag.cssText}</style>`;
        }
        if (tagName === 'noscript' && typeof tag.innerHTML === 'string') {
          return `<noscript ${attrs}>${tag.innerHTML}</noscript>`;
        }
        return `<${tagName} ${attrs}>`;
      })
      .join(''),
});

const createAttributeDatum = (
  attributes: TagRecord,
): HelmetHTMLBodyDatum & HelmetHTMLElementDatum => ({
  toComponent: () => attributes,
  toString: () => attributesToString(attributes),
});

const createTitleDatum = (
  title: string | undefined,
  attributes: TagRecord,
): HelmetDatum => ({
  toComponent: () => [],
  toString: () => {
    if (title === undefined || title === '') {
      return '';
    }
    const attrs = attributesToString(attributes, true);
    return `<title ${attrs}>${escapeHtml(title)}</title>`;
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
  current: TagRecord,
  next: TagRecord | undefined,
): TagRecord => ({ ...current, ...(next ?? {}) });

/**
 * Immutable snapshot of one rendered `<Helmet>` instance, in mount order.
 * The server state is derived from the full list with react-helmet-async
 * semantics, so collection stays append-only and replay-safe.
 */
type HelmetRecord = {
  base: TagRecord[];
  bodyAttributes?: TagRecord;
  htmlAttributes?: TagRecord;
  link: TagRecord[];
  meta: TagRecord[];
  noscript: TagRecord[];
  script: TagRecord[];
  style: TagRecord[];
  title?: string;
  titleAttributes: TagRecord;
  titleTemplate?: string;
  defaultTitle?: string;
};

const collectChildren = (
  children: React.ReactNode,
  draft: Omit<HelmetRecord, 'titleTemplate' | 'defaultTitle'>,
) => {
  React.Children.forEach(children, child => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) {
      return;
    }

    if (child.type === React.Fragment) {
      collectChildren(child.props.children, draft);
      return;
    }

    if (typeof child.type !== 'string') {
      return;
    }

    const { children: nestedChildren, ...props } = child.props as TagRecord & {
      children?: React.ReactNode;
    };

    if (child.type === 'title') {
      draft.title = React.Children.toArray(nestedChildren).join('');
      draft.titleAttributes = mergeAttributes(draft.titleAttributes, props);
      return;
    }

    // react-helmet-async maps `<html>`/`<body>` children to html/body
    // attributes (e.g. `<html lang>`); mirror that on the server.
    if (child.type === 'html') {
      draft.htmlAttributes = mergeAttributes(draft.htmlAttributes ?? {}, props);
      return;
    }
    if (child.type === 'body') {
      draft.bodyAttributes = mergeAttributes(draft.bodyAttributes ?? {}, props);
      return;
    }

    if (
      child.type === 'base' ||
      child.type === 'link' ||
      child.type === 'meta' ||
      child.type === 'noscript' ||
      child.type === 'script' ||
      child.type === 'style'
    ) {
      const tag = { ...props };
      if (
        (child.type === 'script' ||
          child.type === 'style' ||
          child.type === 'noscript') &&
        typeof nestedChildren === 'string'
      ) {
        tag[child.type === 'style' ? 'cssText' : 'innerHTML'] = nestedChildren;
      }
      draft[child.type].push(tag);
    }
  });
};

const createHelmetRecord = (
  props: React.PropsWithChildren<HelmetProps>,
): HelmetRecord => {
  const draft: Omit<HelmetRecord, 'titleTemplate' | 'defaultTitle'> = {
    base: [...((props.base !== undefined ? [props.base] : []) as TagRecord[])],
    bodyAttributes: props.bodyAttributes as TagRecord | undefined,
    htmlAttributes: props.htmlAttributes as TagRecord | undefined,
    link: [...((props.link ?? []) as TagRecord[])],
    meta: [...((props.meta ?? []) as TagRecord[])],
    noscript: [...((props.noscript ?? []) as TagRecord[])],
    script: [...((props.script ?? []) as TagRecord[])],
    style: [...((props.style ?? []) as TagRecord[])],
    title: normalizeHelmetTitle(props.title),
    titleAttributes: (props.titleAttributes ?? {}) as TagRecord,
  };

  collectChildren(props.children, draft);

  return {
    ...draft,
    titleTemplate: props.titleTemplate,
    defaultTitle: props.defaultTitle,
  };
};

const getInnermostDefined = <T>(
  records: HelmetRecord[],
  pick: (record: HelmetRecord) => T | undefined,
): T | undefined => {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const value = pick(records[i]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
};

const deriveTitle = (records: HelmetRecord[]): string | undefined => {
  const innermostTitle = getInnermostDefined(records, record => record.title);
  const innermostTemplate = getInnermostDefined(
    records,
    record => record.titleTemplate,
  );
  if (innermostTemplate && innermostTitle) {
    return innermostTemplate.replaceAll('%s', innermostTitle);
  }
  // react-helmet-async: an empty/missing title falls back to the innermost
  // defaultTitle (without applying the template).
  return (
    innermostTitle ||
    getInnermostDefined(records, record => record.defaultTitle)
  );
};

const mergeRecordAttributes = (
  records: HelmetRecord[],
  pick: (record: HelmetRecord) => TagRecord | undefined,
): TagRecord =>
  records.reduce<TagRecord>(
    (merged, record) => mergeAttributes(merged, pick(record)),
    {},
  );

// react-helmet-async keeps a single <base> — the innermost one with `href`.
const deriveBaseTags = (records: HelmetRecord[]): TagRecord[] => {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const tags = records[i].base;
    for (let j = tags.length - 1; j >= 0; j -= 1) {
      if (tags[j].href) {
        return [tags[j]];
      }
    }
  }
  return [];
};

type DedupableTagName = Exclude<HelmetTagName, 'base'>;

/**
 * Per-tag "primary attributes" used by react-helmet-async to dedup nested
 * Helmet overrides — a tag from an outer instance is dropped when an inner
 * instance already declared a tag with the same primary attribute value.
 */
const TAG_PRIMARY_ATTRIBUTES: Record<DedupableTagName, string[]> = {
  link: ['rel', 'href'],
  meta: ['name', 'charset', 'http-equiv', 'property', 'itemprop'],
  noscript: ['innerHTML'],
  script: ['src', 'innerHTML'],
  style: ['cssText'],
};

const getPrimaryAttribute = (
  tagName: DedupableTagName,
  tag: TagRecord,
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
    // react-helmet-async link rules: a canonical `rel` stays primary (only
    // one canonical link survives), a stylesheet `rel` never becomes primary
    // (stylesheets dedup on href instead).
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
  records: HelmetRecord[],
): TagRecord[] => {
  const approvedValues = new Map<string, Set<string>>();
  const approved: TagRecord[] = [];

  // Innermost record first: nested Helmets win, outer duplicates are dropped.
  // Duplicates within a single instance are kept (react-helmet-async parity).
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const instanceValues = new Map<string, Set<string>>();
    const kept: TagRecord[] = [];

    for (const tag of records[i][tagName]) {
      const primary = getPrimaryAttribute(tagName, tag);
      if (primary === undefined) {
        // react-helmet-async drops tags without a primary attribute.
        continue;
      }
      if (approvedValues.get(primary.key)?.has(primary.value)) {
        continue;
      }
      let seen = instanceValues.get(primary.key);
      if (seen === undefined) {
        seen = new Set();
        instanceValues.set(primary.key, seen);
      }
      seen.add(primary.value);
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

const deriveHelmetServerState = (
  records: HelmetRecord[],
): HelmetServerState => ({
  base: createDatum('base', deriveBaseTags(records)),
  bodyAttributes: createAttributeDatum(
    mergeRecordAttributes(records, record => record.bodyAttributes),
  ),
  htmlAttributes: createAttributeDatum(
    mergeRecordAttributes(records, record => record.htmlAttributes),
  ),
  link: createDatum('link', dedupeTags('link', records)),
  meta: createDatum('meta', dedupeTags('meta', records)),
  noscript: createDatum('noscript', dedupeTags('noscript', records)),
  priority: createDatum('meta', []),
  script: createDatum('script', dedupeTags('script', records)),
  style: createDatum('style', dedupeTags('style', records)),
  title: createTitleDatum(
    deriveTitle(records),
    mergeRecordAttributes(records, record => record.titleAttributes),
  ),
});

/**
 * Per-request, append-only registry of rendered Helmet instances, keyed by
 * the fork-owned helmet context slot. Rendering only appends an immutable
 * snapshot of the instance props (the same pattern react-helmet-async uses
 * for its server-side instance list — effects never run on the server, so
 * render-time collection is the only option) and the published state is
 * always re-derived from the full registry. A replayed subtree (Suspense
 * retry during streaming SSR, strict/concurrent re-render) appends an
 * identical record whose tags collapse in the primary-attribute dedup, so
 * collection is idempotent instead of compounding previously derived state.
 */
const serverHelmetRecords = new WeakMap<HelmetContextSlot, HelmetRecord[]>();

const collectServerHelmet = (
  runtimeContext: object,
  props: React.PropsWithChildren<HelmetProps>,
) => {
  const marker = head.collectHeadState(
    runtimeContext,
    () => createHelmetRecord(props),
    deriveHelmetServerState,
    ensureHelmetContext(runtimeContext),
  );
  if (marker !== undefined) return marker;
  const helmetContext = ensureHelmetContext(runtimeContext);
  let records = serverHelmetRecords.get(helmetContext);
  if (records === undefined) {
    records = [];
    serverHelmetRecords.set(helmetContext, records);
  }
  records.push(createHelmetRecord(props));
  helmetContext.helmet = deriveHelmetServerState(records);
};

export const Helmet = (props: React.PropsWithChildren<HelmetProps>) => {
  const runtimeContext = React.useContext(InternalRuntimeContext);

  if (runtimeContext !== null && runtimeContext.isBrowser === false) {
    return head.renderHeadMarker(
      React,
      collectServerHelmet(runtimeContext, props),
    );
  }

  return React.createElement(AsyncHelmet, props);
};

const head = {
  Helmet,
  HelmetData: AsyncHelmetData,
  HelmetProvider,
};

export default head;

export type {
  HelmetDatum,
  HelmetHTMLBodyDatum,
  HelmetHTMLElementDatum,
  HelmetProps,
  HelmetServerState,
  HelmetTags,
};
export { AsyncHelmetData as HelmetData, HelmetProvider };
