import { describe, expect, test } from '@rstest/core';
import type { I18nInstance } from '../src/runtime/i18n';
import {
  DEFAULT_I18NEXT_BACKEND_OPTIONS as NODE_DEFAULT_I18NEXT_BACKEND_OPTIONS,
  resolveDefaultLocalesDir,
} from '../src/runtime/i18n/backend/defaults.node';
import {
  FsBackendWithSave,
  resolveFsBackendConstructor,
} from '../src/runtime/i18n/backend/middleware.node';
import { initializeI18nInstance } from '../src/runtime/i18n/utils';

function createBackendI18nInstance(): I18nInstance {
  return {
    language: 'en',
    isInitialized: false,
    init: async () => undefined,
    use: () => {},
    t: (key: string | string[]) => (Array.isArray(key) ? key[0] : key),
    options: {},
    store: {
      data: {},
    },
  };
}

describe('i18n runtime utils', () => {
  test('normalizes node fs backend CJS and ESM namespace shapes', () => {
    class FakeBackend {}

    expect(resolveFsBackendConstructor(FakeBackend)).toBe(FakeBackend);
    expect(resolveFsBackendConstructor({ default: FakeBackend })).toBe(
      FakeBackend,
    );
    expect(resolveFsBackendConstructor({ 'module.exports': FakeBackend })).toBe(
      FakeBackend,
    );
    expect(
      resolveFsBackendConstructor({ default: { default: FakeBackend } }),
    ).toBe(FakeBackend);
    expect(
      resolveFsBackendConstructor({
        default: { 'module.exports': FakeBackend },
      }),
    ).toBe(FakeBackend);
  });

  test('node fs backend wrapper extends a resolved constructor', () => {
    const backend = new FsBackendWithSave({}, {}, {}) as {
      type?: string;
      save: (language: string, namespace: string, data: unknown) => void;
    };

    expect(backend.type).toBe('backend');
    expect(() => backend.save('en', 'translation', {})).not.toThrow();
  });

  test('node fs backend defaults follow the detected locales directory', () => {
    // The default must match whichever conventional root exists at runtime
    // (./locales first, then ./config/public/locales), mirroring the CLI
    // plugin's detectLocalesDirectory. Detailed precedence cases live in
    // tests/backendDefaults.test.ts.
    expect(NODE_DEFAULT_I18NEXT_BACKEND_OPTIONS.loadPath).toBe(
      `${resolveDefaultLocalesDir()}/{{lng}}/{{ns}}.json`,
    );
  });

  test('does not poll for backend resources after init', async () => {
    const i18nInstance = createBackendI18nInstance();
    const init = rstest.fn(async () => {
      i18nInstance.isInitialized = true;
    });
    i18nInstance.init = init as I18nInstance['init'];
    const setTimeoutSpy = rstest.spyOn(globalThis, 'setTimeout');

    await initializeI18nInstance(
      i18nInstance,
      'cs',
      'en',
      ['en', 'cs'],
      {},
      {
        enabled: true,
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
      {},
    );

    expect(init).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    setTimeoutSpy.mockRestore();
  });
});
