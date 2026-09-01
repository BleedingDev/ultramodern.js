// Consumer: publish-bleedingdev.yml prepare/publish CLI invocations.
import fs from 'node:fs';
import path from 'node:path';
import cliKit from '../../../lib/cli-kit.js';
import { rejectInlineOptionSyntax } from '../option-syntax.mjs';
import { repoRoot } from './constants.mjs';

const { parseCliArgs } = cliKit;

const ownedPreparationOutputRoot = path.join(
  repoRoot,
  '.modern',
  'bleedingdev-publish',
);

const cliValueOptions = new Set([
  '--scope',
  '--prefix',
  '--version',
  '--tag',
  '--out',
  '--repository-url',
  '--homepage',
  '--bugs-url',
  '--publish-concurrency',
]);

const cliBooleanOptions = new Set([
  '--publish',
  '--publish-existing',
  '--dry-run',
  '--include-sidecars',
]);

function parsePublishConcurrency(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error('--publish-concurrency must be an integer from 1 to 8');
  }

  const concurrency = Number(value);
  if (concurrency > 8) {
    throw new Error('--publish-concurrency must be an integer from 1 to 8');
  }

  return concurrency;
}

function assertNoSymlinkedPreparationPath(output) {
  const relativeOutput = path.relative(repoRoot, output);
  let currentPath = repoRoot;

  for (const segment of relativeOutput.split(path.sep)) {
    currentPath = path.join(currentPath, segment);

    let stats;
    try {
      stats = fs.lstatSync(currentPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    if (stats.isSymbolicLink()) {
      throw new Error(
        `--out for package preparation must not traverse a symbolic link: ${currentPath}`,
      );
    }
  }
}

function resolveOwnedPreparationOutput(output) {
  const resolvedOutput = path.resolve(output);
  const relativeOutput = path.relative(
    ownedPreparationOutputRoot,
    resolvedOutput,
  );
  const isOwnedOutput =
    relativeOutput === '' ||
    (!relativeOutput.startsWith(`..${path.sep}`) &&
      relativeOutput !== '..' &&
      !path.isAbsolute(relativeOutput));

  if (!isOwnedOutput) {
    throw new Error(
      `--out for package preparation must be inside ${ownedPreparationOutputRoot}`,
    );
  }

  assertNoSymlinkedPreparationPath(resolvedOutput);

  return resolvedOutput;
}

function parseArgs(argv) {
  rejectInlineOptionSyntax(argv, {
    valueOptions: cliValueOptions,
    booleanOptions: cliBooleanOptions,
  });

  const options = parseCliArgs(argv, {
    defaults: {
      scope: 'bleedingdev',
      prefix: 'modern-js-',
      version: undefined,
      dependencyVersion: null,
      tag: 'latest',
      packages: null,
      out: path.join(repoRoot, '.modern', 'bleedingdev-publish'),
      repositoryUrl: 'git+https://github.com/BleedingDev/ultramodern.js.git',
      homepage: 'https://github.com/BleedingDev/ultramodern.js#readme',
      bugsUrl: 'https://github.com/BleedingDev/ultramodern.js/issues',
      publish: false,
      publishExisting: false,
      dryRun: false,
      includeSidecars: false,
      noSkipExisting: false,
      publishConcurrency: 8,
    },
    ignoreTerminator: true,
    options: {
      scope: {},
      prefix: {},
      version: {},
      'dependency-version': {
        key: 'dependencyVersion',
        requiredValue: false,
      },
      tag: {},
      packages: {
        requiredValue: false,
      },
      out: {},
      'repository-url': {
        key: 'repositoryUrl',
      },
      homepage: {},
      'bugs-url': {
        key: 'bugsUrl',
      },
      publish: {
        type: 'boolean',
      },
      'publish-existing': {
        key: 'publishExisting',
        type: 'boolean',
      },
      'dry-run': {
        key: 'dryRun',
        type: 'boolean',
      },
      'include-sidecars': {
        key: 'includeSidecars',
        type: 'boolean',
      },
      'no-skip-existing': {
        key: 'noSkipExisting',
        type: 'boolean',
      },
      'publish-concurrency': {
        key: 'publishConcurrency',
      },
    },
  });

  if (options.dependencyVersion !== null) {
    throw new Error(
      '--dependency-version is forbidden; BleedingDev publishes a single full framework cohort per version',
    );
  }

  if (options.packages !== null) {
    throw new Error(
      '--packages is forbidden; BleedingDev publishes every public @modern-js/* package together',
    );
  }

  if (options.noSkipExisting) {
    throw new Error(
      '--no-skip-existing is forbidden; exact-version reuse is controlled by the full-cohort registry gate',
    );
  }

  if (options.includeSidecars && (options.publish || options.publishExisting)) {
    throw new Error(
      [
        '--include-sidecars is a staging-only flag.',
        'Sidecars keep their own stable versions and must be published to npm BEFORE the cohort, because @modern-js/image pins them through npm: alias specifiers that only resolve once those versions exist.',
        'Stage them in their own step, publish them, then run the cohort publish without --include-sidecars.',
      ].join('\n'),
    );
  }

  if (!options.version) {
    throw new Error(
      'Missing --version, for example --version <Modern.js-version>-ultramodern.<revision>',
    );
  }

  options.scope = options.scope.replace(/^@/, '');
  options.out = path.resolve(options.out);
  if (!options.publishExisting) {
    options.out = resolveOwnedPreparationOutput(options.out);
  }
  options.publish = options.publish || options.publishExisting;
  options.publishConcurrency = parsePublishConcurrency(
    options.publishConcurrency,
  );
  options.dependencyVersion = options.version;
  delete options.packages;
  delete options.noSkipExisting;

  return options;
}

export { parseArgs, resolveOwnedPreparationOutput };
