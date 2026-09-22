import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { yaml } from '@modern-js/utils';
import spawn from 'cross-spawn';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export function runPnpm(args, options) {
  const result = spawn.sync('pnpm', args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `pnpm ${args.join(' ')} failed in ${options.cwd}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  return result.stdout;
}

// The runner is the only writer. Workers consume tarballs and framework dist
// after this phase finishes; no worker discovers or rebuilds stale packages.
export function packTestPackages(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const projects = JSON.parse(
    runPnpm(['--filter', '@modern-js/*', 'list', '--depth', '-1', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }),
  ).filter(
    project =>
      !project.private &&
      project.path.startsWith(path.join(repoRoot, 'packages') + path.sep),
  );
  const packages = {};
  for (const project of projects) {
    const tarball = path.join(
      outputDir,
      `${project.name.replaceAll('/', '-').replace('@', '')}.tgz`,
    );
    runPnpm(['pack', '--out', tarball], {
      cwd: project.path,
      stdio: 'pipe',
    });
    packages[project.name] = {
      tarball,
      integrity: createHash('sha256')
        .update(fs.readFileSync(tarball))
        .digest('hex'),
    };
  }
  const manifest = path.join(outputDir, 'packages.json');
  const { allowBuilds } = yaml.load(
    fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'),
  );
  fs.writeFileSync(
    manifest,
    `${JSON.stringify({ packages, allowBuilds }, null, 2)}\n`,
  );
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--pack-only' && args.length === 2) {
    console.log(packTestPackages(path.resolve(args[1])));
    return;
  }
  const prepared = args[0] === '--prepared';
  if (prepared) args.shift();
  if (args.shift() !== '--' || args.length === 0) {
    throw new Error(
      'Usage: runWithPrerequisites.mjs [--prepared] -- <command> [args]',
    );
  }
  const inheritedManifest = process.env.MODERN_TEST_PACKAGE_MANIFEST;
  if (!prepared && !inheritedManifest) {
    runPnpm(['run', 'prepare-build'], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  }
  const outputDir = inheritedManifest
    ? undefined
    : fs.mkdtempSync(path.join(os.tmpdir(), 'modern-test-packages-'));
  try {
    const manifest = inheritedManifest ?? packTestPackages(outputDir);
    const child = spawn(args[0], args.slice(1), {
      cwd: process.cwd(),
      env: { ...process.env, MODERN_TEST_PACKAGE_MANIFEST: manifest },
      stdio: 'inherit',
    });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    try {
      process.exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
      });
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    }
  } finally {
    if (outputDir) fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
