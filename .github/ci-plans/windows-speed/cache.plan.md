---
name: Windows verification cache
overview: Reuse pnpm's successful lockfile verification result from trusted default-branch CI without weakening dependency policies.
todos:
  - id: implement-verification-cache
    content: Add an exact-key restore action and a trusted main-only writer for the pnpm verification result.
    status: completed
  - id: verify-cache-boundaries
    content: Validate policy and toolchain key invalidation, restore-only PR behavior and workflow syntax.
    status: completed
isProject: false
---

# Windows verification cache

## Execution Notes

pnpm's package store does not include `<pnpm cache path>/lockfile-verified.jsonl`. Restore only that result before frozen installs, keyed by OS, pinned toolchain, lockfile and policy configuration. Save only after a successful frozen install on trusted `main-ultramodern`. Keep pnpm's own content and policy validation authoritative.

## Constraints

No `trustLockfile`, policy relaxation, broad verification restore keys, PR cache writes, copied credentials or manually fabricated successful verdicts. Existing package and prepared-build caches keep their contracts.

## Operator Guidance

Cache worker owns new cache action/helper/tests and `ci-cache.yml`. Root inserts the action in `ut-Windows.yml` and Windows integration jobs after the interface is ready. The test worker must not edit cache files. Run focused regression checks and return the diff without committing.
