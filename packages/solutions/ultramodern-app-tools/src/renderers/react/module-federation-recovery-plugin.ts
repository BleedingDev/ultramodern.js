import { createRequire } from 'node:module';
import path from 'node:path';
import type { AppTools, CliPlugin } from '@modern-js/app-tools';

// This is the server plugin key exported by the admitted native MF integration.
// Keeping the optional integration lazy avoids loading MF for ordinary React apps.
const NATIVE_SERVER_PLUGIN = 'plugin-module-federation-server';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const resolveManifestRecoveryRuntimePlugin = (
  registrarUrl: string,
): string =>
  createRequire(registrarUrl).resolve(
    '@modern-js/federation-runtime/manifest-recovery-runtime-plugin',
  );

const resolveNativeNodeRuntimePlugins = (appDirectory: string): string[] => {
  const applicationRequire = createRequire(
    path.join(appDirectory, 'package.json'),
  );
  const nativeRequire = createRequire(
    applicationRequire.resolve('@module-federation/modern-js-v3'),
  );
  const manifestPath = nativeRequire.resolve(
    '@module-federation/node/package.json',
  );
  const manifest: unknown = nativeRequire(manifestPath);
  const entry =
    isRecord(manifest) && isRecord(manifest.exports)
      ? manifest.exports['./runtimePlugin']
      : undefined;
  const importTarget =
    isRecord(entry) && isRecord(entry.import)
      ? entry.import.default
      : undefined;
  if (typeof importTarget !== 'string') {
    throw new Error('The native MF node runtime has no declared import entry.');
  }
  return [
    nativeRequire.resolve('@module-federation/node/runtimePlugin'),
    nativeRequire.resolve(
      path.resolve(path.dirname(manifestPath), importTarget),
    ),
  ];
};

const runtimePluginPath = (plugin: unknown): unknown =>
  Array.isArray(plugin) ? plugin[0] : plugin;

/** Supply the fork runtime through the native server federation chain. */
export const ultramodernModuleFederationRecoveryPlugin =
  (): CliPlugin<AppTools> => ({
    name: '@modern-js/ultramodern-module-federation-recovery',
    pre: [
      '@modern-js/plugin-module-federation-config',
      '@modern-js/plugin-module-federation-ssr',
    ],
    setup(api) {
      api.modifyBundlerChain(chain => {
        if (!chain.plugins.has(NATIVE_SERVER_PLUGIN)) return;
        const recovery = resolveManifestRecoveryRuntimePlugin(import.meta.url);
        const nativeNodeRuntime = resolveNativeNodeRuntimePlugins(
          api.getAppContext().appDirectory,
        );
        chain.plugin(NATIVE_SERVER_PLUGIN).tap(args => {
          const options: unknown = args[0];
          const config =
            isRecord(options) && isRecord(options.mfConfig)
              ? options.mfConfig
              : options;
          if (!isRecord(config) || !Array.isArray(config.runtimePlugins)) {
            throw new Error(
              'The native MF server runtime configuration is absent.',
            );
          }
          const runtimePlugins: unknown[] = config.runtimePlugins;
          if (
            runtimePlugins.some(
              plugin => runtimePluginPath(plugin) === recovery,
            )
          ) {
            return args;
          }
          const nodeIndex = runtimePlugins.findIndex(plugin => {
            const candidate = runtimePluginPath(plugin);
            return (
              typeof candidate === 'string' &&
              nativeNodeRuntime.includes(candidate)
            );
          });
          if (nodeIndex < 0) {
            throw new Error(
              'The native MF server node runtime registration is absent.',
            );
          }
          config.runtimePlugins = [
            ...runtimePlugins.slice(0, nodeIndex),
            recovery,
            ...runtimePlugins.slice(nodeIndex),
          ];
          return args;
        });
      });
    },
  });
