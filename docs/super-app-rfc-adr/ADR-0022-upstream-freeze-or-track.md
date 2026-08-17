# ADR-0022: Freeze or Track Upstream Modern.js

- Status: **Proposed — TRACK (Option B) drafted for ratification; awaiting owner sign-off**
- Date: 2026-08-12 (initial evidence snapshot)
- Ratification-draft refresh: 2026-08-17
- Decision Type: Fork lifecycle / upstream relationship policy
- Deciders: repo owner (ratifying); provisional sync owner `bleedingdev` (ledger convention); provisional upstream-PR lane owner `UltraModern Debug` (current assignee for `modernjs-7f13`); explicit confirmation pending
- Related:
  - `../../AGENTS.md` (Rule 5 — two-bucket fork boundary)
  - `../../FORK-DIVERGENCE.md` (audited merge-base ledger)
  - `../../scripts/ultramodern-boundary-check/README.md` (import + divergence gates)
  - `ADR-0006-boundary-anti-pattern-checks.md`
  - `ADR-0020-zoned-surface-versioning.md`
  - `GOVERNANCE-0001-micro-vertical-extraction-governance.md`

## 1. Context

UltraModern is a long-lived fork of `web-infra-dev/modern.js`. Its relationship
to upstream has never been decided explicitly — it has been *assumed* to be
"track upstream", and the whole governance apparatus (two-bucket rule, boundary
checker, divergence ledger) was built on that assumption. The P3 extraction lane
now wants to spend 1–2 months acting on that assumption. This ADR forces the
assumption to be ratified or replaced before that spend happens.

### Measured position (baseline evidence verified in-repo, 2026-08-12; draft refreshed 2026-08-17)

| Fact | Value | How verified |
| --- | --- | --- |
| Fork commits ahead of upstream | **8,022** | `git rev-list --count origin/main..HEAD` |
| Merge debt | **zero** | `git merge-base HEAD origin/main` == `origin/main` tip |
| Audited merge-base | `ecef47dc` "Release v3.8.1 (#8799)", 2026-08-07 | `FORK-DIVERGENCE.md`; matches `origin/main` tip |
| Upstream-owned files carrying fork edits | **633 files / 2,835 hunks / 33,832 changed lines** (vs divergence-gate base `dfcd414a`, the parent of `ecef47dc`; gate scope is *every* upstream-owned file under `packages/` — the earlier 341 / 1,797 / 14,263 figures were the narrower `packages/**/src` source-only scope, widened 2026-08-12) | `scripts/ultramodern-boundary-check/divergence-allowlist.json` (`baseRef`, `totalFiles`/`totalHunks`/`totalChangedLines`); `FORK-DIVERGENCE.md` § "Bases and counts" |
| Package-scope diff at the boundary | 581 M, 847 A, 11 D, 18 R (1,457 paths), base `origin/main` | `FORK-DIVERGENCE.md` § "Bases and counts" |
| Root/infra diff outside `packages/**` | 467 M, 719 A, 8 D, 37 R (1,231 paths), base `dfcd414a` | `FORK-DIVERGENCE.md` § "Bases and counts" |
| Ledger disposition split (104 entry rows at ratification-draft refresh; compound dispositions overlap) | **67 rows mention `keep-[F]` / 13 mention `keep-[M]` / 9 `upstream-PR` / 5 `extension-point` primary (8 rows name it, 3 as the budget target of a `keep-[F]` row) / 6 `revert` primary (7 rows mention revert, including 1 `owner-decision` row) / 3 primary `fix`-or-fixed / 3 `capped-patch` / 3 `owner-decision` / 1 `keep-deleted`** | disposition column of the ledger entry tables in `FORK-DIVERGENCE.md` (§ 4 and the `packages/**` sections) |

> **Superseded snapshot (2026-08-16).** Every figure in the table above was
> measured in the 3.8.1 era. Upstream 3.8.2 has since been merged and the
> divergence gate re-anchored to `eded841256` (`Release v3.8.2 (#8810)`), which
> is also the `origin/main` tip, so the gate base and the sync-review base now
> coincide and the two-base caveat below no longer applies. Current figures live
> in `FORK-DIVERGENCE.md` §2–§3; do not cite this table as current evidence.
> The sanctioned re-record at `eded841256` completed 2026-08-17: the allowlist
> now carries 611 files / 2,789 hunks / 33,816 changed lines.

