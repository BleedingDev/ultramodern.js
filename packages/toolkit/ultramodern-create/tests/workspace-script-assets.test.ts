import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addUltramodernVertical } from '../src/ultramodern-workspace';
import { shellApp } from '../src/ultramodern-workspace/descriptors';
import { createPublicSurfaceGenerationCommand } from '../src/ultramodern-workspace/public-surface';
import { createWorkspaceAppPackageScripts } from '../src/ultramodern-workspace/workspace-script-plan';
import { createWorkspaceScriptArtifacts } from '../src/ultramodern-workspace/workspace-scripts';
import { createWorkspace } from './helpers/workspace-kit';

test('workspace scripts contain only application-owned behavior', () => {
  const artifacts = createWorkspaceScriptArtifacts();
  assert.deepEqual(artifacts.map(artifact => artifact.relativePath).sort(), [
    'scripts/setup-agent-reference-repos.mts',
    'scripts/ultramodern-performance-readiness.config.mjs',
  ]);
  assert(artifacts.every(artifact => artifact.content.trim().length > 0));
});

test('public surface generation invokes the installed CLI from the workspace root', () => {
  assert.equal(
    createPublicSurfaceGenerationCommand(shellApp, 'cloudflare-dist', true),
    'pnpm --dir ../.. exec ultramodern-create ultramodern public-surface --app shell-super-app --target cloudflare-dist --require-public-origin',
  );
  const routesGenerate =
    'pnpm --dir ../.. exec ultramodern-create ultramodern routes-generate --app shell-super-app --manifest-only';
  const scripts = createWorkspaceAppPackageScripts(shellApp);
  assert.equal(scripts.dev, `${routesGenerate} && modern dev`);
  assert(
    scripts.build.startsWith(
      `${routesGenerate} && modern build --deploy-target node && `,
    ),
  );
  assert(
    scripts['cloudflare:build'].startsWith(
      `${routesGenerate} && modern build --deploy-target cloudflare && `,
    ),
  );
  assert.doesNotMatch(
    Object.values(scripts).join('\n'),
    /--sync-route-metadata/u,
  );
  const headlessScripts = createWorkspaceAppPackageScripts({
    ...shellApp,
    surfaceProfile: 'api-only',
  });
  assert.equal(headlessScripts.dev, 'modern dev');
  assert.doesNotMatch(headlessScripts.build, /routes-generate/u);
});

test('manifest-only route generation never loads the app for a build', () => {
  // dev runs this first; the full generator analyzes the app as a production
  // build, which must not happen before a development server starts.
  const appDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-routes-generate-'),
  );
  try {
    const plugin = path.join(
      appDirectory,
      'node_modules/@modern-js/plugin-tanstack',
    );
    fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(path.join(appDirectory, 'package.json'), '{}');
    fs.writeFileSync(
      path.join(plugin, 'package.json'),
      JSON.stringify({ name: '@modern-js/plugin-tanstack', main: 'index.mjs' }),
    );
    fs.writeFileSync(
      path.join(plugin, 'index.mjs'),
      `import fs from 'node:fs';
export const writeRouteMetadataManifest = async ({ appDirectory }) =>
  fs.writeFileSync(appDirectory + '/manifest-written', '');
export const generateTanstackRouteArtifacts = async () => {
  throw new Error('loaded the app as a build');
};
`,
    );
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            '../dist/esm-node/ultramodern-tooling/commands/routes-generate-app.js',
            import.meta.url,
          ),
        ),
        appDirectory,
        'shell',
        'manifest',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert(fs.existsSync(path.join(appDirectory, 'manifest-written')));
  } finally {
    fs.rmSync(appDirectory, { recursive: true, force: true });
  }
});

