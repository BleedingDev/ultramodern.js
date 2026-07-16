import assert from 'node:assert/strict';
import { rewriteLegacyApiMarkerBinding } from '../src/ultramodern-tooling/commands/migrate-strict-effect/generated-artifacts-build-identity';

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
