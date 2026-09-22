# Fork simplification audit, 22 September 2026

The fork needs fewer independent implementations of the same decisions. Its largest avoidable costs are workspace projection and transactions, route interpretation, generated API contracts, release verification orchestration, and private dependency layout knowledge. Splitting long files or moving them into more extension packages will not solve those problems.

This audit proposes feature-preserving changes. No framework implementation or test has been deleted. Ten read-only agents reviewed seven subsystem areas, challenged the proposed cuts and refreshed affected findings against the latest fetched fork. Plans describe proposed execution; every implementation task starts pending.

## Evidence and scope

- Final audited fork commit: `ba2f373ad9587642062efc65c763276a68aee909`. An initial scan of local `576fbfe1` was superseded after fetch revealed 70 newer fork commits. Source was rechecked in a detached worktree; obsolete proposals were removed.
- Fixed vanilla ownership baseline: `eded841256a7cffdaa622e3889fc83407debd3e4`, upstream Release v3.8.2 mainline. The patch-equivalent tag is not the comparison base.
- Reviewed upstream provenance recorded by governance: `2f4d9c4559e26209a0d77f02c6757f29fe3699a2`. Later accepted upstream blobs also appear in the ledger. Raw base-to-HEAD differences therefore are not all fork-authored behavior.
- Source worktree was clean. `.beads/issues.jsonl` already contained unrelated local changes; these are excluded from the audit commit.
- Read-only boundary gate passed: **zero governed fork imports; 816 diverging files, 3,076 hunks, 50,882 changed lines**, exactly matching the committed budgets. The detached worktree borrowed installed Babel dependencies through NODE_PATH for this read-only gate. These are governance metrics, not production LOC. The import checker has a separate `8a744c1b` reference.
- Raw Git difference: 3,401 paths, 320,287 added and 39,708 removed lines. These totals include tests, templates, vendor artifacts, documentation, metadata, lockfile changes and accepted upstream changes.

| Area | Raw added lines | Changed paths | Interpretation |
| --- | ---: | ---: | --- |
| ultramodern-create | 52,242 | 270 | Generator, templates, current tooling and tests |
| scripts | 51,932 | 192 | Governance, release, readiness, tests and build tools |
| app-tools-extensions | 16,193 | 79 | Build/deploy behavior and tests |
| server/runtime-extensions | 12,838 | 80 | Server extensions and tests |
| plugin-tanstack | 10,020 | 87 | Router implementation, generation and tests |
| bff-effect | 10,990 | 75 | Effect runtime and tests |
| plugin-bff-extensions | 8,166 | 74 | Build/runtime adapters, policy and tests |
| runtime/runtime-extensions | 8,658 | 65 | Runtime integration and tests |
| sidecars combined | 19,801 | 178 | Predominantly vendored third-party artifacts |

Graph queries guided the initial review; graph health scores from the older checkout are deliberately not presented as current measurements. The final refresh used Git provenance and current source. Several graph queries found no substantial identical function pairs: most duplication identified here concerns repeated interpretation and lifecycle ownership, not copy-pasted function bodies. No deletion is justified by a graph dead-function label.

Runtime failure paths below were inspected, not reproduced. Full builds, browser suites and Tractor acceptance were not run for this documentation-only audit. Agents reported substantial TraceDecay context savings, including approximately 196,600 tokens for generator discovery. These tool estimates do not measure audit quality.

## Work already completed on the fork

The refresh found that native Effect client inference already landed, the handwritten JSX migration parser and framework upgrade/migration machinery were deleted, global mixed-version router fallbacks were retired, and the test purge removed several suites cited in the initial scan. Those are completed cuts, not future work. The generator alone fell by 31,472 net lines between the two revisions, mostly migration and tests. The final plans do not recreate these systems or demand their former compatibility.

