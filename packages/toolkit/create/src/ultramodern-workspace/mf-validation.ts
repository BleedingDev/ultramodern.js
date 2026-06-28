import fs from 'node:fs';
import path from 'node:path';

const moduleFederationConfigFile = 'module-federation.config.ts';
const mfTypesArchive = 'dist/@mf-types.zip';
const generatedMetadataPaths = ['.modernjs/ultramodern.json'];
const defaultAppRootDirs = ['apps', 'verticals'];
const skippedScanDirs = new Set([
  '.git',
  '.modernjs',
  '.nx',
  '.turbo',
  'coverage',
  'dist',
  'node_modules',
]);

type JsonRecord = Record<string, unknown>;

export type ModuleFederationConfigInspection = {
  appDir: string;
  configPath: string;
  dts: {
    compilerInstance?: string;
    tsConfigPath?: string;
  };
  exposes: string[];
  hostOnlyNoExposes: boolean;
};

export type ModuleFederationDiscoveredConfig = {
  appDir: string;
  configPath: string;
};

export type ModuleFederationValidationResult = {
  configCount: number;
  exposedAppCount: number;
  hostOnlyAppCount: number;
  apps: ModuleFederationConfigInspection[];
};

export type ModuleFederationValidationOptions = {
  workspaceRoot: string;
  appDirs?: string[];
};

type BalancedBlock = {
  inner: string;
  suffix: string;
};

type ParsedObjectLiteral = {
  hasSpread: boolean;
  properties: Map<string, string>;
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/u, '');
  const trimmed = normalized.replace(/\/+$/u, '');
  return trimmed === '' ? '.' : trimmed;
}

function relativePath(root: string, target: string): string {
  return normalizeRelativePath(toPosixPath(path.relative(root, target)));
}

function readJsonIfExists(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function addMetadataAppDir(value: unknown, appDirs: Set<string>, hint = '') {
  if (!isRecord(value)) {
    return;
  }

  const pathValue =
    typeof value.path === 'string'
      ? value.path
      : typeof value.directory === 'string'
        ? value.directory
        : undefined;
  const hasModuleFederationDeclaration =
    isRecord(value.moduleFederation) ||
    typeof value.moduleFederationName === 'string' ||
    hint === 'apps' ||
    hint === 'verticals' ||
    hint === 'remotes' ||
    hint === 'moduleFederation';

  if (
    pathValue &&
    hasModuleFederationDeclaration &&
    !path.isAbsolute(pathValue)
  ) {
    appDirs.add(normalizeRelativePath(pathValue));
  }
}

function collectMetadataAppDirs(
  value: unknown,
  appDirs: Set<string>,
  hint = '',
) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectMetadataAppDirs(entry, appDirs, hint);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  addMetadataAppDir(value, appDirs, hint);

  for (const [key, entry] of Object.entries(value)) {
    collectMetadataAppDirs(entry, appDirs, key);
  }
}

function literalRootFromPattern(pattern: string): string | undefined {
  const normalized = normalizeRelativePath(pattern);
  if (
    normalized === '.' ||
    path.isAbsolute(normalized) ||
    normalized.startsWith('../')
  ) {
    return undefined;
  }

  const segments = normalized.split('/');
  const literalSegments: string[] = [];

  for (const segment of segments) {
    if (/[*?[\]{}]/u.test(segment)) {
      break;
    }
    literalSegments.push(segment);
  }

  return literalSegments.length > 0 ? literalSegments.join('/') : undefined;
}

function collectBridgeScanRoots(value: unknown, roots: Set<string>) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectBridgeScanRoots(entry, roots);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const workspacePackages = value.bridge;
  if (isRecord(workspacePackages)) {
    const entries = workspacePackages.workspacePackages;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (isRecord(entry) && typeof entry.pattern === 'string') {
          const root = literalRootFromPattern(entry.pattern);
          if (root) {
            roots.add(root);
          }
        }
      }
    }
  }

  for (const entry of Object.values(value)) {
    collectBridgeScanRoots(entry, roots);
  }
}

function readGeneratedMetadata(workspaceRoot: string): unknown[] {
  return generatedMetadataPaths
    .map(metadataPath =>
      readJsonIfExists(path.join(workspaceRoot, metadataPath)),
    )
    .filter((metadata): metadata is unknown => metadata !== undefined);
}