test('fresh route manifests are what routes-generate writes for them', async () => {
  // plugin-tanstack owns the manifest format; the scaffold must write the same
  // bytes so the first routes-generate run changes nothing.
  const { findRouteMetaFiles, renderRouteMetadataManifest } = (await import(
    new URL(
      '../../../runtime/plugin-tanstack/src/cli/routeMetadata.ts',
      import.meta.url,
    ).href
  )) as {
    findRouteMetaFiles(routesDirectory: string): Promise<string[]>;
    renderRouteMetadataManifest(files: readonly string[]): string | null;
  };
  const { tempRoot, workspaceDir } = createWorkspace(
    'route-manifest-stability',
  );
  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    for (const appPath of ['apps/shell-super-app', 'verticals/catalog']) {
      const routesDirectory = path.join(workspaceDir, appPath, 'src/routes');
      assert.equal(
        fs.readFileSync(
          path.join(routesDirectory, 'ultramodern-route-metadata.ts'),
          'utf8',
        ),
        renderRouteMetadataManifest(await findRouteMetaFiles(routesDirectory)),
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('public surface reads authored route metadata and preserves output and content choices', async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-public-surface-'),
  );
  try {
    const write = (relativePath: string, content: string) => {
      const file = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    };
    write(
      'topology/reference-topology.json',
      JSON.stringify({
        schemaVersion: 1,
        shell: {
          id: 'shell',
          kind: 'shell',
          path: 'apps/shell',
          routes: {
            publicSurface: {
              outputRoot: 'dist/authored-public',
              contentSources: [
                {
                  routeId: 'catalog',
                  module: 'src/routes/[lang]/catalog/[item]/route.sitemap.mjs',
                },
              ],
            },
          },
        },
        verticals: [],
      }),
    );
    write(
      'apps/shell/src/routes/[lang]/route.meta.ts',
      `export default {
      id: 'private-home', ownerAppId: 'shell', canonicalPath: '/',
      public: false, indexable: false, localisedPaths: { en: '/', cs: '/' }
    } as const;`,
    );
    write(
      'apps/shell/src/routes/[lang]/pricing/route.meta.ts',
      `const authoredJsonLd = () => ({ '@context': 'https://schema.org', '@type': 'WebPage' });
      export const routeMeta = {
      id: 'pricing', ownerAppId: 'shell', canonicalPath: '/pricing',
      public: true, indexable: true, localisedPaths: { en: '/pricing', cs: '/ceny' },
      jsonLd: authoredJsonLd()
    } as const;`,
    );
    write(
      'apps/shell/src/routes/[lang]/catalog/[item]/route.meta.ts',
      `export default {
      id: 'catalog', ownerAppId: 'shell', canonicalPath: '/catalog/:item',
      public: true, indexable: true, localisedPaths: { en: '/catalog/:item', cs: '/katalog/:item' }
    } as const;`,
    );
    write(
      'apps/shell/src/routes/[lang]/catalog/[item]/route.sitemap.mjs',
      "export default [{ params: { item: 'alpha' } }];",
    );
    const script = fileURLToPath(
      new URL(
        '../templates/workspace-scripts/generate-public-surface-assets.mjs',
        import.meta.url,
      ),
    );
    const result = spawnSync(
      process.execPath,
      [script, '--app', 'shell', '--target', 'dist'],
      {
        env: {
          ...process.env,
          ULTRAMODERN_WORKSPACE_ROOT: root,
          MODERN_PUBLIC_SITE_URL: 'https://example.test',
        },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const output = path.join(root, 'apps/shell/dist/authored-public');
    const sitemap = fs.readFileSync(path.join(output, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /https:\/\/example\.test\/en\/pricing/u);
    assert.match(sitemap, /https:\/\/example\.test\/en\/catalog\/alpha/u);
    assert.doesNotMatch(sitemap, /private-home/u);
    assert.match(
      fs.readFileSync(path.join(output, 'robots.txt'), 'utf8'),
      /Allow: \/en\/pricing\$/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('adding a vertical preserves authored route metadata and its manifest', () => {
  const { tempRoot, workspaceDir } = createWorkspace('public-route-owner');
  try {
    const routePath = path.join(
      workspaceDir,
      'apps/shell-super-app/src/routes/[lang]/route.meta.ts',
    );
    const initial = fs.readFileSync(routePath, 'utf8');
    const authored = initial
      .replace(/(public\s*:\s*)false/u, '$1true')
      .replace(/(indexable\s*:\s*)false/u, '$1true');
    assert.notEqual(authored, initial);
    fs.writeFileSync(routePath, authored);
    const aggregatePath = path.join(
      workspaceDir,
      'apps/shell-super-app/src/routes/ultramodern-route-metadata.ts',
    );
    const aggregate = fs.readFileSync(aggregatePath, 'utf8');
    assert.match(aggregate, /import \{ routeMeta as route0 \}/u);
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    assert.equal(fs.readFileSync(routePath, 'utf8'), authored);
    assert.equal(fs.readFileSync(aggregatePath, 'utf8'), aggregate);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
