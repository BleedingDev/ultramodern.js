import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveCreatePackageRoot } from '../create-package-root';
import { normalizePath } from './naming';
import type { JsonValue } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const createPackageRoot = resolveCreatePackageRoot(__dirname);
export const workspaceTemplateDir = path.join(
  createPackageRoot,
  'template-workspace',
);
const fileTemplatesDir = path.join(createPackageRoot, 'templates');
const preformatConfigDir = '.modern-js';
const preformatConfigPath = path.join(
  preformatConfigDir,
  'ultramodern-preformat.oxfmt.config.mjs',
);
const workspaceOxfmtIgnorePatterns = [
  '.agents',
  '.codex/skills',
  '.output',
  '**/*.json',
  'dist',
  'node_modules',
  'repos/**',
  '.modern',
  '.modernjs',
  '**/modern-tanstack/**',
  '**/routeTree.gen.*',
];
const formattableExtensions = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.mjs',
  '.mts',
  '.md',
  '.mdx',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

export function readFileTemplate(relativePath: string): string {
  return fs.readFileSync(path.join(fileTemplatesDir, relativePath), 'utf-8');
}

export function renderFileTemplate(
  relativePath: string,
  data: Record<string, string>,
): string {
  return renderTemplate(readFileTemplate(`${relativePath}.handlebars`), data);
}

function assertSafeRelativePath(relativePath: string) {
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/).includes('..')
  ) {
    throw new Error(`Unsafe workspace template path: ${relativePath}`);
  }
}

function isPathInsideRoot(root: string, targetPath: string): boolean {
  const relativePath = path.relative(root, targetPath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}

function findExistingAncestor(targetPath: string): string | undefined {
  let currentPath = targetPath;

  while (!fs.existsSync(currentPath)) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return undefined;
    }
    currentPath = parentPath;
  }

  return currentPath;
}

function ensureInsideRoot(root: string, targetPath: string) {
  const absoluteRoot = path.resolve(root);
  const absoluteTargetPath = path.resolve(targetPath);

  if (!isPathInsideRoot(absoluteRoot, absoluteTargetPath)) {
    throw new Error(`Refusing to write outside workspace root: ${targetPath}`);
  }

  if (!fs.existsSync(absoluteRoot)) {
    return;
  }

  const existingAncestor = findExistingAncestor(absoluteTargetPath);
  if (!existingAncestor) {
    return;
  }

  const rootRealPath = fs.realpathSync.native(absoluteRoot);
  const ancestorRealPath = fs.realpathSync.native(existingAncestor);
  const unresolvedRelativePath = path.relative(
    existingAncestor,
    absoluteTargetPath,
  );
  const resolvedTargetPath = path.resolve(
    ancestorRealPath,
    unresolvedRelativePath,
  );

  if (!isPathInsideRoot(rootRealPath, resolvedTargetPath)) {
    throw new Error(`Refusing to write outside workspace root: ${targetPath}`);
  }
}

