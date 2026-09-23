import fs from 'node:fs';
import path from 'node:path';
import { readNodeBackendArtifactEvidence } from '../browser-smoke/runtime-evidence.mjs';
import { readJsonFile } from './constants.mjs';
import { createSharedContractVersionAssertion } from './topology.mjs';

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readRequiredJson(projectDir, relativePath) {
  const filePath = path.join(projectDir, relativePath);
  assertCondition(
    fs.existsSync(filePath),
    `Required acceptance artifact is missing: ${relativePath}`,
  );
  return readJsonFile(filePath);
}

function appId(value) {
  return typeof value === 'string'
    ? value
    : (value?.id ?? value?.name ?? value?.alias);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function containsSkippedProof(value) {
  if (value === 'skipped') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(containsSkippedProof);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (value.skipped === true || value.status === 'skipped') {
    return true;
  }
  return Object.values(value).some(containsSkippedProof);
}

function assertSameIds(actual, expected, label) {
  const actualIds = sorted(actual.filter(Boolean));
  const expectedIds = sorted(expected);
  assertCondition(
    JSON.stringify(actualIds) === JSON.stringify(expectedIds),
    `${label}: expected ${expectedIds.join(', ')}, found ${actualIds.join(', ')}`,
  );
}

function readWorkspaceAcceptanceArtifacts(projectDir) {
  const topology = readRequiredJson(
    projectDir,
    'topology/reference-topology.json',
  );
  const overlay = readRequiredJson(
    projectDir,
    'topology/local-overlays/development.json',
  );
  assertCondition(
    topology?.shell &&
      Array.isArray(topology.verticals) &&
      (topology.shells === undefined || Array.isArray(topology.shells)),
    'Reference topology must declare a shell, verticals and optional shells',
  );
  const records = [
    topology.shell,
    ...topology.verticals,
    ...(topology.shells ?? []),
  ];
  const ids = new Set();
  const paths = new Set();
  const ports = new Set();
  const workspaceRoot = fs.realpathSync(projectDir);
  const apps = records.map((app, index) => {
    assertCondition(
      typeof app?.id === 'string' && app.id.length > 0 && !ids.has(app.id),
      'Reference topology app IDs must be unique non-empty strings',
    );
    ids.add(app.id);
    const kind =
      index === 0 || index > topology.verticals.length ? 'shell' : 'vertical';
    assertCondition(
      app.kind === kind,
      `${app.id} topology kind must be ${kind}`,
    );
    assertCondition(
      typeof app.path === 'string' &&
        app.path.length > 0 &&
        !path.isAbsolute(app.path) &&
        !app.path.split(/[\\/]/u).includes('..'),
      `${app.id} topology path must be workspace-relative`,
    );
    const appRoot = fs.realpathSync(path.join(projectDir, app.path));
    const relative = path.relative(workspaceRoot, appRoot);
    assertCondition(
      relative &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative) &&
        !paths.has(appRoot),
      `${app.id} topology path must be unique and inside workspace`,
    );
    paths.add(appRoot);
    const manifest = readJsonFile(path.join(appRoot, 'package.json'));
    assertCondition(
      typeof manifest.name === 'string' &&
        manifest.name.length > 0 &&
        (app.package === undefined || app.package === manifest.name),
      `${app.id} topology package identity must match its manifest`,
    );
    const port = overlay?.ports?.[app.id];
    assertCondition(
      Number.isInteger(port) && port > 0 && port <= 65535 && !ports.has(port),
      `${app.id} must have a unique development overlay port`,
    );
    ports.add(port);
    return { ...app, package: manifest.name, port };
  });
  return {
    projectDir,
    topology,
    overlay,
    apps,
  };
}

function assertWorkspaceCheckContract(projectDir) {
  const packageJson = readRequiredJson(projectDir, 'package.json');
  const check = packageJson.scripts?.check;
  assertCondition(
    typeof check === 'string',
    'Generated workspace is missing scripts.check',
  );
  const requiredCommands = [
    'pnpm format:check',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm api:check',
    'pnpm contract:check',
  ];
  const missing = requiredCommands.filter(command => !check.includes(command));
  assertCondition(
    missing.length === 0,
    `Generated pnpm check omits required command(s): ${missing.join(', ')}`,
  );
  assertCondition(
    !check.includes('pnpm node:proof'),
    'Generated pnpm check must remain a static gate and cannot require live Node servers',
  );
  const nodeProof = packageJson.scripts?.['node:proof'];
  assertCondition(
    typeof nodeProof === 'string' &&
      nodeProof.includes(
        'ultramodern-create ultramodern backend-federation-proof',
      ) &&
      !nodeProof.includes('backend-federation:generate'),
    'Generated node:proof must read already-built live outputs without regenerating backend federation artifacts',
  );
  assertCondition(
    packageJson.scripts?.['ultramodern:check'] === undefined,
    'Generated workspace must not define deprecated ultramodern:check',
  );
  return { command: check, requiredCommands };
}

