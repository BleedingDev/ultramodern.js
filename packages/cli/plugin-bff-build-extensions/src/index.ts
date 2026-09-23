import '@modern-js/server-runtime-extensions/server-config';
import type { AppTools, BffGeneration, CliPlugin } from '@modern-js/app-tools';
import { bffPlugin as nativeBffPlugin } from '@modern-js/plugin-bff';
import { fs, upath as path } from '@modern-js/utils';
import {
  BFF_REQUEST_RUNTIME,
  type BffGenerationMetadata,
  registerBffClientArtifacts,
} from './client-artifacts';
import { registerBffCompilation } from './compile';
import { registerBffGeneratedEntries } from './generated-entries';
import { resolveSelfModule } from './self-module';

export const bffPlugin = (): CliPlugin<AppTools> => ({
  name: '@modern-js/plugin-bff-build-extensions',
  usePlugins: [nativeBffPlugin()],
  pre: ['@modern-js/plugin-bff'],
  setup: api => {
    const hooks = api.getHooks();
    for (const name of [
      'onBeforeBffCompile',
      'onAfterBffCompile',
      'modifyBffClientArtifacts',
      'modifyBffGeneratedEntries',
    ] as const) {
      if (typeof hooks[name]?.tap !== 'function')
        throw new Error(`Native BFF build hook ${name} is unavailable.`);
    }
    api.config(() => ({
      bff: {
        requestCreator: BFF_REQUEST_RUNTIME,
        runtimeCreateRequest: BFF_REQUEST_RUNTIME,
        clientCodegenPlugin: resolveSelfModule('hono-client-codegen'),
      },
    }));
    const runtimeFramework = api.getConfig()?.bff?.runtimeFramework;
    if (
      runtimeFramework !== undefined &&
      runtimeFramework !== 'hono' &&
      runtimeFramework !== 'effect'
    ) {
      throw new Error(`Unsupported Effect BFF runtime "${runtimeFramework}".`);
    }
    api.updateAppContext({ bffRuntimeFramework: runtimeFramework ?? 'effect' });
    api._internalServerPlugins(({ plugins }) => {
      const nativePlugins = plugins.filter(
        plugin => plugin.name === '@modern-js/plugin-bff/server-plugin',
      );
      if (nativePlugins.length !== 1) {
        throw new Error('Expected exactly one native BFF server plugin.');
      }
      const native = nativePlugins[0]!;
      const runtimeAdapters = native.options?.runtimeAdapters ?? {};
      const effect = '@modern-js/plugin-bff-extensions/effect-adapter';
      const honoRouteBinder = '@modern-js/plugin-bff-extensions/hono/node';
      if (
        native.options?.honoRouteBinder !== undefined &&
        native.options.honoRouteBinder !== honoRouteBinder
      ) {
        throw new Error('The Hono BFF route binder is already configured.');
      }
      if (
        runtimeAdapters.effect !== undefined &&
        runtimeAdapters.effect !== effect
      ) {
        throw new Error(
          'The Effect BFF runtime adapter is already configured.',
        );
      }
      native.options = {
        ...native.options,
        honoRouteBinder,
        runtimeAdapters: { ...runtimeAdapters, effect },
      };
      native.includeEntries = [
        ...new Set([
          ...(native.includeEntries ?? []),
          runtimeFramework === 'hono' ? honoRouteBinder : effect,
        ]),
      ];
      return { plugins };
    });
    const metadata = new WeakMap<BffGeneration, BffGenerationMetadata>();
    registerBffCompilation(api);
    registerBffClientArtifacts(api, metadata);
    registerBffGeneratedEntries(api, metadata);
    api.modifyBundlerChain(async (chain, { CHAIN_ID }) => {
      if (api.getAppContext().bffRuntimeFramework !== 'effect') return;
      const { appDirectory, apiDirectory } = api.getAppContext();
      const bff = api.getNormalizedConfig().bff;
      if (!fs.existsSync(apiDirectory) && bff?.effect?.entry === undefined)
        return;
      const { resolveEffectEntryFile } = await import(
        '@modern-js/plugin-bff-extensions/effect-source-loader'
      );
      const entry = resolveEffectEntryFile({
        appDir: appDirectory,
        apiDir: apiDirectory,
        effectEntry: bff?.effect?.entry,
      });
      if (!entry)
        throw new Error(`Cannot resolve Effect BFF entry in ${apiDirectory}.`);
      const canonical = (file: string) =>
        path.normalize(
          fs.existsSync(file) ? fs.realpathSync(file) : path.resolve(file),
        );
      const entryPath = canonical(entry);
      const isEntry = (resource: string) => canonical(resource) === entryPath;
      chain.module.rule(CHAIN_ID.RULE.JS).exclude.add(isEntry);
      chain.module.rule('js-bff-api').exclude.add(isEntry);
      chain.module
        .rule('js-bff-effect-entry')
        .test(isEntry)
        .use('effect-bff-loader')
        .loader(
          require.resolve(
            '@modern-js/plugin-bff-extensions/effect-source-loader/rspack-loader',
          ),
        )
        .options({
          appDir: appDirectory,
          apiDir: apiDirectory,
          effectEntry: entry,
          prefix: Array.isArray(bff?.prefix)
            ? bff.prefix[0]
            : bff?.prefix || '/api',
          requestId: bff?.requestId,
        });
    });
  },
});

export default bffPlugin;