Latest AGENTS.md explicitly says UltraModern has no external adoption compatibility requirement yet. Remove obsolete APIs and aliases directly; retain current application features, database migrations and platform interoperability. This materially changes the plan from preserving historical framework migration paths to keeping the current contract small.

## Required behavior

`CONTEXT.md` and `docs/super-app-rfc-adr/ADR-0019-federated-loading-unified-delivery.md` govern the design. A MicroVertical remains one indivisible delivery unit across frontend, SSR, API and backend. Separate units may deploy independently. Node and workerd remain different execution adapters. Published API contracts may cross units; source imports into a neighboring vertical may not.

Preserve React Router and TanStack integration, CSR/string SSR/streaming SSR/RSC, locale identity and navigation, native links, backend integrity and authorization boundaries, typed APIs, batching/cancellation, authored consumer configuration, recovery, independent shells, headless/UI-only/full-stack units, currently supported package formats, release qualification and visible Tractor UI. New subsystems remain in fork-owned packages. Native fixes retain their provenance across renames. Non-shrink native changes require the existing ledger process.

## Ranked cuts

### 1. Give workspace changes one model and one preview transaction

The former nested migration rollback engine is gone. The remaining double staging is in add-vertical preview: `ultramodern-workspace/add-vertical/plan.ts:44` invokes an operation whose execution enters another transaction at `add-vertical/execute.ts:69`. Preview independently reconstructs JSON mutations at `plan.ts:114`. The shared 1,575-line transaction implementation already contains the hardened publisher.

**Cut:** preview-only workspace copying and independent mutation reconstruction. Capture one staged change set, inspect it for preview or publish it for apply. Reuse the existing publisher; keep fresh-workspace and update publication policies distinct. Do not reintroduce migration IO.

Create/add-shell/add-vertical still independently reconstruct app/shell topology, overlays and artifact ownership. Start with the current normalizer and workspace artifact ownership owner, then project each output once. Keep authored fields, explicit empty refs, custom ports/paths and independent shells. This must remove per-command reconstruction, not add a third model alongside it.

**Proof:** preview/apply parity, concurrent edits, owned directories, symlink containment, modes, Windows, failure recovery and retained recovery bytes, staged validation and current headless/UI/full-stack profiles. Failure rollback is not a promise of crash atomicity. Current transaction behavior tests must be selected from the reduced suite rather than restoring removed historical migration tests.

### 2. Package the workspace validator as a program

`templates/workspace-scripts/validate-ultramodern-workspace.mjs.handlebars` has 4,046 lines. The consumer already delegates to an installed CLI through `workspace-scripts.ts:134`, but `commands/validate.ts:113` renders executable source, and `commands/context.ts:86` writes a temporary `command.mjs`, launches Node and removes it. Template lines 74–134 search multiple roots for compiler dependencies.

**Cut:** executable-source rendering, temporary program lifecycle and template-induced dependency discovery. Use typed modules accepting workspace root and immutable expected contract. If isolation is necessary, launch one packaged entrypoint with data. Keep the thin consumer wrapper and current patch/cohort parity checks. Delete obsolete historical recognizers instead of preserving them for nonexistent adopters.

**Proof:** expectations originate in the installed cohort, never solely in the consumer projection being validated. Preserve custom proof routes, diagnostics, exit codes, profile-specific checks and invalid-artifact rejection. Moving 4,046 lines from a template to TypeScript is not itself a 4,046-line saving.

### 3. Consolidate the remaining scaffold rendering

The handwritten JSX migration parser has already been deleted. The current `ultramodern-workspace/demo-components.ts` is 589 lines. Remote scaffold functions at `:446`, `:475` and `:542` still repeat i18n setup, section/title/body markup and boundary wrapping. Shell generation maintains anonymous `value0`–`value20` inputs that must match a second positional contract in the page template.

**Cut:** repeated remote scaffold bodies and anonymous positional template wiring. Use a small parameterized renderer with named expose, translation key, component and locale inputs. Do not introduce a template language or runtime UI dependency.

