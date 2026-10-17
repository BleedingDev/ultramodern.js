import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const solidVersion = '2.0.0-rc.15';

/** Resolve through each real package owner, including pnpm's nested graph. */
export function installedPackage(ownerRoot, request) {
  const require = createRequire(path.join(ownerRoot, 'package.json'));
  let filename;
  try {
    filename = require.resolve(`${request}/package.json`);
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
    let directory = path.dirname(fs.realpathSync(require.resolve(request)));
    while (!fs.existsSync(path.join(directory, 'package.json'))) {
      const parent = path.dirname(directory);
      assert.notEqual(
        parent,
        directory,
        `Missing package owner for ${request}`,
      );
      directory = parent;
    }
    filename = path.join(directory, 'package.json');
  }
  filename = fs.realpathSync(filename);
  return {
    directory: path.dirname(filename),
    manifest: JSON.parse(fs.readFileSync(filename, 'utf8')),
  };
}

/** Expected router identities come from the accepted cohort, never a guessed alias. */
export function assertInstalledNavigationTuple({
  appRoot,
  renderer,
  expected,
  resolvePackage = installedPackage,
}) {
  assert(
    ['solid', 'octane'].includes(renderer),
    `Unknown renderer ${renderer}`,
  );
  for (const name of ['routerCore', 'history']) {
    assert.equal(
      typeof expected?.[name]?.name,
      'string',
      `Missing ${name} name`,
    );
    assert.equal(
      typeof expected[name].version,
      'string',
      `Missing ${name} version`,
    );
    assert(
      expected[name].name && expected[name].version,
      `Empty ${name} identity`,
    );
  }
  const check = (owner, request, identity) => {
    const item = resolvePackage(owner, request);
    assert.equal(
      item.manifest.name,
      identity.name,
      `${request} package identity`,
    );
    assert.equal(
      item.manifest.version,
      identity.version,
      `${request} package version`,
    );
    return item;
  };
  const adapter = resolvePackage(appRoot, `@modern-js/renderer-${renderer}`);
  const routerOwner =
    renderer === 'solid'
      ? adapter
      : resolvePackage(adapter.directory, '@octanejs/tanstack-router');
  const core = check(
    routerOwner.directory,
    '@tanstack/router-core',
    expected.routerCore,
  );
  const history = check(core.directory, '@tanstack/history', expected.history);
  const result = { routerCore: core.manifest, history: history.manifest };
  if (renderer === 'octane') return result;

  const native = {};
  for (const name of ['solid-js', '@solidjs/web', '@solidjs/signals']) {
    native[name] = check(adapter.directory, name, {
      name,
      version: solidVersion,
    });
  }
  native['@solidjs/compiler'] = check(appRoot, '@solidjs/compiler', {
    name: '@solidjs/compiler',
    version: solidVersion,
  });
  for (const name of ['solid-js', '@solidjs/signals']) {
    const fromWeb = check(native['@solidjs/web'].directory, name, {
      name,
      version: solidVersion,
    });
    assert.equal(
      fromWeb.directory,
      native[name].directory,
      `${name} must share the web runtime instance`,
    );
  }
  for (const name of ['seroval', 'seroval-plugins']) {
    const fromSolid = check(native['solid-js'].directory, name, {
      name,
      version: '1.6.7',
    });
    const fromWeb = check(native['@solidjs/web'].directory, name, {
      name,
      version: '1.6.7',
    });
    assert.equal(
      fromSolid.directory,
      fromWeb.directory,
      `${name} must share the native serializer instance`,
    );
  }
  return { ...result, solid: solidVersion, nativeSerializer: '1.6.7' };
}
