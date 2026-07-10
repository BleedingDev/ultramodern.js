import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  assertOverlayPreservedBaseline,
  captureOverlayBaselineSnapshot,
} from './overlay-baseline-guard';
import type {
  UltramodernCodeSmithOverlay,
  UltramodernCodeSmithOverlayRuntimeConfig,
  UltramodernGenerationResult,
} from './types';

const require = createRequire(import.meta.url);

/**
 * Resolve the shell package directories to protect from overlay relaxation
 * (G21). Shells live under `apps/` in a generated workspace; a Platform Overlay
 * may narrow but never relax any of them, and additional shells (G28) are
 * covered without needing the operation's created-app set.
 */
function resolveShellPackageDirectories(workspaceRoot: string): string[] {
  const appsRoot = path.join(workspaceRoot, 'apps');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(appsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => `apps/${entry.name}`)
    .sort();
}

const overlayRunnerSource = `
const fs = require('node:fs');

(async () => {
  const payload = JSON.parse(fs.readFileSync(0, 'utf-8'));
  const { CodeSmith } = require(payload.codesmithModulePath);
  const codesmith = new CodeSmith({});
  await codesmith.forge({
    pwd: payload.workspaceRoot,
    tasks: [
      {
        generator: payload.generator,
        config: payload.config,
      },
    ],
  });
})().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
`;

export function runCodeSmithOverlays(options: {
  workspaceRoot: string;
  overlays?: UltramodernCodeSmithOverlay[];
  result: UltramodernGenerationResult;
}) {
  if (!options.overlays?.length) {
    return;
  }

  // Capture the Platform Baseline BEFORE any overlay writes (G21). The
  // pre-overlay workspace is the framework's baseline; every overlay is
  // validated against it and a relaxing overlay fails before its output is
  // accepted.
  const snapshot = captureOverlayBaselineSnapshot(
    options.workspaceRoot,
    resolveShellPackageDirectories(options.workspaceRoot),
  );

  for (const overlay of options.overlays) {
    runCodeSmithOverlay({
      workspaceRoot: options.workspaceRoot,
      overlay,
      config: createOverlayRuntimeConfig(options.workspaceRoot, options.result),
    });
    assertOverlayPreservedBaseline({
      workspaceRoot: options.workspaceRoot,
      generator: overlay.generator,
      snapshot,
    });
  }
}

function runCodeSmithOverlay(options: {
  workspaceRoot: string;
  overlay: UltramodernCodeSmithOverlay;
  config: UltramodernCodeSmithOverlayRuntimeConfig;
}) {
  const result = spawnSync(process.execPath, ['--eval', overlayRunnerSource], {
    cwd: options.workspaceRoot,
    encoding: 'utf8',
    input: JSON.stringify({
      workspaceRoot: options.workspaceRoot,
      generator: options.overlay.generator,
      codesmithModulePath: require.resolve('@modern-js/codesmith'),
      config: {
        ...(options.overlay.config ?? {}),
        ...options.config,
      },
    }),
  });

  if (result.status !== 0) {
    const detail = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join('\n');
    throw new Error(
      [
        `UltraModern CodeSmith overlay failed: ${options.overlay.generator}`,
        detail,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

function createOverlayRuntimeConfig(
  workspaceRoot: string,
  result: UltramodernGenerationResult,
): UltramodernCodeSmithOverlayRuntimeConfig {
  const generatedApp = result.createdApps[0];
  return {
    workspaceRoot,
    packageScope: result.packageScope,
    operation: result.operation,
    generatedApp,
    generatedApps: result.createdApps,
    assignedPort: generatedApp
      ? result.assignedPorts[generatedApp.id]
      : undefined,
    assignedPorts: result.assignedPorts,
    moduleFederationName: generatedApp
      ? result.moduleFederationNames[generatedApp.id]
      : undefined,
    moduleFederationNames: result.moduleFederationNames,
    apiPrefix: generatedApp ? result.apiPrefixes[generatedApp.id] : undefined,
    apiPrefixes: result.apiPrefixes,
    packageSource: result.packageSource,
    generationResult: result,
  };
}
