import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WORKSPACE_PACKAGE_VERSION } from '../../ultramodern-package-source';
import { rpcPath } from '../api/rpc';
import { createServerExecutionOverlay } from '../backend-federation';
import {
  appEmitsBrowserUi,
  appHasApi,
  remoteDependencyAlias,
  resolveApiPrefix,
  resolveApiProtocol,
  shellApp,
  ULTRAMODERN_CONFIG_PATH,
  zephyrRemoteDependency,
} from '../descriptors';
import { packageName } from '../naming';
import type {
  AddUltramodernVerticalOptions,
  UltramodernGenerationResult,
  UltramodernJsonMutation,
  UltramodernShellDependencyChange,
  UltramodernVerticalPlan,
  WorkspaceApp,
} from '../types';
import {
  DEVELOPMENT_OVERLAY_PATH,
  OWNERSHIP_PATH,
  TOPOLOGY_PATH,
} from './constants';
import { addUltramodernVertical } from './execute';
import type { AddUltramodernVerticalPreflight } from './preflight';
import { prepareAddUltramodernVertical } from './preflight';
import { ownershipEntry, verticalTopologyEntry } from './topology';

export function planUltramodernVertical(
  options: AddUltramodernVerticalOptions,
): UltramodernVerticalPlan {
  const preflight = prepareAddUltramodernVertical(options);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-vertical-plan-'));
  const copiedWorkspaceRoot = path.join(tempRoot, 'workspace');

  try {
    copyWorkspaceForPlan(options.workspaceRoot, copiedWorkspaceRoot);
    const plannedResult = addUltramodernVertical({
      ...options,
      workspaceRoot: copiedWorkspaceRoot,
      overlays: undefined,
    });

    return createVerticalPlan(preflight, {
      ...plannedResult,
      workspaceRoot: options.workspaceRoot,
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function copyWorkspaceForPlan(
  workspaceRoot: string,
  copiedWorkspaceRoot: string,
) {
  const skippedDirectories = new Set([
    '.git',
    '.nx',
    '.output',
    'coverage',
    'dist',
    'node_modules',
  ]);

  fs.cpSync(workspaceRoot, copiedWorkspaceRoot, {
    recursive: true,
    filter: sourcePath => !skippedDirectories.has(path.basename(sourcePath)),
  });
}

function createVerticalPlan(
  preflight: AddUltramodernVerticalPreflight,
  result: UltramodernGenerationResult,
): UltramodernVerticalPlan {
  const { scope, vertical, targetShell, targetVerticals } = preflight;
  const manifestUrl = `http://localhost:${vertical.port}/mf-manifest.json`;

  return {
    ...result,
    dryRun: true,
    selectedPort: vertical.port,
    moduleFederationRemote: {
      id: vertical.id,
      name: vertical.mfName,
      manifestUrl,
    },
    ...(vertical.api ? { apiPrefix: resolveApiPrefix(vertical) } : {}),
    jsonMutations: createDryRunJsonMutations(preflight, manifestUrl),
    shellDependencyChanges: createShellDependencyChanges(
      scope,
      vertical,
      targetShell,
    ),
    generatedContractChanges: [
      {
        path: ULTRAMODERN_CONFIG_PATH,
        addedAppIds: [vertical.id],
        shellVerticalRefs: targetVerticals
          .filter(appEmitsBrowserUi)
          .map(vertical => vertical.id),
      },
    ],
  };
}

function createDryRunJsonMutations(
  preflight: AddUltramodernVerticalPreflight,
  manifestUrl: string,
): UltramodernJsonMutation[] {
  const { scope, vertical, targetShell, additionalShells } = preflight;
  const additionalShellIndex = additionalShells.findIndex(
    shell => shell.id === targetShell.id,
  );
  const apiMutation: UltramodernJsonMutation[] = appHasApi(vertical)
    ? [
        {
          path: DEVELOPMENT_OVERLAY_PATH,
          pointer: `/apis/${vertical.id}`,
          description: `Add local API URL for ${vertical.id}`,
          value: `http://localhost:${vertical.port}${
            resolveApiProtocol(vertical) === 'rpc'
              ? rpcPath(vertical)
              : resolveApiPrefix(vertical)
          }`,
        },
        {
          path: DEVELOPMENT_OVERLAY_PATH,
          pointer: `/serverExecution/${vertical.id}`,
          description: `Add local MicroVertical server execution metadata for ${vertical.id}`,
          value: createServerExecutionOverlay(scope, vertical),
        },
      ]
    : [];

  const shellMutations: UltramodernJsonMutation[] =
    targetShell.id === shellApp.id
      ? [
          {
            path: TOPOLOGY_PATH,
            pointer: '/shell/verticalRefs/-',
            description: `Add ${vertical.id} to the ${targetShell.id} vertical references`,
            value: vertical.id,
          },
          {
            path: TOPOLOGY_PATH,
            pointer: '/shell/moduleFederation/remotes/-',
            description: `Register ${vertical.id} as a Module Federation remote`,
            value: {
              id: vertical.id,
              name: vertical.mfName,
              manifestUrl,
            },
          },
        ]
      : [
          {
            path: ULTRAMODERN_CONFIG_PATH,
            pointer: `/shells/${additionalShellIndex}/verticalRefs/-`,
            description: `Add ${vertical.id} to the ${targetShell.id} vertical references`,
            value: vertical.id,
          },
          {
            path: ULTRAMODERN_CONFIG_PATH,
            pointer: `/shells/${additionalShellIndex}/moduleFederation/remotes`,
            description: `Regenerate ${targetShell.id} Module Federation remotes for ${vertical.id}`,
          },
        ];

  return [
    // A headless (api-only) unit joins no shell UI composition (G2a); UI
    // units register into the TARGET shell only (G28).
    ...(appEmitsBrowserUi(vertical) ? shellMutations : []),
    {
      path: TOPOLOGY_PATH,
      pointer: '/verticals/-',
      description: `Add topology entry for ${vertical.id}`,
      value: verticalTopologyEntry(scope, vertical),
    },
    {
      path: OWNERSHIP_PATH,
      pointer: '/owners/-',
      description: `Add ownership entry for ${vertical.id}`,
      value: ownershipEntry(scope, vertical),
    },
    {
      path: DEVELOPMENT_OVERLAY_PATH,
      pointer: `/ports/${vertical.id}`,
      description: `Reserve development port ${vertical.port}`,
      value: vertical.port,
    },
    ...(appEmitsBrowserUi(vertical)
      ? [
          {
            path: DEVELOPMENT_OVERLAY_PATH,
            pointer: `/manifests/${vertical.id}`,
            description: `Add local Module Federation manifest URL for ${vertical.id}`,
            value: manifestUrl,
          },
        ]
      : []),
    ...apiMutation,
    {
      path: 'package.json',
      pointer: '/scripts',
      description: 'Regenerate workspace scripts for the new vertical set',
    },
    {
      path: `${targetShell.directory}/package.json`,
      pointer: '/dependencies',
      description: `Wire shell dependencies for ${vertical.id}`,
    },
    {
      path: 'tsconfig.json',
      pointer: '/references',
      description: `Add ${vertical.id} to the root TS-Go build graph`,
    },
    {
      path: `${targetShell.directory}/tsconfig.json`,
      pointer: '/references',
      description: `Add ${vertical.id} to the shell TS-Go project references`,
    },
    {
      path: `${targetShell.directory}/tsconfig.mf-types.json`,
      pointer: '/include',
      description: 'Keep shell Module Federation DTS compilation scoped',
    },
    {
      path: ULTRAMODERN_CONFIG_PATH,
      pointer: '/topology/apps',
      description: `Regenerate compact config with ${vertical.id}`,
    },
  ];
}

function createShellDependencyChanges(
  scope: string,
  vertical: WorkspaceApp,
  shell: WorkspaceApp,
): UltramodernShellDependencyChange[] {
  return [
    ...(appEmitsBrowserUi(vertical)
      ? [
          {
            path: `${shell.directory}/package.json`,
            section: 'zephyr:dependencies' as const,
            packageName: remoteDependencyAlias(vertical),
            version: zephyrRemoteDependency(scope, vertical),
          },
        ]
      : []),
    ...(appHasApi(vertical)
      ? [
          {
            path: `${shell.directory}/package.json`,
            section: 'dependencies' as const,
            packageName: packageName(scope, vertical.packageSuffix),
            version: WORKSPACE_PACKAGE_VERSION,
          },
        ]
      : []),
  ];
}
