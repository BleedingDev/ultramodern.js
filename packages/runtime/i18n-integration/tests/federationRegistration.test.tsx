import { runtime } from '@modern-js/plugin/runtime';
import { describe, expect, test } from '@rstest/core';
import { FederatedI18nBoundary } from '../src/federation/boundary';
import { registerFederatedI18nBoundary } from '../src/federation/registration';
import { i18nPlugin } from '../src/runtime';

const marker = { name: 'i18n.FederatedI18nBoundary' };
const Fallback = () => null;

describe('federation registration in the combined runtime', () => {
  test('registers using only the component resolver', () => {
    const registered = runtime.run({
      config: {},
      plugins: [
        {
          name: 'test-federation-registration',
          setup(api) {
            registerFederatedI18nBoundary({
              resolveComponent: api.resolveComponent,
            });
          },
        },
      ],
    }).runtimeContext;

    expect(registered.hooks.resolveComponent.call(Fallback, marker)).toBe(
      FederatedI18nBoundary,
    );
    expect(
      registered.hooks.resolveComponent.call(Fallback, { name: 'other' }),
    ).toBe(Fallback);
  });

  test('keeps registrations isolated between runtime instances', () => {
    const registered = runtime.run({
      config: {},
      plugins: [i18nPlugin({})],
    }).runtimeContext;
    const nativeOnly = runtime.run({ config: {}, plugins: [] }).runtimeContext;
    expect(nativeOnly.hooks.resolveComponent.call(Fallback, marker)).toBe(
      Fallback,
    );
    expect(registered.hooks.resolveComponent.call(Fallback, marker)).toBe(
      FederatedI18nBoundary,
    );
  });
});
