import { createRequire } from 'node:module';
import { prepareDocument } from '@modern-js/renderer-core/document';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import { flush } from 'solid-js';
import { mountApplication } from '../../src/client';
import { componentView } from '../../src/entry-application';
import { startNativeClient } from '../../src/entry-client';
import {
  type I18nInstanceLike,
  I18nProvider,
  type UseI18nReturn,
  useI18n,
} from '../../src/i18n';

function createComponentI18n(): I18nInstanceLike {
  const listeners = new Set<(language: string) => void>();
  const instance: I18nInstanceLike = {
    language: 'en',
    t: () => (instance.language === 'cs' ? 'Ahoj' : 'Hello'),
    changeLanguage: async language => {
      if (!language) return;
      instance.language = language;
      for (const listener of listeners) listener(language);
    },
    on: (_event, listener) => listeners.add(listener),
    off: (_event, listener) => listeners.delete(listener),
  };
  return instance;
}

describe('Solid component-only localization', () => {
  test.each([false, true])(
    'the generated component client uses the resolved instance when hydrating is %s',
    async hydrating => {
      const previousHydration = Object.getOwnPropertyDescriptor(
        globalThis,
        '_$HY',
      );
      const identity: RendererIdentity = {
        renderer: 'solid',
        appId: 'localized-component',
        entryName: 'main',
        protocolVersion: 1,
        buildId: 'component-build',
      };
      const { bootstrap } = prepareDocument({
        identity,
        documentId: 'component-document',
        hydrating,
      });
      const container = document.createElement('div');
      container.innerHTML = `<div id="root"></div>${bootstrap}`;
      document.body.appendChild(container);
      const instance = createComponentI18n();
      const resources = { translation: { greeting: 'Hello' } };
      const create = rstest.fn(async () => instance);
      const rewrite = rstest.fn(() => ({}));
      const syncWithRouter = rstest.fn();
      const ready = Promise.withResolvers<UseI18nReturn>();
      function App() {
        ready.resolve(useI18n());
        return null;
      }
      let dispose: (() => void) | undefined;
      let releaseNativeEvents: (() => void) | undefined;
      try {
        if (hydrating) {
          const { generateHydrationScript } = createRequire(import.meta.url)(
            '@solidjs/web',
          );
          const nativeBootstrap = document.createElement('div');
          nativeBootstrap.innerHTML = generateHydrationScript({
            eventNames: [],
          });
          const script = nativeBootstrap.querySelector('script');
          if (!script?.textContent)
            throw new Error('The native hydration script is missing');
          const addListener = rstest.spyOn(document, 'addEventListener');
          try {
            new Function(script.textContent)();
          } finally {
            const listeners = addListener.mock.calls.slice();
            releaseNativeEvents = () => {
              for (const [event, listener, options] of listeners)
                document.removeEventListener(event, listener, options);
            };
            addListener.mockRestore();
          }
        }
        startNativeClient({
          identity,
          load: async () => ({ default: App }),
          hot: { dispose: (callback: () => void) => (dispose = callback) },
          i18n: {
            languages: ['en', 'cs'],
            resolveRequest: () => ({ kind: 'language', language: 'en' }),
            redirect: () => new Response(null),
            create,
            rewrite,
            handoff: () => ({ id: 'i18n', payload: '{}' }),
            clientHandoff: () => ({ language: 'en', resources }),
            syncWithRouter,
          },
        });
        const binding = await ready.promise;
        flush();
        expect(create).toHaveBeenCalledExactlyOnceWith('en', resources);
        expect(binding.instance).toBe(instance);
        expect(binding.language()).toBe('en');
        expect(binding.t('greeting')).toBe('Hello');

        await binding.changeLanguage('cs');
        flush();
        expect(binding.instance).toBe(instance);
        expect(binding.language()).toBe('cs');
        expect(binding.t('greeting')).toBe('Ahoj');
        expect(rewrite).not.toHaveBeenCalled();
        expect(syncWithRouter).not.toHaveBeenCalled();
      } finally {
        dispose?.();
        flush();
        container.remove();
        releaseNativeEvents?.();
        if (previousHydration)
          Object.defineProperty(globalThis, '_$HY', previousHydration);
        else Reflect.deleteProperty(globalThis, '_$HY');
      }
    },
  );

  test('the component view provides the resolved instance to the public hook', async () => {
    const instance = createComponentI18n();
    let binding: UseI18nReturn | undefined;
    function App() {
      binding = useI18n();
      return (
        <p>
          <span data-language>{binding.language()}</span>
          <span data-greeting>{binding.t('greeting')}</span>
        </p>
      );
    }
    const root = document.createElement('div');
    let dispose: (() => void) | undefined;
    try {
      dispose = mountApplication(
        componentView(App, { instance, languages: ['en', 'cs'] }),
        root,
      );
      flush();
      expect(binding?.instance).toBe(instance);
      expect(root.querySelector('[data-language]')?.textContent).toBe('en');
      expect(root.querySelector('[data-greeting]')?.textContent).toBe('Hello');

      await binding?.changeLanguage('cs');
      flush();
      expect(instance.language).toBe('cs');
      expect(root.querySelector('[data-language]')?.textContent).toBe('cs');
      expect(root.querySelector('[data-greeting]')?.textContent).toBe('Ahoj');
    } finally {
      dispose?.();
      flush();
    }
  });

  test('the public hook changes language without a router provider', async () => {
    const instance = createComponentI18n();
    let binding: UseI18nReturn | undefined;
    function App() {
      binding = useI18n();
      return (
        <p>
          <span data-language>{binding.language()}</span>
          <span data-greeting>{binding.t('greeting')}</span>
        </p>
      );
    }
    const root = document.createElement('div');
    const dispose = mountApplication(
      () => (
        <I18nProvider instance={instance} languages={['en', 'cs']}>
          <App />
        </I18nProvider>
      ),
      root,
    );
    try {
      flush();
      expect(binding?.instance).toBe(instance);
      expect(root.querySelector('[data-greeting]')?.textContent).toBe('Hello');

      await binding?.changeLanguage('cs');
      flush();
      expect(root.querySelector('[data-language]')?.textContent).toBe('cs');
      expect(root.querySelector('[data-greeting]')?.textContent).toBe('Ahoj');
    } finally {
      dispose();
      flush();
    }
  });
});
