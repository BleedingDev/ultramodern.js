import {
  parsePublicData,
  serializePublicData,
} from '@modern-js/renderer-core/data';
import { serializeInlineData } from '@modern-js/renderer-core/document';

/**
 * Renderer-neutral replacement for React's `window._SSR_DATA.data.i18nData`
 * handoff (see `plugin-i18n/src/runtime/i18n/detection/ssr.ts` and
 * `pluginSetup.ts`'s `exportServerLngToWindow`). That path only exists
 * because the React renderer serializes its own `_SSR_DATA` global; native
 * renderers have no equivalent global, so the language (and an optional
 * resource subset, for first-paint translation without a network round
 * trip) travels in its own inline `<script type="application/json">`
 * element instead, using renderer-core's public-data codec — the same
 * XSS-safe escaping and size/depth limits used for loader/action data.
 */
export const I18N_SSR_HANDOFF_ELEMENT_ID = '__modernjs_i18n_ssr__';

/** `{ [namespace]: { [key]: value } }`, scoped to a single language. */
export type I18nSsrHandoffResources = Record<string, Record<string, unknown>>;

export interface I18nSsrHandoffPayload {
  /** The language the server resolved for this request. */
  language: string;
  /** Optional subset of resources for `language`, keyed by namespace. */
  resources?: I18nSsrHandoffResources;
}

export interface SerializeI18nSsrHandoffOptions {
  /** @default I18N_SSR_HANDOFF_ELEMENT_ID */
  id?: string;
  nonce?: string;
}

function assertPayload(
  payload: I18nSsrHandoffPayload,
): asserts payload is I18nSsrHandoffPayload {
  if (typeof payload.language !== 'string' || payload.language.length === 0) {
    throw new TypeError(
      'An i18n SSR handoff payload requires a nonempty language.',
    );
  }
  if (
    payload.resources !== undefined &&
    (typeof payload.resources !== 'object' || payload.resources === null)
  ) {
    throw new TypeError(
      'An i18n SSR handoff payload resources field must be a plain object.',
    );
  }
}

/** An inline data element a native document serializes with its own nonce. */
export interface I18nSsrHandoffInlineData {
  readonly id: string;
  readonly payload: ReturnType<typeof serializePublicData>;
}

/**
 * Encode the handoff as `{ id, payload }` for a native document's
 * `inlineData` option, which places it before the client modules and stamps
 * it with the document's CSP nonce.
 */
export function createI18nSsrHandoffInlineData(
  payload: I18nSsrHandoffPayload,
  options: Pick<SerializeI18nSsrHandoffOptions, 'id'> = {},
): I18nSsrHandoffInlineData {
  assertPayload(payload);
  return {
    id: options.id ?? I18N_SSR_HANDOFF_ELEMENT_ID,
    payload: serializePublicData({
      language: payload.language,
      ...(payload.resources ? { resources: payload.resources } : {}),
    }),
  };
}

/**
 * Serialize the language/resources handoff into a complete, inert
 * `<script type="application/json">` element string. The native renderer's
 * document composition decides where to place it (before any module that
 * reads it on the client).
 */
export function serializeI18nSsrHandoff(
  payload: I18nSsrHandoffPayload,
  options: SerializeI18nSsrHandoffOptions = {},
): string {
  return serializeInlineData({
    ...createI18nSsrHandoffInlineData(payload, options),
    nonce: options.nonce,
  });
}

function isHandoffPayload(value: unknown): value is I18nSsrHandoffPayload {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { language?: unknown }).language === 'string'
  );
}

/**
 * Decode a handoff payload from the raw text content of the element
 * `serializeI18nSsrHandoff` produced. Pure — no DOM access — so it can be
 * unit tested or used from a non-browser client runtime directly.
 * Returns `undefined` for missing, malformed or oversized input rather than
 * throwing, since a corrupted handoff should fall back to client detection.
 */
export function readI18nSsrHandoffFromText(
  text: string | null | undefined,
): I18nSsrHandoffPayload | undefined {
  if (!text) {
    return undefined;
  }
  try {
    const result = parsePublicData(text);
    return isHandoffPayload(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Browser convenience wrapper: reads the handoff element from `document` (or
 * a supplied document-like object) by id and decodes it.
 */
export function readI18nSsrHandoff(
  options: { id?: string; doc?: Pick<Document, 'getElementById'> } = {},
): I18nSsrHandoffPayload | undefined {
  const doc =
    options.doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!doc) {
    return undefined;
  }
  const element = doc.getElementById(options.id ?? I18N_SSR_HANDOFF_ELEMENT_ID);
  return readI18nSsrHandoffFromText(element?.textContent ?? null);
}
