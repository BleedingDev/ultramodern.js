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
  const outputRoot = path.join(tempRoot, 'dist');

  try {
    fs.writeFileSync(path.join(tempRoot, 'api.ts'), apiSource);
    fs.writeFileSync(
      path.join(tempRoot, 'ultramodern-build.ts'),
      "export const ultramodernApiMarker = { build: 'canonical-build' } as const;\n",
    );
    const usagePath = path.join(tempRoot, 'usage.ts');
    fs.writeFileSync(usagePath, usageSource);
    const compiled = runStableTypeScript(
      [
        usagePath,
        '--ignoreConfig',
        '--module',
        'node16',
        '--moduleResolution',
        'node16',
        '--outDir',
        outputRoot,
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
      [path.join(outputRoot, 'usage.js')],
      { encoding: 'utf-8' },
    );
    assert.equal(executed.status, 0, `${executed.stdout}\n${executed.stderr}`);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
}

test('migration binds legacy API markers to the canonical build identity', () => {
  const source = `const Schema = {
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
`;

  compileAndExecute(
    rewriteLegacyApiMarkerBinding(source),
    `import { markerSchema, ultramodernApiMarker } from './api';
if (ultramodernApiMarker.build !== 'canonical-build' || markerSchema.build !== 'string') {
  throw new Error('legacy API marker migration did not bind the canonical identity');
}
`,
  );
});

test('migration preserves complete delivery-unit identity in custom Effect marker schemas', () => {
  const source = `const Schema = {
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
`;

  compileAndExecute(
    rewriteApiMarkerIdentitySchema(source),
    `import { catalogMarkerSchema } from './api';
const required = [
  'appId',
  'build',
  'buildMarker',
  'deployProfile',
  'packageName',
  'sourceRevision',
  'surface',
  'unitId',
  'version',
];
if (!required.every(field => Object.hasOwn(catalogMarkerSchema, field))) {
  throw new Error('marker schema migration dropped delivery-unit identity');
}
`,
  );
});
