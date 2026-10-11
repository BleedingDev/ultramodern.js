import type { AppTools, CliPlugin } from '@modern-js/app-tools';

const runtimePaths = new Map([
  ['@modern-js/plugin-i18n/runtime', '@modern-js/i18n-integration/runtime'],
  [
    '@modern-js/plugin-i18n/runtime/no-react-i18next',
    '@modern-js/i18n-integration/runtime/no-react-i18next',
  ],
]);

/** Compose fork policy with the native plugin's own descriptor generation. */
export const ultramodernI18nIntegrationPlugin = (): CliPlugin<AppTools> => ({
  name: '@modern-js/i18n-integration',
  pre: ['@modern-js/plugin-i18n'],
  setup(api) {
    api._internalRuntimePlugins(({ entrypoint, plugins }) => ({
      entrypoint,
      plugins: plugins.map(plugin => {
        const path = runtimePaths.get(plugin.path);
        return path ? { ...plugin, path } : plugin;
      }),
    }));

    // The native server plugin derives its URL policy from
    // `localeDetection.localisedUrls`, so its descriptor needs no replacement.

    // Localised route generation used to live here. It now ships in
    // `@modern-js/plugin-i18n`'s own CLI plugin so a bare `appTools()`
    // consumer gets it too; registering it in both places would expand the
    // route tree twice. This plugin keeps only the fork's runtime-module
    // swap, which is the part that genuinely needs the integration runtime.
  },
});

export default ultramodernI18nIntegrationPlugin;