function assertTopologyAcceptance(artifacts, verticalNames) {
  const topologyVerticals = artifacts.topology?.verticals;
  assertCondition(
    Array.isArray(topologyVerticals),
    'Reference topology verticals must be an array',
  );
  assertSameIds(
    topologyVerticals.map(vertical => vertical.id),
    verticalNames,
    'Reference topology vertical ids',
  );

  const verticals = artifacts.apps.filter(app => app.kind === 'vertical');
  const shells = artifacts.apps.filter(app => app.kind === 'shell');
  assertCondition(
    shells.length >= 1,
    'Reference topology must contain a shell',
  );
  assertSameIds(
    verticals.map(app => app.id),
    verticalNames,
    'Reference topology app vertical ids',
  );
  return {
    shellId: shells[0].id,
    topologyVerticalCount: topologyVerticals.length,
    appVerticalCount: verticals.length,
  };
}

function assertModuleFederationAcceptance(artifacts, verticalNames) {
  const topology = artifacts.topology;
  const shellRemotes =
    topology.shell?.moduleFederation?.remotes ??
    topology.shell?.verticalRefs ??
    [];
  assertSameIds(
    shellRemotes.map(appId),
    verticalNames,
    'Shell Module Federation remotes',
  );

  for (const vertical of topology.verticals) {
    assertCondition(
      typeof vertical.moduleFederation?.name === 'string' &&
        vertical.moduleFederation.name.length > 0,
      `${vertical.id} Module Federation name is missing`,
    );
    assertCondition(
      typeof vertical.moduleFederation?.manifestUrl === 'string' &&
        vertical.moduleFederation.manifestUrl.length > 0,
      `${vertical.id} Module Federation manifestUrl is missing`,
    );
    assertCondition(
      Array.isArray(vertical.moduleFederation?.exposes) &&
        vertical.moduleFederation.exposes.length > 0,
      `${vertical.id} Module Federation exposes are missing`,
    );
  }

  const sharedContract = createSharedContractVersionAssertion({
    topology,
  });
  assertCondition(
    sharedContract.status === 'pass',
    `Module Federation shared contract version assertion is ${sharedContract.status}`,
  );
  return {
    remoteCount: shellRemotes.length,
    exposedVerticalCount: topology.verticals.length,
    sharedContractVersions: sharedContract.versions,
  };
}

function assertApiAcceptance(artifacts, verticalNames) {
  const readinessRoutes = [];
  for (const vertical of artifacts.topology.verticals) {
    assertCondition(
      typeof vertical.api?.bff?.prefix === 'string' &&
        vertical.api.bff.prefix.length > 0,
      `${vertical.id} API prefix is missing`,
    );
    assertCondition(
      typeof vertical.api?.readiness?.endpoint === 'string' &&
        vertical.api.readiness.endpoint.startsWith('/') &&
        vertical.api.readiness.endpoint.length > 1,
      `${vertical.id} API readiness endpoint is missing`,
    );
    const readiness =
      vertical.backendFederation?.versionBoundary?.api?.readiness;
    assertCondition(
      typeof readiness === 'string' && readiness.length > 0,
      `${vertical.id} API readiness contract is missing`,
    );
    assertCondition(
      readiness ===
        `${vertical.api.bff.prefix}${vertical.api.readiness.endpoint}`,
      `${vertical.id} API readiness route differs from its topology prefix and endpoint`,
    );
    readinessRoutes.push({ appId: vertical.id, route: readiness });
  }
  assertSameIds(
    readinessRoutes.map(item => item.appId),
    verticalNames,
    'API-bearing vertical ids',
  );
  return {
    apiCount: readinessRoutes.length,
    readinessRoutes,
  };
}

function assertBackendAcceptance(artifacts, verticalNames) {
  const appsById = new Map(artifacts.apps.map(app => [app.id, app]));
  const results = verticalNames.map(vertical => {
    const app = appsById.get(vertical);
    assertCondition(app, `${vertical} backend topology is missing`);
    return readNodeBackendArtifactEvidence(artifacts.projectDir, app);
  });
  return {
    backendCount: results.length,
    target: 'node',
    appIds: results.map(result => result.appId),
    envelopes: results.map(result => ({
      appId: result.appId,
      envelopeDigest: result.envelopeDigest,
      envelopePath: result.envelopePath,
    })),
  };
}

