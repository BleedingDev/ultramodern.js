const { readJsonFile } = require('../lib/validation-kit');
const { SCHEMA_VERSION } = require('./validator/schema');
const { validateProfileShape } = require('./validator/profile');
const { validateEvidence } = require('./validator/evidence');
const { validateMigrationContracts } = require('./validator/migration');
const { runGateCommands } = require('./validator/exec');
const {
  writeGateSnapshot,
  validateGateSnapshotFile,
} = require('./validator/snapshot');

module.exports = {
  SCHEMA_VERSION,
  readJsonFile,
  validateProfileShape,
  validateEvidence,
  validateMigrationContracts,
  runGateCommands,
  writeGateSnapshot,
  validateGateSnapshotFile,
};
