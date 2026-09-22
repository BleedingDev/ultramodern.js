import { execFileSync } from 'node:child_process';
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

/** Remove only framework source copies in this disposable consumer. Application
 * workspace TypeScript (including injected shared-contracts) remains intact. */
function prepareSourceUnavailableConsumer(
  consumer: string,
  requireFramework = false,
) {
  const root = fs.realpathSync(consumer);
  const required = new Set(
    requireFramework
      ? [
          '@modern-js/ultramodern-create',
          '@modern-js/plugin-tanstack',
          '@modern-js/app-tools',
          '@modern-js/server-runtime-extensions',
        ]
      : ['@modern-js/ultramodern-create'],
  );
  const { overrides } = packedPrerequisites();
  for (const name of Object.keys(overrides)) {
    for (const manifest of fs.globSync(
      `node_modules/.pnpm/*/node_modules/${name}/package.json`,
      { cwd: consumer },
    )) {
      const packageDir = fs.realpathSync(
        path.dirname(path.join(consumer, manifest)),
      );
      if (!packageDir.startsWith(`${root}${path.sep}`)) {
        throw new Error(
          `Packed package escaped its consumer: ${name}: ${packageDir}`,
        );
      }
      fs.rmSync(path.join(packageDir, 'src'), { recursive: true, force: true });
      if (required.has(name)) {
        const entry = execFileSync(
          process.execPath,
          ['-e', 'console.log(require.resolve(process.argv[1]))', name],
          {
            cwd: packageDir,
            encoding: 'utf8',
            env: { ...process.env, NODE_PATH: '' },
          },
        ).trim();
        const resolved = fs.realpathSync(entry);
        if (
          !resolved.startsWith(`${root}${path.sep}`) ||
          resolved.split(path.sep).includes('src')
        ) {
          throw new Error(
            `Packed entry selected framework source or an external tree: ${name}: ${resolved}`,
          );
        }
        required.delete(name);
      }
    }
  }
  if (required.size)
    throw new Error(
      `Missing packed framework consumer entries: ${[...required].join(', ')}`,
    );
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
    env: { ...process.env, NODE_PATH: '', CI: 'true' },
    stdio: 'pipe',
  });
  prepareSourceUnavailableConsumer(workspaceDir, true);
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
    env: { ...process.env, NODE_PATH: '', CI: 'true' },
    stdio: 'pipe',
  });
  prepareSourceUnavailableConsumer(consumer);
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
