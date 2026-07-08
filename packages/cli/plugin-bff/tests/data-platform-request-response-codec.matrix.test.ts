import {
  DEFAULT_DATA_BATCH_ENDPOINT,
  stableStringify,
} from '../src/runtime/data-platform';
import { normalizeMethod } from '../src/runtime/data-platform/batch/request';
import {
  isBatchResponsePayload,
  parseResponseLikeCreateRequest,
} from '../src/runtime/data-platform/batch/response';
import {
  normalizeBatchEndpoint,
  toAbsoluteUrl,
} from '../src/runtime/data-platform/batch/url';

describe('data-platform request response codec matrix', () => {
  test.each([
    {
      scenario: 'sorts object keys independent of insertion order',
      value: { beta: 2, alpha: 1 },
      equivalent: { alpha: 1, beta: 2 },
      expected: '{"alpha":1,"beta":2}',
    },
    {
      scenario: 'omits undefined object keys and keeps array slots as null',
      value: {
        keep: 'value',
        skip: undefined,
        list: [undefined, { zeta: undefined, alpha: 1 }],
      },
      equivalent: {
        list: [undefined, { alpha: 1, zeta: undefined }],
        skip: undefined,
        keep: 'value',
      },
      expected: '{"keep":"value","list":[null,{"alpha":1}]}',
    },
    {
      scenario: 'canonicalizes nested object keys',
      value: {
        zeta: [{ beta: 2, alpha: 1 }, undefined],
        alpha: { delta: undefined, charlie: 3 },
      },
      equivalent: {
        alpha: { charlie: 3, delta: undefined },
        zeta: [{ alpha: 1, beta: 2 }, undefined],
      },
      expected: '{"alpha":{"charlie":3},"zeta":[{"alpha":1,"beta":2},null]}',
    },
  ])('$scenario', ({ value, equivalent, expected }) => {
    expect(stableStringify(value)).toBe(expected);
    expect(stableStringify(equivalent)).toBe(expected);
  });

  test.each([
    {
      scenario: 'defaults missing method to GET',
      method: undefined,
      expected: 'GET',
    },
    {
      scenario: 'uppercases lowercase get',
      method: 'get',
      expected: 'GET',
    },
    {
      scenario: 'uppercases mixed-case patch',
      method: 'PaTcH',
      expected: 'PATCH',
    },
    {
      scenario: 'uppercases already explicit post',
      method: 'POST',
      expected: 'POST',
    },
  ])('$scenario', ({ method, expected }) => {
    expect(normalizeMethod(method)).toBe(expected);
  });

  test.each([
    {
      scenario: 'normalizes a relative request URL against runtime origin',
      input: '/api/items?b=1',
      expected: 'http://localhost/api/items?b=1',
    },
    {
      scenario: 'keeps an absolute request URL',
      input: 'https://edge.test/api/items?b=1',
      expected: 'https://edge.test/api/items?b=1',
    },
    {
      scenario: 'keeps an URL instance request URL',
      input: new URL('https://url.test/path?x=1'),
      expected: 'https://url.test/path?x=1',
    },
    {
      scenario: 'reads a Request instance URL',
      input: new Request('https://request.test/path?x=1'),
      expected: 'https://request.test/path?x=1',
    },
  ])('$scenario', ({ input, expected }) => {
    expect(toAbsoluteUrl(input).href).toBe(expected);
  });

  test.each([
    {
      scenario: 'defaults batch endpoint to request origin',
      endpoint: undefined,
      expected: `https://service.test${DEFAULT_DATA_BATCH_ENDPOINT}`,
    },
    {
      scenario: 'normalizes root-relative batch endpoint',
      endpoint: '/rpc/batch',
      expected: 'https://service.test/rpc/batch',
    },
    {
      scenario: 'normalizes path-relative batch endpoint',
      endpoint: 'rpc/batch',
      expected: 'https://service.test/rpc/batch',
    },
    {
      scenario: 'keeps absolute batch endpoint',
      endpoint: 'https://batch.test/collect',
      expected: 'https://batch.test/collect',
    },
  ])('$scenario', ({ endpoint, expected }) => {
    expect(
      normalizeBatchEndpoint(
        new URL('https://service.test/api/data?x=1'),
        endpoint,
      ).href,
    ).toBe(expected);
  });

  test.each([
    {
      scenario: 'parses cased application json response',
      contentType: 'Application/JSON; Charset=UTF-8',
      body: JSON.stringify({ ok: true }),
      expected: { ok: true },
    },
    {
      scenario: 'parses cased text json response',
      contentType: 'Text/JSON; Charset=UTF-8',
      body: JSON.stringify({ ok: 'text-json' }),
      expected: { ok: 'text-json' },
    },
    {
      scenario: 'parses cased text response',
      contentType: 'Text/Plain; Charset=UTF-8',
      body: 'plain body',
      expected: 'plain body',
    },
  ])('$scenario', async ({ contentType, body, expected }) => {
    await expect(
      parseResponseLikeCreateRequest(
        new Response(body, {
          headers: {
            'content-type': contentType,
          },
        }),
      ),
    ).resolves.toEqual(expected);
  });

  test.each([
    {
      scenario: 'accepts demuxable response payload shape',
      value: {
        protocolVersion: 1,
        batchId: 'batch_1',
        receivedAt: 123,
        items: [
          {
            id: 'item_a',
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({ value: 'a' }),
          },
          {
            id: 'item_b',
            status: 204,
          },
        ],
      },
      expected: true,
    },
    {
      scenario: 'rejects response item without demux id',
      value: {
        protocolVersion: 1,
        batchId: 'batch_1',
        receivedAt: 123,
        items: [
          {
            status: 200,
          },
        ],
      },
      expected: false,
    },
    {
      scenario: 'rejects response item without numeric status',
      value: {
        protocolVersion: 1,
        batchId: 'batch_1',
        receivedAt: 123,
        items: [
          {
            id: 'item_a',
          },
        ],
      },
      expected: false,
    },
    {
      scenario: 'rejects non-v1 response payload',
      value: {
        protocolVersion: 2,
        batchId: 'batch_1',
        receivedAt: 123,
        items: [
          {
            id: 'item_a',
            status: 200,
          },
        ],
      },
      expected: false,
    },
  ])('$scenario', ({ value, expected }) => {
    expect(isBatchResponsePayload(value)).toBe(expected);
  });
});
