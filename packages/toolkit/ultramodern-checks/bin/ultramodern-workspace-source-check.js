#!/usr/bin/env node
import('../dist/esm-node/cli/workspace-source-check.js').then(({ main }) => {
  main();
});
