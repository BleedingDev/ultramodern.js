import { describe, expect, it } from '@rstest/core';
import {
  immutableRendererRouterBindings,
  type RendererName,
  type RendererRouterBinding,
  type RendererRouterBindings,
  type RouterPackageBinding,
  validateRendererRouterBindings,
} from '../../src/backend-federation-contract';

const reactRouter: RouterPackageBinding = {
  framework: 'react-router',
  name: 'react-router-dom',
  version: '7.18.2',
  coreName: 'react-router',
  coreVersion: '7.18.2',
};
const tanstack: RouterPackageBinding = {
  framework: 'tanstack',
  name: '@tanstack/react-router',
  version: '1.171.34',
  coreName: '@tanstack/router-core',
  coreVersion: '1.171.15',
};
const solid: RouterPackageBinding = {
  framework: 'solid',
  name: '@tanstack/solid-router',
  version: '2.0.0-rc.8',
  coreName: '@tanstack/router-core',
  coreVersion: '1.171.15',
};
const octane: RouterPackageBinding = {
  framework: 'octane',
  name: '@octanejs/tanstack-router',
  version: '0.1.60',
  coreName: '@tanstack/router-core',
  coreVersion: '1.171.34',
};

const owned = (provider = reactRouter): RendererRouterBinding => ({
  owner: '@modern-js/plugin-router',
  evidence: 'owned-default',
  defaultProvider: provider,
  providers: [provider],
});
const registry = (): RendererRouterBinding => ({
  owner: '@modern-js/plugin-tanstack',
  evidence: 'provider-registry',
  defaultProvider: reactRouter,
  providers: [reactRouter, tanstack],
});

