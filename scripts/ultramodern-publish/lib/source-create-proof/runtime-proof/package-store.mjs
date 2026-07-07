import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assertProof, failProof } from '../assertions.mjs';

export function packagePath(rootDir, packageName) {
  return path.join(rootDir, ...packageName.split('/'));
}

export function forceSymlinkPackage(rootDir, packageName, targetDir) {
  const installPath = packagePath(rootDir, packageName);
  fs.rmSync(installPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(installPath), { recursive: true });
  fs.symlinkSync(targetDir, installPath, 'dir');
}

export function forceCopyPackage(rootDir, packageName, targetDir) {
  const installPath = packagePath(rootDir, packageName);
  fs.rmSync(installPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(installPath), { recursive: true });
  fs.cpSync(targetDir, installPath, {
    recursive: true,
    verbatimSymlinks: true,
  });
}

export function runChecked(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      ...(options.env ?? {}),
    },
  });

  if (result.error) {
    failProof(
      options.category,
      `${command} ${args.join(' ')} failed to start: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
    failProof(
      options.category,
      [`${command} ${args.join(' ')} exited ${result.status}`, output.trim()]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return result.stdout;
}

export function packStagedCreatePackage(packageDir, tempDir, packageName) {
  const packDir = path.join(tempDir, 'pack');
  fs.mkdirSync(packDir, { recursive: true });
  const stdout = runChecked(
    'npm',
    ['pack', '--json', '--ignore-scripts', packageDir],
    {
      cwd: packDir,
      category: 'package root',
    },
  );

  let packResult;
  try {
    packResult = JSON.parse(stdout);
  } catch (error) {
    failProof(
      'package root',
      `${packageName} npm pack did not return JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const [firstResult] = packResult;
  assertProof(
    packResult.length === 1 && firstResult?.filename,
    'package root',
    `${packageName} npm pack must create exactly one tarball`,
  );

  const tarballPath = path.join(packDir, firstResult.filename);
  assertProof(
    fs.existsSync(tarballPath),
    'package root',
    `${packageName} npm pack tarball was not created`,
  );

  return {
    tarballPath,
    filename: firstResult.filename,
    fileCount: firstResult.files?.length,
  };
}

export function extractPackageTarball(tarballPath, targetDir, category) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  runChecked('tar', ['-xzf', tarballPath, '-C', targetDir], {
    cwd: targetDir,
    category,
  });
  const extractedPackageDir = path.join(targetDir, 'package');
  assertProof(
    fs.existsSync(path.join(extractedPackageDir, 'package.json')),
    category,
    `Extracted package from ${tarballPath} is missing package.json`,
  );
  return extractedPackageDir;
}
