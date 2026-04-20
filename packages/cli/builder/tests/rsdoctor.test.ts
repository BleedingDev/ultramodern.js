import { afterEach, describe, expect, rs, test } from '@rstest/core';
import { parseConfig } from '../src/createBuilder';

describe('rsdoctor defaults', () => {
  afterEach(() => {
    rs.unstubAllEnvs();
  });

  test('does not enable rsdoctor by default in production build', async () => {
    rs.stubEnv('NODE_ENV', 'production');

    const { rsbuildPlugins } = await parseConfig({}, { cwd: '' });
    expect(
      rsbuildPlugins.some(plugin => plugin.name === 'builder:rsdoctor'),
    ).toBe(false);
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

  test('defaults disableClientServer to true to avoid hanging build process', async () => {
    rs.stubEnv('NODE_ENV', 'production');

    const { rsbuildPlugins } = await parseConfig(
      {
        performance: {
          rsdoctor: true,
        },
      },
      { cwd: '' },
    );
    const rsdoctorPlugin = rsbuildPlugins.find(
      plugin => plugin.name === 'builder:rsdoctor',
    );

    expect(rsdoctorPlugin).toBeTruthy();

    let bundlerChainHandler: ((chain: any) => Promise<void>) | undefined;
    rsdoctorPlugin!.setup({
      modifyBundlerChain: (handler: (chain: any) => Promise<void>) => {
        bundlerChainHandler = handler;
      },
    } as any);

    let rsdoctorOptions: any;
    await bundlerChainHandler?.({
      plugin: () => ({
        use: (_plugin: unknown, args: unknown[]) => {
          rsdoctorOptions = args?.[0];
        },
      }),
    });

    expect(rsdoctorOptions?.disableClientServer).toBe(true);
  });

  test('allows overriding disableClientServer through object config', async () => {
    rs.stubEnv('NODE_ENV', 'production');

    const { rsbuildPlugins } = await parseConfig(
      {
        performance: {
          rsdoctor: {
            disableClientServer: false,
          },
        },
      },
      { cwd: '' },
    );
    const rsdoctorPlugin = rsbuildPlugins.find(
      plugin => plugin.name === 'builder:rsdoctor',
    );

    expect(rsdoctorPlugin).toBeTruthy();

    let bundlerChainHandler: ((chain: any) => Promise<void>) | undefined;
    rsdoctorPlugin!.setup({
      modifyBundlerChain: (handler: (chain: any) => Promise<void>) => {
        bundlerChainHandler = handler;
      },
    } as any);

    let rsdoctorOptions: any;
    await bundlerChainHandler?.({
      plugin: () => ({
        use: (_plugin: unknown, args: unknown[]) => {
          rsdoctorOptions = args?.[0];
        },
      }),
    });

    expect(rsdoctorOptions?.disableClientServer).toBe(false);
  });
});
