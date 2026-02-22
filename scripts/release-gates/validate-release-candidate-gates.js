#!/usr/bin/env node

const path = require('path');
const {
  readJsonFile,
  runGateCommands,
  validateEvidence,
  validateMigrationContracts,
  validateProfileShape,
} = require('./validator');

const parseArgs = argv => {
  const parsed = {
    profile: 'scripts/release-gates/rc-contract-profile.json',
    evidenceDir: undefined,
    allowMissingEvidence: false,
    skipCommands: false,
    skipMigrationValidation: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--profile':
        parsed.profile = argv[index + 1];
        index += 1;
        break;
      case '--evidence-dir':
        parsed.evidenceDir = argv[index + 1];
        index += 1;
        break;
      case '--allow-missing-evidence':
        parsed.allowMissingEvidence = true;
        break;
      case '--skip-commands':
        parsed.skipCommands = true;
        break;
      case '--skip-migration-validation':
        parsed.skipMigrationValidation = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const profilePath = path.resolve(args.profile);
  const profile = readJsonFile(profilePath);

  validateProfileShape(profile);

  const evidenceDir =
    args.evidenceDir || profile.evidence.defaultDir || process.cwd();

  const evidenceReport = validateEvidence({
    evidenceDir,
    requiredFiles: profile.evidence.requiredFiles,
    requiredMetadataFields: profile.evidence.requiredMetadataFields,
    minimumReviewers: profile.evidence.minimumReviewers || 2,
    allowMissingEvidence: args.allowMissingEvidence,
  });

  const migrationReport = args.skipMigrationValidation
    ? []
    : validateMigrationContracts({
        targets: profile.migrationContracts.targets,
        rootDir: process.cwd(),
      });

  if (!args.skipCommands) {
    runGateCommands({
      commands: profile.gateCommands,
      cwd: process.cwd(),
    });
  }

  const summary = {
    profile: profilePath,
    evidenceDir: path.resolve(evidenceDir),
    validatedEvidenceFiles: evidenceReport.validatedFiles.length,
    skippedEvidenceFiles: evidenceReport.skippedFiles.length,
    validatedMigrationTargets: migrationReport.length,
    executedCommands: args.skipCommands ? 0 : profile.gateCommands.length,
  };
  console.log(
    `[release-gates] RC contract gates passed:\n${JSON.stringify(
      summary,
      null,
      2,
    )}`,
  );
};

try {
  main();
} catch (error) {
  console.error(`[release-gates] Validation failed: ${error.message}`);
  process.exit(1);
}