**Proof:** identical visible markup, native links, translation boundaries, expose IDs, accessibility, Tailwind prefixes and Tractor UI. This is a small cut; approximately 94 lines span the three functions before replacement, not 94 guaranteed deleted lines.

### 4. Normalize routes once for runtime, types and locales

`i18n-extensions/src/localisedUrls/routes.ts:259` expands localized variants, suffixes IDs at `:335` and clones paths at `:382`. `routeIdentity.ts:19` then recovers canonical identities. TanStack reverses expansion in runtime `routeTree/construction.ts:125` and CLI `tanstackTypes/source.ts:51`. The type emitter's 379-line function independently interprets route structure also interpreted at runtime.

**Cut:** TanStack's expand/suffix/clone/deduplicate round trip and separate root/pathless/index/metadata decisions. One normalized route descriptor feeds React Router's physical materializer, TanStack runtime construction and its concrete TypeScript emitter. Reuse existing normalization rather than inventing a compiler framework.

**Proof:** nested parents, index/pathless routes, loaders/actions/search types, optional parameters, splats, collisions, canonical and localized direct SSR, search/hash, generated/runtime tree agreement and browser output without Node imports. Preserve ordinary non-i18n `:lang` routes; locale heuristics must remain explicitly gated.

### 5. Replace router inference and repeated SSR state with explicit contracts

The detector has moved into the fork-owned `i18n-extensions/src/router-navigation/adapter.tsx:186` and `:288`; it still combines native hooks, internal stores, runtime contexts and subscription shapes. Moving ownership fixed placement but did not eliminate inference. `runtime-extensions/src/routerStateTypes.ts` repeats SSR data in state, nested snapshots and prepare results. `routerState.ts:93` and `:246` still reconcile repeated representations.

**Cut:** i18n's framework detective and internal-store dispatch. Each provider supplies typed location/params, native Link and navigation operations. Store one immutable prepared SSR snapshot independently of mutable live router state; remove redundant internal fields while updating their current consumers together.

**Proof:** standalone i18n fallback, native link props and warmup, history, provider replacement, locale params, federated realms, snapshot persistence across live-state updates, string and streaming hydration. The global legacy registry has already been removed; do not restore it.

### 6. Register TanStack resource cleanup when resources are acquired

`plugin-tanstack/src/runtime/plugin.node.tsx:171` attaches SSR resources, then loads, preloads and dehydrates at `:176`, `:223`, `:231`. Cleanup is published only at `:264`. Earlier branches manually clean at `:185`, `:196`, `:218`. Exceptions in preparation can bypass those branches and the late registration. This is a source-supported risk, not a reproduced incident.

**Cut:** scattered cleanup branches and late ownership transfer. One idempotent request disposer handles preparation failure, redirects, abort and response termination. Successful streaming must retain resources until the stream ends.

**Proof:** injected failures at each await, exactly-once disposal, redirect/RSC redirect, CSR fallback, abort, stream cancellation, successful string and delayed streaming SSR. Do not confuse handler-promise draining with response-stream draining. Placement of native cleanup changes follows audited provenance and the ledger.

### 7. Finish operation identity consolidation around the native Effect client

Native Effect client inference and custom source/declaration generator removal already landed through issue `modernjs-0nj1y`. The old generated unknown request/result signatures are no longer a current defect. Keep native inference and published contract imports.

The surviving cut is repeated producer and operation metadata policy. Current `plugin-bff-extensions/src/effect-source-loader/operation-contracts.ts:12`, `cross-project-policy/node.ts:13` and `plugin-bff-build-extensions/src/hono-client-codegen.ts:16` derive related identity inputs through different routes. Native middleware also projects hash metadata at `bff-effect/src/effect-client/cross-project.ts:31` and `:69`.

**Cut:** independent producer lookup, contract assembly and policy projections. One explicit producer/operation description serves native client middleware and server registration, with separate Effect/Hono discovery adapters. Do not introduce another client generator.

