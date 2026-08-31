import { type CommandContext, spawnNodeScript } from './context';

export function runSkills(args: string[], context: CommandContext) {
  const [subcommand, ...rest] = args;
  if (subcommand === 'install') {
    return spawnNodeScript(
      'template-workspace/scripts/bootstrap-agent-skills.mjs',
      rest,
      context,
    );
  }
  if (subcommand === 'check') {
    return spawnNodeScript(
      'template-workspace/scripts/bootstrap-agent-skills.mjs',
      ['--check', ...rest],
      context,
    );
  }

  throw new Error(
    'Usage: ultramodern-create ultramodern skills <install|check>',
  );
}
