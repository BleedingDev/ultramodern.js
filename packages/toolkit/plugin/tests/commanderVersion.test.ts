import * as utils from '@modern-js/utils' with { rstest: 'importActual' };
import { rs } from '@rstest/core';
import {
  initCommandsMap,
  program,
  setProgramVersion,
} from '../src/cli/run/utils/commander';

rs.mock('@modern-js/utils', () => ({ ...utils, program: new utils.Command() }));

it('keeps one version option when the CLI restarts after a config change', () => {
  const output: string[] = [];
  program.configureOutput({ writeOut: text => output.push(text) });
  program.exitOverride();

  setProgramVersion('3.9.0');
  expect(() => setProgramVersion('3.9.0')).not.toThrow();
  expect(
    program.options.filter(option => option.long === '--version'),
  ).toHaveLength(1);
  expect(() => program.parse(['--version'], { from: 'user' })).toThrow();
  expect(output).toEqual(['3.9.0\n']);
});

it('keeps the CLI command map current without augmenting native commands', () => {
  const first = program.command('first');
  const initialized = initCommandsMap();
  expect(initialized.commandsMap.get('first')).toBe(first);
  const second = program.command('second');
  expect(initialized.commandsMap.get('second')).toBe(second);
  expect(initCommandsMap()).toBe(initialized);
});
