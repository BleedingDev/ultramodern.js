import path from 'node:path';
import cliKit from '../../../lib/cli-kit.js';
import { rejectInlineOptionSyntax } from '../option-syntax.mjs';

const { parseCliArgs } = cliKit;

const defaultRepoRoot = path.resolve(
  new URL('../../../..', import.meta.url).pathname,
);

const defaultManifestPath = path.join(
  defaultRepoRoot,
  '.modern',
  'bleedingdev-publish',
  'manifest.json',
);

const defaultOutPath = path.join(
  defaultRepoRoot,
  '.modern',
  'prepublish-release-gates',
  'source-create-proof.json',
);

const cliValueOptions = new Set(['--root', '--manifest', '--out']);

function parseArgs(argv) {
  rejectInlineOptionSyntax(argv, { valueOptions: cliValueOptions });

  const options = parseCliArgs(argv, {
    defaults: {
      repoRoot: defaultRepoRoot,
      manifestPath: defaultManifestPath,
      outPath: defaultOutPath,
    },
    ignoreTerminator: true,
    options: {
      root: {
        key: 'repoRoot',
      },
      manifest: {
        key: 'manifestPath',
      },
      out: {
        key: 'outPath',
      },
    },
  });

  return {
    ...options,
    repoRoot: path.resolve(options.repoRoot),
    manifestPath: path.resolve(options.manifestPath),
    outPath: path.resolve(options.outPath),
  };
}

export { parseArgs };
