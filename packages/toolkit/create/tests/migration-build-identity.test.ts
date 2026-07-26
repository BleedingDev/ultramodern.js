import assert from 'node:assert/strict';
import {
  rewriteApiMarkerIdentitySchema,
  rewriteLegacyApiMarkerBinding,
} from '../src/ultramodern-tooling/commands/migrate-strict-effect/generated-artifacts-build-identity';

test('migration binds legacy API markers to the canonical build identity', () => {
  const source = `import { Schema } from '@modern-js/plugin-bff/effect-client';

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

  const migrated = rewriteLegacyApiMarkerBinding(source);

  assert.match(
    migrated,
    /export \{ ultramodernApiMarker \} from '\.\/ultramodern-build\.ts';/u,
  );
  assert.doesNotMatch(migrated, /stale-build/u);
  assert.equal(rewriteLegacyApiMarkerBinding(migrated), migrated);
  assert.match(migrated, /export const markerSchema/u);
});

test('migration preserves complete delivery-unit identity in custom Effect marker schemas', () => {
  const source = `import { Schema } from '@modern-js/plugin-bff/effect-client';

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

  const migrated = rewriteApiMarkerIdentitySchema(source);

  assert.match(migrated, /buildMarker: Schema\.String,/u);
  assert.match(migrated, /sourceRevision: Schema\.String,/u);
  assert.match(migrated, /unitId: Schema\.String,/u);
  assert.equal(rewriteApiMarkerIdentitySchema(migrated), migrated);
});