**Two different base refs are in play, and the ledger keeps them apart on
purpose.** The divergence gate pins `dfcd414a` (`git merge-base HEAD v3.8.1`);
the sync-review counts use `ecef47dc` (`origin/main` tip, one commit ahead). The
counts differ materially at exactly this scope — 604 M vs 581 M for
`packages/**` — so any regeneration of the gate figures must name its base.
Regenerating the 633 / 2,835 / 33,832 numbers against `ecef47dc` will *not*
reproduce them.

The fork is **fully merged with zero merge debt**. That is the cheapest possible
moment to make this decision: neither option has to pay off a backlog first.

The `v3.8.1` *tag* commit (`9567644966`) is not an ancestor of `HEAD`, but it is
a parallel release commit with the same parent, tree, and stable patch-id as
`ecef47dc`. The divergence is cosmetic and must not be read as merge debt.

### Correction to a stated premise: upstream is **not** in maintenance mode

The brief for this ADR assumed upstream had gone quiet. The tag record refutes
that, and it is the single highest-leverage input to this decision:

| Release | Date |
| --- | --- |
| v3.0.0 | 2026-02-04 |
| v3.5.0 | 2026-06-26 |
| v3.6.0 | 2026-07-09 |
| v3.7.0 | 2026-07-16 |
| v3.8.0 | 2026-08-06 |
| **v3.8.1** | **2026-08-07** |

**22 non-alpha v3.x releases in ~6 months**, roughly weekly, with the latest
landing **5 days before this ADR**. Upstream is actively maintained.

Two evidence caveats the owner should know before weighing this:

- Local `origin/main` is a **shallow ref** (`.git/shallow` present; 13 commits,
  oldest 2026-08-03), last updated 2026-08-08 09:03 +0200 by `fetch --no-tags origin main` (per `git reflog show refs/remotes/origin/main`; the 2026-08-11 21:08 `FETCH_HEAD` timestamp belongs to a fetch of the `bleedingdev` fork, not upstream). Commit-frequency analysis
  before 2026-08-03 is therefore unavailable locally; **tag dates are the
  reliable cadence signal**, not `git log` counts.
- A public web search returned v3.2.1 (May 21) as "latest" and described a
  weekly Thursday release train. The search index is **stale** relative to the
  local fetch; the git evidence supersedes it. If the owner wants an independent
  confirmation before ratifying, re-fetch `origin` and re-read the tag list —
  that is the cheapest possible check and it directly drives the choice below.

### Unverified inputs carried from the audit brief

These shaped the framing but could **not** be reproduced from the repo. They are
flagged so the owner does not treat them as established:

- **"~25–28k LOC of true boundary violations."** Now largely reconciled: with
  the gate widened to every upstream-owned file under `packages/` (2026-08-12),
  it records **33,832 changed lines** across 633 files — the brief's ~25–28k
  falls inside the plausible band of the same measurement (the earlier
  source-only scope recorded 14,263 across 341). P3 sizing should use the
  33,832 gate figure and name the `dfcd414a` base.
- **"P3 extraction is 1–2 months."** Not derived from a work breakdown in-repo.
- **"22 couplings refuted a full `create` revert."** No in-repo record found;
  no file, ledger entry, or doc references it. It is cited below as a driver
  only on the owner's own recollection.

## 2. Decision

**Draft decision: TRACK (Option B), pending owner ratification.** UltraModern will
continue to track `web-infra-dev/modern.js`; this section is an apply-ready
ratification draft, not an `Accepted` decision. Values marked provisional are
drafter proposals only; the owner may amend them before ratification, and the
status remains `Proposed` until sign-off. The owner must confirm these fields
before the status changes:

- **Sync cadence:** provisional proposal: run a full upstream sync quarterly,
  with an out-of-band sync for upstream security updates under the SLA below.
  The owner may amend this proposal before ratification.
- **Sync owner:** provisional `bleedingdev`, because every ledger entry defaults
  to that owner unless a row names another. Explicit owner confirmation is
  required.
- **Upstream-PR lane owner:** provisional `UltraModern Debug`, the current
  assignee for `modernjs-7f13`. Explicit owner confirmation is required for the
  standing lane.
