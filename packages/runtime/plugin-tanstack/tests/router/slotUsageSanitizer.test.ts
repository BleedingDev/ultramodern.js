import { sanitizeSlotArgs } from '../../src/runtime/rsc/slotUsageSanitizer';

describe('RSC slot usage sanitizer', () => {
  test('redacts callable slot args without serializing function source', () => {
    function tokenFactory() {
      return 'token-secret';
    }

    const args = sanitizeSlotArgs([
      tokenFactory,
      { nested: tokenFactory },
      [tokenFactory],
    ]);

    expect(args).toEqual([
      '[Function]',
      { nested: '[Function]' },
      ['[Function]'],
    ]);
    expect(JSON.stringify(args)).not.toContain('token-secret');
    expect(JSON.stringify(args)).not.toContain('tokenFactory');
  });
});