function firstSegment(appDir: string): string | undefined {
  if (appDir === '.') {
    return undefined;
  }

  return appDir.split('/')[0];
}

function scanForModuleFederationConfigs(
  workspaceRoot: string,
  scanRoot: string,
  appDirs: Set<string>,
) {
  const absoluteRoot = path.join(workspaceRoot, scanRoot);
  if (
    !fs.existsSync(absoluteRoot) ||
    !fs.statSync(absoluteRoot).isDirectory()
  ) {
    return;
  }

  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skippedScanDirs.has(entry.name)) {
          visit(path.join(directory, entry.name));
        }
        continue;
      }

      if (entry.isFile() && entry.name === moduleFederationConfigFile) {
        appDirs.add(relativePath(workspaceRoot, directory));
      }
    }
  };

  visit(absoluteRoot);
}

export function discoverModuleFederationConfigs(
  options: ModuleFederationValidationOptions,
): ModuleFederationDiscoveredConfig[] {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const appDirs = new Set<string>();

  if (options.appDirs && options.appDirs.length > 0) {
    for (const appDir of options.appDirs) {
      appDirs.add(normalizeRelativePath(appDir));
    }
  } else {
    const metadata = readGeneratedMetadata(workspaceRoot);
    const scanRoots = new Set(defaultAppRootDirs);

    for (const metadataEntry of metadata) {
      collectMetadataAppDirs(metadataEntry, appDirs);
      collectBridgeScanRoots(metadataEntry, scanRoots);
    }

    for (const appDir of appDirs) {
      const segment = firstSegment(appDir);
      if (segment) {
        scanRoots.add(segment);
      }
    }

    if (fs.existsSync(path.join(workspaceRoot, moduleFederationConfigFile))) {
      appDirs.add('.');
    }

    for (const scanRoot of scanRoots) {
      scanForModuleFederationConfigs(workspaceRoot, scanRoot, appDirs);
    }
  }

  return Array.from(appDirs)
    .sort()
    .map(appDir => ({
      appDir,
      configPath: path.join(workspaceRoot, appDir, moduleFederationConfigFile),
    }));
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === '\\';
    cursor -= 1
  ) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function skipQuoted(source: string, start: number, quote: "'" | '"'): number {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === quote && !isEscaped(source, index)) {
      return index + 1;
    }
  }

  return source.length;
}

function skipLineComment(source: string, start: number): number {
  const newline = source.indexOf('\n', start + 2);
  return newline === -1 ? source.length : newline + 1;
}

function skipBlockComment(source: string, start: number): number {
  const close = source.indexOf('*/', start + 2);
  return close === -1 ? source.length : close + 2;
}

function skipTemplateExpression(source: string, start: number): number {
  let depth = 1;

  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "'") {
      index = skipQuoted(source, index, "'") - 1;
      continue;
    }
    if (char === '"') {
      index = skipQuoted(source, index, '"') - 1;
      continue;
    }
    if (char === '`') {
      index = skipTemplate(source, index) - 1;
      continue;
    }
    if (char === '/' && next === '/') {
      index = skipLineComment(source, index) - 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index = skipBlockComment(source, index) - 1;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return source.length;
}

function skipTemplate(source: string, start: number): number {
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '`' && !isEscaped(source, index)) {
      return index + 1;
    }
    if (char === '$' && next === '{' && !isEscaped(source, index)) {
      index = skipTemplateExpression(source, index + 1) - 1;
    }
  }

  return source.length;
}

function skipSyntax(source: string, index: number): number {
  const char = source[index];
  const next = source[index + 1];

  if (char === "'") {
    return skipQuoted(source, index, "'");
  }
  if (char === '"') {
    return skipQuoted(source, index, '"');
  }
  if (char === '`') {
    return skipTemplate(source, index);
  }
  if (char === '/' && next === '/') {
    return skipLineComment(source, index);
  }
  if (char === '/' && next === '*') {
    return skipBlockComment(source, index);
  }

  return index;
}

