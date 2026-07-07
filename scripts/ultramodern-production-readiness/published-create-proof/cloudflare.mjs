import {
  cloudflareDeployProofEvidenceId,
  cloudflareDeployProofSkippedReason,
} from './constants.mjs';

function createCloudflareProofArgs({ requirePublicUrls = false } = {}) {
  const args = ['cloudflare:proof'];
  if (requirePublicUrls) {
    args.push('--require-public-urls');
  }
  return args;
}

function createCloudflareDeployProofEvidence() {
  return {
    id: cloudflareDeployProofEvidenceId,
    dimensions: ['integration', 'browser'],
    status: 'skipped',
    reason: cloudflareDeployProofSkippedReason,
    detail: {
      deployCloudflare: false,
      requiredFlag: '--deploy-cloudflare',
    },
  };
}

export { createCloudflareDeployProofEvidence, createCloudflareProofArgs };
