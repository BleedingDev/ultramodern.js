# ADR-0022: Freeze or Track Upstream Modern.js

- Status: **Proposed — owner decision required**
- Date: 2026-08-12
- Decision Type: Fork lifecycle / upstream relationship policy
- Deciders: repo owner (ratifying); drafted for ratification, no option selected
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

### Measured position (verified in-repo, 2026-08-12)

| Fact | Value | How verified |
| --- | --- | --- |
| Fork commits ahead of upstream | **8,022** | `git rev-list --count origin/main..HEAD` |
| Merge debt | **zero** | `git merge-base HEAD origin/main` == `origin/main` tip |
| Audited merge-base | `ecef47dc` "Release v3.8.1 (#8799)", 2026-08-07 | `FORK-DIVERGENCE.md`; matches `origin/main` tip |
| Upstream-owned files carrying fork edits | **633 files / 2,835 hunks / 33,832 changed lines** (vs divergence-gate base `dfcd414a`, the parent of `ecef47dc`; gate scope is *every* upstream-owned file under `packages/` — the earlier 341 / 1,797 / 14,263 figures were the narrower `packages/**/src` source-only scope, widened 2026-08-12) | `scripts/ultramodern-boundary-check/divergence-allowlist.json` (`baseRef`, `totalFiles`/`totalHunks`/`totalChangedLines`); `FORK-DIVERGENCE.md` § "Bases and counts" |
| Package-scope diff at the boundary | 581 M, 847 A, 11 D, 18 R (1,457 paths), base `origin/main` | `FORK-DIVERGENCE.md` § "Bases and counts" |
| Root/infra diff outside `packages/**` | 467 M, 719 A, 8 D, 37 R (1,231 paths), base `dfcd414a` | `FORK-DIVERGENCE.md` § "Bases and counts" |
| Ledger disposition split (103 entry rows) | **62 `keep-[F]` / 13 `keep-[M]` / 8 `upstream-PR` / 5 `extension-point` primary (8 rows name it, 3 as the budget target of a `keep-[F]` row) / 6 `revert` (plus 1 "document, evaluate revert") / 3 `fix`-or-fixed / 2 `capped-patch` / 2 `owner-decision` / 1 `gate`** | disposition column of the ledger entry tables in `FORK-DIVERGENCE.md` (§ 4 and the `packages/**` sections) |

> **Superseded snapshot (2026-08-16).** Every figure in the table above was
> measured in the 3.8.1 era. Upstream 3.8.2 has since been merged and the
> divergence gate re-anchored to `eded841256` (`Release v3.8.2 (#8810)`), which
> is also the `origin/main` tip, so the gate base and the sync-review base now
> coincide and the two-base caveat below no longer applies. Current figures live
> in `FORK-DIVERGENCE.md` §2–§3; do not cite this table as current evidence.

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

**None. This ADR is deliberately undecided.** Two options are drafted in full so
the owner can ratify one. Neither is recommended here; the drafter's role was to
make the consequences legible, not to choose.

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
- **Every Bucket-B divergence is a recurring cost.** The 341 files / 1,797 hunks
  are re-paid at each sync. The ledger's disposition split matters here: only
  **8 `upstream-PR`** rows are genuinely upstreamable, while **62 `keep-[F]`**
  are permanent by design and **13 `keep-[M]`** are mechanical. Extraction
  cannot eliminate the `keep-[F]` portion — it can only move it behind
  fork-owned extension points, and the ledger already enumerates that scope: the
  **8 rows carrying an `extension-point` disposition** (5 primary, 3 as the
  budget target of a `keep-[F]` row) are the named P3 extraction targets, since
  `extension-point` is defined as logic that should move out of the upstream
  file into a fork-owned module with a shrinking budget. Size P3 against those
  rows and the `keep-[F]`-heavy reality, not against the total.
- **Requires an upstream-sync runbook, which does not exist.** This is a
  prerequisite deliverable of ratifying B, not a follow-up. It must cover: fetch
  and re-audit the merge-base, regenerate the ledger with rename detection
  pinned (`git diff -M`), re-record divergence budgets, and the conflict policy
  already encoded in the ledger's **"Disposition vocabulary"** table
  (`upstream-PR`, `extension-point`, `capped-patch`, `keep-[F]`, `keep-[M]`,
  `revert`, `fix`, `owner-decision`).
- **The upstream PR lane becomes mandatory** for fork fixes that are really
  upstream bugs (e.g. the 404 fix, the upload `formData` fix). Carrying an
  upstream bug fix as a local Bucket-B patch means re-merging it forever;
  upstreaming it deletes the cost permanently. The lane is already authorized in governance: AGENTS.md Rule 5 names "a PR to upstream `origin`" as Bucket-B resolution (1), and the ledger's `upstream-PR` disposition maps to it. PR branches are pushed to the fork remote (`bleedingdev`) and opened as cross-repo PRs, so AGENTS.md Rule 2 (no direct push/publish to `origin`) is untouched. What ratifying B must add is a named owner and cadence for this lane.
- **Keeps the fork on a maintained base**, inheriting upstream security and
  feature work at the cadence chosen.

## 3. Decision drivers

| Driver | Evidence as of 2026-08-12 | Points toward |
| --- | --- | --- |
| **Upstream release activity** | 22 v3.x releases in ~6 months; v3.8.1 on 2026-08-07, 5 days ago; ~weekly cadence | **B** — strongly. The stated "maintenance mode" premise is refuted. |
| **Merge debt right now** | Zero; merge-base == `origin/main` tip | Neutral — both options are cheap to start today |
| **Divergence shape** | Of 103 ledger entry rows: 62 `keep-[F]` (permanent) and 13 `keep-[M]`, against 8 `upstream-PR` + 8 naming `extension-point` + 7 `revert`-flavored + 3 `fix` that are convergent by definition | **A** — `keep-[F]` alone is ~60% of rows (62/103), so most divergence is intentional and will never converge. But the signal is weaker than a binary permanent-vs-upstreamable reading suggests: 26 rows are already on a path back toward upstream behavior. |
| **Team capacity** | Owner-gated; P3 is 1–2 months (unverified estimate) of a small team's budget, plus a standing per-sync cost under B | **A** if capacity is the binding constraint |
| **The 22 couplings that refuted full `create`-revert** | Unrecorded in-repo; owner recollection only | **A** — evidence that divergence is structural, not incidental. Record it before relying on it. |
| **npm scope realities (`@bleedingdev`)** | Fork publishes its own scope under its own release/security process (`PUBLISH-SECURITY-RUNBOOK.md`); consumers already depend on `@bleedingdev/*`, not `@modern-js/*` | **A** — the distribution channel is already independent of upstream; nothing downstream forces tracking |
| **Security patch obligation** | No cherry-pick runbook exists for A; no sync runbook exists for B | Neutral — **both options require a runbook that has not been written** |

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
   - under B: the cadence, the named sync owner, the sync runbook as a
     prerequisite deliverable, and the named owner of the standing upstream PR lane (already authorized by AGENTS.md Rule 5 Bucket-B resolution (1); no Rule 2 amendment needed — PR branches live on the fork remote, not `origin`).

## 5. Non-goals

- This ADR does not change the two-bucket rule, the boundary checker, or any
  divergence budget.
- It does not select, schedule, or descope P3 work; it only blocks P3 from
  starting unratified.
- It does not revisit `ADR-0020` zoned surface versioning, which governs
  *outbound* surfaces and is orthogonal to the *inbound* upstream relationship.
