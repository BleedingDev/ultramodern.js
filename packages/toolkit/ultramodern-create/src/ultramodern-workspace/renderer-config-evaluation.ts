import path from 'node:path';
import { loadUltramodernConfigMetadata } from '@modern-js/ultramodern-app-tools/config-metadata';
import { appEmitsBrowserUi } from './descriptors';
import { createPackageRoot } from './fs-io';
import type { WorkspaceRendererEvaluation } from './renderer-identity';
import { isApplicationRenderer } from './renderer-profile';
import type { WorkspaceApp } from './types';

/** Load each UI app's modern.config once and read its renderer and entries. */
export async function captureWorkspaceRendererEvaluations(
  workspaceRoot: string,
  apps: readonly WorkspaceApp[],
  options: {
    env?: string;
    command?: string;
    /** The workspace `workspaceRoot` was staged from, for installed imports. */
    originalWorkspaceRoot?: string;
  } = {},
): Promise<Map<string, WorkspaceRendererEvaluation>> {
  const evaluations = new Map<string, WorkspaceRendererEvaluation>();
  const uiApps = apps.filter(appEmitsBrowserUi);
  // Each app still has a fresh child process. Drain both before selecting an
  // error or starting another pair, so callers can safely clean up on failure.
  for (let offset = 0; offset < uiApps.length; offset += 2) {
    const results = await Promise.allSettled(
      uiApps.slice(offset, offset + 2).map(async app => {
        const metadata = await loadUltramodernConfigMetadata({
          appDirectory: path.join(workspaceRoot, app.directory),
          env: options.env ?? 'development',
          command: options.command ?? 'dev',
          sourceRoot: workspaceRoot,
          ...(options.originalWorkspaceRoot &&
          path.resolve(options.originalWorkspaceRoot) !==
            path.resolve(workspaceRoot)
            ? {
                stagedWorkspace: {
                  root: path.resolve(workspaceRoot),
                  originalRoot: path.resolve(options.originalWorkspaceRoot),
                },
              }
            : {}),
          fallbackPackageRoots: [createPackageRoot],
        });
        if (!isApplicationRenderer(metadata.renderer)) {
          throw new Error(
            `Application ${app.id} has no registered renderer from modern.config.`,
          );
        }
        return {
          id: app.id,
          evaluation: {
            renderer: metadata.renderer,
            entries: metadata.entries,
            primaryEntryName: metadata.primaryEntryName,
            routerBindings: metadata.routerBindings,
          },
        };
      }),
    );
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      evaluations.set(result.value.id, result.value.evaluation);
    }
  }
  return evaluations;
}