- **Security-update SLA:** provisional proposal: acknowledge and triage an
  upstream security update within 2 business days, then land a fix or record an
  owner-approved exception within 14 calendar days; missed targets escalate to
  repo owner `bleedingdev`. The owner may amend this proposal before ratification.
- **Version scheme:** the next release after the pending sync is expected to use
  `3.8.2-ultramodern.N`. This is an anticipatory pattern, not the current
  package version: `packages/toolkit/create/package.json` is still `3.8.1`.
- **First runbook execution:** as of 2026-08-17, the in-flight v3.8.2 sync
  is the first execution of the runbook below. `HEAD` is two commits behind
  `origin/main` (`8edf91adb1`, `eded841256`); `git merge-base HEAD origin/main`
  is `ecef47dc`, and tag `v3.8.2` is not an ancestor of `HEAD`. The unrelated,
  stale `bleedingdev/feat/sync-v2` branch is not evidence for this sync.

### Exact sync runbook

1. Fetch the upstream tip without mutating the upstream remote, and record the
   old fork `HEAD`, the fetched `origin/main`, and `git merge-base HEAD
   origin/main`:
   `git fetch --no-tags origin main`.
2. Integrate the selected `origin/main` tip using the repository's existing
   merge-based sync convention (`merge: sync ... upstream`). Resolve conflicts
   in the owning layer, preserve the two-bucket rule, and keep any PR branch on
   the fork remote `bleedingdev`; never push directly to `origin`.
3. At the new tip, re-run `git merge-base HEAD origin/main` and record the
   audited base. Keep the divergence-gate base from
   `divergence-allowlist.json` separate from the sync-review base.
4. Regenerate the sync-review ledger with rename detection pinned:
   `git diff -M origin/main --name-status -- packages` and
   `git diff -M origin/main --name-status -- . ':(exclude)packages/**'`.
5. For every changed upstream-owned path, add or update its
   `FORK-DIVERGENCE.md` row in the same change. Assign the default owner
   `bleedingdev` unless the row names another owner, and apply only the ledger
   vocabulary: `upstream-PR`, `extension-point`, `capped-patch`, `fixed-in-fork`,
   `keep-deleted`, `keep-[F]`, `keep-[M]`, `revert`, `fix`, or `owner-decision`.
6. Run both boundary gates against their recorded bases:
   ```sh
   node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --mode imports
   node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --mode divergence
   ```
   Re-record a shrink with the following command only when neither metric
   grows:
   ```sh
   node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --mode divergence --write-divergence-allowlist
   ```
   After adding the matching ledger row, a sanctioned growth may use:
   ```sh
   node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --mode divergence --write-divergence-allowlist --record-growth
   ```
7. Use `--rebase-divergence-allowlist` only when the audited base itself moves:
   it is “the explicit opt-in required to re-record the baseline at a different
   upstream base ... never to bless divergence at the current base.” Run the
   release, package, and downstream acceptance gates, then review the final
   ledger, allowlist, and version metadata before the fork PR is opened.


### Option A — FREEZE

Pin upstream at v3.8.1 permanently. Declare UltraModern "a product that vendors
Modern.js" rather than "a fork of Modern.js". Take a vendor branch; `origin`
becomes an archival reference, not a sync source.

**Consequences**

- **Most of P3 loses its ROI.** The extraction exists to reduce merge pain. With
  no future merges, ~33.8k gate-recorded changed lines (see reconciliation
  above) of boundary violations stop being a recurring cost and become a
  one-time readability cost. P3 should then be **cancelled or radically
  descoped** to whatever is justified by maintainability alone.
- **Upstream security fixes become manual cherry-picks.** Each one is a bespoke
  backport against a tree drifting 8,022+ commits away. No runbook exists; this
  becomes an unbudgeted standing obligation with a security deadline attached.
- **The version-truthfulness policy freezes its base forever.** `3.8.1-ultramodern.N`
  stops meaning "Modern.js 3.8.1 plus our work" and starts meaning "our product,
  historical base 3.8.1". The base segment becomes vestigial and arguably
  misleading to consumers. Ratifying FREEZE should include renaming the scheme.
- **The boundary checker stays valuable but stops being load-bearing.** It keeps
  suppressing diff noise and documenting intent, but it no longer protects a
  merge that will never happen. Retain it as hygiene; do not fund work whose
  only justification is the gate.
