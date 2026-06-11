import {
  DEFAULT_ENVIRONMENT_NAME,
  parseServerRuntimeExtensionsEnv,
} from '../src/env';

describe('parseServerRuntimeExtensionsEnv', () => {
  test('applies documented defaults for an empty environment', () => {
    const parsed = parseServerRuntimeExtensionsEnv({});

    expect(parsed).toEqual({
      modernEnv: undefined,
      nodeEnv: undefined,
      environmentName: DEFAULT_ENVIRONMENT_NAME,
      contractGatesFile: undefined,
    });
  });

  test('parses configured values and trims whitespace', () => {
    const parsed = parseServerRuntimeExtensionsEnv({
      MODERN_ENV: ' staging ',
      NODE_ENV: 'production',
      MODERN_CONTRACT_GATES_FILE: ' /var/run/gates.json ',
    });

    expect(parsed.modernEnv).toBe('staging');
    expect(parsed.nodeEnv).toBe('production');
    expect(parsed.environmentName).toBe('staging');
    expect(parsed.contractGatesFile).toBe('/var/run/gates.json');
  });

  test('falls back from MODERN_ENV to NODE_ENV to the default', () => {
    expect(
      parseServerRuntimeExtensionsEnv({ NODE_ENV: 'production' })
        .environmentName,
    ).toBe('production');
    expect(
      parseServerRuntimeExtensionsEnv({
        MODERN_ENV: 'preview',
        NODE_ENV: 'production',
      }).environmentName,
    ).toBe('preview');
    expect(parseServerRuntimeExtensionsEnv({}).environmentName).toBe(
      DEFAULT_ENVIRONMENT_NAME,
    );
  });

  test('treats blank strings as unset', () => {
    const parsed = parseServerRuntimeExtensionsEnv({
      MODERN_ENV: '   ',
      MODERN_CONTRACT_GATES_FILE: '',
    });

    expect(parsed.modernEnv).toBeUndefined();
    expect(parsed.contractGatesFile).toBeUndefined();
    expect(parsed.environmentName).toBe(DEFAULT_ENVIRONMENT_NAME);
  });

  test('reads from process.env by default', () => {
    const previous = process.env.MODERN_CONTRACT_GATES_FILE;
    process.env.MODERN_CONTRACT_GATES_FILE = '/tmp/gates.json';
    try {
      expect(parseServerRuntimeExtensionsEnv().contractGatesFile).toBe(
        '/tmp/gates.json',
      );
    } finally {
      if (previous === undefined) {
        delete process.env.MODERN_CONTRACT_GATES_FILE;
      } else {
        process.env.MODERN_CONTRACT_GATES_FILE = previous;
      }
    }
  });
});
