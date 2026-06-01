---
name: ultramodern-framework-propagation-06-release-rollout
overview: Release the framework defaults through the trusted publishing path, update documentation, push the correct remotes, and publish the cleaned Tractor demo with stable deployment evidence.
todos:
  - id: update-framework-docs
    content: "Document the framework-owned defaults for Cloudflare SSR deploy, federated CSS, i18n resources, boundary debugging, add-vertical workflow, and Tractor demo relationship."
    status: pending
  - id: commit-framework-changes
    content: "Commit framework changes and push to the user's fork remote according to repository rules."
    status: pending
  - id: run-trusted-publishing
    content: "Publish UltraModern package updates only through GitHub Actions trusted publishing and verify latest tags point to the released version."
    status: pending
  - id: commit-demo-changes
    content: "Commit and push the cleaned Tractor demo repository to BleedingDev with updated dependencies and no framework-level local patches."
    status: pending
  - id: deploy-demo-website
    content: "Deploy the Tractor demo to its stable Cloudflare website URL and verify the deployed shell and vertical URLs."
    status: pending
  - id: capture-final-evidence
    content: "Capture final screenshots and runtime proof for styled SSR, JS-disabled pages, language switching, boundaries, recommendation links, and Effect BFF endpoints."
    status: pending
  - id: close-tracking-work
    content: "Close related beads issues, push bead state, and provide a concise handoff with exact package versions, repo URLs, deployment URL, and remaining risks."
    status: pending
isProject: false
---

# ultramodern-framework-propagation-06-release-rollout

## Execution Notes

This is the rollout lane after framework implementation, generated validation, and Tractor cleanup are done. It must preserve the repository publishing rules: default push remote is `bleedingdev`; upstream `origin` is off-limits unless explicitly requested.

## Constraints

No manual `npm publish`. Package release uses GitHub Actions trusted publishing. Do not claim completion until commits, pushes, package tags, deployment, and visual/runtime evidence are verified.

## Operator Guidance

This plan depends on Tractor cleanup. Keep final evidence short but concrete: command gates, package version, npm dist-tags, repo URL, deployed URL, and screenshots/proofs.
