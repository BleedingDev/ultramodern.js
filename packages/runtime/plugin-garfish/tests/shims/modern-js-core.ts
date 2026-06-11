/**
 * Test shim for the removed `@modern-js/core` package (dropped upstream in
 * #7373 and absent from the workspace lockfile). It re-implements the tiny
 * slice of the legacy CLI plugin manager that the fork-retained garfish
 * tests exercise: `manager.clone(api).usePlugin(plugin)` followed by
 * `init()` and the `prepare` / `resolvedConfig` / `config` runner hooks.
 *
 * Hook semantics mirror the legacy manager:
 * - `prepare` is a fire-and-forget worker hook,
 * - `resolvedConfig` is an async waterfall (each handler receives the
 *   previous handler's return value),
 * - `config` is a collect hook returning one entry per plugin.
 */

type PluginApi = Record<string, (...args: any[]) => any>;

type PluginHooks = Record<string, ((...args: any[]) => any) | undefined>;

interface LegacyPlugin {
  name: string;
  setup: (api: PluginApi) => PluginHooks | Promise<PluginHooks>;
}

type LegacyPluginInput = LegacyPlugin | (() => LegacyPlugin);

const defaultApi: PluginApi = {
  useAppContext: () => ({}),
  useConfigContext: () => ({}),
  useResolvedConfigContext: () => ({}),
};

function createManager(apiOverrides: PluginApi = {}) {
  const api: PluginApi = { ...defaultApi, ...apiOverrides };
  const plugins: LegacyPlugin[] = [];

  const manager = {
    clone(nextOverrides: PluginApi = {}) {
      return createManager({ ...apiOverrides, ...nextOverrides });
    },
    usePlugin(plugin: LegacyPluginInput) {
      plugins.push(typeof plugin === 'function' ? plugin() : plugin);
      return manager;
    },
    async init() {
      const hookSets: PluginHooks[] = [];
      for (const plugin of plugins) {
        hookSets.push(await plugin.setup(api));
      }

      return {
        async prepare() {
          for (const hooks of hookSets) {
            await hooks.prepare?.();
          }
        },
        async resolvedConfig<T>(input: T): Promise<T> {
          let current = input;
          for (const hooks of hookSets) {
            if (hooks.resolvedConfig) {
              current = await hooks.resolvedConfig(current);
            }
          }
          return current;
        },
        async config() {
          const collected: unknown[] = [];
          for (const hooks of hookSets) {
            if (hooks.config) {
              collected.push(await hooks.config());
            }
          }
          return collected;
        },
      };
    },
  };

  return manager;
}

export const manager = createManager();

// Type-level stand-ins for the legacy `@modern-js/core` exports that the
// garfish sources import via `import type { ... }` (erased at runtime).
export type CliPlugin = LegacyPluginInput;
export type CliHookCallbacks = PluginHooks;
export const useConfigContext = (): Record<string, any> => ({});
