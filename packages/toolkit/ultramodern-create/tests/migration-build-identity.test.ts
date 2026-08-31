import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  rewriteApiMarkerIdentitySchema,
  rewriteLegacyApiMarkerBinding,
} from '../src/ultramodern-tooling/commands/migrate-strict-effect/generated-artifacts-build-identity';
import { runStableTypeScript } from './helpers/stable-typescript';

function compileAndExecute(apiSource: string, usageSource: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-identity-'));
  try {
    fs.writeFileSync(path.join(tempRoot, 'api.ts'), apiSource);
    fs.writeFileSync(
      path.join(tempRoot, 'ultramodern-build.ts'),
      "export const ultramodernApiMarker = { build: 'canonical-build' } as const;\n",
    );
    fs.writeFileSync(path.join(tempRoot, 'usage.ts'), usageSource);
    const compiled = runStableTypeScript(
      [
        'usage.ts',
        '--ignoreConfig',
        '--module',
        'node16',
        '--moduleResolution',
        'node16',
        '--outDir',
        'dist',
        '--pretty',
        'false',
        '--rewriteRelativeImportExtensions',
        '--skipLibCheck',
        '--strict',
        '--target',
        'es2022',
      ],
      tempRoot,
    );
    assert.equal(compiled.status, 0, compiled.output);
    const executed = spawnSync(
      process.execPath,
      [path.join(tempRoot, 'dist/usage.js')],
      {
        encoding: 'utf-8',
      },
    );
    assert.equal(executed.status, 0, `${executed.stdout}\n${executed.stderr}`);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
}

test('migration binds legacy API markers to the canonical build identity', () => {
  compileAndExecute(
    rewriteLegacyApiMarkerBinding(`const Schema = {
  String: 'string',
  Struct: <T>(value: T) => value,
};
export const ultramodernApiMarker = {
  appId: 'catalog',
  build: 'stale-build',
  deployProfile: 'cloudflare-ssr-mf-effect-v1',
  packageName: '@demo/catalog',
  surface: 'effect-bff',
  version: '0.1.0',
} as const;
export const markerSchema = Schema.Struct({ build: Schema.String });
`),
    `import { markerSchema, ultramodernApiMarker } from './api';
if (ultramodernApiMarker.build !== 'canonical-build' || markerSchema.build !== 'string') throw new Error('identity');
`,
  );
});

test('migration preserves complete delivery-unit identity in custom Effect marker schemas', () => {
  compileAndExecute(
    rewriteApiMarkerIdentitySchema(`const Schema = {
  String: 'string',
  Struct: <T>(value: T) => value,
};
export const catalogMarkerSchema = Schema.Struct({
  appId: Schema.String,
  build: Schema.String,
  deployProfile: Schema.String,
  packageName: Schema.String,
  surface: Schema.String,
  version: Schema.String,
});
export { ultramodernApiMarker } from './ultramodern-build.ts';
`),
    `import { catalogMarkerSchema } from './api';
const required = ['appId', 'build', 'buildMarker', 'deployProfile', 'packageName', 'sourceRevision', 'surface', 'unitId', 'version'];
if (!required.every(field => Object.hasOwn(catalogMarkerSchema, field))) throw new Error('schema');
`,
  );
});
