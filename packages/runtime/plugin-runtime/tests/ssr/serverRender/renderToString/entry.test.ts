import Entry from '../../../../src/ssr/serverRender/renderToString/entry';

describe('Entry', () => {
  it('should inject inline json correctly', () => {
    const entry: any = new Entry({
      config: { inlineScript: false },
      ctx: {
        template: '',
        request: {},
      },
    } as any);
    expect(
      entry.getSSRDataScript({ name: 'modern.js' }, { age: 18 }),
    ).toMatchSnapshot();
  });

  it('should inject inline scripts with nonce correctly', () => {
    const entry: any = new Entry({
      config: { inlineScript: true },
      ctx: {
        template: '',
        request: {},
        nonce: 'test-nonce',
      },
    } as any);
    expect(
      entry.getSSRDataScript({ name: 'modern.js' }, { age: 18 }),
    ).toMatchSnapshot();
  });

  it('should inject inline script correctly', () => {
    const entry: any = new Entry({
      config: { inlineScript: true },
      ctx: {
        template: '',
        request: {},
      },
    } as any);
    expect(
      entry.getSSRDataScript({ name: 'modern.js' }, { age: 18 }),
    ).toMatchSnapshot();
  });

  it('should strip denylisted headers from serialized SSR payload', () => {
    const entry: any = new Entry({
      config: {
        inlineScript: true,
        unsafeHeaders: ['x-internal-secret'],
      },
      ctx: {
        template: '',
        request: {},
      },
    } as any);

    const script = entry.getSSRDataScript({
      context: {
        request: {
          headers: {
            authorization: 'Bearer secret',
            cookie: 'sid=abc',
            'x-request-id': 'req-1',
            'x-internal-secret': 'hidden',
          },
        },
      },
    });

    expect(script).toMatch('"x-request-id":"req-1"');
    expect(script).not.toMatch('authorization');
    expect(script).not.toMatch('cookie');
    expect(script).not.toMatch('x-internal-secret');
  });
});
