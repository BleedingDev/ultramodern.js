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
files. Divergence mode therefore records two immutable source identities:

- `baseRef` (`eded841256a7cffdaa622e3889fc83407debd3e4`) owns audited path
  identity, including identity across upstream renames;
- `upstreamRef` (`2f4d9c4559e26209a0d77f02c6757f29fe3699a2`) is the reviewed
  upstream v3.8.3 source already incorporated by the fork.

Exact `baseRef..upstreamRef` source is resolution (1), already upstream, and
does not consume fork divergence. The cumulative measurement is the single
rename-aware `upstreamRef..target` patch, grouped back onto immutable audited
identities. Files added by reviewed upstream become upstream-owned identities;
every file added later under `packages/**` inside a vanilla upstream package
remains governed. Directory or filename segments such as `tests`, `fixtures`,
`examples`, `docs`, and `*.test.*` are not exemptions: they can contain
executable/configuration inputs or shipped product documentation. Explicit
fork-owned package roots are excluded only when they did not exist at the
reviewed upstream provenance.

### Fail-closed recorded contract

The allowlist, not the caller, owns verification context. Before diffing, the
checker requires:

- a supported exact schema and both exact, resolvable full commit OIDs;
- audited-base ancestry into reviewed provenance and provenance ancestry into
  the measured target;
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

### Always preserve identity and provenance

The budgets in `divergence-allowlist.json` are cumulative counts from the
recorded `upstreamRef` to the target, keyed by identities derived from the
recorded `baseRef`. Both refs are exact built-in pins in `divergence.js`.
Running against a PR merge-base, `HEAD~1`, a push `before` SHA, or substituting
`HEAD` as provenance would erase or distort debt, so verification rejects every
such substitution. Only `--head` selects the committed target tree.

Provenance advancement is deliberately not a snapshot-reset operation. The
writer refuses to change `upstreamRef`; a future advancement needs a separately
reviewed, identity-preserving budget carry-forward design. The one accepted
schema migration is the exact v1 `2f4d9c4559` snapshot to v2
`eded841256`/`2f4d9c4559`, with byte-for-byte identical scope, entries, budgets,
and totals.

### Exact Rule 5 cap and reviewed growth

Rule 5 separately examines the actual PR delta from its resolved merge-base to
its committed head. Audited-base ownership follows files across renames. An
equal-count semantic replacement and a pure rename are non-shrinks even when the
cumulative totals do not grow.

Every non-shrink upstream-owned change needs exactly one new or semantically
changed path-first `FORK-DIVERGENCE.md` row in the same commit range. Its path
must exactly equal the immutable audited identity, including the old path of a
rename; owner and reason must be nonempty; and disposition must consist of the
ledger's allowed full tokens. Whitespace/reformatting, unrelated rows, grouped
paths, broad advisory tables, duplicates, and pre-existing historical rows do
not count. Each file also has an exact hard maximum of **20
added-plus-removed PR lines**. To record a legitimate capped increase after the
source and strict ledger row exist:

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

### Scope migration

A real scope transition is not an ordinary budget update. It requires the
explicit reviewed re-record operation, committed merge-base/head refs, and a
same-PR ledger explanation. The immutable audited and provenance refs still
cannot change:

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --write-divergence-allowlist --rebase-divergence-allowlist \
  --pathspec "$NEW_SCOPE" \
  --merge-base "$PR_MERGE_BASE" --head "$COMMITTED_HEAD"
```

Governance requires the resulting transition ledger to equal the complete
committed-head snapshot. Do not use migration to bless ordinary divergence.

### CI invocations

The cumulative measurement always uses the recorded provenance and audited
identity base, never the PR merge-base. Only `--head` selects the committed
target tree:

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --mode divergence --head "$COMMITTED_HEAD"

MERGE_BASE="$(git merge-base "$PR_BASE_SHA" "$COMMITTED_HEAD")"
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --mode allowlist-governance --merge-base "$MERGE_BASE" \
  --head "$COMMITTED_HEAD"

# Protected-branch push validation uses the exact event range. An unresolved
# or all-zero before SHA fails closed.
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --mode allowlist-governance --merge-base "$PUSH_BEFORE_SHA" \
  --head "$COMMITTED_HEAD"
```

The divergence diff pins Git's histogram algorithm and indent heuristic and
uses one `-M -U0 --diff-filter=ACDMRT` stream. Rule 5 composes rename identity
from audited base through reviewed provenance and the PR merge-base so a
destination never loses its upstream owner.

## Self-test and behavior tests

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --self-test
node --test scripts/ultramodern-boundary-check/__tests__/*.test.js
```

The behavior suite uses temporary Git repositories to exercise scope attacks,
strict schema validation, committed-ref governance, strict semantic ledger-row
correlation, lexical test/fixture/docs escape attempts, capped growth, semantic
replacement, renames, genuine shrink, and reviewed migrations through the
public API and CLI.
