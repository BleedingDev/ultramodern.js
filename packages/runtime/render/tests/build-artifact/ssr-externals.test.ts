import fs from 'node:fs';
import path from 'node:path';

const ssrArtifactPath = path.resolve(__dirname, '../../dist/esm/ssr.mjs');
const hasArtifact = fs.existsSync(ssrArtifactPath);

// Regression guard for the rslib externals list in rslib.config.mts: when a
// self-referencing subpath ('@modern-js/render/rsc' or
// '@modern-js/render/rsc-worker') is missing from the ssr/client lib
// externals, rslib bakes a MODULE_NOT_FOUND throw stub into dist/esm/ssr.mjs
// and the corresponding RSC branch is dead in the published artifact.
describe('ssr build artifact', () => {
  test.skipIf(!hasArtifact)(
    'preserves self-referencing rsc subpath imports instead of MODULE_NOT_FOUND stubs',
    () => {
      const contents = fs.readFileSync(ssrArtifactPath, 'utf8');

      expect(contents).not.toContain('MODULE_NOT_FOUND');
      expect(contents).not.toContain('Cannot find module');
      expect(contents).toContain('import("@modern-js/render/rsc")');
      expect(contents).toContain('import("@modern-js/render/rsc-worker")');
    },
  );
});
