const validateCiWorkflowRunUrl = ({ filePath, rawValue, normalized }) => {
  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch (_error) {
    throw new Error(
      `Metadata field "workflow_run_url" must be an HTTPS workflow URL in CI-backed evidence file: ${filePath}`,
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalWorkflowUrl =
    normalized === 'local' ||
    normalized.startsWith('local://') ||
    normalized.startsWith('file://') ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname.endsWith('.local');
  if (isLocalWorkflowUrl) {
    throw new Error(
      `Metadata field "workflow_run_url" uses local-only value "${rawValue}" in CI-backed evidence file: ${filePath}`,
    );
  }

  const isExampleWorkflowUrl =
    hostname === 'example.com' ||
    hostname === 'example.org' ||
    hostname === 'example.net' ||
    hostname.endsWith('.example');
  if (isExampleWorkflowUrl) {
    throw new Error(
      `Metadata field "workflow_run_url" uses placeholder URL "${rawValue}" in CI-backed evidence file: ${filePath}`,
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `Metadata field "workflow_run_url" must be an HTTPS workflow URL in CI-backed evidence file: ${filePath}`,
    );
  }
};

module.exports = {
  validateCiWorkflowRunUrl,
};
