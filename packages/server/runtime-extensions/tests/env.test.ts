import {
  DEFAULT_ENVIRONMENT_NAME,
  parseServerRuntimeExtensionsEnv,
} from '../src/env';

describe('parseServerRuntimeExtensionsEnv', () => {
  test.each([
    {
      name: 'uses the documented default when values are blank',
      env: {
        MODERN_ENV: '  ',
        NODE_ENV: '',
        MODERN_CONTRACT_GATES_FILE: ' ',
      },
      expectedEnvironment: DEFAULT_ENVIRONMENT_NAME,
      expectedModernEnv: undefined,
      expectedNodeEnv: undefined,
      expectedContractGatesFile: undefined,
    },
    {
      name: 'trims configured values and prefers MODERN_ENV',
      env: {
        MODERN_ENV: ' staging ',
        NODE_ENV: 'production',
        MODERN_CONTRACT_GATES_FILE: ' /var/run/gates.json ',
      },
      expectedEnvironment: 'staging',
      expectedModernEnv: 'staging',
      expectedNodeEnv: 'production',
      expectedContractGatesFile: '/var/run/gates.json',
    },
    {
      name: 'falls back to NODE_ENV when MODERN_ENV is absent',
      env: { NODE_ENV: 'production' },
      expectedEnvironment: 'production',
      expectedModernEnv: undefined,
      expectedNodeEnv: 'production',
      expectedContractGatesFile: undefined,
    },
  ])(
    '$name',
    ({
      env,
      expectedEnvironment,
      expectedModernEnv,
      expectedNodeEnv,
      expectedContractGatesFile,
    }) => {
      const parsed = parseServerRuntimeExtensionsEnv(env);

      expect(parsed.environmentName).toBe(expectedEnvironment);
      expect(parsed.modernEnv).toBe(expectedModernEnv);
      expect(parsed.nodeEnv).toBe(expectedNodeEnv);
      expect(parsed.contractGatesFile).toBe(expectedContractGatesFile);
    },
  );
});
