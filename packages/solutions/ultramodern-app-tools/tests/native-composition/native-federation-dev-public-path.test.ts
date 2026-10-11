import { describe, expect, it } from '@rstest/core';
import { resolveNativeFederationDevPublicPath } from '../../src/native-composition/native-federation-dev-public-path';

const server = { hostname: 'localhost', port: 43123, https: false };

describe('native federation development publicPath', () => {
  it.each([
    ['/', 'http://localhost:43123/'],
    ['/assets/', 'http://localhost:43123/assets/'],
    ['assets/', 'http://localhost:43123/assets/'],
  ])('publishes %s at the actual remote dev origin', (prefix, expected) => {
    expect(resolveNativeFederationDevPublicPath(prefix, server)).toBe(expected);
  });

  it('respects an explicit absolute dev asset prefix', () => {
    const prefix = 'https://assets.example/remote/dev/';
    expect(resolveNativeFederationDevPublicPath(prefix, server, prefix)).toBe(
      prefix,
    );
    expect(resolveNativeFederationDevPublicPath(prefix, server, true)).toBe(
      prefix,
    );
  });

  it('resolves a protocol-relative dev prefix using the live protocol', () => {
    expect(
      resolveNativeFederationDevPublicPath('//assets.example/remote/', {
        ...server,
        https: true,
      }),
    ).toBe('https://assets.example/remote/');
  });

  it('uses the resolved dynamic port and secure custom hostname', () => {
    expect(
      resolveNativeFederationDevPublicPath('/base/', {
        hostname: 'dev.example',
        port: 61937,
        https: true,
      }),
    ).toBe('https://dev.example:61937/base/');
  });

  it.each([
    ['0.0.0.0', 'localhost'],
    ['::', '[::1]'],
    ['::1', '[::1]'],
    ['2001:db8::1', '[2001:db8::1]'],
    ['[::1]', '[::1]'],
  ])('publishes the native public address for %s', (hostname, expectedHost) => {
    expect(
      resolveNativeFederationDevPublicPath('/base/', {
        ...server,
        hostname,
      }),
    ).toBe(`http://${expectedHost}:43123/base/`);
  });

  it.each([
    ['::', 'http://:::43123/base/', 'http://[::1]:43123/base/'],
    ['::1', 'http://::1:43123/base/', 'http://[::1]:43123/base/'],
    [
      '2001:db8::1',
      'http://2001:db8::1:43123/base/',
      'http://[2001:db8::1]:43123/base/',
    ],
  ])(
    'repairs Rsbuild boolean IPv6 prefix for %s without losing server.base',
    (hostname, prefix, expected) => {
      expect(
        resolveNativeFederationDevPublicPath(
          prefix,
          {
            ...server,
            hostname,
          },
          true,
        ),
      ).toBe(expected);
    },
  );

  it('rejects missing or unresolved live dev addresses', () => {
    expect(() => resolveNativeFederationDevPublicPath('/', undefined)).toThrow(
      'resolved dev server address',
    );
    for (const port of [0, -1, 65536, 1.5, Number.NaN])
      expect(() =>
        resolveNativeFederationDevPublicPath('/', {
          ...server,
          port,
        }),
      ).toThrow('resolved dev server address');
  });

  it('rejects automatic, malformed or unsupported public paths', () => {
    for (const prefix of ['', 'auto'])
      expect(() =>
        resolveNativeFederationDevPublicPath(prefix, server),
      ).toThrow('resolved publicPath');
    expect(() =>
      resolveNativeFederationDevPublicPath(
        'http://::1:43123/base/',
        {
          ...server,
          hostname: '::1',
        },
        'http://::1:43123/base/',
      ),
    ).toThrow('valid URL or path prefix');
    expect(() =>
      resolveNativeFederationDevPublicPath('file:///remote/', server),
    ).toThrow('HTTP or HTTPS');
  });
});
