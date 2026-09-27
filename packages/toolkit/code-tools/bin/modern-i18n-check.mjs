#!/usr/bin/env node
import { runWorkspaceSourceCheckCli } from '../dist/esm-node/cli/workspace-source-check.js';

process.exitCode = runWorkspaceSourceCheckCli();
