const SAFE_HTML_ATTRIBUTE_NAME = /^[^\u0000-\u0020"'<>/=]+$/u;

export const isSafeHtmlAttributeName = (name: string): boolean =>
  SAFE_HTML_ATTRIBUTE_NAME.test(name);

export const escapeHtmlAttribute = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