- **Forfeits upstream's active development** — 22 releases in 6 months, all
  future fixes and features. This is the option's dominant cost given the cadence
  evidence above.

### Option B — TRACK

Commit to a **named sync cadence with a named owner** (e.g. quarterly, or
aligned to upstream minors). Syncs become scheduled work, not emergencies.

**Consequences**

- **P3 extraction is justified and should proceed.** Every line moved out of an
  upstream-owned file is merge cost removed from every future sync. The ROI
  scales with the number of syncs the fork expects to perform.
- **Every Bucket-B divergence is a recurring cost.** The current ledger has 104
  entry rows: 9 name `upstream-PR`, 8 name `extension-point`, 7 are
  revert-flavored, and 3 are primary fix-or-fixed rows. These categories overlap
  at SRV-03, leaving 26 unique rows on a path back toward upstream behavior.
  The ledger's disposition split matters here: `keep-[F]` appears in 67 rows and
  `keep-[M]` in 13; the former is permanent by design unless its row also names
  an extraction target. Extraction cannot eliminate the `keep-[F]` portion — it can
  only move it behind fork-owned extension points, and the ledger already enumerates that scope: the
  **8 rows carrying an `extension-point` disposition** (5 primary, 3 as the
  budget target of a `keep-[F]` row) are the named P3 extraction targets, since
  `extension-point` is defined as logic that should move out of the upstream
  file into a fork-owned module with a shrinking budget. Size P3 against those
  rows and the `keep-[F]`-heavy reality, not against the total.
- **Requires the exact upstream-sync runbook above.** This is a prerequisite
  deliverable of ratifying B, not a follow-up. It covers fetch and re-audit of
  the merge-base, ledger regeneration with rename detection pinned
  (`git diff -M`), divergence-budget recording, and the conflict policy already
  encoded in the ledger's **"Disposition vocabulary"** table (`upstream-PR`,
  `extension-point`, `capped-patch`, `keep-[F]`, `keep-[M]`, `revert`, `fix`,
  `owner-decision`).
- **The upstream PR lane becomes mandatory** for fork fixes that are really
  upstream bugs (e.g. the 404 fix, the upload `formData` fix). Carrying an
  upstream bug fix as a local Bucket-B patch means re-merging it forever;
  upstreaming it deletes the cost permanently. The lane is already authorized in governance: AGENTS.md Rule 5 names "a PR to upstream `origin`" as Bucket-B resolution (1), and the ledger's `upstream-PR` disposition maps to it. PR branches are pushed to the fork remote (`bleedingdev`) and opened as cross-repo PRs, so AGENTS.md Rule 2 (no direct push/publish to `origin`) is untouched. What ratifying B must add is a named owner and cadence for this lane.
- **Keeps the fork on a maintained base**, inheriting upstream security and
  feature work at the cadence chosen.

## 3. Decision drivers

