import {
  attachOperationContextHeaders,
  buildEnvelopeHeaderValue,
  buildOperationContext,
  CrossOriginEnvelopePolicyError,
  deleteHeader,
  extractPathParamNames,
  findHeaderKey,
  isSecuredRequestId,
  OperationContractViolationError,
  readHeader,
  resolveConfiguredRequest,
  toOrigin,
  validateOperationContract,
  writeHeader,
} from '../src/policyCore';

describe('policyCore (shared browser/node policy module)', () => {
  test('header helpers are case-insensitive and normalize duplicate keys', () => {
    const headers: Record<string, any> = { 'X-Foo': 'a' };

    expect(findHeaderKey(headers, 'x-foo')).toBe('X-Foo');
    expect(readHeader(headers, 'x-FOO')).toBe('a');

    writeHeader(headers, 'x-foo', 'b');
    expect(headers).toEqual({ 'x-foo': 'b' });

    deleteHeader(headers, 'X-FOO');
    expect(headers).toEqual({});
  });

  test('toOrigin and extractPathParamNames behave identically for both targets', () => {
    expect(toOrigin('https://example.com/a/b?c=1')).toBe('https://example.com');
    expect(toOrigin('not-a-url')).toBeUndefined();
    expect(extractPathParamNames('/items/:id/sub/:subId')).toEqual([
      'id',
      'subId',
    ]);
  });

  test('isSecuredRequestId treats only "default" as unsecured by default', () => {
    expect(isSecuredRequestId('default')).toBe(false);
    expect(isSecuredRequestId('crm-producer')).toBe(true);
  });

  test('buildOperationContext prefixes operationId with the requestId', () => {
    const context = buildOperationContext({
      requestId: 'crm',
      method: 'get',
      path: '/hello',
      operationContext: {
        operationId: 'getHello',
        schemaHash: 'abc',
        operationVersion: 2,
      },
    });

    expect(context.operationId).toBe('crm:getHello');
    expect(context.method).toBe('GET');
    expect(context.schemaHash).toBe('abc');
    expect(context.operationVersion).toBe(2);
  });

  test('validateOperationContract throws on missing schema hash for secured ids', () => {
    const contextPayload = buildOperationContext({
      requestId: 'crm',
      method: 'GET',
      path: '/hello',
    });

    expect(() =>
      validateOperationContract({
        requestId: 'crm',
        target: 'browser',
        contextPayload,
        operationContract: undefined,
      }),
    ).toThrow(OperationContractViolationError);
  });

  test('buildEnvelopeHeaderValue denies cross-origin flows unless allowed', () => {
    expect(() =>
      buildEnvelopeHeaderValue({
        requestId: 'crm',
        target: 'server',
        sourceOrigin: 'https://a.example',
        targetOrigin: 'https://b.example',
        traceContext: undefined,
        allowCrossOriginEnvelope: undefined,
      }),
    ).toThrow(CrossOriginEnvelopePolicyError);

    const envelope = JSON.parse(
      buildEnvelopeHeaderValue({
        requestId: 'crm',
        target: 'server',
        sourceOrigin: 'https://a.example',
        targetOrigin: 'https://b.example',
        traceContext: { traceId: 't', spanId: 's' },
        allowCrossOriginEnvelope: true,
      }),
    );
    expect(envelope).toMatchObject({
      requestId: 'crm',
      target: 'server',
      sourceOrigin: 'https://a.example',
      targetOrigin: 'https://b.example',
      traceId: 't',
      spanId: 's',
    });
  });

  test('buildEnvelopeHeaderValue requires cross-origin predicate to return true', () => {
    const allowCrossOriginEnvelope = () => 'yes';

    expect(() =>
      buildEnvelopeHeaderValue({
        requestId: 'crm',
        target: 'server',
        sourceOrigin: 'https://a.example',
        targetOrigin: 'https://b.example',
        traceContext: undefined,
        allowCrossOriginEnvelope:
          allowCrossOriginEnvelope as unknown as () => boolean,
      }),
    ).toThrow(CrossOriginEnvelopePolicyError);
  });

  test('attachOperationContextHeaders writes id and detail headers without clobbering caller id', () => {
    const headers: Record<string, any> = {
      'x-operation-id': 'crm:custom-op',
    };

    attachOperationContextHeaders({
      headers,
      requestId: 'crm',
      target: 'server',
      method: 'GET',
      path: '/hello',
      operationContext: {
        operationId: 'getHello',
        schemaHash: 'abc',
        operationVersion: 1,
      },
      operationContract: undefined,
      operationContextHeader: 'x-operation-id',
      operationContextDetailHeader: 'x-modernjs-bff-operation-context',
    });

    expect(headers['x-operation-id']).toBe('crm:custom-op');
    const details = JSON.parse(headers['x-modernjs-bff-operation-context']);
    expect(details).toMatchObject({
      requestId: 'crm',
      operationId: 'crm:getHello',
      schemaHash: 'abc',
      operationVersion: 1,
    });
  });

  test('resolveConfiguredRequest throws for unconfigured non-default producers', () => {
    const map = new Map<string, string>();
    expect(() => resolveConfiguredRequest(map, 'crm', 'fallback')).toThrow(
      'Producer client "crm" is not initialized',
    );
    expect(resolveConfiguredRequest(map, 'default', 'fallback')).toBe(
      'fallback',
    );
    map.set('crm', 'configured');
    expect(resolveConfiguredRequest(map, 'crm', 'fallback')).toBe('configured');
  });
});

