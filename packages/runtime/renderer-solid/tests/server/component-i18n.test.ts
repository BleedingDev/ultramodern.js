import { renderToString, ssr } from '@solidjs/web';
import { componentView } from '../../src/entry-application';
import { type I18nInstanceLike, useI18n } from '../../src/i18n';

describe('Solid component-only localization on the server', () => {
  test.each([
    ['en', 'Hello'],
    ['cs', 'Ahoj'],
  ])(
    'renders the resolved %s instance without a router',
    async (language, greeting) => {
      const instance: I18nInstanceLike = { language, t: () => greeting };
      function App() {
        const binding = useI18n();
        expect(binding.instance).toBe(instance);
        return ssr(
          ['<p>', ':', '</p>'],
          binding.language(),
          binding.t('greeting'),
        );
      }

      const html = await renderToString(
        componentView(App, { instance, languages: ['en', 'cs'] }),
      );
      expect(html).toContain(`<p>${language}:${greeting}</p>`);
    },
  );
});
