import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const packageDirectory = path.resolve(__dirname, '../..');
const requireFromPackage = createRequire(
  path.join(packageDirectory, 'package.json'),
);

test.each(['.mts', '.cts'])(
  'keeps public plugin factory declarations callable from %s consumers',
  extension => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'um-plugin-factory-types-'),
    );
    try {
      const scope = path.join(directory, 'node_modules/@modern-js');
      fs.mkdirSync(scope, { recursive: true });
      fs.symlinkSync(
        packageDirectory,
        path.join(scope, 'ultramodern-app-tools'),
        'dir',
      );
      fs.symlinkSync(
        path.join(
          packageDirectory,
          'node_modules/@modern-js/server-runtime-extensions',
        ),
        path.join(scope, 'server-runtime-extensions'),
        'dir',
      );
      fs.writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify({ private: true }),
      );
      const fileName = `consumer${extension}`;
      fs.writeFileSync(
        path.join(directory, fileName),
        `
import serverPlugin from '@modern-js/ultramodern-app-tools/server-plugin';
import ownerServerPlugin from '@modern-js/server-runtime-extensions/server-plugin';
import routerPlugin from '@modern-js/ultramodern-app-tools/router-runtime';
import { ultramodernAppTools } from '@modern-js/ultramodern-app-tools';
const plugins = [serverPlugin(), ownerServerPlugin(), routerPlugin(), ultramodernAppTools()];
const names: Array<string | undefined> = plugins.map(plugin => plugin.name);
void names;
// @ts-expect-error public factory typing must not become any
serverPlugin({ unexpected: true });
// @ts-expect-error owner factory typing must not become any
ownerServerPlugin({ unexpected: true });
`,
    );
    fs.writeFileSync(
      path.join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'ES2022',
        },
        files: [fileName],
      }),
    );
    const compilerManifestPath = requireFromPackage.resolve(
      'typescript/package.json',
    );
    const compilerManifest = JSON.parse(
      fs.readFileSync(compilerManifestPath, 'utf8'),
    );
    expect(compilerManifest).toMatchObject({
      name: 'typescript',
      version: '7.0.2',
    });
    const launcher = path.resolve(
      path.dirname(compilerManifestPath),
      compilerManifest.bin.tsc,
    );
    const result = spawnSync(
      process.execPath,
      [launcher, '-p', path.join(directory, 'tsconfig.json')],
      { cwd: directory, encoding: 'utf8' },
    );
    if (result.status !== 0)
      throw new Error(result.stdout + result.stderr, { cause: result.error });
    expect(result.stdout).toBe('');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// The router entry is bundled by router-integration.test.ts, like the native router.
test.each(['module', 'commonjs'])(
  'loads and calls public plugin factories through real Node %s exports',
  moduleType => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'um-plugin-factory-runtime-'),
    );
    try {
      const scope = path.join(directory, 'node_modules/@modern-js');
      fs.mkdirSync(scope, { recursive: true });
      fs.symlinkSync(
        packageDirectory,
        path.join(scope, 'ultramodern-app-tools'),
        'dir',
      );
      fs.symlinkSync(
        path.join(
          packageDirectory,
          'node_modules/@modern-js/server-runtime-extensions',
        ),
        path.join(scope, 'server-runtime-extensions'),
        'dir',
      );
      fs.writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify({ private: true, type: moduleType }),
      );
      const imports =
        moduleType === 'module'
          ? `
import serverPlugin from '@modern-js/ultramodern-app-tools/server-plugin';
import ownerServerPlugin from '@modern-js/server-runtime-extensions/server-plugin';
import { ultramodernAppTools } from '@modern-js/ultramodern-app-tools';
`
          : `
const { default: serverPlugin } = require('@modern-js/ultramodern-app-tools/server-plugin');
const { default: ownerServerPlugin } = require('@modern-js/server-runtime-extensions/server-plugin');
const { ultramodernAppTools } = require('@modern-js/ultramodern-app-tools');
`;
      const source =
        imports +
        `
const factories = [serverPlugin, ownerServerPlugin, ultramodernAppTools];
process.stdout.write(JSON.stringify(factories.map(factory => ({ type: typeof factory, name: factory().name }))));
`;
      const entry = path.join(
        directory,
        moduleType === 'module' ? 'consumer.mjs' : 'consumer.cjs',
      );
      fs.writeFileSync(entry, source);
      const result = spawnSync(process.execPath, [entry], {
        cwd: directory,
        encoding: 'utf8',
      });
      if (result.status !== 0)
        throw new Error(result.stdout + result.stderr, { cause: result.error });
      const factories = JSON.parse(result.stdout) as Array<{
        type: string;
        name: string;
      }>;
      expect(factories[0].name).toBe('@modern-js/ultramodern-server');
      expect(factories[1].name).toBe('@modern-js/ultramodern-server');
      expect(factories[2].name).toBe('@modern-js/ultramodern-app-tools');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);