**Proof:** precise native request/response/error inference, standalone published contract consumption, operation versions/hashes, producer request IDs, custom transport, context, batching, uploads, mounted prefixes and Hono's optional Effect dependency. Current composed APIs and Effect group combinators are required behavior, not unsupported historical forms.

### 8. Simplify BFF lifecycle state without erasing trust boundaries

`bff-effect/src/data-platform/batch/queue.ts:212` is a 664-line scheduler with overlapping abort, settlement and grouping logic. Defaults repeat in client and `effect/handler/batch-handler.ts:130`. Entry paths also have multiple resolvers in `effect-source-loader/paths.ts`, `effect-source-loader/built-entry.ts` and `effect-adapter/entry.ts`.

**Cut:** repeated defaulting and redundant transition bookkeeping; one normalized batch configuration, pure assembly and one settlement owner. Use a discriminated entry model for app source, app output and external prebuilt SDK; keep their different acceptance rules.

Federation metadata has repeated loose traversal in `backend-federation-manifest/validation.ts:54`, `:161` and `backend-federation/identity.ts:26`. Share decoding and constraint evaluation, but keep independent validation of manifest, downloaded entry and executed expose.

**Proof:** auth/cookie partitioning, safe deduplication, independent cancellation, bounded bytes, deadlines, no mutation replay after ambiguous outcomes, one settlement, source-removed production, external SDKs, strict pinned identity, including rejection of missing compatibility metadata. No generic resolver or permissive validator may replace these distinctions.

### 9. Share bounded federation acquisition while preserving strict executable verification

`server/runtime-extensions/src/backend-federation-security/index.ts:390` and `:622` independently implement fetch, URL/redirect policy, deadlines, caller abort, streamed limits and cleanup. The two original lifecycle bodies occupy roughly 398 lines and remain unchanged in the refreshed source.

**Cut:** one duplicate transport lifecycle. Keep public adapters, generic bounded-resource policy, and the executable-entry policy with exact trusted length, preallocated buffer and SHA-256. The same deadline must span network acquisition, body reading and hashing. Preserve the newer outer manifest/entry/container budget too, including the ten-second default, explicit zero opt-out and settlement of noncooperative plugins/loaders. Calling the generic loader and hashing after it clears its timeout would weaken verification.

**Proof:** overflow cancellation, digest mismatch, timeout including hashing, caller abort, redirect redaction, response mocks that ignore abort, exact verified bytes evaluated once, identity rejection before acquisition and unchanged error codes. Frontend CSS manifests have different URL rules. Their current fetch rejects redirects while allowing direct loopback; retain the live redirect non-contact test. Adoption is conditional on explicit policy parity.

### 10. Make telemetry unable to block degraded fallback

`federation-runtime/src/module-federation/consume-surface.ts:176` explicitly awaits telemetry for test assertions; `:179` and `:237` await before fallback completion. The emitter's fetch at `module-federation/index.ts:255` has no deadline. A never-settling endpoint can hold noncritical fallback indefinitely. The consumer also imports its own re-exporting barrel and reconstructs telemetry payload inputs.

**Cut:** the internal barrel dependency and repeated payload construction. Emit through a bounded best-effort leaf module, with an explicit observer/flush seam for tests. Fallback must not await remote telemetry.

**Proof:** stalled/rejected telemetry cannot block degraded behavior; critical loads still reject the original error; noncritical handler failures remain contained; browser events and HTTP reporting remain. Correct the noncritical undefined type contract and update current callers together.

### 11. Resolve remote addresses once

`surface-resolution/src/surface-resolution/env-static-provider.ts:224–349` and generator `ultramodern-workspace/module-federation/remote-refs.ts:24–65` implement environment/public URL/workers.dev/local fallback separately. Generator line 62 always permits localhost; provider line 249 restricts it to local environments.

