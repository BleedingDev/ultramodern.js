import { WORKSPACE_PACKAGE_VERSION } from '../../ultramodern-package-source';
import {
  appEmitsBrowserUi,
  appHasApi,
  remoteDependencyAlias,
  resolveApiPrefix,
  zephyrRemoteDependency,
} from '../descriptors';
import { packageName } from '../naming';
import { appSupportsFederation } from '../renderer-profile';
import type {
  AddUltramodernVerticalOptions,
  UltramodernGenerationResult,
  UltramodernJsonMutation,
  UltramodernShellDependencyChange,
  UltramodernVerticalPlan,
  WorkspaceApp,
} from '../types';
import { executeAddUltramodernVertical } from './execute';
import type { AddUltramodernVerticalPreflight } from './preflight';
import {
  prepareAddUltramodernVertical,
  stageAddUltramodernVerticalPreflight,
} from './preflight';
import { describeJsonChanges } from './preview';
import { runWorkspaceTransaction } from './transaction';

export async function planUltramodernVertical(
  options: AddUltramodernVerticalOptions,
): Promise<UltramodernVerticalPlan> {
  const originalPreflight = await prepareAddUltramodernVertical(options);
  let jsonMutations: UltramodernJsonMutation[] = [];
  const { preflight, result } = await runWorkspaceTransaction(
    options.workspaceRoot,
    async stagingRoot => {
      const stagedOptions = {
        ...options,
        workspaceRoot: stagingRoot,
      };
      const preflight = stageAddUltramodernVerticalPreflight(
        originalPreflight,
        stagingRoot,
      );
      const result = await executeAddUltramodernVertical(
        stagedOptions,
        options.workspaceRoot,
        preflight,
      );
      return { preflight, result };
    },
    {
      mode: 'preview',
      inspectChanges: changes => {
        jsonMutations = describeJsonChanges(changes);
      },
    },
  );
  return createVerticalPlan(preflight, result, jsonMutations);
}

function createVerticalPlan(
  preflight: AddUltramodernVerticalPreflight,
  result: UltramodernGenerationResult,
  jsonMutations: UltramodernJsonMutation[],
): UltramodernVerticalPlan {
  const { scope, vertical, targetShell, targetVerticals } = preflight;
  const manifestUrl = `http://localhost:${vertical.port}/mf-manifest.json`;

  return {
    ...result,
    dryRun: true,
    selectedPort: vertical.port,
    ...(appSupportsFederation(vertical)
      ? {
          moduleFederationRemote: {
            id: vertical.id,
            name: vertical.mfName,
            manifestUrl,
          },
        }
      : {}),
    ...(vertical.api ? { apiPrefix: resolveApiPrefix(vertical) } : {}),
    jsonMutations,
    shellDependencyChanges: createShellDependencyChanges(
      scope,
      vertical,
      targetShell,
    ),
    generatedContractChanges: [
      {
        path: 'topology/reference-topology.json',
        addedAppIds: [vertical.id],
        shellVerticalRefs: targetVerticals
          .filter(appEmitsBrowserUi)
          .map(vertical => vertical.id),
      },
    ],
  };
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
