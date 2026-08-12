// Consumer: publish-bleedingdev.yml prepare/publish CLI invocations.
import path from 'node:path';
import cliKit from '../../../lib/cli-kit.js';
import { rejectInlineOptionSyntax } from '../option-syntax.mjs';
import { repoRoot } from './constants.mjs';

const { parseCliArgs } = cliKit;

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

  if (!options.version) {
    throw new Error(
      'Missing --version, for example --version <Modern.js-version>-ultramodern.<revision>',
    );
  }

  options.scope = options.scope.replace(/^@/, '');
  options.out = path.resolve(options.out);
  options.publish = options.publish || options.publishExisting;
  options.publishConcurrency = parsePublishConcurrency(
    options.publishConcurrency,
  );
  options.dependencyVersion = options.version;
  delete options.packages;
  delete options.noSkipExisting;

  return options;
}

export { parseArgs };
