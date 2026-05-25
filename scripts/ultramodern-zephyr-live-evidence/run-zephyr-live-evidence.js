#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const SCRIPT_DIR = __dirname;
const SCHEMA_PATH = path.join(SCRIPT_DIR, 'evidence-bundle.schema.json');
const DEFAULT_EVIDENCE_PATH = path.join(
  SCRIPT_DIR,
  'evidence',
  'zephyr-live-evidence.json',
);

const TARGETS = [
  {
    id: 'remote-v1',
    role: 'remote',
    envPrefix: 'ZE_REMOTE_V1',
    configKey: 'remoteV1',
    defaultPath: 'apps/remotes/remote-commerce-v1',
    expectedUiMarker: 'commerce-ui-version:v1',
    expectedApiMarker: 'commerce-api-version:v1',
  },
  {
    id: 'remote-v2',
    role: 'remote',
    envPrefix: 'ZE_REMOTE_V2',
    configKey: 'remoteV2',
    defaultPath: 'apps/remotes/remote-commerce-v2',
    expectedUiMarker: 'commerce-ui-version:v2',
    expectedApiMarker: 'commerce-api-version:v2',
  },
  {
    id: 'shell',
    role: 'shell',
    envPrefix: 'ZE_SHELL',
    configKey: 'shell',
    defaultPath: 'apps/shell-super-app',
    expectedUiMarker: undefined,
    expectedApiMarker: undefined,
  },
];

