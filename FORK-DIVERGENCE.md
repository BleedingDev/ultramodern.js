# FORK-DIVERGENCE — canonical divergence ledger

**Verified: 2026-08-24.** Every row below was re-checked against the working
tree on that date. Rows carry their own `Verified` date only when it differs.

**Partially re-verified 2026-08-16** for the upstream 3.8.2 merge: §2 bases and
counts, §3 reconciliation, CLI-19, CLI-20, SRV-20, SRV-21, SRV-22, SRV-23 and
notes N9/N10. Rows outside that set still carry the 2026-08-11 date.

**Re-verified 2026-08-24** for the upstream sync through `3748f08860`: §2
bases and counts, §3 reconciliation, and every base-transition growth entry.

**Re-verified 2026-08-25** for the upstream sync through `f4bc5ee335`: §2
bases and counts and §3 reconciliation. The re-anchor changed no cumulative
per-file divergence budget. The later RT-23 capped patch added five governed
changed lines without changing the file or hunk totals.

**Re-verified 2026-08-26** after restoring the fixed `eded841256` audited
measurement point while retaining the complete upstream sync through
`f4bc5ee335` in `HEAD`: §2 bases and §3 base-transition ownership. The
sanctioned reviewed writer recorded the exact totals below.

**Re-verified 2026-08-30** for the upstream v3.8.3 sync through `2f4d9c4559`:
§2 sync-review counts and the complete nine-entry transition review history.
The synced source remains in `HEAD`, including #8836's monitor-native CSR
fallback reporting. The divergence gate now preserves `eded841256` as its
immutable ownership base and recognizes exact `2f4d9c4559` source as reviewed
upstream provenance; no upstream update was rolled back.

This file is the single canonical record of where the UltraModern fork diverges
from upstream Modern.js. It is read during every upstream sync and enforced on
every PR.

---

## 1. Maintenance contract

**Rows below that cover upstream-owned paths under `packages/**` are enforced
by the boundary checker's shrink-only divergence allowlist (§3); fork-added
package paths and every root/infra path in this ledger are hand-review-only.**

- Gate: `node scripts/ultramodern-boundary-check/check-fork-import-boundary.js`
  (`--mode divergence`), wired into `validate:boundary-check` and
  `.github/workflows/boundary-anti-patterns.yml`.
- Baseline: `scripts/ultramodern-boundary-check/divergence-allowlist.json`,
  one entry per upstream-owned file recording `hunks` and `changedLines` only.
- Semantics are **shrink-only**. The gate fails on
  `unallowlisted-divergence`, `line-budget-exceeded`, or
  `hunk-budget-exceeded`. Shrinking always passes, where a shrink is
  componentwise: neither per-file metric (hunks, changed lines) may grow and at
  least one decreases — a net line shrink that splits into extra hunks still
  fails the hunk budget.

**The two-bucket rule** (`AGENTS.md` Rule 5). Every change under `packages/**`
is in exactly one bucket:

- **Bucket A — additive fork behavior** (new features, subsystems, plugins,
  gates, instrumentation). It MUST live in a fork-owned package. Fork-owned
  files carry no divergence budget and are **never listed in this ledger**.
- **Bucket B — changes to upstream-owned lines** (any file that exists at the
  audited base, with that ownership preserved across renames). Allowed only as
  one of three resolutions:
  1. a PR to upstream `web-infra-dev/modern.js`,
  2. use of an existing upstream extension point, or
  3. a **capped patch of at most 20 added-plus-removed PR lines** per
     audited-base-owned file, with a matching row in this ledger.

Every `packages/**` row below is a Bucket-B divergence except TK-10, which the
row itself flags as a fork-added directory carrying no budget; §4's root/infra
rows sit outside the two-bucket rule's `packages/**` scope entirely.

Every non-shrink Bucket-B change requires exactly one strict path-first ledger
row **in the same committed range**. The row must name the exact immutable
audited identity (the old path for a rename), a nonempty owner and reason, and
one or more full tokens from the disposition vocabulary below. Whitespace or
table reformatting, unrelated/grouped paths, broad advisory rows, duplicate
rows, and unchanged historical rows are not evidence. A componentwise genuine
shrink needs no ledger ceremony; an equal-count semantic replacement or rename
is a non-shrink. Plain
`--write-divergence-allowlist` only records shrink. A raised budget or new entry
must be generated with the reviewed writer operation:

```sh
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --write-divergence-allowlist --record-growth \
  --merge-base "$PR_MERGE_BASE" --head "$COMMITTED_HEAD"
```

That operation fails unless every raised audited-base-owned file has at most 20
added-plus-removed lines in the PR and has its strict ledger row in the same
committed range. CI independently resolves both refs, reads the committed
allowlists, semantically compares ledger rows, re-measures the full recorded
scope, and re-derives the cap and ledger evidence; a hand-edited baseline cannot
authorize growth by itself. Scope changes use
`--rebase-divergence-allowlist` with the same refs and ledger evidence. The
audited ownership and reviewed provenance SHAs are exact pins; provenance
cannot be advanced by resetting the snapshot.

**Owner.** Every entry is owned by the repo owner **`bleedingdev`** unless the
row names someone else. Owner means: accountable for the disposition landing,
and the person a sync conflict in that file is escalated to.

**Related:** `AGENTS.md` Rule 5 (two-bucket fork boundary),
`scripts/ultramodern-boundary-check/README.md` (both gates),
`docs/super-app-rfc-adr/ADR-0006-boundary-anti-pattern-checks.md`, and
`docs/super-app-rfc-adr/ADR-0022-upstream-freeze-or-track.md` (proposed; the
freeze-vs-track decision determines whether the `upstream-PR` dispositions below
are ever actually filed).

### Disposition vocabulary

| Disposition | Meaning |
| --- | --- |
| `upstream-PR` | Bucket B resolution (1). Isolatable and PR-able to web-infra-dev/modern.js as-is. |
| `extension-point` | Bucket B resolution (2). Logic should move out of the upstream file into a fork-owned module; budget shrinks when it does. |
| `capped-patch` | Bucket B resolution (3). Stays inline, at most 20 added-plus-removed PR lines per audited-base-owned file, kept deliberately. |
| `fixed-in-fork` | Upstream defect repaired in the fork. Keep the repair; add `upstream-PR` separately when the fix is queued upstream. |
| `keep-deleted` | Upstream artifact intentionally deleted in the fork. Re-delete it on sync and port upstream changes to its replacement when applicable. |
| `keep-[F]` | Permanent fork divergence. Only meaningful with the ultramodern lanes (Effect BFF, TanStack, Module Federation, telemetry, tsgo). Never resolved toward upstream. |
| `keep-[M]` | Mechanical (biome sorting, pragmas, tsconfig, toolchain package.json churn). Safe to take either side; prefer upstream then re-run tooling. |
| `revert` | Scheduled revert to upstream behavior. Carries a P-lane. |
| `fix` | Fork bug, not a divergence worth keeping. Carries a P-lane. |
| `owner-decision` | Disposition not yet decided; blocked on the owner. Carries a P-lane. |

P-lanes: **P1** next, **P2** near-term, **P3** scheduled, **P4** owner-gated.

---

## 2. Bases and counts

Three identities are in play. Do not mix them.

| Base | SHA | Used by | Meaning |
| --- | --- | --- | --- |
| Divergence ownership base | `eded841256a7cffdaa622e3889fc83407debd3e4` | `divergence-allowlist.json`, `--mode divergence` | immutable audited identity point: upstream's `Release v3.8.2 (#8810)` mainline commit; ownership survives renames |
| Reviewed upstream provenance | `2f4d9c4559e26209a0d77f02c6757f29fe3699a2` | `divergence-allowlist.json`, `--mode divergence`, sync review | exact upstream v3.8.3 source retained in `HEAD`; changes from the ownership base through this commit are resolution (1), already upstream |
| Import-gate base | `8a744c1b` | `allowlist.json`, `--mode imports` | frozen import-boundary baseline, deliberately **not** re-anchored with the divergence base |

The gate derives identity from `eded841256`, subtracts exact reviewed upstream
source through `2f4d9c4559`, and measures the remaining cumulative fork patch
from `2f4d9c4559` to the target. It then groups that patch back onto immutable
audited identities. The parallel `v3.8.2` tag (`e642cd16`) is patch-equivalent
to `eded841256` but is not an ancestor and is not a valid substitute. Neither
`HEAD` nor a PR merge-base can substitute for reviewed provenance.

Raw `git diff -M <base> --name-status` sync review (committed head vs
`2f4d9c4559`) at 2026-08-30:

| Scope | Base | M | A | D | R |
| --- | --- | --- | --- | --- | --- |
| `packages/**` | `2f4d9c4559` (synced `origin/main`) | 584 | 859 | 11 | 18 |
| root/infra (`:(exclude)packages/**`) | `2f4d9c4559` | 424 | 716 | 8 | 39 |

Regenerate with rename detection pinned on — without `-M` the template moves
surface as delete/add pairs:

```sh
git diff -M 2f4d9c4559e26209a0d77f02c6757f29fe3699a2 --name-status -- packages
git diff -M 2f4d9c4559e26209a0d77f02c6757f29fe3699a2 --name-status -- . ':(exclude)packages/**'
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --mode divergence --json
```

Files inside explicit fork-owned package roots (`@modern-js/plugin-tanstack`,
`@modern-js/server-runtime-extensions`, and the other roots listed by the
checker) carry no divergence budget when that package root was absent at the
reviewed provenance. Every new file placed later inside a vanilla upstream
package remains governed, including executable or product inputs under
`tests`, `fixtures`, `examples`, or `docs`; lexical naming never makes it
fork-owned.

---

## 3. Allowlist reconciliation

The canonical budget remains **613 files / 2,782 hunks / 34,329 changed
lines**. Schema v2 preserves every v1 per-file budget and total byte-for-byte;
it changes only the model around those budgets: `eded841256` is the immutable
identity base and `2f4d9c4559` is reviewed provenance. Exact upstream-only
changes between those commits consume no budget. The older **614 files / 2,791
hunks / 33,841 changed lines** number was a direct `eded841256..HEAD`
composition and is retained only as historical evidence, not as the current
budget contract.

The canonical verification is:

```sh
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --mode divergence
```

The newer upstream source remains present in `HEAD`. The historical transition
tables below document prior reviews only and do not authorize current growth or
a future provenance debt reset.

### 2026-09-02 app-tools deployment-template packaging repair

