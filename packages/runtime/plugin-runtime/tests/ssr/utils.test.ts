import { attributesToString } from '../../src/core/server/utils';

describe('ssr utils', () => {
  it('should attributesToString return string correctly', async () => {
    const str = attributesToString({ nonce: 'test-nonce' });
    expect(str).toMatch(' nonce="test-nonce"');

    const str1 = attributesToString({ crossorigin: true, nonce: undefined });
    expect(str1).toMatch(' crossorigin="true"');
  });

  it('escapes values inside double-quoted attributes', () => {
    expect(
      attributesToString({
        nonce: '"&<>\' ',
        'data-count': 0,
        'data-enabled': false,
        'data-empty': null,
      }),
    ).toBe(
      ' nonce="&quot;&amp;&lt;&gt;\' " data-count="0" data-enabled="false" data-empty="null"',
    );
  });

  it.each([
    '',
    'bad name',
    'bad\tname',
    'bad\u0000name',
    'bad"name',
    "bad'name",
    'bad<name',
    'bad>name',
    'bad/name',
    'bad=name',
  ])(
    'omits the invalid attribute name %j without affecting valid attributes',
    name => {
      expect(
        attributesToString({
          [name]: 'injected',
          'data-valid': 'kept',
          omitted: undefined,
        }),
      ).toBe(' data-valid="kept"');
    },
  );
});