function assertBrowserRuntimeAcceptance(report, verticalNames) {
  assertCondition(
    report.shellRuntime === 'workerd',
    'Browser shell runtime must be workerd',
  );
  assertCondition(
    report.status !== 'skipped',
    'Browser/runtime proof must not be skipped',
  );
  assertCondition(
    report.status === 'pass',
    `Browser/runtime proof status is ${report.status}`,
  );
  assertCondition(
    Array.isArray(report.skipped) && report.skipped.length === 0,
    'Browser/runtime proof must not contain skipped targets',
  );
  assertCondition(
    Array.isArray(report.results) && report.results.length > 0,
    'Browser/runtime proof results must be non-empty',
  );
  assertCondition(
    !containsSkippedProof(report.results),
    'Browser/runtime proof results must not contain skipped evidence',
  );
  const resultById = new Map(
    report.results.map(result => [result.appId, result]),
  );
  assertCondition(
    resultById.size === report.results.length,
    'Browser/runtime proof contains duplicate app targets',
  );
  const shellResults = report.results.filter(
    result => !verticalNames.includes(result.appId),
  );
  assertCondition(
    shellResults.length === 1 &&
      report.results.length === verticalNames.length + 1,
    `Browser/runtime proof must contain one shell plus all ${verticalNames.length} vertical targets`,
  );
  for (const vertical of verticalNames) {
    assertCondition(
      resultById.has(vertical),
      `${vertical} browser/runtime proof is missing`,
    );
  }
  for (const result of report.results) {
    assertCondition(
      result.status === 'pass',
      `${result.appId} browser/runtime result did not pass`,
    );
    assertCondition(
      Array.isArray(result.assertions) && result.assertions.length > 0,
      `${result.appId} browser/runtime assertions are empty`,
    );
    const failed = result.assertions.filter(
      assertion => assertion.status !== 'pass',
    );
    assertCondition(
      failed.length === 0,
      `${result.appId} browser/runtime assertion(s) did not pass: ${failed
        .map(assertion => assertion.type)
        .join(', ')}`,
    );
    assertCondition(
      result.assertions.some(assertion => assertion.type === 'mf-manifest'),
      `${result.appId} browser/runtime proof lacks an MF manifest assertion`,
    );
    for (const requiredType of ['stylesheet-evidence']) {
      assertCondition(
        result.assertions.some(
          assertion =>
            assertion.type === requiredType && assertion.status === 'pass',
        ),
        `${result.appId} browser/runtime proof lacks required ${requiredType} evidence`,
      );
    }
    if (verticalNames.includes(result.appId)) {
      assertCondition(
        result.assertions.some(
          assertion => assertion.type === 'effect-readiness',
        ),
        `${result.appId} browser/runtime proof lacks an API readiness assertion`,
      );
      const localizedNavigation = result.assertions.find(
        assertion =>
          assertion.type === 'localized-router-navigation' &&
          assertion.status === 'pass',
      );
      assertCondition(
        localizedNavigation,
        `${result.appId} browser/runtime proof lacks required localized-router-navigation evidence`,
      );
      const source = localizedNavigation?.source;
      const target = localizedNavigation?.target;
      assertCondition(
        localizedNavigation?.documentContinuityPreserved === true &&
          source?.pathname === '/en' &&
          source?.htmlLang === 'en' &&
          typeof source?.text === 'string' &&
          source.text.length > 0 &&
          typeof source?.navigationLabel === 'string' &&
          source.navigationLabel.length > 0 &&
          target?.pathname === '/cs' &&
          target?.htmlLang === 'cs' &&
          typeof target?.text === 'string' &&
          target.text.length > 0 &&
          target.text !== source.text &&
          typeof target?.navigationLabel === 'string' &&
          target.navigationLabel.length > 0 &&
          target.navigationLabel !== source.navigationLabel,
        `${result.appId} browser/runtime localized-router-navigation evidence is incomplete`,
      );
    }
  }
  const shellBoundary = shellResults[0].assertions.find(
    assertion => assertion.type === 'shell-composition-boundary',
  );
  assertCondition(
    shellBoundary?.status === 'pass',
    `${shellResults[0].appId} browser/runtime proof lacks a passing shell composition boundary assertion`,
  );
  assertSameIds(
    shellBoundary.declaredRemoteIds ?? [],
    verticalNames,
    'Shell declared browser boundary ids',
  );
  assertSameIds(
    (shellBoundary.matchedRemoteBoundaries ?? []).map(item => item.remoteId),
    verticalNames,
    'Shell rendered browser boundary ids',
  );
  const noJavaScriptShellBoundary = shellResults[0].assertions.find(
    assertion => assertion.type === 'no-js-shell-composition-boundary',
  );
  assertCondition(
    noJavaScriptShellBoundary?.status === 'pass',
    `${shellResults[0].appId} browser/runtime proof lacks a passing no-JS shell composition boundary assertion`,
  );
  assertSameIds(
    noJavaScriptShellBoundary.declaredRemoteIds ?? [],
    verticalNames,
    'Shell declared no-JS SSR boundary ids',
  );
  assertSameIds(
    (noJavaScriptShellBoundary.matchedRemoteBoundaries ?? []).map(
      item => item.remoteId,
    ),
    verticalNames,
    'Shell rendered no-JS SSR boundary ids',
  );
  return {
    appCount: report.results.length,
    assertionCount: report.results.reduce(
      (count, result) => count + result.assertions.length,
      0,
    ),
    appIds: report.results.map(result => result.appId),
    shellId: shellResults[0].appId,
  };
}

export {
  assertApiAcceptance,
  assertBackendAcceptance,
  assertBrowserRuntimeAcceptance,
  assertModuleFederationAcceptance,
  assertTopologyAcceptance,
  assertWorkspaceCheckContract,
  readWorkspaceAcceptanceArtifacts,
};
