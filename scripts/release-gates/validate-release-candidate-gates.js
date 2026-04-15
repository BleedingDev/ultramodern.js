#!/usr/bin/env node

const path = require('path');
const {
  readJsonFile,
  runGateCommands,
  validateEvidence,
  validateMigrationContracts,
  validateProfileShape,
  writeGateSnapshot,
} = require('./validator');

const DEFAULT_GATE_SNAPSHOT_PATH = '.modern/contract-gates.json';

const parseArgs = argv => {
  const parsed = {
    profile: 'scripts/release-gates/rc-contract-profile.json',
    evidenceDir: undefined,
    allowMissingEvidence: false,
    skipCommands: false,
    skipMigrationValidation: false,
    gateSnapshotPath:
      process.env.MODERN_CONTRACT_GATES_FILE || DEFAULT_GATE_SNAPSHOT_PATH,
    gateName: undefined,
    skipGateSnapshot: false,
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
      case '--gate-snapshot-path':
        parsed.gateSnapshotPath = argv[index + 1];
        index += 1;
        break;
      case '--gate-name':
        parsed.gateName = argv[index + 1];
        index += 1;
        break;
      case '--skip-gate-snapshot':
        parsed.skipGateSnapshot = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
};

const resolveGateName = ({ args, profilePath, profile }) => {
  if (typeof args.gateName === 'string' && args.gateName.trim().length > 0) {
    return args.gateName.trim();
  }

  if (profile && typeof profile.name === 'string' && profile.name.trim()) {
    return profile.name.trim();
  }

  return path.basename(profilePath, path.extname(profilePath));
};

const persistGateSnapshot = ({
  args,
  profilePath,
  profile,
  passed,
  reason,
  summary,
}) => {
  if (args.skipGateSnapshot) {
    return;
  }

  const gateName = resolveGateName({
    args,
    profilePath,
    profile,
  });
  const snapshot = writeGateSnapshot({
    snapshotPath: args.gateSnapshotPath,
    gateName,
    passed,
    reason,
    summary,
    profilePath,
  });

  console.log(
    `[release-gates] Gate snapshot updated (${snapshot.gateName}=${String(snapshot.passed)}) at ${snapshot.snapshotPath}`,
  );
};

const runValidation = args => {
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
        allowAutoBuildArtifacts: !args.skipCommands,
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
  return {
    profilePath,
    profile,
    summary,
  };
};

const main = args => {
  const { profilePath, profile, summary } = runValidation(args);
  persistGateSnapshot({
    args,
    profilePath,
    profile,
    passed: true,
    summary,
  });
  console.log(
    `[release-gates] RC contract gates passed:\n${JSON.stringify(summary, null, 2)}`,
  );
};

let args;

try {
  args = parseArgs(process.argv.slice(2));
  main(args);
} catch (error) {
  if (args) {
    try {
      const profilePath = path.resolve(args.profile);
      const profile = readJsonFile(profilePath);
      persistGateSnapshot({
        args,
        profilePath,
        profile,
        passed: false,
        reason: error.message,
        summary: {
          error: error.message,
        },
      });
    } catch (snapshotError) {
      console.error(
        `[release-gates] Failed to persist gate snapshot: ${snapshotError.message}`,
      );
    }
  }
  console.error(`[release-gates] Validation failed: ${error.message}`);
  process.exit(1);
}
