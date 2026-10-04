import path from 'node:path';
import { loadUltramodernConfigSnapshot } from '@modern-js/ultramodern-app-tools/config-evaluator';
import { assertConsumedConfigInputsUnchanged } from './config-consumed-inputs';
import type { GeneratedConfigProjection } from './config-generated-projections';
import { appEmitsBrowserUi } from './descriptors';
import { createPackageRoot } from './fs-io';
import type { WorkspaceRendererEvaluation } from './renderer-identity';
import { isApplicationRenderer } from './renderer-profile';
import type { WorkspaceApp } from './types';

/** Evaluate authored config once in its owning process, retaining only metadata. */
export async function captureWorkspaceRendererEvaluations(
  workspaceRoot: string,
  apps: readonly WorkspaceApp[],
  options: {
    env?: string;
    command?: string;
    sourceRoots?: readonly string[];
    extraInputs?: readonly string[];
    dependencyRoots?: readonly string[];
  } = {},
) {
  const evaluations = new Map<string, WorkspaceRendererEvaluation>();
  const snapshots: Awaited<ReturnType<typeof loadUltramodernConfigSnapshot>>[] =
    [];
  for (const app of apps) {
    if (!appEmitsBrowserUi(app)) continue;
    const snapshot = await loadUltramodernConfigSnapshot({
      appDirectory: path.join(workspaceRoot, app.directory),
      env: options.env ?? 'development',
      command: options.command ?? 'dev',
      dependencyRoots: [createPackageRoot, ...(options.dependencyRoots ?? [])],
      sourceRoots: [...(options.sourceRoots ?? [workspaceRoot])],
      extraInputs: [...(options.extraInputs ?? [])],
    });
    if (!isApplicationRenderer(snapshot.renderer)) {
      throw new Error(
        `Application ${app.id} has no registered renderer from modern.config.`,
      );
    }
    evaluations.set(app.id, {
      renderer: snapshot.renderer,
      entries: snapshot.entries,
      primaryEntryName: snapshot.primaryEntryName,
      routerBindings: snapshot.routerBindings,
    });
    snapshots.push(snapshot);
  }
  return {
    evaluations,
    sourceSnapshots: snapshots.map(snapshot => snapshot.sourceSnapshot),
    assertConsumedInputsUnchanged(
      stagedWorkspaceRoot = workspaceRoot,
      generatedProjections?: readonly GeneratedConfigProjection[],
    ) {
      assertConsumedConfigInputsUnchanged({
        workspaceRoot,
        stagedWorkspaceRoot,
        captures: snapshots,
        generatedProjections,
      });
    },
    assertUnchanged() {
      for (const snapshot of snapshots) snapshot.assertUnchanged();
    },
  };
}
