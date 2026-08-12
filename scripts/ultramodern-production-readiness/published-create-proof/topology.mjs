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

export { createSharedContractVersionAssertion };
