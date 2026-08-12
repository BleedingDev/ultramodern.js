const path = require('path');
const { runCommandList } = require('../../lib/process-kit');

const formatCommand = ({ command, args = [] }) => [command, ...args].join(' ');

const normalizeCommandSpec = value => {
  const spec = Array.isArray(value)
    ? { command: value[0], args: value.slice(1) }
    : value;
  if (!spec || typeof spec.command !== 'string' || spec.command.length === 0) {
    throw new Error('Gate command must include a command string');
  }
  if (spec.args !== undefined && !Array.isArray(spec.args)) {
    throw new Error('Gate command args must be an array');
  }
  const normalized = {
    ...spec,
    args: spec.args || [],
  };
  return {
    ...normalized,
    label: spec.label || formatCommand(normalized),
  };
};

const runGateCommands = ({ commands, cwd }) => {
  const executionDir = path.resolve(cwd || process.cwd());
  const results = runCommandList(
    commands.map(command => ({
      ...normalizeCommandSpec(command),
      cwd: executionDir,
    })),
    {
      includeErrors: true,
      includeProcessStatus: true,
    },
  );
  const failed = results.find(result => result.exitCode !== 0 || result.error);
  if (failed) {
    const failureMessage = `Gate command failed: ${
      failed.label || formatCommand(failed)
    }`;
    if (
      typeof failed.processStatus === 'number' &&
      failed.processStatus !== 0
    ) {
      throw new Error(
        `${failureMessage} (exit code ${String(failed.processStatus)})`,
      );
    }

    if (failed.error) {
      throw new Error(`${failureMessage}\n${failed.error.message}`);
    }
  }
};

module.exports = {
  runGateCommands,
};
