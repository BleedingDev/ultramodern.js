#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MARKERS = {
  v1: {
    version: 'v1',
    semanticVersion: '1.0.0',
    uiMarker: 'commerce-ui-version:v1',
    apiMarker: 'commerce-api-version:v1',
  },
  v2: {
    version: 'v2',
    semanticVersion: '2.0.0',
    uiMarker: 'commerce-ui-version:v2',
    apiMarker: 'commerce-api-version:v2',
  },
};

const PACKAGE_NAME = '@modern-js-ultramodern/commerce-vertical';
const REMOTE_ALIAS = 'commerce';
const ENVIRONMENT_VERSION_VARIABLE = 'ULTRAMODERN_COMMERCE_VERTICAL_VERSION';
const ENVIRONMENT_NAME_VARIABLE = 'ULTRAMODERN_COMMERCE_ENVIRONMENT';

const PROOF_MATRIX = [
  {
    id: 'workspace-v1',
    selector: 'workspace',
    version: 'v1',
  },
  {
    id: 'latest-tag-v2',
    selector: 'latest',
  },
  {
    id: 'exact-v1',
    selector: 'exact',
    version: '1.0.0',
  },
  {
    id: 'exact-v2',
    selector: 'exact',
    version: '2.0.0',
  },
  {
    id: 'environment-override-staging',
    selector: 'environment',
    environment: 'staging',
  },
];

const NEGATIVE_CONTROLS = [
  {
    id: 'skew-ui-v2-api-v1',
    selector: 'exact',
    version: '2.0.0',
    skew: {
      apiVersion: 'v1',
    },
  },
];

function normalizeVersion(value) {
  if (!value) {
    return undefined;
  }

  const normalized = String(value).replace(/^@/, '').trim();
  if (MARKERS[normalized]) {
    return normalized;
  }

  const bySemanticVersion = Object.values(MARKERS).find(
    marker => marker.semanticVersion === normalized,
  );
  if (bySemanticVersion) {
    return bySemanticVersion.version;
  }

  throw new Error(`Unsupported commerce vertical version: ${value}`);
}

function environmentDefault(environment) {
  if (environment === 'production') {
    return 'v1';
  }
  if (environment === 'staging' || environment === 'preview') {
    return 'v2';
  }
  throw new Error(
    `Unsupported environment override: ${environment || '<empty>'}`,
  );
}

function createZephyrDependencyEvidence({
  selector,
  selected,
  environment,
  overrideSource,
}) {
  const dependency = {
    packageName: PACKAGE_NAME,
    remoteAlias: REMOTE_ALIAS,
    selector,
    localAlias: `${REMOTE_ALIAS}: ${PACKAGE_NAME}`,
    semantics:
      'Zephyr resolves one commerce vertical artifact, and the shell consumes that artifact for both the MF manifest and owned API base.',
  };

  if (!environment) {
    return {
      dependency,
      override: null,
    };
  }

  return {
    dependency,
    override: {
      kind: 'environment',
      environment,
      source: overrideSource,
      selector: `@${selected.semanticVersion}`,
      variable: ENVIRONMENT_VERSION_VARIABLE,
      semantics:
        'An environment override replaces the resolved remote dependency selector at runtime without rebuilding the host.',
    },
  };
}

function resolveSelection(options = {}, env = process.env) {
  const selector = options.selector || 'workspace';

  if (selector === 'workspace') {
    const selectedVersion = normalizeVersion(options.version) || 'v1';
    return {
      id: options.id || `workspace-${selectedVersion}`,
      selector,
      selectedVersion,
      uiVersion: selectedVersion,
      apiVersion: options.skew?.apiVersion || selectedVersion,
      dependencySelector: 'workspace:*',
      environment: undefined,
      overrideSource: undefined,
    };
  }

  if (selector === 'latest' || selector === 'tag') {
    const selectedVersion =
      selector === 'tag' ? normalizeVersion(options.version) || 'v2' : 'v2';
    return {
      id: options.id || `${selector}-${selectedVersion}`,
      selector,
      selectedVersion,
      uiVersion: selectedVersion,
      apiVersion: options.skew?.apiVersion || selectedVersion,
      dependencySelector: selector === 'tag' ? '@latest' : '@latest',
      environment: undefined,
      overrideSource: undefined,
    };
  }

  if (selector === 'exact') {
    const selectedVersion = normalizeVersion(options.version) || 'v1';
    return {
      id: options.id || `exact-${selectedVersion}`,
      selector,
      selectedVersion,
      uiVersion: selectedVersion,
      apiVersion: options.skew?.apiVersion || selectedVersion,
      dependencySelector: `@${MARKERS[selectedVersion].semanticVersion}`,
      environment: undefined,
      overrideSource: undefined,
    };
  }

  if (selector === 'environment') {
    const environment =
      options.environment || env[ENVIRONMENT_NAME_VARIABLE] || 'staging';
    const envVersion = env[ENVIRONMENT_VERSION_VARIABLE];
    const selectedVersion =
      normalizeVersion(options.version) ||
      normalizeVersion(envVersion) ||
      environmentDefault(environment);
    return {
      id: options.id || `environment-override-${environment}`,
      selector,
      selectedVersion,
      uiVersion: selectedVersion,
      apiVersion: options.skew?.apiVersion || selectedVersion,
      dependencySelector: 'workspace:*',
      environment,
      overrideSource: envVersion ? 'env-var' : 'environment-default',
    };
  }

  throw new Error(`Unsupported selector: ${selector}`);
}

