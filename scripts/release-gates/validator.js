const { readJsonFile } = require('../lib/validation-kit');
const { SCHEMA_VERSION } = require('./validator/schema');
const { validateProfileShape } = require('./validator/profile');
const { validateEvidence } = require('./validator/evidence');
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
  runGateCommands,
  writeGateSnapshot,
  validateGateSnapshotFile,
};
