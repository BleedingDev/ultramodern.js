---
name: Open Beads 03 Module Federation Patch Removal
overview: Finish modernjs-8qw9 if the upstream Module Federation DTS fix is now released; otherwise refresh the blocker with current GitHub/npm evidence.
todos:
  - id: verify-pr-4755-state
    content: "Check module-federation/core PR 4755 status, merge commit, and whether a release includes the lazy DTS import fix."
    status: completed
  - id: verify-npm-release-state
    content: "Check current npm versions and tarball contents for @module-federation/manifest, @module-federation/rspack, @module-federation/modern-js-v3, and related runtime packages."
    status: completed
  - id: remove-patches-if-consumable
    content: "If a fixed release is consumable, update Module Federation packages, remove patchedDependencies and patch files, regenerate pnpm-lock.yaml, and keep DTS enabled."
    status: pending
  - id: prove-dts-without-patches
    content: "Run Module Federation DTS/build tests and UltraModern generated build/type gates to prove the local patches are no longer needed."
    status: pending
  - id: refresh-blocker-if-not-consumable
    content: "If no fixed release is available, update modernjs-8qw9 notes with exact PR/release/npm evidence and leave local patches in place."
    status: completed
  - id: close-mf-patch-bead
    content: "Close modernjs-8qw9 only after patches are removed and DTS gates pass; otherwise keep it open with a fresh external blocker note."
    status: pending
isProject: true
---

# Open Beads 03 Module Federation Patch Removal

## Execution Notes

This plan owns `modernjs-8qw9`.

The desired end state is no local patches for `@module-federation/manifest` or `@module-federation/rspack`, with DTS still mandatory and green.

## Constraints

Do not disable DTS.

Do not remove local patches unless the published package tarballs actually contain the upstream fix.

Do not switch to unreleased GitHub SHAs or a non-stable package source just to close the bead.

## Operator Guidance

This plan has a legitimate external blocker. If upstream has not released the fix, the correct outcome is a fresh blocker note, not unsafe patch removal.

When actionable, inspect package tarballs or built files, not just release text.
