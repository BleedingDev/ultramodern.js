import fs from 'node:fs';
import path from 'node:path';
import { printOxlintOutput, runOxlintRules } from './oxlint';

export type WorkspaceSourceCheckOptions = {
  readonly cwd?: string;
  readonly sourceRoots?: readonly string[];
  /**
   * Locale codes whose `locales/<locale>/*.json` resources are plural-checked
   * and must be registered in each app's `src/modern.runtime.ts`.
   * Defaults to `['en', 'cs']` (the UltraModern workspace convention).
   * Pass an empty array to opt out of the runtime/locale resource checks.
   */
  readonly locales?: readonly string[];
  /**
   * Per-locale plural-category overrides. Locales absent from this map
   * resolve their categories through `Intl.PluralRules(locale)` (CLDR
   * cardinal rules), e.g. `['one', 'other']` for `en` and
   * `['one', 'few', 'many', 'other']` for `cs`.
   */
  readonly pluralCategories?: Readonly<Record<string, readonly string[]>>;
};

type LocaleJson = {
  readonly [key: string]: unknown;
};

const WORKSPACE_SOURCE_SUCCESS =
  'UltraModern i18n and boundary guardrails validated';

const DEFAULT_LOCALES = ['en', 'cs'] as const;

const DEFAULT_SOURCE_ROOTS = ['apps', 'verticals', 'packages'] as const;

const ignoredDirectories = new Set([
  '.modern',
  '.modernjs',
  '.output',
  'dist',
  'node_modules',
]);

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

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
  /\.(?:[cm]?[jt]sx?)$/u.test(filePath);

const createLocaleJsonMatcher = (
  locales: readonly string[],
): ((root: string, filePath: string) => boolean) => {
  const pattern = new RegExp(
    `/locales/(?:${locales.map(escapeRegExp).join('|')})/[^/]+\\.json$`,
    'u',
  );
  return (root, filePath) => pattern.test(`/${relativePath(root, filePath)}`);
};

const resolvePluralCategories = (
  locale: string,
  overrides: Readonly<Record<string, readonly string[]>> | undefined,
): readonly string[] =>
  overrides?.[locale] ??
  new Intl.PluralRules(locale).resolvedOptions().pluralCategories;

const readText = (filePath: string): string =>
  fs.readFileSync(filePath, 'utf-8');

const localeImportPattern = (locale: string): RegExp =>
  new RegExp(
    `import\\s+(?:\\*\\s+as\\s+)?[A-Za-z_$][\\w$]*\\s+from\\s+['"]\\.\\./locales/${escapeRegExp(
      locale,
    )}/[^'"]+\\.json['"]`,
    'u',
  );

/** A source or locale-resource violation; every other throw is a tool failure. */
class SourceViolation extends Error {}