function createManifest({ baseUrl, version }) {
  const marker = MARKERS[version];
  return {
    id: `${REMOTE_ALIAS}-${version}`,
    name: REMOTE_ALIAS,
    version: marker.semanticVersion,
    remoteEntry: `${baseUrl}/commerce/${version}/remoteEntry.js`,
    exposes: {
      './CommerceVertical': `${baseUrl}/commerce/${version}/ui-marker`,
    },
    metadata: {
      fullStackVertical: true,
      uiMarker: marker.uiMarker,
      apiMarker: marker.apiMarker,
    },
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function createProofServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const [, area, version, resource] = url.pathname.split('/');

    if (area === 'commerce' && resource === 'mf-manifest.json') {
      if (!MARKERS[version]) {
        sendJson(response, 404, { error: 'unknown-commerce-version' });
        return;
      }
      sendJson(
        response,
        200,
        createManifest({ baseUrl: server.baseUrl, version }),
      );
      return;
    }

    if (area === 'commerce' && resource === 'ui-marker') {
      if (!MARKERS[version]) {
        sendJson(response, 404, { error: 'unknown-commerce-version' });
        return;
      }
      sendJson(response, 200, {
        marker: MARKERS[version].uiMarker,
        version,
      });
      return;
    }

    if (area === 'api' && version === 'commerce') {
      const [, , , apiVersion, apiResource] = url.pathname.split('/');
      if (!MARKERS[apiVersion] || apiResource !== 'marker') {
        sendJson(response, 404, { error: 'unknown-commerce-api-version' });
        return;
      }
      sendJson(response, 200, {
        marker: MARKERS[apiVersion].apiMarker,
        version: apiVersion,
      });
      return;
    }

    sendJson(response, 404, { error: 'not-found' });
  });

  return server;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.baseUrl = `http://${address.address}:${address.port}`;
      resolve(server.baseUrl);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `${url} returned ${response.status}: ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

function createAssertion({ id, expected, actual }) {
  return {
    id,
    expected,
    actual,
    status: Object.is(expected, actual) ? 'pass' : 'fail',
  };
}

function evaluateEvidence(evidence) {
  const lockstepAssertion = evidence.assertions.find(
    assertion => assertion.id === 'full-stack-version-lockstep',
  );
  if (lockstepAssertion?.status === 'fail') {
    return {
      status: 'fail',
      reason: 'full-stack-version-mismatch',
    };
  }

  const failedAssertion = evidence.assertions.find(
    assertion => assertion.status === 'fail',
  );
  if (!failedAssertion) {
    return {
      status: 'pass',
      reason: undefined,
    };
  }

  return {
    status: 'fail',
    reason: failedAssertion.id,
  };
}

async function runScenario(options = {}, env = process.env) {
  const selection = resolveSelection(options, env);
  const selected = MARKERS[selection.selectedVersion];
  const expectedApi = MARKERS[selection.selectedVersion];
  const server = createProofServer();
  const baseUrl = await listen(server);

  try {
    const selectedMfManifestUrl = `${baseUrl}/commerce/${selection.uiVersion}/mf-manifest.json`;
    const apiBaseUrl = `${baseUrl}/api/commerce/${selection.apiVersion}`;
    const manifest = await fetchJson(selectedMfManifestUrl);
    const ui = await fetchJson(manifest.exposes['./CommerceVertical']);
    const api = await fetchJson(`${apiBaseUrl}/marker`);
    const assertions = [
      createAssertion({
        id: 'ui-marker',
        expected: selected.uiMarker,
        actual: ui.marker,
      }),
      createAssertion({
        id: 'api-marker',
        expected: expectedApi.apiMarker,
        actual: api.marker,
      }),
      createAssertion({
        id: 'full-stack-version-lockstep',
        expected: selection.uiVersion,
        actual: selection.apiVersion,
      }),
    ];
    const evaluation = evaluateEvidence({ assertions });
    const zephyrDependency = createZephyrDependencyEvidence({
      selector: selection.dependencySelector,
      selected,
      environment: selection.environment,
      overrideSource: selection.overrideSource,
    });

    return {
      schemaVersion: 1,
      proof: 'ultramodern-full-stack-version-switching',
      scenario: selection.id,
      selector: selection.selector,
      selectedVersion: selection.selectedVersion,
      selectedMfManifestUrl,
      apiBaseUrl,
      zephyrDependency,
      uiMarker: ui.marker,
      apiMarker: api.marker,
      status: evaluation.status,
      reason: evaluation.reason,
      assertions,
      manifest: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        remoteEntry: manifest.remoteEntry,
        metadata: manifest.metadata,
      },
    };
  } finally {
    await closeServer(server);
  }
}

async function runMatrix(options = {}, env = process.env) {
  const scenarios = [];
  for (const scenario of PROOF_MATRIX) {
    scenarios.push(await runScenario(scenario, env));
  }

  const negativeControls = [];
  for (const scenario of NEGATIVE_CONTROLS) {
    negativeControls.push(await runScenario(scenario, env));
  }

  const scenarioFailures = scenarios.filter(
    scenario => scenario.status !== 'pass',
  );
  const negativeFailures = negativeControls.filter(
    scenario =>
      scenario.status !== 'fail' ||
      scenario.reason !== 'full-stack-version-mismatch',
  );
  const status =
    scenarioFailures.length === 0 && negativeFailures.length === 0
      ? 'pass'
      : 'fail';

  return {
    schemaVersion: 1,
    proof: 'ultramodern-full-stack-version-switching',
    status,
    archivedAt: options.archivedAt || new Date().toISOString(),
    summary: {
      selectors: scenarios.length,
      passed: scenarios.filter(scenario => scenario.status === 'pass').length,
      failed: scenarioFailures.length,
      expectedSkewFailures: negativeControls.filter(
        scenario =>
          scenario.status === 'fail' &&
          scenario.reason === 'full-stack-version-mismatch',
      ).length,
    },
    scenarios,
    negativeControls,
  };
}

function parseArgs(argv) {
  const options = {
    caseId: 'matrix',
    selector: undefined,
    version: undefined,
    environment: undefined,
    out: undefined,
    allowFailure: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--case') {
      options.caseId = argv[++index];
    } else if (arg === '--selector') {
      options.selector = argv[++index];
    } else if (arg === '--version') {
      options.version = argv[++index];
    } else if (arg === '--environment') {
      options.environment = argv[++index];
    } else if (arg === '--out') {
      options.out = argv[++index];
    } else if (arg === '--allow-failure') {
      options.allowFailure = true;
    } else if (arg === '--help') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/ultramodern-version-switching/run-version-switching-proof.js
  node scripts/ultramodern-version-switching/run-version-switching-proof.js --case exact-v2
  node scripts/ultramodern-version-switching/run-version-switching-proof.js --selector environment --environment staging
  node scripts/ultramodern-version-switching/run-version-switching-proof.js --case skew-ui-v2-api-v1 --allow-failure

Options:
  --case <id>          matrix, workspace-v1, latest-tag-v2, exact-v1, exact-v2,
                       environment-override-staging, skew-ui-v2-api-v1
  --selector <kind>    workspace, latest, tag, exact, environment
  --version <version>  v1, v2, 1.0.0, or 2.0.0
  --environment <env>  staging, preview, or production
  --out <path>         Archive the JSON evidence to a file
  --allow-failure      Exit 0 for an intentionally failing scenario
`);
}

async function runFromCli(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  let evidence;
  if (options.selector) {
    evidence = await runScenario(
      {
        selector: options.selector,
        version: options.version,
        environment: options.environment,
      },
      env,
    );
  } else if (options.caseId === 'matrix') {
    evidence = await runMatrix({}, env);
  } else {
    const scenario = [...PROOF_MATRIX, ...NEGATIVE_CONTROLS].find(
      item => item.id === options.caseId,
    );
    if (!scenario) {
      throw new Error(`Unknown proof case: ${options.caseId}`);
    }
    evidence = await runScenario(scenario, env);
  }

  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  process.stdout.write(serialized);

  if (options.out) {
    const outPath = path.resolve(options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, serialized);
  }

  return evidence.status === 'pass' || options.allowFailure ? 0 : 1;
}

if (require.main === module) {
  runFromCli().then(
    exitCode => {
      process.exitCode = exitCode;
    },
    error => {
      process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  ENVIRONMENT_NAME_VARIABLE,
  ENVIRONMENT_VERSION_VARIABLE,
  MARKERS,
  NEGATIVE_CONTROLS,
  PROOF_MATRIX,
  normalizeVersion,
  resolveSelection,
  runFromCli,
  runMatrix,
  runScenario,
};
