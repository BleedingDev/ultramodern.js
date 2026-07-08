# UltraModern Boundary Check

This fork-owned guard freezes the current set of upstream-owned source files
that import UltraModern-only code. A file is upstream-owned when it is under
`packages/**/src` and exists at merge-base `8a744c1b`.

The checked-in `allowlist.json` is the current baseline. The migration goal is
to shrink that list over time by moving fork-only imports out of upstream-owned
files. CI should fail only when the checker reports `added` entries.

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js
```

To refresh the baseline after an intentional migration or after removing stale
entries:

```bash
node scripts/ultramodern-boundary-check/check-fork-import-boundary.js --write-allowlist
```
