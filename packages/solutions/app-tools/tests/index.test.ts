import appToolsDefault, {
  appTools,
  createPresetUltramodernConfig,
  mergeConfig,
  presetUltramodern,
} from '../src';

describe('app-tools export', () => {
  it('default export', () => {
    expect(appToolsDefault).toBeDefined();
  });

  it('named export', () => {
    expect(appTools).toBeDefined();
    expect(createPresetUltramodernConfig).toBeDefined();
    expect(presetUltramodern).toBeDefined();
  });
});

describe('merge config', () => {
  test('should replace property deeply', () => {
    expect(
      mergeConfig([
        {
          source: { disableDefaultEntries: false },
          output: { polyfill: 'usage' },
        },
        {
          source: { disableDefaultEntries: true },
          output: { polyfill: 'entry' },
        },
      ]),
    ).toEqual({
      source: { disableDefaultEntries: true },
      output: { polyfill: 'entry' },
    });
  });
});
