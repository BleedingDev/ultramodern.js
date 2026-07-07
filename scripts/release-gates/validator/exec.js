const path = require('path');
const { runCommandList, runShellCommand } = require('../../lib/process-kit');

const executeCommand = ({ command, cwd, commandRunner, failureMessage }) => {
  if (typeof commandRunner === 'function') {
    commandRunner({
      command,
      cwd,
    });
    return;
  }

  const result = runShellCommand(command, {
    cwd,
  });

  if (typeof result.processStatus === 'number' && result.processStatus !== 0) {
    throw new Error(
      `${failureMessage} (exit code ${String(result.processStatus)})`,
    );
  }

  if (result.error) {
    throw new Error(`${failureMessage}\n${result.error.message}`);
  }
};

const runGateCommands = ({ commands, cwd }) => {
  const executionDir = path.resolve(cwd || process.cwd());
  const results = runCommandList(
    commands.map(command => ({
      command,
      cwd: executionDir,
    })),
    {
      includeErrors: true,
      includeProcessStatus: true,
    },
  );
  const failed = results.find(result => result.exitCode !== 0 || result.error);
  if (failed) {
    const failureMessage = `Gate command failed: ${failed.command}`;
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
  executeCommand,
  runGateCommands,
};
