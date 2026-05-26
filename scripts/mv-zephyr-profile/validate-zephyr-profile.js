#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const PROFILE_NAME = 'zephyr-vanilla-modernjs';
const REQUIRED_FORBIDDEN_BOOT_HACKS = [
  'window_remote_overwrite',
  'document_write_remote_entry',
  'dynamic_script_remote_entry',
  'runtime_public_path_mutation',
  'post_build_manifest_rewrite',
];
const DEFAULT_SCAN_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
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

const isRecord = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readJsonFile = filePath => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const stripComments = content =>
  content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const normalizePathForReport = ({ rootDir, filePath }) =>
  path.relative(rootDir, filePath).replace(/\\/g, '/');

const walkFiles = ({ rootDir, extensions = DEFAULT_SCAN_EXTENSIONS }) => {
  const resolvedRoot = path.resolve(rootDir);
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`Source root does not exist: ${resolvedRoot}`);
  }

  const files = [];
  const queue = [resolvedRoot];
  while (queue.length > 0) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORED_DIRECTORIES.has(entry.name)) {
          queue.push(fullPath);
        }
        continue;
      }
      if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }
  return files.sort();
};

const addViolation = (violations, rule, message, details = {}) => {
  violations.push({
    rule,
    message,
    ...details,
  });
};