export function writeFile(
  targetDir: string,
  relativePath: string,
  content: string,
) {
  assertSafeRelativePath(relativePath);
  const filePath = path.join(targetDir, relativePath);
  ensureInsideRoot(targetDir, filePath);
  if (fs.existsSync(filePath)) {
    throw new Error(
      `Refusing to overwrite generated workspace file: ${relativePath}`,
    );
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function writeFileReplacing(
  targetDir: string,
  relativePath: string,
  content: string,
) {
  assertSafeRelativePath(relativePath);
  const filePath = path.join(targetDir, relativePath);
  ensureInsideRoot(targetDir, filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function writeJson(
  targetDir: string,
  relativePath: string,
  value: JsonValue,
) {
  writeFile(targetDir, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function formatGeneratedWorkspaceFiles(
  targetDir: string,
  relativePaths?: readonly string[],
) {
  const oxfmtBin = resolveOxfmtBin();
  const oxfmtConfigPath = writePreformatConfig(targetDir);
  const targets =
    relativePaths === undefined
      ? [targetDir, `!${normalizePath(path.join(targetDir, 'repos'))}/**`]
      : relativePaths
          .filter(relativePath =>
            formattableExtensions.has(path.extname(relativePath)),
          )
          .map(relativePath => path.join(targetDir, relativePath));

  if (targets.length === 0) {
    removePreformatConfig(targetDir);
    return;
  }

  try {
    const result = spawnSync(
      process.execPath,
      [
        oxfmtBin,
        '--config',
        oxfmtConfigPath,
        '--no-error-on-unmatched-pattern',
        ...targets,
      ],
      {
        cwd: targetDir,
        encoding: 'utf-8',
        env: {
          ...process.env,
          FORCE_COLOR: '0',
        },
      },
    );

    if (result.status !== 0) {
      const detail = [result.stderr.trim(), result.stdout.trim()]
        .filter(Boolean)
        .join('\n');
      throw new Error(
        ['Failed to format generated UltraModern workspace output.', detail]
          .filter(Boolean)
          .join('\n'),
      );
    }
  } finally {
    removePreformatConfig(targetDir);
  }
}

function writePreformatConfig(targetDir: string) {
  const configPath = path.join(targetDir, preformatConfigPath);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const oxfmtUrl = pathToFileURL(resolveOxfmtEntry()).href;
  const ultraciteConfigUrl = pathToFileURL(resolveUltraciteOxfmtConfig()).href;
  fs.writeFileSync(
    configPath,
    [
      `import { defineConfig } from ${JSON.stringify(oxfmtUrl)};`,
      `import ultracite from ${JSON.stringify(ultraciteConfigUrl)};`,
      '',
      'export default defineConfig({',
      '  extends: [ultracite],',
      '  ignorePatterns: [',
      ...workspaceOxfmtIgnorePatterns.map(
        pattern => `    ${JSON.stringify(pattern)},`,
      ),
      '  ],',
      '  singleQuote: true,',
      '});',
      '',
    ].join('\n'),
    'utf-8',
  );
  return configPath;
}

function removePreformatConfig(targetDir: string) {
  fs.rmSync(path.join(targetDir, preformatConfigPath), { force: true });
  try {
    fs.rmdirSync(path.join(targetDir, preformatConfigDir));
  } catch {
    // The generated workspace may legitimately have other tool output here.
  }
}

function resolveOxfmtBin() {
  const packageJsonPath = require.resolve('oxfmt/package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
    bin?: string | Record<string, string>;
  };
  const binPath =
    typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.oxfmt;

  if (typeof binPath !== 'string' || binPath.length === 0) {
    throw new Error('Unable to resolve oxfmt binary from package metadata.');
  }

  return path.join(path.dirname(packageJsonPath), binPath);
}

function resolveOxfmtEntry() {
  return require.resolve('oxfmt');
}

function resolveUltraciteOxfmtConfig() {
  return require.resolve('ultracite/oxfmt');
}

export function renderTemplate(
  template: string,
  data: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => data[key] ?? match);
}

function collectTemplateFiles(dir: string): string[] {
  const files: string[] = [];

  function collect(currentDir: string) {
    for (const entry of fs
      .readdirSync(currentDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        collect(entryPath);
      } else if (entry.isFile()) {
        files.push(normalizePath(path.relative(dir, entryPath)));
      }
    }
  }

  collect(dir);
  return files;
}

export function copyRootTemplate(
  targetDir: string,
  data: Record<string, string>,
  excludedRelativePaths: ReadonlySet<string> = new Set(),
) {
  for (const relativePath of collectTemplateFiles(workspaceTemplateDir)) {
    if (excludedRelativePaths.has(relativePath)) {
      continue;
    }
    const sourcePath = path.join(workspaceTemplateDir, relativePath);
    const outputPath = relativePath.replace(/\.handlebars$/, '');
    const content = relativePath.endsWith('.handlebars')
      ? renderTemplate(fs.readFileSync(sourcePath, 'utf-8'), data)
      : fs.readFileSync(sourcePath, 'utf-8');
    writeFile(targetDir, outputPath, content);
  }
}

export function readJsonFile(filePath: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function writeJsonFile(filePath: string, value: JsonValue) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}
