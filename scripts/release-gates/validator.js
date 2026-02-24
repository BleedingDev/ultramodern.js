const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCHEMA_VERSION = 1;
const PLACEHOLDER_METADATA_VALUES = new Set([
  'tbd',
  'todo',
  'pending',
  'unknown',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  'changeme',
  'to-be-filled',
]);

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const readJsonFile = filePath => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const ensureFileExists = filePath => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file does not exist: ${filePath}`);
  }
};

const validateProfileShape = profile => {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Profile must be a JSON object');
  }

  if (profile.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported profile schemaVersion: ${String(
        profile.schemaVersion,
      )}. Expected ${String(SCHEMA_VERSION)}.`,
    );
  }

  if (!profile.evidence || typeof profile.evidence !== 'object') {
    throw new Error('Profile is missing "evidence" section');
  }

  if (!Array.isArray(profile.evidence.requiredFiles)) {
    throw new Error('Profile evidence.requiredFiles must be an array');
  }

  if (!Array.isArray(profile.evidence.requiredMetadataFields)) {
    throw new Error('Profile evidence.requiredMetadataFields must be an array');
  }

  if (
    !profile.migrationContracts ||
    typeof profile.migrationContracts !== 'object'
  ) {
    throw new Error('Profile is missing "migrationContracts" section');
  }

  if (!Array.isArray(profile.migrationContracts.targets)) {
    throw new Error('Profile migrationContracts.targets must be an array');
  }

  if (!Array.isArray(profile.gateCommands)) {
    throw new Error('Profile gateCommands must be an array');
  }
};

const validateMetadataFields = ({
  filePath,
  content,
  requiredMetadataFields,
}) => {
  for (const field of requiredMetadataFields) {
    const pattern = new RegExp(
      `(^|\\n)\\s*${escapeRegExp(field)}\\s*[:=]\\s*(.*)$`,
      'im',
    );
    const match = content.match(pattern);
    if (!match) {
      throw new Error(
        `Missing metadata field "${field}" in evidence file: ${filePath}`,
      );
    }

    const rawValue = match[2] ? String(match[2]).trim() : '';
    const normalized = rawValue
      .replace(/^['"]|['"]$/g, '')
      .trim()
      .toLowerCase();
    if (!normalized) {
      throw new Error(
        `Metadata field "${field}" has an empty value in evidence file: ${filePath}`,
      );
    }

    if (
      PLACEHOLDER_METADATA_VALUES.has(normalized) ||
      /^tbd\b/.test(normalized) ||
      /^todo\b/.test(normalized)
    ) {
      throw new Error(
        `Metadata field "${field}" uses placeholder value "${rawValue}" in evidence file: ${filePath}`,
      );
    }
  }
};

const countReviewers = content => {
  const matches = content.match(/(^|\n)\s*[-*]?\s*reviewer[\w-]*\s*[:=]/gim);
  return matches ? matches.length : 0;
};

const validateEvidence = ({
  evidenceDir,
  requiredFiles,
  requiredMetadataFields,
  minimumReviewers,
  allowMissingEvidence,
}) => {
  const resolvedEvidenceDir = path.resolve(evidenceDir);
  const report = {
    evidenceDir: resolvedEvidenceDir,
    validatedFiles: [],
    skippedFiles: [],
  };

  for (const requiredFile of requiredFiles) {
    const filePath = path.resolve(resolvedEvidenceDir, requiredFile);
    if (!fs.existsSync(filePath)) {
      if (allowMissingEvidence) {
        report.skippedFiles.push(requiredFile);
        continue;
      }
      throw new Error(
        `Missing required evidence file "${requiredFile}" in ${resolvedEvidenceDir}`,
      );
    }

    const content = fs.readFileSync(filePath, 'utf8');
    validateMetadataFields({
      filePath,
      content,
      requiredMetadataFields,
    });

    if (
      requiredFile.toLowerCase() === 'review-evidence.md' &&
      Number.isFinite(minimumReviewers) &&
      minimumReviewers > 0
    ) {
      const reviewerCount = countReviewers(content);
      if (reviewerCount < minimumReviewers) {
        throw new Error(
          `Review evidence must contain at least ${String(
            minimumReviewers,
          )} reviewer entries. Found ${String(reviewerCount)} in ${filePath}.`,
        );
      }
    }

    report.validatedFiles.push(requiredFile);
  }

  return report;
};

const validateMigrationContracts = ({ targets, rootDir }) => {
  const baseDir = path.resolve(rootDir || process.cwd());
  const report = [];

  for (const target of targets) {
    const targetPath = path.resolve(baseDir, target.path);
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

const runGateCommands = ({ commands, cwd }) => {
  const executionDir = path.resolve(cwd || process.cwd());
  for (const command of commands) {
    const result = spawnSync(command, {
      cwd: executionDir,
      shell: true,
      stdio: 'inherit',
    });

    if (typeof result.status === 'number' && result.status !== 0) {
      throw new Error(
        `Gate command failed with exit code ${String(result.status)}: ${command}`,
      );
    }

    if (result.error) {
      throw new Error(
        `Gate command failed to execute: ${command}\n${result.error.message}`,
      );
    }
  }
};

const normalizeGateSnapshot = snapshot => {
  if (!snapshot || typeof snapshot !== 'object') {
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: Date.now(),
      gates: {},
    };
  }

  return {
    schemaVersion:
      typeof snapshot.schemaVersion === 'number'
        ? snapshot.schemaVersion
        : SCHEMA_VERSION,
    updatedAt:
      typeof snapshot.updatedAt === 'number' ? snapshot.updatedAt : Date.now(),
    gates:
      snapshot.gates && typeof snapshot.gates === 'object'
        ? snapshot.gates
        : {},
  };
};

const writeGateSnapshot = ({
  snapshotPath,
  gateName,
  passed,
  reason,
  summary,
  profilePath,
  timestamp,
}) => {
  if (!snapshotPath || typeof snapshotPath !== 'string') {
    throw new Error('Gate snapshot path must be a non-empty string');
  }
  if (!gateName || typeof gateName !== 'string') {
    throw new Error('Gate snapshot gateName must be a non-empty string');
  }

  const resolvedPath = path.resolve(snapshotPath);
  const normalizedGateName = gateName.trim();
  if (!normalizedGateName) {
    throw new Error('Gate snapshot gateName must be non-empty');
  }

  let snapshot = normalizeGateSnapshot(undefined);
  if (fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf8');
      snapshot = normalizeGateSnapshot(JSON.parse(raw));
    } catch (_error) {
      snapshot = normalizeGateSnapshot(undefined);
    }
  }

  const now =
    typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
      ? timestamp
      : Date.now();

  snapshot.schemaVersion = SCHEMA_VERSION;
  snapshot.updatedAt = now;
  snapshot.gates[normalizedGateName] = {
    passed: Boolean(passed),
    reason:
      typeof reason === 'string' && reason.trim().length > 0
        ? reason.trim()
        : undefined,
    updatedAt: now,
    profilePath: profilePath ? path.resolve(profilePath) : undefined,
    summary:
      summary && typeof summary === 'object'
        ? JSON.parse(JSON.stringify(summary))
        : undefined,
  };

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  return {
    snapshotPath: resolvedPath,
    gateName: normalizedGateName,
    passed: Boolean(passed),
    updatedAt: now,
  };
};

module.exports = {
  SCHEMA_VERSION,
  readJsonFile,
  validateProfileShape,
  validateEvidence,
  validateMigrationContracts,
  runGateCommands,
  writeGateSnapshot,
};
