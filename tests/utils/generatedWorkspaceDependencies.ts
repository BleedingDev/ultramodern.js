import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { yaml } from '@modern-js/utils';
import { runPnpm } from './runWithPrerequisites.mjs';

const { dump, load } = yaml;

type PackedPackage = { tarball: string; integrity: string };

function packedPrerequisites() {
  const manifestPath = process.env.MODERN_TEST_PACKAGE_MANIFEST;
  if (!manifestPath) {
    throw new Error(
      'Missing packed framework prerequisites. Run pnpm test:framework, or ' +
        'set MODERN_TEST_PACKAGE_MANIFEST to the packages.json produced by ' +
        'tests/utils/runWithPrerequisites.mjs --pack-only <directory>.',
    );
  }
  const { packages, allowBuilds } = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8'),
  ) as {
    packages: Record<string, PackedPackage>;
    allowBuilds: Record<string, boolean>;
  };
  const overrides: Record<string, string> = {};
  for (const [name, { tarball, integrity }] of Object.entries(packages)) {
    const actual = createHash('sha256')
      .update(fs.readFileSync(tarball))
      .digest('hex');
    if (actual !== integrity) {
      throw new Error(`Packed prerequisite changed after preparation: ${name}`);
    }
    overrides[name] = `file:${tarball}`;
  }
  return { overrides, allowBuilds };
}

/** pnpm owns workspace links, per-package versions, peer resolution and builds. */
export function materializeGeneratedWorkspaceDependencies(
  workspaceDir: string,
): void {
  const { overrides } = packedPrerequisites();
  const workspaceFile = path.join(workspaceDir, 'pnpm-workspace.yaml');
  const workspace = load(fs.readFileSync(workspaceFile, 'utf8')) as {
    overrides?: Record<string, string>;
  };
  // Keep the transport overrides installed: reverting them would invalidate
  // pnpm's lockfile settings and break verifyDepsBeforeRun for real commands.
  fs.writeFileSync(
    workspaceFile,
    dump({ ...workspace, overrides: { ...workspace.overrides, ...overrides } }),
  );
  runPnpm(['install', '--no-frozen-lockfile'], {
    cwd: workspaceDir,
    env: { ...process.env, CI: 'true' },
    stdio: 'pipe',
  });
}

/** A standalone consumer outside the repository, without source links. */
export function installPackedGenerator(tempRoot: string): string {
  const { overrides, allowBuilds } = packedPrerequisites();
  const consumer = path.join(tempRoot, 'generator-consumer');
  fs.mkdirSync(consumer, { recursive: true });
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({
      name: 'packed-generator-consumer',
      private: true,
      dependencies: {
        '@modern-js/ultramodern-create':
          overrides['@modern-js/ultramodern-create'],
      },
    }),
  );
  fs.writeFileSync(
    path.join(consumer, 'pnpm-workspace.yaml'),
    dump({ packages: [], overrides, allowBuilds }),
  );
  runPnpm(['install', '--no-frozen-lockfile'], {
    cwd: consumer,
    env: { ...process.env, CI: 'true' },
    stdio: 'pipe',
  });
  const bin = path.join(
    consumer,
    'node_modules/@modern-js/ultramodern-create/bin/run.js',
  );
  if (
    !fs.realpathSync(bin).startsWith(`${fs.realpathSync(consumer)}${path.sep}`)
  ) {
    throw new Error(
      'Packed generator resolved outside its standalone consumer',
    );
  }
  return bin;
}

export function generatedModernBin(packageDir: string): string {
  return path.join(
    packageDir,
    'node_modules/@modern-js/app-tools/bin/modern.js',
  );
}