function findBalanced(
  source: string,
  start: number,
  open: '{' | '[' | '(',
  close: '}' | ']' | ')',
): number | undefined {
  let depth = 1;

  for (let index = start + 1; index < source.length; index += 1) {
    const skipped = skipSyntax(source, index);
    if (skipped !== index) {
      index = skipped - 1;
      continue;
    }

    if (source[index] === open) {
      depth += 1;
      continue;
    }

    if (source[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return undefined;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (/\s/u.test(char ?? '')) {
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      index = skipLineComment(source, index);
      continue;
    }
    if (char === '/' && next === '*') {
      index = skipBlockComment(source, index);
      continue;
    }

    return index;
  }

  return index;
}

function hasIdentifierBoundary(source: string, start: number, end: number) {
  return (
    !/[$\w]/u.test(source[start - 1] ?? '') && !/[$\w]/u.test(source[end] ?? '')
  );
}

function findCreateModuleFederationConfigObject(
  source: string,
): string | undefined {
  const callee = 'createModuleFederationConfig';
  let offset = 0;

  while (offset < source.length) {
    const index = source.indexOf(callee, offset);
    if (index === -1) {
      break;
    }

    offset = index + callee.length;
    if (!hasIdentifierBoundary(source, index, offset)) {
      continue;
    }

    const parenIndex = skipWhitespaceAndComments(source, offset);
    if (source[parenIndex] !== '(') {
      continue;
    }

    const argumentIndex = skipWhitespaceAndComments(source, parenIndex + 1);
    if (source[argumentIndex] !== '{') {
      throw new Error(
        'Module Federation config must pass a static object literal to createModuleFederationConfig.',
      );
    }

    const closeIndex = findBalanced(source, argumentIndex, '{', '}');
    if (closeIndex === undefined) {
      throw new Error('Module Federation config object literal is not closed.');
    }

    return source.slice(argumentIndex, closeIndex + 1);
  }

  return undefined;
}

function findExportDefaultObject(source: string): string | undefined {
  const exportDefault = 'export default';
  const index = source.indexOf(exportDefault);
  if (index === -1) {
    return undefined;
  }

  const objectStart = skipWhitespaceAndComments(
    source,
    index + exportDefault.length,
  );
  if (source[objectStart] !== '{') {
    return undefined;
  }

  const objectEnd = findBalanced(source, objectStart, '{', '}');
  if (objectEnd === undefined) {
    throw new Error('Module Federation export default object is not closed.');
  }

  return source.slice(objectStart, objectEnd + 1);
}

function getOuterBlock(
  source: string,
  open: '{' | '[',
  close: '}' | ']',
): BalancedBlock | undefined {
  const trimmed = source.trim();
  if (trimmed[0] !== open) {
    return undefined;
  }

  const end = findBalanced(trimmed, 0, open, close);
  if (end === undefined) {
    return undefined;
  }

  const suffix = trimmed.slice(end + 1).trim();
  if (
    suffix !== '' &&
    !suffix.startsWith('as ') &&
    !suffix.startsWith('satisfies ')
  ) {
    return undefined;
  }

  return {
    inner: trimmed.slice(1, end),
    suffix,
  };
}

function splitTopLevelEntries(source: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipSyntax(source, index);
    if (skipped !== index) {
      index = skipped - 1;
      continue;
    }

    const char = source[index];
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth -= 1;
    } else if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']') {
      bracketDepth -= 1;
    } else if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
    } else if (
      char === ',' &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0
    ) {
      const entry = source.slice(start, index).trim();
      if (entry) {
        entries.push(entry);
      }
      start = index + 1;
    }
  }

  const finalEntry = source.slice(start).trim();
  if (finalEntry) {
    entries.push(finalEntry);
  }

  return entries;
}

function findTopLevelColon(source: string): number {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipSyntax(source, index);
    if (skipped !== index) {
      index = skipped - 1;
      continue;
    }

    const char = source[index];
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth -= 1;
    } else if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']') {
      bracketDepth -= 1;
    } else if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
    } else if (
      char === ':' &&
      braceDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0
    ) {
      return index;
    }
  }

  return -1;
}

function stripConstAssertion(source: string): string {
  return source
    .trim()
    .replace(/\s+as\s+const\s*$/u, '')
    .trim();
}

function unescapeSingleQuotedString(value: string): string {
  return value.replace(/\\(['"\\nrtbfv0])/gu, (_, sequence: string) => {
    switch (sequence) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case 'v':
        return '\v';
      case '0':
        return '\0';
      default:
        return sequence;
    }
  });
}

