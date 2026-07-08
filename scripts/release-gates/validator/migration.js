const fs = require('fs');
const path = require('path');
const { ensureFileExists, readJsonFile } = require('../../lib/validation-kit');
const { executeCommand } = require('./exec');

const isPathInsideDirectory = ({ baseDir, targetDir }) => {
  const relative = path.relative(baseDir, targetDir);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
};

const findNearestPackageDirectory = ({ startDir, rootDir }) => {
  const boundaryDir = path.resolve(rootDir || process.cwd());
  let cursor = path.resolve(startDir);

  while (isPathInsideDirectory({ baseDir: boundaryDir, targetDir: cursor })) {
    if (fs.existsSync(path.join(cursor, 'package.json'))) {
      return cursor;
    }
    if (cursor === boundaryDir) {
      break;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  return undefined;
};

const isLikelyBuildArtifactPath = targetPath =>
  /(^|[\\/])dist(?:-[^\\/]+)?([\\/]|$)/.test(String(targetPath));

const validateMigrationContracts = ({
  targets,
  rootDir,
  allowAutoBuildArtifacts = false,
  skipCommandRequiredTargets = false,
  commandRunner,
}) => {
  const baseDir = path.resolve(rootDir || process.cwd());
  const report = [];
  const preparedPackages = new Set();

  for (const target of targets) {
    if (skipCommandRequiredTargets && target.requiresCommands === true) {
      continue;
    }

    const targetPath = path.resolve(baseDir, target.path);

    if (
      !fs.existsSync(targetPath) &&
      allowAutoBuildArtifacts &&
      isLikelyBuildArtifactPath(target.path)
    ) {
      const packageDir = findNearestPackageDirectory({
        startDir: path.dirname(targetPath),
        rootDir: baseDir,
      });
      if (!packageDir) {
        throw new Error(
          `Migration contract "${target.id}" target is missing and could not resolve package root for auto-build: ${targetPath}`,
        );
      }

      if (!preparedPackages.has(packageDir)) {
        const packageJsonPath = path.join(packageDir, 'package.json');
        const packageJson = readJsonFile(packageJsonPath);
        const buildScript =
          packageJson?.scripts && typeof packageJson.scripts.build === 'string'
            ? packageJson.scripts.build.trim()
            : '';
        if (!buildScript) {
          throw new Error(
            `Migration contract "${target.id}" target is missing and package ${packageDir} does not define scripts.build`,
          );
        }

        const buildCommand = {
          command: 'pnpm',
          args: ['--dir', packageDir, 'run', 'build'],
          label: `pnpm --dir "${packageDir}" run build`,
        };
        console.log(
          `[release-gates] Auto-building migration artifact for "${target.id}" via ${buildCommand.label}`,
        );
        executeCommand({
          command: buildCommand,
          cwd: baseDir,
          commandRunner,
          failureMessage: `Auto-build failed for migration contract "${target.id}" with command: ${buildCommand.label}`,
        });
        preparedPackages.add(packageDir);
      }
    }

    ensureFileExists(targetPath);

    const content = fs.readFileSync(targetPath, 'utf8');
    for (const snippet of target.includes || []) {
      if (!content.includes(snippet)) {
        throw new Error(
          `Migration contract "${target.id}" is missing snippet "${snippet}" in ${targetPath}`,
        );
      }
    }

    report.push({
      id: target.id,
      path: target.path,
      includes: (target.includes || []).length,
    });
  }

  return report;
};

module.exports = {
  validateMigrationContracts,
};
