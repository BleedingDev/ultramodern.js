const {
  escapeRegExp,
  isPlaceholderValue,
} = require('../../lib/validation-kit');
const { validateCiWorkflowRunUrl } = require('./ci');

const validateMetadataFields = ({
  filePath,
  content,
  requiredMetadataFields,
  requireCiBackedMetadata = false,
}) => {
  for (const field of requiredMetadataFields) {
    const pattern = new RegExp(
      `(^|\\n)\\s*${escapeRegExp(field)}\\s*[:=]\\s*(.*)$`,
      'im',
    );
    const match = content.match(pattern);
    if (!match) {
      throw new Error(
        `Missing metadata field "${field}" in evidence file: ${filePath}`,
      );
    }

    const rawValue = match[2] ? String(match[2]).trim() : '';
    const normalized = rawValue
      .replace(/^['"]|['"]$/g, '')
      .trim()
      .toLowerCase();
    if (!normalized) {
      throw new Error(
        `Metadata field "${field}" has an empty value in evidence file: ${filePath}`,
      );
    }

    if (isPlaceholderValue(normalized)) {
      throw new Error(
        `Metadata field "${field}" uses placeholder value "${rawValue}" in evidence file: ${filePath}`,
      );
    }

    if (requireCiBackedMetadata) {
      const normalizedField = String(field).trim().toLowerCase();

      if (normalizedField === 'commit_sha' && normalized.endsWith('-dirty')) {
        throw new Error(
          `Metadata field "commit_sha" uses dirty commit value "${rawValue}" in CI-backed evidence file: ${filePath}`,
        );
      }

      if (normalizedField === 'workflow_run_url') {
        validateCiWorkflowRunUrl({
          filePath,
          rawValue,
          normalized,
        });
      }
    }
  }
};

module.exports = {
  validateMetadataFields,
};
