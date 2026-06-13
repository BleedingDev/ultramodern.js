import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import type {
  Fetcher,
  FetcherState,
  FetcherSubmitOptions,
  FormProps,
  LinkProps,
  NavLinkProps,
  PrefetchBehavior,
  SubmitOptions,
} from '../../src/exports/tanstack-router';
import {
  Form,
  Link,
  NavLink,
  Outlet,
  RouteActionResponseError,
  useFetcher,
} from '../../src/exports/tanstack-router';

// Compile-time assertion that every restored type name resolves on the
// deprecated alias (swc strips types, tsc/tsgo checks them).
export type _AssertRestoredTypes = [
  Fetcher,
  FetcherState,
  FetcherSubmitOptions,
  FormProps,
  LinkProps,
  NavLinkProps,
  PrefetchBehavior,
  SubmitOptions,
];

const COMPAT_BINDINGS_SLOT = Symbol.for(
  '@modern-js/plugin-tanstack:runtime-compat-bindings',
);
const runtimePackageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

type SlotHost = Record<symbol, unknown>;

class FakeRouteActionResponseError extends Error {
  readonly response: unknown;
  readonly data: unknown;

  constructor(response: unknown, data: unknown) {
    super('fake route action response error');
    this.name = 'RouteActionResponseError';
    this.response = response;
    this.data = data;
  }
}

const fakeFetcher = {
  state: 'idle',
  data: undefined,
  error: undefined,
  Form: () => null,
  submit: async () => undefined,
};

const installFakeBindings = () => {
  (globalThis as SlotHost)[COMPAT_BINDINGS_SLOT] = {
    Form: (props: Record<string, unknown>) => (
      <form data-fake="form" action={props.action as string} />
    ),
    Link: (props: Record<string, unknown>) => (
      <a data-fake="link" href={props.to as string}>
        fake link
      </a>
    ),
    NavLink: (props: Record<string, unknown>) => (
      <a data-fake="nav-link" href={props.to as string}>
        fake nav link
      </a>
    ),
    Outlet: () => <div data-fake="outlet" />,
    RouteActionResponseError: FakeRouteActionResponseError,
    useFetcher: () => fakeFetcher,
  };
};

describe('@modern-js/runtime/tanstack-router deprecated alias', () => {
  beforeEach(() => {
    delete (globalThis as SlotHost)[COMPAT_BINDINGS_SLOT];
  });

  afterAll(() => {
    delete (globalThis as SlotHost)[COMPAT_BINDINGS_SLOT];
  });

  it('package manifest exposes the router subpath used by app fixtures', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(runtimePackageRoot, 'package.json'), 'utf8'),
    ) as {
      exports: Record<string, unknown>;
      typesVersions?: Record<string, Record<string, string[]>>;
    };

    expect(packageJson.exports['./router']).toEqual({
      types: './dist/types/router/index.d.ts',
      'react-server': {
        types: './dist/types/router/runtime/rsc.d.ts',
        default: './dist/esm/router/runtime/rsc.mjs',
      },
      default: './dist/esm/router/index.mjs',
    });
    expect(packageJson.typesVersions?.['*']?.router).toEqual([
      './dist/types/router/index.d.ts',
    ]);
  });

  it('exports the restored Modern.js bindings without importing TanStack Router', () => {
    expect(typeof Form).toBe('function');
    expect(typeof Link).toBe('function');
    expect(typeof NavLink).toBe('function');
    expect(typeof Outlet).toBe('function');
    expect(typeof useFetcher).toBe('function');
    expect(RouteActionResponseError).toBeDefined();

    const source = readFileSync(
      path.join(runtimePackageRoot, 'src/exports/tanstack-router.ts'),
      'utf8',
    );
    expect(source).not.toContain('@tanstack/react-router');
  });

  it('delegates to the bindings registered by @modern-js/plugin-tanstack/runtime', () => {
    installFakeBindings();

    expect(renderToString(<Link to="/about" />)).toContain('data-fake="link"');
    expect(renderToString(<Link to="/about" />)).toContain('href="/about"');
    expect(renderToString(<NavLink to="/nav" />)).toContain(
      'data-fake="nav-link"',
    );
    expect(renderToString(<Outlet />)).toContain('data-fake="outlet"');
    expect(renderToString(<Form action="/submit" />)).toContain(
      'data-fake="form"',
    );
    expect(renderToString(<Form action="/submit" />)).toContain(
      'action="/submit"',
    );

    let observedFetcher: unknown;
    const FetcherProbe = () => {
      observedFetcher = useFetcher();
      return null;
    };
    renderToString(<FetcherProbe />);
    expect(observedFetcher).toBe(fakeFetcher);
  });

  it('preserves RouteActionResponseError class identity across both import paths', () => {
    installFakeBindings();

    const viaAlias = new RouteActionResponseError(
      { status: 500 } as unknown as Response,
      { ok: false },
    );
    expect(viaAlias).toBeInstanceOf(FakeRouteActionResponseError);
    expect(viaAlias instanceof RouteActionResponseError).toBe(true);
    expect(viaAlias.data).toEqual({ ok: false });

    // Errors thrown by the plugin itself satisfy alias instanceof checks.
    const viaPlugin = new FakeRouteActionResponseError({ status: 422 }, null);
    expect(viaPlugin instanceof RouteActionResponseError).toBe(true);

    expect(RouteActionResponseError.name).toBe('FakeRouteActionResponseError');
    expect(new Error('nope') instanceof RouteActionResponseError).toBe(false);
  });

  it('throws an actionable error naming @modern-js/plugin-tanstack when the plugin runtime was never imported', () => {
    const expectedMessage = /@modern-js\/plugin-tanstack/;

    expect(() => renderToString(<Form action="/x" />)).toThrow(expectedMessage);
    expect(() => renderToString(<Link to="/x" />)).toThrow(expectedMessage);
    expect(() => renderToString(<NavLink to="/x" />)).toThrow(expectedMessage);
    expect(() => renderToString(<Outlet />)).toThrow(expectedMessage);
    expect(() => useFetcher()).toThrow(expectedMessage);
    expect(
      () =>
        new RouteActionResponseError(
          { status: 500 } as unknown as Response,
          null,
        ),
    ).toThrow(expectedMessage);

    // instanceof stays graceful: no instance can exist before registration.
    expect(new Error('nope') instanceof RouteActionResponseError).toBe(false);
  });
});
