import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDeployOutputPublicAssetsPlugin } from '../../src/deploy-output/plugin';
import {
  NODE_PUBLIC_ASSET_SCOPE,
  normalizeDeclaredPublicAssets,
  resolveAddedDeclaredPublicAssetPaths,
  stageDeclaredPublicAssets,
} from '../../src/deploy-output/public-assets';

const roots: string[] = [];

const writeFiles = async (root: string, files: Record<string, string>) => {
  for (const [logicalPath, content] of Object.entries(files)) {
    const filePath = path.join(root, logicalPath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
};

const createApp = async (files: Record<string, string>) => {
  const appDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'deploy-public-assets-'),
  );
  roots.push(appDirectory);
  await writeFiles(appDirectory, files);
  return {
    appDirectory,
    outputDirectory: path.join(appDirectory, '.output'),
  };
};

const stage = async (
  appDirectory: string,
  outputDirectory: string,
  publicAssets: { from: string; to: string }[],
) =>
  stageDeclaredPublicAssets({
    appDirectory,
    outputDirectory,
    assets: normalizeDeclaredPublicAssets(
      publicAssets,
      NODE_PUBLIC_ASSET_SCOPE,
    ),
    scope: NODE_PUBLIC_ASSET_SCOPE,
  });

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => fs.rm(root, { force: true, recursive: true })),
  );
});