| Upstream-owned path | Owner | Reason | Disposition |
| --- | --- | --- | --- |
| `packages/solutions/app-tools/rslib.config.mts` | bleedingdev | Copy the deployment entry templates into every compiled output so `createNodePreset` and the other runtime deployment readers receive the required CJS and ESM files; retain upstream #8819's duplicate-loader fix | `capped-patch` + `fixed-in-fork` + `upstream-PR` |
| `packages/solutions/app-tools/tests/config/verify-public-surface.mjs` | bleedingdev | Verify both compiled formats contain the complete deployment-template set so an incomplete app-tools tarball fails during its producer build rather than clean-room application acceptance | `capped-patch` + `fixed-in-fork` + `upstream-PR` |
| `packages/solutions/app-tools/tests/deploy/cloudflare.test.ts` | bleedingdev | Regress the fork-owned Cloudflare streaming stylesheet injector against route CSS already rendered before the distributed-SSR sentinel, preventing duplicate links in workerd output without changing app-tools runtime ownership | `capped-patch` + `fixed-in-fork` |
| `packages/runtime/plugin-runtime/src/core/context/extensions.ts` | bleedingdev | Make the internal symbol slot enumerable so SSR object spreads preserve extension state while string-key enumeration and JSON remain unchanged | `capped-patch` + `fixed-in-fork` + `upstream-PR` |

### Historical 2026-08-30 v3.8.3 transition: complete raised set

| Upstream-owned path | Owner | Transition reason | Disposition |
| --- | --- | --- | --- |
| `packages/cli/builder/tests/__snapshots__/default.test.ts.snap` | bleedingdev | Re-anchoring after the retained upstream Rsbuild work changes the comparison side of the fork's generated builder snapshot; the snapshot remains generated evidence, not newly authored runtime behavior | `keep-[M]` |
| `packages/cli/builder/tests/__snapshots__/environment.test.ts.snap` | bleedingdev | Same reviewed builder-snapshot base transition as `default.test.ts.snap`; the larger cumulative deletion reflects the newer upstream fixture, not a fork subsystem added inline | `keep-[M]` |
| `packages/cli/plugin-data-loader/package.json` | bleedingdev | The v3.8.3 package identity and retained UltraModern toolchain cohort split the mechanical manifest delta into one additional hunk while reducing changed lines | `keep-[M]` |
| `packages/cli/plugin-ssg/package.json` | bleedingdev | The v3.8.3 package identity changes hunk shape while the retained manifest divergence falls in total lines | `keep-[M]` |
| `packages/document/package.json` | bleedingdev | The v3.8.3 release baseline changes mechanical manifest hunk shape while cumulative changed lines shrink | `keep-[M]` |
| `packages/runtime/plugin-i18n/package.json` | bleedingdev | Upstream 3.8.3 is adopted, including the `@modern-js/runtime` peer baseline; the fork retains its reviewed React 19 peer cohort (RT-22), producing two extra hunks but fewer changed lines | `keep-[F]` (dependency cohort) |
| `packages/runtime/plugin-image/package.json` | bleedingdev | The v3.8.3 release baseline changes only mechanical manifest hunk shape and reduces the cumulative line delta | `keep-[M]` |
| `packages/runtime/render/package.json` | bleedingdev | The v3.8.3 package baseline and retained fork RSC/toolchain metadata split the manifest delta while reducing cumulative lines | `keep-[M]` |
| `packages/server/core/src/plugins/render/render.ts` | bleedingdev | #8836's monitor-native CSR fallback reporting is adopted and the obsolete plugin hook is removed; the fork retains only its existing `serverContext` propagation into `SSRRenderOptions` | `capped-patch` (existing render seam; 2 retained fork lines relative to upstream) |

No other raised/new path belongs to this transition.

### 2026-08-26 fixed-base transition: complete raised/new set

| Audited-base-owned path | Owner | Backward-base transition reason | Disposition |
| --- | --- | --- | --- |
| `packages/cli/adapter-rstest/package.json` | bleedingdev | The fully retained post-v3.8.2 upstream Rstest cohort changes are visible when the manifest is measured from the older fixed audit point; this is mechanical dependency metadata, not new PR-authored behavior | `keep-[M]` |
| `packages/cli/builder/package.json` | bleedingdev | Retain the post-v3.8.2 upstream builder toolchain manifest and upgrade the fork's opt-in Rsdoctor diagnostics from 1.5.17 to 1.6.3 while the workspace override resolves its Socket.IO 4.8.1 chain to patched `socket.io-parser` 4.2.7 | `capped-patch` + `keep-[M]` |
| `packages/cli/builder/tests/__snapshots__/postcssLegacy.test.ts.snap` | bleedingdev | The synced upstream snapshot regeneration occurred after the fixed audit point, so measuring backward exposes its generated snapshot delta | `keep-[M]` |
| `packages/cli/plugin-bff/package.json` | bleedingdev | The fully retained post-v3.8.2 upstream BFF manifest edits are newly measurable from the older base; this row records mechanical cohort identity rather than fork-side feature growth | `keep-[M]` |
| `packages/cli/plugin-data-loader/package.json` | bleedingdev | The synced upstream data-loader manifest cohort is newer than the fixed audit point and therefore raises the cumulative older-base measurement | `keep-[M]` |
| `packages/cli/plugin-ssg/package.json` | bleedingdev | The synced upstream SSG dependency metadata remains in `HEAD`; returning to the older base makes those mechanical lines measurable again | `keep-[M]` |
| `packages/cli/plugin-styled-components/package.json` | bleedingdev | The post-v3.8.2 upstream styled-components plugin bump remains fully incorporated and is visible relative to the fixed audit point | `keep-[M]` |
| `packages/document/package.json` | bleedingdev | The synced documentation dependency/toolchain manifest is newer than the fixed audit point; the resulting delta is mechanical metadata | `keep-[M]` |
| `packages/runtime/plugin-i18n/package.json` | bleedingdev | The fully retained upstream runtime dependency cohort after v3.8.2 is visible in the older-base cumulative diff | `keep-[M]` |
| `packages/runtime/plugin-image/package.json` | bleedingdev | The fully retained upstream image-plugin dependency cohort after v3.8.2 is visible in the older-base cumulative diff | `keep-[M]` |
| `packages/runtime/plugin-runtime/package.json` | bleedingdev | The synced plugin-runtime manifest updates postdate the fixed audit point, so their mechanical dependency delta is newly measured | `keep-[M]` |
| `packages/runtime/render/package.json` | bleedingdev | The synced React/RSC render cohort remains in `HEAD` and becomes measurable relative to the older v3.8.2 mainline point | `keep-[M]` |
| `packages/server/core/package.json` | bleedingdev | The fully retained upstream server-core manifest updates postdate the fixed audit point and surface as mechanical cumulative divergence | `keep-[M]` |
| `packages/server/server/package.json` | bleedingdev | The fully retained upstream server manifest updates postdate the fixed audit point and surface as mechanical cumulative divergence | `keep-[M]` |
| `packages/solutions/app-tools/package.json` | bleedingdev | The synced app-tools dependency/build cohort remains complete in `HEAD`; measuring from v3.8.2 exposes its mechanical manifest delta | `keep-[M]` |
| `packages/solutions/app-tools/tests/fixtures/subcommand/package.json` | bleedingdev | The synced fixture manifest update postdates the fixed audit point, so its test-fixture dependency delta is mechanically measurable | `keep-[M]` |
| `packages/toolkit/plugin/package.json` | bleedingdev | The fully retained upstream toolkit plugin manifest cohort postdates the fixed base and is exposed by the backward measurement | `keep-[M]` |
| `packages/toolkit/runtime-utils/package.json` | bleedingdev | The fully retained upstream runtime-utils manifest cohort postdates the fixed base and is exposed by the backward measurement | `keep-[M]` |
| `packages/toolkit/sandpack-react/package.json` | bleedingdev | The synced Sandpack manifest updates remain in `HEAD`; their post-v3.8.2 dependency delta is mechanical | `keep-[M]` |
| `packages/toolkit/utils/package.json` | bleedingdev | The fully retained upstream toolkit-utils manifest cohort postdates the fixed base and is exposed by the backward measurement | `keep-[M]` |

The table is the same-PR ownership evidence for the complete base-transition
increase. It does not claim that later upstream lines are fork-authored, and it
must not be used to waive the 20-line cap for any unrelated change in those
files.

The seven entries that grew across the historical forward 2026-08-24 base
transition were inspected and are
dispositioned here. None is an ordinary fork-side PR growth or a merge-resolution
defect:

| Audited-base-owned path(s) | Owner | Base-transition reason | Disposition |
| --- | --- | --- | --- |
| `packages/cli/builder/tests/__snapshots__/{default,environment}.test.ts.snap` | bleedingdev | Upstream regenerated and enlarged snapshots the fork intentionally deleted after replacing them with focused assertions; the new base therefore measures larger deletions | `keep-deleted` |
| `packages/cli/plugin-ssg/package.json` | bleedingdev | Upstream dependency edits split the retained mechanical manifest divergence into 5 hunks while changed lines fell 24 → 20 | `keep-[M]` |
| `packages/document/package.json` | bleedingdev | Upstream dependency edits split the retained mechanical manifest divergence into 10 hunks while changed lines fell 40 → 34 | `keep-[M]` |
| `packages/runtime/plugin-i18n/package.json` | bleedingdev | Upstream React/dependency edits split the retained fork cohort manifest into 11 hunks while changed lines fell 42 → 38 | `keep-[M]` |
| `packages/runtime/plugin-image/package.json` | bleedingdev | Upstream dependency edits split the retained mechanical manifest divergence into 5 hunks while changed lines fell 17 → 13 | `keep-[M]` |
| `packages/runtime/render/package.json` | bleedingdev | Upstream React/RSC dependency edits split the retained fork cohort manifest into 10 hunks while changed lines fell 46 → 38 | `keep-[M]` |

### Current dependency-cohort non-shrinks

These audited-base-owned files are equal-count replacements in the current
UltraModern dependency-cohort change. They do not raise the canonical
divergence budget, but remain non-shrinks and therefore require explicit
same-PR ownership and disposition evidence.

