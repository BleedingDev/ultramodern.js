'use client';
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
import { ensureHelmetContext } from '../core/context/helmetContext';

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

const createEmptyHelmetState = (): HelmetServerState => ({
  base: createDatum('base', []),
  bodyAttributes: createAttributeDatum({}),
  htmlAttributes: createAttributeDatum({}),
  link: createDatum('link', []),
  meta: createDatum('meta', []),
  noscript: createDatum('noscript', []),
  priority: createDatum('meta', []),
  script: createDatum('script', []),
  style: createDatum('style', []),
  title: createTitleDatum(undefined, {}),
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

const collectChildren = (
  children: React.ReactNode,
  draft: {
    base: TagRecord[];
    link: TagRecord[];
    meta: TagRecord[];
    noscript: TagRecord[];
    script: TagRecord[];
    style: TagRecord[];
    title?: string;
    titleAttributes: TagRecord;
  },
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

    if (child.type === 'html' || child.type === 'body') {
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

const collectHelmetProps = (
  current: HelmetServerState | undefined,
  props: React.PropsWithChildren<HelmetProps>,
): HelmetServerState => {
  const baseState = current ?? createEmptyHelmetState();
  const draft = {
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

  const title =
    draft.title !== undefined &&
    draft.title !== '' &&
    props.titleTemplate !== undefined
      ? props.titleTemplate.replaceAll('%s', draft.title)
      : (draft.title ?? props.defaultTitle);

  return {
    base: createDatum('base', [
      ...((baseState as any).__baseTags ?? []),
      ...draft.base,
    ]),
    bodyAttributes: createAttributeDatum(
      mergeAttributes(
        (baseState as any).__bodyAttributes ?? {},
        draft.bodyAttributes,
      ),
    ),
    htmlAttributes: createAttributeDatum(
      mergeAttributes(
        (baseState as any).__htmlAttributes ?? {},
        draft.htmlAttributes,
      ),
    ),
    link: createDatum('link', [
      ...((baseState as any).__linkTags ?? []),
      ...draft.link,
    ]),
    meta: createDatum('meta', [
      ...((baseState as any).__metaTags ?? []),
      ...draft.meta,
    ]),
    noscript: createDatum('noscript', [
      ...((baseState as any).__noscriptTags ?? []),
      ...draft.noscript,
    ]),
    priority: createDatum('meta', []),
    script: createDatum('script', [
      ...((baseState as any).__scriptTags ?? []),
      ...draft.script,
    ]),
    style: createDatum('style', [
      ...((baseState as any).__styleTags ?? []),
      ...draft.style,
    ]),
    title: createTitleDatum(
      title ?? (baseState as any).__title,
      mergeAttributes(
        (baseState as any).__titleAttributes ?? {},
        draft.titleAttributes,
      ),
    ),
    __baseTags: [...((baseState as any).__baseTags ?? []), ...draft.base],
    __bodyAttributes: mergeAttributes(
      (baseState as any).__bodyAttributes ?? {},
      draft.bodyAttributes,
    ),
    __htmlAttributes: mergeAttributes(
      (baseState as any).__htmlAttributes ?? {},
      draft.htmlAttributes,
    ),
    __linkTags: [...((baseState as any).__linkTags ?? []), ...draft.link],
    __metaTags: [...((baseState as any).__metaTags ?? []), ...draft.meta],
    __noscriptTags: [
      ...((baseState as any).__noscriptTags ?? []),
      ...draft.noscript,
    ],
    __scriptTags: [...((baseState as any).__scriptTags ?? []), ...draft.script],
    __styleTags: [...((baseState as any).__styleTags ?? []), ...draft.style],
    __title: title ?? (baseState as any).__title,
    __titleAttributes: mergeAttributes(
      (baseState as any).__titleAttributes ?? {},
      draft.titleAttributes,
    ),
  } as HelmetServerState;
};

export const Helmet = (props: React.PropsWithChildren<HelmetProps>) => {
  const runtimeContext = React.useContext(InternalRuntimeContext);

  if (runtimeContext !== null && runtimeContext.isBrowser === false) {
    const helmetContext = ensureHelmetContext(runtimeContext);
    helmetContext.helmet = collectHelmetProps(
      helmetContext.helmet ?? undefined,
      props,
    );
    return null;
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
