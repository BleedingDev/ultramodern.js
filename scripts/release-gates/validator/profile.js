const { ensureSchemaVersion } = require('../../lib/validation-kit');
const { SCHEMA_VERSION } = require('./schema');

const validateProfileShape = profile => {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Profile must be a JSON object');
  }

  ensureSchemaVersion({
    actual: profile.schemaVersion,
    expected: SCHEMA_VERSION,
    label: 'profile',
  });

  if (!profile.evidence || typeof profile.evidence !== 'object') {
    throw new Error('Profile is missing "evidence" section');
  }

  if (!Array.isArray(profile.evidence.requiredFiles)) {
    throw new Error('Profile evidence.requiredFiles must be an array');
  }

  if (!Array.isArray(profile.evidence.requiredMetadataFields)) {
    throw new Error('Profile evidence.requiredMetadataFields must be an array');
  }

  if (!Array.isArray(profile.gateCommands)) {
    throw new Error('Profile gateCommands must be an array');
  }

  profile.gateCommands.forEach((command, index) => {
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new Error(
        `Profile gateCommands[${index}] must be a command object`,
      );
    }
    if (typeof command.command !== 'string' || command.command.length === 0) {
      throw new Error(
        `Profile gateCommands[${index}].command must be a non-empty string`,
      );
    }
    if (command.args !== undefined && !Array.isArray(command.args)) {
      throw new Error(`Profile gateCommands[${index}].args must be an array`);
    }
  });
};

module.exports = {
  validateProfileShape,
};