| Audited-base-owned path(s) | Owner | Reason | Disposition |
| --- | --- | --- | --- |
| `packages/cli/{adapter-rstest,builder,plugin-bff,plugin-data-loader}/package.json`, `packages/runtime/plugin-runtime/package.json`, `packages/solutions/app-tools/package.json`, `packages/toolkit/plugin/package.json` | bleedingdev | Promote the full framework build/test surface atomically from the Rsbuild 2.2 release candidate to stable 2.2.0; mixed RC/stable installs would invalidate the Rspack, Module Federation, Tailwind, React Compiler, and chunk-splitting acceptance evidence | `keep-[M]` |
| `packages/cli/plugin-bff/package.json` | bleedingdev | Keep the optional Effect peers, mirrored development identities, and Module Federation runtime on the coherent fork cohort; a partial update can install incompatible Effect identities | `keep-[F]` |
| `packages/toolkit/create/package.json` | bleedingdev | Keep the generator's formatter and Ultracite runtime dependencies aligned with the generated Oxc toolchain policy | `keep-[M]` |
| `packages/toolkit/create/README.md` | bleedingdev | Keep package documentation truthful to the fork's generated Effect, TanStack, Module Federation, and pnpm cohort | `keep-[F]` |
| `packages/document/docs/en/components/prerequisites.mdx` | bleedingdev | Keep the documented pnpm bootstrap command aligned with the fork's generated and CI toolchain | `keep-[M]` |
| `packages/document/docs/zh/components/prerequisites.mdx` | bleedingdev | Keep the translated pnpm bootstrap command aligned with the fork's generated and CI toolchain | `keep-[M]` |
| `packages/toolkit/types/packages/hoist-non-react-statics.d.ts` | bleedingdev | Remove a redundant `declare` modifier from an already ambient module so the published declaration compiles under TypeScript without a diagnostic suppression | `capped-patch` + `fixed-in-fork` |
| `packages/toolkit/utils/src/compiled.ts` | bleedingdev | Preserve the public `yaml.load` and `yaml.dump` namespace in native CommonJS and ESM after js-yaml 5 removed its generated default export | `capped-patch` + `fixed-in-fork` |
| `packages/cli/plugin-styled-components/src/runtime.ts` | bleedingdev | Import the strongly typed runtime-plugin authoring contract so tsgo preserves the collector callback context instead of inferring an implicit `any` | `capped-patch` + `fixed-in-fork` |

### 2026-09-01 runtime cone non-shrinks

These audited-base-owned files change without a componentwise cumulative shrink
in the same committed range. They do not raise the canonical divergence budget
and no writer operation is run for them; each carries its own strict ownership
and disposition evidence.

| Audited-base-owned path | Owner | Reason | Disposition |
| --- | --- | --- | --- |
| `packages/runtime/plugin-runtime/src/router/runtime/PrefetchLink.tsx` | bleedingdev | Read the Webpack-supplied `__webpack_public_path__` magic global inside `try`/`catch` so a non-Webpack realm returns an empty public path instead of throwing a `ReferenceError` on an undeclared identifier; RT-09 prefetch behavior is unchanged and RT-07/RT-08 remain scheduled | `capped-patch` + `fix` |
| `packages/runtime/plugin-runtime/tests/router/prefetch.test.tsx` | bleedingdev | Extend the audited-base-owned router prefetch regression to cover the non-Webpack realm so the `PrefetchLink.tsx` public-path guard cannot regress silently | `capped-patch` + `fix` |
| `packages/server/utils/src/compilers/typescript/index.ts` | bleedingdev | Resolve the generated stable `@typescript/native` alias and its `bin.tsc` entry before retaining the legacy native-preview fallback, so BFF/server compilation uses the compiler identity emitted by the UltraModern generator | `capped-patch` + `fixed-in-fork` |
| `packages/server/utils/tests/tsgo.test.ts` | bleedingdev | Pin stable `@typescript/native` binary resolution while preserving the existing native-preview compatibility regressions | `capped-patch` + `fixed-in-fork` |
| `packages/runtime/plugin-i18n/package.json` | bleedingdev | Expose consumer-only i18n runtime declarations, including the generated no-react-i18next alias shape, so federated declaration generation does not enter plugin-authoring and build-tool declarations | `capped-patch` + `fixed-in-fork` |
| `packages/runtime/plugin-i18n/tests/linkTypes.test.ts` | bleedingdev | Compile the emitted consumer declaration graph under tsgo and reject any path back into builder, app-tools, runtime-plugin internals, or toolkit utility declarations | `capped-patch` + `fixed-in-fork` |

### 2026-09-01 skill-suite anchor repair

This audited-base-owned file changes without a componentwise cumulative shrink
in the same committed range; it carries its own strict ownership and
disposition evidence and no writer operation is run for it.

| Audited-base-owned path | Owner | Reason | Disposition |
| --- | --- | --- | --- |
| `tests/skill/run.mjs` | bleedingdev | Re-anchor the suite's esbuild `createRequire` at the fork-owned `ultramodern-create` package after the create extraction removed the vanilla `create` esbuild dependency, so the migrate-to-v3 regression suite can execute at all | `capped-patch` + `fix` |

The group breakdown below is the last hand-classified snapshot, taken at
`dfcd414a`. It is advisory attribution only — the gate reads per-file budgets,
never these groups — and is regenerated by hand, not by the writer.

| Allowlist group | Files | Hunks | Lines | Ledger coverage |
| --- | ---: | ---: | ---: | --- |
| Source trees (`packages/**/src/**`) | 352 | 1,824 | 14,556 | Existing package-family rows below |
| Tests and test fixtures | 66 | 309 | 14,368 | Corresponding package-family rows |
| Manifests and build/type configs | 66 | 284 | 1,237 | Corresponding package-family rows |
| Snapshots and package documentation | 116 | 358 | 2,774 | Corresponding package-family rows |
| Other package files outside `src/` | 23 | 50 | 736 | Corresponding package-family rows |
| Templates outside `src/` | 10 | 10 | 154 | Corresponding package-family rows |
| **Total (at `dfcd414a`)** | **633** | **2,835** | **33,825** | Sections 5–9 |

**What the budget covers.** Divergence mode measures every modified or deleted
path under `packages/` that existed at the audited base, regardless of file
extension or directory. This includes source files, tests, `package.json`,
TypeScript and build configs, snapshots, package documentation, templates, and
other package-owned artifacts. Each path has independent hunk and changed-line
budgets; either metric growing is governance-significant.

The allowlist itself is compared with its PR merge-base version. Verification
uses only its validated, canonical full scope; callers cannot narrow it with a
pathspec, nested root, alternate file, or inherited Git context. Every entry,
budget, total, base OID, and base-tree path is validated before measurement. A
raised metric or new entry is accepted only when it exactly matches the
committed-head measurement, its audited-base-owned PR delta is at most 20
added-plus-removed lines, and `FORK-DIVERGENCE.md` changes in the same PR. Base
or scope transitions require the explicit reviewed re-record operation plus the
same ledger evidence. Section 4 remains outside the divergence pathspec because
it covers root and infrastructure files outside `packages/`.

---

## 4. Root and infra (outside `packages/**`) — not budget-enforced

