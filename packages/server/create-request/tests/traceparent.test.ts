import { parseTraceparent } from '../src/traceparent';

describe('parseTraceparent', () => {
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const spanId = '00f067aa0ba902b7';

  test('parses a valid sampled traceparent', () => {
    expect(parseTraceparent(`00-${traceId}-${spanId}-01`)).toEqual({
      traceId,
      spanId,
      sampled: true,
    });
  });

  test('parses a valid unsampled traceparent', () => {
    expect(parseTraceparent(`00-${traceId}-${spanId}-00`)).toEqual({
      traceId,
      spanId,
      sampled: false,
    });
  });

  test('lowercases mixed-case ids and trims surrounding whitespace', () => {
    expect(
      parseTraceparent(
        `  00-${traceId.toUpperCase()}-${spanId.toUpperCase()}-01  `,
      ),
    ).toEqual({
      traceId,
      spanId,
      sampled: true,
    });
  });

  test('reads the sampled bit from arbitrary flag values', () => {
    expect(parseTraceparent(`00-${traceId}-${spanId}-03`)?.sampled).toBe(true);
    expect(parseTraceparent(`00-${traceId}-${spanId}-02`)?.sampled).toBe(false);
  });

  test('rejects missing, empty, and malformed headers', () => {
    expect(parseTraceparent(undefined)).toBeUndefined();
    expect(parseTraceparent(null)).toBeUndefined();
    expect(parseTraceparent('')).toBeUndefined();
    expect(parseTraceparent('not-a-traceparent')).toBeUndefined();
    expect(parseTraceparent(`00-${traceId}-${spanId}`)).toBeUndefined();
    expect(parseTraceparent(`01-${traceId}-${spanId}-01`)).toBeUndefined();
    expect(
      parseTraceparent(`00-${traceId.slice(1)}-${spanId}-01`),
    ).toBeUndefined();
  });

  test('rejects all-zero trace and span ids per the W3C spec', () => {
    expect(
      parseTraceparent(`00-${'0'.repeat(32)}-${spanId}-01`),
    ).toBeUndefined();
    expect(
      parseTraceparent(`00-${traceId}-${'0'.repeat(16)}-01`),
    ).toBeUndefined();
  });
});
