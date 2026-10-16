import { createNativeI18n } from '@modern-js/i18n-runtime-extensions/native';
import { createSignal, flush } from 'solid-js';
import { mountApplication } from '../../src/client';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import {
  LocalizedLink,
  type LocalizedLinkProps,
} from '../../src/i18n/LocalizedLink';
import { useI18n } from '../../src/i18n/useI18n';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  RouterProvider,
} from '../../src/router';

function Greeting() {
  const i18n = useI18n();
  return <span data-greeting>{i18n.t('greeting')}</span>;
}

async function mountLink(
  props: Partial<LocalizedLinkProps> = {},
  initialEntry = '/store/en/dashboard',
  {
    middleware = false,
    rootMiddleware = false,
    rewrite = true,
    native = false,
    dangerousRewrite = false,
  } = {},
) {
  const localization = createNativeI18n(
    {
      languages: ['en', 'cs'],
      fallbackLanguage: 'en',
      basePath: '/store',
      detect: false,
      localisedUrls: {
        '/products/:slug': { en: '/products/:slug', cs: '/produkty/:slug' },
      },
    },
    {
      en: { translation: async () => ({ greeting: 'Hello' }) },
      cs: { translation: async () => ({ greeting: 'Ahoj' }) },
    },
  );
  const instance = await localization.create('en');
  const loader = rstest.fn(() => 'products');
  const LinkComponent = native ? Link : LocalizedLink;
  const rootRoute = createRootRoute({
    ...(rootMiddleware
      ? {
          search: {
            middlewares: [
              ({ search, next }) => {
                const resolved = next(search);
                return {
                  ...resolved,
                  chain: `${resolved.chain ?? ''}root`,
                };
              },
            ],
          },
        }
      : {}),
    component: () => (
      <I18nProvider
        instance={instance}
        languages={localization.languages}
        localisedUrls={localization.localisedUrls}
      >
        <main>
          <Greeting />
          <LinkComponent
            to="/products/$slug"
            language="cs"
            params={{ slug: 'RED' }}
            {...props}
          >
            {props.children ?? 'Česky'}
          </LinkComponent>
        </main>
      </I18nProvider>
    ),
  });
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/dashboard' }),
    createRoute({ getParentRoute: () => rootRoute, path: '/products' }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/products/$slug',
      params: {
        stringify: params => ({ slug: String(params.slug).toLowerCase() }),
      },
      loader,
      ...(middleware
        ? {
            validateSearch: (search: Record<string, unknown>) => ({
              ...search,
              mode: search.mode ?? 'listing',
            }),
            search: {
              middlewares: [
                ({ search, next }) => ({ ...next(search), display: 'grid' }),
              ],
            },
          }
        : {}),
    }),
  ]);
  const history = createMemoryHistory({ initialEntries: [initialEntry] });
  const router = createRouter({
    routeTree,
    history,
    basepath: '/store',
    isServer: false,
    ...(dangerousRewrite
      ? { rewrite: { output: () => new URL('javascript:alert(1)') } }
      : rewrite
        ? { rewrite: localization.rewrite(() => instance.language) }
        : {}),
  });
  localization.syncWithRouter(router, instance);
  await router.load();
  const root = document.createElement('div');
  document.body.append(root);
  const unmount = mountApplication(
    () => <RouterProvider router={router} />,
    root,
  );
  flush();
  return {
    instance,
    loader,
    router,
    history,
    root,
    dispose() {
      unmount();
      root.remove();
      history.destroy();
      flush();
    },
  };
}

function click(anchor: HTMLAnchorElement | null, options: MouseEventInit = {}) {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...options,
  });
  anchor?.dispatchEvent(event);
  return event;
}

