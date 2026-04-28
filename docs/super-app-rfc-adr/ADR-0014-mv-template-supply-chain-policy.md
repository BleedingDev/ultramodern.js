# ADR-0014: Micro Vertical Template Supply-Chain Policy

- Status: Proposed
- Date: 2026-04-28
- Depends on:
  - `DELIVERY-0001-micro-vertical-reference-delivery.md`
  - `ADR-0013-mv-ds-platform-contract.md`

## 1. Context

Micro Vertical starter templates are executable supply-chain inputs. A template can introduce dependencies, scripts, generated files, and framework configuration before a team has reviewed the resulting project.

The create flow already has an UltraModern contract check template that expects generated projects to include `presetUltramodern(...)`, `appTools()`, Module Federation SSR, BFF request id propagation, and telemetry exporter wiring. The missing piece is a manifest contract that describes where a template came from, how it is pinned, what it may write, and which validation expectations apply.

## 2. Decision

Adopt `docs/super-app-rfc-adr/contracts/mv-template-manifest.schema.json` as the canonical schema for Micro Vertical template manifests.

Every non-ad-hoc template source must be represented as one of:

1. `builtin` for repository-owned templates distributed with Modern.js tooling.
2. `npm` for published package templates.
3. `git` for repository templates pinned to a commit SHA or semver tag with resolved commit SHA.
4. `local` for workspace-local development templates.

Template materialization must be deny-by-default for lifecycle scripts, path writes, and overwrite behavior.

## 3. Source Policy

### 3.1 Builtin

Builtin templates are trusted only as repository-local artifacts. They still need a manifest because validation should not depend on implicit filesystem knowledge.

Required policy:

1. declare builtin template name.
2. include repository-relative source path when applicable.
3. include checksum and provenance metadata.

### 3.2 npm

npm templates must use exact package versions. Semver ranges are not allowed for template resolution.

Required policy:

1. exact `version`.
2. tarball SHA-256 checksum.
3. provenance metadata, preferably npm provenance when available.
4. lifecycle scripts denied unless explicitly reviewed and opted in by a future policy.

### 3.3 git

git templates must be pinned. Branch names are not valid template references.

Allowed pins:

1. direct commit SHA.
2. semver tag plus resolved tag SHA and checkout SHA.

The checkout SHA is the materialization identity. Tags are human-readable release aliases, not sufficient integrity by themselves.

### 3.4 local

Local templates are for development and repository workflows. They must use relative paths and must not escape the workspace.

Required policy:

1. no absolute paths.
2. no `..` traversal.
3. `allowOutsideWorkspace` must remain false.

## 4. Integrity and Provenance

Every manifest must declare:

1. at least one SHA-256 checksum.
2. provenance kind, issuer, and subject.
3. lockfile checksum when the template ships dependency state.

Checksum scopes distinguish the manifest, source archive, source tree, and lockfile so validators can check the artifact they are actually consuming.

## 5. Lifecycle Script Policy

Lifecycle scripts are denied by default.

The default denied set includes:

1. `preinstall`
2. `install`
3. `postinstall`
4. `prepare`

Templates may declare an `allowedScripts` list only as an explicit policy input. The initial validation path should treat that list as empty unless a future reviewed exception policy says otherwise.

## 6. Materialization Boundaries

Templates must declare:

1. target root.
2. allowed path patterns.
3. denied path patterns.
4. overwrite policy.

The default denylist must cover repository and runtime-sensitive paths such as `.git/**`, `.github/**`, environment files, package-manager rc files, `node_modules/**`, and build output.

Validators should reject absolute paths, path traversal, writes outside the target root, and attempts to overwrite existing files unless the manifest explicitly allows generated-file replacement.

## 7. Validation Path

Validation should be staged so failures are attributable:

1. parse the manifest as JSON.
2. validate the manifest against the schema.
3. resolve and verify source pinning.
4. verify checksum and provenance metadata.
5. materialize only through the allowed path policy.
6. install dependencies with lifecycle scripts denied by default.
7. run the UltraModern generated-project contract check.
8. retain the manifest or equivalent evidence in the generated project.

The existing `validate-ultramodern.mjs.handlebars` check is the post-materialization contract check, not the source-integrity validator.

## 8. Out of Scope

This ADR does not implement validators, package-manager integration, provenance verification backends, or create-tool wiring. Those are owned by the validation wiring workstream.

This ADR also does not approve third-party template registries. Registries can be added later through the same manifest source model and trust policy.

## 9. Consequences

Positive:

1. template provenance and materialization behavior become reviewable before execution.
2. builtin, npm, git, and local templates share one policy surface.
3. the create flow can add validation without changing the public UltraModern preset contract.

Tradeoff:

1. template authors must maintain manifest metadata.
2. checksum and provenance validation add operational steps to template publishing.
3. local development templates need explicit paths and cannot rely on ambient filesystem access.

## 10. Acceptance Criteria

1. `contracts/mv-template-manifest.schema.json` parses as JSON.
2. the schema supports builtin, npm, git, and local template sources.
3. the policy requires pinned sources, checksums, provenance, and denied lifecycle scripts by default.
4. the materialization policy forbids unsafe path writes and requires a validation path for generated UltraModern projects.