describe('declared deploy public assets', () => {
  it('stages directory trees and files beside generated public output', async () => {
    const { appDirectory, outputDirectory } = await createApp({
      'staging/decks/intro/index.html': '<!doctype html>intro',
      'staging/decks/intro/assets/app.js': 'app();',
      'staging/decks/intro/deck.pdf': '%PDF-1.7',
      'generated/sitemap.xml': '<urlset/>',
      '.output/public/robots.txt': 'User-agent: *',
    });
    const publicAssets = [
      { from: './staging/decks/', to: 'decks' },
      { from: 'generated/sitemap.xml', to: 'sitemap.xml' },
    ];

    await expect(
      stage(appDirectory, outputDirectory, publicAssets),
    ).resolves.toEqual([
      'public/decks/intro/assets/app.js',
      'public/decks/intro/deck.pdf',
      'public/decks/intro/index.html',
      'public/sitemap.xml',
    ]);
    await expect(
      fs.readFile(
        path.join(outputDirectory, 'public/decks/intro/assets/app.js'),
        'utf8',
      ),
    ).resolves.toBe('app();');
    await expect(
      fs.readFile(path.join(outputDirectory, 'public/robots.txt'), 'utf8'),
    ).resolves.toBe('User-agent: *');
    await expect(
      resolveAddedDeclaredPublicAssetPaths({
        appDirectory,
        assets: normalizeDeclaredPublicAssets(
          publicAssets,
          NODE_PUBLIC_ASSET_SCOPE,
        ),
        generatedRoot: path.join(appDirectory, 'dist'),
        scope: NODE_PUBLIC_ASSET_SCOPE,
      }),
    ).resolves.toEqual([
      'public/decks/intro/assets/app.js',
      'public/decks/intro/deck.pdf',
      'public/decks/intro/index.html',
      'public/sitemap.xml',
    ]);
  });

  it('stages a directory into the public root', async () => {
    const { appDirectory, outputDirectory } = await createApp({
      'surface/humans.txt': 'team',
      'surface/.well-known/security.txt': 'Contact: security@example.test',
    });

    await expect(
      stage(appDirectory, outputDirectory, [{ from: 'surface', to: '.' }]),
    ).resolves.toEqual([
      'public/.well-known/security.txt',
      'public/humans.txt',
    ]);
  });

  it('replaces generated public files without declaring them', async () => {
    const { appDirectory, outputDirectory } = await createApp({
      'surface/robots.txt': 'User-agent: *\nDisallow: /',
      'surface/humans.txt': 'team',
      'dist/public/robots.txt': 'User-agent: *\nAllow: /',
      '.output/public/robots.txt': 'User-agent: *\nAllow: /',
    });
    const publicAssets = [{ from: 'surface', to: '.' }];

    // A replaced generated file keeps its generated release classification.
    await expect(
      stage(appDirectory, outputDirectory, publicAssets),
    ).resolves.toEqual(['public/humans.txt']);
    await expect(
      fs.readFile(path.join(outputDirectory, 'public/robots.txt'), 'utf8'),
    ).resolves.toBe('User-agent: *\nDisallow: /');
    await expect(
      resolveAddedDeclaredPublicAssetPaths({
        appDirectory,
        assets: normalizeDeclaredPublicAssets(
          publicAssets,
          NODE_PUBLIC_ASSET_SCOPE,
        ),
        generatedRoot: path.join(appDirectory, 'dist'),
        scope: NODE_PUBLIC_ASSET_SCOPE,
      }),
    ).resolves.toEqual(['public/humans.txt']);
  });

  it('rejects ambiguous or unsafe declarations', async () => {
    const { appDirectory, outputDirectory } = await createApp({
      'one/deck/index.html': 'one',
      'two/index.html': 'two',
      'single.txt': 'single',
    });
    await fs.symlink(
      path.join(appDirectory, 'one'),
      path.join(appDirectory, 'linked'),
      'dir',
    );

    await expect(
      stage(appDirectory, outputDirectory, [{ from: 'missing', to: 'x' }]),
    ).rejects.toThrow(
      'deploy.node.publicAssets[0].from does not exist: missing',
    );
    await expect(
      stage(appDirectory, outputDirectory, [{ from: '../outside', to: 'x' }]),
    ).rejects.toThrow('deploy.node.publicAssets[0].from');
    await expect(
      stage(appDirectory, outputDirectory, [{ from: 'one', to: '../x' }]),
    ).rejects.toThrow('deploy.node.publicAssets[0].to');
    await expect(
      stage(appDirectory, outputDirectory, [{ from: 'linked', to: 'x' }]),
    ).rejects.toThrow(
      'deploy.node.publicAssets[0].from must not contain symbolic links: linked',
    );
    await expect(
      stage(appDirectory, outputDirectory, [
        { from: 'one', to: 'decks' },
        { from: 'two', to: 'decks/deck' },
      ]),
    ).rejects.toThrow(
      'deploy.node.publicAssets[1] and deploy.node.publicAssets[0] both stage "public/decks/deck/index.html".',
    );
    await expect(
      stage(appDirectory, outputDirectory, [{ from: 'single.txt', to: '.' }]),
    ).rejects.toThrow(
      'deploy.node.publicAssets[0].to must name a file when deploy.node.publicAssets[0].from is a file.',
    );
    await expect(fs.access(outputDirectory)).rejects.toThrow();
  });

  it('stages deploy.node.publicAssets after the Node deploy output', async () => {
    const { appDirectory, outputDirectory } = await createApp({
      'staging/deck/index.html': 'deck',
      '.output/index.js': 'server();',
    });
    const handlers: (() => Promise<void>)[] = [];
    createDeployOutputPublicAssetsPlugin().setup({
      getAppContext: () => ({ appDirectory, metaName: 'modern-js' }),
      getNormalizedConfig: () => ({
        deploy: {
          target: 'node',
          node: { publicAssets: [{ from: 'staging', to: 'decks' }] },
        },
      }),
      onAfterDeploy: handler => handlers.push(handler),
    });

    expect(handlers).toHaveLength(1);
    await handlers[0]!();
    await expect(
      fs.readFile(
        path.join(outputDirectory, 'public/decks/deck/index.html'),
        'utf8',
      ),
    ).resolves.toBe('deck');
  });

  it('leaves other deploy targets to their own presets', async () => {
    const { appDirectory, outputDirectory } = await createApp({
      'staging/deck/index.html': 'deck',
    });
    const handlers: (() => Promise<void>)[] = [];
    createDeployOutputPublicAssetsPlugin().setup({
      getAppContext: () => ({ appDirectory, metaName: 'modern-js' }),
      getNormalizedConfig: () => ({
        deploy: {
          target: 'cloudflare',
          node: { publicAssets: [{ from: 'staging', to: 'decks' }] },
        },
      }),
      onAfterDeploy: handler => handlers.push(handler),
    });

    await handlers[0]!();
    await expect(fs.access(outputDirectory)).rejects.toThrow();
  });
});
