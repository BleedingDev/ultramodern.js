#!/usr/bin/env node
import path from 'node:path';
import { runWorkspaceSourceCheck } from '@modern-js/code-tools';

const root = path.resolve(import.meta.dirname, '..');
process.exitCode = runWorkspaceSourceCheck({
  cwd: root,
  sourceRoots: ['apps', 'verticals'],
});
