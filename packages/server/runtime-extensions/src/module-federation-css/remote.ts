import type { Monitors } from '@modern-js/types';

import type { ModuleFederationManifest } from './manifest';

import {
  collectModuleFederationManifestCss,
  getHostManifest,
  normalizeRemoteEntry,
  warn,
} from './manifest';

const DEFAULT_REMOTE_MANIFEST_TIMEOUT = 1500;

type FetchLike = (
  input: string,
  init?: {
    signal?: AbortSignal;
  },
) => Promise<Response>;

export type CollectDirectRemoteModuleFederationCssOptions = {
  fetcher?: FetchLike;
  monitors?: Monitors;
  timeout?: number;
};

const fetchJsonWithTimeout = async (
  url: string,
  fetcher: FetchLike,
  timeout: number,
) => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const response = await Promise.race([
      fetcher(url, { signal: controller.signal }),
      new Promise<Response>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error(`Request timed out after ${timeout}ms`));
        }, timeout);
      }),
    ]);

    if (!response.ok) {
      throw new Error(`Unexpected status ${response.status}`);
    }

    return (await response.json()) as ModuleFederationManifest;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export type RemoteModuleFederationCssCollection = {
  assets: string[];
  /**
   * True when at least one remote manifest fetch failed, i.e. `assets` may be
   * incomplete and should not be cached long-term.
   */
  errored: boolean;
};

export const collectDirectRemoteModuleFederationCssWithMeta = async (
  pwd: string,
  options: CollectDirectRemoteModuleFederationCssOptions = {},
): Promise<RemoteModuleFederationCssCollection> => {
  const hostManifest = await getHostManifest(pwd, options.monitors);

  if (!hostManifest) {
    return { assets: [], errored: false };
  }

  const fetcher = options.fetcher || globalThis.fetch?.bind(globalThis);
  if (!fetcher) {
    warn(
      options.monitors,
      'Skip module federation remote CSS collection because fetch is unavailable.',
    );
    return { assets: [], errored: false };
  }

  const timeout = options.timeout ?? DEFAULT_REMOTE_MANIFEST_TIMEOUT;

  // Fetch all remote manifests in parallel so SSR latency is bounded by the
  // slowest remote rather than the sum of all remotes.
  const remoteResults = await Promise.all(
    (hostManifest.remotes || []).map(
      async (remote): Promise<{ assets: string[]; errored: boolean }> => {
        if (!remote.entry) {
          return { assets: [], errored: false };
        }

        const remoteEntry = normalizeRemoteEntry(remote.entry);
        if (!remoteEntry) {
          return { assets: [], errored: false };
        }

        let remoteManifestUrl: string;
        try {
          remoteManifestUrl = new URL(remoteEntry).toString();
        } catch {
          warn(
            options.monitors,
            'Skip module federation remote CSS collection for non-absolute manifest URL %s',
            remoteEntry,
          );
          return { assets: [], errored: false };
        }

        try {
          const remoteManifest = await fetchJsonWithTimeout(
            remoteManifestUrl,
            fetcher,
            timeout,
          );
          return {
            assets: collectModuleFederationManifestCss(
              remoteManifest,
              remoteManifestUrl,
            ),
            errored: false,
          };
        } catch (error) {
          warn(
            options.monitors,
            'Load module federation remote manifest %s failed, error = %s',
            remoteManifestUrl,
            error instanceof Error ? error.message : error,
          );
          return { assets: [], errored: true };
        }
      },
    ),
  );

  const cssAssets: string[] = [];
  const seen = new Set<string>();
  let errored = false;
  for (const result of remoteResults) {
    errored = errored || result.errored;
    for (const asset of result.assets) {
      if (!seen.has(asset)) {
        seen.add(asset);
        cssAssets.push(asset);
      }
    }
  }

  return { assets: cssAssets, errored };
};

export const collectDirectRemoteModuleFederationCss = async (
  pwd: string,
  options: CollectDirectRemoteModuleFederationCssOptions = {},
) => {
  const { assets } = await collectDirectRemoteModuleFederationCssWithMeta(
    pwd,
    options,
  );
  return assets;
};
