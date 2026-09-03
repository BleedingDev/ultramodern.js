#!/usr/bin/env node
// Consumer: publish-bleedingdev.yml ERP acceptance browser provisioning.
import { provisionAcceptanceBrowsers } from './published-create-proof/browser-provisioning.mjs';

try {
  provisionAcceptanceBrowsers();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
}
