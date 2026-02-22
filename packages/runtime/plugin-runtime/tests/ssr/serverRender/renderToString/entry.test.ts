import { RenderLevel } from '../../../../src/core/constants';
import { SSRDataCollector } from '../../../../src/core/server/string/ssrData';

const createScripts = (options?: {
  useJsonScript?: boolean;
  nonce?: string;
  unsafeHeaders?: string[];
}) => {
  const chunkSet = {
    renderLevel: RenderLevel.SERVER_RENDER,
    ssrScripts: '',
    jsChunk: '',
    cssChunk: '',
  };

  const collector = new SSRDataCollector({
    runtimeContext: {
      initialData: { name: 'modern.js' },
      __i18nData__: {},
    } as any,
    request: new Request('http://localhost/'),
    chunkSet,
    ssrContext: {
      request: {
        params: {},
        query: {},
        pathname: '/',
        host: 'localhost',
        url: 'http://localhost/',
        headers: {
          authorization: 'Bearer secret',
          cookie: 'sid=abc',
          'x-request-id': 'req-1',
          'x-internal-secret': 'hidden',
        },
      },
      reporter: { sessionId: 'session-1' },
    } as any,
    ssrConfig: {
      unsafeHeaders: options?.unsafeHeaders,
    } as any,
    nonce: options?.nonce,
    useJsonScript: options?.useJsonScript,
  });

  collector.effect();
  return chunkSet.ssrScripts;
};

describe('SSR data script generation', () => {
  it('should inject json script correctly', () => {
    expect(createScripts({ useJsonScript: true })).toMatchSnapshot();
  });

  it('should inject inline scripts with nonce correctly', () => {
    expect(createScripts({ nonce: 'test-nonce' })).toMatchSnapshot();
  });

  it('should inject inline script correctly', () => {
    expect(createScripts()).toMatchSnapshot();
  });

  it('should strip denylisted headers from serialized SSR payload', () => {
    const scripts = createScripts({ unsafeHeaders: ['x-request-id'] });
    expect(scripts).toMatch('"x-request-id":"req-1"');
    expect(scripts).not.toMatch('authorization');
    expect(scripts).not.toMatch('cookie');
    expect(scripts).not.toMatch('x-internal-secret');
  });
});
