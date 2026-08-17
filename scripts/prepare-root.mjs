#!/usr/bin/env node
import processKit from './lib/process-kit.js';

const { runCommand } = processKit;

function run(command, args) {
  const result = runCommand(command, args, {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

// GitHub Actions always sets CI=true, so the root `prepare` lifecycle hook is
// intentionally a no-op in CI: `pnpm install` (e.g. in the trusted-publish
// lane) must never trigger a full nx build. The flip side of this contract is
// that CI workflows MUST invoke their build gate explicitly — `pnpm run
// prepare-build` — instead of relying on `pnpm run prepare` (see
// type-check.yml, integration-test-*.yml, ultramodern-nightly.yml).
if (process.env.CI === 'true') {
  console.log(
    'Skipping root prepare in CI; workflows run explicit build gates.',
  );
  process.exit(0);
}

run('npm', ['run', 'prepare-build:local']);
run('husky', []);
