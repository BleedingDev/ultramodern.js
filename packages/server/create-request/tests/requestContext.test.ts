import {
  BFF_LOCALE_HEADER,
  BFF_TRACEPARENT_HEADER,
  createRequestContextHeaders,
  createRequestContextSnapshot,
} from '../src/browser';

describe('request context helpers', () => {
  test('should create propagation headers from explicit locale and traceparent', () => {
    expect(
      createRequestContextHeaders({
        locale: 'cs-CZ',
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      }),
    ).toEqual({
      [BFF_LOCALE_HEADER]: 'cs-CZ',
      [BFF_TRACEPARENT_HEADER]:
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
  });

  test('should derive locale and trace metadata from incoming headers', () => {
    expect(
      createRequestContextSnapshot({
        headers: {
          'accept-language': 'en-US,en;q=0.8',
          traceparent:
            '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        },
      }),
    ).toEqual({
      headers: {
        'accept-language': 'en-US,en;q=0.8',
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
      locale: 'en-US,en;q=0.8',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
    });
  });

  test('should keep operation context in snapshots without widening propagation headers', () => {
    expect(
      createRequestContextSnapshot({
        locale: 'cs-CZ',
        operationContext: {
          operationId: 'shell:list',
          routePath: '/effect/recommendations',
          method: 'GET',
          source: 'generated-client',
          scope: {
            workspace: 'demo',
          },
          sessionClaims: {
            role: 'viewer',
          },
          traceparent:
            '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
        },
      }),
    ).toEqual({
      headers: {
        [BFF_LOCALE_HEADER]: 'cs-CZ',
        [BFF_TRACEPARENT_HEADER]:
          '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      },
      locale: 'cs-CZ',
      operationContext: {
        locale: 'cs-CZ',
        method: 'GET',
        operationId: 'shell:list',
        routePath: '/effect/recommendations',
        scope: {
          workspace: 'demo',
        },
        sessionClaims: {
          role: 'viewer',
        },
        source: 'generated-client',
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        spanId: 'bbbbbbbbbbbbbbbb',
      },
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spanId: 'bbbbbbbbbbbbbbbb',
    });
  });
});
