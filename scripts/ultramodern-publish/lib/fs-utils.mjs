// Consumer: BleedingDev release staging and build package discovery.
import fs from 'node:fs';
import path from 'node:path';

function collectPackageJsonFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') {
        results.push(...collectPackageJsonFiles(filePath));
      }
    } else if (entry.name === 'package.json') {
      results.push(filePath);
    }
  }
  return results;
}

export { collectPackageJsonFiles };