**Cut:** generated address-resolution algorithms. The existing surface-resolution owner supplies a pure shared resolver; build code adds only `mfName@` formatting. This requires an explicit decision about missing production configuration because today's paths disagree. Proposed behavior is explicit failure outside local environments, with explicit configuration diagnostics for missing addresses.

**Proof:** all current explicit URL forms and precedence, whitespace, workers.dev, major-version isolation, development localhost, missing production settings and generated/public consumer use. Preserve logical-name addressing and Zephyr-independent configuration.

### 12. Stop encoding package layouts in Cloudflare builds

`app-tools-extensions/src/cloudflare-builder.ts:422–585` performs private-path resolution and alias surgery across TanStack, runtime, renderer, React, Loadable and RSC. `ultramodern-app-tools/src/native-composition/preset.ts:83` separately searches for React Router.

**Cut first:** private path lookup for fork-owned packages, replacing it with owned workerd entries/conditional exports. Keep a small version-tested adapter where dependencies lack a sufficient public export. Preserve bring-your-own React Router. Also preserve current plain appTools defaults and false opt-outs in `policy-defaults.ts`, and app-copy priority/conditional-export behavior in `runtime-package-resolution.ts`. Replacing bare runtime imports with resolved-file aliases would undo these recent fixes.

Inside `code-tools`, `microvertical-api-baseline.ts:38` and `strict-effect-runtime.ts:74` repeat bounded parsing, diagnostic Hub/scope construction and expression unwrapping. Share these mechanics while keeping different policies. Normalize MF SSR capability at composition ingress instead of repeatedly guessing plugin names at `ssr-integration-plugin.ts:26–183`; retain legacy marker translation.

**Proof:** Node/Worker, RSC on/off, singleton identity, optional React Router, isolated pnpm installs, explicit false, marker-only consumers and hook order. Preserve extension-specific JSX parsing, valid generic-arrow TypeScript, relative/reexport/default contract traversal, composed clients, native Effect combinators, lexical mutation rules and the current 256-module/512-binding analysis budgets. Do not add a generic compiler framework.

### 13. Simplify governance without weakening it

`scripts/ultramodern-boundary-check/checker.js:128–574` fingerprints create-request filenames, dependencies, types, exports and AST forms to exempt native behavior from a substring-based import denylist. `divergence.js:1150` and `:1203` already reconstruct rename/provenance ownership.

**Cut:** package-specific fingerprinting only after a resolved ownership/import model subsumes every mutation case. Use shared identity facts, with fail-closed handling of unknown ownership. First demonstrate equivalence against the current gate and adversarial cases.

`divergence.js:1428–1599` is a Markdown table grammar used as a governance database. Replace it with strict versioned structured evidence **inside the same FORK-DIVERGENCE.md**, and derive human tables. Migrate existing evidence and parser together in a reviewed change. Do not reset budgets, change the fixed base, substitute another ledger or exempt whole packages.

**Proof:** policy smuggling, aliases, relative imports, symlinks, rename identity, malformed evidence, same-PR evidence, componentwise shrink, equal-count replacement, unresolved refs, exact accepted upstream blobs and canonical scope. The current gate passes; this is a maintenance cut, not a claim that today's gate is bypassed.

### 14. Make release tooling own policy once

The current publish workflow is 1,738 lines. `scripts/security/validate-github-workflows.mjs:220–658` parses shell and exact release command strings; `github-job-condition.mjs` implements 496 lines of expression/scheduling logic. Reduce inline workflow programs to fixed CLI entrypoints and explicit permission-separated transitions, then remove parser branches made unnecessary by the smaller workflow.

`ultramodern-publish/lib/prepare-bleedingdev-packages/registry.mjs` mixes transport, retry, chronology, provenance, tarball verification, cohort checks and publishing across 1,548 lines. Readiness `published-create-proof/registry-cohort.mjs:24–145` has parallel registry and pool machinery. Share read-only transport and byte verification, while preserving stronger public-registry provenance and separately authorized writes.

