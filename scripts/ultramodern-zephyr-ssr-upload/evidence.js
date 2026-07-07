const { writeJsonFile } = require('../lib/fs-kit');

const { EXPECTED_TARGET } = require('./constants');

function extractDeploymentEvidence({ result, deploymentInfo }) {
  const buildStats = deploymentInfo?.buildStats;
  const snapshot = deploymentInfo?.snapshot;

  return {
    deploymentUrl: result?.deploymentUrl ?? deploymentInfo?.url ?? null,
    entrypoint: result?.entrypoint ?? null,
    applicationUid: buildStats?.id ?? null,
    snapshotId: deploymentInfo?.snapshotId ?? snapshot?.uid ?? null,
    snapshotType: snapshot?.snapshotType ?? snapshot?.type ?? 'ssr',
    version: buildStats?.version ?? null,
    edgeUrl: buildStats?.edge?.url ?? null,
    app: buildStats?.app ?? null,
    target: buildStats?.context?.target ?? EXPECTED_TARGET,
    federatedDependencies: Array.isArray(deploymentInfo?.federatedDependencies)
      ? deploymentInfo.federatedDependencies.map(dependency => ({
          name: dependency.name ?? null,
          version: dependency.version ?? null,
          remote: dependency.remote ?? null,
        }))
      : [],
  };
}

function joinUrl(baseUrl, ...segments) {
  if (!baseUrl) {
    return null;
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedSegments = segments
    .filter(segment => typeof segment === 'string' && segment.length > 0)
    .map(segment => segment.replace(/^\/+|\/+$/g, ''))
    .filter(segment => segment.length > 0);
  return [normalizedBase, ...normalizedSegments].join('/');
}

function writeEvidence(evidence, evidencePath) {
  writeJsonFile(evidencePath, evidence, { atomic: false });
  return evidencePath;
}

module.exports = {
  extractDeploymentEvidence,
  joinUrl,
  writeEvidence,
};
