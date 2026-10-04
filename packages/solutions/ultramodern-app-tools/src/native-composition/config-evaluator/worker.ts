import {
  installEffectCompilerSelectionValidator,
  resolveEffectCompilerSelection,
} from '@modern-js/app-tools-extensions/internal-effect-discovery';
import {
  isConfigInstalledDependencyPath,
  withConfigDependencyResolution,
} from './dependency-resolution';
import {
  initializeOwningConfigNativeBinding,
  initializeOwningReleaseIdentity,
} from './native-bootstrap';
import { observeConfigSourceInputs } from './observed-inputs';
import type { ConfigEvaluatorMessage, ConfigEvaluatorRequest } from './types';

// The generator can disappear while authored hooks hold other event-loop work.
// Without its owner, this evaluator must not retain processes or module caches.
process.once('disconnect', () => process.exit(1));

function finish(message: ConfigEvaluatorMessage, exitCode: number): void {
  if (!process.send) process.exit(1);
  process.send(message, () => process.exit(exitCode));
}

process.once('message', async (request: ConfigEvaluatorRequest) => {
  // A callback may await work without another event-loop handle. The parent
  // owns cancellation and the deadline until the evaluation has completed.
  process.channel?.ref();
  try {
    if (request?.kind !== 'evaluate') {
      throw new Error(
        'UltraModern config evaluator requires an evaluation request',
      );
    }
    const nativeBinding = initializeOwningConfigNativeBinding();
    await initializeOwningReleaseIdentity();
    // Declared dependency-root bookkeeping precedes authority observation;
    // its inventory is already protected by the independent source snapshot.
    const observed = await withConfigDependencyResolution(
      {
        sourceRoots: request.options.sourceRoots,
        dependencyRoots: request.options.dependencyRoots,
      },
      () => {
        const selections = [];
        for (const from of [
          request.options.configFile,
          `${request.options.appDirectory}/package.json`,
        ]) {
          if (!from) continue;
          try {
            selections.push(resolveEffectCompilerSelection(from));
          } catch {
            /* Actual compiler use must match the selected installed owner. */
          }
        }
        return observeConfigSourceInputs(
          request.options.sourceSnapshot,
          async packageMetadataRead => {
            const { loadEnv } = await import('@rsbuild/core');
            const {
              loadUltramodernConfigFile,
              resolveUltramodernEntryIdentities,
            } = await import('../config');
            loadEnv({
              cwd: request.options.appDirectory,
              mode: process.env.MODERN_ENV || request.options.env,
              prefixes: ['MODERN_'],
            });
            const loaded = await loadUltramodernConfigFile({
              appDirectory: request.options.appDirectory,
              configFile: request.options.configFile,
              env: request.options.env,
              command: request.options.command,
              packageMetadataRead,
            });
            const entryResolution = await resolveUltramodernEntryIdentities({
              appDirectory: request.options.appDirectory,
              config: loaded.config,
              command: request.options.command,
              configFile: loaded.configFile,
              packageMetadataRead,
            });
            return { renderer: loaded.config.renderer!, ...entryResolution };
          },
          isConfigInstalledDependencyPath,
          { selections, install: installEffectCompilerSelectionValidator },
          nativeBinding,
        );
      },
    );
    finish(
      {
        kind: 'result',
        result: {
          ...observed.value,
          consumedSourceInputs: observed.consumedSourceInputs,
        },
      },
      0,
    );
  } catch (value) {
    const error = value instanceof Error ? value : new Error(String(value));
    finish(
      {
        kind: 'error',
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
          ...('code' in error && typeof error.code === 'string'
            ? { code: error.code }
            : {}),
        },
      },
      1,
    );
  }
});
