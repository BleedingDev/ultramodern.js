const isTruthyEnvironmentValue = value =>
  ['1', 'true', 'yes'].includes(
    String(value || '')
      .trim()
      .toLowerCase(),
  );

const isCiEnvironment = () =>
  isTruthyEnvironmentValue(process.env.CI) ||
  isTruthyEnvironmentValue(process.env.GITHUB_ACTIONS);

const shouldRequireCiBackedMetadata = ({
  allowMissingEvidence,
  allowLocalEvidenceMetadata,
  requireCiBackedMetadata,
}) => {
  if (allowLocalEvidenceMetadata || allowMissingEvidence) {
    return false;
  }

  if (typeof requireCiBackedMetadata === 'boolean') {
    return requireCiBackedMetadata;
  }

  return isCiEnvironment();
};

module.exports = {
  isTruthyEnvironmentValue,
  isCiEnvironment,
  shouldRequireCiBackedMetadata,
};
