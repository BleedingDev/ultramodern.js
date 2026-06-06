import fs from 'node:fs';
import path from 'node:path';
import { printOxlintOutput, runOxlintRules } from './oxlint';

type WorkspaceSourceCheckOptions = {
  readonly cwd?: string;
  readonly sourceRoots?: readonly string[];
};

type LocaleJson = {
  readonly [key: string]: unknown;
};

export const WORKSPACE_SOURCE_SUCCESS =
  'UltraModern i18n and boundary guardrails validated';

const ignoredDirectories = new Set([
  '.modern',
  '.modernjs',
  '.output',
  'dist',
  'node_modules',
]);

const normalizePath = (filePath: string): string =>
  filePath.replaceAll('\\', '/');

const relativePath = (root: string, filePath: string): string =>
  normalizePath(path.relative(root, filePath));

const walk = (directory: string, files: string[] = []): string[] => {
  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(entryPath, files);
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
};

const isSourceFile = (filePath: string): boolean =>
  /\.(?:ts|tsx|js|jsx)$/u.test(filePath);

const isLocaleJson = (root: string, filePath: string): boolean =>
  /\/locales\/(?:en|cs)\/[^/]+\.json$/u.test(
    `/${relativePath(root, filePath)}`,
  );

const readText = (filePath: string): string =>
  fs.readFileSync(filePath, 'utf-8');

const checkRuntimeResources = (
  root: string,
  filePath: string,
  text: string,
): void => {
  const relative = relativePath(root, filePath);
  if (!relative.endsWith('/src/modern.runtime.ts')) {
    return;
  }

  const importsLocaleResources =
    /import\s+csResource\s+from\s+['"]\.\.\/locales\/cs\/[^'"]+\.json['"]/u.test(
      text,
    ) &&
    /import\s+enResource\s+from\s+['"]\.\.\/locales\/en\/[^'"]+\.json['"]/u.test(
      text,
    );

  if (
    !importsLocaleResources ||
    !/initOptions\s*:\s*\{[\s\S]*?\bresources\s*,/u.test(text)
  ) {
    throw new Error(
      `${relative} must register locale JSON resources in modern.runtime.ts so Worker SSR and hydration use the same first-render translations.`,
    );
  }
};

const visitLocaleKeys = (
  value: unknown,
  visitor: (key: string, value: unknown, pathParts: readonly string[]) => void,
  pathParts: readonly string[] = [],
): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...pathParts, key];
    visitor(key, child, nextPath);
    visitLocaleKeys(child, visitor, nextPath);
  }
};

const checkPluralResources = (
  root: string,
  filePath: string,
  json: LocaleJson,
): void => {
  const relative = relativePath(root, filePath);
  const language = relative.split('/locales/')[1]?.split('/')[0];
  const requiredSuffixes =
    language === 'cs' ? ['one', 'few', 'many', 'other'] : ['one', 'other'];
  const groups = new Map<string, Set<string>>();

  visitLocaleKeys(json, (key, value, pathParts) => {
    if (typeof value !== 'string' || !value.includes('{{count}}')) {
      return;
    }

    const suffixMatch = key.match(/^(.*)_(one|few|many|other)$/u);
    if (!suffixMatch) {
      throw new Error(
        `${relative} key ${pathParts.join('.')} contains {{count}} but is not plural-suffixed.`,
      );
    }

    const [, base = '', suffix = ''] = suffixMatch;
    const parentPath = pathParts.slice(0, -1).join('.');
    const groupKey = `${parentPath}.${base}`;
    const existing = groups.get(groupKey) ?? new Set<string>();
    existing.add(suffix);
    groups.set(groupKey, existing);
  });

  for (const [group, suffixes] of groups) {
    for (const suffix of requiredSuffixes) {
      if (!suffixes.has(suffix)) {
        throw new Error(
          `${relative} plural group ${group} is missing _${suffix}.`,
        );
      }
    }
  }
};

const runRuntimeAndLocaleResourceChecks = (
  root: string,
  sourceRoots: readonly string[],
): void => {
  const files = sourceRoots.flatMap(sourceRoot =>
    walk(path.join(root, sourceRoot)),
  );

  for (const filePath of files.filter(isSourceFile)) {
    checkRuntimeResources(root, filePath, readText(filePath));
  }

  for (const filePath of files.filter(filePath =>
    isLocaleJson(root, filePath),
  )) {
    checkPluralResources(root, filePath, JSON.parse(readText(filePath)));
  }
};

export const runWorkspaceSourceCheck = ({
  cwd = process.cwd(),
  sourceRoots = ['apps', 'verticals'],
}: WorkspaceSourceCheckOptions = {}): number => {
  const oxlintResult = runOxlintRules({
    cwd,
    targets: sourceRoots,
    rules: {
      'ultramodern/no-legacy-mf-boundary-attributes': 'error',
      'ultramodern/no-literal-visible-jsx-attributes': [
        'error',
        {
          visibleAttributes: [
            'aria-label',
            'aria-description',
            'aria-roledescription',
            'aria-valuetext',
            'alt',
            'label',
            'placeholder',
            'title',
          ],
        },
      ],
      'ultramodern/no-manual-locale-copy-branching': 'error',
      'ultramodern/no-split-translation-keys': 'error',
    },
  });

  if (oxlintResult.exitCode !== 0) {
    printOxlintOutput(oxlintResult);
    return oxlintResult.exitCode;
  }

  try {
    runRuntimeAndLocaleResourceChecks(cwd, sourceRoots);
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'UltraModern workspace source checks failed.',
    );
    return 1;
  }

  console.log(WORKSPACE_SOURCE_SUCCESS);
  return 0;
};

export const main = (): void => {
  process.exitCode = runWorkspaceSourceCheck();
};
