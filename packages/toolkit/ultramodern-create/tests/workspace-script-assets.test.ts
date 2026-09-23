import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addUltramodernVertical } from '../src/ultramodern-workspace';
import { shellApp } from '../src/ultramodern-workspace/descriptors';
import { createPublicSurfaceGenerationCommand } from '../src/ultramodern-workspace/public-surface';
import { createWorkspaceAppPackageScripts } from '../src/ultramodern-workspace/workspace-script-plan';
import { createWorkspaceScriptArtifacts } from '../src/ultramodern-workspace/workspace-scripts';
import { createWorkspace } from './helpers/workspace-kit';

test('workspace scripts contain only application-owned behavior', () => {
  const artifacts = createWorkspaceScriptArtifacts();
  assert.deepEqual(artifacts.map(artifact => artifact.relativePath).sort(), [
    'scripts/check-ultramodern-i18n-boundaries.mts',
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
  const scripts = createWorkspaceAppPackageScripts(shellApp);
  assert.match(scripts.dev, /--sync-route-metadata && modern dev$/u);
  assert.match(
    scripts.build,
    /^pnpm --dir \.\.\/\.\. exec ultramodern-create ultramodern public-surface --app shell-super-app --target dist --sync-route-metadata && modern build/u,
  );
  assert.match(
    scripts['cloudflare:build'],
    /^pnpm --dir \.\.\/\.\. exec ultramodern-create ultramodern public-surface --app shell-super-app --target cloudflare-dist --sync-route-metadata && cross-env MODERNJS_DEPLOY=cloudflare modern build/u,
  );
});

test('fresh route aggregates are unchanged by their first metadata sync', () => {
  const { tempRoot, workspaceDir } = createWorkspace(
    'route-aggregate-stability',
  );
  try {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    const script = fileURLToPath(
      new URL(
        '../templates/workspace-scripts/generate-public-surface-assets.mjs',
        import.meta.url,
      ),
    );
    for (const [appId, appPath] of [
      ['shell-super-app', 'apps/shell-super-app'],
      ['catalog', 'verticals/catalog'],
    ]) {
      const aggregatePath = path.join(
        workspaceDir,
        appPath,
        'src/routes/ultramodern-route-metadata.ts',
      );
      const before = fs.readFileSync(aggregatePath, 'utf8');
      assert.match(before, /import \{ routeMeta as route0 \}/u);
      const sync = spawnSync(
        process.execPath,
        [script, '--app', appId, '--sync-route-metadata'],
        {
          env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: workspaceDir },
          encoding: 'utf8',
        },
      );
      assert.equal(sync.status, 0, sync.stderr);
      assert.equal(fs.readFileSync(aggregatePath, 'utf8'), before);
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
    const metadataPath = path.join(
      root,
      'apps/shell/src/routes/ultramodern-route-metadata.ts',
    );
    const authoredPath = path.join(
      root,
      'apps/shell/src/routes/[lang]/pricing/route.meta.ts',
    );
    const authoredBefore = fs.readFileSync(authoredPath, 'utf8');
    const sync = spawnSync(
      process.execPath,
      [script, '--app', 'shell', '--sync-route-metadata'],
      {
        env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: root },
        encoding: 'utf8',
      },
    );
    assert.equal(sync.status, 0, sync.stderr);
    assert.equal(fs.readFileSync(authoredPath, 'utf8'), authoredBefore);
    const aggregateSource = fs.readFileSync(metadataPath, 'utf8');
    assert.match(
      aggregateSource,
      /import \{ routeMeta as route\d+ \} from ['"]\.\/\[lang\]\/pricing\/route\.meta['"]/u,
    );
    assert.doesNotMatch(aggregateSource, /schema\.org/u);
    const { tsImport } = await import('tsx/esm/api');
    const imported = await tsImport(pathToFileURL(metadataPath).href, {
      parentURL: import.meta.url,
      tsconfig: false,
    });
    const aggregate =
      imported.ultramodernRouteMetadata ??
      imported.default?.ultramodernRouteMetadata;
    assert.equal(
      aggregate.find((route: { id: string }) => route.id === 'pricing').jsonLd[
        '@type'
      ],
      'WebPage',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('adding a vertical preserves authored route metadata and its synced aggregate', () => {
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
    const script = fileURLToPath(
      new URL(
        '../templates/workspace-scripts/generate-public-surface-assets.mjs',
        import.meta.url,
      ),
    );
    const sync = spawnSync(
      process.execPath,
      [script, '--app', 'shell-super-app', '--sync-route-metadata'],
      {
        env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: workspaceDir },
        encoding: 'utf8',
      },
    );
    assert.equal(sync.status, 0, sync.stderr);
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
