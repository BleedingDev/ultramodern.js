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
    on() {},
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
});