describe('createUploader policy headers (node entry)', () => {
  beforeAll(() => {
    // getUploadPayload probes `instanceof FileList`, a browser-only global.
    if (typeof globalThis.FileList === 'undefined') {
      (globalThis as Record<string, any>).FileList = class FileList {};
    }
  });

  test('attaches envelope and operation-context headers for secured producers', async () => {
    const { configure, createUploader } = await import('../src/node');

    const seenInit: Array<{ url: string; init: any }> = [];
    const fakeFetch = (async (url: any, init: any) => {
      seenInit.push({ url: String(url), init });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    configure({
      requestId: 'upload-producer',
      request: fakeFetch,
      setDomain: () => 'http://producer.example',
    });

    const upload = createUploader({
      path: '/api/upload',
      requestId: 'upload-producer',
      operationContext: {
        operationId: 'upload',
        routePath: '/api/upload',
        method: 'POST',
        schemaHash: 'hash-1',
        operationVersion: 1,
      },
    });

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
    await upload({ files: { file } });

    expect(seenInit).toHaveLength(1);
    const { url, init } = seenInit[0]!;
    expect(url).toBe('http://producer.example/api/upload');
    expect(init.method).toBe('POST');

    const envelope = JSON.parse(init.headers['x-modernjs-bff-envelope']);
    expect(envelope.requestId).toBe('upload-producer');

    expect(init.headers['x-operation-id']).toBe('upload-producer:upload');
    const details = JSON.parse(
      init.headers['x-modernjs-bff-operation-context'],
    );
    expect(details).toMatchObject({
      requestId: 'upload-producer',
      operationId: 'upload-producer:upload',
      routePath: '/api/upload',
      method: 'POST',
      schemaHash: 'hash-1',
      operationVersion: 1,
    });
  });

  test('keeps the default uploader free of policy headers', async () => {
    const { createUploader } = await import('../src/node');

    const seenInit: Array<{ init: any }> = [];
    const fakeFetch = (async (_url: any, init: any) => {
      seenInit.push({ init });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    // default requestId falls back to the passed fetch only via configure-less
    // path; install a custom request for determinism.
    const { configure } = await import('../src/node');
    configure({ request: fakeFetch });

    const upload = createUploader({ path: '/api/upload' });
    const file = new File(['hi'], 'hi.txt', { type: 'text/plain' });
    await upload({ files: { file } });

    expect(seenInit).toHaveLength(1);
    const headers = seenInit[0]!.init.headers as Record<string, unknown>;
    expect(headers['x-modernjs-bff-envelope']).toBeUndefined();
    expect(headers['x-operation-id']).toBeUndefined();
  });
});
