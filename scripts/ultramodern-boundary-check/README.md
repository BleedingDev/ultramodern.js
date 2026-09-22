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

This gate rejects every current governed import of UltraModern-only code in
upstream-owned source files. Its ownership base is the exact commit
`8a744c1b3178d1e85d4113f29e8837ff94079fb3`. The independent `allowlist.json`
records migration history: matching an allowance does not permit an edge or
make verification pass. The default `--mode all` applies this same strict rule.

`--head <commit>` scans source paths and bytes from that resolved commit, even
when the worktree differs. Without `--head`, the gate scans the worktree.
The ownership base and target must resolve, and the base must be an ancestor
of the target. Import verification rejects `--root`, `--base-ref`, `--allowlist`,
`--base`, `--pathspec`, and `--divergence-allowlist`; inherited Git repository
context variables are removed before Git runs.

The classifier uses the existing literal import-specifier marker scan over
`packages/**/src` identities present at the import ownership base. It shares the
divergence gate's rename projection, so a detected rename retains ownership in
committed and worktree scans. Literal dynamic imports, requires, type imports
and direct re-exports are covered. This check does not prove arbitrary alias or
transitive barrel resolution, or imports in later upstream-added source.

One exact native dependency has a target-aware exception: named imports or
re-exports of `configure`, `createRequest` and `createUploader` from the bare
`@modern-js/create-request` package. Babel AST inspection checks source bindings
(including aliases and type-only references), never comments or string text.
Namespace, default, dynamic and CommonJS references do not qualify.

The exception applies only when that measured target retains the native package
identity, native node/browser export targets, fixed-base native dependencies and
source identities, plus the reviewed neutral factory/header extraction. AST checks validate local imports,
public value/type bindings and absence of retired policy identifiers/property
keys. Unknown files, fork policy modules/imports, new export surfaces, malformed
source or metadata, and source symlinks revoke eligibility. Committed targets
read their own tree; worktree checks include untracked package source files.
The source inventory records six audited files and the reviewed native factory
and header extraction. It is structural classification evidence, not a semantic
proof against arbitrarily rewritten policy. No other marker, allowance,
ownership base or divergence budget changes when the native edge qualifies.

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

The explicit inventory includes `packages/document/ultramodern-preset`,
`packages/runtime/runtime-extensions`, `packages/toolkit/ultramodern-create`
and `packages/toolkit/ultramodern-sandpack-profile`. All four roots are absent
from both pinned upstream trees; their manifests first appear in fork commit
`b6794e933d0bce99eb5c9324b0dc38b721ff2435`. Their inclusion corrects ownership
accounting without changing the audited base, reviewed provenance, scope or
stored budgets. An upstream-owned identity moved into any of these roots
remains governed, and a listed package present in reviewed upstream is not
exempt.

The relocation inventory also includes `packages/cli/plugin-bff-build-extensions`,
`packages/runtime/boundary-debugger`,
`packages/runtime/federation-runtime`, `packages/runtime/i18n-integration`,
`packages/runtime/renderer-extensions`,
`packages/solutions/ultramodern-app-tools`,
`packages/toolkit/backend-federation-contracts` and
`packages/toolkit/surface-resolution`. Their entire directory trees are absent
at both immutable upstream pins; the behavior suite verifies that evidence.
These roots contain fork-owned subsystems moved out of upstream packages.
Registering them does not exempt any audited identity moved into them, adjacent
package paths, or packages introduced by reviewed upstream. The recorded scope,
provenance and all allowance budgets remain unchanged.

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

### Rule 5 evidence and reviewed growth

Rule 5 separately examines the actual PR delta from its resolved merge-base to
its committed head. Audited-base ownership follows files across renames. An
equal-count semantic replacement and a pure rename are non-shrinks even when the
cumulative totals do not grow.

Every non-shrink upstream-owned change needs exactly one new or semantically
changed structured `FORK-DIVERGENCE.md` entry in the same commit range.
The sole current input is the `fork-evidence:v1` JSON block. Its strict schema
requires `schemaVersion: 1` and `entries`, each with `path`, `owner`, `reason`,
and an array of full `dispositions` tokens. Unknown fields, malformed data,
missing values and multiple blocks fail closed. Generate the readable table:

```bash
node scripts/ultramodern-boundary-check/render-ledger.js
node scripts/ultramodern-boundary-check/render-ledger.js --check
```

The default gate verifies that the table matches the data. Historical merge-base
commits without a structured block retain the read-only legacy parser so a
representation-only migration cannot grant new evidence rights. Current heads
never accept the Markdown grammar. The migration retains all 472 formerly valid
semantic keys; the five previously invalid advisory rows remain non-authorizing.
 Its path
must exactly equal the immutable audited identity, including the old path of a
rename; owner and reason must be nonempty; and disposition must consist of the
ledger's allowed full tokens. Whitespace/reformatting, unrelated rows, grouped
paths, broad advisory tables, duplicates, and pre-existing historical rows do
not count. To record a reviewed increase after the source and strict ledger row
exist:

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --write-divergence-allowlist --record-growth \
  --merge-base "$PR_MERGE_BASE" --head "$COMMITTED_HEAD"
```

The reviewed writer rejects missing/unresolvable refs, absent ledger evidence,
noncanonical targets, and budgets that do not exactly match
the committed-head measurement. CI then independently reads both committed
allowlists with `git show`, re-measures the head, reconstructs rename ownership,
and re-derives the same PR delta and ledger evidence. Editing the baseline alone
cannot sanction growth.

Reviewed growth can reconcile inherited source that is unchanged in the PR.
Each raised or new budget still needs its own new or semantically changed
strict ledger row and must exactly match the committed measurement. A source
edit is not required merely to record that review. Unchanged historical rows
and review of another file do not authorize the increase. Fork subsystem
ownership requirements still apply.

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

The focused behavior suite uses temporary Git repositories for literal import
violations, unresolved refs, inherited Git redirection, canonical CLI scope,
structured schema rejection, historical migration without evidence laundering,
duplicate evidence, equal-count replacement, rename identity and native request
policy/alias/source/symlink rejection. The built-in self-test covers divergence
parsing, deleted identity and componentwise budgets. Broader deleted test suites
are not claimed as retained coverage.