const validateWithZephyrPlacement = ({ configPath, content }) => {
  const violations = [];
  const source = stripComments(content);

  const officialPackagePattern =
    /(?:\bfrom\s+['"]zephyr-rspack-plugin['"]|\brequire\s*\(\s*['"]zephyr-rspack-plugin['"]\s*\))/;
  if (!officialPackagePattern.test(source)) {
    addViolation(
      violations,
      'with-zephyr-package',
      '`withZephyr` must come from the Zephyr Rspack plugin package.',
      { file: configPath },
    );
  }

  if (
    /(?:\bfrom\s+['"](?:@modern-js\/plugin-zephyr|zephyr-modernjs-plugin)['"]|\brequire\s*\(\s*['"](?:@modern-js\/plugin-zephyr|zephyr-modernjs-plugin)['"]\s*\))/.test(
      source,
    )
  ) {
    addViolation(
      violations,
      'with-zephyr-package',
      'Use zephyr-rspack-plugin for this profile; the Modern.js wrapper did not attach in live Rspack evidence.',
      { file: configPath },
    );
  }

  if (!/\bwithZephyr\s*\(/.test(source)) {
    addViolation(
      violations,
      'with-zephyr-placement',
      '`withZephyr()` must be applied through a Modern.js Rspack config bridge.',
      { file: configPath },
    );
    return violations;
  }

  const exportedWrapperPattern =
    /\b(?:export\s+default|module\.exports\s*=|exports\.default\s*=)\s*withZephyr\s*\(/;
  if (exportedWrapperPattern.test(source)) {
    addViolation(
      violations,
      'with-zephyr-placement',
      '`withZephyr()` must be applied through modifyRspackConfig, not as an exported config wrapper.',
      { file: configPath },
    );
  }

  const nestedPattern =
    /\b(?:appTools|moduleFederationPlugin|withModuleFederation|withHtml|withRuntime|withOutput)\s*\(\s*withZephyr\s*\(/;
  if (nestedPattern.test(source)) {
    addViolation(
      violations,
      'with-zephyr-placement',
      '`withZephyr()` must not be nested inside another Modern.js config helper.',
      { file: configPath },
    );
  }

  if (!/\bmodifyRspackConfig\s*\(/.test(source)) {
    addViolation(
      violations,
      'with-zephyr-placement',
      '`withZephyr()` must be applied inside `api.modifyRspackConfig`.',
      { file: configPath },
    );
  }

  if (!/\bdistPath\s*:\s*\{[\s\S]*?\bhtml\s*:\s*['"]\.\/['"]/.test(source)) {
    addViolation(
      violations,
      'modernjs-zephyr-config',
      'Modern.js output.distPath.html must be `./` for the Zephyr Modern.js profile.',
      { file: configPath },
    );
  }

  if (!/\boutputStructure\s*:\s*['"]flat['"]/.test(source)) {
    addViolation(
      violations,
      'modernjs-zephyr-config',
      'Modern.js html.outputStructure must be `flat` for the Zephyr Modern.js profile.',
      { file: configPath },
    );
  }

  if (!/\bmainEntryName\s*:\s*['"]index['"]/.test(source)) {
    addViolation(
      violations,
      'modernjs-zephyr-config',
      'Modern.js source.mainEntryName must be `index` for the Zephyr Modern.js profile.',
      { file: configPath },
    );
  }

  return violations;
};

const detectLine = (content, index) =>
  content.slice(0, index).split(/\r?\n/).length;

const validateSourceConstraints = ({ sourceRoot }) => {
  const rootDir = path.resolve(sourceRoot);
  const violations = [];
  const files = walkFiles({ rootDir });

  const urlLiteralPattern = /(['"`])https?:\/\/[^'"`\s)]+?\1/g;
  const bootHackPatterns = [
    {
      rule: 'forbidden-boot-hack',
      hack: 'window_remote_overwrite',
      pattern:
        /\bwindow\s*\.\s*(?:__FEDERATION__|__remotes__|__remoteScope__|remoteMap|remotes)\s*=/g,
    },
    {
      rule: 'forbidden-boot-hack',
      hack: 'document_write_remote_entry',
      pattern: /\bdocument\s*\.\s*write\s*\(/g,
    },
    {
      rule: 'forbidden-boot-hack',
      hack: 'dynamic_script_remote_entry',
      pattern:
        /\bdocument\s*\.\s*createElement\s*\(\s*['"]script['"]\s*\)[\s\S]{0,400}\bremoteEntry\b/g,
    },
    {
      rule: 'forbidden-boot-hack',
      hack: 'runtime_public_path_mutation',
      pattern: /\b(?:__webpack_public_path__|__modernjs_public_path__)\s*=/g,
    },
    {
      rule: 'forbidden-boot-hack',
      hack: 'post_build_manifest_rewrite',
      pattern:
        /\b(?:writeFileSync|writeFile|appendFileSync|appendFile)\s*\([\s\S]{0,240}\b(?:mf-manifest\.json|remoteEntry[^'"`]*\.js)\b/g,
    },
  ];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const reportPath = normalizePathForReport({ rootDir, filePath });
    let match = urlLiteralPattern.exec(content);
    while (match) {
      addViolation(
        violations,
        'hardcoded-url',
        'Source must resolve remote and service URLs through the topology manifest.',
        {
          file: reportPath,
          line: detectLine(content, match.index),
          value: match[0].slice(1, -1),
        },
      );
      match = urlLiteralPattern.exec(content);
    }

    for (const bootHack of bootHackPatterns) {
      bootHack.pattern.lastIndex = 0;
      let bootMatch = bootHack.pattern.exec(content);
      while (bootMatch) {
        addViolation(
          violations,
          bootHack.rule,
          `Forbidden Zephyr boot hack detected: ${bootHack.hack}.`,
          {
            file: reportPath,
            line: detectLine(content, bootMatch.index),
            hack: bootHack.hack,
          },
        );
        bootMatch = bootHack.pattern.exec(content);
      }
    }
  }

  return {
    scannedFiles: files.map(filePath =>
      normalizePathForReport({ rootDir, filePath }),
    ),
    violations,
  };
};

const assertRequiredTrue = ({ object, fields, context, violations }) => {
  for (const field of fields) {
    if (object?.[field] !== true) {
      addViolation(
        violations,
        'profile-constraint',
        `${context}.${field} must be true for ${PROFILE_NAME}.`,
      );
    }
  }
};

const validateProfileConstraints = topologyManifest => {
  const violations = [];
  const profile = topologyManifest.profile;
  if (!isRecord(profile)) {
    addViolation(
      violations,
      'profile-shape',
      'Topology manifest is missing profile metadata.',
    );
    return violations;
  }

  if (profile.name !== PROFILE_NAME) {
    addViolation(
      violations,
      'profile-shape',
      `profile.name must be ${PROFILE_NAME}.`,
    );
  }
  if (profile.runtime !== 'modern-js') {
    addViolation(
      violations,
      'profile-shape',
      'profile.runtime must be modern-js.',
    );
  }
  if (profile.deliveryProvider !== 'zephyr') {
    addViolation(
      violations,
      'profile-shape',
      'profile.deliveryProvider must be zephyr.',
    );
  }

  const constraints = profile.constraints;
  if (!isRecord(constraints)) {
    addViolation(
      violations,
      'profile-shape',
      'profile.constraints must be an object.',
    );
    return violations;
  }
  if (
    constraints.withZephyrPlacement !== 'modern-config-rspack-bridge-plugin'
  ) {
    addViolation(
      violations,
      'profile-constraint',
      'profile.constraints.withZephyrPlacement must be modern-config-rspack-bridge-plugin.',
    );
  }

  assertRequiredTrue({
    object: constraints.output,
    fields: [
      'noRuntimePublicPathMutation',
      'preserveMfManifest',
      'preserveRemoteEntry',
    ],
    context: 'profile.constraints.output',
    violations,
  });
  assertRequiredTrue({
    object: constraints.html,
    fields: [
      'noAdHocRemoteScriptInjection',
      'noInlineRemoteUrlTables',
      'preserveModernManifestInjection',
    ],
    context: 'profile.constraints.html',
    violations,
  });
  assertRequiredTrue({
    object: constraints.source,
    fields: [
      'noHardcodedRemoteUrls',
      'noDirectServiceBaseUrls',
      'remoteUrlsResolveThroughManifest',
      'serviceUrlsResolveThroughManifest',
    ],
    context: 'profile.constraints.source',
    violations,
  });

  const runtime = constraints.runtime;
  if (!Array.isArray(runtime?.forbiddenBootHacks)) {
    addViolation(
      violations,
      'profile-constraint',
      'profile.constraints.runtime.forbiddenBootHacks must list forbidden boot patterns.',
    );
  } else {
    for (const hack of REQUIRED_FORBIDDEN_BOOT_HACKS) {
      if (!runtime.forbiddenBootHacks.includes(hack)) {
        addViolation(
          violations,
          'profile-constraint',
          `profile.constraints.runtime.forbiddenBootHacks is missing ${hack}.`,
        );
      }
    }
  }
  if (runtime?.dynamicRemoteUrlSource !== 'zephyr-module-federation-manifest') {
    addViolation(
      violations,
      'dynamic-remote-url-source',
      'Dynamic remote URLs must come from Zephyr-published Module Federation manifests.',
    );
  }

  return violations;
};

const digestKey = digest =>
  isRecord(digest) ? `${digest.algorithm}:${digest.value}` : undefined;

const artifactEntries = topologyManifest => {
  const entries = [];
  for (const remote of topologyManifest.topology?.remotes || []) {
    entries.push({
      id: `${remote.id}:manifest`,
      ownerId: remote.id,
      artifact: remote.manifest,
    });
    entries.push({
      id: `${remote.id}:remoteEntry`,
      ownerId: remote.id,
      artifact: remote.remoteEntry,
    });
    if (remote.ssr?.serverEntry) {
      entries.push({
        id: `${remote.id}:ssr:serverEntry`,
        ownerId: remote.id,
        artifact: remote.ssr.serverEntry,
      });
    }
    if (remote.ssr?.clientEntry) {
      entries.push({
        id: `${remote.id}:ssr:clientEntry`,
        ownerId: remote.id,
        artifact: remote.ssr.clientEntry,
      });
    }
  }
  for (const service of topologyManifest.topology?.services || []) {
    if (service.operationManifest) {
      entries.push({
        id: `${service.id}:operationManifest`,
        ownerId: service.id,
        artifact: service.operationManifest,
      });
    }
  }
  return entries;
};

const validateArtifactTrust = topologyManifest => {
  const violations = [];
  for (const entry of artifactEntries(topologyManifest)) {
    const artifact = entry.artifact;
    if (!isRecord(artifact)) {
      addViolation(
        violations,
        'immutable-artifact',
        `${entry.id} must be an artifact object.`,
      );
      continue;
    }
    if (artifact.immutable !== true) {
      addViolation(
        violations,
        'immutable-artifact',
        `${entry.id} must be immutable.`,
      );
    }
    if (!isRecord(artifact.digest)) {
      addViolation(
        violations,
        'immutable-artifact',
        `${entry.id} must include digest metadata.`,
      );
    }
    if (
      typeof artifact.integrity !== 'string' ||
      artifact.integrity.trim() === ''
    ) {
      addViolation(
        violations,
        'immutable-artifact',
        `${entry.id} must include integrity metadata.`,
      );
    }
  }
  return violations;
};

const indexById = items => {
  const result = new Map();
  for (const item of items || []) {
    if (typeof item?.id === 'string') {
      result.set(item.id, item);
    }
  }
  return result;
};

const validateEnvironmentOverlays = topologyManifest => {
  const violations = [];
  const environments = topologyManifest.environments;
  if (!isRecord(environments) || Object.keys(environments).length === 0) {
    addViolation(
      violations,
      'environment-overlay',
      'At least one environment overlay is required.',
    );
    return violations;
  }

  const remotesById = indexById(topologyManifest.topology?.remotes);
  const servicesById = indexById(topologyManifest.topology?.services);
  for (const [envName, overlay] of Object.entries(environments)) {
    if (!isRecord(overlay)) {
      addViolation(
        violations,
        'environment-overlay',
        `Environment ${envName} must be an object.`,
      );
      continue;
    }
    if (overlay.name !== envName) {
      addViolation(
        violations,
        'environment-overlay',
        `Environment overlay ${envName} must have matching name.`,
      );
    }

    for (const [remoteId, override] of Object.entries(
      overlay.remoteOverrides || {},
    )) {
      const baseRemote = remotesById.get(remoteId);
      if (!baseRemote) {
        addViolation(
          violations,
          'environment-overlay',
          `Remote override ${envName}.${remoteId} has no base remote.`,
        );
        continue;
      }
      if (!isRecord(override.digest)) {
        addViolation(
          violations,
          'environment-overlay',
          `Remote override ${envName}.${remoteId} must include digest.`,
        );
      }
      if (
        typeof override.integrity !== 'string' ||
        override.integrity.trim() === ''
      ) {
        addViolation(
          violations,
          'environment-overlay',
          `Remote override ${envName}.${remoteId} must include integrity.`,
        );
      }
      if (
        baseRemote.remoteEntry?.attestation &&
        !isRecord(override.attestation)
      ) {
        addViolation(
          violations,
          'environment-overlay',
          `Remote override ${envName}.${remoteId} must preserve attestation metadata.`,
        );
      }
      if (
        baseRemote.runtimeDigest &&
        typeof override.runtimeDigest !== 'string'
      ) {
        addViolation(
          violations,
          'environment-overlay',
          `Remote override ${envName}.${remoteId} must preserve runtime digest metadata.`,
        );
      }
    }

    for (const [serviceId, override] of Object.entries(
      overlay.serviceOverrides || {},
    )) {
      const baseService = servicesById.get(serviceId);
      if (!baseService) {
        addViolation(
          violations,
          'environment-overlay',
          `Service override ${envName}.${serviceId} has no base service.`,
        );
        continue;
      }
      if (baseService.digest && !isRecord(override.digest)) {
        addViolation(
          violations,
          'environment-overlay',
          `Service override ${envName}.${serviceId} must preserve digest metadata.`,
        );
      }
      if (baseService.attestation && !isRecord(override.attestation)) {
        addViolation(
          violations,
          'environment-overlay',
          `Service override ${envName}.${serviceId} must preserve attestation metadata.`,
        );
      }
    }
  }
  return violations;
};

const validateRollbackPolicies = topologyManifest => {
  const violations = [];
  const policies = topologyManifest.policies;
  if (!isRecord(policies)) {
    addViolation(
      violations,
      'rollback-policy',
      'Topology manifest is missing policies.',
    );
    return violations;
  }

  assertRequiredTrue({
    object: policies.urlIndirection,
    fields: [
      'shellStoresReferencesOnly',
      'remoteUrlsResolveThroughManifest',
      'serviceUrlsResolveThroughManifest',
      'immutableArtifactUrls',
    ],
    context: 'policies.urlIndirection',
    violations,
  });

  const lkg = policies.lkg;
  if (lkg?.enabled !== true) {
    addViolation(
      violations,
      'lkg-policy',
      'policies.lkg.enabled must be true.',
    );
  }
  if (!Number.isInteger(lkg?.maxAgeSeconds) || lkg.maxAgeSeconds <= 0) {
    addViolation(
      violations,
      'lkg-policy',
      'policies.lkg.maxAgeSeconds must be a positive integer.',
    );
  }
  if (typeof lkg?.storageKey !== 'string' || lkg.storageKey.trim() === '') {
    addViolation(
      violations,
      'lkg-policy',
      'policies.lkg.storageKey must be set.',
    );
  }
  const requiredFallbackOrder = [
    'current',
    'environment-overlay',
    'lkg',
    'csr-fallback',
  ];
  const fallbackOrder = Array.isArray(lkg?.fallbackOrder)
    ? lkg.fallbackOrder
    : [];
  if (requiredFallbackOrder.join('|') !== fallbackOrder.join('|')) {
    addViolation(
      violations,
      'lkg-policy',
      `policies.lkg.fallbackOrder must be ${requiredFallbackOrder.join(' -> ')}.`,
    );
  }

  const killSwitch = policies.killSwitch;
  if (killSwitch?.enabled !== true) {
    addViolation(
      violations,
      'kill-switch-policy',
      'policies.killSwitch.enabled must be true.',
    );
  }
  if (!Array.isArray(killSwitch?.hooks) || killSwitch.hooks.length === 0) {
    addViolation(
      violations,
      'kill-switch-policy',
      'policies.killSwitch.hooks must not be empty.',
    );
  } else {
    const targetRefs = new Set([
      ...(topologyManifest.topology?.shells || []).map(item => item.id),
      ...(topologyManifest.topology?.remotes || []).map(item => item.id),
      ...(topologyManifest.topology?.services || []).map(item => item.id),
    ]);
    for (const hook of killSwitch.hooks) {
      if (!targetRefs.has(hook.targetRef)) {
        addViolation(
          violations,
          'kill-switch-policy',
          `Kill-switch hook ${hook.id} targets unknown ref ${hook.targetRef}.`,
        );
      }
      if (hook.fallback?.telemetryRequired !== true) {
        addViolation(
          violations,
          'kill-switch-policy',
          `Kill-switch hook ${hook.id} must require fallback telemetry.`,
        );
      }
    }
  }

  if (!isRecord(policies.fallbackTelemetry)) {
    addViolation(
      violations,
      'fallback-telemetry',
      'policies.fallbackTelemetry is required for rollback paths.',
    );
  }

  return violations;
};

const validateRevocationPrecedence = topologyManifest => {
  const violations = [];
  const revocation = topologyManifest.policies?.revocation;
  if (revocation?.enabled !== true) {
    addViolation(
      violations,
      'revocation-precedence',
      'policies.revocation.enabled must be true.',
    );
    return violations;
  }
  const revokedArtifacts = Array.isArray(revocation.revokedArtifacts)
    ? revocation.revokedArtifacts
    : [];
  const revokedIds = new Set(revokedArtifacts.map(item => item.id));
  const revokedDigests = new Set(
    revokedArtifacts.map(item => digestKey(item.digest)).filter(Boolean),
  );

  const selectableRefs = [
    ...(topologyManifest.topology?.remotes || []).map(item => ({
      id: item.id,
      context: `remote ${item.id}`,
    })),
    ...(topologyManifest.topology?.services || []).map(item => ({
      id: item.id,
      context: `service ${item.id}`,
    })),
  ];
  for (const entry of artifactEntries(topologyManifest)) {
    selectableRefs.push({ id: entry.id, context: `artifact ${entry.id}` });
    const key = digestKey(entry.artifact?.digest);
    if (key && revokedDigests.has(key)) {
      addViolation(
        violations,
        'revocation-precedence',
        `Revoked digest is still selectable through ${entry.id}.`,
      );
    }
  }
  for (const selectable of selectableRefs) {
    if (revokedIds.has(selectable.id)) {
      addViolation(
        violations,
        'revocation-precedence',
        `Revoked ${selectable.context} is still selectable.`,
      );
    }
  }

  for (const revoked of revokedArtifacts) {
    if (revoked.replacementRef && revokedIds.has(revoked.replacementRef)) {
      addViolation(
        violations,
        'revocation-precedence',
        `Revocation replacement ${revoked.replacementRef} is also revoked.`,
      );
    }
  }

  return violations;
};

const validateTopologyReferences = topologyManifest => {
  const violations = [];
  const remoteIds = new Set(
    (topologyManifest.topology?.remotes || []).map(item => item.id),
  );
  const serviceIds = new Set(
    (topologyManifest.topology?.services || []).map(item => item.id),
  );

  for (const shell of topologyManifest.topology?.shells || []) {
    for (const remoteRef of shell.remoteRefs || []) {
      if (!remoteIds.has(remoteRef)) {
        addViolation(
          violations,
          'topology-reference',
          `Shell ${shell.id} references unknown remote ${remoteRef}.`,
        );
      }
    }
    for (const serviceRef of shell.serviceRefs || []) {
      if (!serviceIds.has(serviceRef)) {
        addViolation(
          violations,
          'topology-reference',
          `Shell ${shell.id} references unknown service ${serviceRef}.`,
        );
      }
    }
    for (const route of shell.routes || []) {
      if (route.kind === 'remote' && !remoteIds.has(route.owner)) {
        addViolation(
          violations,
          'topology-reference',
          `Shell ${shell.id} route ${route.path} references unknown remote owner ${route.owner}.`,
        );
      }
    }
  }

  return violations;
};

const validateTopologyManifest = topologyManifest => {
  const violations = [];
  if (!isRecord(topologyManifest)) {
    throw new Error('Topology manifest must be a JSON object.');
  }
  if (topologyManifest.schemaVersion !== SCHEMA_VERSION) {
    addViolation(
      violations,
      'manifest-shape',
      `Unsupported schemaVersion: ${String(topologyManifest.schemaVersion)}.`,
    );
  }

  violations.push(...validateProfileConstraints(topologyManifest));
  violations.push(...validateArtifactTrust(topologyManifest));
  violations.push(...validateEnvironmentOverlays(topologyManifest));
  violations.push(...validateRollbackPolicies(topologyManifest));
  violations.push(...validateRevocationPrecedence(topologyManifest));
  violations.push(...validateTopologyReferences(topologyManifest));

  return {
    passed: violations.length === 0,
    violations,
  };
};

const validateZephyrProfile = ({ configPath, sourceRoot, topologyPath }) => {
  const violations = [];
  let topologyReport = { passed: true, violations: [] };
  let sourceReport = { scannedFiles: [], violations: [] };

  if (configPath) {
    const resolvedConfigPath = path.resolve(configPath);
    const content = fs.readFileSync(resolvedConfigPath, 'utf8');
    violations.push(
      ...validateWithZephyrPlacement({
        configPath: resolvedConfigPath,
        content,
      }),
    );
  }

  if (sourceRoot) {
    sourceReport = validateSourceConstraints({ sourceRoot });
    violations.push(...sourceReport.violations);
  }

  if (topologyPath) {
    const resolvedTopologyPath = path.resolve(topologyPath);
    topologyReport = validateTopologyManifest(
      readJsonFile(resolvedTopologyPath),
    );
    violations.push(
      ...topologyReport.violations.map(violation => ({
        ...violation,
        file: violation.file || resolvedTopologyPath,
      })),
    );
  }

  return {
    passed: violations.length === 0,
    scannedFiles: sourceReport.scannedFiles,
    violations,
  };
};

const parseArgs = argv => {
  const parsed = {
    configPath: undefined,
    sourceRoot: undefined,
    topologyPath: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--config':
        parsed.configPath = argv[index + 1];
        index += 1;
        break;
      case '--source-root':
        parsed.sourceRoot = argv[index + 1];
        index += 1;
        break;
      case '--topology':
        parsed.topologyPath = argv[index + 1];
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.configPath && !parsed.sourceRoot && !parsed.topologyPath) {
    throw new Error(
      'Provide at least one of --config, --source-root, or --topology.',
    );
  }

  return parsed;
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const report = validateZephyrProfile(args);
  if (!report.passed) {
    const summary = report.violations
      .map(violation => `- ${violation.rule}: ${violation.message}`)
      .join('\n');
    throw new Error(`Zephyr profile validation failed:\n${summary}`);
  }

  console.log(
    `[zephyr-profile] validation passed:\n${JSON.stringify(
      {
        scannedFiles: report.scannedFiles.length,
      },
      null,
      2,
    )}`,
  );
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[zephyr-profile] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  PROFILE_NAME,
  REQUIRED_FORBIDDEN_BOOT_HACKS,
  SCHEMA_VERSION,
  readJsonFile,
  validateEnvironmentOverlays,
  validateProfileConstraints,
  validateRevocationPrecedence,
  validateRollbackPolicies,
  validateSourceConstraints,
  validateTopologyManifest,
  validateWithZephyrPlacement,
  validateZephyrProfile,
};