function parseLiteralString(source: string | undefined): string | undefined {
  if (source === undefined) {
    return undefined;
  }

  const trimmed = stripConstAssertion(source);
  const quote = trimmed[0];
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    return undefined;
  }

  if (quote === '`') {
    if (trimmed.includes('${')) {
      return undefined;
    }
    const close = trimmed.lastIndexOf('`');
    return close > 0
      ? trimmed.slice(1, close).replaceAll('\\`', '`')
      : undefined;
  }

  const close = trimmed.lastIndexOf(quote);
  if (close <= 0 || trimmed.slice(close + 1).trim() !== '') {
    return undefined;
  }

  const content = trimmed.slice(1, close);
  if (quote === '"') {
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }

  return unescapeSingleQuotedString(content);
}

function parseObjectKey(source: string): string | undefined {
  const trimmed = source.trim();
  const literal = parseLiteralString(trimmed);
  if (literal !== undefined) {
    return literal;
  }

  return /^[$A-Z_a-z][$\w]*$/u.test(trimmed) ? trimmed : undefined;
}

function parseObjectLiteral(
  source: string | undefined,
): ParsedObjectLiteral | undefined {
  if (source === undefined) {
    return undefined;
  }

  const block = getOuterBlock(source, '{', '}');
  if (!block) {
    return undefined;
  }

  const properties = new Map<string, string>();
  let hasSpread = false;

  for (const entry of splitTopLevelEntries(block.inner)) {
    if (entry.startsWith('...')) {
      hasSpread = true;
      continue;
    }

    const colon = findTopLevelColon(entry);
    if (colon === -1) {
      hasSpread = true;
      continue;
    }

    const key = parseObjectKey(entry.slice(0, colon));
    if (key === undefined) {
      hasSpread = true;
      continue;
    }

    properties.set(key, entry.slice(colon + 1).trim());
  }

  return { hasSpread, properties };
}

function parseArrayLiteral(source: string | undefined): string[] | undefined {
  if (source === undefined) {
    return undefined;
  }

  const block = getOuterBlock(source, '[', ']');
  if (!block) {
    return undefined;
  }

  const entries = splitTopLevelEntries(block.inner);
  const exposes: string[] = [];

  for (const entry of entries) {
    const expose = parseLiteralString(entry);
    if (expose === undefined) {
      return undefined;
    }
    exposes.push(expose);
  }

  return exposes;
}

function extractExposes(
  configPath: string,
  value: string | undefined,
): string[] {
  if (value === undefined) {
    return [];
  }

  const object = parseObjectLiteral(value);
  if (object) {
    if (object.hasSpread) {
      throw new Error(
        `Cannot statically extract Module Federation exposes from ${configPath}; use a literal exposes object without spreads.`,
      );
    }
    return Array.from(object.properties.keys()).sort();
  }

  const array = parseArrayLiteral(value);
  if (array) {
    return array.sort();
  }

  throw new Error(
    `Cannot statically extract Module Federation exposes from ${configPath}; use a literal exposes object or string array.`,
  );
}

function extractDtsSettings(
  configPath: string,
  value: string | undefined,
): ModuleFederationConfigInspection['dts'] {
  if (value === undefined) {
    return {};
  }

  const dts = parseObjectLiteral(value);
  if (!dts || dts.hasSpread) {
    throw new Error(
      `Cannot statically extract Module Federation DTS settings from ${configPath}; use a literal dts object.`,
    );
  }

  const generateTypes = parseObjectLiteral(dts.properties.get('generateTypes'));
  if (generateTypes?.hasSpread) {
    throw new Error(
      `Cannot statically extract Module Federation generateTypes settings from ${configPath}; use a literal generateTypes object.`,
    );
  }

  return {
    compilerInstance: parseLiteralString(
      generateTypes?.properties.get('compilerInstance'),
    ),
    tsConfigPath: parseLiteralString(dts.properties.get('tsConfigPath')),
  };
}

function hasHostOnlyNoExposesDeclaration(source: string): boolean {
  return /@?ultramodern-mf\s*:?\s*(?:host-only|no-exposes)\b/iu.test(source);
}

