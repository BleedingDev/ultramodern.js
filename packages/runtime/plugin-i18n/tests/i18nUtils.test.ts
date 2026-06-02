import { describe, expect, test } from '@rstest/core';
import type { I18nInstance } from '../src/runtime/i18n';
import { DEFAULT_I18NEXT_BACKEND_OPTIONS as NODE_DEFAULT_I18NEXT_BACKEND_OPTIONS } from '../src/runtime/i18n/backend/defaults.node';
import { initializeI18nInstance } from '../src/runtime/i18n/utils';

function createBackendI18nInstance(): I18nInstance {
  return {
    language: 'en',
    isInitialized: false,
    init: async () => undefined,
    use: () => {},
    options: {},
    store: {
      data: {},
    },
  };
}

describe('i18n runtime utils', () => {
  test('uses the generated public locale directory for node fs backend defaults', () => {
    expect(NODE_DEFAULT_I18NEXT_BACKEND_OPTIONS.loadPath).toBe(
      './config/public/locales/{{lng}}/{{ns}}.json',
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
