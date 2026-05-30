---
name: ultramodern-backport-02-cloudflare-packages
overview: Modernize generated Cloudflare deployment and package version defaults while preserving other deployment targets and keeping all publishing inside trusted GitHub Actions.
todos:
  - id: audit-generated-deploy-scripts
    content: Audit generated deploy scripts and Modern.js integration points to identify which Cloudflare steps are genuinely required and which are demo-specific or redundant wrappers.
    status: completed
  - id: align-modernjs-version-defaults
    content: Update generated workspace package defaults to the required Modern.js 11.5.x line and current UltraModern package source behavior.
    status: completed
  - id: simplify-cloudflare-path
    content: Refactor Cloudflare deploy scaffolding so it uses Modern.js native build/deploy behavior as much as possible, with only necessary Worker-specific configuration and proof steps.
    status: completed
  - id: preserve-non-cloudflare-targets
    content: Validate that Cloudflare-specific environment variables, wrangler config generation, and deploy scripts do not break non-Cloudflare build or deploy targets.
    status: completed
  - id: wire-trusted-publishing-only
    content: Ensure package publication is documented and automated only through GitHub Actions trusted publishing, with no local npm publish workflow or manual package push path.
    status: completed
  - id: validate-release-candidate
    content: Run the package, generator, build, and scaffold verification gates required before opening the trusted-publishing release path.
    status: pending
isProject: false
---

# ultramodern-backport-02-cloudflare-packages

## Execution Notes

The goal is not to add a separate deployment system. The generated app should lean on Modern.js deploy behavior and only add UltraModern/Cloudflare glue where the platform genuinely needs it, such as Workers configuration, public URL proof, or federation asset handling.

Package updates are valid only after careful validation because they affect every newly scaffolded app. Publishing is not a local agent action; the repository should be pushed to the user's fork and packages should be released by GitHub Actions trusted publishing.

## Constraints

Do not push or publish to upstream `origin`. Do not add demo-specific deploy scripts. Do not remove support for other deployment targets while fixing Cloudflare.

## Operator Guidance

Depends on `ultramodern-backport-00-scope-and-demo-split`. This lane can run in parallel with CSS/i18n/routing and native boundaries. Before any release PR, require the fresh-scaffold validation lane to pass.
