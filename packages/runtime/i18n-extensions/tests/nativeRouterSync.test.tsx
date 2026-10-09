import { createNativeI18n } from '../src/native';

type BeforeLoad = (event: {
  toLocation: { publicHref: string; maskedLocation?: { publicHref: string } };
}) => void;

function fakeRouter() {
  const listeners: BeforeLoad[] = [];
  return {
    subscribe(_event: 'onBeforeLoad', listener: BeforeLoad) {
      listeners.push(listener);
      return () => {};
    },
    navigate(publicHref: string) {
      for (const listener of listeners)
        listener({ toLocation: { publicHref } });
    },
  };
}

function fakeInstance(changeLanguage: (language: string) => Promise<unknown>) {
  return {
    language: 'en',
    changeLanguage: rstest.fn(changeLanguage),
    on: rstest.fn(),
    off: rstest.fn(),
  };
}

function sync(router: ReturnType<typeof fakeRouter>, instance: object) {
  createNativeI18n(
    { languages: ['en', 'cs'], fallbackLanguage: 'en', basePath: '/' },
    {},
  ).syncWithRouter(router, instance as never);
}

describe('native router language synchronization', () => {
  afterEach(() => {
    rstest.useRealTimers();
    rstest.restoreAllMocks();
  });

  it('switches the instance to the language of the navigated URL', async () => {
    const router = fakeRouter();
    const instance = fakeInstance(async language => {
      instance.language = language;
    });
    sync(router, instance);
    router.navigate('/cs/items');
    await Promise.resolve();
    expect(instance.changeLanguage).toHaveBeenCalledExactlyOnceWith('cs');
    expect(instance.language).toBe('cs');
    router.navigate('/cs/other');
    expect(instance.changeLanguage).toHaveBeenCalledTimes(1);
  });

  it('retries a rejected switch and reloads once retries are exhausted', async () => {
    rstest.useFakeTimers();
    const reload = rstest
      .spyOn(window.location, 'reload')
      .mockImplementation(() => {});
    const router = fakeRouter();
    const instance = fakeInstance(() =>
      Promise.reject(new Error('backend failed')),
    );
    sync(router, instance);
    router.navigate('/cs/items');
    await rstest.runAllTimersAsync();
    expect(instance.changeLanguage.mock.calls.length).toBeGreaterThan(1);
    expect(instance.language).toBe('en');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('detaches the router listener and retries when stopped', async () => {
    const unsubscribe = rstest.fn();
    const router = {
      subscribe: rstest.fn(() => unsubscribe),
    };
    const instance = fakeInstance(async () => {});
    const stop = createNativeI18n(
      { languages: ['en', 'cs'], fallbackLanguage: 'en', basePath: '/' },
      {},
    ).syncWithRouter(router, instance as never);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('persists every language change with or without a router, until stopped', () => {
    const instance = fakeInstance(async () => {});
    const stop = createNativeI18n(
      {
        languages: ['en', 'cs'],
        fallbackLanguage: 'en',
        basePath: '/',
        detection: { lookupCookie: 'lang' },
      },
      {},
    ).persist!(instance as never);
    const [event, persist] = instance.on.mock.calls[0];
    expect(event).toBe('languageChanged');
    persist('cs');
    expect(document.documentElement.lang).toBe('cs');
    expect(document.cookie).toContain('lang=cs');
    stop();
    expect(instance.off).toHaveBeenCalledWith('languageChanged', persist);
  });

  it('persists the language the client started in over a stale cookie', () => {
    // biome-ignore lint/suspicious/noDocumentCookie: the test seeds the detector cookie.
    document.cookie = 'lang=en; path=/';
    document.documentElement.lang = 'en';
    const instance = { ...fakeInstance(async () => {}), language: 'cs' };
    createNativeI18n(
      {
        languages: ['en', 'cs'],
        fallbackLanguage: 'en',
        basePath: '/',
        detection: { lookupCookie: 'lang' },
      },
      {},
    ).persist!(instance as never);
    expect(document.documentElement.lang).toBe('cs');
    expect(document.cookie).toContain('lang=cs');
    expect(document.cookie).not.toContain('lang=en');
  });
});
