#!/usr/bin/env node
import { main } from './tractor-downstream/main.mjs';

main().catch(error => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
