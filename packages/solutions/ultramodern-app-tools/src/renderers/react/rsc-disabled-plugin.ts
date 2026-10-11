import type { RsbuildPlugin, Rspack } from '@rsbuild/core';

const disabledRuntimeModules = {
  'react-server-dom-rspack/client.browser': './rscDisabledClientBrowserRuntime',
  'react-server-dom-rspack/client.edge': './rscDisabledClientEdgeRuntime',
  'react-server-dom-rspack/client.node': './rscDisabledClientNodeRuntime',
  'react-server-dom-rspack/server.edge': './rscDisabledServerEdgeRuntime',
  'react-server-dom-rspack/server.node': './rscDisabledServerNodeRuntime',
} as const;

const disabledRuntimeRequests = Object.keys(disabledRuntimeModules);

function aliasMatchesRequest(aliasName: string, request: string) {
  const exact = aliasName.endsWith('$');
  const normalizedName = exact ? aliasName.slice(0, -1) : aliasName;
  return exact
    ? normalizedName === request
    : request === normalizedName || request.startsWith(`${normalizedName}/`);
}

function objectAliasMatchesDisabledRuntime(aliasName: string) {
  return disabledRuntimeRequests.some(request =>
    aliasMatchesRequest(aliasName, request),
  );
}

function arrayAliasMatchesDisabledRuntime(alias: {
  name: string;
  onlyModule?: boolean;
}) {
  const aliasName = `${alias.name}${alias.onlyModule ? '$' : ''}`;
  return objectAliasMatchesDisabledRuntime(aliasName);
}

function normalizeArrayAliases(
  aliases: Array<{
    alias: string | false | Array<string | false>;
    name: string;
    onlyModule?: boolean;
  }>,
) {
  const normalized: Record<string, string | false | Array<string | false>> = {};
  for (const alias of aliases) {
    if (arrayAliasMatchesDisabledRuntime(alias)) {
      continue;
    }
    const aliasName = `${alias.name}${alias.onlyModule ? '$' : ''}`;
    const existing = normalized[aliasName];
    if (existing === undefined) {
      normalized[aliasName] = alias.alias;
      continue;
    }
    normalized[aliasName] = [
      ...(Array.isArray(existing) ? existing : [existing]),
      ...(Array.isArray(alias.alias) ? alias.alias : [alias.alias]),
    ];
  }
  return normalized;
}

function resolveDisabledRuntimeModules() {
  return Object.fromEntries(
    Object.entries(disabledRuntimeModules).map(([request, moduleRequest]) => [
      `${request}$`,
      require.resolve(
        `@modern-js/runtime-extensions/rsc-disabled/${moduleRequest.slice(2)}`,
      ),
    ]),
  );
}

function applyDisabledRuntimeAliases(
  config: Rspack.Configuration,
  disabledAliases: Record<string, string>,
) {
  config.resolve ??= {};
  if (Array.isArray(config.resolve.alias)) {
    config.resolve.alias = {
      ...disabledAliases,
      ...normalizeArrayAliases(config.resolve.alias),
    };
  } else {
    config.resolve.alias = {
      ...disabledAliases,
      ...Object.fromEntries(
        Object.entries(config.resolve.alias ?? {}).filter(
          ([aliasName]) => !objectAliasMatchesDisabledRuntime(aliasName),
        ),
      ),
    };
  }
}

export function rscDisabledRuntimePlugin(): RsbuildPlugin {
  return {
    name: 'builder:rsc-disabled-runtime',

    setup(api) {
      const disabledAliases = resolveDisabledRuntimeModules();

      api.modifyRspackConfig({
        order: 'post',
        handler(config) {
          applyDisabledRuntimeAliases(config, disabledAliases);
        },
      });
      api.onBeforeCreateCompiler({
        order: 'post',
        handler({ bundlerConfigs }) {
          for (const config of bundlerConfigs) {
            applyDisabledRuntimeAliases(config, disabledAliases);
          }
        },
      });
    },
  };
}
