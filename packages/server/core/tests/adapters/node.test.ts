import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createWebRequest } from '../../src/adapters/node/node';

const createRequest = ({
  encrypted,
  headers = {},
}: {
  encrypted: boolean;
  headers?: IncomingMessage['headers'];
}) => {
  const request = new EventEmitter() as IncomingMessage;
  Object.assign(request, {
    headers: {
      host: 'modern.test',
      ...headers,
    },
    method: 'GET',
    socket: { encrypted },
    url: '/mf-manifest.json?from=node',
  });

  const response = new EventEmitter() as ServerResponse;
  return createWebRequest(request, response);
};

describe('createWebRequest protocol', () => {
  it('uses HTTPS for a directly encrypted connection', () => {
    const request = createRequest({ encrypted: true });

    expect(request.url).toBe('https://modern.test/mf-manifest.json?from=node');
  });

  it('does not trust a client-supplied forwarded protocol', () => {
    const request = createRequest({
      encrypted: false,
      headers: {
        'x-forwarded-proto': 'https',
      },
    });

    expect(request.url).toBe('http://modern.test/mf-manifest.json?from=node');
  });
});
