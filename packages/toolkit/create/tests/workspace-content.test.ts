import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

const fixturesDir = path.join(__dirname, 'fixtures');

/**
 * Full-content snapshots of the highest-risk rendered files. The manifest
 * snapshot (workspace-manifest.test.ts) only pins file *names*, so these
 * fixtures pin the rendered *bytes* of one representative file per risk
 * class:
 *
 * - shell-frame.tsx: verbatim template copy (templates/app/shell-frame.tsx)
 *   that must survive template moves unchanged.
 * - ultramodern-route-head.tsx: rendered through the {{placeholder}}
 *   renderer while containing literal `{{ ... }}` JSX text — the
 *   placeholder-collision risk class. The fixture proves intended
 *   placeholders are substituted and literal brace text is left intact.
 * - scripts/validate-ultramodern-workspace.mjs: the most placeholder-dense
 *   handlebars template; snapshotted after a vertical joins so every
 *   data-driven placeholder (verticals, route metadata, security contract)
 *   is exercised.
 * - verticals/catalog/shared/effect/api.ts: fully code-generated Effect API
 *   contract file (no template on disk), the pure-codegen risk class.
 * - verticals/catalog/src/routes/[lang]/page.tsx: the vertical page emitted
 *   by createRemotePage — inline-literal TSX codegen where an undeclared
 *   identifier (`supportedLanguages`) once shipped and broke typecheck of
 *   every --vertical workspace.
 *
 * Inputs are pinned (modernVersion, packageSource specifier, scope), so the
 * output is deterministic. If a content change is deliberate, regenerate the
 * fixture from a fresh scaffold with these exact inputs.
 */
const defaultScaffoldSnapshots = [
  'apps/shell-super-app/src/routes/shell-frame.tsx',
  'apps/shell-super-app/src/routes/ultramodern-route-head.tsx',
];

const catalogVerticalSnapshots = [
  'scripts/validate-ultramodern-workspace.mjs',
  'verticals/catalog/shared/effect/api.ts',
  'verticals/catalog/src/routes/[lang]/page.tsx',
];

function assertContentSnapshot(
  workspaceDir: string,
  fixtureGroup: string,
  relativePath: string,
) {
  const actual = fs.readFileSync(
    path.join(workspaceDir, relativePath),
    'utf-8',
  );
  const expected = fs.readFileSync(
    path.join(fixturesDir, fixtureGroup, `${relativePath}.snap`),
    'utf-8',
  );
  assert.equal(
    actual,
    expected,
    `Rendered content of ${relativePath} diverged from tests/fixtures/${fixtureGroup}/${relativePath}.snap — update the fixture only for intentional output changes.`,
  );
}

test('rendered contents of the highest-risk generated files match the checked-in snapshots', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-workspace-content-'),
  );
  const workspaceDir = path.join(tempRoot, 'manifest-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'manifest-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: {
        strategy: 'install',
        modernPackageVersion: '3.2.0-ultramodern.108',
      },
    });
    for (const relativePath of defaultScaffoldSnapshots) {
      assertContentSnapshot(workspaceDir, 'default-scaffold', relativePath);
    }

    // Provenance contract: the manifest must point at the live module
    // generator (the pre-split monolith path is gone) and the integrity
    // checksums must cover both template trees that produce output.
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(
          workspaceDir,
          '.modernjs/ultramodern-workspace-template-manifest.json',
        ),
        'utf-8',
      ),
    );
    assert.equal(
      manifest.source.generator,
      'packages/toolkit/create/src/ultramodern-workspace/',
    );
    assert.deepEqual(
      manifest.integrity.checksums.map(
        (checksum: { scope: string }) => checksum.scope,
      ),
      ['source-tree', 'file-templates-tree'],
    );
    for (const checksum of manifest.integrity.checksums) {
      assert.equal(checksum.algorithm, 'sha256');
      assert.match(checksum.value, /^[0-9a-f]{64}$/);
    }

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    for (const relativePath of catalogVerticalSnapshots) {
      assertContentSnapshot(workspaceDir, 'catalog-vertical', relativePath);
    }

    // Regression: the vertical page once read the bare identifier
    // `supportedLanguages` without declaring it, so every --vertical
    // workspace failed `tsgo --noEmit` with TS2304 (ReferenceError at
    // render). Unlike the byte snapshot above, this assertion survives a
    // blind fixture regeneration: the identifier the page maps over must be
    // destructured from useModernI18n(), the same i18n runtime source the
    // page already uses for `i18nInstance` and `language`.
    const verticalPage = fs.readFileSync(
      path.join(workspaceDir, 'verticals/catalog/src/routes/[lang]/page.tsx'),
      'utf-8',
    );
    assert.match(
      verticalPage,
      /\{supportedLanguages\.map\(/,
      'expected the vertical page to render the language switcher from supportedLanguages',
    );
    assert.match(
      verticalPage,
      /const \{[^}]*\bsupportedLanguages\b[^}]*\} = useModernI18n\(\);/,
      'supportedLanguages must be destructured from useModernI18n() — otherwise the generated page references an undeclared identifier',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