const SECRET_KEY_PATTERN =
  /(token|secret|password|credential|authorization|cookie|session|email)/i;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readConfig(configPath) {
  if (!configPath) {
    return {};
  }
  return readJsonFile(path.resolve(configPath));
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function optionalString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getPathValue(source, keys) {
  let current = source;
  for (const key of keys) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function redact(value, key = '') {
  if (typeof value === 'string') {
    if (SECRET_KEY_PATTERN.test(key) && value.length > 0) {
      return '[REDACTED]';
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => redact(item, key));
  }

  if (!isRecord(value)) {
    return value;
  }

  const redacted = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    redacted[entryKey] = redact(entryValue, entryKey);
  }
  return redacted;
}

function createRequirement(id, status, message, details = {}) {
  return { id, status, message, ...details };
}

function requirementStatusForMode(mode) {
  return mode === 'live' ? 'blocked' : 'skipped';
}

function resolveCredentialState({ env, config }) {
  const serverToken = pickFirstString(
    env.ZE_SERVER_TOKEN,
    getPathValue(config, ['credentials', 'serverToken']),
  );
  const secretToken = pickFirstString(
    env.ZE_SECRET_TOKEN,
    getPathValue(config, ['credentials', 'secretToken']),
  );
  const userEmail = pickFirstString(
    env.ZE_USER_EMAIL,
    getPathValue(config, ['credentials', 'userEmail']),
  );

  return {
    hasServerToken: Boolean(serverToken),
    hasSecretToken: Boolean(secretToken),
    hasAnyToken: Boolean(serverToken || secretToken),
    hasUserEmail: Boolean(userEmail),
  };
}

function resolveEnvironmentSelector({ env, config }) {
  return pickFirstString(
    env.ZE_ENV,
    getPathValue(config, ['zephyr', 'environment']),
    config.environment,
  );
}

function resolveWorkspaceDir({ env, config }) {
  return pickFirstString(
    env.ZE_WORKSPACE_DIR,
    config.workspaceDir,
    '<generated-workspace>',
  );
}

function resolveTarget(target, { env, config, environmentSelector }) {
  const targetConfig =
    getPathValue(config, ['targets', target.configKey]) || {};
  const selectorConfig = targetConfig.selector || {};
  const selectorValue = pickFirstString(
    env[`${target.envPrefix}_SELECTOR`],
    selectorConfig.value,
    targetConfig.selector,
  );
  const selectorKind = pickFirstString(
    env[`${target.envPrefix}_SELECTOR_KIND`],
    selectorConfig.kind,
    selectorValue && selectorValue.includes('@') ? 'version-or-tag' : undefined,
  );

  return {
    id: target.id,
    role: target.role,
    appUid: optionalString(
      pickFirstString(env[`${target.envPrefix}_APP_UID`], targetConfig.appUid),
    ),
    packageName: optionalString(
      pickFirstString(
        env[`${target.envPrefix}_PACKAGE`],
        targetConfig.packageName,
      ),
    ),
    workspacePath: pickFirstString(
      env[`${target.envPrefix}_PATH`],
      targetConfig.workspacePath,
      target.defaultPath,
    ),
    selector: {
      value: optionalString(selectorValue),
      kind: optionalString(selectorKind),
      environment: optionalString(environmentSelector),
    },
    manifestUrl: optionalString(
      pickFirstString(
        env[`${target.envPrefix}_MANIFEST_URL`],
        targetConfig.manifestUrl,
      ),
    ),
    runtimeUrl: optionalString(
      pickFirstString(
        env[`${target.envPrefix}_RUNTIME_URL`],
        targetConfig.runtimeUrl,
      ),
    ),
    api: {
      url: optionalString(
        pickFirstString(
          env[`${target.envPrefix}_API_URL`],
          targetConfig.apiUrl,
          getPathValue(targetConfig, ['api', 'url']),
        ),
      ),
    },
    markers: {
      uiExpected: optionalString(
        pickFirstString(
          env[`${target.envPrefix}_UI_MARKER`],
          targetConfig.uiMarker,
          target.expectedUiMarker,
        ),
      ),
      apiExpected: optionalString(
        pickFirstString(
          env[`${target.envPrefix}_API_MARKER`],
          targetConfig.apiMarker,
          target.expectedApiMarker,
        ),
      ),
    },
    buildLogPath: optionalString(
      pickFirstString(
        env[`${target.envPrefix}_BUILD_LOG`],
        targetConfig.buildLogPath,
      ),
    ),
  };
}

function createCommandPlan({ workspaceDir, targets }) {
  return targets.map(target => {
    const cwd = path.join(workspaceDir, target.workspacePath);
    return {
      target: target.id,
      role: target.role,
      cwd,
      commands: [
        {
          lifecycle: 'install',
          command: `pnpm --dir ${JSON.stringify(workspaceDir)} install`,
        },
        {
          lifecycle: 'build',
          command: `pnpm --dir ${JSON.stringify(cwd)} build`,
        },
      ],
    };
  });
}

function validateInputs({
  mode,
  credentialState,
  environmentSelector,
  targets,
}) {
  const requirements = [];
  const missingStatus = requirementStatusForMode(mode);

  if (!environmentSelector) {
    requirements.push(
      createRequirement(
        'zephyr-environment-selector',
        missingStatus,
        'ZE_ENV or config.zephyr.environment is required to name the Zephyr environment selector.',
        { env: ['ZE_ENV'], config: ['zephyr.environment'] },
      ),
    );
  }

  if (!credentialState.hasAnyToken) {
    requirements.push(
      createRequirement(
        'zephyr-token',
        missingStatus,
        'Live Zephyr evidence requires ZE_SERVER_TOKEN or ZE_SECRET_TOKEN.',
        {
          envAnyOf: ['ZE_SERVER_TOKEN', 'ZE_SECRET_TOKEN'],
          configAnyOf: ['credentials.serverToken', 'credentials.secretToken'],
        },
      ),
    );
  }

  if (!credentialState.hasUserEmail) {
    requirements.push(
      createRequirement(
        'zephyr-user-email',
        missingStatus,
        'Live Zephyr evidence requires ZE_USER_EMAIL or credentials.userEmail.',
        { env: ['ZE_USER_EMAIL'], config: ['credentials.userEmail'] },
      ),
    );
  }

  for (const target of targets) {
    for (const field of ['appUid', 'selector', 'manifestUrl', 'runtimeUrl']) {
      const value =
        field === 'selector' ? target.selector.value : target[field];
      if (!value) {
        requirements.push(
          createRequirement(
            `${target.id}-${field}`,
            missingStatus,
            `${target.id} is missing ${field}; provide ${target.id} config or ${target.id.toUpperCase().replace(/-/g, '_')} environment variables.`,
            { target: target.id, field },
          ),
        );
      }
    }
    if (target.markers.apiExpected && !target.api.url) {
      requirements.push(
        createRequirement(
          `${target.id}-api-url`,
          missingStatus,
          `${target.id} is missing an API assertion URL for marker ${target.markers.apiExpected}.`,
          { target: target.id, field: 'api.url' },
        ),
      );
    }
  }

  return requirements;
}

function createSkippedAssertion({ target, type, reason }) {
  return {
    target: target.id,
    type,
    status: 'skipped',
    reason,
  };
}

function includesMarker(body, marker) {
  return (
    typeof marker === 'string' && marker.length > 0 && body.includes(marker)
  );
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url);
  const body = await response.text();
  return {
    ok: response.ok,
    statusCode: response.status,
    body,
  };
}

