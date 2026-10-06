// Native i18n must not pull React into a Solid or Octane application.
//
//   node --test tests/ultramodern-renderers/i18n/closure.test.mjs
//
// Walks the built `./i18n` import graph of both native renderers under every
// published condition set, and the install closure an i18n-enabled native app
// gets (renderer + its i18n peer + i18next), following dependencies and
// required peers. Optional peers that the app does not install are reported,
// never followed. Requires built dist output of the packages involved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const forbidden =
  /^(?:react|react-dom|react-helmet-async|react-i18next|@modern-js\/runtime|@modern-js\/plugin-i18n|@modern-js\/i18n-integration)$/u;

const packageName = specifier =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];

function packageDirectory(name, fromDirectory) {
  let current = fs.realpathSync(fromDirectory);
  while (true) {
    const candidate = path.join(current, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json')))
      return fs.realpathSync(candidate);
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

const manifest = directory =>
  JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));

function pickExport(target, conditions) {
  if (typeof target === 'string') return target;
  if (!target || typeof target !== 'object') return undefined;
  for (const [key, value] of Object.entries(target)) {
    if (key === 'default' || conditions.includes(key)) {
      const picked = pickExport(value, conditions);
      if (picked) return picked;
    }
  }
  return undefined;
}

function resolveBare(specifier, fromFile, conditions) {
  const name = packageName(specifier);
  const directory = packageDirectory(name, path.dirname(fromFile));
  if (!directory) return { name, file: undefined };
  const pkg = manifest(directory);
  const subpath = `.${specifier.slice(name.length)}`;
  let target;
  if (pkg.exports) {
    const entry =
      typeof pkg.exports === 'string' || subpath !== '.'
        ? pkg.exports[subpath]
        : (pkg.exports['.'] ?? pkg.exports);
    target = pickExport(
      subpath === '.' && typeof pkg.exports === 'string' ? pkg.exports : entry,
      conditions,
    );
  } else {
    target = subpath === '.' ? (pkg.module ?? pkg.main ?? 'index.js') : subpath;
  }
  return {
    name,
    file: target ? path.join(directory, target) : undefined,
  };
}

const importPattern =
  /(?:^|[;\s}])(?:import|export)\s*(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/gu;

/** Every module and bare package reached from `entry` under `conditions`. */
function walkImports(entry, conditions) {
  const seen = new Set();
  const packages = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier.startsWith('node:')) continue;
      if (specifier.startsWith('.')) {
        queue.push(path.resolve(path.dirname(file), specifier));
        continue;
      }
      const { name, file: resolved } = resolveBare(specifier, file, conditions);
      packages.add(name);
      assert.ok(
        !forbidden.test(name),
        `${path.relative(root, file)} imports ${specifier}`,
      );
      // Walk the fork's own packages; third-party leaves are checked by name.
      if (resolved && name.startsWith('@modern-js/')) queue.push(resolved);
    }
  }
  return { modules: seen.size, packages: [...packages].sort() };
}

const builds = {
  solid: {
    directory: path.join(root, 'packages/runtime/renderer-solid'),
    conditionSets: [
      ['node', 'import'],
      ['browser', 'import'],
    ],
  },
  octane: {
    directory: path.join(root, 'packages/runtime/renderer-octane'),
    conditionSets: [
      ['node', 'import'],
      ['browser', 'import'],
      ['node', 'require'],
    ],
  },
};

for (const [renderer, build] of Object.entries(builds)) {
  test(`${renderer}/i18n import graph is React-free`, () => {
    const pkg = manifest(build.directory);
    for (const conditions of build.conditionSets) {
      const entry = path.join(
        build.directory,
        pickExport(pkg.exports['./i18n'], conditions),
      );
      assert.ok(fs.existsSync(entry), `built ${entry}`);
      const graph = walkImports(entry, conditions);
      assert.ok(
        graph.packages.includes('@modern-js/i18n-runtime-extensions'),
        'the walk follows the renderer-neutral i18n package',
      );
      console.log(
        `${renderer}/i18n [${conditions.join(',')}]: ${graph.modules} modules, packages ${graph.packages.join(' ')}`,
      );
    }
  });

  test(`${renderer} i18n install closure is React-free`, () => {
    const pkg = manifest(build.directory);
    assert.equal(
      pkg.dependencies['@modern-js/i18n-runtime-extensions'],
      undefined,
      'i18n is not a hard dependency',
    );
    assert.equal(
      pkg.peerDependenciesMeta['@modern-js/i18n-runtime-extensions']?.optional,
      true,
      'i18n is an optional peer',
    );
    // What an i18n-enabled native app installs next to the renderer.
    const roots = [
      build.directory,
      packageDirectory('@modern-js/i18n-runtime-extensions', build.directory),
      packageDirectory(
        'i18next',
        path.join(root, 'packages/runtime/plugin-i18n'),
      ),
    ];
    const visited = new Map();
    const absentOptional = new Set();
    const queue = roots.map(directory => ({ directory, via: 'app' }));
    while (queue.length) {
      const { directory, via } = queue.shift();
      assert.ok(directory, `resolved package via ${via}`);
      if (visited.has(directory)) continue;
      const current = manifest(directory);
      visited.set(directory, current.name);
      assert.ok(
        !forbidden.test(current.name),
        `${current.name} reached via ${via}`,
      );
      const optional = current.peerDependenciesMeta ?? {};
      const required = {
        ...current.dependencies,
        ...Object.fromEntries(
          Object.entries(current.peerDependencies ?? {}).filter(
            ([name]) => !optional[name]?.optional,
          ),
        ),
      };
      for (const name of Object.keys(optional))
        if (optional[name]?.optional && current.peerDependencies?.[name])
          absentOptional.add(`${name} (optional peer of ${current.name})`);
      for (const name of Object.keys(required)) {
        assert.ok(!forbidden.test(name), `${current.name} requires ${name}`);
        queue.push({
          directory: packageDirectory(name, directory),
          via: current.name,
        });
      }
    }
    const reactOptional = [...absentOptional].filter(entry =>
      forbidden.test(entry.split(' ')[0]),
    );
    console.log(
      `${renderer} closure: ${visited.size} packages, React-family only as absent optional peers: ${reactOptional.join(', ') || 'none'}`,
    );
  });
}
