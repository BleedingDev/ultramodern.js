import path from 'path';
import {
  isModuleFederationAppSSRAlphaEnabled,
  ssrPlugin,
} from '../../src/ssr/cli';

describe('ssr cli alpha contracts', () => {
  it('returns false by default', () => {
    expect(
      isModuleFederationAppSSRAlphaEnabled({
        server: {},
      } as any),
    ).toBe(false);
  });

  it('returns true when enabled on server.ssr', () => {
    expect(
      isModuleFederationAppSSRAlphaEnabled({
        server: {
          ssr: {
            moduleFederationAppSSRAlpha: true,
          },
        },
      } as any),
    ).toBe(true);
  });

  it('returns true when enabled on server.ssrByEntries', () => {
    expect(
      isModuleFederationAppSSRAlphaEnabled({
        server: {
          ssrByEntries: {
            main: false,
            dashboard: {
              moduleFederationAppSSRAlpha: true,
            },
          },
        },
      } as any),
    ).toBe(true);
  });

  it('returns false when no entry has alpha enabled', () => {
    expect(
      isModuleFederationAppSSRAlphaEnabled({
        server: {
          ssrByEntries: {
            main: false,
            dashboard: {
              moduleFederationAppSSRAlpha: false,
            },
          },
        },
      } as any),
    ).toBe(false);
  });
});

describe('ssr cli global vars contracts', () => {
  const createConfig = (normalizedConfig: Record<string, unknown>) => {
    const plugin = ssrPlugin();
    const hooks = plugin.setup({
      useAppContext: jest.fn(() => ({
        internalDirectory: path.join(__dirname, './feature'),
      })),
      useResolvedConfigContext: jest.fn(() => normalizedConfig),
    } as any);

    return hooks.config!();
  };

  it('injects MODERN_MF_APP_SSR_ALPHA=true when flag is enabled', () => {
    const config = createConfig({
      server: {
        ssr: {
          moduleFederationAppSSRAlpha: true,
        },
      },
    });
    const values: Record<string, string> = {};
    config.source.globalVars(values, { target: 'node' } as any);

    expect(values['process.env.MODERN_TARGET']).toBe('node');
    expect(values['process.env.MODERN_MF_APP_SSR_ALPHA']).toBe('true');
  });

  it('injects MODERN_MF_APP_SSR_ALPHA=false by default', () => {
    const config = createConfig({
      server: {},
    });
    const values: Record<string, string> = {};
    config.source.globalVars(values, { target: 'web' } as any);

    expect(values['process.env.MODERN_TARGET']).toBe('browser');
    expect(values['process.env.MODERN_MF_APP_SSR_ALPHA']).toBe('false');
  });
});
