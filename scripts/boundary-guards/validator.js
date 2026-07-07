const fs = require('fs');
const path = require('path');
const { ensureSchemaVersion, readJsonFile } = require('../lib/validation-kit');

const SCHEMA_VERSION = 1;
const DEFAULT_SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.turbo',
  '.nx',
  'node_modules',
  'dist',
  'lib',
  'build',
  'coverage',
]);

const toRegex = pattern => {
  try {
    return new RegExp(pattern);
  } catch (error) {
    throw new Error(`Invalid regex pattern "${pattern}": ${error.message}`);
  }
};

const walkFiles = (targetPath, extensions) => {
  const resolvedPath = path.resolve(targetPath);
  if (!fs.existsSync(resolvedPath)) {
    return [];
  }
  const stat = fs.statSync(resolvedPath);
  if (stat.isFile()) {
    return extensions.includes(path.extname(resolvedPath))
      ? [resolvedPath]
      : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  const files = [];
  const queue = [resolvedPath];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.forEach(entry => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) {
          queue.push(fullPath);
        }
        return;
      }

      if (extensions.includes(path.extname(entry.name))) {
        files.push(fullPath);
      }
    });
  }

  return files;
};

const extractImportSpecifiers = content => {
  const specifiers = [];
  const pattern =
    /\bimport\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)|\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;
  let match = pattern.exec(content);
  while (match) {
    const value = match[1] || match[2] || match[3] || match[4];
    if (value) {
      specifiers.push(value);
    }
    match = pattern.exec(content);
  }
  return specifiers;
};

const validateProfileShape = profile => {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Boundary guard profile must be a JSON object');
  }

  ensureSchemaVersion({
    actual: profile.schemaVersion,
    expected: SCHEMA_VERSION,
    label: 'boundary guard profile',
  });

  if (!Array.isArray(profile.importGuards)) {
    throw new Error('Boundary guard profile importGuards must be an array');
  }

  profile.importGuards.forEach((guard, index) => {
    if (!guard || typeof guard !== 'object') {
      throw new Error(`importGuards[${String(index)}] must be an object`);
    }
    if (typeof guard.id !== 'string' || guard.id.trim() === '') {
      throw new Error(`importGuards[${String(index)}].id must be non-empty`);
    }
    if (!Array.isArray(guard.roots)) {
      throw new Error(`importGuards[${String(index)}].roots must be an array`);
    }
    if (!Array.isArray(guard.bannedImportPatterns)) {
      throw new Error(
        `importGuards[${String(index)}].bannedImportPatterns must be an array`,
      );
    }
  });

  if (!Array.isArray(profile.requiredSnippets)) {
    throw new Error('Boundary guard profile requiredSnippets must be an array');
  }

  profile.requiredSnippets.forEach((check, index) => {
    if (!check || typeof check !== 'object') {
      throw new Error(`requiredSnippets[${String(index)}] must be an object`);
    }
    if (typeof check.id !== 'string' || check.id.trim() === '') {
      throw new Error(
        `requiredSnippets[${String(index)}].id must be non-empty`,
      );
    }
    if (typeof check.path !== 'string' || check.path.trim() === '') {
      throw new Error(
        `requiredSnippets[${String(index)}].path must be non-empty`,
      );
    }
    if (!Array.isArray(check.includes)) {
      throw new Error(
        `requiredSnippets[${String(index)}].includes must be an array`,
      );
    }
    if (check.orderedIncludes && !Array.isArray(check.orderedIncludes)) {
      throw new Error(
        `requiredSnippets[${String(index)}].orderedIncludes must be an array`,
      );
    }
  });
};

