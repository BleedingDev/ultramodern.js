import { createNativeI18n } from '@modern-js/i18n-runtime-extensions/native';
import { createI18nUrlRewrite } from '@modern-js/i18n-runtime-extensions/urlRewrite';
import { createElement, createRoot, flushSync } from 'octane';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { LocalizedLink } from '../src/i18n/LocalizedLink';
import type { I18nInstanceLike } from '../src/i18n/types';
import { useI18n } from '../src/i18n/useI18n';
import {
  ApplicationRouter,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '../src/router';

function createFakeI18nInstance(language: string): I18nInstanceLike & {
  emit: (lng: string) => void;
} {
  const listeners = new Set<(lng: string) => void>();
  const translations: Record<string, Record<string, string>> = {
    en: { greeting: 'Hello' },
    cs: { greeting: 'Ahoj' },
  };
  const instance: I18nInstanceLike & { emit: (lng: string) => void } = {
    language,
    t: key => translations[instance.language]?.[key as string] ?? String(key),
    changeLanguage: async (lng?: string) => {
      if (!lng) return;
      instance.language = lng;
      for (const listener of listeners) listener(lng);
    },
    on: (event, callback) => {
      if (event === 'languageChanged') listeners.add(callback);
    },
    off: (event, callback) => {
      if (event === 'languageChanged') listeners.delete(callback);
    },
    emit: (lng: string) => {
      instance.language = lng;
      for (const listener of listeners) listener(lng);
    },
  };
  return instance;
}

type FakeInstance = ReturnType<typeof createFakeI18nInstance>;

function Consumer() {
  const i18n = useI18n();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'language' }, i18n.language),
    createElement('span', { 'data-testid': 'greeting' }, i18n.t('greeting')),
    createElement(LocalizedLink, { to: '/products' }, 'Products'),
    createElement(LocalizedLink, { to: '/products', language: 'cs' }, 'Česky'),
  );
}

/** Mount the provider as the root route component, as generated entries do. */
async function mount(
  instance: FakeInstance,
  rewrite: boolean,
  basepath = '/',
  link?: Record<string, unknown>,
) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () =>
        createElement(I18nProvider, {
          instance,
          languages: ['en', 'cs'],
          children: link
            ? createElement(
                LocalizedLink,
                { to: '/products', language: 'cs', ...link },
                'Česky',
              )
            : createElement(Consumer),
        }),
    }),
    history: createMemoryHistory({
      initialEntries: [`${basepath === '/' ? '' : basepath}/en/dashboard`],
    }),
    basepath,
    isServer: false,
    ...(rewrite
      ? {
          rewrite: createI18nUrlRewrite({
            languages: ['en', 'cs'],
            getLanguage: () => instance.language,
          }),
        }
      : {}),
  });
  // The entry's router language synchronization, as `entry-client` wires it.
  createNativeI18n(
    { languages: ['en', 'cs'], fallbackLanguage: 'en', basePath: basepath },
    {},
  ).syncWithRouter(router, instance as never);
  await router.load();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const octaneRoot = createRoot(root);
  flushSync(() =>
    octaneRoot.render(createElement(ApplicationRouter as any, { router })),
  );
  return {
    router,
    root,
    dispose() {
      octaneRoot.unmount();
      root.remove();
    },
  };
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100 && !check(); attempt++)
    await new Promise(resolve => setTimeout(resolve, 10));
  expect(check()).toBe(true);
}

const text = (root: HTMLElement, id: string) =>
  root.querySelector(`[data-testid="${id}"]`)?.textContent;
const sameLanguageHref = (root: HTMLElement) =>
  root.querySelector('a:not([hreflang])')?.getAttribute('href');