describe('per-entry renderer router bindings', () => {
  it.each([
    { renderer: 'react', provider: reactRouter },
    { renderer: 'react', provider: tanstack },
    { renderer: 'solid', provider: solid },
    { renderer: 'octane', provider: octane },
  ] satisfies {
    renderer: RendererName;
    provider: RouterPackageBinding;
  }[])('accepts $provider.framework providers for the known $renderer renderer', ({
    renderer,
    provider,
  }) => {
    expect(
      validateRendererRouterBindings(
        { main: owned(provider) },
        ['main'],
        'routerBindings',
        renderer,
      ),
    ).toEqual({ ok: true, errors: [] });
  });

  it.each([
    { renderer: 'react', provider: solid },
    { renderer: 'react', provider: octane },
    { renderer: 'solid', provider: reactRouter },
    { renderer: 'solid', provider: tanstack },
    { renderer: 'solid', provider: octane },
    { renderer: 'octane', provider: reactRouter },
    { renderer: 'octane', provider: tanstack },
    { renderer: 'octane', provider: solid },
  ] satisfies {
    renderer: RendererName;
    provider: RouterPackageBinding;
  }[])('rejects $provider.framework providers for the known $renderer renderer', ({
    renderer,
    provider,
  }) => {
    const bindings = { main: owned(provider) };
    expect(validateRendererRouterBindings(bindings, ['main']).ok).toBe(true);
    const result = validateRendererRouterBindings(
      bindings,
      ['main'],
      'routerBindings',
      renderer,
    );
    expect(result.ok).toBe(false);
    for (const providerPath of ['defaultProvider', 'providers[0]']) {
      expect(result.errors).toContainEqual({
        path: `routerBindings.main.${providerPath}.framework`,
        message: `must be supported by the "${renderer}" renderer.`,
      });
    }
  });

  it('accepts both React router providers in an explicit React provider registry', () => {
    expect(
      validateRendererRouterBindings(
        { main: registry(), files: owned(tanstack) },
        ['main', 'files'],
        'routerBindings',
        'react',
      ),
    ).toEqual({ ok: true, errors: [] });
  });

  it('enforces renderer authority on nonprimary entries too', () => {
    const result = validateRendererRouterBindings(
      { main: owned(solid), secondary: owned(octane) },
      ['main', 'secondary'],
      'routerBindings',
      'solid',
    );
    expect(result.errors).toContainEqual({
      path: 'routerBindings.secondary.defaultProvider.framework',
      message: 'must be supported by the "solid" renderer.',
    });
    expect(
      result.errors.some(error =>
        error.path.startsWith('routerBindings.main.'),
      ),
    ).toBe(false);
  });

  it('rejects foreign available providers in a React registry without changing its default', () => {
    const result = validateRendererRouterBindings(
      { main: { ...registry(), providers: [reactRouter, tanstack, solid] } },
      ['main'],
      'routerBindings',
      'react',
    );
    expect(result.errors).toContainEqual({
      path: 'routerBindings.main.providers[2].framework',
      message: 'must be supported by the "react" renderer.',
    });
  });

  it('freezes an isolated snapshot of every binding and package tuple', () => {
    const defaultProvider = { ...reactRouter };
    const registeredProvider = { ...tanstack };
    const ownedProvider = { ...solid };
    const bindings = {
      main: {
        owner: '@modern-js/plugin-tanstack',
        evidence: 'provider-registry',
        defaultProvider,
        providers: [defaultProvider, registeredProvider],
      },
      constructor: {
        owner: '@modern-js/renderer-solid',
        evidence: 'file-routes',
        defaultProvider: ownedProvider,
        providers: [ownedProvider],
      },
      '商店/结算': {
        owner: '@modern-js/plugin-router',
        evidence: 'owned-default',
        defaultProvider,
        providers: [defaultProvider],
      },
    } satisfies RendererRouterBindings;
    const before = JSON.stringify(bindings);
    const snapshot = immutableRendererRouterBindings(bindings);

    expect(snapshot).toEqual(bindings);
    expect(snapshot).not.toBe(bindings);
    expect(Object.isFrozen(snapshot)).toBe(true);
    for (const [entryName, inputBinding] of Object.entries(bindings)) {
      const binding = snapshot[entryName];
      expect(binding).not.toBe(inputBinding);
      expect(Object.isFrozen(binding)).toBe(true);
      expect(binding.defaultProvider).not.toBe(inputBinding.defaultProvider);
      expect(Object.isFrozen(binding.defaultProvider)).toBe(true);
      expect(binding.providers).not.toBe(inputBinding.providers);
      expect(Object.isFrozen(binding.providers)).toBe(true);
      for (let index = 0; index < binding.providers.length; index++) {
        expect(binding.providers[index]).not.toBe(
          inputBinding.providers[index],
        );
        expect(Object.isFrozen(binding.providers[index])).toBe(true);
      }
    }
    expect(Object.hasOwn(snapshot, 'constructor')).toBe(true);
    expect(Reflect.set(snapshot.main, 'owner', 'changed')).toBe(false);
    expect(
      Reflect.set(snapshot.main.defaultProvider, 'version', '99.0.0'),
    ).toBe(false);
    expect(Reflect.set(snapshot.main.providers, '0', registeredProvider)).toBe(
      false,
    );
    expect(
      Reflect.set(snapshot.main.providers[1], 'coreVersion', '99.0.0'),
    ).toBe(false);
    expect(Reflect.deleteProperty(snapshot, 'main')).toBe(false);

    bindings.main.owner = 'changed';
    defaultProvider.version = '99.0.0';
    registeredProvider.coreVersion = '99.0.0';
    ownedProvider.name = 'changed';
    bindings.main.providers.push(ownedProvider);
    Reflect.deleteProperty(bindings, 'main');
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(
      validateRendererRouterBindings(snapshot, Object.keys(snapshot)).ok,
    ).toBe(true);
  });

  it('accepts each positive evidence variant independently per entry', () => {
    const bindings = {
      default: owned(),
      files: {
        ...owned(solid),
        owner: '@modern-js/renderer-solid',
        evidence: 'file-routes',
      },
      custom: registry(),
      octane: {
        ...owned(octane),
        owner: '@modern-js/renderer-octane',
        evidence: 'file-routes',
      },
    };
    expect(
      validateRendererRouterBindings(bindings, Object.keys(bindings)),
    ).toEqual({ ok: true, errors: [] });
  });

  it('does not infer provider selection or mutate recorded evidence', () => {
    const binding = registry();
    const value = { main: binding };
    const before = JSON.stringify(value);
    expect(validateRendererRouterBindings(value, ['main']).ok).toBe(true);
    expect(JSON.stringify(value)).toBe(before);
    expect(Object.hasOwn(binding, 'selectedProvider')).toBe(false);
    expect(binding.defaultProvider.framework).toBe('react-router');
  });

  it('retains Unicode, nested, and own prototype-named Modern entry identities', () => {
    const bindings = {
      '商店/结算': owned(solid),
      'catalog/detail': owned(),
      constructor: owned(),
      prototype: owned(),
    };
    expect(
      validateRendererRouterBindings(bindings, Object.keys(bindings)).ok,
    ).toBe(true);
  });

  it('accepts an empty record only when no entries are expected', () => {
    expect(validateRendererRouterBindings({}, []).ok).toBe(true);
    expect(validateRendererRouterBindings({}, ['main']).errors).toContainEqual({
      path: 'routerBindings.main',
      message: 'is required for the expected entry.',
    });
  });

  it('rejects missing and additional entry evidence in the same record', () => {
    const result = validateRendererRouterBindings({ secondary: owned() }, [
      'main',
    ]);
    expect(result.errors).toContainEqual({
      path: 'routerBindings.main',
      message: 'is required for the expected entry.',
    });
    expect(result.errors).toContainEqual({
      path: 'routerBindings.secondary',
      message: 'is not an expected entry.',
    });
  });

  it('does not satisfy a missing entry through Object.prototype', () => {
    expect(
      validateRendererRouterBindings({}, ['constructor']).errors,
    ).toContainEqual({
      path: 'routerBindings.constructor',
      message: 'is required for the expected entry.',
    });
  });

  it('accepts a null-prototype dictionary with explicit own entries', () => {
    const bindings = Object.assign(Object.create(null), { main: owned() });
    expect(validateRendererRouterBindings(bindings, ['main']).ok).toBe(true);
  });

  it('rejects an own non-enumerable entry that JSON and snapshot iteration would drop', () => {
    const bindings = Object.defineProperty({}, 'main', {
      value: owned(),
      enumerable: false,
    });
    expect(Object.hasOwn(bindings, 'main')).toBe(true);
    expect(JSON.stringify(bindings)).toBe('{}');
    expect(validateRendererRouterBindings(bindings, ['main'])).toEqual({
      ok: false,
      errors: [
        {
          path: 'routerBindings.main',
          message: 'must be an enumerable data property.',
        },
      ],
    });
  });

  it.each([
    true,
    false,
  ])('rejects accessor entry properties with enumerable=%s without invoking getters', enumerable => {
    let getterExecutions = 0;
    const bindings = Object.defineProperty({}, 'main', {
      enumerable,
      get() {
        getterExecutions++;
        throw new Error('entry getter must not run');
      },
    });
    expect(validateRendererRouterBindings(bindings, ['main'])).toEqual({
      ok: false,
      errors: [
        {
          path: 'routerBindings.main',
          message: 'must be an enumerable data property.',
        },
      ],
    });
    expect(getterExecutions).toBe(0);
  });

  it('rejects own symbol entries that disappear during JSON serialization', () => {
    const bindings = { main: owned(), [Symbol('hidden-entry')]: owned(solid) };
    expect(JSON.stringify(bindings)).toBe(
      JSON.stringify({ main: bindings.main }),
    );
    expect(
      validateRendererRouterBindings(bindings, ['main']).errors,
    ).toContainEqual({
      path: 'routerBindings.Symbol(hidden-entry)',
      message: 'must be a non-empty trimmed entry name other than "__proto__".',
    });
  });

  it('retains every validated data entry through immutable snapshot and JSON roundtrip', () => {
    const bindings = {
      main: owned(),
      constructor: owned(solid),
      '商店/结算': owned(octane),
      custom: registry(),
    };
    const entries = Object.keys(bindings);
    expect(validateRendererRouterBindings(bindings, entries).ok).toBe(true);
    const snapshot = immutableRendererRouterBindings(bindings);
    const roundtrip: unknown = JSON.parse(JSON.stringify(snapshot));
    expect(snapshot).toEqual(bindings);
    expect(roundtrip).toEqual(bindings);
    expect(validateRendererRouterBindings(roundtrip, entries).ok).toBe(true);
  });

  it.each([
    '',
    ' main',
    'main ',
    '__proto__',
  ])('rejects unsafe or noncanonical entry %s', entry => {
    const bindings = Object.fromEntries([[entry, owned()]]);
    expect(validateRendererRouterBindings(bindings, [entry]).ok).toBe(false);
  });

  it('rejects duplicate expected entry names', () => {
    expect(
      validateRendererRouterBindings({ main: owned() }, ['main', 'main'])
        .errors,
    ).toContainEqual({
      path: 'routerBindings',
      message: 'expected entry "main" must be unique.',
    });
  });

  it.each([
    null,
    undefined,
    [],
    'main',
    123,
    new Date(),
  ])('rejects a non-record binding projection %s', value => {
    expect(validateRendererRouterBindings(value, ['main']).ok).toBe(false);
  });

  it.each([
    'selectedProvider',
    'routerType',
    'available',
    'legacyRouter',
  ])('rejects unknown entry field %s', field => {
    expect(
      validateRendererRouterBindings(
        { main: { ...registry(), [field]: 'tanstack' } },
        ['main'],
      ).errors,
    ).toContainEqual({
      path: `routerBindings.main.${field}`,
      message: 'is not a supported field.',
    });
  });

  it.each([
    'owner',
    'evidence',
    'defaultProvider',
    'providers',
  ])('requires explicit own binding field %s', field => {
    const binding: Record<string, unknown> = { ...owned() };
    delete binding[field];
    expect(
      validateRendererRouterBindings({ main: binding }, ['main']).errors,
    ).toContainEqual({
      path: `routerBindings.main.${field}`,
      message: 'is required.',
    });
  });

  it.each([
    '',
    ' owner',
    'owner ',
    undefined,
    123,
  ])('requires a canonical owner %s', owner => {
    expect(
      validateRendererRouterBindings({ main: { ...owned(), owner } }, ['main'])
        .ok,
    ).toBe(false);
  });

  it.each([
    'selected',
    'plugin-presence',
    ' provider-registry',
    undefined,
  ])('rejects unsupported provenance %s', evidence => {
    expect(
      validateRendererRouterBindings({ main: { ...owned(), evidence } }, [
        'main',
      ]).ok,
    ).toBe(false);
  });

  it.each([
    'owned-default',
    'file-routes',
  ] as const)('%s attests only its one owned provider', evidence => {
    expect(
      validateRendererRouterBindings({ main: { ...registry(), evidence } }, [
        'main',
      ]).errors,
    ).toContainEqual({
      path: 'routerBindings.main.providers',
      message: 'must contain only the owned default provider.',
    });
  });

  it('keeps the actual React Router default when TanStack is registered', () => {
    expect(
      validateRendererRouterBindings(
        { main: { ...registry(), defaultProvider: tanstack } },
        ['main'],
      ).errors,
    ).toContainEqual({
      path: 'routerBindings.main.defaultProvider.framework',
      message: 'must be "react-router" for provider-registry evidence.',
    });
  });

  it.each([
    'framework',
    'name',
    'version',
    'coreName',
    'coreVersion',
  ])('matches default provider %s to its complete registered package tuple', field => {
    const changed = {
      ...reactRouter,
      [field]:
        field === 'framework'
          ? 'tanstack'
          : field.includes('Version') || field === 'version'
            ? '9.0.0'
            : 'another-package',
    };
    expect(
      validateRendererRouterBindings(
        { main: { ...owned(), defaultProvider: changed } },
        ['main'],
      ).errors,
    ).toContainEqual({
      path: 'routerBindings.main.defaultProvider',
      message: 'must exactly match a registered provider.',
    });
  });

  it('rejects duplicate provider frameworks even when their versions differ', () => {
    expect(
      validateRendererRouterBindings(
        {
          main: {
            ...registry(),
            providers: [
              reactRouter,
              tanstack,
              { ...tanstack, version: '1.171.35' },
            ],
          },
        },
        ['main'],
      ).errors,
    ).toContainEqual({
      path: 'routerBindings.main.providers[2].framework',
      message: 'must be unique within the entry.',
    });
  });

  it.each([
    'latest',
    '^7.18.2',
    'workspace:*',
    '7',
    '7.18',
    '07.18.2',
    '7.18.2-01',
    ' 7.18.2 ',
  ])('rejects non-exact package and core version %s', version => {
    for (const field of ['version', 'coreVersion']) {
      const provider = { ...reactRouter, [field]: version };
      expect(
        validateRendererRouterBindings({ main: owned(provider) }, ['main'])
          .errors,
      ).toContainEqual({
        path: `routerBindings.main.defaultProvider.${field}`,
        message: 'must be an exact version.',
      });
    }
  });

  it('accepts exact prerelease and build versions without pinning one release', () => {
    const provider = {
      ...solid,
      version: '2.0.0-rc.99+candidate.2',
      coreVersion: '99.0.0+build.7',
    };
    expect(
      validateRendererRouterBindings({ main: owned(provider) }, ['main']).ok,
    ).toBe(true);
  });

  it.each([
    'name',
    'coreName',
  ])('requires canonical %s package identity', field => {
    const provider = { ...reactRouter, [field]: ' package ' };
    expect(
      validateRendererRouterBindings({ main: owned(provider) }, ['main']).ok,
    ).toBe(false);
  });

  it('rejects an unsupported framework and unknown package tuple fields', () => {
    const provider = { ...reactRouter, framework: 'inferred', selected: true };
    const result = validateRendererRouterBindings(
      {
        main: {
          ...owned(),
          defaultProvider: provider,
          providers: [provider],
        },
      },
      ['main'],
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      path: 'routerBindings.main.defaultProvider.selected',
      message: 'is not a supported field.',
    });
  });

  it.each([
    'framework',
    'name',
    'version',
    'coreName',
    'coreVersion',
  ])('requires own tuple field %s', field => {
    const provider: Record<string, unknown> = { ...reactRouter };
    delete provider[field];
    expect(
      validateRendererRouterBindings(
        {
          main: {
            ...owned(),
            defaultProvider: provider,
            providers: [provider],
          },
        },
        ['main'],
      ).errors,
    ).toContainEqual({
      path: `routerBindings.main.defaultProvider.${field}`,
      message: 'is required.',
    });
  });

  it.each([
    undefined,
    null,
    {},
    [],
    [undefined],
    new Array(1),
  ])('rejects a missing, malformed, or sparse provider list %s', providers => {
    expect(
      validateRendererRouterBindings({ main: { ...owned(), providers } }, [
        'main',
      ]).ok,
    ).toBe(false);
  });

  it('uses the caller path for artifact integration errors', () => {
    expect(
      validateRendererRouterBindings(
        {},
        ['main'],
        'artifact.surfaces.ui.routerBindings',
      ).errors,
    ).toContainEqual({
      path: 'artifact.surfaces.ui.routerBindings.main',
      message: 'is required for the expected entry.',
    });
  });
});
