# ADR-0012: MV Topology Manifest and Zephyr Profile

- Status: Retired (2026-06-12) — machinery removed in fork cleanup, see `docs/research/fork-audit-2026-06-12-findings.md`. `scripts/mv-zephyr-profile` (the only structural validator of `contracts/mv-topology-manifest.schema.json`) was deleted as orphaned; the schema is now documentation-only with no in-repo validator.
- Historical Note: Module Federation is the live composition runtime; Wave 0 topology/trust metadata gates are historical (see `FORK-DIVERGENCE.md`).
- Date: 2026-04-28
- Decision Type: Delivery contract
- Related:
  - `DELIVERY-0001-micro-vertical-reference-delivery.md`
  - `ADR-0002-app-level-mf-ssr-strategy.md`
  - `CI-GATES-0001-check-and-artifact-map.md`
  - `contracts/mv-topology-manifest.schema.json`

## 1. Context

Micro Vertical delivery needs one shell-owned topology contract that can point to independently deployed remotes and services without baking environment-specific URLs into shell source code.

The current MF SSR strategy already defines runtime digest checks, origin trust, integrity, attestation, fallback telemetry, and cache behavior for MF artifacts. The missing piece is a higher-level topology manifest that downstream super-apps can use as the source of truth for:

1. shell-to-remote and shell-to-service indirection.
2. immutable artifact URL and trust metadata.
3. environment overlays.
4. cache, last-known-good, revocation, and kill-switch policy.
5. profile metadata for Zephyr-delivered vanilla Modern.js applications.

## 2. Decision

Add `docs/super-app-rfc-adr/contracts/mv-topology-manifest.schema.json` as the Wave 0 topology manifest contract.

The manifest is a governance and validation artifact. It does not replace the existing Modern.js MF manifest. Instead, it owns the topology-level indirection that tells the shell which MF manifests, remote entries, SSR entries, and service endpoints are eligible for a selected environment.

## 3. Manifest Semantics

### 3.1 Shell indirection

Shell source must store stable references to remote and service IDs, not deployment URLs.

The selected topology manifest resolves those references into:

1. remote `mf-manifest.json` artifact URL.
2. remote entry artifact URL.
3. optional server and client SSR entry artifacts.
4. service base URLs and operation manifests.

This keeps shell releases independent from remote and service deploy timing.

### 3.2 Immutable artifacts

Remote artifacts must be immutable and version-addressed. Each remote manifest and remote entry record must carry:

1. URL.
2. digest.
3. Subresource Integrity value.
4. optional attestation.
5. runtime digest when the artifact participates in MF runtime compatibility.

Mutable environment labels may exist only as overlays that point to immutable artifacts. A production shell must never depend on an unpinned remote entry URL as the only identity of a release.

### 3.3 Environment overlays

The manifest may contain environment keys such as `local`, `preview`, `staging`, and `production`.

An overlay may replace a remote or service target for that environment, but it must preserve the same trust shape as the base target. Overlay replacement is valid for release promotion, preview stacks, and incident rollback. Overlay replacement is not valid for bypassing digest, integrity, attestation, origin, or runtime compatibility policy.

### 3.4 Cache and LKG

MF manifest endpoints remain revalidated aggressively. Immutable remote entries may use long cache TTLs when version-pinned through the `mfv` query behavior described by ADR-0002.

Last-known-good policy is explicit in the topology manifest. When enabled, a shell may fall back from the current topology to a bounded-age LKG snapshot before rendering a CSR fallback. LKG fallback must emit the same fallback telemetry as other MF degradation paths.

### 3.5 Revocation

The manifest includes a revocation list for compromised, incompatible, bad-release, policy-violating, or operator-disabled artifacts.

Revocation wins over cache and LKG. A revoked artifact cannot be selected even when it exists in the current topology, an environment overlay, or the LKG snapshot.

### 3.6 Kill switches

Kill switches are topology-level hooks that target a remote or service reference. Supported actions are:

1. disable a remote.
2. disable a service.
3. force CSR for a remote route subtree.
4. force LKG selection.

Kill switches must resolve by reference ID, not by searching URLs or route strings. Each action must preserve deterministic fallback behavior and telemetry.

## 4. Zephyr Vanilla Modern.js Profile

The first profile is `zephyr-vanilla-modernjs`.

