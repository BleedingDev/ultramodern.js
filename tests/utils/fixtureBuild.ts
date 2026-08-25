import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireFixtureLock } from './fixtureLock';

type BuildResult = {
  code: number;
};

type BuildFixtureOnceOptions<T extends BuildResult> = {
  build: () => Promise<T>;
  cacheKey?: string;
  inputs?: string[];
  outputDir?: string;
};

const defaultInputs = [
  'api',
  'src',
  'shared',
  'modern.config.ts',
  'package.json',
  'tsconfig.json',
];

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashPath(hash: crypto.Hash, filePath: string, rootDir: string) {
  const stat = await fs.stat(filePath);
  const relativePath = path.relative(rootDir, filePath);

  if (stat.isDirectory()) {
    const entries = await fs.readdir(filePath);
    for (const entry of entries.sort()) {
      if (entry === 'dist' || entry.startsWith('dist-')) {
        continue;
      }
      await hashPath(hash, path.join(filePath, entry), rootDir);
    }
    return;
  }

  if (!stat.isFile()) {
    return;
  }

  hash.update(relativePath);
  hash.update('\0');
  hash.update(await fs.readFile(filePath));
  hash.update('\0');
}

async function hashFixtureInputs(
  fixtureDir: string,
  inputs: string[],
  cacheKey?: string,
) {
  const hash = crypto.createHash('sha1');
  hash.update(cacheKeyForCurrentRun());
  hash.update('\0');
  hash.update(cacheKey ?? '');
  hash.update('\0');

  for (const input of inputs) {
    const inputPath = path.join(fixtureDir, input);
    if (await pathExists(inputPath)) {
      await hashPath(hash, inputPath, fixtureDir);
    }
  }

  return hash.digest('hex');
}

let localRepoStateCacheKey: string | undefined;

function readGitOutput(args: string[], cwd: string) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function hashGitOutput(hash: crypto.Hash, root: string, args: string[]) {
  hash.update(readGitOutput(args, root));
  hash.update('\0');
}

function computeLocalRepoStateCacheKey() {
  try {
    const root = readGitOutput(
      ['rev-parse', '--show-toplevel'],
      process.cwd(),
    ).trim();
    const hash = crypto.createHash('sha1');

    hashGitOutput(hash, root, ['rev-parse', 'HEAD']);
    hashGitOutput(hash, root, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ]);
    hashGitOutput(hash, root, ['diff', '--no-ext-diff', '--binary']);
    hashGitOutput(hash, root, [
      'diff',
      '--cached',
      '--no-ext-diff',
      '--binary',
    ]);

    return `git:${hash.digest('hex')}`;
  } catch {
    const fallbackHash = crypto.createHash('sha1');
    fallbackHash.update(process.cwd());
    return `cwd:${fallbackHash.digest('hex')}`;
  }
}

function cacheKeyForCurrentRun() {
  const configuredCacheKey =
    process.env.MODERNJS_FIXTURE_BUILD_CACHE_KEY || process.env.GITHUB_SHA;
  if (configuredCacheKey) {
    return configuredCacheKey;
  }

  localRepoStateCacheKey ??= computeLocalRepoStateCacheKey();

  return localRepoStateCacheKey;
}

function markerPathFor(fixtureDir: string, outputDir: string) {
  const digest = crypto
    .createHash('sha1')
    .update(`${path.resolve(fixtureDir)}:${outputDir}`)
    .digest('hex');

  return path.join(os.tmpdir(), `modernjs-fixture-build-${digest}.json`);
}

async function readValidMarker(
  markerPath: string,
  inputHash: string,
  outputPath: string,
) {
  if (!(await pathExists(outputPath))) {
    return false;
  }

  try {
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8')) as {
      inputHash?: string;
    };
    return marker.inputHash === inputHash;
  } catch {
    return false;
  }
}

async function writeMarkerAtomically(
  markerPath: string,
  marker: Record<string, unknown>,
) {
  const tempPath = `${markerPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(marker, null, 2)}\n`);
  await fs.rename(tempPath, markerPath);
}

export async function buildFixtureOnce<T extends BuildResult>(
  fixtureDir: string,
  options: BuildFixtureOnceOptions<T>,
): Promise<T> {
  const releaseLock = await acquireFixtureLock(fixtureDir);
  const outputDir = options.outputDir ?? 'dist';
  const outputPath = path.join(fixtureDir, outputDir);
  const markerPath = markerPathFor(fixtureDir, outputDir);

  try {
    let inputHash = await hashFixtureInputs(
      fixtureDir,
      options.inputs ?? defaultInputs,
      options.cacheKey,
    );

    if (await readValidMarker(markerPath, inputHash, outputPath)) {
      return { code: 0 } as T;
    }

    await fs.rm(markerPath, { force: true });
    const result = await options.build();
    if (result.code === 0) {
      inputHash = await hashFixtureInputs(
        fixtureDir,
        options.inputs ?? defaultInputs,
        options.cacheKey,
      );
      await writeMarkerAtomically(markerPath, {
        fixtureDir: path.resolve(fixtureDir),
        inputHash,
        outputDir,
        builtAt: new Date().toISOString(),
      });
    }
    return result;
  } finally {
    await releaseLock();
  }
}
