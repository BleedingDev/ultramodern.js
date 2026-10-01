import { runtime } from '@modern-js/plugin/runtime';
import { useModernI18n } from '@modern-js/plugin-i18n/runtime/consumer';
import { RuntimeContext } from '@modern-js/runtime/context';
import { describe, expect, test } from '@rstest/core';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { i18nPlugin } from '../src/runtime';
import { i18nPlugin as noReactI18nPlugin } from '../src/runtime-no-react-i18next';

describe('native lifecycle in the combined runtime', () => {
  test.each([
    ['default', i18nPlugin],
    ['no-react', noReactI18nPlugin],
  ] as const)(
    '%s entry initializes and wraps the native lifecycle once',
    async (_, factory) => {
      const instance = i18next.createInstance();
      const clone = rstest.spyOn(instance, 'cloneInstance');
      const { runtimeContext } = runtime.run({
        config: {},
        plugins: [
          factory({
            i18nInstance: instance,
            localeDetection: {
              languages: ['en', 'cs'],
              fallbackLanguage: 'en',
              i18nextDetector: false,
            },
            initOptions: {
              resources: { en: { translation: { title: 'native copy' } } },
            },
          }),
        ],
      });
      await runtimeContext.hooks.onBeforeRender.call(runtimeContext);
      expect(clone).toHaveBeenCalledTimes(1);
      function App({ label }: { label: string }) {
        const { t } = useModernI18n();
        return (
          <p>
            {label}:{t('title')}
          </p>
        );
      }
      const Wrapped = runtimeContext.hooks.wrapRoot.call(App);
      const html = renderToStaticMarkup(
        <RuntimeContext.Provider value={runtimeContext as any}>
          <Wrapped label="preserved" />
        </RuntimeContext.Provider>,
      );
      expect(html).toBe('<p>preserved:native copy</p>');
      clone.mockRestore();
    },
  );
});
