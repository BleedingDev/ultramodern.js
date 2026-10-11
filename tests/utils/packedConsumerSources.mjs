import fs from 'node:fs';
import path from 'node:path';

function assertContained(root, target, label) {
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Packed ${label} escaped its consumer: ${target}`);
  }
  return target;
}

function directory(filesystem, root, target, entry) {
  const info = entry ?? filesystem.lstatSync(target);
  if (info.isDirectory()) return target;
  if (info.isSymbolicLink()) {
    const resolved = assertContained(
      root,
      filesystem.realpathSync(target),
      'package directory',
    );
    if (filesystem.statSync(resolved).isDirectory()) return resolved;
  }
  throw new Error(`Expected a packed consumer directory: ${target}`);
}

/** Enumerate the virtual store once, then strip only the exact packed names.
 * Collect and validate every candidate before changing the disposable consumer. */
export function stripPackedFrameworkSources(
  consumer,
  packageNames,
  { filesystem = fs } = {},
) {
  const names = new Set(packageNames);
  const scopes = new Set();
  for (const name of names) {
    if (
      typeof name !== 'string' ||
      !/^(?:@[a-z\d][a-z\d._~-]*\/)?[a-z\d][a-z\d._~-]*$/iu.test(name)
    ) {
      throw new Error(`Invalid packed framework package name: ${name}`);
    }
    if (name.startsWith('@')) scopes.add(name.split('/')[0]);
  }

  const root = filesystem.realpathSync(consumer);
  const nodeModules = directory(
    filesystem,
    root,
    path.join(root, 'node_modules'),
  );
  const store = directory(filesystem, root, path.join(nodeModules, '.pnpm'));
  const packages = new Map();
  const read = target =>
    filesystem.readdirSync(target, { withFileTypes: true });

  function collect(name, parent, entry) {
    if (!names.has(name)) return;
    const packageDir = assertContained(
      root,
      filesystem.realpathSync(path.join(parent, entry.name)),
      `package ${name}`,
    );
    if (packages.has(packageDir)) {
      packages.get(packageDir).names.add(name);
      return;
    }
    // npm aliases keep their target's manifest name. Selection must use the
    // installed logical name, exactly as the packed-consumer contract does.
    assertContained(
      root,
      filesystem.realpathSync(path.join(packageDir, 'package.json')),
      `package manifest ${name}`,
    );
    const source = path.join(packageDir, 'src');
    const sourceInfo = filesystem.lstatSync(source, { throwIfNoEntry: false });
    if (sourceInfo?.isSymbolicLink()) {
      assertContained(
        root,
        filesystem.realpathSync(source),
        `package source ${name}`,
      );
    }
    packages.set(packageDir, {
      names: new Set([name]),
      packageDir,
      source,
      hasSource: !!sourceInfo,
    });
  }

  for (const entry of read(store)) {
    // pnpm's shared dependency links and lockfile are not package store entries.
    if (
      entry.name === 'node_modules' ||
      (!entry.isDirectory() && !entry.isSymbolicLink())
    ) {
      continue;
    }
    const storeEntry = directory(
      filesystem,
      root,
      path.join(store, entry.name),
      entry,
    );
    const dependencies = directory(
      filesystem,
      root,
      path.join(storeEntry, 'node_modules'),
    );
    for (const dependency of read(dependencies)) {
      if (scopes.has(dependency.name)) {
        const scope = directory(
          filesystem,
          root,
          path.join(dependencies, dependency.name),
          dependency,
        );
        for (const scoped of read(scope)) {
          collect(`${dependency.name}/${scoped.name}`, scope, scoped);
        }
      } else {
        collect(dependency.name, dependencies, dependency);
      }
    }
  }

  const installed = [...packages.values()];
  for (const { source, hasSource } of installed) {
    if (hasSource) filesystem.rmSync(source, { recursive: true, force: true });
  }
  return {
    root,
    packages: installed
      .flatMap(({ names: logicalNames, packageDir }) =>
        [...logicalNames].map(name => ({ name, packageDir })),
      )
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          a.packageDir.localeCompare(b.packageDir),
      ),
  };
}
