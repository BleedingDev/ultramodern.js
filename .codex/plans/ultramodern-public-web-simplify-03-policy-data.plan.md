---
name: ultramodern-public-web-simplify-03-policy-data
overview: Consolidate public web policy values so generated contracts, validators, tests, and documentation derive from one data description instead of repeating policy literals across the scaffold.
todos:
  - id: list-duplicated-policy-values
    content: List duplicated public web policy values across createPublicWebsiteQualityGateContract, assertCloudflareQualityGates, integration expectations, README wording, and generated validator snippets.
    status: pending
  - id: choose-policy-owner
    content: Choose the smallest internal owner for public web policy data that can feed contract rendering, generated validator rendering, and integration expectations without creating a broad profile engine.
    status: pending
  - id: add-policy-characterization
    content: Add characterization coverage proving current quality gate contract keys and values remain stable for shell and vertical apps before consolidating literals.
    status: pending
  - id: consolidate-policy-data
    content: Replace duplicated public web quality gate literals with a single internal data source and render contract, validator, and tests from it where practical.
    status: pending
  - id: align-docs-with-policy
    content: Align README or generated documentation snippets with the single public web policy source, especially route-owned metadata, generated compatibility manifest, and proof-gate wording.
    status: pending
  - id: validate-policy-refactor
    content: Run targeted create-ultramodern integration tests, create package tests, and a diff inspection of generated contract JSON expectations.
    status: pending
isProject: false
---

# ultramodern-public-web-simplify-03-policy-data

## Execution Notes

The recent public website smoke gate work introduced policy values in several places: Cloudflare deploy contract, generated validator assertions, integration test expectations, and docs. This is acceptable short-term but shallow: the interface is nearly as complex as the implementation, and policy changes require synchronized edits.

The desired module is not a `webSpec` or compliance engine. It is a small internal policy data module for objective framework-owned defaults.

## Constraints

Do not introduce a broad profile, certification, agent-readiness, SEO scoring, accessibility, or Lighthouse gate system. Do not change default policy values unless a separate decision accepts that behavior change. Preserve the generated contract shape and generated validator behavior.

ADR-0016 is binding: performance readiness remains diagnostics or proof evidence, not default arbitrary product quality enforcement.

## Operator Guidance

Run after `ultramodern-public-web-simplify-02-generator-module` if that lane creates a natural public web module. If not, this can still run independently inside `ultramodern-workspace.ts` with a small internal constant and renderer helpers. Review should focus on whether locality improved without hiding simple policy behind unnecessary indirection.
