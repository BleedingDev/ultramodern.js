import { describe, expect, test } from '@rstest/core';
import {
  I18N_SSR_HANDOFF_ELEMENT_ID,
  readI18nSsrHandoff,
  readI18nSsrHandoffFromText,
  serializeI18nSsrHandoff,
} from '../src/ssrLanguageHandoff';

function extractTextContent(html: string): string {
  const start = html.indexOf('>') + 1;
  const end = html.lastIndexOf('</script>');
  return html.slice(start, end);
}

class FakeElement {
  constructor(public textContent: string) {}
}

class FakeDocument {
  constructor(private readonly elements: Record<string, FakeElement>) {}
  getElementById(id: string) {
    return this.elements[id] ?? null;
  }
}

describe('serializeI18nSsrHandoff / read round trip', () => {
  test('round-trips language and resources through the inline script element', () => {
    const html = serializeI18nSsrHandoff({
      language: 'cs',
      resources: { translation: { greeting: 'Ahoj' } },
    });
    expect(html.startsWith('<script type="application/json"')).toBe(true);
    expect(html).toContain(`id="${I18N_SSR_HANDOFF_ELEMENT_ID}"`);

    const text = extractTextContent(html);
    const payload = readI18nSsrHandoffFromText(text);
    expect(payload).toEqual({
      language: 'cs',
      resources: { translation: { greeting: 'Ahoj' } },
    });
  });

  test('round-trips through a document-like reader', () => {
    const html = serializeI18nSsrHandoff({ language: 'en' }, { id: 'custom' });
    const doc = new FakeDocument({
      custom: new FakeElement(extractTextContent(html)),
    });
    expect(readI18nSsrHandoff({ id: 'custom', doc })).toEqual({
      language: 'en',
    });
  });

  test('a missing element reads as undefined, not a throw', () => {
    const doc = new FakeDocument({});
    expect(readI18nSsrHandoff({ doc })).toBeUndefined();
    expect(readI18nSsrHandoffFromText(null)).toBeUndefined();
    expect(readI18nSsrHandoffFromText('not json')).toBeUndefined();
    expect(readI18nSsrHandoffFromText('{"not":"a payload"}')).toBeUndefined();
  });

  test('rejects an empty language', () => {
    expect(() => serializeI18nSsrHandoff({ language: '' })).toThrow(TypeError);
  });

  describe('XSS payloads inside resource values stay inert', () => {
    const cases: Array<[name: string, value: string]> = [
      [
        'a closing script tag',
        '</script><script>globalThis.pwned=true</script>',
      ],
      ['a line separator', 'line break'],
      ['a paragraph separator', 'para graph'],
      ['an ampersand and angle brackets', '<b>Tom & Jerry</b>'],
    ];

    for (const [name, value] of cases) {
      test(name, () => {
        const html = serializeI18nSsrHandoff({
          language: 'en',
          resources: { translation: { value } },
        });

        // The hostile payload must never appear as a literal closing tag or
        // raw line/paragraph separator inside the emitted HTML.
        expect(html.match(/<\/script>/g)).toHaveLength(1);
        expect(html).not.toContain(' ');
        expect(html).not.toContain(' ');

        const text = extractTextContent(html);
        const payload = readI18nSsrHandoffFromText(text);
        expect(payload?.resources?.translation.value).toBe(value);
      });
    }
  });
});
