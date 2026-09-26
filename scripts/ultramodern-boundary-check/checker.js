const fs = require('fs');
const path = require('path');
const { parseSync, types: babelTypes } = require('@babel/core');

const { extractImportSpecifiers } = require('../boundary-guards/validator');
const { createRepositoryGitEnv, runCommand } = require('../lib/process-kit');
const {
  buildProvenanceOwnership,
  parseNameStatus,
  resolveCommitSha,
  resolveRepositoryTopLevel,
} = require('./divergence');

const DEFAULT_BASE_REF = '8a744c1b3178d1e85d4113f29e8837ff94079fb3';
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
  const result = runCommand('git', ['--literal-pathspecs', ...args], {
    env: createRepositoryGitEnv(),
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const status = result.processStatus;

  if (result.error) {
    throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`);
  }
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

const listPackageSourceFiles = (rootDir, headRef) => {
  const result = runGit({
    rootDir,
    args: headRef
      ? ['ls-tree', '-r', '--name-only', '-z', headRef, '--', 'packages']
      : ['ls-files', '-z', '--', 'packages'],
  });

  return result.stdout
    .split('\0')
    .filter(Boolean)
    .map(toPosixPath)
    .filter(file => SOURCE_FILE_PATTERN.test(file))
    .filter(file => headRef || fs.existsSync(path.join(rootDir, file)))
    .sort();
};

const listUpstreamOwnedPackageSourceFiles = ({
  rootDir,
  baseRef = DEFAULT_BASE_REF,
  files,
  headRef,
}) => {
  const resolvedBase = resolveCommitSha({ rootDir, ref: baseRef });
  if (!resolvedBase) {
    throw new Error(
      `Import ownership base ${String(baseRef)} does not resolve to a commit.`,
    );
  }
  const candidateFiles = files ?? listPackageSourceFiles(rootDir, headRef);
  // Reuse divergence's immutable identity projection. A rename cannot turn an
  // existing native source into a fork-owned source by changing its filename.
  const { ownership } = buildProvenanceOwnership({
    rootDir,
    auditedBaseRef: resolvedBase,
    upstreamRef: headRef ?? 'HEAD',
    pathspec: ['packages'],
  });
  const ownedFiles = new Set(listPackageSourceFiles(rootDir, resolvedBase));
  if (!headRef) {
    const changes = runGit({
      rootDir,
      args: ['diff', '--name-status', '-z', '-M', 'HEAD', '--', 'packages'],
    }).stdout;
    for (const { status, oldPath, newPath } of parseNameStatus(changes)) {
      if (status.startsWith('R') && ownership.has(oldPath)) {
        ownership.set(newPath, ownership.get(oldPath));
      }
    }
  }
  return candidateFiles.filter(file => ownedFiles.has(ownership.get(file)));
};

const findDenylistMatches = ({ specifier, denylist = DEFAULT_DENYLIST }) => {
  const normalizedSpecifier = specifier.toLowerCase();

  return denylist.filter(marker =>
    normalizedSpecifier.includes(marker.toLowerCase()),
  );
};

const NATIVE_REQUEST_PACKAGE = 'packages/server/create-request';
const NATIVE_REQUEST_SPECIFIER = '@modern-js/create-request';
const NATIVE_REQUEST_BINDINGS = new Set([
  'configure',
  'createRequest',
  'createUploader',
]);
const NATIVE_REQUEST_TYPES = new Set([
  'RequestOptions',
  'UploadOptions',
  'BFFRequestPayload',
  'Sender',
  'HttpMethodDecider',
  'RequestTarget',
  'RequestHeaders',
  'RequestFetcher',
  'RequestStartContext',
  'RequestHeadersContext',
  'RequestDispatchContext',
  'RequestHooks',
  'RequestCreatorOptions',
  'RequestCreator',
  'UploadCreatorOptions',
  'UploadCreator',
  'IOptions',
  'RequestClient',
]);
const RETIRED_REQUEST_POLICY_NAMES = new Set([
  'BFF_ENVELOPE_HEADER',
  'BFF_OPERATION_CONTEXT_HEADER',
  'BFF_OPERATION_CONTEXT_DETAIL_HEADER',
  'BFF_DEFAULT_PROTECTED_IDENTITY_HEADERS',
  'ResolveHeadersOptions',
  'ResolveHeaders',
  'AllowCrossOriginEnvelopeOptions',
  'AllowCrossOriginEnvelope',
  'TransportTarget',
  'RetryDecisionContext',
  'RetryBackoffOptions',
  'DegradedModeReason',
  'DegradedModeEvent',
  'TransportResilienceOptions',
  'IdentityBindingViolationReason',
  'IdentityBindingViolation',
  'DeriveIdentityHeadersOptions',
  'IdentityBindingOptions',
  'OperationContractViolationReason',
  'OperationContractViolation',
  'CrossProjectOperationContract',
  'CrossProjectPolicyViolationReason',
  'CrossProjectPolicyViolation',
  'OperationContractOptions',
  'OperationContextSource',
  'OperationContext',
  'CrossOriginEnvelopePolicyError',
  'IdentityBindingViolationError',
  'OperationContractViolationError',
  'ProducerClientNotInitializedError',
  'ProducerDomainNotConfiguredError',
  'requireEnvelope',
  'allowCrossOriginEnvelope',
  'resolveHeaders',
  'transport',
  'identityBinding',
  'operationContract',
  'operationContext',
  'traceparent',
  'policyCore',
  'requestContext',
]);

const parseSourceAst = (content, file) => {
  try {
    return parseSync(content, {
      filename: file,
      babelrc: false,
      configFile: false,
      sourceType: 'unambiguous',
      parserOpts: {
        plugins: ['typescript', ...(file.endsWith('x') ? ['jsx'] : [])],
      },
    });
  } catch {
    return null;
  }
};

const astName = node =>
  node?.type === 'Identifier'
    ? node.name
    : node?.type === 'StringLiteral'
      ? node.value
      : null;

const collectModuleReferences = ast => {
  const references = [];
  babelTypes.traverseFast(ast, node => {
    let source;
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    ) {
      if (!node.source) return;
      source = node.source;
    } else if (node.type === 'ImportExpression') {
      source = node.source;
    } else if (node.type === 'TSImportType') {
      source = node.argument;
    } else if (
      node.type === 'TSImportEqualsDeclaration' &&
      node.moduleReference.type === 'TSExternalModuleReference'
    ) {
      source = node.moduleReference.expression;
    } else if (
      node.type === 'CallExpression' &&
      (node.callee.type === 'Import' ||
        (node.callee.type === 'Identifier' && node.callee.name === 'require'))
    ) {
      source = node.arguments[0];
    } else {
      return;
    }
    references.push({
      node,
      specifier: source?.type === 'StringLiteral' ? source.value : null,
    });
  });
  return references;
};

const hasOnlyNativeRequestBindings = (content, file = 'index.ts') => {
  const ast = parseSourceAst(content, file);
  if (!ast) return false;
  const references = collectModuleReferences(ast).filter(
    reference => reference.specifier === NATIVE_REQUEST_SPECIFIER,
  );
  return (
    references.length > 0 &&
    references.every(({ node }) => {
      if (node.type === 'ImportDeclaration') {
        return (
          node.specifiers.length > 0 &&
          node.specifiers.every(
            specifier =>
              specifier.type === 'ImportSpecifier' &&
              NATIVE_REQUEST_BINDINGS.has(astName(specifier.imported)),
          )
        );
      }
      return (
        node.type === 'ExportNamedDeclaration' &&
        node.specifiers.length > 0 &&
        node.specifiers.every(
          specifier =>
            specifier.type === 'ExportSpecifier' &&
            NATIVE_REQUEST_BINDINGS.has(astName(specifier.local)),
        )
      );
    })
  );
};

const publicBindings = ast => {
  const bindings = [];
  const wildcardSources = [];
  for (const node of ast.program.body) {
    if (
      node.type === 'ExportDefaultDeclaration' ||
      node.type === 'TSExportAssignment'
    ) {
      return null;
    }
    if (node.type === 'ExportAllDeclaration') {
      wildcardSources.push(astName(node.source));
    }
    if (node.type !== 'ExportNamedDeclaration') continue;
    if (node.declaration) {
      const declaration = node.declaration;
      const typeOnly =
        declaration.type === 'TSTypeAliasDeclaration' ||
        declaration.type === 'TSInterfaceDeclaration';
      const names = typeOnly
        ? [declaration.id.name]
        : Object.keys(babelTypes.getBindingIdentifiers(declaration));
      if (names.length === 0) return null;
      bindings.push(...names.map(name => ({ name, typeOnly })));
    }
    for (const specifier of node.specifiers) {
      if (specifier.type !== 'ExportSpecifier') return null;
      bindings.push({
        name: astName(specifier.exported),
        typeOnly: node.exportKind === 'type' || specifier.exportKind === 'type',
      });
    }
  }
  return { bindings, wildcardSources };
};

const containsRetiredRequestPolicy = ast => {
  let found = false;
  babelTypes.traverseFast(ast, node => {
    if (
      node.type === 'Identifier' &&
      RETIRED_REQUEST_POLICY_NAMES.has(node.name)
    ) {
      found = true;
    }
    // Quoted/computed property keys are code, unlike unrelated string values.
    if (
      RETIRED_REQUEST_POLICY_NAMES.has(astName(node.key)) ||
      ((node.type === 'MemberExpression' ||
        node.type === 'OptionalMemberExpression') &&
        RETIRED_REQUEST_POLICY_NAMES.has(astName(node.property)))
    ) {
      found = true;
    }
  });
  return found;
};

const isRecord = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasKeys = (value, keys) =>
  isRecord(value) &&
  Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));

const stringLeaves = value => {
  if (typeof value === 'string') return [value];
  if (!isRecord(value) && !Array.isArray(value)) return [null];
  const children = Object.values(value);
  return children.length > 0 ? children.flatMap(stringLeaves) : [null];
};

const isNativeCreateRequestSurface = ({ manifest, sources }, native) => {
  if (!isRecord(manifest) || manifest.name !== NATIVE_REQUEST_SPECIFIER) {
    return false;
  }
  if (
    !hasKeys(manifest.exports, ['.', './client', './server']) ||
    !hasKeys(manifest.typesVersions, ['*']) ||
    !hasKeys(manifest.typesVersions['*'], ['.', 'client', 'server'])
  ) {
    return false;
  }
  const targets = [
    manifest.main,
    manifest.types,
    manifest['modern:source'],
    ...stringLeaves(manifest.exports),
    ...stringLeaves(manifest.typesVersions),
  ];
  if (
    targets.some(
      target =>
        typeof target !== 'string' ||
        !/^\.\/(?:src\/(?:node|browser)\.ts|dist\/(?:types\/(?:node|browser)\.d\.ts|(?:cjs|esm|esm-node)\/(?:node|browser)\.(?:js|mjs)))$/.test(
          target,
        ),
    )
  ) {
    return false;
  }
  for (const field of [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    if (
      manifest[field] !== undefined &&
      (!isRecord(manifest[field]) ||
        Object.entries(manifest[field]).some(
          ([name, range]) =>
            !native.dependencies.has(name) ||
            typeof range !== 'string' ||
            (range.includes(':') && !range.startsWith('workspace:')),
        ))
    ) {
      return false;
    }
  }
  if (
    !isRecord(sources) ||
    !['node.ts', 'browser.ts', 'types.ts'].every(file =>
      Object.hasOwn(sources, file),
    ) ||
    Object.keys(sources).some(file => !native.sources.has(file))
  ) {
    return false;
  }
  for (const [file, content] of Object.entries(sources)) {
    const ast = parseSourceAst(content, file);
    if (!ast || containsRetiredRequestPolicy(ast)) return false;
    for (const { specifier } of collectModuleReferences(ast)) {
      if (specifier === null) return false;
      if (findDenylistMatches({ specifier }).length > 0) return false;
      if (specifier.startsWith('.')) {
        const resolved = path.posix.normalize(
          path.posix.join(path.posix.dirname(file), specifier),
        );
        if (
          !Object.hasOwn(sources, resolved) &&
          !Object.hasOwn(sources, `${resolved}.ts`)
        ) {
          return false;
        }
      } else {
        const dependency = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0];
        if (
          !native.dependencies.has(dependency) &&
          specifier !== 'http' &&
          specifier !== 'node:http'
        ) {
          return false;
        }
      }
    }
    if (file === 'node.ts' || file === 'browser.ts') {
      const exports = publicBindings(ast);
      if (
        !exports ||
        exports.bindings.some(
          binding =>
            !NATIVE_REQUEST_BINDINGS.has(binding.name) &&
            binding.name !== 'createClient',
        ) ||
        [...NATIVE_REQUEST_BINDINGS].some(
          name =>
            !exports.bindings.some(
              binding => binding.name === name && !binding.typeOnly,
            ),
        ) ||
        exports.wildcardSources.some(source => source !== './types')
      ) {
        return false;
      }
    }
    if (file === 'types.ts') {
      const exports = publicBindings(ast);
      if (
        !exports ||
        exports.wildcardSources.length > 0 ||
        exports.bindings.some(
          binding =>
            !binding.typeOnly || !NATIVE_REQUEST_TYPES.has(binding.name),
        )
      ) {
        return false;
      }
    }
  }
  return true;
};

const readNativeRequestTarget = ({ rootDir, headRef }) => {
  const read = file =>
    headRef
      ? runGit({ rootDir, args: ['show', `${headRef}:${file}`] }).stdout
      : fs.readFileSync(path.join(rootDir, file), 'utf8');
  const manifest = JSON.parse(read(`${NATIVE_REQUEST_PACKAGE}/package.json`));
  const prefix = `${NATIVE_REQUEST_PACKAGE}/src/`;
  let files;
  if (headRef) {
    const tree = runGit({
      rootDir,
      args: ['ls-tree', '-r', '-z', headRef, '--', prefix],
    }).stdout;
    files = tree
      .split('\0')
      .filter(Boolean)
      .map(record => {
        const [metadata, file] = record.split('\t');
        if (
          !metadata.startsWith('100644 ') &&
          !metadata.startsWith('100755 ')
        ) {
          throw new Error('Native request source must be an ordinary file.');
        }
        return file;
      });
  } else {
    files = fs
      .readdirSync(path.join(rootDir, prefix), { recursive: true })
      .map(file => `${prefix}${toPosixPath(file)}`)
      .filter(file => {
        const stat = fs.lstatSync(path.join(rootDir, file));
        if (stat.isSymbolicLink()) {
          throw new Error('Native request source must not follow symlinks.');
        }
        return !stat.isDirectory();
      });
  }
  return {
    manifest,
    sources: Object.fromEntries(
      files.map(file => [file.slice(prefix.length), read(file)]),
    ),
  };
};

const isNativeCreateRequestPackage = ({ rootDir, baseRef, headRef }) => {
  try {
    const base = readNativeRequestTarget({ rootDir, headRef: baseRef });
    const dependencies = new Set(Object.keys(base.manifest.dependencies));
    for (const [file, content] of Object.entries(base.sources)) {
      const ast = parseSourceAst(content, file);
      if (!ast) return false;
      for (const { specifier } of collectModuleReferences(ast)) {
        if (specifier && !specifier.startsWith('.')) {
          const dependency = specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0];
          if (Object.hasOwn(base.manifest.devDependencies ?? {}, dependency))
            dependencies.add(dependency);
        }
      }
    }
    // Only the reviewed neutral factory/header extraction extends native source
    // identity; arbitrary new files never inherit a package-wide exemption.
    const native = {
      dependencies,
      sources: new Set([
        ...Object.keys(base.sources),
        'headers.ts',
        'requestFactory.ts',
      ]),
    };
    return (
      base.manifest.name === NATIVE_REQUEST_SPECIFIER &&
      isNativeCreateRequestSurface(
        readNativeRequestTarget({ rootDir, headRef }),
        native,
      )
    );
  } catch {
    // Incomplete, malformed or unreviewed targets retain the original marker.
    return false;
  }
};

const scanUpstreamOwnedForkImports = ({
  rootDir = process.cwd(),
  baseRef = DEFAULT_BASE_REF,
  denylist = DEFAULT_DENYLIST,
  files,
  headRef,
} = {}) => {
  rootDir = resolveRepositoryTopLevel({ rootDir });
  const targetRef = headRef ?? 'HEAD';
  const resolvedHead = resolveCommitSha({ rootDir, ref: targetRef });
  if (!resolvedHead) {
    throw new Error(
      `Import target ${String(targetRef)} does not resolve to a commit.`,
    );
  }
  const resolvedBase = resolveCommitSha({ rootDir, ref: baseRef });
  if (!resolvedBase) {
    throw new Error(
      `Import ownership base ${String(baseRef)} does not resolve to a commit.`,
    );
  }
  runGit({
    rootDir,
    args: ['merge-base', '--is-ancestor', resolvedBase, resolvedHead],
  });
  const upstreamOwnedFiles = listUpstreamOwnedPackageSourceFiles({
    rootDir,
    baseRef: resolvedBase,
    files,
    headRef: headRef === undefined ? undefined : resolvedHead,
  });
  const violations = [];
  let nativeRequestPackage;

  upstreamOwnedFiles.forEach(file => {
    const content =
      headRef === undefined
        ? fs.readFileSync(path.join(rootDir, file), 'utf8')
        : runGit({ rootDir, args: ['show', `${resolvedHead}:${file}`] }).stdout;
    const specifiers = [...new Set(extractImportSpecifiers(content))];

    specifiers.forEach(specifier => {
      let markers = findDenylistMatches({ specifier, denylist });
      if (
        specifier === NATIVE_REQUEST_SPECIFIER &&
        markers.includes('create-request') &&
        hasOnlyNativeRequestBindings(content, file)
      ) {
        nativeRequestPackage ??= isNativeCreateRequestPackage({
          rootDir,
          baseRef: resolvedBase,
          headRef: headRef === undefined ? undefined : resolvedHead,
        });
        if (nativeRequestPackage) {
          markers = markers.filter(marker => marker !== 'create-request');
        }
      }
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
    baseRef: resolvedBase,
    headRef: headRef === undefined ? null : resolvedHead,
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
  headRef,
} = {}) => {
  const current = scanUpstreamOwnedForkImports({
    rootDir,
    baseRef,
    denylist,
    files,
    headRef,
  });
  const allowlist = readAllowlist(allowlistPath);
  const recordedBase = resolveCommitSha({ rootDir, ref: allowlist.baseRef });
  if (!recordedBase || recordedBase !== current.baseRef) {
    throw new Error(
      'Import allowlist ownership base does not match the measured base.',
    );
  }
  const diff = diffViolations({
    currentViolations: current.violations,
    allowlistViolations: allowlist.violations,
  });

  return {
    baseRef: current.baseRef,
    headRef: current.headRef,
    allowlistPath,
    scannedFiles: current.scannedFiles,
    currentViolations: current.violations,
    allowlistViolations: allowlist.violations,
    added: diff.added,
    removed: diff.removed,
    ok: current.violations.length === 0,
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
    )} upstream-owned packages/**/src files at ${report.baseRef}; target=${report.headRef ?? 'worktree'}`,
    `[ultramodern-boundary] current=${String(
      report.currentViolations.length,
    )} allowlist=${String(report.allowlistViolations.length)} added=${String(
      report.added.length,
    )} removed=${String(report.removed.length)}`,
  ];

  if (report.currentViolations.length > 0) {
    lines.push(
      '',
      'Current upstream-owned imports of fork-only code (allowances do not permit edges):',
      ...report.currentViolations.map(formatViolation),
    );
  }

  if (report.removed.length > 0) {
    lines.push(
      '',
      'Allowlist entries no longer observed; shrink the snapshot when migrating:',
      ...report.removed.map(formatViolation),
    );
  }

  if (report.currentViolations.length === 0) {
    lines.push('', 'No current upstream-owned imports of fork-only code.');
  }

  return lines.join('\n');
};

module.exports = {
  ALLOWLIST_SCHEMA_VERSION,
  DEFAULT_ALLOWLIST_PATH,
  DEFAULT_BASE_REF,
  DEFAULT_DENYLIST,
  SOURCE_FILE_PATTERN,
  checkForkImportBoundary,
  createAllowlistSnapshot,
  diffViolations,
  findDenylistMatches,
  hasOnlyNativeRequestBindings,
  formatBoundaryReport,
  formatViolation,
  listPackageSourceFiles,
  listUpstreamOwnedPackageSourceFiles,
  isNativeCreateRequestPackage,
  readAllowlist,
  scanUpstreamOwnedForkImports,
  writeAllowlist,
};
