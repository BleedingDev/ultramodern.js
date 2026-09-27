#!/usr/bin/env node
import { runMicroVerticalApiCheckCli } from '../dist/esm-node/cli/microvertical-api-check.js';

process.exitCode = await runMicroVerticalApiCheckCli(
  process.argv.slice(2),
  true,
);
