# Publish Security Runbook

This repository publishes BleedingDev UltraModern packages through GitHub OIDC
trusted publishing. The publish workflow is intentionally tokenless: do not add
`NPM_TOKEN` or `NODE_AUTH_TOKEN` to the publish job.

## Required Account Controls

- GitHub organization membership must require 2FA.
- npm publisher accounts and organizations must require 2FA.
- npm trusted publishing must be configured for `BleedingDev/ultramodern.js` and
  the `Publish BleedingDev Packages` workflow.
- Long-lived npm automation tokens must not be used for the BleedingDev publish
  package set. Remove stale repo, organization, and environment secrets that can
  publish packages.

## Required Repository Controls

- Publish only from `refs/heads/main-ultramodern`.
- Publish only through the `npm-publish` GitHub environment.
- Keep publish workflow permissions minimal: `contents: read` and
  `id-token: write`.
- Keep `actions/checkout` credentials disabled with
  `persist-credentials: false`.
- Keep GitHub Actions pinned to commit SHAs in publish and generated template
  workflows.
- Do not use `pull_request_target` in this repository or generated templates.
- Keep StepSecurity harden-runner in audit mode unless every required outbound
  endpoint has been measured and allowlisted.
- Keep Renovate enabled with dependency dashboard review, one-day release age,
  grouped updates, action digest pinning, and manual approval for major updates.

## Alert Review

Security alerts are part of release readiness. Before a non-dry-run publish,
review GitHub security alerts, Dependabot/GitHub Advisory alerts, Renovate
dashboard items, Socket alerts if enabled, and StepSecurity harden-runner audit
findings. Do not ignore a new high-severity supply-chain alert without recording
the owner, reason, and remediation path in the release evidence.
