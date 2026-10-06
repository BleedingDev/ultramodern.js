import { type Command, program } from '@modern-js/utils/commander';
import type { CliProgram } from '../../../types/cli/hooks';

export const setProgramVersion = (version = 'unknown') => {
  const name = process.argv[1];
  program.name(name).usage('<command> [options]');
  if (program.version() !== version) {
    program.version(version);
  }
};

export function initCommandsMap(): CliProgram {
  if (!program.hasOwnProperty('commandsMap')) {
    Object.defineProperty(program, 'commandsMap', {
      get() {
        const map = new Map<string, Command>();
        for (const command of program.commands) {
          map.set((command as any)._name, command);
        }
        return map;
      },
      configurable: false,
    });
  }
  return program as CliProgram;
}

export type { Command };
export { program };
