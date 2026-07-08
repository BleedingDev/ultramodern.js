import { isNotFound, isRedirect } from '@tanstack/react-router';
import {
  createRouteStaticData,
  isAbsoluteUrl,
  mapSplatParamsForModernLoader,
  modernLoaderToTanstack,
  throwTanstackRedirect,
} from '../../src/runtime/loaderBridge';

type RedirectLike = {
  options?: {
    href?: string;
    to?: string;
  };
};

function catchThrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the function to throw');
}

describe('throwTanstackRedirect', () => {
  test('absolute URLs redirect via href (external), not via to', () => {
    // The old inline codegen handler threw `redirect({ href })` INSIDE a
    // try block whose catch replaced it with `redirect({ to: absoluteUrl })`,
    // making TanStack treat the absolute URL as an internal path.
    const thrown = catchThrown(() =>
      throwTanstackRedirect('https://example.com/external'),
    ) as RedirectLike;

    expect(isRedirect(thrown)).toBe(true);
    expect(thrown.options?.href).toBe('https://example.com/external');
    expect(thrown.options?.to).toBeUndefined();
  });

  test('relative paths redirect via to so the basepath rewrite applies', () => {
    const thrown = catchThrown(() =>
      throwTanstackRedirect('/dashboard'),
    ) as RedirectLike;

    expect(isRedirect(thrown)).toBe(true);
    expect(thrown.options?.to).toBe('/dashboard');
    expect(thrown.options?.href).toBeUndefined();
  });

  test('empty location falls back to /', () => {
    const thrown = catchThrown(() => throwTanstackRedirect('')) as RedirectLike;
    expect(thrown.options?.to).toBe('/');
  });
});

describe('isAbsoluteUrl', () => {
  test('detects absolute and relative URLs', () => {
    expect(isAbsoluteUrl('https://example.com/a')).toBe(true);
    expect(isAbsoluteUrl('mailto:x@example.com')).toBe(true);
    expect(isAbsoluteUrl('/internal/path')).toBe(false);
    expect(isAbsoluteUrl('relative')).toBe(false);
  });
});

describe('mapSplatParamsForModernLoader', () => {
  test('maps TanStack _splat to React Router * only for splat routes', () => {
    expect(
      mapSplatParamsForModernLoader({ _splat: 'a/b', id: '1' }, true),
    ).toEqual({ '*': 'a/b', id: '1' });
    expect(
      mapSplatParamsForModernLoader({ _splat: 'a/b', id: '1' }, false),
    ).toEqual({ _splat: 'a/b', id: '1' });
    expect(mapSplatParamsForModernLoader({ id: '1' }, true)).toEqual({
      id: '1',
    });
  });
});

describe('createRouteStaticData', () => {
  test('drops empty fields', () => {
    const loader = () => null;
    expect(createRouteStaticData({})).toEqual({});
    expect(createRouteStaticData({ modernRouteId: '' })).toEqual({});
    expect(
      createRouteStaticData({
        modernRouteId: 'page',
        modernRouteLoader: loader,
      }),
    ).toEqual({ modernRouteId: 'page', modernRouteLoader: loader });
  });
});

describe('modernLoaderToTanstack', () => {
  const baseCtx = {
    location: { href: 'http://localhost/products/1' },
    params: { id: '1' },
  };

  test('passes request/params/context through to the modern loader', async () => {
    const seen: { request?: Request; params?: unknown; context?: unknown } = {};
    const loader = modernLoaderToTanstack({ hasSplat: false }, (args: any) => {
      seen.request = args.request;
      seen.params = args.params;
      seen.context = args.context;
      return { ok: true };
    });

    await expect(
      loader({
        ...baseCtx,
        context: { requestContext: { user: 'u1' } },
      }),
    ).resolves.toEqual({ ok: true });
    expect(seen.request).toBeInstanceOf(Request);
    expect(seen.request?.url).toBe('http://localhost/products/1');
    expect(seen.params).toEqual({ id: '1' });
    expect(seen.context).toEqual({ user: 'u1' });
  });

  test('uses current location when context carries a previous request', async () => {
    const seen: { request?: Request } = {};
    const loader = modernLoaderToTanstack({ hasSplat: false }, (args: any) => {
      seen.request = args.request;
      return { ok: true };
    });

    await expect(
      loader({
        ...baseCtx,
        location: { href: 'http://localhost/products/2?sort=price' },
        context: {
          request: new Request('http://localhost/products/1?sort=name'),
        },
      }),
    ).resolves.toEqual({ ok: true });

    expect(seen.request).toBeInstanceOf(Request);
    expect(seen.request?.url).toBe('http://localhost/products/2?sort=price');
  });

  test('translates an absolute-URL redirect Response into redirect({ href })', async () => {
    const loader = modernLoaderToTanstack({ hasSplat: false }, () =>
      Response.redirect('https://example.com/away', 302),
    );

    const thrown = (await loader(baseCtx).then(
      () => {
        throw new Error('expected redirect');
      },
      (err: unknown) => err,
    )) as RedirectLike;

    expect(isRedirect(thrown)).toBe(true);
    expect(thrown.options?.href).toBe('https://example.com/away');
    expect(thrown.options?.to).toBeUndefined();
  });

  test('translates a relative redirect Response into redirect({ to })', async () => {
    const loader = modernLoaderToTanstack(
      { hasSplat: false },
      () =>
        new Response(null, { status: 302, headers: { Location: '/login' } }),
    );

    const thrown = (await loader(baseCtx).then(
      () => {
        throw new Error('expected redirect');
      },
      (err: unknown) => err,
    )) as RedirectLike;

    expect(isRedirect(thrown)).toBe(true);
    expect(thrown.options?.to).toBe('/login');
  });

  test('translates a 404 Response into notFound()', async () => {
    const loader = modernLoaderToTanstack(
      { hasSplat: false },
      () => new Response(null, { status: 404 }),
    );

    const thrown = await loader(baseCtx).then(
      () => {
        throw new Error('expected notFound');
      },
      (err: unknown) => err,
    );

    expect(isNotFound(thrown)).toBe(true);
  });

  test('preserves returned non-404 error Responses as loader results', async () => {
    const response = new Response('loader exploded', { status: 500 });
    const loader = modernLoaderToTanstack({ hasSplat: false }, () => response);

    await expect(loader(baseCtx)).resolves.toBe(response);
  });

  test('translates redirect Responses thrown synchronously by the loader', () => {
    const loader = modernLoaderToTanstack({ hasSplat: false }, () => {
      throw new Response(null, {
        status: 301,
        headers: { Location: 'https://example.com/moved' },
      });
    });

    // A synchronous loader throw surfaces synchronously (TanStack handles
    // thrown redirects from the loader call itself).
    const thrown = catchThrown(() => loader(baseCtx)) as RedirectLike;

    expect(isRedirect(thrown)).toBe(true);
    expect(thrown.options?.href).toBe('https://example.com/moved');
  });

  test('re-throws TanStack redirects thrown by the loader untouched', async () => {
    const loader = modernLoaderToTanstack({ hasSplat: false }, async () => {
      throwTanstackRedirect('/inner');
    });

    const thrown = (await loader(baseCtx).then(
      () => {
        throw new Error('expected redirect');
      },
      (err: unknown) => err,
    )) as RedirectLike;

    // The bridge must not re-translate its own redirect (a Response without
    // a Location header) — that used to collapse internal targets to '/'.
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown.options?.to).toBe('/inner');
  });
});
