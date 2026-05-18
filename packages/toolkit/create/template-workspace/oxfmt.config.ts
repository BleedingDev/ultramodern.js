import { defineConfig } from 'oxfmt';
import ultracite from 'ultracite/oxfmt';

export default defineConfig({
  extends: [ultracite],
  ignorePatterns: [
    '.agents',
    '**/*.json',
    'dist',
    'node_modules',
    '.modern',
    '.modernjs',
    '**/routeTree.gen.ts',
  ],
  singleQuote: true,
});