const checkRuntimeResources = (
  root: string,
  filePath: string,
  text: string,
  locales: readonly string[],
): void => {
  const relative = relativePath(root, filePath);
  if (!relative.endsWith('/src/modern.runtime.ts')) {
    return;
  }

  const missingLocales = locales.filter(
    locale => !localeImportPattern(locale).test(text),
  );
  const registersResources =
    /initOptions\s*:\s*\{[\s\S]*?\bresources\s*[,:}]/u.test(text);

  if (missingLocales.length > 0 || !registersResources) {
    const detail =
      missingLocales.length > 0
        ? `missing locale JSON imports for: ${missingLocales.join(', ')}`
        : 'initOptions does not register a `resources` entry';
    throw new SourceViolation(
      `${relative} must register locale JSON resources in modern.runtime.ts so Worker SSR and hydration use the same first-render translations (${detail}).`,
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
  requiredSuffixes: readonly string[],
  pluralSuffixPattern: RegExp,
): void => {
  const relative = relativePath(root, filePath);
  const groups = new Map<string, Set<string>>();

  visitLocaleKeys(json, (key, value, pathParts) => {
    if (typeof value !== 'string' || !value.includes('{{count}}')) {
      return;
    }

    const suffixMatch = key.match(pluralSuffixPattern);
    if (!suffixMatch) {
      throw new SourceViolation(
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
        throw new SourceViolation(
          `${relative} plural group ${group} is missing _${suffix}.`,
        );
      }
    }
  }
};

const runRuntimeAndLocaleResourceChecks = (
  root: string,
  sourceRoots: readonly string[],
  locales: readonly string[],
  pluralCategories: Readonly<Record<string, readonly string[]>> | undefined,
): void => {
  if (locales.length === 0) {
    return;
  }

  const isLocaleJson = createLocaleJsonMatcher(locales);
  const localeCategories = new Map(
    locales.map(locale => [
      locale,
      resolvePluralCategories(locale, pluralCategories),
    ]),
  );
  const pluralSuffixPattern = new RegExp(
    `^(.*)_(${[...new Set([...localeCategories.values()].flat())]
      .map(escapeRegExp)
      .join('|')})$`,
    'u',
  );

  const files = sourceRoots.flatMap(sourceRoot =>
    walk(path.join(root, sourceRoot)),
  );

  for (const filePath of files.filter(isSourceFile)) {
    checkRuntimeResources(root, filePath, readText(filePath), locales);
  }

  for (const filePath of files.filter(filePath =>
    isLocaleJson(root, filePath),
  )) {
    const relative = relativePath(root, filePath);
    const language = relative.split('/locales/')[1]?.split('/')[0] ?? '';
    checkPluralResources(
      root,
      filePath,
      JSON.parse(readText(filePath)),
      localeCategories.get(language) ?? [],
      pluralSuffixPattern,
    );
  }
};

export const runWorkspaceSourceCheck = ({
  cwd = process.cwd(),
  sourceRoots = DEFAULT_SOURCE_ROOTS,
  locales = DEFAULT_LOCALES,
  pluralCategories,
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
      'ultramodern/strict-effect-api-boundaries': 'error',
    },
  });

  if (oxlintResult.exitCode !== 0) {
    printOxlintOutput(oxlintResult);
    return oxlintResult.exitCode;
  }

  try {
    runRuntimeAndLocaleResourceChecks(
      cwd,
      sourceRoots,
      locales,
      pluralCategories,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return error instanceof SourceViolation ? 1 : 2;
  }

  console.log(WORKSPACE_SOURCE_SUCCESS);
  return 0;
};

const USAGE = `modern-i18n-check [--workspace-root <path>]
Runs the UltraModern i18n and boundary source checks for a workspace.
Workspace defaults to ULTRAMODERN_WORKSPACE_ROOT then cwd. Options come from
package.json "modernjs.i18nCheck": { sourceRoots, locales, pluralCategories }.
Exit codes: 0 valid, 1 source violation, 2 tool/configuration failure.`;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every(entry => typeof entry === 'string' && entry.length > 0);

const isLocaleArray = (value: unknown): value is string[] => {
  if (!isStringArray(value)) return false;
  try {
    Intl.getCanonicalLocales(value);
    return true;
  } catch {
    return false;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Accepts a workspace-relative directory only: both check phases join the
 * entry onto the root, and canonical paths stop a symlink pointing outside.
 */
const isWorkspaceDirectory = (root: string, entry: string): boolean => {
  if (path.isAbsolute(entry)) return false;
  const target = path.resolve(root, entry);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    return false;
  }
  const relative = path.relative(
    fs.realpathSync(root),
    fs.realpathSync(target),
  );
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const CLDR_PLURAL_CATEGORIES = new Set([
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
]);

/** Each override must be a CLDR category list; CLDR always has `other`. */
const isPluralCategories = (
  value: unknown,
): value is Record<string, string[]> =>
  isRecord(value) &&
  Object.values(value).every(
    categories =>
      isStringArray(categories) &&
      categories.includes('other') &&
      categories.every(category => CLDR_PLURAL_CATEGORIES.has(category)),
  );

/** Reads `modernjs.i18nCheck` from the workspace package.json. */
const readWorkspaceCheckOptions = (
  root: string,
): WorkspaceSourceCheckOptions => {
  const manifestPath = path.join(root, 'package.json');
  const modernjs = JSON.parse(readText(manifestPath)).modernjs;
  const config =
    isRecord(modernjs) && Object.hasOwn(modernjs, 'i18nCheck')
      ? modernjs.i18nCheck
      : {};
  const invalid = (field: string, expected: string) =>
    new Error(
      `${manifestPath} "modernjs.i18nCheck${field}" must be ${expected}.`,
    );
  if (!isRecord(config)) {
    throw invalid('', 'an object');
  }
  const { locales, pluralCategories } = config;
  if (locales !== undefined && !isLocaleArray(locales)) {
    throw invalid('.locales', 'an array of BCP 47 locale codes');
  }
  if (pluralCategories !== undefined && !isPluralCategories(pluralCategories)) {
    throw invalid(
      '.pluralCategories',
      'an object of locale -> CLDR plural categories including "other"',
    );
  }
  // Omitted roots mean the conventional ones this workspace actually has.
  const sourceRoots = Object.hasOwn(config, 'sourceRoots')
    ? config.sourceRoots
    : DEFAULT_SOURCE_ROOTS.filter(entry => isWorkspaceDirectory(root, entry));
  if (
    !isStringArray(sourceRoots) ||
    sourceRoots.length === 0 ||
    !sourceRoots.every(entry => isWorkspaceDirectory(root, entry))
  ) {
    throw invalid(
      '.sourceRoots',
      `a non-empty array of existing workspace-relative directories (default: whichever of ${DEFAULT_SOURCE_ROOTS.join(', ')} exist)`,
    );
  }
  return { cwd: root, sourceRoots, locales, pluralCategories };
};

export const runWorkspaceSourceCheckCli = (
  args: readonly string[] = process.argv.slice(2),
): number => {
  let workspaceRoot = process.env.ULTRAMODERN_WORKSPACE_ROOT ?? process.cwd();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      console.log(USAGE);
      return 0;
    }
    const value = args[index + 1];
    if (argument !== '--workspace-root' || !value || value.startsWith('--')) {
      console.error(`Invalid argument: ${argument ?? ''}. Use --help.`);
      return 2;
    }
    workspaceRoot = value;
    index += 1;
  }

  // runWorkspaceSourceCheck returns 1 for violations and 2 for check-time
  // tool failures; anything thrown here is a configuration failure.
  try {
    return runWorkspaceSourceCheck(
      readWorkspaceCheckOptions(path.resolve(workspaceRoot)),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
};
