import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runUltramodernToolingCli } from '../src/ultramodern-tooling/commands';
import { createMigrationIo } from '../src/ultramodern-tooling/commands/migrate-strict-effect/io';
import { formatGeneratedWorkspaceFiles } from '../src/ultramodern-workspace/fs-io';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace/index';
import { migratedWorkspaceScriptArtifacts } from '../src/ultramodern-workspace/workspace-scripts';

const packageSource = { strategy: 'workspace' } as const;

function readFiles(workspaceRoot: string, relativePaths: readonly string[]) {
  return new Map(
    relativePaths.map(relativePath => [
      relativePath,
      fs.readFileSync(path.join(workspaceRoot, relativePath)),
    ]),
  );
}

function assertGeneratedFilesAreFormatted(
  workspaceRoot: string,
  relativePaths: readonly string[],
) {
  const formatRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-format-check-'),
  );
  try {
    for (const relativePath of relativePaths) {
      const sourcePath = path.join(workspaceRoot, relativePath);
      const candidatePath = path.join(formatRoot, relativePath);
      fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
      fs.copyFileSync(sourcePath, candidatePath);
    }
    formatGeneratedWorkspaceFiles(formatRoot, relativePaths);
    for (const relativePath of relativePaths) {
      assert.deepEqual(
        fs.readFileSync(path.join(formatRoot, relativePath)),
        fs.readFileSync(path.join(workspaceRoot, relativePath)),
        `${relativePath} must already contain canonical Oxfmt bytes`,
      );
    }
  } finally {
    fs.rmSync(formatRoot, { force: true, recursive: true });
  }
}

test('migrate formats only proven whole-file generated artifacts and stays byte-idempotent', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-migrate-format-'));
  const workspaceRoot = path.join(tempRoot, 'format-workspace');
  try {
    generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'format-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource,
    });
    addUltramodernVertical({
      workspaceRoot,
      name: 'catalog',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource,
    });

    const fragmentPath =
      'verticals/catalog/src/routes/[lang]/_mf/fragment/widget/page.tsx';
    const fragmentSource = fs.readFileSync(
      path.join(workspaceRoot, fragmentPath),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, fragmentPath),
      fragmentSource.replaceAll('\n  ', '\n'),
    );

    const consumerProbePath = 'packages/format-probe.tsx';
    const consumerProbe = Buffer.from(
      'export const Probe = () => <div className="p-4 flex items-center">probe</div>;\n',
    );
    fs.writeFileSync(
      path.join(workspaceRoot, consumerProbePath),
      consumerProbe,
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );

    const generatedPaths = [
      ...new Set([
        ...migratedWorkspaceScriptArtifacts({
          shellOnly: false,
          hasBackendSurface: true,
        }).map(artifact => artifact.relativePath),
        'scripts/validate-ultramodern-workspace.mts',
        'zerops.yaml',
        'apps/shell-super-app/modern.config.ts',
        'apps/shell-super-app/module-federation.config.ts',
        'apps/shell-super-app/src/ultramodern-build.ts',
        'apps/shell-super-app/shared/ultramodern-build.ts',
        'apps/shell-super-app/src/routes/vertical-components.tsx',
        'apps/shell-super-app/src/routes/vertical-components.worker.tsx',
        'apps/shell-super-app/src/federated-components.tsx',
        'apps/shell-super-app/src/federated-components.worker.tsx',
        'verticals/catalog/modern.config.ts',
        'verticals/catalog/module-federation.config.ts',
        'verticals/catalog/backend-federation.config.ts',
        'verticals/catalog/src/ultramodern-build.ts',
        'verticals/catalog/shared/ultramodern-build.ts',
        'verticals/catalog/api/backend-federation.ts',
        fragmentPath,
      ]),
    ].sort((left, right) => left.localeCompare(right));

    assertGeneratedFilesAreFormatted(workspaceRoot, generatedPaths);
    assert.deepEqual(
      fs.readFileSync(path.join(workspaceRoot, consumerProbePath)),
      consumerProbe,
    );

    const firstMigration = readFiles(workspaceRoot, generatedPaths);
    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );
    assert.deepEqual(readFiles(workspaceRoot, generatedPaths), firstMigration);
    assert.deepEqual(
      fs.readFileSync(path.join(workspaceRoot, consumerProbePath)),
      consumerProbe,
    );
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('generated formatting failure rolls back the transaction', () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-migrate-format-rollback-'),
  );
  const generatedPath = path.join(workspaceRoot, 'generated.ts');
  const original = Buffer.from('export const original = true;\n');
  try {
    fs.writeFileSync(generatedPath, original);
    const io = createMigrationIo(workspaceRoot, false);
    assert.throws(
      () =>
        io.transaction(() => {
          io.writeGenerated(generatedPath, 'export const = ;\n');
        }),
      /Failed to format generated UltraModern workspace output/u,
    );
    assert.deepEqual(fs.readFileSync(generatedPath), original);
  } finally {
    fs.rmSync(workspaceRoot, { force: true, recursive: true });
  }
});
