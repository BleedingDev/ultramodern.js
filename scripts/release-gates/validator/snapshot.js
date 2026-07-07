const fs = require('fs');
const path = require('path');
const { writeJsonFile } = require('../../lib/fs-kit');
const { ensureFileExists, readJsonFile } = require('../../lib/validation-kit');
const { SCHEMA_VERSION } = require('./schema');

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

  writeJsonFile(resolvedPath, snapshot, { atomic: false });
  return {
    snapshotPath: resolvedPath,
    gateName: normalizedGateName,
    passed: Boolean(passed),
    updatedAt: now,
  };
};

const validateGateSnapshotShape = snapshot => {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Gate snapshot must be a JSON object');
  }

  if (
    typeof snapshot.schemaVersion !== 'number' ||
    snapshot.schemaVersion <= 0
  ) {
    throw new Error('Gate snapshot schemaVersion must be a positive number');
  }

  if (typeof snapshot.updatedAt !== 'number' || snapshot.updatedAt <= 0) {
    throw new Error('Gate snapshot updatedAt must be a positive timestamp');
  }

  if (!snapshot.gates || typeof snapshot.gates !== 'object') {
    throw new Error('Gate snapshot gates must be an object');
  }
};

const validateGateSnapshotFile = ({ snapshotPath, requiredGateNames = [] }) => {
  const resolvedSnapshotPath = path.resolve(snapshotPath);
  ensureFileExists(resolvedSnapshotPath);
  const snapshot = readJsonFile(resolvedSnapshotPath);
  validateGateSnapshotShape(snapshot);

  const gates = snapshot.gates;
  const gateNames = Object.keys(gates);

  for (const gateName of requiredGateNames) {
    if (!gateNames.includes(gateName)) {
      throw new Error(
        `Gate snapshot is missing required gate "${gateName}" in ${resolvedSnapshotPath}`,
      );
    }
  }

  for (const [gateName, gateValue] of Object.entries(gates)) {
    if (!gateValue || typeof gateValue !== 'object') {
      throw new Error(
        `Gate snapshot entry "${gateName}" must be an object in ${resolvedSnapshotPath}`,
      );
    }

    if (typeof gateValue.passed !== 'boolean') {
      throw new Error(
        `Gate snapshot entry "${gateName}" must include boolean "passed"`,
      );
    }

    if (typeof gateValue.updatedAt !== 'number' || gateValue.updatedAt <= 0) {
      throw new Error(
        `Gate snapshot entry "${gateName}" must include positive numeric "updatedAt"`,
      );
    }
  }

  return {
    snapshotPath: resolvedSnapshotPath,
    gateCount: gateNames.length,
    gates: gateNames.sort(),
  };
};

module.exports = {
  writeGateSnapshot,
  validateGateSnapshotFile,
};