export function inspectModuleFederationConfigSource(
  source: string,
  appDir: string,
  configPath: string,
): ModuleFederationConfigInspection {
  const configObject =
    findCreateModuleFederationConfigObject(source) ??
    findExportDefaultObject(source);

  if (!configObject) {
    throw new Error(
      `Cannot statically inspect Module Federation config ${configPath}; export or pass a literal config object.`,
    );
  }

  const properties = parseObjectLiteral(configObject);
  if (!properties) {
    throw new Error(
      `Cannot statically inspect Module Federation config ${configPath}; expected a literal config object.`,
    );
  }

  if (properties.hasSpread) {
    throw new Error(
      `Cannot statically inspect Module Federation config ${configPath}; top-level config spreads are not supported.`,
    );
  }

  const exposes = extractExposes(
    configPath,
    properties.properties.get('exposes'),
  );
  const hostOnlyNoExposes = hasHostOnlyNoExposesDeclaration(source);

  if (hostOnlyNoExposes && exposes.length > 0) {
    throw new Error(
      `Module Federation host-only/no-exposes declaration conflicts with actual exposes in ${configPath}.`,
    );
  }

  return {
    appDir,
    configPath,
    dts: extractDtsSettings(configPath, properties.properties.get('dts')),
    exposes,
    hostOnlyNoExposes,
  };
}

function assertExposedAppDtsSettings(app: ModuleFederationConfigInspection) {
  if (app.dts.compilerInstance !== 'tsgo') {
    throw new Error(
      `Module Federation DTS compilerInstance must be "tsgo" for ${app.appDir}.`,
    );
  }

  if (app.dts.tsConfigPath !== './tsconfig.mf-types.json') {
    throw new Error(
      `Module Federation DTS tsConfigPath must be "./tsconfig.mf-types.json" for ${app.appDir}.`,
    );
  }
}

function assertTypesArchive(workspaceRoot: string, appDir: string) {
  const typesArchivePath = path.join(workspaceRoot, appDir, mfTypesArchive);
  if (!fs.existsSync(typesArchivePath)) {
    throw new Error(
      `Missing Module Federation DTS archive: ${relativePath(
        workspaceRoot,
        typesArchivePath,
      )}`,
    );
  }

  if (fs.statSync(typesArchivePath).size === 0) {
    throw new Error(
      `Empty Module Federation DTS archive: ${relativePath(
        workspaceRoot,
        typesArchivePath,
      )}`,
    );
  }
}

export function validateModuleFederationTypes(
  options: ModuleFederationValidationOptions,
): ModuleFederationValidationResult {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const discoveredConfigs = discoverModuleFederationConfigs({
    ...options,
    workspaceRoot,
  });
  const apps: ModuleFederationConfigInspection[] = [];
  const missingConfigPaths: string[] = [];

  for (const discoveredConfig of discoveredConfigs) {
    if (!fs.existsSync(discoveredConfig.configPath)) {
      missingConfigPaths.push(
        relativePath(workspaceRoot, discoveredConfig.configPath),
      );
      continue;
    }

    const configPath = relativePath(workspaceRoot, discoveredConfig.configPath);
    apps.push(
      inspectModuleFederationConfigSource(
        fs.readFileSync(discoveredConfig.configPath, 'utf-8'),
        discoveredConfig.appDir,
        configPath,
      ),
    );
  }

  if (missingConfigPaths.length > 0) {
    throw new Error(
      `Missing Module Federation config: ${missingConfigPaths.join(', ')}`,
    );
  }

  const noExposeApps = apps.filter(
    app => app.exposes.length === 0 && !app.hostOnlyNoExposes,
  );
  if (noExposeApps.length > 0) {
    const suffix =
      apps.filter(app => app.exposes.length > 0).length === 0
        ? ' Validation would otherwise validate zero exposed apps.'
        : '';
    throw new Error(
      `Module Federation configs declare no exposes without an explicit host-only/no-exposes declaration: ${noExposeApps
        .map(app => app.appDir)
        .join(', ')}.${suffix}`,
    );
  }

  let exposedAppCount = 0;
  let hostOnlyAppCount = 0;

  for (const app of apps) {
    if (app.hostOnlyNoExposes) {
      hostOnlyAppCount += 1;
      continue;
    }

    assertExposedAppDtsSettings(app);
    assertTypesArchive(workspaceRoot, app.appDir);
    exposedAppCount += 1;
  }

  if (
    apps.length > 0 &&
    exposedAppCount === 0 &&
    hostOnlyAppCount !== apps.length
  ) {
    throw new Error(
      'Module Federation validation inspected configs but validated zero exposed apps. Declare host-only/no-exposes intent only for host apps without exposes.',
    );
  }

  return {
    apps,
    configCount: apps.length,
    exposedAppCount,
    hostOnlyAppCount,
  };
}
