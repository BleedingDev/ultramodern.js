const fs = require('fs');
const path = require('path');

const { extractImportSpecifiers } = require('../boundary-guards/validator');
const { runCommand } = require('../lib/process-kit');

const DEFAULT_BASE_REF = '8a744c1b';
const DEFAULT_ALLOWLIST_PATH = path.join(__dirname, 'allowlist.json');
const SOURCE_FILE_PATTERN =
  /^packages\/.+\/src\/.+\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;
const ALLOWLIST_SCHEMA_VERSION = 1;

const DEFAULT_DENYLIST = Object.freeze([
  '@modern-js/plugin-tanstack',
  '@modern-js/plugin-i18n',
  'create-request',
  'backend-federation',
  'runtime-extensions',
  'data-platform',
  'ultramodern',
  'micro-vertical',
  'superapp',
  'delivery-unit',
]);

const toPosixPath = value => value.split(path.sep).join('/');

const runGit = ({ rootDir, args, allowFailure = false }) => {
  const result = runCommand('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const status = result.processStatus;

  if (!allowFailure && status !== 0) {
    const stderr = result.stderr.trim();
    const suffix = stderr ? `: ${stderr}` : '';
    throw new Error(`git ${args.join(' ')} failed${suffix}`);
  }

  return {
    ...result,
    status,
  };
};

const normalizeViolation = violation => ({
  file: toPosixPath(violation.file),
  specifier: violation.specifier,
});

const violationKey = violation =>
  `${violation.file}\u0000${violation.specifier}`;

const sortViolationRecords = violations =>
  [...violations].sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.specifier.localeCompare(right.specifier),
  );

const listPackageSourceFiles = rootDir => {
  const result = runGit({
    rootDir,
    args: ['ls-files', '--', 'packages'],
  });

  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(toPosixPath)
    .filter(file => SOURCE_FILE_PATTERN.test(file))
    .filter(file => fs.existsSync(path.join(rootDir, file)))
    .sort();
};

const pathExistsAtRef = ({ rootDir, baseRef, file }) => {
  const result = runGit({
    rootDir,
    args: ['cat-file', '-e', `${baseRef}:${file}`],
    allowFailure: true,
  });

  return result.status === 0;
};

const listUpstreamOwnedPackageSourceFiles = ({
  rootDir,
  baseRef = DEFAULT_BASE_REF,
  files,
}) => {
  const candidateFiles = files ?? listPackageSourceFiles(rootDir);

  return candidateFiles.filter(file =>
    pathExistsAtRef({ rootDir, baseRef, file }),
  );
};

const findDenylistMatches = ({ specifier, denylist = DEFAULT_DENYLIST }) => {
  const normalizedSpecifier = specifier.toLowerCase();

  return denylist.filter(marker =>
    normalizedSpecifier.includes(marker.toLowerCase()),
  );
};

const scanUpstreamOwnedForkImports = ({
  rootDir = process.cwd(),
  baseRef = DEFAULT_BASE_REF,
  denylist = DEFAULT_DENYLIST,
  files,
} = {}) => {
  const upstreamOwnedFiles = listUpstreamOwnedPackageSourceFiles({
    rootDir,
    baseRef,
    files,
  });
  const violations = [];

  upstreamOwnedFiles.forEach(file => {
    const content = fs.readFileSync(path.join(rootDir, file), 'utf8');
    const specifiers = [...new Set(extractImportSpecifiers(content))];

    specifiers.forEach(specifier => {
      const markers = findDenylistMatches({ specifier, denylist });
      if (markers.length === 0) {
        return;
      }

      violations.push({
        file,
        specifier,
        markers,
      });
    });
  });

  return {
    scannedFiles: upstreamOwnedFiles.length,
    violations: sortViolationRecords(violations),
  };
};

const createAllowlistSnapshot = ({
  baseRef = DEFAULT_BASE_REF,
  denylist = DEFAULT_DENYLIST,
  violations,
}) => ({
  schemaVersion: ALLOWLIST_SCHEMA_VERSION,
  baseRef,
  migrationGoal:
    'Shrink this list as UltraModern-only imports move out of upstream-owned files.',
  denylist: [...denylist],
  violations: sortViolationRecords(violations).map(normalizeViolation),
});

