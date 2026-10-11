import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CloudflareWorkerSecurityConfig } from './config';

export const REFERENCE_TOPOLOGY_PATH = 'topology/reference-topology.json';
export const DEVELOPMENT_OVERLAY_PATH =
  'topology/local-overlays/development.json';

/** Fields consumed from the existing workspace topology by native plugins. */
export type TopologyApp = {
  id?: unknown;
  domain?: unknown;
  kind?: unknown;
  path?: unknown;
  package?: unknown;
  portEnv?: unknown;
  surfaceProfile?: unknown;
  verticalRefs?: unknown;
  cloudflare?: {
    workerName?: unknown;
    publicUrlEnv?: unknown;
    compatibilityDate?: unknown;
    security?: CloudflareWorkerSecurityConfig;
  };
  api?: {
    bff?: { prefix?: unknown };
    protocol?: unknown;
    rpcPath?: unknown;
    rpcSerialization?: unknown;
    stem?: unknown;
  };
  moduleFederation?: {
    name?: unknown;
    manifestUrl?: unknown;
    exposes?: unknown;
    verticalRefs?: unknown;
    remotes?: unknown;
  };
  backendFederation?: {
    name?: unknown;
    versionBoundary?: {
      ui?: { manifestUrl?: unknown };
    };
    executionSurfaces?: {
      node?: {
        remoteName?: unknown;
        manifestUrl?: unknown;
        containerEntry?: unknown;
        remoteType?: unknown;
      };
      cloudflare?: {
        workerName?: unknown;
        workerDispatch?: {
          serviceBinding?: unknown;
          serviceBindingEnv?: unknown;
          dispatchWorkerNameEnv?: unknown;
        };
      };
    };
  };
  deliveryUnit?: {
    unitId?: unknown;
    buildMarker?: unknown;
    sourceRevision?: unknown;
    packageName?: unknown;
    version?: unknown;
  };
};

export type DevelopmentOverlay = {
  schemaVersion?: unknown;
  ports?: Record<string, unknown>;
  manifests?: Record<string, unknown>;
  serverExecution?: Record<
    string,
    {
      node?: {
        remoteName?: unknown;
        manifestUrl?: unknown;
        containerEntry?: unknown;
        remoteType?: unknown;
      };
    }
  >;
};

export type ReferenceTopology = {
  schemaVersion?: unknown;
  shell?: TopologyApp;
  shells?: TopologyApp[];
  verticals?: TopologyApp[];
};

export const normalizeRelativePath = (value: string) =>
  value.replace(/\\/gu, '/').replace(/^\.\/+/u, '');

/** Shared by the generated route and the native Worker service binding. */
export const distributedSsrFragmentSlug = (expose: string) => {
  const slug = expose
    .replace(/^\.\//u, '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/[._]+/gu, '-')
    .toLowerCase()
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (!slug) throw new Error(`Invalid distributed SSR expose ${expose}.`);
  return slug;
};

export const distributedSsrFragmentRoute = (expose: string) =>
  `/{locale}/_mf/fragment/${distributedSsrFragmentSlug(expose)}`;

export const findWorkspaceRoot = (appDirectory: string) => {
  let current = appDirectory;
  while (true) {
    if (existsSync(path.join(current, REFERENCE_TOPOLOGY_PATH))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};
