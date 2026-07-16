import fs from 'node:fs';
import path from 'node:path';
import {
  createUltramodernBuildArtifactJson,
  createUltramodernBuildModule,
  createUltramodernBuildReexportModule,
} from '../../../ultramodern-workspace/module-federation';
import {
  allWorkspaceAppsFromToolingConfig,
  type UltramodernToolingConfig,
} from '../../config';
import { type MigrationIo, writeTextIfChanged } from './io';

const legacyApiMarkerPattern =
  /export const ultramodernApiMarker\s*=\s*\{[\s\S]*?\}\s+as const;\n?/u;

export function rewriteLegacyApiMarkerBinding(source: string): string {
  if (!legacyApiMarkerPattern.test(source)) {
    return source;
  }
  return source.replace(
    legacyApiMarkerPattern,
    "export { ultramodernApiMarker } from './ultramodern-build.ts';\n",
  );
}

export function updateGeneratedBuildIdentityModules(
  io: MigrationIo,
  config: UltramodernToolingConfig,
) {
  let changed = false;
  for (const app of allWorkspaceAppsFromToolingConfig(config)) {
    const sharedApiPath = path.join(
      io.workspaceRoot,
      app.directory,
      'shared/api.ts',
    );
    if (app.api && fs.existsSync(sharedApiPath)) {
      changed =
        writeTextIfChanged(
          io,
          sharedApiPath,
          rewriteLegacyApiMarkerBinding(
            fs.readFileSync(sharedApiPath, 'utf-8'),
          ),
        ) || changed;
    }
    changed =
      writeTextIfChanged(
        io,
        path.join(io.workspaceRoot, app.directory, 'src/ultramodern-build.ts'),
        createUltramodernBuildReexportModule(),
      ) || changed;
    changed =
      writeTextIfChanged(
        io,
        path.join(
          io.workspaceRoot,
          app.directory,
          'shared/ultramodern-build.ts',
        ),
        createUltramodernBuildModule(config.workspace.packageScope, app),
      ) || changed;
    changed =
      writeTextIfChanged(
        io,
        path.join(
          io.workspaceRoot,
          app.directory,
          'shared/ultramodern-build.json',
        ),
        createUltramodernBuildArtifactJson(config.workspace.packageScope, app),
      ) || changed;
  }
  return changed;
}
