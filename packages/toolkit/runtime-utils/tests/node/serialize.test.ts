import { rstest } from '@rstest/core';

describe('serializeJson', () => {
  beforeEach(() => {
    rstest.resetModules();
  });

  it('does not generate random values while the module is initialized', async () => {
    const getRandomValues = rstest.spyOn(globalThis.crypto, 'getRandomValues');

    await import('../../src/node/serialize');

    expect(getRandomValues).not.toHaveBeenCalled();
    getRandomValues.mockRestore();
  });

  it('serializes JSON while escaping script-unsafe characters', async () => {
    const { serializeJson } = await import('../../src/node/serialize');

    expect(serializeJson({ value: '</script>\u2028\u2029' })).toBe(
      '{"value":"\\u003C\\u002Fscript\\u003E\\u2028\\u2029"}',
    );
  });

  it('preserves the undefined literal contract', async () => {
    const { serializeJson } = await import('../../src/node/serialize');

    expect(serializeJson(undefined)).toBe('undefined');
  });
});
