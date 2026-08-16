import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pluginManifest = require('../package.json') as {
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};
const runtimeManifest = require('../../plugin-runtime/package.json') as {
  peerDependencies: Record<string, string>;
};

describe('plugin-i18n peer cohort', () => {
  test('matches the required runtime React cohort without overstating i18n floors', () => {
    expect(pluginManifest.peerDependencies).toMatchObject({
      i18next: '>=25.7.4',
      react: runtimeManifest.peerDependencies.react,
      'react-dom': runtimeManifest.peerDependencies['react-dom'],
      'react-i18next': '>=15.7.4',
    });
    expect(pluginManifest.peerDependenciesMeta).toMatchObject({
      i18next: { optional: true },
      'react-i18next': { optional: true },
    });
  });
});
