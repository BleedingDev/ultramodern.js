import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';
import { runStableTypeScript } from './helpers/stable-typescript';

const packagesRoot = path.resolve(import.meta.dirname, '../../..');
const rendererOctane = path.join(packagesRoot, 'runtime/renderer-octane');
const appTools = path.join(packagesRoot, 'solutions/ultramodern-app-tools');

/** The installed package directory, without relying on an exported ./package.json. */
function packageRoot(from: string, name: string): string {
  const lookup = createRequire(path.join(from, 'package.json')).resolve.paths(
    name,
  );
  for (const directory of lookup ?? []) {
    const candidate = path.join(directory, name);
    if (fs.existsSync(path.join(candidate, 'package.json')))
      return fs.realpathSync(candidate);
  }
  throw new Error(`Cannot find ${name} installed for ${from}`);
}

// Mirrors generated-solid-app-types.test.ts: the create-time Octane template
// gained head sidecars (page.head.ts, about/page.head.ts) and route
// fallbacks (error.tsx, not-found.tsx) to reach parity with the
// hand-authored conformance fixtures. Typecheck the full generated route
// tree, including those new files, under TypeScript 7 with the admitted
// "octane" jsxImportSource.
test('a generated Octane app typechecks its routes under TypeScript 7', async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-generated-octane-types-')),
  );
  try {
    const targetDir = path.join(root, 'workspace');
    await generateUltramodernWorkspace({
      targetDir,
      packageName: 'octane-types',
      modernVersion: '3.8.3',
      renderer: 'octane',
      enableTailwind: false,
      generateAgentFiles: false,
      packageSource: { strategy: 'workspace' },
    });
    const app = path.join(targetDir, 'apps/shell-super-app');
    for (const relative of [
      'src/routes/page.head.ts',
      'src/routes/about/page.head.ts',
      'src/routes/error.tsx',
      'src/routes/not-found.tsx',
    ]) {
      expect(fs.existsSync(path.join(app, relative))).toBe(true);
    }
    const links: Record<string, string> = {
      '@modern-js/ultramodern-app-tools': appTools,
      '@modern-js/renderer-octane': rendererOctane,
      '@modern-js/renderer-core': packageRoot(
        rendererOctane,
        '@modern-js/renderer-core',
      ),
      '@modern-js/backend-federation-contracts': packageRoot(
        import.meta.dirname,
        '@modern-js/backend-federation-contracts',
      ),
      octane: packageRoot(rendererOctane, 'octane'),
      '@octanejs/tanstack-router': packageRoot(
        rendererOctane,
        '@octanejs/tanstack-router',
      ),
      '@types/node': packageRoot(import.meta.dirname, '@types/node'),
    };
    for (const [name, target] of Object.entries(links)) {
      const link = path.join(app, 'node_modules', name);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(target, link, 'dir');
    }
    // Check the app program itself; project references and declaration
    // emission belong to the workspace build, not to this type environment.
    fs.writeFileSync(
      path.join(app, 'tsconfig.check.json'),
      JSON.stringify({
        extends: './tsconfig.json',
        compilerOptions: {
          composite: false,
          declaration: false,
          emitDeclarationOnly: false,
          incremental: false,
          noEmit: true,
          types: ['node'],
        },
        include: ['src'],
        references: [],
      }),
    );
    const result = runStableTypeScript(
      ['-p', 'tsconfig.check.json', '--pretty', 'false'],
      app,
    );
    expect(result.output).toBe('');
    expect(result.status).toBe(0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
