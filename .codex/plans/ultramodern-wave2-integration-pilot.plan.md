---
name: Ultramodern Wave 2 Integration Pilot
overview: Prove architecture in a realistic reference topology and run extraction/failure drills.
todos:
  - id: uw2-01
    content: Build reference topology (shell + 2 remotes + 1 horizontal DS remote + 1 Effect service).
    status: pending
  - id: uw2-02
    content: Run remote failure drills and prove shell survivability.
    status: pending
  - id: uw2-03
    content: Run DS bad-release drill and verify consumer isolation/rollback.
    status: pending
  - id: uw2-04
    content: Extract one vertical to independent deploy (possibly different cloud) without shell refactor.
    status: pending
  - id: uw2-05
    content: Run manifest rollback/kill-switch drills under explicit SLO.
    status: pending
isProject: false
---

# Ultramodern Wave 2 Integration Pilot

## Purpose
Convert contract and stream outcomes into evidence that the design works under stress.

## Mandatory Drills
1. Remote timeout/network/integrity failure.
2. DS remote breaking change.
3. Vertical extraction by URL indirection.
4. Rollback + kill-switch under incident timing SLO.

## Exit Criteria
Pilot evidence pack with pass/fail for every drill and remediation notes for any failure.
