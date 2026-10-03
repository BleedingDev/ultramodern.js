const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const babel = require('@babel/core');
const compiler = require('@solidjs/compiler');

const markerPrefix = '__SOLID_LAZY_MODULE__:';
const extensions = ['.tsx', '.ts', '.jsx', '.js'];

function resolveLazyModule(
  filename,
  specifier,
  projectRoot,
  sourceExtensions = extensions,
  dependencies,
) {
  const split = specifier.search(/[?#]/);
  const pathname = split < 0 ? specifier : specifier.slice(0, split);
  const suffix = split < 0 ? '' : specifier.slice(split);
  if (!pathname.startsWith('.') && !path.isAbsolute(pathname)) {
    throw new Error(
      `Solid lazy import ${specifier} in ${filename} must name a static relative or absolute application module`,
    );
  }
  const requested = path.resolve(path.dirname(filename), pathname);
  const requestedRelative = path.relative(projectRoot, requested);
  if (
    requestedRelative === '..' ||
    requestedRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(requestedRelative)
  ) {
    throw new Error(
      `Solid lazy module ${requested} must belong to the application source tree`,
    );
  }
  const candidates = [
    requested,
    ...sourceExtensions.map(extension => requested + extension),
    ...sourceExtensions.map(extension =>
      path.join(requested, `index${extension}`),
    ),
  ];
  const resolved = candidates.find(
    candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
  if (!resolved) {
    for (const candidate of candidates) dependencies?.missing.add(candidate);
    throw new Error(
      `Cannot resolve Solid lazy module ${specifier} from ${filename}`,
    );
  }
  dependencies?.files.add(resolved);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(
      `Solid lazy module ${resolved} must belong to the application source tree`,
    );
  }
  return {
    filename: resolved,
    request: resolved + suffix,
    key: relative.split(path.sep).join('/') + suffix,
  };
}

function markerVisitor(onMarker) {
  return {
    StringLiteral(marker) {
      if (
        marker.key === 2 &&
        marker.listKey === 'arguments' &&
        marker.parentPath.isCallExpression() &&
        marker.node.value.startsWith(markerPrefix)
      ) {
        onMarker(marker, marker.node.value.slice(markerPrefix.length));
      }
    },
  };
}

function collectLazyModules(
  projectRoot,
  entryDirectories = [],
  sourceExtensions = extensions,
  dependencies,
) {
  const root = path.join(projectRoot, 'src');
  const found = new Map();
  const visited = new Set();
  const walk = directory => {
    dependencies?.contexts.add(directory);
    if (!fs.existsSync(directory) || visited.has(directory)) return;
    visited.add(directory);
    for (const item of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, item.name);
      if (item.isDirectory()) {
        if (item.name !== 'node_modules') walk(filename);
      } else if (
        /\.[jt]sx?$/.test(item.name) &&
        !/\.d\.[cm]?ts$/.test(item.name)
      ) {
        dependencies?.files.add(filename);
        try {
          const source = fs.readFileSync(filename, 'utf8');
          const lazy = compiler.transformLazy(source, {
            filename,
            sourceMap: false,
          });
          const ast = babel.parseSync(lazy.code, {
            filename,
            babelrc: false,
            configFile: false,
            parserOpts: { plugins: ['typescript', 'jsx'] },
          });
          babel.traverse(
            ast,
            markerVisitor((_marker, specifier) => {
              const module = resolveLazyModule(
                filename,
                specifier,
                projectRoot,
                sourceExtensions,
                dependencies,
              );
              found.set(module.key, {
                ...module,
                entryName: `solid-lazy-${createHash('sha256').update(module.key).digest('hex').slice(0, 16)}`,
              });
            }),
          );
        } catch (error) {
          throw new Error(
            `Solid lazy discovery failed in ${filename}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
      }
    }
  };
  for (const directory of [root, ...entryDirectories]) walk(directory);
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

module.exports = { collectLazyModules, markerVisitor, resolveLazyModule };