describe('native Solid localized links', () => {
  const navigation = Reflect.get(document.defaultView, 'happyDOM').settings
    .navigation;
  const childPageNavigation = navigation.disableChildPageNavigation;
  beforeAll(() => {
    navigation.disableChildPageNavigation = true;
  });
  afterAll(() => {
    navigation.disableChildPageNavigation = childPageNavigation;
  });

  test('intent preload retains canonical params, search, state and native styling without switching language', async () => {
    const state = { cart: 'tractor' };
    const app = await mountLink({
      preload: 'intent',
      preloadDelay: 0,
      search: { sort: 'price' },
      hash: 'details',
      state: () => state,
      class: 'base',
      inactiveProps: { class: 'inactive', 'data-link-state': 'inactive' },
      'data-link': 'products',
      'aria-label': 'Czech products',
    });
    try {
      const anchor = app.root.querySelector<HTMLAnchorElement>('a');
      expect(anchor?.getAttribute('href')).toBe(
        '/store/cs/produkty/red?sort=price#details',
      );
      expect(anchor?.getAttribute('hreflang')).toBe('cs');
      expect(anchor?.getAttribute('data-link')).toBe('products');
      expect(anchor?.getAttribute('aria-label')).toBe('Czech products');
      expect(anchor?.className).toBe('base inactive');
      expect(anchor?.getAttribute('data-link-state')).toBe('inactive');
      anchor?.focus();
      await rstest.waitFor(() => expect(app.loader).toHaveBeenCalledOnce());
      expect(app.loader.mock.calls[0]?.[0]).toMatchObject({
        params: { slug: 'red' },
        preload: true,
        location: {
          pathname: '/products/red',
          search: { sort: 'price' },
          hash: 'details',
          state,
        },
      });
      expect(app.instance.language).toBe('en');
      expect(app.router.state.location.pathname).toBe('/dashboard');

      expect(click(anchor).defaultPrevented).toBe(true);
      await rstest.waitFor(() => expect(app.instance.language).toBe('cs'));
      flush();
      expect(app.router.state.location.pathname).toBe('/products/red');
      expect(app.router.state.location.maskedLocation?.publicHref).toBe(
        '/store/cs/produkty/red?sort=price#details',
      );
      expect(app.history.location.state).toMatchObject(state);
      expect(app.root.querySelector('[data-greeting]')?.textContent).toBe(
        'Ahoj',
      );
    } finally {
      app.dispose();
    }
  });

  test.each([false, true])(
    'same-page language navigation preserves active children and native history (replace: %s)',
    async replace => {
      const app = await mountLink(
        {
          replace,
          activeOptions: {
            exact: true,
            includeSearch: true,
            includeHash: true,
          },
          activeProps: { class: 'current', 'data-link-state': 'active' },
          search: { sort: 'price' },
          hash: 'details',
          children: ({ isActive }) => (isActive ? 'Active' : 'Inactive'),
        },
        '/store/en/products/red?sort=price#details',
      );
      const push = rstest.spyOn(app.history, 'push');
      const replaceHistory = rstest.spyOn(app.history, 'replace');
      try {
        const anchor = app.root.querySelector<HTMLAnchorElement>('a');
        expect(anchor?.textContent).toBe('Active');
        expect(anchor?.getAttribute('aria-current')).toBe('page');
        expect(anchor?.getAttribute('data-link-state')).toBe('active');
        expect(anchor?.classList.contains('current')).toBe(true);
        click(anchor);
        await rstest.waitFor(() => expect(app.instance.language).toBe('cs'));
        expect(app.router.state.location.pathname).toBe('/products/red');
        expect(push).toHaveBeenCalledTimes(replace ? 0 : 1);
        expect(replaceHistory).toHaveBeenCalledTimes(replace ? 1 : 0);
        if (!replace) {
          app.history.back();
          await rstest.waitFor(() => expect(app.instance.language).toBe('en'));
          expect(app.history.location.href).toBe(
            '/store/en/products/red?sort=price#details',
          );
          app.history.forward();
          await rstest.waitFor(() => expect(app.instance.language).toBe('cs'));
          expect(app.history.location.href).toBe(
            '/store/cs/produkty/red?sort=price#details',
          );
        }
      } finally {
        push.mockRestore();
        replaceHistory.mockRestore();
        app.dispose();
      }
    },
  );

  test('relative targets and reactive link props follow a persistent native layout', async () => {
    const [to, setTo] = createSignal('..');
    const [language, setLanguage] = createSignal<string | undefined>('cs');
    const [slug, setSlug] = createSignal('RED');
    const [sort, setSort] = createSignal('price');
    const app = await mountLink(
      {
        get to() {
          return to();
        },
        get language() {
          return language();
        },
        get params() {
          return { slug: slug() };
        },
        get search() {
          return { sort: sort() };
        },
      },
      '/store/en/products/red',
    );
    try {
      expect(app.root.querySelector('a')?.getAttribute('href')).toBe(
        '/store/cs/products?sort=price',
      );
      await app.router.navigate({ to: '/dashboard' });
      await rstest.waitFor(() =>
        expect(app.root.querySelector('a')?.getAttribute('href')).toBe(
          '/store/cs?sort=price',
        ),
      );
      setTo('/products/$slug');
      setSlug('BLUE');
      setSort('name');
      setLanguage(undefined);
      flush();
      expect(app.root.querySelector('a')?.getAttribute('href')).toBe(
        '/store/en/products/blue?sort=name',
      );
      await app.instance.changeLanguage('cs');
      flush();
      expect(app.root.querySelector('a')?.getAttribute('href')).toBe(
        '/store/cs/produkty/blue?sort=name',
      );
      expect(app.root.querySelector('a')?.hasAttribute('hreflang')).toBe(false);
    } finally {
      app.dispose();
    }
  });

  test('native updaters use current search, hash and state with canonical defaults and middleware', async () => {
    const app = await mountLink(
      {
        search: previous => ({ revision: Number(previous.revision ?? 0) + 1 }),
        hash: previous => `${previous}-details`,
        state: previous => ({
          cart: Number(Reflect.get(previous, 'cart') ?? 0) + 1,
        }),
      },
      '/store/en/dashboard?revision=1#first',
      { middleware: true },
    );
    try {
      await app.router.navigate({
        to: '/dashboard',
        search: { revision: 7 },
        hash: 'current',
        state: { cart: 5 },
      });
      await rstest.waitFor(() =>
        expect(app.root.querySelector('a')?.getAttribute('href')).toBe(
          '/store/cs/produkty/red?revision=8&display=grid#current-details',
        ),
      );
      await app.router.navigate({
        to: '.',
        search: true,
        hash: true,
        state: { cart: 12 },
      });
      click(app.root.querySelector('a'));
      await rstest.waitFor(() => expect(app.instance.language).toBe('cs'));
      expect(app.router.state.location).toMatchObject({
        pathname: '/products/red',
        search: { revision: 8, mode: 'listing', display: 'grid' },
        hash: 'current-details',
        state: { cart: 13 },
        maskedLocation: {
          publicHref:
            '/store/cs/produkty/red?revision=8&mode=listing&display=grid#current-details',
          state: { cart: 13 },
        },
      });
      expect(app.history.location.state).toMatchObject({ cart: 13 });
    } finally {
      app.dispose();
    }
  });

  test('the language mask retains one canonical search middleware pipeline', async () => {
    const app = await mountLink(
      { search: { revision: 1 } },
      '/store/en/dashboard',
      { middleware: true, rootMiddleware: true },
    );
    try {
      const expected =
        '/store/cs/produkty/red?revision=1&mode=listing&display=grid&chain=root';
      const anchor = app.root.querySelector<HTMLAnchorElement>('a');
      expect(anchor?.getAttribute('href')).toBe(
        '/store/cs/produkty/red?revision=1&display=grid&chain=root',
      );
      const canonical = app.router.buildLocation({
        to: '/products/$slug',
        params: { slug: 'RED' },
        search: { revision: 1 },
        _includeValidateSearch: true,
      });
      expect(canonical.search).toEqual({
        revision: 1,
        mode: 'listing',
        display: 'grid',
        chain: 'root',
      });
      click(anchor);
      await rstest.waitFor(() => expect(app.instance.language).toBe('cs'));
      expect(app.router.state.location.search).toEqual(canonical.search);
      expect(app.router.state.location.maskedLocation?.search).toEqual(
        app.router.state.location.search,
      );
      expect(app.router.state.location.maskedLocation?.publicHref).toBe(
        expected,
      );
    } finally {
      app.dispose();
    }
  });

  test.each([
    { props: { disabled: true }, event: {} },
    { props: { target: '_blank', rel: 'noopener' }, event: {} },
    { props: {}, event: { ctrlKey: true } },
    { props: {}, event: { metaKey: true } },
    { props: {}, event: { button: 1 } },
    {
      props: { onClick: (event: MouseEvent) => event.preventDefault() },
      event: {},
    },
  ])(
    'native non-navigation behavior preserves language: %j',
    async ({ props, event }) => {
      const app = await mountLink(props);
      const push = rstest.spyOn(app.history, 'push');
      try {
        const anchor = app.root.querySelector<HTMLAnchorElement>('a');
        if ('disabled' in props) {
          expect(anchor?.hasAttribute('href')).toBe(false);
          expect(anchor?.getAttribute('aria-disabled')).toBe('true');
        }
        click(anchor, event);
        await Promise.resolve();
        expect(push).not.toHaveBeenCalled();
        expect(app.instance.language).toBe('en');
      } finally {
        push.mockRestore();
        app.dispose();
      }
    },
  );

  test.each([false, true])(
    'external links retain the native destination (rewrite: %s)',
    async rewrite => {
      const to = 'https://example.com/products?sort=price#details';
      const app = await mountLink(
        { to, target: '_blank', rel: 'noopener' },
        '/store/en/dashboard',
        { rewrite },
      );
      try {
        const anchor = app.root.querySelector<HTMLAnchorElement>('a');
        expect(anchor?.getAttribute('href')).toBe(to);
        expect(anchor?.getAttribute('target')).toBe('_blank');
        expect(anchor?.getAttribute('rel')).toBe('noopener');
        expect(click(anchor).defaultPrevented).toBe(false);
        expect(app.instance.language).toBe('en');
      } finally {
        app.dispose();
      }
    },
  );

  test.each([
    'https://catalog.example/products?sort=price#details',
    '//catalog.example/products?sort=price#details',
  ])(
    'native external targets retain reactive href and disabled semantics: %s',
    async initial => {
      const [to, setTo] = createSignal(initial);
      const [disabled, setDisabled] = createSignal(true);
      const onClick = rstest.fn();
      const app = await mountLink(
        {
          get to() {
            return to();
          },
          get disabled() {
            return disabled();
          },
          target: '_blank',
          rel: 'noopener',
          preload: 'intent',
          preloadDelay: 0,
          onClick,
        },
        '/store/en/dashboard',
        { native: true },
      );
      const navigate = rstest.spyOn(app.router, 'navigate');
      const preload = rstest.spyOn(app.router, 'preloadRoute');
      try {
        const anchor = app.root.querySelector<HTMLAnchorElement>('a');
        expect(anchor?.hasAttribute('href')).toBe(false);
        expect(anchor?.getAttribute('aria-disabled')).toBe('true');
        expect(anchor?.getAttribute('role')).toBe('link');
        setDisabled(false);
        flush();
        expect(anchor?.getAttribute('href')).toBe(initial);
        expect(anchor?.hasAttribute('aria-disabled')).toBe(false);
        setTo('//catalog.example/next?sort=name#next');
        flush();
        expect(anchor?.getAttribute('href')).toBe(
          '//catalog.example/next?sort=name#next',
        );
        anchor?.focus();
        expect(click(anchor).defaultPrevented).toBe(false);
        expect(onClick).toHaveBeenCalledOnce();
        expect(preload).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
        setDisabled(true);
        flush();
        expect(anchor?.hasAttribute('href')).toBe(false);
        expect(anchor?.getAttribute('aria-disabled')).toBe('true');
      } finally {
        navigate.mockRestore();
        preload.mockRestore();
        app.dispose();
      }
    },
  );

  test.each([
    'javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://catalog.example/id',
    '\n//catalog.example/products',
    '/\\catalog.example/products',
  ])(
    'native unsafe targets do not emit href, preload or navigate: %s',
    async to => {
      const warning = rstest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      const app = await mountLink(
        { to, preload: 'intent', preloadDelay: 0 },
        '/store/en/dashboard',
        { native: true },
      );
      const navigate = rstest.spyOn(app.router, 'navigate');
      const preload = rstest.spyOn(app.router, 'preloadRoute');
      try {
        const anchor = app.root.querySelector<HTMLAnchorElement>('a');
        expect(anchor?.hasAttribute('href')).toBe(false);
        expect(anchor?.hasAttribute('aria-current')).toBe(false);
        anchor?.focus();
        click(anchor);
        expect(navigate).not.toHaveBeenCalled();
        expect(preload).not.toHaveBeenCalled();
        expect(warning).toHaveBeenCalled();
      } finally {
        warning.mockRestore();
        navigate.mockRestore();
        preload.mockRestore();
        app.dispose();
      }
    },
  );

  test.each(['https://catalog.example/products', '/dashboard'])(
    'native reactive targets switch between external and internal navigation: %s',
    async initial => {
      const [to, setTo] = createSignal(initial);
      const [disabled, setDisabled] = createSignal(false);
      const [target, setTarget] = createSignal('_blank');
      const app = await mountLink(
        {
          get to() {
            return to();
          },
          get disabled() {
            return disabled();
          },
          get target() {
            return target();
          },
          activeOptions: { exact: true },
          activeProps: { 'data-active': 'yes' },
          inactiveProps: { 'data-active': 'no' },
        },
        '/store/en/dashboard',
        { native: true },
      );
      const navigate = rstest.spyOn(app.router, 'navigate');
      try {
        const anchor = app.root.querySelector<HTMLAnchorElement>('a');
        setTo('/dashboard');
        setTarget('_self');
        flush();
        expect(anchor?.getAttribute('href')).toBe('/store/en/dashboard');
        expect(anchor?.getAttribute('aria-current')).toBe('page');
        expect(anchor?.getAttribute('data-active')).toBe('yes');
        expect(click(anchor).defaultPrevented).toBe(true);
        await rstest.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
        setTo('//catalog.example/next');
        setTarget('_blank');
        flush();
        expect(anchor?.getAttribute('href')).toBe('//catalog.example/next');
        expect(anchor?.hasAttribute('aria-current')).toBe(false);
        expect(anchor?.getAttribute('data-active')).toBe('no');
        expect(click(anchor).defaultPrevented).toBe(false);
        expect(navigate).toHaveBeenCalledOnce();
        setDisabled(true);
        flush();
        expect(anchor?.hasAttribute('href')).toBe(false);
        expect(anchor?.getAttribute('aria-disabled')).toBe('true');
      } finally {
        navigate.mockRestore();
        app.dispose();
      }
    },
  );

  test('native rewrite-derived unsafe external targets retain their raw protocol guard', async () => {
    const warning = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    const app = await mountLink(
      { to: '/dashboard', preload: 'intent', preloadDelay: 0 },
      '/store/dashboard',
      { native: true, dangerousRewrite: true },
    );
    const navigate = rstest.spyOn(app.router, 'navigate');
    const preload = rstest.spyOn(app.router, 'preloadRoute');
    try {
      const anchor = app.root.querySelector<HTMLAnchorElement>('a');
      expect(anchor?.hasAttribute('href')).toBe(false);
      anchor?.focus();
      click(anchor);
      expect(navigate).not.toHaveBeenCalled();
      expect(preload).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
      navigate.mockRestore();
      preload.mockRestore();
      app.dispose();
    }
  });

  test.each([false, true])(
    'native internal navigation honors blockers (ignoreBlocker: %s)',
    async ignoreBlocker => {
      const app = await mountLink({ ignoreBlocker }, '/store/en/dashboard', {
        native: true,
      });
      const blockerFn = rstest.fn(async () => true);
      const unblock = app.history.block({
        blockerFn,
        enableBeforeUnload: false,
      });
      try {
        expect(click(app.root.querySelector('a')).defaultPrevented).toBe(true);
        if (ignoreBlocker) {
          await rstest.waitFor(() =>
            expect(app.history.location.href).toBe('/store/en/products/red'),
          );
          expect(blockerFn).not.toHaveBeenCalled();
        } else {
          await rstest.waitFor(() => expect(blockerFn).toHaveBeenCalledOnce());
          expect(app.history.location.href).toBe('/store/en/dashboard');
          expect(app.router.state.location.pathname).toBe('/dashboard');
        }
      } finally {
        unblock();
        app.dispose();
      }
    },
  );

  test.each([false, true])(
    'native document navigation uses the selected public language URL (replace: %s)',
    async replace => {
      const app = await mountLink({
        reloadDocument: true,
        replace,
        preload: 'intent',
        preloadDelay: 0,
        search: { sort: 'price' },
        hash: 'details',
      });
      const documentNavigation = replace
        ? rstest.spyOn(window.location, 'replace').mockImplementation(() => {})
        : rstest
            .spyOn(window.location, 'href', 'set')
            .mockImplementation(() => {});
      const preload = rstest.spyOn(app.router, 'preloadRoute');
      try {
        const anchor = app.root.querySelector<HTMLAnchorElement>('a');
        const expected = '/store/cs/produkty/red?sort=price#details';
        expect(anchor?.getAttribute('href')).toBe(expected);
        anchor?.focus();
        expect(preload).not.toHaveBeenCalled();
        expect(click(anchor).defaultPrevented).toBe(true);
        await rstest.waitFor(() =>
          expect(documentNavigation).toHaveBeenCalledWith(expected),
        );
        expect(app.history.location.href).toBe('/store/en/dashboard');
        expect(app.instance.language).toBe('en');
      } finally {
        documentNavigation.mockRestore();
        preload.mockRestore();
        app.dispose();
      }
    },
  );
});
