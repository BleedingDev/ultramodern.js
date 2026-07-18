import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const dependencyBlocks = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);
const ignoredDirectories = new Set(['.git', '.output', 'dist', 'node_modules']);
const protectedUiRoots = Object.freeze(['apps', 'packages', 'verticals']);
const forbiddenRouteSearchPatterns = Object.freeze([
  {
    label: 'URLSearchParams',
    pattern: /\bURLSearchParams\b/u,
  },
  {
    label: 'location.search',
    pattern: /\blocation\.search(?:Str)?\b/u,
  },
  {
    label: 'window.location.search',
    pattern: /\bwindow\.location\.search\b/u,
  },
]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function collectFiles(root, predicate = () => true) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
      } else if (entry.isFile() && predicate(absolute)) {
        files.push(absolute);
      }
    }
  }
  return files.sort();
}

function collectPackageJsonFiles(workspace) {
  return [
    path.join(workspace, 'package.json'),
    ...protectedUiRoots.flatMap(root =>
      collectFiles(
        path.join(workspace, root),
        file => path.basename(file) === 'package.json',
      ),
    ),
  ]
    .filter((file, index, files) => files.indexOf(file) === index)
    .sort();
}

function assertAuthenticatedTractorCohort(workspace, release) {
  const cohortPath = path.join(workspace, '.modernjs/release-cohort.json');
  const configPath = path.join(workspace, '.modernjs/ultramodern.json');
  assert(
    fs.existsSync(cohortPath),
    'Tractor authenticated release cohort projection is missing',
  );
  assert(fs.existsSync(configPath), 'Tractor UltraModern config is missing');
  const observed = readJson(cohortPath);
  const expected = release.cohortProjection?.value;
  assert(
    expected && typeof expected === 'object' && !Array.isArray(expected),
    'Strict release manifest cohort projection is missing',
  );
  assert(
    isDeepStrictEqual(observed, expected),
    'Tractor authenticated release cohort projection differs from the exact release manifest',
  );
  const config = readJson(configPath);
  const version = release.release?.version;
  assert(
    config.generator?.version === version,
    `Tractor generator version must be ${version}, found ${String(config.generator?.version)}`,
  );
  assert(
    config.packageSource?.strategy === 'install' &&
      config.packageSource?.modernPackageVersion === version,
    `Tractor install package source must use exact release ${version}`,
  );
  return {
    packageCount: observed.packages?.length,
    projectionSchema: observed.schema,
    projectionSchemaVersion: observed.schemaVersion,
    version,
  };
}

function assertExactModernDependencySpecifiers(workspace, release) {
  const version = release.release?.version;
  const aliases = release.aliases;
  assert(
    typeof version === 'string' && version.length > 0,
    'Release version is required for Tractor cohort validation',
  );
  assert(
    aliases && typeof aliases === 'object' && !Array.isArray(aliases),
    'Release aliases are required for Tractor cohort validation',
  );

  const observations = [];
  for (const packageFile of collectPackageJsonFiles(workspace)) {
    const manifest = readJson(packageFile);
    for (const blockName of dependencyBlocks) {
      for (const [dependencyName, specifier] of Object.entries(
        manifest[blockName] ?? {},
      )) {
        if (!dependencyName.startsWith('@modern-js/')) {
          continue;
        }
        const targetName = aliases[dependencyName];
        assert(
          typeof targetName === 'string',
          `${normalizePath(path.relative(workspace, packageFile))} ${blockName}.${dependencyName} is absent from the exact release cohort`,
        );
        const expected = `npm:${targetName}@${version}`;
        assert(
          specifier === expected,
          `${normalizePath(path.relative(workspace, packageFile))} ${blockName}.${dependencyName} must be ${expected}, found ${String(specifier)}`,
        );
        observations.push({
          blockName,
          dependencyName,
          packageFile: normalizePath(path.relative(workspace, packageFile)),
          specifier,
          targetName,
        });
      }
    }
  }
  assert(
    observations.length > 0,
    'Tractor workspace contains no Modern.js dependencies to bind to the release cohort',
  );
  return observations;
}

function isProtectedUiFile(workspace, file) {
  const relative = normalizePath(path.relative(workspace, file));
  if (!protectedUiRoots.some(root => relative.startsWith(`${root}/`))) {
    return false;
  }
  return (
    relative.includes('/src/') ||
    relative.includes('/locales/') ||
    relative.includes('/public/')
  );
}

function snapshotProtectedUi(workspace) {
  const files = collectFiles(workspace, file =>
    isProtectedUiFile(workspace, file),
  );
  assert(files.length > 0, 'Tractor protected UI source set is empty');
  const entries = files.map(file => {
    const relative = normalizePath(path.relative(workspace, file));
    const sha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(file))
      .digest('hex');
    return { path: relative, sha256 };
  });
  return {
    fileCount: entries.length,
    sha256: crypto
      .createHash('sha256')
      .update(JSON.stringify(entries))
      .digest('hex'),
    entries,
  };
}

function assertProtectedUiUnchanged(before, after) {
  assert(
    JSON.stringify(before.entries) === JSON.stringify(after.entries),
    'UltraModern migration changed Tractor visible UI, localization, public assets, or shared UI source',
  );
  return {
    fileCount: after.fileCount,
    sha256: after.sha256,
    status: 'unchanged',
  };
}

function assertNativeTanStackSearch(workspace) {
  const routeRoot = path.join(workspace, 'apps/shell-super-app/src/routes');
  const routeFiles = collectFiles(routeRoot, file =>
    /\.(?:ts|tsx)$/u.test(file),
  );
  assert(routeFiles.length > 0, 'Tractor shell route source is missing');

  for (const file of routeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    for (const forbidden of forbiddenRouteSearchPatterns) {
      assert(
        !forbidden.pattern.test(source),
        `${normalizePath(path.relative(workspace, file))} manually parses query search through ${forbidden.label}; use the native typed TanStack search contract`,
      );
    }
  }

  const productRoute = path.join(routeRoot, '[lang]/tractors/[slug]/page.tsx');
  const searchContract = path.join(
    routeRoot,
    '[lang]/tractors/[slug]/page.search.ts',
  );
  assert(fs.existsSync(productRoute), 'Tractor product route is missing');
  assert(
    fs.existsSync(searchContract),
    'Tractor product search contract is missing',
  );
  const routeSource = fs.readFileSync(productRoute, 'utf8');
  const searchSource = fs.readFileSync(searchContract, 'utf8');
  assert(
    /from ['"]@modern-js\/plugin-tanstack\/runtime['"]/u.test(routeSource) &&
      /\buseParams\s*\(/u.test(routeSource) &&
      /\buseSearch\s*\(/u.test(routeSource),
    'Tractor product route must use native Modern.js TanStack useParams and useSearch hooks',
  );
  assert(
    /\bexport const validateSearch\b/u.test(searchSource) &&
      /\bsku\b/u.test(searchSource),
    'Tractor product route must expose a typed sku validateSearch contract',
  );
  return {
    auditedRouteFiles: routeFiles.length,
    productRoute: normalizePath(path.relative(workspace, productRoute)),
    searchContract: normalizePath(path.relative(workspace, searchContract)),
    status: 'native-typed-search',
  };
}

export {
  assertAuthenticatedTractorCohort,
  assertExactModernDependencySpecifiers,
  assertNativeTanStackSearch,
  assertProtectedUiUnchanged,
  snapshotProtectedUi,
};
