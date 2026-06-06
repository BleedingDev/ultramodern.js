#!/usr/bin/env node
import('../dist/esm-node/cli/i18n-check.js').then(({ main }) => {
  main();
});
