import fs from 'node:fs';
import path from 'node:path';

const distRoot = path.resolve(__dirname, '..', 'dist');

const staticSpecifiers = (source: string) => {
  const specifiers: string[] = [];
  for (const match of source.matchAll(
    /^\s*(?:import|export)[^\n]*?from\s+["']([^"']+)["']/gm,
  )) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
    specifiers.push(match[1]);
  }
  return specifiers;
};

// FORK: upstream has no optional-peer story here. `zod` is declared as an
// OPTIONAL peer dependency of @modern-js/bff-core, but a literal
// `require('zod')` in src/security/operationContracts.ts is externalized by
// rslib/rspack into a top-level `import * as ... from "zod"` in the esm-node
// output. That turned the optional peer into a hard runtime requirement:
// @modern-js/plugin-bff's root, ./cli, ./server-plugin and ./hono-server entries
// all reach this module transitively and threw ERR_MODULE_NOT_FOUND: zod for
// any consumer that had not installed zod. The source now assembles the
// specifier at runtime and loads it through createRequire.
describe('zod stays an optional peer', () => {
  test('source never names zod in a statically analysable load', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'src', 'security', 'operationContracts.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/require\(\s*['"]zod['"]\s*\)/);
    expect(source).not.toMatch(/^\s*import[^\n]*from\s+['"]zod['"]/m);
    expect(source).toContain("['z', 'o', 'd'].join('')");
  });

  test.each([
    'esm-node',
    'esm',
    'cjs',
  ])('%s output has no eager zod dependency', format => {
    const file = path.join(
      distRoot,
      format,
      'security',
      format === 'cjs' ? 'operationContracts.js' : 'operationContracts.mjs',
    );
    if (!fs.existsSync(file)) {
      // Build artefact absent (fresh checkout); the source assertion above is
      // the primary guard.
      return;
    }
    const source = fs.readFileSync(file, 'utf8');
    expect(staticSpecifiers(source)).not.toContain('zod');
    expect(source).not.toMatch(/require\(\s*["']zod["']\s*\)/);
  });
});