const readAllowlist = allowlistPath => {
  if (!fs.existsSync(allowlistPath)) {
    throw new Error(`Allowlist does not exist: ${allowlistPath}`);
  }

  const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));

  if (allowlist.schemaVersion !== ALLOWLIST_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported allowlist schemaVersion ${String(
        allowlist.schemaVersion,
      )}; expected ${String(ALLOWLIST_SCHEMA_VERSION)}`,
    );
  }

  if (!Array.isArray(allowlist.violations)) {
    throw new Error('Allowlist violations must be an array');
  }

  return {
    ...allowlist,
    violations: sortViolationRecords(
      allowlist.violations.map(normalizeViolation),
    ),
  };
};

const writeAllowlist = ({
  rootDir = process.cwd(),
  baseRef = DEFAULT_BASE_REF,
  allowlistPath = DEFAULT_ALLOWLIST_PATH,
  denylist = DEFAULT_DENYLIST,
  files,
} = {}) => {
  const report = scanUpstreamOwnedForkImports({
    rootDir,
    baseRef,
    denylist,
    files,
  });
  const snapshot = createAllowlistSnapshot({
    baseRef,
    denylist,
    violations: report.violations,
  });

  fs.mkdirSync(path.dirname(allowlistPath), { recursive: true });
  fs.writeFileSync(
    allowlistPath,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  );

  return {
    ...report,
    allowlistPath,
  };
};

const diffViolations = ({ currentViolations, allowlistViolations }) => {
  const currentByKey = new Map(
    currentViolations.map(violation => [violationKey(violation), violation]),
  );
  const allowlistByKey = new Map(
    allowlistViolations.map(violation => [violationKey(violation), violation]),
  );

  return {
    added: sortViolationRecords(
      [...currentByKey.entries()]
        .filter(([key]) => !allowlistByKey.has(key))
        .map(([, violation]) => violation),
    ),
    removed: sortViolationRecords(
      [...allowlistByKey.entries()]
        .filter(([key]) => !currentByKey.has(key))
        .map(([, violation]) => violation),
    ),
  };
};

const checkForkImportBoundary = ({
  rootDir = process.cwd(),
  baseRef = DEFAULT_BASE_REF,
  allowlistPath = DEFAULT_ALLOWLIST_PATH,
  denylist = DEFAULT_DENYLIST,
  files,
} = {}) => {
  const current = scanUpstreamOwnedForkImports({
    rootDir,
    baseRef,
    denylist,
    files,
  });
  const allowlist = readAllowlist(allowlistPath);
  const diff = diffViolations({
    currentViolations: current.violations,
    allowlistViolations: allowlist.violations,
  });

  return {
    baseRef,
    allowlistPath,
    scannedFiles: current.scannedFiles,
    currentViolations: current.violations,
    allowlistViolations: allowlist.violations,
    added: diff.added,
    removed: diff.removed,
    ok: diff.added.length === 0,
  };
};

const formatViolation = violation => {
  const markers = violation.markers?.length
    ? ` [${violation.markers.join(', ')}]`
    : '';

  return `- ${violation.file} -> ${violation.specifier}${markers}`;
};

const formatBoundaryReport = report => {
  const lines = [
    `[ultramodern-boundary] checked ${String(
      report.scannedFiles,
    )} upstream-owned packages/**/src files at ${report.baseRef}`,
    `[ultramodern-boundary] current=${String(
      report.currentViolations.length,
    )} allowlist=${String(report.allowlistViolations.length)} added=${String(
      report.added.length,
    )} removed=${String(report.removed.length)}`,
  ];

  if (report.added.length > 0) {
    lines.push(
      '',
      'New upstream-owned imports of fork-only code:',
      ...report.added.map(formatViolation),
    );
  }

  if (report.removed.length > 0) {
    lines.push(
      '',
      'Allowlist entries no longer observed; shrink the snapshot when migrating:',
      ...report.removed.map(formatViolation),
    );
  }

  if (report.added.length === 0) {
    lines.push('', 'No new upstream-owned imports of fork-only code.');
  }

  return lines.join('\n');
};

module.exports = {
  ALLOWLIST_SCHEMA_VERSION,
  DEFAULT_ALLOWLIST_PATH,
  DEFAULT_BASE_REF,
  DEFAULT_DENYLIST,
  checkForkImportBoundary,
  createAllowlistSnapshot,
  diffViolations,
  findDenylistMatches,
  formatBoundaryReport,
  formatViolation,
  listPackageSourceFiles,
  listUpstreamOwnedPackageSourceFiles,
  pathExistsAtRef,
  readAllowlist,
  scanUpstreamOwnedForkImports,
  writeAllowlist,
};