async function runLiveAssertions({ fetchImpl, targets }) {
  const assertions = [];
  for (const target of targets) {
    if (target.manifestUrl) {
      try {
        const response = await fetchText(fetchImpl, target.manifestUrl);
        assertions.push({
          target: target.id,
          type: 'manifest-url',
          url: target.manifestUrl,
          status: response.ok ? 'pass' : 'fail',
          statusCode: response.statusCode,
        });
      } catch (error) {
        assertions.push({
          target: target.id,
          type: 'manifest-url',
          url: target.manifestUrl,
          status: 'fail',
          error: error.message,
        });
      }
    }

    if (target.runtimeUrl && target.markers.uiExpected) {
      try {
        const response = await fetchText(fetchImpl, target.runtimeUrl);
        assertions.push({
          target: target.id,
          type: 'ui-marker',
          url: target.runtimeUrl,
          expectedMarker: target.markers.uiExpected,
          status:
            response.ok &&
            includesMarker(response.body, target.markers.uiExpected)
              ? 'pass'
              : 'fail',
          statusCode: response.statusCode,
        });
      } catch (error) {
        assertions.push({
          target: target.id,
          type: 'ui-marker',
          url: target.runtimeUrl,
          expectedMarker: target.markers.uiExpected,
          status: 'fail',
          error: error.message,
        });
      }
    } else {
      assertions.push(
        createSkippedAssertion({
          target,
          type: 'ui-marker',
          reason: target.markers.uiExpected
            ? 'runtime URL missing'
            : 'no expected UI marker configured for target',
        }),
      );
    }

    if (target.api.url && target.markers.apiExpected) {
      try {
        const response = await fetchText(fetchImpl, target.api.url);
        assertions.push({
          target: target.id,
          type: 'api-marker',
          url: target.api.url,
          expectedMarker: target.markers.apiExpected,
          status:
            response.ok &&
            includesMarker(response.body, target.markers.apiExpected)
              ? 'pass'
              : 'fail',
          statusCode: response.statusCode,
        });
      } catch (error) {
        assertions.push({
          target: target.id,
          type: 'api-marker',
          url: target.api.url,
          expectedMarker: target.markers.apiExpected,
          status: 'fail',
          error: error.message,
        });
      }
    } else {
      assertions.push(
        createSkippedAssertion({
          target,
          type: 'api-marker',
          reason: target.markers.apiExpected
            ? 'API URL missing'
            : 'no expected API marker configured for target',
        }),
      );
    }
  }
  return assertions;
}

function createDryRunAssertions(targets) {
  return targets.flatMap(target => [
    createSkippedAssertion({
      target,
      type: 'manifest-url',
      reason: 'dry-run mode does not fetch Zephyr URLs',
    }),
    createSkippedAssertion({
      target,
      type: 'ui-marker',
      reason: 'dry-run mode does not fetch runtime HTML',
    }),
    createSkippedAssertion({
      target,
      type: 'api-marker',
      reason: 'dry-run mode does not fetch API responses',
    }),
  ]);
}

function createSwitchingScenarios(targets) {
  const remoteV1 = targets.find(target => target.id === 'remote-v1');
  const remoteV2 = targets.find(target => target.id === 'remote-v2');
  const shell = targets.find(target => target.id === 'shell');
  return [remoteV1, remoteV2].filter(Boolean).map(remote => ({
    id: `shell-selects-${remote.id}`,
    shellAppUid: shell && shell.appUid,
    remoteAppUid: remote.appUid,
    selector: remote.selector,
    manifestUrl: remote.manifestUrl,
    runtimeUrl: shell && shell.runtimeUrl,
    expectedUiMarker: remote.markers.uiExpected,
    expectedApiMarker: remote.markers.apiExpected,
    assertionRule:
      'The shell pass requires UI and API markers from the same selected remote version.',
  }));
}

function computeStatus({ mode, requirements, assertions }) {
  if (requirements.some(requirement => requirement.status === 'blocked')) {
    return 'blocked';
  }
  if (assertions.some(assertion => assertion.status === 'fail')) {
    return 'fail';
  }
  return mode === 'live' ? 'pass' : 'dry-run';
}

