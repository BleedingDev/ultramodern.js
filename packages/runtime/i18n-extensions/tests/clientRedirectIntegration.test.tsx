import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useClientSideRedirect } from '../../plugin-i18n/src/runtime/hooks';

const navigate = rstest.fn(async () => undefined);
let location = {
  pathname: '/cs/about',
  search: '?from=test',
  hash: '#section',
};

rstest.mock('../../plugin-i18n/src/runtime/routerAdapter', () => ({
  useI18nRouterAdapter: () => ({
    hasRouter: true,
    location,
    navigate,
  }),
}));

test('canonicalizes successive prefixed routes in one mounted provider', async () => {
  const previousTarget = process.env.MODERN_TARGET;
  process.env.MODERN_TARGET = 'browser';
  const instance = {
    language: 'cs',
    isInitialized: true,
  } as Parameters<typeof useClientSideRedirect>[0];
  const localisedUrls = {
    '/about': { en: '/about', cs: '/o-nas' },
    '/terms-of-service': {
      en: '/terms-of-service',
      cs: '/podminky-pouzivani',
    },
  };
  const Harness = () => {
    useClientSideRedirect(
      instance,
      true,
      ['en', 'cs'],
      'en',
      undefined,
      localisedUrls,
    );
    return null;
  };
  const container = document.createElement('div');
  const root = createRoot(container);

  try {
    window.history.replaceState(null, '', '/cs/about?from=test#section');
    await act(async () => root.render(<Harness />));
    expect(navigate).toHaveBeenLastCalledWith('/cs/o-nas?from=test#section', {
      replace: true,
    });

    location = {
      pathname: '/cs/terms-of-service',
      search: '',
      hash: '',
    };
    window.history.replaceState(null, '', '/cs/terms-of-service');
    await act(async () => root.render(<Harness />));
    expect(navigate).toHaveBeenLastCalledWith('/cs/podminky-pouzivani', {
      replace: true,
    });
    expect(navigate).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    if (previousTarget === undefined) {
      delete process.env.MODERN_TARGET;
    } else {
      process.env.MODERN_TARGET = previousTarget;
    }
  }
});
