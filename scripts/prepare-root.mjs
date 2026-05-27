#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.env.CI === 'true') {
  console.log(
    'Skipping root prepare in CI; workflows run explicit build gates.',
  );
  process.exit(0);
}

run('npm', ['run', 'prepare-build']);
run('husky', []);