describe('Octane i18n binding', () => {
  test('changeLanguage keeps the query and fragment of the current URL', async () => {
    const instance = createFakeI18nInstance('en');
    let binding: ReturnType<typeof useI18n> | undefined;
    const Capture = () => {
      binding = useI18n();
      return null;
    };
    const router = createRouter({
      routeTree: createRootRoute({
        component: () =>
          createElement(I18nProvider, {
            instance,
            languages: ['en', 'cs', 'fr'],
            children: createElement(Capture),
          }),
      }),
      history: createMemoryHistory({
        initialEntries: ['/en/products?sort=price#reviews'],
      }),
      isServer: false,
    });
    await router.load();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const octaneRoot = createRoot(root);
    flushSync(() =>
      octaneRoot.render(createElement(ApplicationRouter as any, { router })),
    );
    try {
      await binding!.changeLanguage('cs');
      expect(router.state.location.href).toBe(
        '/cs/products?sort=price#reviews',
      );
      // An unconfigured language changes neither the instance nor the URL;
      // a configured one is matched case-insensitively.
      await expect(binding!.changeLanguage('de')).rejects.toThrow(
        'Unsupported language "de"; expected one of: en, cs, fr',
      );
      expect(instance.language).toBe('cs');
      expect(router.state.location.href).toBe(
        '/cs/products?sort=price#reviews',
      );
      await binding!.changeLanguage('FR');
      expect(instance.language).toBe('fr');
      expect(router.state.location.href).toBe(
        '/fr/products?sort=price#reviews',
      );
      await binding!.changeLanguage('cs');
      // A blocked or failed navigation keeps the page's URL and language.
      const realNavigate = router.navigate.bind(router);
      const fastChange = instance.changeLanguage!;
      const ticks = async () => {
        for (let tick = 0; tick < 50; tick += 1) await Promise.resolve();
      };
      router.navigate = (async () => undefined) as never;
      await binding!.changeLanguage('en');
      expect(instance.language).toBe('cs');
      router.navigate = (async () => {
        throw new Error('navigation failed');
      }) as never;
      await expect(binding!.changeLanguage('en')).rejects.toThrow(
        'navigation failed',
      );
      expect(instance.language).toBe('cs');
      expect(router.state.location.href).toBe(
        '/cs/products?sort=price#reviews',
      );
      router.navigate = realNavigate as never;
      // A failed language load keeps the committed language.
      instance.changeLanguage = async (lng?: string) => {
        if (lng === 'en') throw new Error('load failed');
        return fastChange(lng);
      };
      await expect(binding!.changeLanguage('en')).rejects.toThrow(
        'load failed',
      );
      expect(instance.language).toBe('cs');
      // Switches run one at a time; one that a newer switch supersedes
      // before it starts is skipped.
      const loaded: (string | undefined)[] = [];
      let finishSlow!: () => void;
      instance.changeLanguage = async (lng?: string) => {
        loaded.push(lng);
        if (lng === 'en')
          await new Promise<void>(resolve => {
            finishSlow = resolve;
          });
        return fastChange(lng);
      };
      const slow = binding!.changeLanguage('en');
      await ticks();
      const superseded = binding!.changeLanguage('fr');
      const newest = binding!.changeLanguage('cs');
      finishSlow();
      await Promise.all([slow, superseded, newest]);
      expect(loaded).toEqual(['en', 'cs']);
      expect(router.state.location.href).toBe(
        '/cs/products?sort=price#reviews',
      );
      expect(instance.language).toBe('cs');
      // A newer switch whose load rejects leaves the language the older
      // switch committed with its URL.
      let finishOlder!: () => void;
      instance.changeLanguage = async (lng?: string) => {
        if (lng === 'en')
          await new Promise<void>(resolve => {
            finishOlder = resolve;
          });
        if (lng === 'fr') throw new Error('fr unavailable');
        return fastChange(lng);
      };
      const older = binding!.changeLanguage('en');
      await ticks();
      const rejected = binding!.changeLanguage('fr');
      finishOlder();
      await older;
      await expect(rejected).rejects.toThrow('fr unavailable');
      expect(router.state.location.href).toBe(
        '/en/products?sort=price#reviews',
      );
      expect(instance.language).toBe('en');
      instance.changeLanguage = fastChange;
      // On a route without a locale prefix, overlapping blocked switches
      // keep the language that route was committed with.
      await realNavigate({ to: '.', href: '/login', replace: true } as never);
      await fastChange('cs');
      let releaseFirst!: () => void;
      let navigations = 0;
      router.navigate = (() =>
        ++navigations === 1
          ? new Promise<void>(resolve => {
              releaseFirst = resolve;
            })
          : Promise.resolve()) as never;
      const first = binding!.changeLanguage('en');
      for (let tick = 0; navigations === 0 && tick < 100; tick += 1)
        await Promise.resolve();
      const second = binding!.changeLanguage('fr');
      releaseFirst();
      await Promise.all([first, second]);
      expect(router.state.location.pathname).toBe('/login');
      expect(instance.language).toBe('cs');
      // A navigation redirected to another locale's URL leaves the language
      // on the locale that URL represents, matched case-insensitively.
      router.navigate = ((options: never) =>
        realNavigate({
          ...(options as object),
          href: '/en/login',
        } as never)) as never;
      await binding!.changeLanguage('cs');
      expect(router.state.location.pathname).toBe('/en/login');
      expect(instance.language).toBe('en');
      router.navigate = ((options: never) =>
        realNavigate({
          ...(options as object),
          href: '/CS/login',
        } as never)) as never;
      await binding!.changeLanguage('fr');
      expect(router.state.location.pathname).toBe('/CS/login');
      expect(instance.language).toBe('cs');
      router.navigate = realNavigate as never;
    } finally {
      octaneRoot.unmount();
      root.remove();
    }
  });

  test('changeLanguage keeps the router basepath', async () => {
    const instance = createFakeI18nInstance('en');
    let binding: ReturnType<typeof useI18n> | undefined;
    const Capture = () => {
      binding = useI18n();
      return null;
    };
    const router = createRouter({
      routeTree: createRootRoute({
        component: () =>
          createElement(I18nProvider, {
            instance,
            languages: ['en', 'cs'],
            children: createElement(Capture),
          }),
      }),
      history: createMemoryHistory({
        initialEntries: ['/store/en/products?sort=price'],
      }),
      basepath: '/store',
      isServer: false,
    });
    await router.load();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const octaneRoot = createRoot(root);
    flushSync(() =>
      octaneRoot.render(createElement(ApplicationRouter as any, { router })),
    );
    try {
      await binding!.changeLanguage('cs');
      expect(router.history.location.pathname).toBe('/store/cs/products');
      expect(router.history.location.search).toBe('?sort=price');
      expect(instance.language).toBe('cs');
    } finally {
      octaneRoot.unmount();
      root.remove();
    }
  });

  test('changeLanguage under the i18n URL rewrite follows the public locale URL', async () => {
    const instance = createFakeI18nInstance('cs');
    let binding: ReturnType<typeof useI18n> | undefined;
    const Capture = () => {
      binding = useI18n();
      return null;
    };
    const languages = ['en', 'cs', 'fr'];
    const router = createRouter({
      routeTree: createRootRoute({
        component: () =>
          createElement(I18nProvider, {
            instance,
            languages,
            children: createElement(Capture),
          }),
      }),
      history: createMemoryHistory({
        initialEntries: ['/store/cs/products?sort=price'],
      }),
      basepath: '/store',
      rewrite: createI18nUrlRewrite({
        languages,
        getLanguage: () => instance.language,
      }),
      isServer: false,
    });
    await router.load();
    // The router matches the canonical path; only the public URL is localized.
    expect(router.state.location.pathname).toBe('/products');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const octaneRoot = createRoot(root);
    flushSync(() =>
      octaneRoot.render(createElement(ApplicationRouter as any, { router })),
    );
    const publicLanguage = () => router.history.location.pathname.split('/')[2];
    try {
      await binding!.changeLanguage('fr');
      expect(router.history.location.pathname).toBe('/store/fr/products');
      expect(router.history.location.search).toBe('?sort=price');
      expect(instance.language).toBe('fr');
      // A switch redirected to another page keeps the language of the URL
      // the user lands on.
      const realNavigate = router.navigate.bind(router);
      router.navigate = ((options: never) =>
        realNavigate({
          ...(options as object),
          href: '/en/login',
        } as never)) as never;
      await binding!.changeLanguage('cs');
      router.navigate = realNavigate as never;
      expect(router.state.location.pathname).toBe('/login');
      expect(instance.language).toBe(publicLanguage());
    } finally {
      octaneRoot.unmount();
      root.remove();
    }
  });

  test('a link to another language is the native Link with its router props', async () => {
    const instance = createFakeI18nInstance('en');
    const { router, root, dispose } = await mount(instance, true, '/store', {
      to: '/dashboard',
      class: 'switch',
      activeProps: { class: 'is-active' },
      inactiveProps: { class: 'is-inactive' },
      preload: 'intent',
    });
    const preloadRoute = rstest.spyOn(router, 'preloadRoute');
    try {
      const anchor = root.querySelector<HTMLAnchorElement>('a[hreflang="cs"]');
      expect(anchor?.getAttribute('href')).toBe('/store/cs/dashboard');
      // The canonical route is the current one, so the native active state applies.
      expect(anchor?.className).toContain('is-active');
      expect(anchor?.className).not.toContain('is-inactive');
      expect(anchor?.getAttribute('data-status')).toBe('active');

      anchor?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      anchor?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await rstest.waitFor(() => expect(preloadRoute).toHaveBeenCalled());
      expect(preloadRoute.mock.calls[0]?.[0]).toMatchObject({
        to: '/dashboard',
        mask: { to: '/cs/dashboard' },
      });

      const modified = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ctrlKey: true,
      });
      anchor?.dispatchEvent(modified);
      expect(modified.defaultPrevented).toBe(false);

      // Switching the language of the current page still pushes a location.
      anchor?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
      await until(() => instance.language === 'cs');
      expect(router.history.location.pathname).toBe('/store/cs/dashboard');
      expect(router.history.length).toBe(2);
      expect(router.state.location.pathname).toBe('/dashboard');
    } finally {
      preloadRoute.mockRestore();
      dispose();
    }
  });

  test.each([false, true])(
    'useI18n and LocalizedLink follow languageChanged (router rewrite: %s)',
    async rewrite => {
      const instance = createFakeI18nInstance('en');
      const { router, root, dispose } = await mount(instance, rewrite);
      try {
        expect(text(root, 'language')).toBe('en');
        expect(text(root, 'greeting')).toBe('Hello');
        expect(sameLanguageHref(root)).toBe('/en/products');
        if (rewrite) expect(router.state.location.pathname).toBe('/dashboard');

        flushSync(() => instance.emit('cs'));

        expect(text(root, 'language')).toBe('cs');
        expect(text(root, 'greeting')).toBe('Ahoj');
        expect(sameLanguageHref(root)).toBe('/cs/products');
      } finally {
        dispose();
      }
    },
  );

  test.each([false, true])(
    'a link to another language navigates through the router (router rewrite: %s)',
    async rewrite => {
      const instance = createFakeI18nInstance('en');
      const { router, root, dispose } = await mount(instance, rewrite);
      try {
        const anchor =
          root.querySelector<HTMLAnchorElement>('a[hreflang="cs"]');
        expect(anchor?.getAttribute('href')).toBe('/cs/products');
        anchor?.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
        await until(() => instance.language === 'cs');
        expect(router.history.location.pathname).toBe('/cs/products');
        expect(router.state.location.pathname).toBe(
          rewrite ? '/products' : '/cs/products',
        );
        // Once the instance follows, the link is a same-language link.
        await until(() => sameLanguageHref(root) === '/cs/products');
      } finally {
        dispose();
      }
    },
  );
});
