import { WORKSPACE_PACKAGE_VERSION } from '../../ultramodern-package-source';
import {
  appEmitsBrowserUi,
  appHasApi,
  remoteDependencyAlias,
  resolveApiPrefix,
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
import { executeAddUltramodernVertical } from './execute';
import type { AddUltramodernVerticalPreflight } from './preflight';
import { prepareAddUltramodernVertical } from './preflight';
import { describeJsonChanges } from './preview';
import { runWorkspaceTransaction } from './transaction';

export function planUltramodernVertical(
  options: AddUltramodernVerticalOptions,
): UltramodernVerticalPlan {
  const preflight = prepareAddUltramodernVertical(options);
  let jsonMutations: UltramodernJsonMutation[] = [];
  const result = runWorkspaceTransaction(
    options.workspaceRoot,
    stagingRoot =>
      executeAddUltramodernVertical(
        { ...options, workspaceRoot: stagingRoot, overlays: undefined },
        options.workspaceRoot,
      ),
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
    moduleFederationRemote: {
      id: vertical.id,
      name: vertical.mfName,
      manifestUrl,
    },
    ...(vertical.api ? { apiPrefix: resolveApiPrefix(vertical) } : {}),
    jsonMutations,
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
