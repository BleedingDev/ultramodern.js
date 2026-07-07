import path from 'node:path';
import { readJsonIfExists } from './process.mjs';

function createSharedContractVersionAssertion({ topology, generatedContract }) {
  const versions = [
    topology?.shell?.moduleFederation?.sharedContractVersion,
    ...(topology?.verticals ?? []).map(
      vertical => vertical.moduleFederation?.sharedContractVersion,
    ),
    ...(generatedContract?.apps ?? []).map(
      app => app.moduleFederation?.sharedContractVersion,
    ),
  ].filter(value => typeof value === 'string' && value.length > 0);
  const uniqueVersions = [...new Set(versions)].sort();

  if (uniqueVersions.length === 0) {
    return {
      status: 'unknown',
      versions: [],
      message: 'No MF sharedContractVersion values found in topology/contract.',
    };
  }

  return {
    status: uniqueVersions.length === 1 ? 'pass' : 'fail',
    versions: uniqueVersions,
  };
}

function createTopologyEvidence({
  selectedProfile,
  verticalNames,
  topology,
  generatedContract,
  packageCohortAssertion,
}) {
  const topologyVerticals = topology?.verticals ?? [];
  const contractApps = generatedContract?.apps ?? [];
  const contractVerticals = contractApps.filter(app => app.kind === 'vertical');
  const topologyShellRemoteCount =
    topology?.shell?.moduleFederation?.remotes?.length;
  const contractShellRemoteCount = contractApps.find(
    app => app.kind === 'shell',
  )?.moduleFederation?.remotes?.length;
  const mfRemoteCount =
    topologyShellRemoteCount ??
    contractShellRemoteCount ??
    contractVerticals.length;

  return {
    selectedProfile: selectedProfile.id,
    verticalCount: verticalNames.length,
    verticalNames,
    mfRemoteCount,
    contractCounts: {
      topologyVerticals: topologyVerticals.length,
      topologySharedPackages: topology?.sharedPackages?.length ?? 0,
      generatedContractApps: contractApps.length,
      generatedContractVerticals: contractVerticals.length,
    },
    sharedVersionAssertions: {
      packageCohort: packageCohortAssertion,
      moduleFederationSharedContract: createSharedContractVersionAssertion({
        topology,
        generatedContract,
      }),
    },
  };
}

function readGeneratedTopologyEvidence(
  projectDir,
  options,
  packageCohortAssertion,
) {
  return createTopologyEvidence({
    selectedProfile: options.selectedProfile,
    verticalNames: options.verticals,
    topology: readJsonIfExists(
      path.join(projectDir, 'topology/reference-topology.json'),
    ),
    generatedContract: readJsonIfExists(
      path.join(projectDir, '.modernjs/ultramodern-generated-contract.json'),
    ),
    packageCohortAssertion,
  });
}

export {
  createSharedContractVersionAssertion,
  createTopologyEvidence,
  readGeneratedTopologyEvidence,
};
