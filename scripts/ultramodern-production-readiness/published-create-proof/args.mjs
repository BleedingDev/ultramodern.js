import path from 'node:path';
import {
  defaultCreatePackage,
  defaultOut,
  defaultProjectName,
  parseCliArgs,
  readableErpVerticalNames,
  rejectInlineOptionValues,
  repoRoot,
  scaleProfiles,
} from './constants.mjs';

function parseArgs(argv) {
  rejectInlineOptionValues(argv, [
    '--create-package',
    '--project-name',
    '--scale-profile',
    '--vertical-count',
    '--out',
  ]);

  const options = parseCliArgs(argv, {
    defaults: {
      createPackage: defaultCreatePackage,
      projectName: defaultProjectName,
      scaleProfile: undefined,
      verticalCount: undefined,
      out: defaultOut,
      deployCloudflare: false,
      commandContractOnly: false,
    },
    options: {
      'create-package': {
        key: 'createPackage',
        requiredValue: false,
      },
      'project-name': {
        key: 'projectName',
        requiredValue: false,
      },
      'scale-profile': {
        key: 'scaleProfile',
        requiredValue: false,
      },
      'vertical-count': {
        key: 'verticalCount',
        requiredValue: false,
      },
      out: {
        requiredValue: false,
      },
      'deploy-cloudflare': {
        key: 'deployCloudflare',
        type: 'boolean',
      },
      'command-contract-only': {
        key: 'commandContractOnly',
        type: 'boolean',
      },
    },
  });

  if (options.verticalCount !== undefined) {
    options.verticalCount = Number.parseInt(options.verticalCount, 10);
  }

  if (
    options.verticalCount !== undefined &&
    (!Number.isInteger(options.verticalCount) || options.verticalCount < 0)
  ) {
    throw new Error('--vertical-count must be a non-negative integer');
  }
  if (
    options.scaleProfile !== undefined &&
    !Object.hasOwn(scaleProfiles, options.scaleProfile)
  ) {
    throw new Error(
      `--scale-profile must be one of ${Object.keys(scaleProfiles).join(', ')}`,
    );
  }
  assertSafeName(options.projectName, '--project-name');

  const selectedProfile = selectScaleProfile(options);

  return {
    ...options,
    selectedProfile,
    scaleProfile: selectedProfile.id,
    verticalCount: selectedProfile.verticalCount,
    out: path.resolve(repoRoot, options.out),
    verticals: generateVerticalNames(selectedProfile.verticalCount),
  };
}

function selectScaleProfile(options) {
  if (options.scaleProfile !== undefined) {
    const profile = scaleProfiles[options.scaleProfile];
    if (
      options.verticalCount !== undefined &&
      options.verticalCount !== profile.verticalCount
    ) {
      throw new Error(
        `--vertical-count ${String(
          options.verticalCount,
        )} does not match --scale-profile ${profile.id}`,
      );
    }
    return profile;
  }

  if (options.verticalCount !== undefined) {
    return {
      id: `custom-${options.verticalCount}`,
      verticalCount: options.verticalCount,
    };
  }

  return scaleProfiles['erp-10'];
}

function assertSafeName(value, optionName) {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) {
    throw new Error(`${optionName} must match /^[a-z][a-z0-9-]*$/`);
  }
}

function generatedVerticalName(index) {
  return `erp-vertical-${String(index + 1).padStart(3, '0')}`;
}

function generateVerticalNames(count) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('vertical count must be a non-negative integer');
  }
  return Array.from({ length: count }, (_, index) =>
    index < readableErpVerticalNames.length
      ? readableErpVerticalNames[index]
      : generatedVerticalName(index),
  );
}

export { generateVerticalNames, parseArgs };
