---
name: Dependency refresh generator integration
overview: Join all accepted dependency cohorts into consistent root manifests generator policies templates aliases and one reproducible lockfile.
todos:
  - id: synchronize-producer-pins
    content: Apply the frozen targets to versions policy templates aliases peers and publication projections and remove obsolete correction references.
    status: in_progress
  - id: resolve-final-lockfile
    content: Regenerate the full dependency graph with the selected pnpm, inspect deduplication and peer/patch integrity, and prove a frozen reinstall.
    status: pending
  - id: prove-generated-consumers
    content: Generate supported app and workspace variants and prove independent installs builds tests and source/packed package parity.
    status: pending
isProject: false
---

# Dependency refresh generator integration

## Execution Notes

Beads `modernjs-h8xqq.6`. Depends on tooling, Effect, build and runtime plans. Own `packages/toolkit/ultramodern-create/**`, source templates, framework manifests' final integration, root workspace policy/lockfile and generator proofs. Consume exact reviewed version/manifest proposals from each lane; this coordinator exclusively applies shared manifest/YAML/lockfile edits and runs installs. Temporary per-cohort integration checkpoints are allowed before this final join, always serialized.

Update `versions.ts`, `policy.ts`, template-workspace source assets, release-source aliases, direct/optional peers and build/SSR singleton declarations. Remove stale comments about where Effect peers live. If Effect correction is retired, remove every `npm:@bleedingdev/effect` producer rewrite and publish mapping, and use upstream effect 4.0.0 everywhere. Preserve corrected Zod, federation and image identities where repairs remain needed.

Adopt Wrangler 4.145.0 with its verified Miniflare 5 alpha/workerd cohort and Workers types. Validate direct workerd overrides against Wrangler's own version rather than assuming daily releases match. Preserve Cloudflare compatibility date unless a behavior change has its own proof. Keep exact baseline React/router/Effect identity across all generated verticals.

## Constraints

Never hand-edit lockfile, generated package outputs, package changelogs or skill mirrors. Regenerate only through their owning producers. Preserve no-downgrade trust, release-age protection, build allowlists and explicit install stages. Do not extend old migration machinery. Broad peer ranges require genuine supported-version evidence; internal exact optional peers should match the selected runtime identity.

## Operator Guidance

After root manifest/recipe integration, install with the selected pnpm, inspect the complete lockfile diff and run dedupe only if it preserves consumer-required majors. Verify patch hashes, sidecar aliases, package-manager version, internal release versions and native optional packages. A second `pnpm install --frozen-lockfile` must leave the tree unchanged. Reject phantom importers from emitted dist files or nested worktrees.

Build the generator and independently install its generated outputs: simple app, shell and vertical workspace, Effect HTTP and RPC, Hono, Node and Worker, localized routes, MF and image variants. Test consumer build/lint/typecheck using documented commands. Run relevant generator tests, `node tests/skill/feature-enable.mjs`, `pnpm sync:skills` when authoring skills changes, and source-create proof. Observe the 24-hour publication age for Effect and newly published corrected artifacts; wait or use only the existing reviewed exact exception mechanism.
