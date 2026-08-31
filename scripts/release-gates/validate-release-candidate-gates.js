#!/usr/bin/env node

const path = require('path');
const { parseCliArgs } = require('../lib/cli-kit');
const {
  readJsonFile,
  runGateCommands,
  validateEvidence,
  validateProfileShape,
  writeGateSnapshot,
} = require('./validator');

const DEFAULT_GATE_SNAPSHOT_PATH = '.modern/contract-gates.json';

const parseArgs = argv => {
  return parseCliArgs(argv, {
    defaults: {
      profile: 'scripts/release-gates/rc-contract-profile.json',
      evidenceDir: undefined,
      allowMissingEvidence: false,
      skipCommands: false,
      gateSnapshotPath:
        process.env.MODERN_CONTRACT_GATES_FILE || DEFAULT_GATE_SNAPSHOT_PATH,
      gateName: undefined,
      skipGateSnapshot: false,
    },
    options: {
      profile: { requiredValue: false },
      'evidence-dir': {
        key: 'evidenceDir',
        requiredValue: false,
      },
      'allow-missing-evidence': {
        key: 'allowMissingEvidence',
        type: 'boolean',
      },
      'skip-commands': {
        key: 'skipCommands',
        type: 'boolean',
      },
      'gate-snapshot-path': {
        key: 'gateSnapshotPath',
        requiredValue: false,
      },
      'gate-name': {
        key: 'gateName',
        requiredValue: false,
      },
      'skip-gate-snapshot': {
        key: 'skipGateSnapshot',
        type: 'boolean',
      },
    },
  });
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
    executedCommands: args.skipCommands ? 0 : profile.gateCommands.length,
    skippedCommands: args.skipCommands ? profile.gateCommands.length : 0,
  };

  const qualificationGaps = [];
  if (summary.skippedEvidenceFiles > 0) {
    qualificationGaps.push(
      `${String(summary.skippedEvidenceFiles)} required evidence ${summary.skippedEvidenceFiles === 1 ? 'file was' : 'files were'} skipped`,
    );
  }
  if (summary.skippedCommands > 0) {
    qualificationGaps.push(
      `${String(summary.skippedCommands)} gate ${summary.skippedCommands === 1 ? 'command was' : 'commands were'} skipped`,
    );
  }

  return {
    profilePath,
    profile,
    summary,
    qualified: qualificationGaps.length === 0,
    qualificationReason:
      qualificationGaps.length > 0 ? qualificationGaps.join('; ') : undefined,
  };
};

const main = args => {
  const { profilePath, profile, qualified, qualificationReason, summary } =
    runValidation(args);
  persistGateSnapshot({
    args,
    profilePath,
    profile,
    passed: qualified,
    reason: qualificationReason,
    summary,
  });

  if (!qualified) {
    console.log(
      `[release-gates] RC contract gate validation completed without qualification (${qualificationReason}):\n${JSON.stringify(summary, null, 2)}`,
    );
    return;
  }

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
