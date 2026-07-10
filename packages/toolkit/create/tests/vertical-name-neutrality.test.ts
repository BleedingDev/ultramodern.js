import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

/**
 * Regression net for the deleted demo-topology lanes. The generator used to
 * special-case verticals whose ids matched the demo trio
 * ('workspace'/'records'/'actions'): a vertical named 'records' received a
 * vertical-components.tsx importing federation packages that do not exist
 * (hard build failure), 'actions' received an orphan action-queue-store.ts,
 * and all three received phantom demo route tables and locale copy. Every
 * vertical must now go through the single generic path regardless of name.
 */
test('verticals named after the old demo trio scaffold exactly like any other vertical', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-name-neutral-'));
  const workspaceDir = path.join(tempRoot, 'neutral-workspace');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'neutral-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: {
        strategy: 'workspace',
      },
    });

    for (const name of ['records', 'actions', 'workspace']) {
      addUltramodernVertical({
        workspaceRoot: workspaceDir,
        name,
        modernVersion: '3.2.1',
      });
    }

    const exists = (relativePath: string) =>
      fs.existsSync(path.join(workspaceDir, relativePath));
    const read = (relativePath: string) =>
      fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');

    // The 'records' landmine: a components file importing
    // @scope/workspace/Highlights and @scope/actions/StartAction — packages
    // that are not dependencies — must not be generated.
    assert.equal(
      exists('verticals/records/src/components/vertical-components.tsx'),
      false,
    );
    // The 'actions' orphan store nothing imports must not be generated.
    assert.equal(exists('verticals/actions/src/action-queue-store.ts'), false);

    for (const name of ['records', 'actions', 'workspace']) {
      const federationEntry = read(
        `verticals/${name}/src/federation-entry.tsx`,
      );
      assert.match(
        federationEntry,
        /export default function \w+Route\(\)/,
        `${name} federation entry must be the generic route component`,
      );
      assert.doesNotMatch(
        federationEntry,
        /\.\/components\/(record-page|action-queue)/,
        `${name} federation entry must not re-export demo components`,
      );

      // No phantom demo routes: each fresh vertical owns exactly its home
      // route.
      const routeMetadata = read(
        `verticals/${name}/src/routes/ultramodern-route-metadata.ts`,
      );
      assert.ok(
        routeMetadata.includes(`id: '${name}-home'`),
        `${name} must own its home route`,
      );
      for (const phantom of [
        '/workspaces',
        '/records/:slug',
        '/actions/review',
        '/unavailable',
      ]) {
        assert.ok(
          !routeMetadata.includes(`canonicalPath: '${phantom}'`),
          `${name} must not own the phantom demo route ${phantom}`,
        );
      }

      // No demo locale copy: the generated namespace resource is the generic
      // fallback shape, without record/queue demo trees.
      const localeResource = JSON.parse(
        read(`verticals/${name}/locales/en/${name}.json`),
      )[name];
      assert.equal(localeResource.record, undefined);
      assert.equal(localeResource.queue, undefined);
      assert.equal(localeResource.highlights, undefined);
      assert.equal(typeof localeResource.title, 'string');
      assert.equal(typeof localeResource.routeSurface, 'string');
    }

    const ultramodernConfig = JSON.parse(read('.modernjs/ultramodern.json'));
    for (const name of ['records', 'actions', 'workspace']) {
      const appConfig = ultramodernConfig.topology.apps.find(
        (app: { id: string }) => app.id === name,
      );
      assert.ok(appConfig, `${name} must be in the compact topology metadata`);
      assert.equal(appConfig.path, `verticals/${name}`);
      assert.equal(appConfig.api.prefix, `/${name}-api`);

      const sharedApi = read(`verticals/${name}/shared/api.ts`);
      assert.match(
        sharedApi,
        new RegExp(`HttpApiEndpoint\\.get\\('list', '/${name}'`),
        `${name} must use the generic list endpoint`,
      );
      assert.match(
        sharedApi,
        new RegExp(`HttpApiEndpoint\\.get\\('get', '/${name}/:id'`),
        `${name} must use the generic detail endpoint`,
      );
      assert.match(
        sharedApi,
        new RegExp(`HttpApiEndpoint\\.post\\('create', '/${name}'`),
        `${name} must use the generic create endpoint`,
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
