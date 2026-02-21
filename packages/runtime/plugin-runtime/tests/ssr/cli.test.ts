import { isModuleFederationAppSSRAlphaEnabled } from '../../src/ssr/cli';

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
});
