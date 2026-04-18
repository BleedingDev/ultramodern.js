/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../../..');
const repoRoot = path.resolve(__dirname, '../../../..');

const readFixture = (relativePath: string) =>
  fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

const readFixtureJson = (relativePath: string) =>
  JSON.parse(readFixture(relativePath));

describe('tanstack create-routes contracts', () => {
  test('publishes the tanstack router subpath export', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, 'packages/runtime/plugin-runtime/package.json'),
        'utf8',
      ),
    );

    expect(packageJson.exports['./tanstack-router']).toEqual(
      expect.objectContaining({
        types: './dist/types/exports/tanstack-router.d.ts',
        default: './dist/esm/exports/tanstack-router.mjs',
      }),
    );
    expect(packageJson.typesVersions['*']['tanstack-router']).toEqual([
      './dist/types/exports/tanstack-router.d.ts',
    ]);
  });

  test('generated register file augments tanstack router register interface', () => {
    const code = readFixture(
      'integration/routes-tanstack-create-routes/src/modern-tanstack/register.gen.d.ts',
    );

    expect(code).toContain(
      "import type { router as router0 } from './index/router.gen';",
    );
    expect(code).toContain(
      "declare module '@modern-js/runtime/tanstack-router'",
    );
    expect(code).toContain('interface Register');
    expect(code).toContain('router: typeof router0;');
  });

  test('generated route manifest preserves SPA/SSR hybrid route semantics', () => {
    const routeManifest = readFixtureJson(
      'integration/routes-tanstack-create-routes/dist/route.json',
    );

    expect(Array.isArray(routeManifest.routes)).toBe(true);
    expect(routeManifest.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          urlPath: '/',
          entryName: 'index',
          entryPath: 'html/index/index.html',
          isSPA: true,
          isSSR: true,
          isStream: false,
          isRSC: false,
          bundle: 'bundles/index.js',
        }),
      ]),
    );
  });
});
