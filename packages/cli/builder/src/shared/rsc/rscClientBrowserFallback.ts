import type { RsbuildPlugin } from '@rsbuild/core';
import path from 'path';

const rscClientBrowserRequest = 'react-server-dom-rspack/client.browser';

function objectAliasMatchesRequest(aliasName: string) {
  const exact = aliasName.endsWith('$');
  const normalizedName = exact ? aliasName.slice(0, -1) : aliasName;
  return exact
    ? normalizedName === rscClientBrowserRequest
    : rscClientBrowserRequest === normalizedName ||
        rscClientBrowserRequest.startsWith(`${normalizedName}/`);
}

function arrayAliasMatchesRequest(alias: {
  name: string;
  onlyModule?: boolean;
}) {
  return alias.onlyModule
    ? alias.name === rscClientBrowserRequest
    : rscClientBrowserRequest === alias.name ||
        rscClientBrowserRequest.startsWith(`${alias.name}/`);
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
    if (arrayAliasMatchesRequest(alias)) {
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

export function rscClientBrowserFallbackPlugin(): RsbuildPlugin {
  return {
    name: 'builder:rsc-client-browser-fallback',

    setup(api) {
      // Use path.resolve to handle both TypeScript source and compiled JavaScript
      // Try require.resolve first, fallback to path.resolve if it fails
      let disabledModulePath: string;
      try {
        disabledModulePath = require.resolve(
          './rscClientBrowserDisabledModule',
        );
      } catch {
        // Fallback for test environments where require.resolve may not work with TS files
        disabledModulePath = path.resolve(
          __dirname,
          'rscClientBrowserDisabledModule',
        );
      }

      api.modifyRspackConfig(config => {
        config.resolve ??= {};
        if (Array.isArray(config.resolve.alias)) {
          config.resolve.alias = {
            [`${rscClientBrowserRequest}$`]: disabledModulePath,
            ...normalizeArrayAliases(config.resolve.alias),
          };
        } else {
          config.resolve.alias = {
            [`${rscClientBrowserRequest}$`]: disabledModulePath,
            ...Object.fromEntries(
              Object.entries(config.resolve.alias ?? {}).filter(
                ([aliasName]) => !objectAliasMatchesRequest(aliasName),
              ),
            ),
          };
        }
      });
    },
  };
}
