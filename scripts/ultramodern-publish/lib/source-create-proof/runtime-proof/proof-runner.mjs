import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installPackedCreateConsumer } from './consumer-install.mjs';
import { runInstalledCreateSmoke } from './installed-create-smoke.mjs';
import { packStagedCreatePackage } from './package-store.mjs';

export function runCreatePackageRuntimeProof({
  createItem,
  createPackageDir,
  manifest,
  repoRoot,
  sourcePackageDir,
  sourcePackageDirs,
}) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'modern-create-publish-proof-'),
  );

  try {
    const packInfo = packStagedCreatePackage(
      createPackageDir,
      tempDir,
      createItem.targetName,
    );
    const installInfo = installPackedCreateConsumer({
      createItem,
      createPackageDir,
      manifest,
      packInfo,
      repoRoot,
      sourcePackageDir,
      sourcePackageDirs,
      tempDir,
    });
    const smoke = runInstalledCreateSmoke({
      consumerDir: installInfo.consumerDir,
      createItem,
      installedCreateDir: installInfo.installedCreateDir,
      manifest,
    });

    return {
      packedTarball: packInfo.filename,
      packedFileCount: packInfo.fileCount,
      installedPackageName: createItem.targetName,
      ...smoke,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
