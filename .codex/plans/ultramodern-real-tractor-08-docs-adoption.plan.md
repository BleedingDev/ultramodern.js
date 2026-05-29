---
name: Ultramodern Real Tractor 08 Docs Adoption
overview: Document the real Tractor architecture, operational workflows, version switching, CSS federation policy, validation gates, and migration guidance after the implementation and proof lanes are complete.
todos:
  - id: write-architecture-doc
    content: "Write the architecture doc explaining real Explore/Decide/Checkout full-stack verticals, MF composition, Effect ownership, i18n ownership, CSS ownership, and shell responsibilities."
    status: completed
  - id: write-generator-docs
    content: "Update create README/template docs for generating the real Tractor reference workspace, adding verticals, package-source install validation, and expected commands."
    status: completed
  - id: write-css-policy
    content: "Document federated CSS policy: shared tokens/base, Tailwind usage, remote-owned chunks, deduplication, SSR styling, FOUC checks, and version-switch behavior."
    status: completed
  - id: write-zephyr-cloudflare-runbook
    content: "Document Cloudflare deploy and Zephyr version/environment switching operations, including CLI/dashboard/browser-extension paths and evidence commands."
    status: completed
  - id: write-validation-runbook
    content: "Document how to run local, install-backed, browser, Cloudflare, and live Zephyr validation without relying on source-content tests."
    status: completed
  - id: write-migration-guidance
    content: "Document how an existing one-remote commerce demo or application migrates into real Explore/Decide/Checkout full-stack verticals without losing one-package ownership."
    status: completed
isProject: true
---

# Ultramodern Real Tractor 08 Docs Adoption

## Execution Notes

Documentation is downstream of proof. It should not claim capabilities until validation gates produce evidence. The docs must distinguish:

- local generated validation;
- public Cloudflare proof;
- Zephyr upload/version selection proof;
- later Zerops long-running Node proof.

## Constraints

- Do not document the visual-only single-commerce boundary demo as the final architecture.
- Do not hide operational switching behind vague "use Zephyr" instructions.
- Do not present dynamic translation backend or federated CSS as solved unless corresponding validation exists.

## Operator Guidance

Docs should include command examples, evidence file paths, and a small decision table for when a team should create a new vertical versus keeping code inside an existing vertical.
