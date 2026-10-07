import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  type RendererBuildIdentityOptions,
  rendererProfileKey,
  resolveRendererBuildIdentities,
} from '../src/renderer-build-identity';

const temporaryRoots = new Set<string>();
afterEach(async () => {
  for (const root of temporaryRoots)
    await fs.rm(root, { recursive: true, force: true });
  temporaryRoots.clear();
});

const solidProfile: RendererBuildIdentityOptions['profile'] = {
  renderer: 'solid',
  protocolVersion: 1,
  compiler: { name: '@solidjs/compiler', version: '2.0.0-rc.13' },
  hydration: { name: '@solidjs/web', version: '2.0.0-rc.13' },
  router: {
    name: '@tanstack/solid-router',
    version: '2.0.0-rc.8',
    coreName: '@tanstack/router-core',
    coreVersion: '1.171.22',
  },
  dependencies: { 'solid-js': '2.0.0-rc.13' },
};

function routerBindings(profile: RendererBuildIdentityOptions['profile']) {
  const provider = { framework: 'solid' as const, ...profile.router };
  return {
    main: {
      owner: '@fixture/solid-native-router',
      evidence: 'file-routes' as const,
      defaultProvider: { ...provider },
      providers: [{ ...provider }] satisfies [typeof provider],
    },
  };
}

async function fixture(
  options: { git?: boolean } = {},
): Promise<RendererBuildIdentityOptions> {
  const projectRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'renderer-build-identity-'),
  );
  temporaryRoots.add(projectRoot);
  await fs.writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({ name: '@demo/shop', version: '1.0.0' }),
  );
  await fs.writeFile(path.join(projectRoot, 'pnpm-lock.yaml'), 'lock: 1\n');
  await fs.writeFile(path.join(projectRoot, 'App.tsx'), 'export {};\n');
  if (options.git) {
    const run = (args: string[]) =>
      execFileSync('git', args, {
        cwd: projectRoot,
        stdio: 'ignore',
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => !name.startsWith('GIT_'),
          ),
        ),
      });
    run(['init']);
    run(['add', '.']);
    run([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'fixture',
    ]);
  }
  return {
    projectRoot,
    renderer: 'solid',
    profile: solidProfile,
    routerBindings: routerBindings(solidProfile),
    entryNames: ['main'],
    mode: 'production',
  };
}

test('one buildId per build feeds every entry identity', async () => {
  const options = await fixture();
  const resolved = resolveRendererBuildIdentities(options);
  expect(resolved.buildId).toMatch(/^[a-f0-9]{64}$/u);
  expect(resolved.profileKey).toBe(rendererProfileKey(solidProfile));
  expect(resolved.identities.main).toEqual({
    renderer: 'solid',
    appId: '@demo/shop',
    entryName: 'main',
    protocolVersion: 1,
    buildId: resolved.buildId,
  });
});

test('a clean checkout yields a reproducible buildId bound to its lockfile', async () => {
  const options = await fixture({ git: true });
  const first = resolveRendererBuildIdentities(options);
  expect(first.sourceRevision).toMatch(/^[a-f0-9]{40}$/u);
  expect(resolveRendererBuildIdentities(options).buildId).toBe(first.buildId);
  // Editing source makes the tree dirty; the buildId then becomes per-process.
  await fs.writeFile(path.join(options.projectRoot, 'App.tsx'), 'export {}\n');
  const dirty = resolveRendererBuildIdentities(options);
  expect(dirty.sourceRevision).toBe('workspace');
  expect(dirty.buildId).not.toBe(first.buildId);
});

test('the profile key changes with renderer, versions and protocol only', () => {
  const key = rendererProfileKey(solidProfile);
  expect(rendererProfileKey({ ...solidProfile })).toBe(key);
  expect(
    rendererProfileKey({
      ...solidProfile,
      dependencies: { 'solid-js': '2.0.0-rc.14' },
    }),
  ).not.toBe(key);
  expect(
    rendererProfileKey({
      ...solidProfile,
      compiler: { ...solidProfile.compiler, version: '2.0.0-rc.14' },
    }),
  ).not.toBe(key);
});

test('a renderer that disagrees with its profile is rejected', async () => {
  const options = await fixture();
  expect(() =>
    resolveRendererBuildIdentities({ ...options, renderer: 'octane' }),
  ).toThrow(/Renderer\/profile identity mismatch/u);
});
