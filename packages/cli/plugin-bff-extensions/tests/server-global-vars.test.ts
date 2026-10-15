import { describe, expect, test } from '@rstest/core';
import { serializeServerGlobalVars } from '../src/server-global-vars';

describe('serializeServerGlobalVars', () => {
  test('returns no replacements without source.globalVars', () => {
    expect(serializeServerGlobalVars(undefined)).toEqual({});
  });

  test('serializes every value to the JSON text that replaces it', () => {
    expect(
      serializeServerGlobalVars({
        ULTRAMODERN_BUILD_MARKER: 'build "exact"',
        FEATURE_ENABLED: true,
        RETRY_LIMIT: 3,
        NULL_VALUE: null,
        SETTINGS: { labels: ['tractor', 'český'] },
      }),
    ).toEqual({
      ULTRAMODERN_BUILD_MARKER: '"build \\"exact\\""',
      FEATURE_ENABLED: 'true',
      RETRY_LIMIT: '3',
      NULL_VALUE: 'null',
      SETTINGS: '{"labels":["tractor","český"]}',
    });
  });

  test('resolves the option chain with the server context', () => {
    expect(
      serializeServerGlobalVars([
        { BASE: 'base' },
        (config, context) => ({ ...config, CONTEXT: context }),
        config => {
          config.MUTATED = 'mutated';
        },
      ]),
    ).toEqual({
      BASE: '"base"',
      CONTEXT: '{"env":"server","target":"node"}',
      MUTATED: '"mutated"',
    });
  });

  test.each([
    ['undefined', undefined],
    ['a function', () => 'value'],
    ['a BigInt', 1n],
  ])('rejects %s, which has no exact JSON form', (_label, value) => {
    expect(() =>
      serializeServerGlobalVars({ NOT_SERIALIZABLE: value }),
    ).toThrow(
      'source.globalVars["NOT_SERIALIZABLE"] cannot be serialized exactly for BFF server code.',
    );
  });
});