const validateImportGuards = ({
  importGuards,
  rootDir,
  scanExtensions = DEFAULT_SCAN_EXTENSIONS,
}) => {
  const violations = [];
  const inspectedFiles = [];

  importGuards.forEach(guard => {
    const patterns = guard.bannedImportPatterns.map(toRegex);
    guard.roots.forEach(rootPath => {
      const resolvedRoot = path.resolve(rootDir, rootPath);
      if (!fs.existsSync(resolvedRoot)) {
        violations.push({
          type: 'import-guard-config',
          guardId: guard.id,
          message: `Configured root does not exist: ${resolvedRoot}`,
        });
        return;
      }

      const files = walkFiles(resolvedRoot, scanExtensions);
      files.forEach(filePath => {
        inspectedFiles.push(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        const imports = extractImportSpecifiers(content);
        imports.forEach(specifier => {
          patterns.forEach((pattern, patternIndex) => {
            if (pattern.test(specifier)) {
              violations.push({
                type: 'import-guard',
                guardId: guard.id,
                filePath,
                specifier,
                pattern: guard.bannedImportPatterns[patternIndex],
                message: `Import "${specifier}" matches banned pattern "${guard.bannedImportPatterns[patternIndex]}"`,
              });
            }
          });
        });
      });
    });
  });

  return {
    inspectedFiles: inspectedFiles.length,
    violations,
  };
};

const validateRequiredSnippets = ({ requiredSnippets, rootDir }) => {
  const validations = [];
  const violations = [];

  requiredSnippets.forEach(check => {
    const targetPath = path.resolve(rootDir, check.path);
    if (!fs.existsSync(targetPath)) {
      violations.push({
        type: 'required-snippet',
        checkId: check.id,
        filePath: targetPath,
        message: 'Target file does not exist',
      });
      return;
    }

    const content = fs.readFileSync(targetPath, 'utf8');
    check.includes.forEach(snippet => {
      if (!content.includes(snippet)) {
        violations.push({
          type: 'required-snippet',
          checkId: check.id,
          filePath: targetPath,
          snippet,
          message: `Missing required snippet "${snippet}"`,
        });
      }
    });

    let ordered = true;
    if (
      Array.isArray(check.orderedIncludes) &&
      check.orderedIncludes.length > 0
    ) {
      let previousIndex = -1;
      check.orderedIncludes.forEach(snippet => {
        const index = content.indexOf(snippet);
        if (index === -1) {
          ordered = false;
          violations.push({
            type: 'required-snippet-order',
            checkId: check.id,
            filePath: targetPath,
            snippet,
            message: `Missing ordered snippet "${snippet}"`,
          });
          return;
        }
        if (index < previousIndex) {
          ordered = false;
          violations.push({
            type: 'required-snippet-order',
            checkId: check.id,
            filePath: targetPath,
            snippet,
            message: `Snippet "${snippet}" appears out of required order`,
          });
        }
        previousIndex = index;
      });
    }

    validations.push({
      id: check.id,
      path: check.path,
      ordered,
    });
  });

  return {
    validations,
    violations,
  };
};

const flattenViolations = sections =>
  sections.flatMap(section =>
    section.violations.map(violation => ({
      ...violation,
      section: section.section,
    })),
  );

const formatViolations = violations =>
  violations
    .map(violation => {
      const location =
        violation.filePath ||
        violation.manifestPath ||
        violation.guardId ||
        'n/a';
      return `- [${violation.section}] ${violation.message} (${location})`;
    })
    .join('\n');

const runBoundaryGuardChecks = ({ profilePath, rootDir = process.cwd() }) => {
  const resolvedProfilePath = path.resolve(profilePath);
  const profile = readJsonFile(resolvedProfilePath);
  validateProfileShape(profile);

  const scanExtensions = Array.isArray(profile.scanExtensions)
    ? profile.scanExtensions
    : DEFAULT_SCAN_EXTENSIONS;

  const importGuardReport = validateImportGuards({
    importGuards: profile.importGuards,
    rootDir,
    scanExtensions,
  });
  const requiredSnippetReport = validateRequiredSnippets({
    requiredSnippets: profile.requiredSnippets,
    rootDir,
  });

  const allViolations = flattenViolations([
    { section: 'import-guards', violations: importGuardReport.violations },
    {
      section: 'required-snippets',
      violations: requiredSnippetReport.violations,
    },
  ]);
  if (allViolations.length > 0) {
    throw new Error(
      `Boundary anti-pattern checks failed with ${String(
        allViolations.length,
      )} violation(s):\n${formatViolations(allViolations)}`,
    );
  }

  return {
    profilePath: resolvedProfilePath,
    importGuardFilesScanned: importGuardReport.inspectedFiles,
    requiredSnippetChecks: requiredSnippetReport.validations.length,
  };
};

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_SCAN_EXTENSIONS,
  extractImportSpecifiers,
  runBoundaryGuardChecks,
  validateImportGuards,
  validateProfileShape,
  validateRequiredSnippets,
  walkFiles,
};
