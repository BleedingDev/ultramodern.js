const fs = require('fs');
const path = require('path');
const { shouldRequireCiBackedMetadata } = require('./env');
const { validateMetadataFields } = require('./metadata');

const countReviewers = content => {
  const matches = content.match(/(^|\n)\s*[-*]?\s*reviewer[\w-]*\s*[:=]/gim);
  return matches ? matches.length : 0;
};

const validateEvidence = ({
  evidenceDir,
  requiredFiles,
  requiredMetadataFields,
  minimumReviewers,
  allowMissingEvidence,
  allowLocalEvidenceMetadata = false,
  requireCiBackedMetadata,
}) => {
  const resolvedEvidenceDir = path.resolve(evidenceDir);
  const enforceCiBackedMetadata = shouldRequireCiBackedMetadata({
    allowMissingEvidence,
    allowLocalEvidenceMetadata,
    requireCiBackedMetadata,
  });
  const report = {
    evidenceDir: resolvedEvidenceDir,
    validatedFiles: [],
    skippedFiles: [],
  };

  for (const requiredFile of requiredFiles) {
    const filePath = path.resolve(resolvedEvidenceDir, requiredFile);
    if (!fs.existsSync(filePath)) {
      if (allowMissingEvidence) {
        report.skippedFiles.push(requiredFile);
        continue;
      }
      throw new Error(
        `Missing required evidence file "${requiredFile}" in ${resolvedEvidenceDir}`,
      );
    }

    const content = fs.readFileSync(filePath, 'utf8');
    validateMetadataFields({
      filePath,
      content,
      requiredMetadataFields,
      requireCiBackedMetadata: enforceCiBackedMetadata,
    });

    if (
      requiredFile.toLowerCase() === 'review-evidence.md' &&
      Number.isFinite(minimumReviewers) &&
      minimumReviewers > 0
    ) {
      const reviewerCount = countReviewers(content);
      if (reviewerCount < minimumReviewers) {
        throw new Error(
          `Review evidence must contain at least ${String(
            minimumReviewers,
          )} reviewer entries. Found ${String(reviewerCount)} in ${filePath}.`,
        );
      }
    }

    report.validatedFiles.push(requiredFile);
  }

  return report;
};

module.exports = {
  validateEvidence,
};
