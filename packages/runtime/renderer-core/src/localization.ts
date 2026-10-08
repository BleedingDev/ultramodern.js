import type { DocumentInlineData } from './document';
import type { NativeLocationRewrite } from './router';

/** `{ [namespace]: { [key]: value } }` for one language. */
export type NativeI18nResources = Record<string, Record<string, unknown>>;

export type NativeRequestLanguage =
  | {
      readonly kind: 'language';
      readonly language: string;
      /** Request headers the language was detected from, for `Vary`. */
      readonly vary?: readonly string[];
    }
  | {
      readonly kind: 'redirect';
      readonly language: string;
      readonly location: string;
    };

/** A per-request or per-document translation instance, such as i18next's. */
export interface NativeI18nInstance {
  readonly language: string;
}

/**
 * Localized routing a native entry composes. `createNativeI18n()` from
 * `@modern-js/i18n-runtime-extensions/native` implements it with i18next.
 */
export interface NativeEntryI18n<
  Instance extends NativeI18nInstance = NativeI18nInstance,
  LocalisedUrls = unknown,
> {
  readonly languages: readonly string[];
  readonly localisedUrls?: LocalisedUrls;
  /** The language of a request URL, or the redirect to its localized URL. */
  resolveRequest(request: Request): NativeRequestLanguage;
  redirect(location: string): Response;
  /** A new, fully isolated instance for one request or one browser document. */
  create(language: string, resources?: NativeI18nResources): Promise<Instance>;
  /** The router rewrite: matching stays on canonical paths. */
  rewrite(getLanguage: () => string): NativeLocationRewrite;
  /** The document handoff of a language and, with an instance, its bundles. */
  handoff(language: string, instance?: Instance): DocumentInlineData;
  /** The server's language and bundles, read before the browser router starts. */
  clientHandoff(): { language: string; resources?: NativeI18nResources };
  /**
   * History navigation to another language prefix switches the instance.
   * Returns the cleanup that detaches it when the client entry is disposed.
   */
  syncWithRouter(router: object, instance: Instance): () => void;
}

/** What a renderer needs to provide localization to its application view. */
export interface NativeI18nView<Instance, LocalisedUrls> {
  readonly instance: Instance;
  readonly languages: readonly string[];
  readonly localisedUrls?: LocalisedUrls;
}

export function nativeI18nView<Instance extends NativeI18nInstance, Urls>(
  i18n: NativeEntryI18n<Instance, Urls>,
  instance: Instance,
): NativeI18nView<Instance, Urls> {
  return {
    instance,
    languages: i18n.languages,
    ...(i18n.localisedUrls === undefined
      ? {}
      : { localisedUrls: i18n.localisedUrls }),
  };
}
