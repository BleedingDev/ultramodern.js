import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';

type StaticDependency = {
  importer: string;
  specifier: string;
};

type StaticModuleGraph = {
  dependencies: StaticDependency[];
  files: string[];
};

const EDGE_ENTRY = path.resolve(__dirname, '../src/effect/edge.ts');
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SOURCE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
];
const FORBIDDEN_EDGE_MODULES: readonly {
  label: string;
  pattern: RegExp;
}[] = [
  {
    label: 'adapter',
    pattern: /(?:^|[/@._-])adapters?(?:[/._-]|$)/i,
  },
  {
    label: 'backend federation',
    pattern: /backend[-_/]?federation/i,
  },
  {
    label: 'Hono',
    pattern: /(?:^|[/@._-])hono(?:[/._-]|$)/i,
  },
  {
    label: 'generator',
    pattern: /(?:^|[/@._-])generators?(?:[/._-]|$)/i,
  },
];

const readStaticModuleSpecifiers = (source: string): string[] => {
  const staticModuleSpecifier =
    /^\s*(?:import\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s+)?|export\s+(?:type\s+)?(?:\*\s*(?:as\s+\w+\s*)?|\{[\s\S]*?\})\s+from\s+)(['"])([^'"\r\n]+)\1/gm;

  return Array.from(source.matchAll(staticModuleSpecifier), match => match[2]);
};

const resolveRelativeModule = (importer: string, specifier: string): string => {
  const unresolvedPath = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(unresolvedPath)
    ? [unresolvedPath]
    : [
        ...SOURCE_EXTENSIONS.map(extension => `${unresolvedPath}${extension}`),
        ...SOURCE_EXTENSIONS.map(extension =>
          path.join(unresolvedPath, `index${extension}`),
        ),
      ];
  const resolvedPath = candidates.find(candidate => existsSync(candidate));

  if (!resolvedPath) {
    throw new Error(
      `Could not resolve relative static dependency ${specifier} from ${importer}`,
    );
  }

  return resolvedPath;
};

const collectStaticModuleGraph = (entry: string): StaticModuleGraph => {
  const dependencies: StaticDependency[] = [];
  const files = new Set<string>();
  const pending = [entry];

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || files.has(file)) {
      continue;
    }

    files.add(file);
    const source = readFileSync(file, 'utf8');
    for (const specifier of readStaticModuleSpecifiers(source)) {
      dependencies.push({ importer: file, specifier });
      if (specifier.startsWith('.')) {
        pending.push(resolveRelativeModule(file, specifier));
      }
    }
  }

  return {
    dependencies: dependencies.sort((left, right) =>
      `${left.importer}:${left.specifier}`.localeCompare(
        `${right.importer}:${right.specifier}`,
      ),
    ),
    files: [...files].sort(),
  };
};

const displayPath = (file: string): string =>
  path.relative(PACKAGE_ROOT, file).replaceAll(path.sep, '/');

describe('Effect edge entry static module graph', () => {
  test('does not statically load Node built-ins or edge-excluded modules', () => {
    const graph = collectStaticModuleGraph(EDGE_ENTRY);
    const builtInDependencies = graph.dependencies
      .filter(({ specifier }) => isBuiltin(specifier))
      .map(
        ({ importer, specifier }) => `${displayPath(importer)} -> ${specifier}`,
      );
    const forbiddenDependencies = graph.dependencies.flatMap(
      ({ importer, specifier }) =>
        FORBIDDEN_EDGE_MODULES.filter(({ pattern }) =>
          pattern.test(specifier),
        ).map(
          ({ label }) => `${label}: ${displayPath(importer)} -> ${specifier}`,
        ),
    );
    const forbiddenFiles = graph.files.flatMap(file =>
      FORBIDDEN_EDGE_MODULES.filter(({ pattern }) =>
        pattern.test(displayPath(file)),
      ).map(({ label }) => `${label}: ${displayPath(file)}`),
    );

    expect(builtInDependencies).toEqual([]);
    expect(forbiddenDependencies).toEqual([]);
    expect(forbiddenFiles).toEqual([]);
  });
});