`ultramodern-publish/publish-outcome.mjs:23–245` reinterprets acceptance semantics already owned by readiness. Use one pure evidence validator, invoked independently at receipt creation, consumption and outcome boundaries with their own identity/digest requirements. Sharing code does not make a producer's pass flag trustworthy.

**Proof:** OIDC isolation, owner/ref/attempt binding, immutable bundles, dry-run/recovery, failure convergence, exact bytes, redirect/origin rules, propagation retries, source/tooling qualification, forged/partial evidence rejection and child-process drain before cleanup. Use the retained compact workflow/security and job-scheduling tests. Preserve the current 855-second maximum propagation schedule and its dedicated test.

### 15. Remove test infrastructure that compensates for mutable framework builds

`tests/utils/modernTestUtils.js:210` documents a real reentrant startup/read-lock deadlock while a writer waits to rebuild shared dist. `:662` triggers builds; `:52`, `:133`, `:204`, `:288` implement package, reader, reentrant and writer coordination. The current file has 1,346 lines, including a recent reentrant-lock deadlock fix and boot-timeout cleanup. Not all lines are removable.

**Cut:** implicit rebuild discovery/freshness caches and package/dist lock protocols after selected workspace builds become explicit immutable prerequisites. Keep parallel execution, cold-checkout usability, fixture isolation, ports, process cleanup and a small completeness check.

`tests/utils/generatedWorkspaceDependencies.ts:116–395` flattens package dependencies and links every first-party package into every generated package. It can mask undeclared imports and reject legitimate version differences. Replace the now 412-line resolver with actual generated-workspace installs using packed first-party artifacts through package-manager-supported mechanisms. Missing declarations must fail.

The former cross-suite browser matrix was deleted. Two portfolio suites still borrow Playwright from another fixture and use untyped lifecycle code. Use an explicit dependency and typed shared fixture where it reduces actual remaining duplication; preserve navigation/workflow, slow-bootstrap/offline recovery, SSR/CSR and asset-prefix scenarios. Existing test-removal decisions from `modernjs-9vyk` require reconciliation. New assertion deletion candidates require user selection; do not equate this audit with approval to purge tests.

### 16. Make patch and sidecar maintenance reproducible

`patches/README.md:55–68` requires coordinated edits across root/template config, patch copies, inventory and lockfile. Its patch list already differs from current workspace configuration. `ultramodern-workspace/shared-patches.ts:3–13` classifies patches through filename prefixes.

**Cut:** independent authored patch copies and prefix classification. One canonical inventory records package/version, bytes and distribution scope; packaging materializes self-contained generator assets and documentation/config fragments. Lockfiles remain package-manager-generated.

Sidecars contribute 19,801 mostly vendored lines. `rsbuild-image-core/scripts/verify-manifest.mjs:181` finds upstream in the incidental pnpm store, and `:226` skips dist comparison when absent. Use pinned artifact integrity plus declarative reviewed transformations and deterministic verification, independent of local store contents.

**Proof:** packed generator patch application, parser time bounds across module formats, valid images, sharpening behavior, exports, CLI, peer compatibility, browser-safe imports, provenance and licenses. Moving vendor bytes elsewhere is not a runtime-code saving. Retire sidecars only after upstream replacements pass these same checks; current external release availability was not researched.

## Assurance gap exposed by the refresh

Governance/release production complexity barely changed while much of its test corpus disappeared. `divergence.test.js`, `publish-security.test.js`, `patch-sync.test.ts`, the former consume-surface suite and native-request classifier mutation cases are no longer retained. Do not cite them as current protection or bulk-restore them.

The publish workflow now explicitly documents that builtin-only inline Node imports are not currently test-enforced at `:221–224`, and that source/published Tractor pin equality is maintained by hand at `:868`. Remove the duplicated fragile constructs, then keep a few direct invariant checks at the actual trust boundaries. This is a stronger code-cut target than rebuilding thousands of assertions around the same machinery.

