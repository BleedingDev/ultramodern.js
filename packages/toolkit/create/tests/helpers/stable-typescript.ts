import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

type TypeScriptPackageJson = {
  bin?: Record<string, string> | string;
};

const require = createRequire(import.meta.url);

function resolveStableTypeScriptCli(): string {
  const packageJsonPath = require.resolve('typescript/package.json');
  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, 'utf-8'),
  ) as TypeScriptPackageJson;
  const bin =
    typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.tsc;

  if (!bin) {
    throw new Error('The stable TypeScript package does not expose its CLI.');
  }

  return path.resolve(path.dirname(packageJsonPath), bin);
}

export function runStableTypeScript(
  args: string[],
  cwd: string,
): { output: string; status: number | null } {
  const result = spawnSync(
    process.execPath,
    [resolveStableTypeScriptCli(), ...args],
    {
      cwd,
      encoding: 'utf-8',
    },
  );

  if (result.error) {
    throw result.error;
  }

  return {
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    status: result.status,
  };
}
