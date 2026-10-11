import { createNativeI18n } from '../src/native';
import {
  I18N_SSR_HANDOFF_ELEMENT_ID,
  readI18nSsrHandoffFromText,
} from '../src/ssrLanguageHandoff';

function localization(loads: string[] = []) {
  const bundle = (language: string, namespace: string, value: object) => () => {
    loads.push(`${language}/${namespace}`);
    return Promise.resolve({ default: value });
  };
  return createNativeI18n(
    {
      languages: ['en', 'cs'],
      fallbackLanguage: 'en',
      basePath: '/',
      detect: false,
      initOptions: { returnNull: false },
    },
    {
      en: {
        translation: bundle('en', 'translation', { title: 'Hello' }),
        common: bundle('en', 'common', { ok: 'OK' }),
      },
      cs: { translation: bundle('cs', 'translation', { title: 'Ahoj' }) },
    },
  );
}

describe('native i18n entry runtime', () => {
  it('creates an isolated i18next instance per call and hands its bundles off', async () => {
    const loads: string[] = [];
    const i18n = localization(loads);
    const first = await i18n.create('cs');
    const second = await i18n.create('cs', {
      translation: { title: 'Ahoj' },
    });
    expect(first).not.toBe(second);
    // The handed-off bundle is used directly; only the first instance loads
    // it. Both load the fallback language on demand.
    expect(loads.filter(load => load.startsWith('cs/'))).toEqual([
      'cs/translation',
    ]);
    expect(loads.filter(load => load === 'en/translation')).toHaveLength(2);
    expect(first.t('title')).toBe('Ahoj');
    expect(second.t('title')).toBe('Ahoj');
    expect(first.options).toMatchObject({
      lng: 'cs',
      fallbackLng: ['en'],
      supportedLngs: ['en', 'cs', 'cimode'],
      ns: ['common', 'translation'],
      defaultNS: 'translation',
      partialBundledLanguages: true,
      returnNull: false,
      interpolation: { escapeValue: false },
    });
    const handoff = i18n.handoff('cs', first);
    expect(handoff.id).toBe(I18N_SSR_HANDOFF_ELEMENT_ID);
    expect(readI18nSsrHandoffFromText(handoff.payload)).toEqual({
      language: 'cs',
      resources: { common: {}, translation: { title: 'Ahoj' } },
    });
    expect(readI18nSsrHandoffFromText(i18n.handoff('cs').payload)).toEqual({
      language: 'cs',
    });
  });

  it('resolves request languages, redirects and localizes router locations', () => {
    const i18n = localization();
    expect(i18n.languages).toEqual(['en', 'cs']);
    expect(
      i18n.resolveRequest(new Request('https://example.test/cs/items')),
    ).toEqual({ kind: 'language', language: 'cs' });
    const unprefixed = i18n.resolveRequest(
      new Request('https://example.test/items'),
    );
    expect(unprefixed).toMatchObject({
      kind: 'redirect',
      language: 'en',
      location: '/en/items',
    });
    const redirect = i18n.redirect('/en/items');
    expect(redirect.headers.get('location')).toBe('/en/items');
    let language = 'en';
    const rewrite = i18n.rewrite(() => language);
    language = 'cs';
    const output = rewrite.output?.({
      url: new URL('https://example.test/items'),
    });
    expect(new URL(String(output)).pathname).toBe('/cs/items');
  });
});
