import { applyMiddlewareHeaders } from '../../src/native-composition/native-server-plugin';

describe('native server middleware headers', () => {
  it('keeps cumulative CSP and Vary while middleware wins singleton fields', () => {
    const prepared = new Headers({
      'content-security-policy': "script-src 'self'",
      'content-security-policy-report-only': "style-src 'self'",
      vary: 'Origin, cookie',
      'cache-control': 'private, no-store',
      'content-type': 'application/json',
    });
    prepared.append('set-cookie', 'middleware=1');
    const native = new Headers({
      'content-security-policy': "default-src 'self'",
      'content-security-policy-report-only': "img-src 'self'",
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