async function createEvidenceBundle(options = {}) {
  const env = options.env || process.env;
  const mode = options.mode || 'dry-run';
  const config = options.config || {};
  const generatedAt = options.generatedAt || new Date().toISOString();
  const environmentSelector = resolveEnvironmentSelector({ env, config });
  const credentialState = resolveCredentialState({ env, config });
  const workspaceDir = resolveWorkspaceDir({ env, config });
  const targets = TARGETS.map(target =>
    resolveTarget(target, { env, config, environmentSelector }),
  );
  const requirements = validateInputs({
    mode,
    credentialState,
    environmentSelector,
    targets,
  });
  const hasBlockedRequirements = requirements.some(
    requirement => requirement.status === 'blocked',
  );
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let assertions;

  if (mode === 'live' && !hasBlockedRequirements) {
    if (typeof fetchImpl !== 'function') {
      assertions = [
        {
          type: 'runtime',
          status: 'fail',
          message: 'global fetch is not available in this Node runtime.',
        },
      ];
    } else {
      assertions = await runLiveAssertions({ fetchImpl, targets });
    }
  } else {
    assertions = createDryRunAssertions(targets);
  }

  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : DEFAULT_EVIDENCE_PATH;
  const bundle = {
    $schema: './evidence-bundle.schema.json',
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    mode,
    status: computeStatus({ mode, requirements, assertions }),
    evidencePath: outputPath,
    schemaPath: SCHEMA_PATH,
    docsEvidence: {
      officialModernJsPlugin: 'zephyr-modernjs-plugin',
      packageJsonDependencyKey: 'zephyr:dependencies',
      runtimeOverrideCapability:
        'Zephyr environment overrides can select remote versions, tags, or environments at runtime without rebuilding the host.',
      lifecycleCommandPolicy:
        'Use normal Modern.js lifecycle commands such as pnpm install and pnpm build; this harness does not invent zephyr:* lifecycle commands.',
    },
    safety: {
      optIn: true,
      credentialsRequiredForLive: true,
      secretsRedacted: true,
    },
    configuration: {
      environmentSelector,
      credentialPresence: credentialState,
      redactedConfig: redact(config),
      redactedEnv: redact({
        ZE_ENV: env.ZE_ENV,
        ZE_SERVER_TOKEN: env.ZE_SERVER_TOKEN,
        ZE_SECRET_TOKEN: env.ZE_SECRET_TOKEN,
        ZE_USER_EMAIL: env.ZE_USER_EMAIL,
      }),
    },
    requirements,
    commandPlan: createCommandPlan({ workspaceDir, targets }),
    zephyrDependencies: {
      packageJsonKey: 'zephyr:dependencies',
      selectorExamples: ['workspace:*', '@latest', '@1.2.3'],
      environmentOverrides:
        'Use Zephyr environment overrides to select remote versions, tags, or environments at runtime.',
    },
    targets,
    switchingScenarios: createSwitchingScenarios(targets),
    assertions,
  };

  return bundle;
}

function writeEvidenceBundle(bundle, outputPath = bundle.evidencePath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`);
  return outputPath;
}

function parseArgs(argv) {
  const parsed = {
    mode: 'dry-run',
    configPath: undefined,
    outputPath: undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--live') {
      parsed.mode = 'live';
    } else if (arg === '--dry-run') {
      parsed.mode = 'dry-run';
    } else if (arg === '--config') {
      parsed.configPath = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      parsed.outputPath = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/ultramodern-zephyr-live-evidence/run-zephyr-live-evidence.js [--dry-run|--live] [--config zephyr-evidence.json] [--out evidence.json]

Modes:
  --dry-run  Writes the command plan and skipped assertions without credentials or network access. This is the default.
  --live     Requires ZE_ENV, ZE_USER_EMAIL, ZE_SERVER_TOKEN or ZE_SECRET_TOKEN, app UIDs, selectors, manifest URLs, and runtime URLs.

Target env names:
  ZE_REMOTE_V1_APP_UID, ZE_REMOTE_V1_SELECTOR, ZE_REMOTE_V1_MANIFEST_URL, ZE_REMOTE_V1_RUNTIME_URL, ZE_REMOTE_V1_API_URL
  ZE_REMOTE_V2_APP_UID, ZE_REMOTE_V2_SELECTOR, ZE_REMOTE_V2_MANIFEST_URL, ZE_REMOTE_V2_RUNTIME_URL, ZE_REMOTE_V2_API_URL
  ZE_SHELL_APP_UID, ZE_SHELL_SELECTOR, ZE_SHELL_MANIFEST_URL, ZE_SHELL_RUNTIME_URL
`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const config = readConfig(args.configPath);
  const bundle = await createEvidenceBundle({
    mode: args.mode,
    config,
    outputPath: args.outputPath,
  });
  const outputPath = writeEvidenceBundle(bundle, bundle.evidencePath);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: bundle.status,
        mode: bundle.mode,
        evidencePath: outputPath,
        schemaPath: bundle.schemaPath,
      },
      null,
      2,
    )}\n`,
  );
  return bundle.status === 'fail' || bundle.status === 'blocked' ? 1 : 0;
}

if (require.main === module) {
  main().then(
    exitCode => {
      process.exitCode = exitCode;
    },
    error => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  DEFAULT_EVIDENCE_PATH,
  SCHEMA_PATH,
  createEvidenceBundle,
  parseArgs,
  redact,
  validateInputs,
  writeEvidenceBundle,
};
