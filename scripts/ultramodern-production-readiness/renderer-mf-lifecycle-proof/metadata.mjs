// SDK imports own native process signal handlers, so the proof invokes this
// metadata reader in a short-lived child rather than its resource-owning parent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  checkInstalledCohort,
  readCohort,
} from '../../ultramodern-renderers/installed-cohort.mjs';
import { fileEvidence, writeJson } from './contract.mjs';

const [inputFile, outputFile] = process.argv.slice(2);
assert(inputFile && outputFile && process.argv.length === 4);
const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const requireApp = createRequire(path.join(input.root, 'package.json'));
const sdk = requireApp('@modern-js/ultramodern-app-tools');
const profile = sdk.resolveRendererProfile('react');
const metadataPath = path.join(input.root, 'dist/renderer-build.json');
const build = sdk.validateRendererBuildManifest(
  JSON.parse(fs.readFileSync(metadataPath, 'utf8')),
  profile,
  { routerFrameworks: sdk.resolveRendererRouterFrameworks('react') },
);
assert.equal(build.sourceRevision, input.expectedSourceRevision);
const manifestPath = path.join(input.root, 'dist/mf-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
// Resolve the owning public package directly from this consumer. Its native
// collector projection is the same one used by the actual server middleware.
const cssEntry = requireApp.resolve('@modern-js/server-runtime-extensions');
const { collectModuleFederationManifestCss } = requireApp(cssEntry);
assert.equal(typeof collectModuleFederationManifestCss, 'function');
const remoteCss = collectModuleFederationManifestCss(
  manifest,
  input.manifestUrl,
);
const requireSdk = createRequire(
  requireApp.resolve('@modern-js/ultramodern-app-tools'),
);
const contractEntry = requireSdk.resolve(
  '@modern-js/federation-runtime/renderer-contract',
);
const guardEntry = requireSdk.resolve(
  '@modern-js/federation-runtime/renderer-runtime-plugin',
);
const recoveryEntry = requireSdk.resolve(
  '@modern-js/federation-runtime/manifest-recovery-runtime-plugin',
);
const contract = requireSdk(contractEntry).readRendererFederationContract(
  manifest.metaData.ultramodernRenderer,
);
assert.deepEqual({ ...contract.identities }, { ...build.entries });
const installed = checkInstalledCohort({
  appRoot: input.root,
  cohort: readCohort(input.manifestPath),
});
writeJson(outputFile, {
  build: { value: build, evidence: fileEvidence(metadataPath, input.consumer) },
  manifest: {
    value: manifest,
    evidence: fileEvidence(manifestPath, input.consumer),
  },
  css: { urls: remoteCss, collector: fileEvidence(cssEntry, input.consumer) },
  nativePlugins: [contractEntry, guardEntry, recoveryEntry].map(file =>
    fileEvidence(file, input.consumer),
  ),
  installed,
});