Current useful anchors include boundary `checker.test.js:59/115/144/162/184`, workflow validator and job-condition tests, `registry-verification-schedule.test.mjs:9`, `publish-outcome.test.js:451/508/533`, acceptance receipt identity/retry tests and generator `patch-parity.test.ts:59/87/108/131`. Add only focused behavioral or adversarial checks needed for changed contracts and currently unprotected failure paths.

## Ambitious cuts that need a replacement proof first

| Candidate | Evidence | Required proof before deletion |
| --- | --- | --- |
| Process-global build environment leases | `app-tools-extensions/src/build-config/build-environment.ts:73–340`; only production caller found leases `ZE_FAIL_BUILD` | Explicit supported Zephyr failure policy, concurrency/watch/failure behavior and updates to all current callers. Roughly 240 lines are a candidate, not guaranteed savings. |
| Response-time remote JavaScript regex rewriting | `server/runtime-extensions/src/static-serving/staticModuleFederation.ts:159` | Compiled Webpack/Rspack public paths across prefixes/proxies, CSS/lazy chunks, methods and compression. Keep current rewrite until equivalent behavior exists. |
| Declaration extraction and regex repairs | `scripts/prebundle/ultramodern/public-declarations.mjs:36–246` | Dependency-owned public option types and strict packed ESM/CJS consumers without leaked Webpack dependencies. The old custom TS emitter is already gone. |
| Duplicate native/fork drain handles | `runtime-extensions/src/runtimeLifecycle.ts:67`; `server/src/dev-tools/reloadManager.ts:18` | Ownership-safe native seam without reverse dependency, current caller parity and exact handler-promise semantics. Do not add a package cycle to save a small helper. |
| Build-envelope rediscovery | `app-tools-extensions/src/cloudflare/index.ts:95/207/237`; `release-envelope/framework-output.ts:1077` | One carried artifact inventory with independent final digest verification, preserved atomic delivery and no trust in unchecked producer summaries. |

These are recorded follow-ups, not unconditional deletion tasks. Canonical internal delivery identity and current wire projections can be consolidated sooner at `backend-federation-contracts/.../build-artifact.ts:23` and `:187`. Keep independently received identity comparisons and standard MF interoperability. Remove obsolete aliases when current consumers are updated together; no external-adoption migration is required. Dirty/non-Git development builds may omit envelopes, while deployment must still require promotable identity.

## What this audit rejects

Do not remove supported routers, SSR modes, workerd fragments, recovery, receipt provenance, hashes, exact-length checks, CSS last-good/coalescing behavior or consumer ownership protection. Do not replace native links with app workarounds. Do not mistake accepted upstream changes for fork subsystems. Generated host skill mirrors remain untracked. The sync script has already lost obsolete cleanup logic; do not count nonexistent mirror files as deletion opportunities. Do not reopen already-removed custom declaration emission. Do not collapse unrelated trust boundaries merely because their fields look similar.

There is no honest total deletion estimate yet. Each implementation lane must report before/after production lines, generated lines, tests, public contracts and decision owners separately. A cut succeeds when an independent implementation disappears and its required behavior remains, not when code changes directories. Net growth needs a concrete justification and review, not a hidden framework-sized abstraction.

## Execution handoff

The exact proposed plan set is `.codex/plans/fork-cuts-20260922/*.plan.md`. The handoff document alongside this audit records validated graph identity, selection, dependencies, tracker IDs and commands. Start with the preservation/ownership baseline, then independent owner lanes, then packed-consumer and Tractor acceptance. Do not run all existing plans: the repository contains historical plans whose statuses may be stale. Reconcile overlapping Beads work, especially `modernjs-0nj1y`, `modernjs-5bov` and `modernjs-9vyk`, before implementation.

Implementation is not part of this audit. No release was published. The plan keeps current API and platform-interoperability decisions explicit, and requires feature parity before removing their current implementations.
