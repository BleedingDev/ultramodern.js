import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';
import { runStableTypeScript } from './helpers/stable-typescript';

const packagesRoot = path.resolve(import.meta.dirname, '../../..');
const rendererSolid = path.join(packagesRoot, 'runtime/renderer-solid');
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

// C55: a generated Solid app's production build failed in its native type
// checker with TS2882 for `import './index.css'` (TypeScript 7 checks
// side-effect imports), so the client compilation never emitted its
// solid-module-manifest. The generated environment must type its assets.
test('a generated Solid app typechecks its CSS imports under TypeScript 7', async () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-generated-solid-types-')),
  );
  try {
    const targetDir = path.join(root, 'workspace');
    await generateUltramodernWorkspace({
      targetDir,
      packageName: 'solid-types',
      modernVersion: '3.8.3',
      renderer: 'solid',
      enableTailwind: false,
      generateAgentFiles: false,
      packageSource: { strategy: 'workspace' },
    });
    const app = path.join(targetDir, 'apps/shell-super-app');
    expect(
      fs.readFileSync(path.join(app, 'src/routes/layout.tsx'), 'utf8'),
    ).toContain(`import './index.css';`);
    const web = packageRoot(rendererSolid, '@solidjs/web');
    const links: Record<string, string> = {
      '@modern-js/ultramodern-app-tools': appTools,
      '@modern-js/renderer-solid': rendererSolid,
      '@modern-js/renderer-core': packageRoot(
        rendererSolid,
        '@modern-js/renderer-core',
      ),
      '@modern-js/backend-federation-contracts': packageRoot(
        import.meta.dirname,
        '@modern-js/backend-federation-contracts',
      ),
      '@solidjs/web': web,
      'solid-js': packageRoot(web, 'solid-js'),
      '@tanstack/router-core': packageRoot(
        rendererSolid,
        '@tanstack/router-core',
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
    expect(result.output).not.toContain('TS2882');
    expect(result.output).toBe('');
    expect(result.status).toBe(0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
