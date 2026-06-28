import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type {
  UltramodernCodeSmithOverlay,
  UltramodernCodeSmithOverlayRuntimeConfig,
  UltramodernGenerationResult,
} from './types';

const require = createRequire(import.meta.url);

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

  for (const overlay of options.overlays) {
    runCodeSmithOverlay({
      workspaceRoot: options.workspaceRoot,
      overlay,
      config: createOverlayRuntimeConfig(options.workspaceRoot, options.result),
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
