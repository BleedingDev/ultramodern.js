# UltraModern Boundary Check

Two fork-owned gates share one entry point. Import mode treats matching source
files under `packages/**/src` as upstream-owned; divergence mode covers every
file under `packages/`. In both cases the file must already exist at the
relevant upstream base ref.

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js
```

The default `--mode all` runs both gates and exits non-zero if either fails.
Use `--mode imports` or `--mode divergence` to run one of them.

## 1. Import boundary (`checker.js`)

Freezes the set of upstream-owned source files that *import* UltraModern-only
code, relative to merge-base `8a744c1b`. Fails only when the checker reports
`added` entries. Baseline lives in `allowlist.json`.

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --mode imports
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --write-allowlist
```

## 2. File divergence (`divergence.js`)

The import gate is blind to the much larger violation surface: fork code
written *into* upstream-owned files. This gate diffs the tree against the
upstream base (`dfcd414a`, i.e. `git merge-base HEAD v3.8.1`) and budgets every
upstream-owned file that has any diff hunk.

Baseline lives in `divergence-allowlist.json`, one entry per file recording
`hunks` and `changedLines` only — never hunk content.

Semantics are **shrink-only**. The gate fails when:

- an upstream-owned file diverges with no recorded budget
  (`unallowlisted-divergence`);
- a file's changed-line count exceeds its recorded budget
  (`line-budget-exceeded`);
- a file's hunk count exceeds its recorded budget, even when its total changed
  lines shrink (`hunk-budget-exceeded`).

An entry counts as shrinking only when neither metric grows and at least one is
strictly smaller. A clean shrink passes and prints a hint to re-record the
smaller budget.

Every violation message restates the two-bucket rule: send the change upstream
as a PR, or move it behind a fork-owned extension point. The only escape hatch
is a capped patch of `<= ~20` changed lines with a matching `FORK-DIVERGENCE.md`
entry.

### Scope actually enforced

Divergence mode measures every modified or deleted file under `packages/` that
existed at the recorded upstream base, including sources, tests, manifests,
snapshots, docs, and configs. `git diff --diff-filter=MD` provides the ownership
test: fork-added files remain excluded. Each measured file has independent hunk
and changed-line budgets against `dfcd414a`; either metric growing fails the
divergence gate unless the allowlist is deliberately updated through the
sanctioned governance path.

### Always measure against the recorded base

The budgets in `divergence-allowlist.json` are cumulative counts taken at the
`baseRef` recorded inside that file (`dfcd414a`). Running the gate against any
other base — a PR merge-base, `HEAD~1`, a push `before` SHA — compares a
per-range delta against a full-history budget and is wrong in both directions,
so `checkForkDivergence` refuses to run when the two bases disagree. CI runs the
default invocation; do not pass `--base`.

```bash
# working tree vs upstream base (default) — this is what CI runs
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --mode divergence

# same base, a committed tree instead of the worktree
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --mode divergence --head "$SOME_SHA"

# re-record after an intentional migration (shrink)
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --write-divergence-allowlist

# explicitly record sanctioned growth after adding its FORK-DIVERGENCE.md row
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js \
  --write-divergence-allowlist --record-growth
```

By default, `--write-divergence-allowlist` is monotonic: it refuses to raise
`hunks` or `changedLines`, or to add a new file entry, and leaves the allowlist
untouched. `--record-growth` is the explicit, noisy override for a sanctioned
budget increase; it prints every grown or added entry so the allowlist update
can be reviewed beside its matching `FORK-DIVERGENCE.md` row. On pull requests,
CI also compares the checked-in allowlist with its merge-base version via
`--mode allowlist-governance`; any raised metric, new entry, or base re-anchor
must include a `FORK-DIVERGENCE.md` change in the same PR.

Extra flags: `--pathspec <glob>` (repeatable, default `packages`),
`--divergence-allowlist <path>`, `--json`, `--root <dir>`, `--record-growth`,
and `--rebase-divergence-allowlist` — the explicit opt-in required to re-record
the baseline at a *different* upstream base (only when the audited base itself
moves, never to bless divergence at the current base).

The gate issues a single `git diff -U0 --diff-filter=MD --no-renames` per run
and finishes in well under a second on this repo.

## Self test

`--self-test` exercises the hunk parser and the shrink-only budget comparison
against a synthetic patch, with no git and no repo state:

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --self-test
```

The same assertions plus git-backed fixtures run under
`pnpm test:scripts` via `__tests__/divergence.test.js`.
