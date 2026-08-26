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
import { type MigrationIo } from './io';

const legacyApiMarkerPattern =
  /export const ultramodernApiMarker\s*=\s*\{[\s\S]*?\}\s+as const;\n?/u;
const markerSchemaPattern =
  /(export const [A-Za-z_$][\w$]*MarkerSchema(?:\s*:[^=]+)?\s*=\s*Schema\.Struct\(\{\n)([\s\S]*?)(\n\}\);)/u;

export function rewriteLegacyApiMarkerBinding(source: string): string {
  return source.replace(
    legacyApiMarkerPattern,
    "export { ultramodernApiMarker } from './ultramodern-build.ts';\n",
  );
}

export function rewriteApiMarkerIdentitySchema(source: string): string {
  const match = source.match(markerSchemaPattern);
  if (!match) {
    return source;
  }
  let body = match[2];
  if (
    ![
      'appId',
      'build',
      'deployProfile',
      'packageName',
      'surface',
      'version',
    ].every(field =>
      new RegExp(`^\\s+${field}: Schema\\.String,\\s*$`, 'mu').test(body),
    )
  ) {
    return source;
  }
  for (const [anchor, field] of [
    ['build', 'buildMarker'],
    ['packageName', 'sourceRevision'],
    ['surface', 'unitId'],
  ]) {
    if (!new RegExp(`^\\s+${field}: Schema\\.String,\\s*$`, 'mu').test(body)) {
      body = body.replace(
        new RegExp(`^(\\s+)${anchor}: Schema\\.String,\\s*$`, 'mu'),
        `$&\n$1${field}: Schema.String,`,
      );
    }
  }
  return source.replace(
    markerSchemaPattern,
    (_full, prefix: string, _body: string, suffix: string) =>
      `${prefix}${body}${suffix}`,
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
        io.write(
          sharedApiPath,
          rewriteApiMarkerIdentitySchema(
            rewriteLegacyApiMarkerBinding(
              fs.readFileSync(sharedApiPath, 'utf-8'),
            ),
          ),
        ) || changed;
    }
    changed =
      io.writeGenerated(
        path.join(io.workspaceRoot, app.directory, 'src/ultramodern-build.ts'),
        createUltramodernBuildReexportModule(),
      ) || changed;
    changed =
      io.writeGenerated(
        path.join(
          io.workspaceRoot,
          app.directory,
          'shared/ultramodern-build.ts',
        ),
        createUltramodernBuildModule(config.workspace.packageScope, app),
      ) || changed;
    changed =
      io.write(
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
