import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  auditInstalledConsumer,
  auditReleaseArtifacts,
  testedProfileTuple,
} from './artifacts.mjs';
import {
  atomicJson,
  readEvidence,
  sourceEvidence,
} from './release-support.mjs';

// Installed SDK imports stay in a short-lived process. Native SDK signal
// handlers therefore cannot bypass the parent that owns servers and Chromium.
assert.equal(process.argv.length, 4);
const input = readEvidence(process.argv[2]).value;
const artifacts = auditReleaseArtifacts({
  manifestPath: input.manifestPath,
  expectedSourceRevision: input.expectedSourceRevision,
});
const require = createRequire(path.join(input.applicationRoot, 'package.json'));
const owner = require('@modern-js/ultramodern-app-tools');
const profile = owner.resolveRendererProfile('react');
const metadataPath = path.join(
  input.applicationRoot,
  'dist/renderer-build.json',
);
const metadata = owner.validateRendererBuildManifest(
  JSON.parse(fs.readFileSync(metadataPath)),
  profile,
);
assert.equal(Object.keys(metadata.identities).length, 1);
const identity = Object.values(metadata.identities)[0];
assert.equal(identity.renderer, 'react');
const installed = auditInstalledConsumer({
  consumerRoot: input.consumerRoot,
  applicationRoot: input.role,
  renderer: 'react',
  exactPackages: input.exactPackages,
  // Entry files are consumer-root relative; the app lives in its role dir.
  entryFiles: [
    'src/App.tsx',
    ...(input.role === 'remote' ? ['src/Proof.tsx'] : []),
  ].map(file => path.join(input.role, file)),
  testedProfile: testedProfileTuple(profile, input.exactPackages),
  releaseArtifacts: artifacts,
});
atomicJson(process.argv[3], {
  build: { metadata: sourceEvidence(metadataPath), identity },
  installed,
});
