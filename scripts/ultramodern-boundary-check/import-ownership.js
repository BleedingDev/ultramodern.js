const fs = require('node:fs');
const path = require('node:path');
const { buildProvenanceOwnership, parseNameStatus } = require('./divergence');
const { parseWorkspacePatterns } = require('./workspace-patterns');

const packageName = specifier =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
const sourceExtensions = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.d.ts',
];
const inDirectory = (file, directory) => file.startsWith(`${directory}/`);

// Resolve against the measured Git tree, never installed node_modules or the
// runner's resolver. Committed verification must not read worktree metadata.
const createImportOwnership = ({
  rootDir,
  baseRef,
  upstreamRef,
  headRef,
  runGit,
}) => {
  const list = args =>
    runGit({ rootDir, args }).stdout.split('\0').filter(Boolean);
  const modes = new Map();
  const files = new Set(
    headRef
      ? list(['ls-tree', '-r', '-z', headRef]).map(record => {
          const [metadata, file] = record.split('\t');
          modes.set(file, metadata.split(' ')[0]);
          return file;
        })
      : list([
          'ls-files',
          '--cached',
          '--others',
          '--exclude-standard',
          '-z',
        ]).filter(file => fs.existsSync(path.join(rootDir, file))),
  );
  const assertOrdinary = file => {
    if (
      headRef
        ? !['100644', '100755'].includes(modes.get(file))
        : fs.realpathSync(path.join(rootDir, file)) !==
          path.join(fs.realpathSync(rootDir), file)
    ) {
      throw new Error(
        `Import ownership requires ordinary source and metadata files without symlinks: ${file}`,
      );
    }
  };
  const cache = new Map();
  const read = file => {
    if (!files.has(file)) return null;
    if (!cache.has(file)) {
      assertOrdinary(file);
      cache.set(
        file,
        headRef
          ? runGit({ rootDir, args: ['show', `${headRef}:${file}`] }).stdout
          : fs.readFileSync(path.join(rootDir, file), 'utf8'),
      );
    }
    return cache.get(file);
  };
  const { ownership } = buildProvenanceOwnership({
    rootDir,
    auditedBaseRef: baseRef,
    upstreamRef,
    pathspec: ['packages'],
  });
  const projectRenames = (from, to) => {
    const args = ['diff', '--name-status', '-z', '-M', from];
    if (to) args.push(to);
    args.push('--', 'packages');
    for (const { status, oldPath, newPath } of parseNameStatus(
      runGit({ rootDir, args }).stdout,
    )) {
      if (status.startsWith('R') && ownership.has(oldPath)) {
        ownership.set(newPath, ownership.get(oldPath));
      }
    }
  };
  // A file can be rewritten before it is renamed, leaving no similarity in
  // the aggregate diff. Preserve each observed rename on the target history.
  const history = runGit({
    rootDir,
    args: [
      'log',
      '--format=',
      '--name-status',
      '-z',
      '-M',
      '--diff-filter=R',
      '--reverse',
      '--first-parent',
      '--diff-merges=first-parent',
      `${upstreamRef}..${headRef ?? 'HEAD'}`,
      '--',
      'packages',
    ],
  }).stdout;
  for (const { status, oldPath, newPath } of parseNameStatus(history)) {
    if (status.startsWith('R') && ownership.has(oldPath))
      ownership.set(newPath, ownership.get(oldPath));
  }
  projectRenames(upstreamRef, headRef ?? 'HEAD');
  if (!headRef) projectRenames('HEAD');

  const manifests = [];
  const packages = new Map();
  const manifestFiles = [...files].filter(
    file => file.startsWith('packages/') && file.endsWith('/package.json'),
  );
  const workspaceText = read('pnpm-workspace.yaml');
  const workspacePatterns =
    workspaceText === null ? null : parseWorkspacePatterns(workspaceText);
  for (const file of files) {
    if (!manifestFiles.includes(file)) continue;
    // Nested manifests belong to fixture/application data, not the workspace
    // package registry. Their source remains in the enclosing package scope.
    if (
      workspacePatterns
        ? !workspacePatterns.some(
            pattern =>
              !pattern.startsWith('!') &&
              path.matchesGlob(path.posix.dirname(file), pattern),
          ) ||
          workspacePatterns.some(
            pattern =>
              pattern.startsWith('!') &&
              path.matchesGlob(path.posix.dirname(file), pattern.slice(1)),
          )
        : manifestFiles.some(
            parent =>
              parent !== file && inDirectory(file, path.posix.dirname(parent)),
          )
    )
      continue;
    const manifest = JSON.parse(read(file));
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      throw new Error(`Package ownership requires a named manifest: ${file}`);
    }
    const record = {
      file,
      root: path.posix.dirname(file),
      manifest,
      upstream: ownership.has(file),
    };
    if (packages.has(manifest.name))
      throw new Error(`Ambiguous workspace package identity: ${manifest.name}`);
    packages.set(manifest.name, record);
    manifests.push(record);
  }
  manifests.sort((left, right) => right.root.length - left.root.length);
  const packageForFile = file =>
    manifests.find(record => inDirectory(file, record.root));
  const resolveFile = value => {
    const normalized = path.posix.normalize(value);
    if (normalized.startsWith('../') || path.posix.isAbsolute(normalized))
      return null;
    const candidates = [normalized];
    // TS and ESM sources commonly import the output extension.
    if (/\.(?:js|mjs|cjs)$/.test(normalized)) {
      const stem = normalized.replace(/\.(?:js|mjs|cjs)$/, '');
      candidates.push(...sourceExtensions.map(extension => stem + extension));
    }
    candidates.push(
      ...sourceExtensions.map(extension => normalized + extension),
    );
    candidates.push(
      ...sourceExtensions.map(extension => `${normalized}/index${extension}`),
    );
    const resolved = candidates.find(candidate => files.has(candidate)) ?? null;
    if (resolved) assertOrdinary(resolved);
    return resolved;
  };
  const classify = (target, record) => ({
    target,
    package: record?.manifest.name ?? null,
    // New native helper files inherit their existing package owner. Absence
    // from the source audit alone does not prove a helper is fork policy;
    // source divergence and additive-subsystem review enforce that distinction.
    // An upstream identity moved into a fork package retains its native owner.
    forkOwned: !ownership.has(target) && !record?.upstream,
    marker: record?.manifest.name ?? 'fork-owned-source',
  });
  const sourceTargets = value => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(sourceTargets);
    if (!value || typeof value !== 'object') return [];
    if (Object.hasOwn(value, 'modern:source'))
      return sourceTargets(value['modern:source']);
    return Object.values(value).flatMap(sourceTargets);
  };
  const resolvePackage = (specifier, importer, seen = new Set()) => {
    const name = packageName(specifier);
    if (seen.has(name)) throw new Error(`Cyclic package alias: ${specifier}`);
    seen.add(name);
    const importerPackage = packageForFile(importer);
    const ranges = {
      ...importerPackage?.manifest.devDependencies,
      ...importerPackage?.manifest.peerDependencies,
      ...importerPackage?.manifest.optionalDependencies,
      ...importerPackage?.manifest.dependencies,
    };
    const range = ranges[name];
    const subpath = specifier.slice(name.length);
    let record = packages.get(name);
    if (typeof range === 'string') {
      const alias = /^(?:npm:|workspace:)((?:@[^/]+\/)?[^@/*~^<>=]+)@/.exec(
        range,
      );
      if (alias) return resolvePackage(alias[1] + subpath, importer, seen);
      if (/^(?:file:|link:|workspace:\.)/.test(range)) {
        const directory = path.posix.normalize(
          path.posix.join(
            importerPackage.root,
            range.slice(range.indexOf(':') + 1),
          ),
        );
        record = manifests.find(candidate => candidate.root === directory);
        if (!record)
          throw new Error(
            `Unresolved local package alias: ${specifier} in ${importer}`,
          );
      }
    }
    if (!record) {
      if (typeof range === 'string' && range.startsWith('workspace:'))
        throw new Error(
          `Unresolved workspace package: ${specifier} in ${importer}`,
        );
      return null;
    }
    const key = subpath ? `.${subpath}` : '.';
    const exports = record.manifest.exports;
    let targets;
    if (
      exports &&
      typeof exports === 'object' &&
      !Array.isArray(exports) &&
      Object.keys(exports).some(key => key.startsWith('.'))
    ) {
      targets = sourceTargets(exports[key]);
      if (targets.length === 0) {
        const wildcard = Object.keys(exports)
          .filter(candidate => candidate.includes('*'))
          .sort((left, right) => right.length - left.length)
          .find(
            candidate =>
              key.startsWith(candidate.split('*')[0]) &&
              key.endsWith(candidate.split('*')[1]),
          );
        if (wildcard) {
          const [before, after] = wildcard.split('*');
          const replacement = key.slice(
            before.length,
            key.length - after.length || undefined,
          );
          targets = sourceTargets(exports[wildcard]).map(target =>
            target.replaceAll('*', replacement),
          );
        }
      }
    } else {
      targets = subpath
        ? []
        : sourceTargets(
            record.manifest['modern:source'] ?? exports ?? record.manifest.main,
          );
    }
    // Published dist paths map back to their source identities. An explicit
    // source export takes precedence over a conventional src/subpath fallback.
    const candidates = (targets ?? []).flatMap(target => [
      target,
      target
        .replace(/^\.\/dist\/(?:cjs|esm|esm-node|types)\//, './src/')
        .replace(/\.d\.ts$/, '.ts'),
    ]);
    if (candidates.length === 0)
      candidates.push(
        subpath ? `./${subpath.slice(1)}` : './src/index',
        subpath ? `./src/${subpath.slice(1)}` : './src/index',
      );
    const resolved = [
      ...new Set(
        candidates
          .map(target => resolveFile(path.posix.join(record.root, target)))
          .filter(Boolean),
      ),
    ];
    if (resolved.length === 0) {
      // Package ownership still governs invalid or private deep imports.
      return [classify(record.file, record)];
    }
    return resolved.map(target => classify(target, record));
  };
  const configs = new Map();
  const parseConfig = file => {
    if (configs.has(file)) return configs.get(file);
    const content = read(file);
    if (content === null) return null;
    const { parseSync } = require('@babel/core');
    const ast = parseSync(`const config = ${content}`, {
      babelrc: false,
      configFile: false,
    });
    const value = node => {
      if (
        ['StringLiteral', 'BooleanLiteral', 'NumericLiteral'].includes(
          node.type,
        )
      )
        return node.value;
      if (node.type === 'NullLiteral') return null;
      if (node.type === 'ArrayExpression') return node.elements.map(value);
      if (
        node.type !== 'ObjectExpression' ||
        node.properties.some(
          property => property.type !== 'ObjectProperty' || property.computed,
        )
      ) {
        throw new Error(`Unsupported TypeScript configuration shape: ${file}`);
      }
      return Object.fromEntries(
        node.properties.map(property => [
          property.key.name ?? property.key.value,
          value(property.value),
        ]),
      );
    };
    const config = value(ast.program.body[0].declarations[0].init);
    configs.set(file, config);
    return config;
  };
  const pathsFor = (file, seen = new Set()) => {
    if (seen.has(file))
      throw new Error(`Cyclic TypeScript config inheritance: ${file}`);
    seen.add(file);
    const config = parseConfig(file);
    if (!config)
      throw new Error(`Unresolved TypeScript configuration: ${file}`);
    let inherited = {};
    for (const parent of Array.isArray(config.extends)
      ? config.extends
      : config.extends
        ? [config.extends]
        : []) {
      let target;
      if (!parent.startsWith('.')) {
        const resolved = resolvePackage(parent, file);
        target = resolved?.find(
          record =>
            record.target.endsWith('.json') &&
            !record.target.endsWith('/package.json'),
        )?.target;
        // External configuration is outside the measured workspace tree.
        if (!target) continue;
      } else {
        target = path.posix.normalize(
          path.posix.join(path.posix.dirname(file), parent),
        );
        if (!files.has(target)) target += '.json';
      }
      inherited = { ...inherited, ...pathsFor(target, new Set(seen)) };
    }
    const options = config.compilerOptions ?? {};
    // TS inherits baseUrl and paths independently. Keep the directory of the
    // paths declaration for the no-baseUrl case; any effective inherited or
    // overridden baseUrl applies to the final paths, wherever they were declared.
    if (Object.hasOwn(options, 'baseUrl')) {
      if (typeof options.baseUrl !== 'string')
        throw new Error(`Malformed TypeScript baseUrl: ${file}`);
      inherited.baseUrl = path.posix.join(
        path.posix.dirname(file),
        options.baseUrl,
      );
    }
    if (Object.hasOwn(options, 'paths')) {
      if (
        !options.paths ||
        typeof options.paths !== 'object' ||
        Array.isArray(options.paths)
      )
        throw new Error(`Malformed TypeScript paths: ${file}`);
      inherited.paths = options.paths;
      inherited.pathsDirectory = path.posix.dirname(file);
    }
    return inherited;
  };
  const aliases = new Map();
  const pathsForImporter = importer => {
    let directory = path.posix.dirname(importer);
    while (true) {
      const file = `${directory === '.' ? '' : `${directory}/`}tsconfig.json`;
      if (files.has(file)) {
        if (!aliases.has(file)) {
          const options = pathsFor(file);
          aliases.set(file, {
            baseUrl: options.baseUrl,
            entries: Object.entries(options.paths ?? {}).map(
              ([pattern, targets]) => ({
                pattern,
                targets,
                directory: options.baseUrl ?? options.pathsDirectory,
              }),
            ),
          });
        }
        return aliases.get(file);
      }
      if (directory === '.') return { entries: [] };
      directory = path.posix.dirname(directory);
    }
  };
  const resolve = (specifier, importer, seenImports = new Set()) => {
    if (specifier.startsWith('.')) {
      const target = resolveFile(
        path.posix.join(path.posix.dirname(importer), specifier),
      );
      return target ? [classify(target, packageForFile(target))] : [];
    }
    const config = pathsForImporter(importer);
    for (const { pattern, targets, directory } of config.entries.sort(
      (left, right) =>
        Number(left.pattern.includes('*')) -
          Number(right.pattern.includes('*')) ||
        right.pattern.split('*')[0].length - left.pattern.split('*')[0].length,
    )) {
      const [before, after = ''] = pattern.split('*');
      if (
        pattern.includes('*')
          ? !specifier.startsWith(before) || !specifier.endsWith(after)
          : specifier !== pattern
      )
        continue;
      if (
        !Array.isArray(targets) ||
        targets.some(target => typeof target !== 'string')
      )
        throw new Error(`Malformed TypeScript path alias in ${importer}`);
      const replacement = specifier.slice(
        before.length,
        specifier.length - after.length || undefined,
      );
      for (const target of targets) {
        const resolved = resolveFile(
          path.posix.join(directory, target.replaceAll('*', replacement)),
        );
        if (resolved) return [classify(resolved, packageForFile(resolved))];
      }
      throw new Error(
        `Unresolved TypeScript path alias: ${specifier} in ${importer}`,
      );
    }
    if (config.baseUrl !== undefined) {
      const target = resolveFile(path.posix.join(config.baseUrl, specifier));
      if (target) return [classify(target, packageForFile(target))];
    }
    if (specifier.startsWith('#')) {
      const record = packageForFile(importer);
      const key = `${record?.root}\0${specifier}`;
      if (seenImports.has(key))
        throw new Error(
          `Cyclic package imports alias: ${specifier} in ${importer}`,
        );
      seenImports.add(key);
      const imports = record?.manifest.imports;
      if (!imports || typeof imports !== 'object' || Array.isArray(imports))
        throw new Error(
          `Unresolved package imports alias: ${specifier} in ${importer}`,
        );
      let mapping = imports[specifier];
      if (mapping === undefined) {
        const pattern = Object.keys(imports)
          .filter(pattern => pattern.includes('*'))
          .sort(
            (left, right) =>
              right.split('*')[0].length - left.split('*')[0].length ||
              right.length - left.length,
          )
          .find(
            pattern =>
              specifier.startsWith(pattern.split('*')[0]) &&
              specifier.endsWith(pattern.split('*')[1]),
          );
        if (pattern) {
          const [before, after] = pattern.split('*');
          const replacement = specifier.slice(
            before.length,
            specifier.length - after.length || undefined,
          );
          mapping = sourceTargets(imports[pattern]).map(target =>
            target.replaceAll('*', replacement),
          );
        }
      }
      const targets = sourceTargets(mapping);
      if (targets.length === 0)
        throw new Error(
          `Unresolved package imports alias: ${specifier} in ${importer}`,
        );
      return targets.flatMap(target => {
        if (target.startsWith('./')) {
          const file = resolveFile(path.posix.join(record.root, target));
          if (!file)
            throw new Error(
              `Unresolved local package imports target: ${target} in ${importer}`,
            );
          return [classify(file, packageForFile(file))];
        }
        if (target.startsWith('#'))
          return resolve(target, importer, new Set(seenImports));
        if (target.startsWith('.') || path.posix.isAbsolute(target))
          throw new Error(`Malformed package imports target: ${target}`);
        return resolvePackage(target, importer) ?? [];
      });
    }
    return resolvePackage(specifier, importer) ?? [];
  };
  return { files, read, ownership, packageForFile, resolve };
};

module.exports = { createImportOwnership, packageName };
