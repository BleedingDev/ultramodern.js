import { afterEach, describe, expect, rs, test } from '@rstest/core';
import { parseConfig } from '../src/createBuilder';

describe('rsdoctor defaults', () => {
  afterEach(() => {
    rs.unstubAllEnvs();
  });

  test('enables rsdoctor by default in production build', async () => {
    rs.stubEnv('NODE_ENV', 'production');

    const { rsbuildPlugins } = await parseConfig({}, { cwd: '' });
    expect(
      rsbuildPlugins.some(plugin => plugin.name === 'builder:rsdoctor'),
    ).toBe(true);
  });

  test('does not enable rsdoctor by default in development mode', async () => {
    rs.stubEnv('NODE_ENV', 'development');

    const { rsbuildPlugins } = await parseConfig({}, { cwd: '' });
    expect(
      rsbuildPlugins.some(plugin => plugin.name === 'builder:rsdoctor'),
    ).toBe(false);
  });

  test('supports explicit opt-out in production build', async () => {
    rs.stubEnv('NODE_ENV', 'production');

    const { rsbuildPlugins } = await parseConfig(
      {
        performance: {
          rsdoctor: false,
        },
      },
      { cwd: '' },
    );

    expect(
      rsbuildPlugins.some(plugin => plugin.name === 'builder:rsdoctor'),
    ).toBe(false);
  });

  test('supports explicit enable in development mode', async () => {
    rs.stubEnv('NODE_ENV', 'development');

    const { rsbuildPlugins } = await parseConfig(
      {
        performance: {
          rsdoctor: true,
        },
      },
      { cwd: '' },
    );

    expect(
      rsbuildPlugins.some(plugin => plugin.name === 'builder:rsdoctor'),
    ).toBe(true);
  });

  test('supports object config with enabled false', async () => {
    rs.stubEnv('NODE_ENV', 'production');

    const { rsbuildPlugins } = await parseConfig(
      {
        performance: {
          rsdoctor: {
            enabled: false,
            disableClientServer: false,
          },
        },
      },
      { cwd: '' },
    );

    expect(
      rsbuildPlugins.some(plugin => plugin.name === 'builder:rsdoctor'),
    ).toBe(false);
  });
});
