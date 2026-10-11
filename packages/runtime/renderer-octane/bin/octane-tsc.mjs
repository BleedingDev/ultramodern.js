#!/usr/bin/env node
import { runOctaneTypecheck } from '../dist/esm-node/typecheck.mjs';

process.exitCode = runOctaneTypecheck(process.argv.slice(2));