| Driver | Evidence at ratification-draft time (2026-08-17) | Points toward |
| --- | --- | --- |
| **Upstream release activity** | 22 v3.x releases in ~6 months through v3.8.1, followed by the v3.8.2 release commit on 2026-08-13; upstream remains actively maintained | **B** — strongly. The stated "maintenance mode" premise is refuted. |
| **Merge debt right now** | `origin/main` is two commits ahead (`8edf91adb1`, `eded841256`); `git merge-base HEAD origin/main` remains `ecef47dc` | **B** — the first sync is pending, not a zero-debt state |
| **Divergence shape** | Of 104 ledger entry rows, 67 mention `keep-[F]` (permanent) and 13 mention `keep-[M]`; 9 name `upstream-PR`, 8 name `extension-point`, 7 are revert-flavored, and 3 are primary fix-or-fixed rows. These categories overlap at SRV-03, yielding 26 unique rows on a path back toward upstream behavior. | **A** — `keep-[F]` appears in ~64% of rows (67/104), so most divergence is intentional and will never converge. |
| **Team capacity** | Owner-gated; P3 is 1–2 months (unverified estimate) of a small team's budget, plus a standing per-sync cost under B | **A** if capacity is the binding constraint |
| **The 22 couplings that refuted full `create`-revert** | Unrecorded in-repo; owner recollection only | **A** — evidence that divergence is structural, not incidental. Record it before relying on it. |
| **npm scope realities (`@bleedingdev`)** | Fork publishes its own scope under its own release/security process (`PUBLISH-SECURITY-RUNBOOK.md`); consumers already depend on `@bleedingdev/*`, not `@modern-js/*` | **A** — the distribution channel is already independent of upstream; nothing downstream forces tracking |
| **Sync cadence** | Provisional drafter proposal: quarterly full syncs, with out-of-band security syncs under the provisional SLA below; owner may amend before ratification | **OWNER INPUT REQUIRED** — proposal is not ratified |
| **Sync and upstream-PR ownership** | The ledger defaults to `bleedingdev`; `modernjs-7f13` is currently assigned to `UltraModern Debug`; standing ownership still needs confirmation | **OWNER INPUT REQUIRED** |
| **Security-update SLA** | Provisional drafter proposal: triage within 2 business days and land a fix or record an owner-approved exception within 14 calendar days; missed targets escalate to repo owner `bleedingdev`; owner may amend before ratification | **OWNER INPUT REQUIRED** — proposal is not ratified |
| **Version truthfulness** | `packages/toolkit/create/package.json` is `3.8.1`; `3.8.2-ultramodern.N` is the anticipated pattern after the pending sync, not the current version | Neutral — the first synced release must name its incorporated upstream base truthfully |
| **First runbook execution** | As of 2026-08-17, the in-flight v3.8.2 sync is the first runbook execution; v3.8.2 is not an ancestor of `HEAD` | **B** — the draft is being tested by a live sync, not declared complete |

The drivers genuinely conflict: release cadence is the strongest signal and
points at B, while divergence shape, capacity, and the already-independent npm
channel point at A. That conflict is why this is an owner decision and not a
drafting exercise.

## 4. What this ADR gates

1. **The P3 extraction lane may not start until this ADR is ratified.** Its
   entire ROI case is "reduce future merge pain", which is worth 1–2 months under
   B and close to nothing under A. Starting before ratification risks spending
   the largest single block of planned work on a premise the owner may reject.
2. **Whichever option is chosen, the governance ratchet stays.** The two-bucket
   rule (AGENTS.md Rule 5), the `FORK-DIVERGENCE.md` entry requirement, and the
   shrink-only boundary checker (`scripts/ultramodern-boundary-check/`) remain in
   force. Under B they protect the merge; under A they protect reviewability and
   keep the option of resuming tracking open. **Neither option authorizes
   regenerating an allowlist to bless new divergence.**
3. **Ratification must also settle**, in the same decision:
   - the LOC baseline for P3 sizing (33,832 gate-recorded changed lines across
     all upstream-owned files under `packages/`, measured against
     divergence-gate base `dfcd414a`; supersedes the ~25–28k brief figure) —
     any re-measurement must name the same base and scope or it will not
     reproduce;
   - under A: the renaming of the `3.8.1-ultramodern.N` scheme, and who owns
     manual security cherry-picks;
   - under B: the selected cadence (provisionally proposed as quarterly with
     out-of-band security syncs), named sync owner, named upstream-PR lane
     owner, and the exact runbook above, whose first execution is the in-flight
     v3.8.2 sync;
   - the divergence-base transition process: `--rebase-divergence-allowlist`
     is permitted only when the audited base itself moves, never to bless
     divergence at the current base;
   - the security-update SLA, provisionally proposed as 2-business-day triage
     and a 14-calendar-day fix-or-owner-approved-exception target, with missed
     targets escalating to `bleedingdev`; the owner may amend this proposal
     before ratification;
   - the truthful version scheme: the next release after this pending sync is
     expected to use `3.8.2-ultramodern.N`, while the current create package is
     still `3.8.1` (already authorized by AGENTS.md Rule 5 Bucket-B resolution
     (1); no Rule 2 amendment is needed because PR branches live on the fork
     remote, not `origin`).

## 5. Non-goals

- This ADR does not change the two-bucket rule, the boundary checker, or any
  divergence budget.
- It does not select, schedule, or descope P3 work; it only blocks P3 from
  starting unratified.
- It does not revisit `ADR-0020` zoned surface versioning, which governs
  *outbound* surfaces and is orthogonal to the *inbound* upstream relationship.