| ID | What diverged | Owner | Reason | Disposition | Lane |
| --- | --- | --- | --- | --- | --- |
| ROOT-01 | `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, root `package.json`, `nx.json`, `biome.json`, `.gitignore`, `.mise.toml` | bleedingdev | Fork package-manager, Renovate/security, tsgo/rstest/biome and publish policy | keep-[F] | — |
| ROOT-02 | Effect cohort pinned lockstep across generator and BFF surfaces (`4.0.0-rc.112`) | bleedingdev | Upstream has no Effect lane; a partial revert leaves generated workspaces and plugin-bff on incompatible Effect identities | keep-[F] — see note N1 | — |
| ROOT-03 | Generated dependency/toolchain cohort pins (tsgo 0.37.0, TanStack Router 1.170.32/core 1.171.27/history 1.162.1, MF 2.9.0, `@module-federation/node@2.7.50`, Node 26.7.0, pnpm 11.24.0) | bleedingdev | Generator, templates, validation and docs must agree or generated workspaces break | keep-[F] | — |
| ROOT-04 | 15 `examples/**` members use `workspace:*`; upstream uses `latest` | bleedingdev | Upstream's spelling installs real Modern.js 3.7.0 beside the fork and pnpm non-deterministically hoists one | keep-[F] — see note N2 | — |
| ROOT-05 | `patchedDependencies` for MF 2.9.0 (`manifest`, `rspack`, `bridge-react`, `modern-js-v3`) and TanStack router-core 1.171.27 | bleedingdev | MF lazy-DTS/SSR/topology and strict TanStack declaration lanes | keep-[F] | — |
| ROOT-07 | `pnpm-workspace.yaml` negative globs `!tests/integration/**/{dist,node_modules}/**` | bleedingdev | Gitignored build output emits `package.json` files that match the positive globs and add phantom importers to the lockfile | keep-[F] | — |
| ROOT-08 | 10 fork-owned workflows added | bleedingdev | Fork gates (boundary, contract, publish, certification, nightly, readiness, security), docs publishing (`docs-pages`), bun smoke (`bun-superapp-smoke`), and Tractor downstream acceptance (`ultramodern-tractor-downstream`) | keep-[F] | — |
| ROOT-09 | Modified upstream workflows (dependency check, diff, integration, lint, type-check, unit, builder e2e, issue labels) | bleedingdev | Fork toolchain + gate wiring | capped-patch — reconcile upstream infra fixes by hand | — |
| ROOT-10 | Release tags namespaced `ultramodern-v<version>`, never `v<version>` | bleedingdev | 277 inherited upstream `v*` tags; `gh release create` reuses a pre-existing tag and silently ignores `--target` | keep-[F] — see note N3 | — |
| ROOT-11 | `publish-change-record` is the only `contents: write` job, asserted as a closed set | bleedingdev | Publish-workflow privilege containment | keep-[F] | — |
| ROOT-12 | Fork-owned script families (`boundary-guards`, `ultramodern-boundary-check`, `lib`, `release-gates`, `security`, `superapp-certification`, `ultramodern-production-readiness`, `ultramodern-publish`, `prepare-root.mjs`, tsgo helpers) | bleedingdev | Fork CI surface | keep-[F] | — |
| ROOT-13 | Modified upstream script packages | bleedingdev | tsgo/rstest/toolchain and package.json churn | keep-[M] — prefer upstream fixes, keep fork executable paths | — |
| ROOT-14 | `scripts/build/bin/modern.js` and `scripts/build/src/cli_core_init.js` deleted | bleedingdev | Docs-command binary cleanup was never decided | owner-decision — do not resurrect meanwhile | P4 |
| ROOT-15 | `tests/**` integration/e2e fixtures carry fork defaults | bleedingdev | Fixtures are evidence for package behavior, not product features | keep-[F] | — |
| ROOT-16 | `tests/integration/bff-corss-project` → `bff-cross-project`; `bff-effect-lambda-only` removed | bleedingdev | Typo fix; Effect-only BFF coverage consolidated under `tests/integration/bff-effect` | keep-[F] | — |
| ROOT-17 | `docs/super-app-rfc-adr/**`, `docs/research/**`, this file | bleedingdev | Fork docs; must stay truthful to live code (MF is the live composition runtime, Garfish lanes are historical) | keep-[F] | — |
| ROOT-18 | `.changeset/**` | bleedingdev | Fork release metadata | keep-[F] — regenerate per release train | — |
| ROOT-19 | `scripts/check-changeset` `FORK_ALLOWED_MAJOR_CHANGESET_IDS` | bleedingdev | Upstream only permits `major` inside `modern-3`-ids; the fork ships breaking changes outside that train | keep-[F] — each entry is a conscious accept | — |
| ROOT-20 | `examples/basic-withZephyr/package.json` bumps zephyr plugins `1.1.0` → `1.2.1` | bleedingdev | Upstream's 1.1.0 declares `@modern-js/app-tools: ^2.0.0`, an unmet peer masked by `strictPeerDependencies: false`; 1.2.1 declares `^3.0.0` | upstream-PR (pure hygiene) | P2 |
| ROOT-21 | `examples/basic-withZephyr/.npmrc` deleted | bleedingdev | pnpm 11 does not read `strict-peer-dependencies` from `.npmrc`; it is dead config that misleads peer debugging | upstream-PR / keep-deleted | P2 |
| ROOT-22 | No `peerDependencyRules.allowedVersions` for `@modern-js/app-tools` | bleedingdev | pnpm 11 ignores the prerelease tag when comparing peer ranges, so aliased `3.5.0-ultramodern.NN` already satisfies `^3.0.0`; a `'*'` rule silently does nothing | keep-[F] (policy) | — |
| ROOT-23 | Acceptance runner indirection: `vars.BLEEDINGDEV_ACCEPT_RUNNER_LABELS` selects the accept-job runner and `vars.BLEEDINGDEV_ACCEPT_BUILD_CONCURRENCY` opts the acceptance workspace builds into higher pnpm workspace concurrency | bleedingdev | Publish-pipeline wall-time lane; both are inert when the repo variables are unset (hosted `ubuntu-latest` + reviewed build profile), so hosted-runner receipts are unchanged | keep-[F] — proof-gated before any real runner switch | — |

---

## 5. `packages/cli`

| ID | What diverged | Owner | Reason | Disposition | Lane |
| --- | --- | --- | --- | --- | --- |
| CLI-01 | `adapter-rstest` package.json scripts, rslib config, tsconfig `ignoreDeprecations` | bleedingdev | tsgo/rstest toolchain | keep-[M] | — |
| CLI-02 | `adapter-rstest/src/index.ts:32` hardcodes `disableReactCompiler: true` | bleedingdev | Compensates for CLI-04; the fork's own test adapter opts out of the default it ships | **revert** with CLI-04 / APP-06 | **P1** |
| CLI-03 | `builder` `performance.rsdoctor` opt-in surface (`RsdoctorUserConfig`) in `createBuilder.ts`, `parseCommonConfig.ts`, `types.ts` | bleedingdev | RsDoctor config surface; defaults OFF after the ADR-0001 revert (`a210ac658d`), pinned by `tests/rsdoctor.test.ts` | extension-point (plugin split already in fork-owned `plugins/rsdoctor.ts`, `rsdoctorConfig.ts`) | P3 |
| CLI-04 | `builder/src/shared/parseCommonConfig.ts:305` sets `reactCompiler: reactCompiler ?? true` | bleedingdev | Upstream ships React Compiler **opt-in**; the fork enables it by default for every vanilla build. Fork's own rstest adapter then hardcodes an opt-out (CLI-02), i.e. the default is not trusted internally | **revert to opt-in, or move to `presetUltramodern` only** | **P1** |
| CLI-05 | `builder/src/plugins/postcss.ts` resolves postcss/tailwind from the app root via `createRequire` | bleedingdev | Fixes monorepo/workspace resolution; upstreamable in isolation | upstream-PR | P2 |
| CLI-06 | `builder` RSC layer matching extended to fork render dist entries + `shared/rsc/rscDisabledRuntime.ts`, `plugins/rscConfig.ts`, `shared/devServer.ts` | bleedingdev | Disabled RSC must fail closed even when the optional runtime is resolvable; upstream `rscClientBrowserFallback.ts` deleted in favor of entrypoint-specific throwing modules | keep-[F] | — |
| CLI-07 | `builder/src/index.ts` export reshuffle | bleedingdev | Import hygiene | keep-[M] | — |
| CLI-08 | `builder` tests (8 files incl. snapshots) | bleedingdev | Track CLI-03…CLI-06 | keep-[F] | — |
| CLI-09 | `builder` `dev.lazyCompilation` disabled unless set (`parseCommonConfig.ts:220`), paired with APP-07 route-eager `lazyCompilation.test` | bleedingdev | Deliberate dev-perf lane, broadened beyond stream-SSR | keep-[F], documented — see APP-07 | — |
| CLI-10 | `plugin-bff` `./server` export repointed **Hono → Effect** (`dist/.../runtime/effect/index`) | bleedingdev | Product decision: Effect BFF is a blessed path in this fork | keep-[F] (product) | — |
| CLI-11 | `packages/cli/plugin-bff/src/server.ts:47-50` — `resolveRuntimeFramework` defaults `bff.runtimeFramework` to `'effect'` (`=== 'hono' ? 'hono' : 'effect'`), pinned by `packages/cli/plugin-bff/tests/server.test.ts:131` (`should treat unresolved runtime framework as effect`) | bleedingdev | Effect HttpApi + Effect BFF is the single blessed authored HTTP path; Hono remains internal compatibility and is feature-frozen; upstream has only Hono | keep-[F] | — |
| CLI-12 | `src/server.ts` loads the fork-owned `EffectAdapter` via **dynamic** `await import('@modern-js/plugin-bff-extensions/effect-adapter')` inside `onPrepare` | bleedingdev | A static import pulls `effect/*` into the eager module graph and crashes hono-only consumers with `ERR_MODULE_NOT_FOUND`; the adapter implementation now lives entirely outside the upstream package | extension-point (extracted) + capped-patch (dynamic import seam) — see note N4 | — |
| CLI-13 | `src/utils/{runtimeGenerator,pluginGenerator,crossProjectApiPlugin}.ts` retains audited generator compatibility seams while Effect client/source/runtime generation lives in `@modern-js/plugin-bff-extensions` (ADR-0005) | bleedingdev | Stable `plugin-bff` output paths and the compiled cross-project template remain compatible; the additive Effect generator subsystem no longer lives in upstream-owned package code | extension-point (extracted) + upstream-PR (generic fail-fast/merge behavior) | P3 |
| CLI-14 | `plugin-bff/package.json` entirely fork-added optional `effect` / `@effect/opentelemetry` peer + mirrored devDep block | bleedingdev | Effect must resolve to one identity in the consumer graph; a `dependencies` entry lets pnpm install a second copy and the runtime barrels hand back services from the wrong instance | keep-[F] — see note N5 | — |
| CLI-15 | `src/runtime/safe-failure.ts:71` builds the error envelope from `SAFE_FAILURE_MESSAGES[status] ?? 'Request failed'`, discarding `err.message` | bleedingdev | Not a deliberate divergence — real error detail is dropped on every BFF failure, including in development | **fix** (preserve `err.message` at least in dev / behind a flag) | **P2** |
| CLI-16 | `plugin-data-loader` (4 files): import reordering, storage import path swap, strictness | bleedingdev | Toolchain | keep-[M] | — |
| CLI-17 | `plugin-ssg` (7 files): import reordering, destructuring/strictness in prerender/server paths | bleedingdev | Toolchain | keep-[M] | — |
| CLI-18 | `plugin-styled-components` derives the styled interface from `typeof styledComponents.default` | bleedingdev | styled-components v6 no longer exports `StyledInterface`; coupled to the dependency migration | keep-[F] (coupled dep) | — |
| CLI-19 | `plugin-bff/src/cli.ts` reduced to a 38-line plugin entry that delegates to fork-owned `src/cli/{generator,compress,prefix,watch}.ts`. Budget 216 → **218** lines at the 3.8.2 base | bleedingdev | Base-transition growth, not new fork code: upstream #8797 added `moduleType` and `apiFiles: apiRouter.getApiFiles()` to its inline `generator()` (4 lines). The fork already threads both from `src/cli/generator.ts:87,134` and `:253`, so the behavior is adopted — the upstream file simply grew underneath the extraction | extension-point (already extracted) | — |
| CLI-20 | `plugin-bff/src/utils/clientGenerator.ts` is a re-export shim over fork-owned `src/utils/client-generator/`. Budget 291 → **338** lines at the 3.8.2 base | bleedingdev | Base-transition growth: upstream #8797 rewrote this file (+153 changed lines) to stop copying handler declarations into `dist/client`. The fork ports that behavior into `client-generator/{generate,type-facade,files,write-package}.ts`; a shim over a bigger upstream file measures as a bigger deletion | extension-point (already extracted) — see note N9 | — |
| CLI-21 | `plugin-bff/src/loader.ts` delegates Effect client generation and worker-runtime rendering to `@modern-js/plugin-bff-extensions`, threads the configured `requestId`, and transpiles the worker runtime to ES2024 | bleedingdev | The upstream Rspack loader exposes no hook for the fork's Effect generators or request identity; this 14-line compatibility seam removes duplicate subsystem ownership while preserving the loader contract and stable public output paths | extension-point (extracted) + capped-patch (loader seam) | — |
| CLI-22 | `plugin-bff/package.json` published-boundary wiring: edge-safe ESM conditions for Effect client/data-platform, no source export, direct dependencies on the extracted BFF owners, an optional `@modern-js/app-tools` declaration peer, and Node >=26.7 | bleedingdev | Package metadata has no extension hook: these declarations keep edge resolution out of CJS/source, make extracted runtime and generated declaration imports resolvable, and preserve the fork's modern Node baseline | extension-point (extracted owners) + capped-patch (17-line manifest seam) | — |
| CLI-23 | `plugin-bff/package.json` root declaration mapping and dependency-ownership cleanup after the Effect/federation extraction | bleedingdev | The published root resolves to `cli.d.ts`; builder and esbuild are build-only; telemetry, federation, runtime-extension, and SWC-helper runtime dependencies no longer belong to this package after their consumers moved to fork-owned packages | extension-point (dependencies follow extracted owners) + capped-patch (19-line manifest cleanup) | — |

---

## 6. `packages/runtime`

| ID | What diverged | Owner | Reason | Disposition | Lane |
| --- | --- | --- | --- | --- | --- |
| RT-01 | `plugin-i18n` localised URLs, API-prefix locale-redirect skip incl. MF manifest endpoints (`/mf-manifest.json`, `/mf-stats.json`, `/remoteEntry.js`, ADR-0002), backend SDK/middleware split, I18nLink/hooks | bleedingdev | Fork i18n + MF lane; upstream has neither | keep-[F] | — |
| RT-02 | `src/runtime/i18n/instance.ts` `I18nInstance` has **no** index signature and **non-overloaded** method signatures | bleedingdev | Upstream's `[key: string]: any` + overloads make i18next's `i18n` permanently unassignable; the documented `i18nInstance: i18next` usage does not typecheck. Overload bivariance also proved order-dependent on tsgo and tsc | keep-[F] — see note N6 | — |
| RT-03 | `plugin-i18n/tsconfig.json` drops `baseUrl` | bleedingdev | TypeScript 7 / tsgo reject `baseUrl` outright (TS5102); `paths` was empty so nothing resolved through it | keep-[F] | — |
| RT-04 | `src/runtime/i18n/detection/index.ts` — 651 changed lines, the single heaviest budgeted file in the repo | bleedingdev | Fork locale detection accreted inline instead of behind a seam | **extension-point** — move to a fork-owned detector module and shrink the budget | P3 |
| RT-05 | `plugin-image` ipx basename type cast + toolchain configs | bleedingdev | Strictness | keep-[M] | — |
| RT-06 | `plugin-runtime` `src/router/runtime/*` router runtime state machinery (`routerRuntime`, `routerServerSnapshot`, hydration script on internal context) + fork-added `provider.ts` / `lifecycle.ts` | bleedingdev | TanStack consolidation landed: all TanStack code is in `@modern-js/plugin-tanstack` and `routerFramework` is removed from the runtime context (ADR-0017 §6; `tests/core/react/wrapper.test.tsx:59,73` asserts its absence) | extension-point (partially migrated) | P3 |
| RT-07 | `PrefetchLink.tsx:68` sets `DEFAULT_PREFETCH_BEHAVIOR = 'render'`; upstream is `prefetch = 'none'` (upstream `PrefetchLink.tsx:276`) | bleedingdev | Flips prefetching on for every `<Link>` in every app, changing network behavior silently on upgrade | **revert** to `'none'` | **P1** |
| RT-08 | `PrefetchLink.tsx:25` declares `WEBPACK_CHUNK_LOAD` (a build-time define → literal `__webpack_chunk_load__`, `rslib.config.mts:8`) and guards it with truthiness (`!WEBPACK_CHUNK_LOAD`, `WEBPACK_CHUNK_LOAD?.(…)`), not `typeof` | bleedingdev | After substitution the emitted code touches a bare undeclared identifier; a truthiness check on an undeclared global is a `ReferenceError`, not `undefined`, in any runtime that is not webpack/Rspack | **revert / fix** to a `typeof` guard, with RT-07 | **P1** |
| RT-09 | `PrefetchLink.tsx` intent / render / viewport prefetch behaviors and chunk preload (the feature itself) | bleedingdev | Genuinely useful and isolatable from the default flip | upstream-PR (after RT-07/RT-08 land) | P2 |
| RT-10 | `src/core/server/string/loadable.ts` drops upstream's `existsAssets` de-dup getter (upstream `loadable.ts:81,182,220`); fork emits `existingAssets: emittedChunks.map(c => c.url)` at `:265` | bleedingdev | Upstream suppressed chunks already present in the route manifest. The fork's replacement de-dups against emitted chunks only, so manifest-present assets can be re-emitted | **revert** / restore the manifest-aware de-dup | **P1** |
| RT-11 | `src/exports/head.ts` — Helmet re-implemented over `react-helmet-async` with SSR `_helmetContext` plumbing (474 changed lines) | bleedingdev | Fork SSR head lane | keep-[F]; **extension-point** for the budget | P3 |
| RT-12 | `src/core/server/*` (stream/string/requestHandler) — router server snapshot, `loaderFailureMode`, helmet integration | bleedingdev | Helper logic already concentrated in fork-owned `requestResponse.ts`, `routerCleanup.ts`, `scriptOrder.ts`; `requestHandler.tsx` keeps only orchestration | keep-[F] | — |
| RT-13 | `src/core/server/string/index.ts` — `createReplaceSSRDataScript` routes `SSR_DATA_PLACEHOLDER` through fork-owned `replaceChunkJsPlaceholder`/`injectBeforeHydrationEntryScript` instead of upstream's plain `safeReplace`, **unconditionally, with no opt-out** | bleedingdev | Fixes a measured hydration race (`/string` entry@11958 < bootstrap@12977 reproduced React #418), but relocates the SSR-data script for every consumer with no config escape and no upstream counterpart | **owner-decision** — keep unconditional, or add an opt-out | **P4** |
| RT-14 | `src/core/server/stream/afterTemplate.ts` — SSR-data + router hydration scripts emitted **before** the entry script (template order inverted vs upstream) | bleedingdev | Deliberate, test-pinned hydration-race fix; degrades to `safeReplace` when no entry script tag is found (custom templates, MF host shells) | keep-[F], documented divergence — see note N7 | — |
| RT-15 | `src/core/context/*`, `src/core/browser/*`, `src/core/compat/*` — `TInternalRuntimeContext` extensions; `core/context/index.ts` exports router runtime/provider types and lifecycle helpers | bleedingdev | This is the public `@modern-js/runtime/context` seam `@modern-js/plugin-tanstack` consumes | extension-point (the seam itself is the intended shape) | — |
| RT-16 | `src/router/runtime/utils.tsx:62,158` — catch-all route loader returns `new Response('404', { status: 404 })` | bleedingdev | Fork **fix** upstream lacks: an unmatched route otherwise resolves 200 | upstream-PR | P2 |
| RT-17 | RSC payload route tree strips `hasErrorBoundary` (`plugin-tanstack` `payloadRoutes`, pinned by `routeTree.test.ts:897`) | bleedingdev | Safe — react-router re-derives `hasErrorBoundary` from `errorElement`. Latent edge exists only for RSC payload routes that carry an error boundary with no `errorElement` | keep-[F], documented latent edge | — |
| RT-18 | `src/router/cli/*` routes owner metadata (`BUILT_IN_ROUTES_OWNER`), config-routes converter, template generation | bleedingdev | Fork routing ownership model | keep-[F] | — |
| RT-19 | `src/document/*`, `src/exports/*`, `src/rsc/*`, `static/modern-inline.js`, `tsconfig.json` (`rootDir`/`baseUrl`) | bleedingdev | Smaller adaptations + toolchain | keep-[M]/keep-[F] | — |
| RT-20 | `render` (6 files) RSC adapter surface: `createFromFetch` export, `rscManifest` plumb-through, `react-server-dom-rspack.d.ts` | bleedingdev | Fork RSC lane; RSC stays disabled in the distribution | keep-[F] | — |
| RT-21 | React Router / Remix compatibility surface (`plugin-runtime` router paths and related upstream-owned files) | bleedingdev | Maintenance-only: the compatibility surface is retained and takes regression fixes only, no new features or public surface. New routing work belongs to TanStack Router; RT-06/RT-16/RT-18 keep their own dispositions | keep-[F] (maintenance-only) | — |
| RT-22 | `plugin-i18n/package.json` React and ReactDOM peer ranges match the required `@modern-js/runtime` React 19 cohort | bleedingdev | The plugin requires `@modern-js/runtime`, whose peers are `^19.2.8`; advertising React 18 was unsatisfiable in a supported install. i18next and react-i18next retain upstream floors because older versions are not exercised here | keep-[F] (dependency cohort) | — |
| RT-23 | `plugin-runtime/src/cli/ssr/index.ts` disables Rsbuild 2.2 `splitChunks` only for Module Federation SSR server environments and emits `MODERN_MF_APP_SSR` with env-compatible string semantics | bleedingdev | Rsbuild 2.2's server default makes the CommonJS MF render entry resolve asynchronously without `requestHandler`; browser environments retain native chunk splitting. Serializing the config-derived marker as a string, paired with APP-09's ambient auto-injection exclusion, prevents conflicting DefinePlugin values while preserving the public `process.env` string contract | capped-patch | — |

---

## 7. `packages/server`

| ID | What diverged | Owner | Reason | Disposition | Lane |
| --- | --- | --- | --- | --- | --- |
| SRV-01 | `bff-core` operation contracts (schema hash, operation entries), cross-project policy evaluator (ADR-0005 §13), client generator emits operation-context bootstrap | bleedingdev | Fork BFF contract lane | keep-[F] | — |
| SRV-02 | `src/security/operationContracts.ts` loads the optional `zod` peer through a runtime-assembled specifier `['z','o','d'].join('')` passed to `createRequire` | bleedingdev | rslib/rspack externalizes a literal `require('zod')` into a top-level `import * as … from "zod"` in `esm-node`, turning an optional peer into a hard requirement | keep-[F] — see note N8 | — |
| SRV-03 | `src/client/generateClient.ts:50` takes a single options object; generated request options emit the imported `fetch` identifier shorthand instead of upstream's `fetch: 'fetch'` string literal | bleedingdev | Restores the upstream-compatible call shape after a fork regression to positional args and fixes an upstream generated-client bug on the upstream-owned `fetch` option | fixed-in-fork + upstream-PR | P2 |
| SRV-04 | `bff-runtime` bumps farrow-api/pipeline/schema `^1.12` → `^2.3` (majors) with `src/index.ts:1` re-exporting `farrow-schema` | bleedingdev | The package's public API surface follows farrow 2.x | keep-[F] — `package.json` + source must move together | — |
| SRV-05 | `core` `src/adapters/node/plugins/static.ts` serves pre-compressed `.br`/`.gz` with Accept-Encoding q-value parsing | bleedingdev | Fork asset-serving behavior; not isolatable as-is | keep-[F] | — |
| SRV-06 | `core` `src/types/config/server.ts` adds `server.telemetry` (exporters, SLO, canary, contract gates), `ssr.moduleFederationAppSSR`, preload types | bleedingdev | Fork telemetry + MF SSR config surface | keep-[F] | — |
| SRV-07 | `core` `src/types/config/bff.ts` adds `bff.crossProjectPolicy` | bleedingdev | Fork cross-project BFF policy | keep-[F] | — |
| SRV-08 | `core` `src/plugins/{index,monitors,default}.ts`, `adapters/node/plugins/resource.ts` | bleedingdev | Pure import/export re-sorting after telemetry moved to `@modern-js/server-runtime-extensions` (`grep -rn telemetry src/plugins/` returns zero hits) | keep-[M] | — |
| SRV-09 | `core` `src/plugins/render/{csrRscRender,ssrRender,renderRscHandler}.ts` | bleedingdev | Fork RSC + router-snapshot integration | keep-[F] | — |
| SRV-10 | `core` `src/context.ts:4` changes the ALS context key (`Symbol.for(...)` value differs from upstream) | bleedingdev | Fork and vanilla `server-core` copies loaded in one process **cannot share request context**; a mixed graph silently sees two ALS stores | **owner-decision** — evaluate revert to upstream's key | **P3** |
| SRV-11 | `core` `adapters/node/helper/utils.ts:44` `isResFinalized` is null-safe: also checks HTTP/1 `destroyed`/`closed` plus HTTP/2 `stream?.destroyed`/`stream?.closed` (`Http2ServerResponse` exposes liveness on `res.stream`) | bleedingdev | A destroyed/closed response detaches its socket, so `socket?.writable` alone reports `undefined` and wrongly looks writable | fixed-in-fork — the null-safe form is deliberately not upstream's expression, so the divergence remains | — |
| SRV-12 | `create-request` producer-client hardening (ADR-0005): envelope policy, identity binding, transport resilience, canonical `traceparent` parsing/propagation (`ce7c6b06ac`) | bleedingdev | Fork BFF client contract | keep-[F] | — |
| SRV-13 | `create-request` `src/requestFactory.ts:408` upload `formData` body-branch fix | bleedingdev | Upstream mismatched the `formData` payload branch; the fix is independent of the fork lanes | upstream-PR | P2 |
| SRV-14 | `plugin-polyfill` migrates ua-parser-js `0.7` → `2.0` (`src/index.ts:34-36`) and lru-cache `6` → `11` (`src/libs/cache.ts:39-40`, `max`/`length` → `maxSize`/`sizeCalculation`) | bleedingdev | Breaking major runtime deps with call-site rewrites | keep-[F] — `package.json` + source must move together | — |
| SRV-15 | `prod-server` telemetry re-export surface (`src/apply.ts:23`, `src/index.ts:17`), typed `createProdServer`, netlify entry | bleedingdev | Re-exported from `@modern-js/server-runtime-extensions` | keep-[F] | — |
| SRV-16 | `prod-server/src/apply.ts` registers `injectTelemetryPlugin()`, `injectModuleFederationCssPlugin()`, `injectMfAssetCacheHeadersPlugin()` **unconditionally** in the shared prod+dev plugin assembly | bleedingdev | Fork telemetry + MF integration stays fork-owned, but registration must be gated on config (`server.telemetry`, MF SSR) so unconfigured consumers do not pay for the plugins | keep-[F] — add config gates | **P3** |
| SRV-17 | `server` `src/helpers/mock.ts` drops `encode: encodeURI` from the path-to-regexp `match` options (`:149-151`) and adds `method ?? 'get'` / `pathname ?? '/'` fallbacks in `parseKey` (`:73-74`) | bleedingdev | Changes dev-mock route matching for non-ASCII paths. Dev tooling only, but it hides inside otherwise mechanical churn | capped-patch — on conflict keep the fork side or consciously re-add `encode` | — |
| SRV-18 | `server` typed `CreateDevServerResult` and undefined-guards in watcher/fileReader | bleedingdev | Strictness fixes, same family as `render.ts` | upstream-PR | P3 |
| SRV-19 | `server-runtime` export reordering | bleedingdev | Import hygiene | keep-[M] | — |
| SRV-20 | `utils` TypeScript compiler path rebuilt around tsgo (spawned `tsgo`, tsconfig-paths matcher, import-specifier rewriting; `src/compilers/typescript/index.ts` 454 → **482** changed lines, 15 → **17** hunks) | bleedingdev | Toolchain divergence; upstream `typescriptLoader.ts` deleted (Appendix A). The 2026-08-16 growth is a capped Bucket-B patch (20 insertions / 4 deletions) porting #8797: `declaration` is no longer forced to `false`, `OUTPUT_SOURCE_EXTENSIONS` maps `.d.ts`/`.d.mts`/`.d.cts` back to their sources, `getSourceFileForOutput` splits the double extension (`path.parse('index.d.ts').name` is `index.d`), and the output collector accepts `.d.(c\|m)?ts` so declarations reach the specifier rewriter | keep-[F]; **extension-point** for the budget | P3 |
| SRV-21 | `utils` `src/compilers/typescript/tsconfigPathsPlugin.ts` hosts only the `before` transform. Budget 203 → **325** lines, 24 → **22** hunks at the 3.8.2 base | bleedingdev | Base-transition growth: upstream #8797 added `tsconfigPathsAfterDeclarationsHookFactory`, a `ts.TransformerFactory` run through the tsc `afterDeclarations` hook (~130 lines). The fork has no tsc `Program` — it spawns `tsgo` — so there is no `afterDeclarations` hook to register (`grep -rn afterDeclarations packages/server/utils/src/` is empty). The same alias-stripping is achieved post-emit in fork-owned `importRewriter.ts`, verified against all four specifier kinds by `packages/server/utils/tests/ts.test.ts` | keep-[F] (no upstream extension point exists under tsgo) | — |
| SRV-22 | `utils` `tests/ts.test.ts` asserts rewritten declaration specifiers with quote-agnostic regexes (`/from ["']\.\.\/shared\/types\.js["']/`) instead of upstream's double-quoted `toContain` literals. Budget 216 → **230** lines, 16 → **20** hunks | bleedingdev | Capped Bucket-B patch (8 insertions / 6 deletions). Upstream's assertions encode `tsc`'s emitter, which normalises specifiers to double quotes; tsgo preserves the quote style of the source. The assertion is loosened on quoting only — the specifier text itself, which is what #8797 fixes, stays exact | capped-patch | — |
| SRV-23 | `utils` `tests/fixtures/ts-declaration/api/declaration.ts` carries one extra blank line versus upstream's new #8797 fixture | bleedingdev | Repo formatter output: `biome check --write` inserts a blank line between the leading comment/`import type` pair and the next comment. Take upstream's fixture on sync and re-run biome rather than hand-reverting the line | keep-[M] | — |

---

## 8. `packages/solutions/app-tools`

| ID | What diverged | Owner | Reason | Disposition | Lane |
| --- | --- | --- | --- | --- | --- |
| APP-01 | `config/initialize`, `src/index.ts`, types wire fork-added `src/presetUltramodern.ts` (telemetry, MF SSR defaults) | bleedingdev | Fork preset entry point. **Corrected 2026-08-11:** the old ledger named `src/baseline.ts`; that file and its alias shim were deleted in `5f8230e055` | keep-[F] | — |
| APP-02 | `package.json`, `src/index.ts`, `src/builder/shared/builderPlugins/adapterSSR.ts`, and `tests/index.test.ts` register fork-owned `@modern-js/app-tools-extensions` plugins; `src/builder/generator/getBuilderEnvironments.ts` and the former in-package CSS runtime plugin are now genuine removals | bleedingdev | Keep only capped package/plugin registration seams in upstream-owned app-tools while Cloudflare worker entries, bundler policy, provider detection, CSS runtime normalization, templates, and tests live in the fork package | extension-point | — |
| APP-03 | `src/plugins/deploy/index.ts` and `src/types/config/deploy.ts` import public `@modern-js/app-tools-extensions` owners; the only retained Cloudflare facade backs the published `@modern-js/app-tools/cloudflare-output-verifier` compatibility contract, while the other former platform files are genuine removals | bleedingdev | Preserve the established app-tools deploy target, configuration types, and unavoidable published verifier path while keeping additive Cloudflare delivery, output verification, release-envelope, security, i18n, and worker-manifest behavior in the fork package | extension-point | — |
| APP-04 | `src/commands/*` dev/build/serve/deploy/info/inspect hooks | bleedingdev | Fork CLI surface. **Corrected 2026-08-11:** the old ledger claimed `modern runtime status` / `fallback-signal` registration (EPIC-7); those commands were deleted in `5f8230e055` and `src/commands/` no longer contains them | keep-[F] | — |
| APP-05 | `src/plugins/analyze/*` entry/routes-owner integration | bleedingdev | Pairs with RT-18 | keep-[F] | — |
| APP-06 | `src/rsbuild.ts:19,58-60` adds `disableReactCompiler?: boolean` to `ResolveModernRsbuildConfigOptions` | bleedingdev | Exists only to let callers opt out of CLI-04's default; disappears if CLI-04 reverts | **revert** with CLI-02 / CLI-04 | **P1** |
| APP-07 | `src/plugins/initialize/index.ts:36-43` defaults `dev.lazyCompilation` to `{ imports: true, entries: false }` when unset, plus `src/builder/shared/lazyCompilation.ts` route-eager `lazyCompilation.test` | bleedingdev | Deliberate dev-perf divergence, broadened beyond stream-SSR to all route component modules. Low priority so an explicit user `dev.lazyCompilation` always wins | keep-[F], documented | — |
| APP-08 | esm register hooks, utils, tests | bleedingdev | tsgo toolchain + track the above | keep-[M] | — |
| APP-09 | `src/utils/env.ts` excludes `MODERN_MF_APP_SSR` from ambient `MODERN_*` auto-injection; `tests/utils/env.test.ts` pins the exclusion | bleedingdev | The variable controls config selection before normalization, while plugin-runtime publishes the resolved SSR mode. Compiling the ambient value through a second DefinePlugin conflicts with the config-derived marker and can mislabel client bundles | capped-patch | — |
| APP-10 | `src/builder/shared/bundlerPlugins/RouterPlugin.ts`, `src/bundleDocs.ts`, and `src/plugins/analyze/{getServerRoutes,isDefaultExportFunction}.ts` carry capped Node 26 / TS7 / Rspack 2 / Babel 8 compatibility repairs | bleedingdev | Keep automatic public paths truthfully narrowed, use Node 26 `Dirent.parentPath`, restore the canonical main-entry constant import, and remove syntax plugins Babel 8 parses by default. Each upstream-owned file stays within the 20-line PR cap; no legacy Node support, casts, or diagnostic suppression are introduced | fixed-in-fork + upstream-PR | P1 |

---

## 9. `packages/toolkit`, `packages/document`, `packages/tsconfig`

| ID | What diverged | Owner | Reason | Disposition | Lane |
| --- | --- | --- | --- | --- | --- |
| TK-01 | `create` defaults to the ultramodern workspace generator with a `--legacy-modern-js` escape hatch (`src/index.ts`, 424 changed lines) | bleedingdev | The fork's primary product surface | keep-[F]; **extension-point** for the budget | P3 |
| TK-02 | `create` resolves packages from `@bleedingdev` | bleedingdev | Fork publishes under its own scope | keep-[F] | — |
| TK-03 | `create` public generator API subpaths (`./ultramodern-workspace`, `./ultramodern-workspace/codesmith`) | bleedingdev | Public generator seam; `exports` and `publishConfig.exports` must stay mirrored with runtime files | keep-[F] | — |
| TK-04 | `create` MicroVertical dry-run/preflight validation + explicit CodeSmith overlay hook; tooling commands split under `src/ultramodern-tooling/commands/` | bleedingdev | Fork generator validation | keep-[F] | — |
| TK-05 | `create` workspace content migrating from TypeScript strings to `templates/workspace/` shipped file templates; shared patches gated by `tests/patch-sync.test.ts` | bleedingdev | Replaces the deleted upstream handlebars single-app template (Appendix A) | keep-[F] | — |
| TK-06 | `toolkit/plugin` (27 files) import/type re-export hygiene + fork duplicate-plugin detection across internal and config plugins | bleedingdev | Mostly mechanical; the duplicate detection is fork behavior | keep-[M] + capped-patch (detection) | — |
| TK-07 | `runtime-utils` `nestedRoutes` browser export, `url` `normalizePathname`, `loaderContext`, async storage, `fileReader`; rstest config on happy-dom | bleedingdev | Support the fork router/runtime lanes | keep-[F] / keep-[M] | — |
| TK-08 | `toolkit/utils` `compiled/pkg-up/*` vendored compiled blob replaced by a readable reimplementation (same API) | bleedingdev | Auditability of vendored blobs | keep-[F] | — |
| TK-09 | `toolkit/utils` `src/cli/constants.ts` fork constants (`NESTED_ROUTE_SPEC_FILE`, …) | bleedingdev | Fork routing constants | keep-[F] | — |
| TK-10 | `toolkit/utils` `src/universal/backend-federation-contract/` (entry `index.ts`; also `build-artifact`, `constants`, `delivery-unit`, `metadata`, `types`, `validation-core`) | bleedingdev | Shared delivery-unit / backend-federation contract consumed by create, app-tools, plugin-bff. Fork-**added** directory, so it carries no divergence budget (zero allowlist entries) | keep-[F] | — |
| TK-11 | `toolkit/types` server/CLI type additions: TanStack route fields (`loaderDeps`, `validateSearch`), `unsafeHeaders`, `cacheConfig` | bleedingdev | Fork type surface. `common/index.d.ts` matches upstream again after the 2026-06-12 cleanup | keep-[F] — **not budget-enforced** (no `src/` directory — outside the gate's `packages/**/src` pattern; `.d.ts` under `src/` *is* budgeted) | — |
| TK-12 | `sandpack-react` build script (`node --experimental-strip-types` + `tsgo:dts`) and dependency alignment; upstream MWA template vendored at `scripts/mwa-template/` | bleedingdev | Toolchain; generated `src/templates/{mwa,common}.ts` are untracked gitignored build outputs again, matching upstream | keep-[M] — **not budget-enforced** (scripts) | — |
| TK-13 | `packages/tsconfig/base.json` sets `module: "preserve"` (upstream `"commonjs"`) and `moduleResolution: "bundler"` (upstream `"node"`) | bleedingdev | TS7 / tsgo toolchain: node10 resolution is removed, and `preserve` + `bundler` are required. Resolving toward upstream reinstates commonjs/node10 and breaks the toolchain | keep-[F] — never resolve toward upstream's values | — |
| DOC-01 | `packages/document/docs` content (109 changed paths, en + zh; measured by <code>git diff -M dfcd414a050d4455851ff76f861822fca0d4bcf4 --name-status -- packages/document/docs &#124; wc -l</code>): full UltraModern.js rebrand — homepage, nav metadata, get-started, BFF/Effect, TanStack, MF-SSR and deploy guides | bleedingdev | Permanent product divergence | keep-[F] — **not budget-enforced**; never bulk-accept upstream doc content | — |
| DOC-02 | `packages/document/src` (8 files) components/config | bleedingdev | Fork docs site components | keep-[F] | — |

---

## 10. Sync-hazard notes

Only for entries where a **clean merge silently produces a broken or reverted
result**. Referenced by ID from the tables above.

**N1 — ROOT-02 Effect cohort (lockstep, no active patch).**
`EFFECT_VERSION`/`EFFECT_VITEST_VERSION` in
`packages/toolkit/ultramodern-create/src/ultramodern-workspace/versions.ts`;
`packages/cli/plugin-bff/package.json` (dep/peer/devDep, see N5); the generated
`pnpm.overrides`/`trustPolicyExclude` emitted by
`ultramodern-workspace/policy.ts`. Effect 4.0.0-rc.112 includes the former
`SchemaAST.Sentinel` declaration repair, so generated workspaces carry no
active Effect patch. `stalePatchPolicies` retains the reviewed beta.107 digest
(`ed9f636…`) and the beta.94/beta.97/beta.102 legacy digests only so migration
can recognize and remove the former template patch without deleting
consumer-owned files. These entries are migration history, not authorization
to restore or regenerate the patch.
Guards: `packages/toolkit/ultramodern-create/tests/version-pins.test.ts`,
`tests/migrate-release-age-policy.test.ts`.
Release-age exclusions are temporary, exact-version, evidence-backed and removed
after the 24-hour window; they are **distinct** from generated
`trustPolicyExclude` entries (limited to `effect` and `@effect/opentelemetry`).

**N2 — ROOT-04 examples must consume the workspace.**
Under upstream's `latest` spelling, `pnpm install` downloads real Modern.js
(3.7.0) beside the fork's packages and pnpm hoists one of the two into
`node_modules/.pnpm/node_modules/@modern-js/*`. Which one wins is not
deterministic across machines, so anything resolving a bare `@modern-js/*`
specifier from outside the workspace tree — the plugin-bff generator fixtures do
exactly this — binds to upstream on CI and to the fork locally, and fork-only
subpaths (`./effect-client`, `./effect`) fail with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. Take upstream's example *sources* on sync; keep
`workspace:*` on their manifests.

**N3 — ROOT-10 release tags.**
`RELEASE_TAG_PREFIX` in `scripts/ultramodern-publish/gen-cohort-change-record.mjs`
must stay in sync with the workflow — it is also the since-boundary the change
record uses. The tagging step is idempotent (`gh release view` → `edit`, else
`create`) because it runs **after** the unrollbackable npm publish.

**N4 — CLI-12 dynamic Effect import.**
A static top-level import pulls `effect/Effect`, `effect/Layer`, `effect/Schema`
and `effect/unstable/http*` into the eager module graph of
`@modern-js/plugin-bff/server-plugin`. The dynamic target is the public
`@modern-js/plugin-bff-extensions/effect-adapter` subpath; do not restore a
local adapter implementation. Guard:
`packages/cli/plugin-bff/tests/regression.test.ts`
(`server entry does not eagerly load Effect`).

**N5 — CLI-14 plugin-bff dependency block is purely additive.**
Upstream's plugin-bff has no `effect` dependency and **no `peerDependencies`
block at all**, so a sync merge will not conflict on it and a resolver taking
"theirs" wholesale drops it **silently**. `@effect/opentelemetry` MUST move with
`effect`: it declares a REQUIRED (non-optional) `effect` peer of its own, so
leaving it in `dependencies` re-imposes that peer on every hono-only consumer
transitively and makes the optional `effect` peer a fiction. Guards:
`tests/regression.test.ts` asserts, for BOTH packages, that
`dependencies[name] === undefined`,
`peerDependencies[name] === devDependencies[name]`, and
`peerDependenciesMeta[name].optional === true`; plus
`packages/toolkit/ultramodern-create/tests/version-pins.test.ts`
(`plugin-bff declares the same Effect cohort generated workspaces pin`).

**N6 — RT-02 `I18nInstance`.**
Do **not** take upstream's interface body wholesale on sync — it silently
re-breaks assignability. Guard:
`packages/runtime/plugin-i18n/tests/type-fixture/i18nInstanceTypes.fixture.ts`
via `tests/linkTypes.test.ts`. `t` is a REQUIRED member (upstream declares no
`t` at all), so every object literal producing an `I18nInstance` must supply one
— including the three factories in `tests/{link,routerAdapter,i18nUtils}.test.*`.
Coupled fork edits: `src/runtime/contextHelpers.ts` (cast for the fixed-arity
`t`, invoked via `translate.call(i18nInstance, …)` so a custom `t` reading `this`
still works — i18next's own `t` is bound and would hide the bug),
`src/runtime/hooks.ts` (throwing `t` stub on `createMinimalI18nInstance`),
`src/runtime/context.tsx` (`useModernI18n<TInstance extends I18nInstance>`),
`src/runtime/core.tsx` (re-exports `I18nInstance`/`TranslateFn`/
`UseModernI18nReturn`).

**N7 — RT-13 / RT-14 script ordering.**
Upstream owns the plain `safeReplace` in `string/index.ts`, so a sync merge
taking "theirs" silently reopens the ordering gap. Measured on
`tests/integration/routes-tanstack` before the fix: `/stream` bootstrap@11932 <
entry@12523 (safe) but `/string` entry@11958 < bootstrap@12977 (raced);
deferring the bootstrap reproduces React `#418` with the SSR DOM node discarded.
Guards: `packages/runtime/plugin-runtime/tests/ssr/serverRender/renderToString/buildTemplate.test.tsx`
and the byte-offset assertion in
`tests/integration/routes-tanstack/tests/index.test.ts`.

**N8 — SRV-02 optional zod peer.**
`@modern-js/plugin-bff`'s root, `./cli`, `./server-plugin` and `./hono-server`
entries all reach `operationContracts.ts` transitively and threw
`ERR_MODULE_NOT_FOUND: zod` for consumers without zod. Do not "simplify" the
assembled specifier back to a literal on sync. Guard:
`packages/server/bff-core/tests/optionalZodPeer.test.ts` (asserts the source
shape and that no built format carries an eager zod dependency).

**N9 — CLI-20 the client type facade is always ESM.**
Upstream #8797 threads the app-level `moduleType` from `cli.ts` into
`clientGenerator` and emits an **extensionless** re-export specifier for CJS
apps. The fork deliberately ignores `moduleType` for this one decision and always
emits `./x.js`, because `writeClientModuleBoundary` gives `dist/client` its own
`{"type": "module"}` manifest: the generated declarations are native ESM whatever
the surrounding app is, and an extensionless relative specifier inside an ESM
package fails a consumer's `node16`/`nodenext` typecheck with TS2835. This is the
only executable difference between upstream #8797 and the fork's port, and it is
a superset — every `moduleType` still produces a resolvable facade. Do not
"restore" the `moduleType` thread on sync. Guards: the rationale is pinned in
`packages/cli/plugin-bff/src/utils/client-generator/generate.ts:112-117`, and
`tests/integration/bff-cross-project/tests/types-portability.test.ts` typechecks a
packed tarball from an isolated consumer under both `bundler` and `nodenext`
resolution.

**N10 — CLI-20 a missing handler declaration must fail the build.**
The facade re-exports the emitted declaration instead of copying it, so if the
declaration is absent the facade dangles and the published client's advertised
types silently degrade to `any`. `writeClientTypeFacade` therefore throws
`MissingClientDeclarationError` rather than skipping, and the cross-project
integration test asserts both `code === 0` and the absence of that error name in
stderr — without those two assertions the suite stays green when
`declaration: false` is restored, which is exactly the defect #8797 fixes.

---

## 11. Scheduled work summary

| Lane | Entries |
| --- | --- |
| **P1** | CLI-02, CLI-04, APP-06 (React Compiler default → opt-in); RT-07, RT-08 (PrefetchLink default + chunk-load guard); RT-10 (`existsAssets` de-dup) |
| **P2** | CLI-05, CLI-15, RT-09, RT-16, SRV-03, SRV-13, ROOT-20, ROOT-21 |
| **P3** | CLI-03, CLI-13, RT-04, RT-06, RT-11, SRV-10, SRV-16, SRV-18, SRV-20, APP-02, TK-01 |
| **P4** | RT-13 (SSR-data relocation opt-out), ROOT-14 (docs binary cleanup) |

**Fixed in fork 2026-08-11:** SRV-03 (`generateClient` options object restored
and imported `fetch` identifier emitted), SRV-11 (`isResFinalized` null-safe).
Both still count as divergences — the resulting code is deliberately not
upstream's expression. SRV-03's upstream `fetch: 'fetch'` bug fix is queued P2.

**Upstream 3.8.2 merged 2026-08-16.** Upstream #8797 (published crossProject BFF
client declarations must resolve in a consumer project) is ported onto the fork's
tsgo pipeline rather than taken verbatim, because the upstream fix is written as
a tsc `afterDeclarations` transformer the fork has no `Program` to register. New
rows: CLI-19, CLI-20, SRV-20 (updated), SRV-21, SRV-22, SRV-23; notes N9 and N10.
No P-lane — none of them is scheduled work, they are the standing cost of the
tsgo and fork-owned-generator lanes.

---

## Appendix A — deleted or template-moved upstream files (26): keep deleted on sync

Raw `-M` against the base reports 11 deleted files plus 15 template moves. Treat
all 26 original upstream paths as keep-deleted. On merge they conflict as
delete/modify, rename/modify, or silently resurrect — re-delete the original path
and port any upstream change into the listed fork replacement instead.

| Original upstream path | Fork replacement / reason |
| --- | --- |
| `packages/cli/builder/src/shared/rsc/rscClientBrowserFallback.ts` | Fork-owned `rscDisabledRuntime.ts` + entrypoint-specific throwing modules. Disabled RSC must override resolvable optional peers and fail closed (CLI-06). |
| `packages/cli/builder/tests/__snapshots__/{default,environment}.test.ts.snap`, `packages/runtime/plugin-runtime/tests/router/__snapshots__/templates.test.ts.snap`, `packages/server/bff-core/tests/client/__snapshots__/generateClient.test.ts.snap`, `packages/server/core/tests/utils/__snapshots__/error.test.ts.snap` | Five exact-output snapshots replaced by structured/compiler/runtime behavior checks. Do not restore generated-output oracles. |
| `packages/runtime/render/modern.config.js` | Fork-added `rslib.config.mts`. Port upstream build-config changes there. |
| `packages/server/utils/src/compilers/typescript/typescriptLoader.ts` | tsgo compiler path under `src/compilers/typescript/` (SRV-20). |
| `packages/solutions/app-tools/src/esm/ts-node-loader.mjs` + `tests/utils/ts-node-loader.test.ts` | `src/esm/register-esm.mjs` + `src/esm/ts-paths-loader.mjs`. Map upstream loader changes onto `ts-paths-loader.mjs`. |
| `packages/toolkit/create/template/**` (15 files) | Replaced by the ultramodern workspace generator (TK-01, TK-05). `CLAUDE.md` → `template-workspace/CLAUDE.md.handlebars`; the rest → `packages/toolkit/sandpack-react/scripts/mwa-template/` (with `biome.json` as `biome.json.handlebars`). |
| `packages/toolkit/sandpack-react/scripts/template.ts` | Fork-added `scripts/template.mts` run via `node --experimental-strip-types` (`package.json:37`). It renders `scripts/mwa-template/`; generated `src/templates/{mwa,common}.ts` are untracked gitignored build outputs, matching upstream. |
| `examples/basic-withZephyr/.npmrc` (outside the package count) | Dead config — pnpm 11 ignores `strict-peer-dependencies` in `.npmrc` (ROOT-21). |

## Appendix B — renamed + modified upstream files (3): follow the rename

Git resolves these only with rename detection on (`-M`); without it they look
like delete + add. Apply upstream edits to the **new** path, then re-apply fork
content.

| From → To | Notes |
| --- | --- |
| `packages/document/docs/en/apis/app/runtime/bff/use-hono-context.mdx` → `use-backend-context.mdx` (R087) and the `zh` twin (R088) | Renamed for runtime-framework-neutral BFF naming (~12-13% content change). Treat content per DOC-01. |
| `packages/runtime/plugin-runtime/scripts/gen-static.ts` → `scripts/gen-static.mts` (R075, ~25% modified) | ESM script for the tsgo toolchain. Port upstream script logic into the `.mts` file. |

## Appendix C — 2026-06-12 brutal-cleanup removals (fork-added; keep deleted)

These are **fork-added** deletions, so a sync never resurrects them. This list
exists so the deletions are not mistaken for merge losses. Source:
`docs/research/fork-audit-2026-06-12-findings.md`.

**Packages:** `packages/runtime/plugin-garfish` (Garfish compat lane; MF is the
sole micro-frontend runtime, ADR-0011 retired; upstream removed its own before
the baseline); `packages/server/plugin-koa`, `packages/server/plugin-express`
(fork-resurrected v2 BFF adapters, absent upstream since v3, both `private`,
unpublished — the v3 BFF pipeline is hono/effect-only and node-style handlers
cannot satisfy the hono `prepareApiServer` contract);
`packages/builder/**` (5 stale orphans; upstream removed `packages/builder` in
`4df6c876aa`); `plugin-runtime/src/ssr/**` (4 orphaned legacy SSR copies),
`runtime-utils/src/universal/async_storage.server.worker.ts`,
`toolkit/types/common/moduleSdk.d.ts`; the prod-server zombie lane
(`src/server/{index,modernServerSplit}.ts`,
`src/libs/{runtimeFallbackWorkerLane,loadConfig,metrics}.ts`, `src/utils.ts`,
`benchmark/runtime-resilience`) — the live telemetry lane is
`@modern-js/server-runtime-extensions`.

**Scripts and CI:** the MV governance layer (~6,550 LOC:
`scripts/mv-zephyr-profile`, `mv-production-rollout`, `mv-ci-hardening`,
`mv-lane-policy`, `wave0-mv-contracts`, 3 of 5 `mv-integration-pilot` drills,
both `.github/workflows/mv-*.yml`; **kept**: the `validate:mv-topology-smoke`
lane); the SuperApp load/preflight chain (`scripts/superapp-k6` —
5.2k lines that could never execute, `scripts/superapp-load`,
`scripts/ultramodern-preflight`, `scripts/ultramodern-contract-doctor`,
`scripts/superapp-local-control-plane`,
`scripts/superapp-certification/validate-harness-contract.js`; certification
profiles slimmed release 16→12 and nightly 22→15; the readiness report no longer
converts skipped/budget-failed artifacts into passed evidence); and the dead
script families `ultramodern-version-switching`,
`ultramodern-cloudflare-ssr-validation`, `ultramodern-zephyr-live-evidence`,
`ai-capabilities`, `test-orchestrator`,
`ultramodern-publish/resolve-affected-packages.mjs`,
`ultramodern-zephyr-ssr-upload`, `ultramodern-publish-readiness`, plus the
ownership/blast-radius module in `scripts/boundary-guards/validator.js`.
Surviving validation: `tests/integration/create-ultramodern-workspace` and each
generated workspace's own `scripts/validate-ultramodern-workspace.mjs`.
The deleted Phase A-C `.github/workflows/mv-*.yml` governance layer is **not**
current evidence — do not cite it.

---

## 12. Sync guidance

1. Resolve `keep-[M]` conflicts toward upstream, then re-run
   `npx biome check --write` and restore `@effect-diagnostics` pragmas.
2. Keep the fork side for everything `keep-[F]`. Diffs inside upstream-owned
   files are intentionally minimal — if a conflict looks large, the logic should
   probably move to a fork-owned module (an `extension-point` row). For the
   coupled dependency migrations (SRV-04 `bff-runtime`, SRV-14
   `plugin-polyfill`, CLI-18 `plugin-styled-components`) keep `package.json` and
   source **together**; never split sides within the package.
3. Current verified upstream-PR queue: CLI-05 (builder postcss app-root
   resolution), RT-09 (PrefetchLink prefetch behaviors, after RT-07/RT-08),
   RT-16 (RSC catch-all 404 status), SRV-03 (generated client must emit the
   imported `fetch` identifier, not upstream's `fetch: 'fetch'` string literal),
   SRV-13 (upload `formData`), SRV-18 (dev-server strictness), CLI-13 (BFF
   generator fail-fast/merge half), ROOT-20/ROOT-21 (zephyr example hygiene).
   Service-worker ESM output, the
   edge-safe language detector, and `matchRoute` undefined narrowing landed
   upstream and are no longer fork divergences.
4. Appendix A files stay deleted; a merge that resurrects one is wrong even if
   it applies cleanly. Port the upstream change into the listed replacement.
5. Appendix B: run the sync with rename detection on and land upstream edits on
   the renamed path.
6. After the sync, re-run
   `node scripts/ultramodern-boundary-check/check-fork-import-boundary.js`.
   Any `unallowlisted-divergence` is a new Bucket-B entry that needs a row in
   this ledger before the budget is re-recorded.
7. Do not move the immutable ownership base or reviewed provenance merely
   because upstream was synced. Record the candidate sync revision separately
   until an identity-preserving budget carry-forward has been designed and
   reviewed. Never substitute a release tag, PR merge-base, push before-SHA, or
   `HEAD`, and never re-record a fresh snapshot to erase existing debt.
