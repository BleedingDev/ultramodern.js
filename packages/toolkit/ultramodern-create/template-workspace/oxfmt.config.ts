import { defineConfig } from 'oxfmt';
import ultracite from 'ultracite/oxfmt';

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    '.agents',
    '.codex/skills',
    '.output',
    '**/*.json',
    'dist',
    'node_modules',
    'repos/**',
    '.modern',
    '.modernjs',
    '**/modern-tanstack/**',
    '**/routeTree.gen.*',
  ],
  singleQuote: true,
});
