import { defineConfig } from 'oxlint';
import core from 'ultracite/oxlint/core';
import react from 'ultracite/oxlint/react';

export default defineConfig({
  env: {
    browser: true,
    node: true,
  },
  extends: [core, react],
  ignorePatterns: [
    '.agents',
    '.codex/skills',
    '.output',
    'dist',
    'node_modules',
    'repos/**',
    '.modern',
    '.modernjs',
    '**/modern-tanstack/**',
    '**/routeTree.gen.*',
  ],
});
