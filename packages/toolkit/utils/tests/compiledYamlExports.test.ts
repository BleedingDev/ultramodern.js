import { execFileSync } from 'node:child_process';
import path from 'node:path';

const packageRoot = path.resolve(__dirname, '..');

const runNode = (args: string[]) =>
  execFileSync(process.execPath, args, {
    cwd: packageRoot,
    encoding: 'utf8',
  });

describe('compiled yaml exports', () => {
  it('loads YAML through the native CommonJS package export', () => {
    const output = runNode([
      '-e',
      `const { yaml } = require('@modern-js/utils');
process.stdout.write(JSON.stringify(yaml.load('answer: 42')));`,
    ]);

    expect(JSON.parse(output)).toEqual({ answer: 42 });
  });

  it('loads YAML through the native ESM package export', () => {
    const output = runNode([
      '--input-type=module',
      '-e',
      `import { yaml } from '@modern-js/utils';
process.stdout.write(JSON.stringify(yaml.load('answer: 42')));`,
    ]);

    expect(JSON.parse(output)).toEqual({ answer: 42 });
  });
});
