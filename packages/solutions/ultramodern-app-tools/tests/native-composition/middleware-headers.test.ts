import type { ServerRoute } from '@modern-js/types/server';
import {
  applyMiddlewareHeaders,
  matchNativeServerRoute,
} from '../../src/native-composition/native-server-plugin';

describe('native server middleware headers', () => {
  it('keeps cumulative CSP and Vary while middleware wins singleton fields', () => {
    const prepared = new Headers({
      'content-security-policy': "script-src 'self'",
      'content-security-policy-report-only': "style-src 'self'",
      'server-timing': 'middleware;dur=1',
      vary: 'Origin, cookie',
      'cache-control': 'private, no-store',
      'content-type': 'application/json',
    });
    prepared.append('set-cookie', 'middleware=1');
    const native = new Headers({
      'content-security-policy': "default-src 'self'",
      'content-security-policy-report-only': "img-src 'self'",
      'server-timing': 'render;dur=2',
      vary: 'Cookie',
      'cache-control': 'public, max-age=60',
      'content-type': 'text/html; charset=utf-8',
    });

    applyMiddlewareHeaders(prepared, native);

    expect(native.get('content-security-policy')).toBe(
      "default-src 'self', script-src 'self'",
    );
    expect(native.get('content-security-policy-report-only')).toBe(
      "img-src 'self', style-src 'self'",
    );
    expect(native.get('vary')).toBe('Cookie, Origin');
    expect(native.get('server-timing')).toBe('render;dur=2, middleware;dur=1');
    expect(native.get('cache-control')).toBe('private, no-store');
    expect(native.get('content-type')).toBe('text/html; charset=utf-8');
    expect(native.getSetCookie()).toEqual([]);
  });

  it('lets a singleton field from the applied source win over the native one', () => {
    const native = new Headers({ 'x-frame-options': 'DENY' });
    applyMiddlewareHeaders(
      new Headers({ 'x-frame-options': 'SAMEORIGIN' }),
      native,
    );
    expect(native.get('x-frame-options')).toBe('SAMEORIGIN');
  });
});

describe('native server rewrite routes', () => {
  const routes = [
    { urlPath: '/', entryName: 'main', entryPath: 'main.html' },
    { urlPath: '/admin', entryName: 'admin', entryPath: 'admin.html' },
    { urlPath: '/api', entryName: 'main', entryPath: '', isApi: true },
  ] as ServerRoute[];

  it('matches the longest page route and honors a rewritten entry', () => {
    expect(matchNativeServerRoute(routes, '/admin/users')?.entryName).toBe(
      'admin',
    );
    expect(matchNativeServerRoute(routes, '/administrator')?.entryName).toBe(
      'main',
    );
    expect(matchNativeServerRoute(routes, '/api/x')?.entryName).toBe('main');
    expect(
      matchNativeServerRoute(routes, '/admin/users', 'main')?.urlPath,
    ).toBe('/');
    expect(matchNativeServerRoute(routes, '/x', 'missing')).toBeUndefined();
  });
});