This profile describes a vanilla Modern.js application delivered through Zephyr while preserving Modern.js runtime and MF contracts.

### 4.1 `withZephyr` placement

`withZephyr()` must come from `zephyr-rspack-plugin` and be applied inside a small Modern.js plugin that calls `api.modifyRspackConfig`, alongside `appTools()`.

This profile originally required `zephyr-modernjs-plugin`, but live Modern.js evidence showed that wrapper checking `api.getAppContext().bundlerType` did not attach in the generated Rspack app because `bundlerType` was undefined. The direct Rspack plugin path matches Zephyr's public Rspack API and produced authenticated Zephyr deployments for both client and server builds.

The profile records this as `modern-config-rspack-bridge-plugin` so validators can reject private runtime boot hacks while still using Zephyr's public Rspack plugin.

### 4.2 Output constraints

Zephyr delivery must preserve the Modern.js MF outputs:

1. `mf-manifest.json`.
2. `remoteEntry*.js`.
3. SSR server and client entries when app-level MF SSR is enabled.

The profile forbids runtime public path mutation as a delivery strategy. Public paths and artifact URLs must be represented in the topology manifest and selected overlays.

### 4.3 HTML constraints

HTML generation must preserve Modern.js manifest injection semantics.

The profile forbids ad hoc remote script injection and inline remote URL tables in HTML. The shell can receive topology data through the manifest contract, but HTML must not become the source of truth for remote discovery.

### 4.4 Source constraints

Shell and remote source must not hardcode environment-specific remote or service URLs.

Allowed source usage is reference-based:

1. shell route ownership points to remote IDs.
2. MF runtime app records are produced from the selected topology manifest.
3. service clients resolve base URLs through service references.

### 4.5 Forbidden runtime boot hacks

The profile explicitly forbids these runtime boot patterns:

1. overwriting `window` remote maps after boot.
2. using `document.write` to inject remote entries.
3. creating dynamic remote-entry script tags as the primary resolver.
4. mutating public path globals at runtime to steer remotes.
5. rewriting MF manifests after build as the deployment mechanism.

These patterns bypass the trust, cache, fallback, and compatibility contracts from ADR-0002.

## 5. Runtime Contract

At runtime, a shell using this contract follows this order:

1. select one environment overlay.
2. resolve shell remote and service references through the topology manifest.
3. reject revoked artifacts.
4. enforce origin, integrity, attestation, and runtime digest policy.
5. apply cache version pinning.
6. register MF apps using resolved manifest/entry records.
7. degrade through kill switch, LKG, or CSR fallback when policy requires it.
8. emit fallback telemetry for every degraded path.

Dynamic remote URLs are allowed only when they come from Zephyr-published Module Federation manifests. Runtime-computed URLs from route params, HTML snippets, global mutation, private topology loaders, or service responses are outside this profile.

## 6. Consequences

Positive:

1. shell deploys stay decoupled from remote and service deploys.
2. remote and service trust metadata is visible before runtime registration.
3. Zephyr delivery can participate without weakening Modern.js MF artifact contracts.
4. rollback, revocation, and kill switches become deterministic manifest operations.

Tradeoff:

1. every deploy pipeline must publish complete topology metadata.
2. validators must understand both the topology manifest and the Modern.js MF artifact shape.
3. local development needs explicit overlays instead of incidental hardcoded URLs.

## 7. Validation Expectations

Wave 0 only adds the schema and ADR. Validator wiring is owned separately.

Future validation should check:

1. schema validity for topology manifests.
2. no shell source hardcoded remote or service URLs under the Zephyr profile.
3. `withZephyr()` comes from `zephyr-rspack-plugin` and is applied through a Modern.js `modifyRspackConfig` bridge plugin.
4. MF outputs are preserved.
5. remote trust metadata is complete.
6. revoked artifacts are not selectable.
7. kill-switch and LKG paths emit fallback telemetry.

## 8. Acceptance Criteria

1. `contracts/mv-topology-manifest.schema.json` parses as JSON.
2. the schema covers URL indirection, immutable artifact policy, digest, integrity, attestation, environment overlays, cache TTL, LKG, revocation, kill-switch hooks, runtime compatibility, remote trust, fallback telemetry, and profile metadata.
3. this ADR defines Zephyr vanilla Modern.js constraints for `withZephyr`, output, HTML, source, forbidden runtime boot hacks, and dynamic remote URL usage.
