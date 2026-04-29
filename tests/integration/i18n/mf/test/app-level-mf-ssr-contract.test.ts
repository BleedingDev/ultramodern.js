/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

const integrationRoot = path.resolve(__dirname, '../../..');

const readFixture = (relativePath: string) =>
  fs.readFileSync(path.join(integrationRoot, relativePath), 'utf8');

const mfAppLevelSsrFixtures = [
  {
    name: 'mf consumer',
    relativePath: 'i18n/mf/mf-consumer/modern.config.ts',
  },
  {
    name: 'mf app provider',
    relativePath: 'i18n/mf/mf-app-provider/modern.config.ts',
  },
];

describe('mf i18n app-level SSR contracts', () => {
  mfAppLevelSsrFixtures.forEach(({ name, relativePath }) => {
    test(`${name} keeps app-level MF SSR on official Modern.js config surfaces`, () => {
      const code = readFixture(relativePath);

      expect(code).toContain(
        "const enableAppLevelMFSSR = process.env.MODERN_MF_APP_SSR === 'true';",
      );
      expect(code).toContain('server: {');
      expect(code).toContain("mode: 'stream'");
      expect(code).toContain('moduleFederationAppSSR: true');
      expect(code).toContain('source: {');
      expect(code).toContain('define: {');
      expect(code).toContain("REMOTE_IP_STRATEGY: JSON.stringify('inherit')");
      expect(code).toContain('moduleFederationPlugin(),');
    });
  });

  test('mf app provider preserves locale redirect exemptions for MF assets', () => {
    const code = readFixture('i18n/mf/mf-app-provider/modern.config.ts');

    expect(code).toContain('ignoreRedirectRoutes: [');
    expect(code).toContain("'/mf-manifest.json'");
    expect(code).toContain("'/mf-stats.json'");
    expect(code).toContain("'/remoteEntry.js'");
  });
});
