# UltraModern Boundary Check

Two fork-owned gates share one entry point. Import mode guards upstream-owned
source files that import fork-only code. Divergence mode guards every
upstream-owned file in the recorded package scope.

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js
```

The default `--mode all` runs both verification gates and exits non-zero if
either fails. Use `--mode imports` or `--mode divergence` to run one gate.

## 1. Import boundary (`checker.js`)

This gate freezes the set of upstream-owned source files that import
UltraModern-only code relative to merge-base `8a744c1b`. Its independent
baseline is `allowlist.json`.

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --mode imports
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --write-allowlist
```

## 2. File divergence (`divergence.js`)

The import gate cannot see fork behavior written directly into upstream-owned
files. Divergence mode diffs the complete scope recorded in
`divergence-allowlist.json` against that file's audited upstream base
(`f4bc5ee33532b7547876857caeab3782d41ffddd` today — upstream main through the
app-tools loader fix in #8819, merged into this fork). One entry per
divergent base-owned path records only `hunks` and `changedLines`. Always anchor
on the recorded upstream mainline commit; the previous v3.8.2 release tag was a
parallel, patch-equivalent commit and was not an ancestor of this branch.

### Fail-closed recorded contract

The allowlist, not the caller, owns verification context. Before diffing, the
checker requires:

- a supported exact schema and a resolvable full commit OID;
- a nonempty, canonical, uniquely sorted POSIX scope;
- canonical, unique, sorted file entries that exist with exact case at the
  audited base and remain inside the recorded scope;
- finite nonnegative integer hunk and changed-line budgets; and
- totals that exactly recompute from the entries.

Verification always runs from the resolved repository top level and measures
the full validated scope. `--mode all`, `--mode divergence`, and
`--mode allowlist-governance` reject `--root`, `--pathspec`, and
`--divergence-allowlist`; inherited `GIT_*` repository-context variables are not
forwarded to Git. A nested working directory, malformed ledger, unresolvable
ref, narrower/broader/reordered scope, or alternate allowlist therefore fails
before comparison. An incomplete measurement can never classify absent entries
as cleared.

### Cumulative shrink-only budgets

The cumulative gate fails on:

- `unallowlisted-divergence` — a changed audited-base-owned file has no budget;
- `line-budget-exceeded` — changed lines exceed the per-file budget; or
- `hunk-budget-exceeded` — hunk count exceeds the per-file budget.

A genuine shrink is componentwise: neither cumulative metric grows and at least
one falls. It passes without a ledger change and can be locked in with:

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --write-divergence-allowlist
```

That plain writer is monotonic. It refuses every raised budget and new entry and
writes atomically only after validating the complete candidate snapshot.

### Always measure against the recorded base

The budgets in `divergence-allowlist.json` are cumulative counts taken at the
`baseRef` recorded inside that file, which must equal
`DEFAULT_DIVERGENCE_BASE_REF` in `divergence.js`. Running the gate against any
other base — a PR merge-base, `HEAD~1`, a push `before` SHA — compares a
per-range delta against a full-history budget and is wrong in both directions,
so `checkForkDivergence` refuses to run when the two bases disagree. CI runs the
default invocation; do not pass `--base`.

When upstream is merged and the base itself moves, re-anchor the constant and
re-record in the **same** change as the `FORK-DIVERGENCE.md` rows:

```sh
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --mode divergence --base <new-upstream-base> \
  --write-divergence-allowlist --rebase-divergence-allowlist --record-growth
```

`--rebase-divergence-allowlist` alone only waives the base-equality assertion;
the growth guard still fires, because budgets recorded at the old base are not
comparable with measurements at the new one. That is why a base re-anchor always
needs `--record-growth` — and why every entry it raises must be inspected and
dispositioned first, not blessed in bulk.

### Exact Rule 5 cap and reviewed growth

Rule 5 separately examines the actual PR delta from its resolved merge-base to
its committed head. Audited-base ownership follows files across renames. An
equal-count semantic replacement and a pure rename are non-shrinks even when the
cumulative totals do not grow.

Every non-shrink upstream-owned change needs a same-PR `FORK-DIVERGENCE.md`
change and has an exact hard maximum of **20 added-plus-removed PR lines per
audited-base-owned file**. To record a legitimate capped increase after the
source and ledger commit exists:

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --write-divergence-allowlist --record-growth \
  --merge-base "$PR_MERGE_BASE" --head "$COMMITTED_HEAD"
```

The reviewed writer rejects missing/unresolvable refs, absent ledger evidence,
over-cap changes, noncanonical targets, and budgets that do not exactly match
the committed-head measurement. CI then independently reads both committed
allowlists with `git show`, re-measures the head, reconstructs rename ownership,
and re-derives the same cap and ledger evidence. Editing the baseline alone
cannot sanction growth.

### Base or scope migration

A real audited-base or scope transition is not an ordinary budget update. It
requires the explicit reviewed re-record operation, committed merge-base/head
refs, and a same-PR ledger explanation:

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --write-divergence-allowlist --rebase-divergence-allowlist \
  --base "$NEW_AUDITED_BASE" --pathspec "$NEW_SCOPE" \
  --merge-base "$PR_MERGE_BASE" --head "$COMMITTED_HEAD"
```

Governance requires the resulting transition ledger to equal the complete
committed-head snapshot. Do not use migration to bless ordinary divergence.

### CI invocations

The cumulative measurement always uses the recorded audited base, never the PR
merge-base. Only `--head` selects the committed target tree:

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --mode divergence --head "$COMMITTED_HEAD"

MERGE_BASE="$(git merge-base "origin/$GITHUB_BASE_REF" "$COMMITTED_HEAD")"
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --mode allowlist-governance --merge-base "$MERGE_BASE" \
  --head "$COMMITTED_HEAD"
```

The divergence diff pins Git's histogram algorithm and indent heuristic and uses
`-U0 --diff-filter=MD --no-renames`. Rule 5 uses rename detection separately so
a destination never loses the old audited-base identity.

## Self-test and behavior tests

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --self-test
node --test scripts/ultramodern-boundary-check/__tests__/*.test.js
```

The behavior suite uses temporary Git repositories to exercise scope attacks,
strict schema validation, committed-ref governance, capped growth, semantic
replacement, renames, genuine shrink, and reviewed migrations through the
public API and CLI.
