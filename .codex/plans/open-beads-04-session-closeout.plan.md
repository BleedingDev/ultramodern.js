---
name: Open Beads 04 Session Closeout
overview: Integrate results from the open-bead completion lanes, run quality gates, update Beads, commit, and push to bleedingdev.
todos:
  - id: integrate-lane-results
    content: "Review the outputs from source-test cleanup, Zephyr version switching, and MF patch removal/blocker lanes; resolve conflicts and ensure the repo has one coherent final state."
    status: pending
  - id: run-final-quality-gates
    content: "Run the focused test/build/lint gates required by changed files, including create-workspace, Cloudflare SSR validation, MF/DTS gates when touched, Biome, and git diff checks."
    status: pending
  - id: update-beads-final
    content: "Close completed beads, update blocked beads with fresh evidence, and create any new follow-up beads for unavoidable external work."
    status: pending
  - id: commit-and-push
    content: "Commit all completed work, run git pull --rebase, bd dolt push, git push to bleedingdev, and verify git status is up to date."
    status: pending
  - id: handoff-final-state
    content: "Report completed beads, remaining blockers, evidence paths, graph ID, commit SHA, and verification commands."
    status: pending
isProject: true
---

# Open Beads 04 Session Closeout

## Execution Notes

This plan closes the work session once the executable lanes finish or are proven externally blocked.

## Constraints

Follow `AGENTS.md`: work is not complete until git push succeeds.

Do not push to upstream `origin`; default remote is `bleedingdev`.

Do not leave Beads changes local only; run `bd dolt push`.

## Operator Guidance

This lane depends on the actionable implementation/proof lanes. It may still close the session if `modernjs-8qw9` remains externally blocked, but only after the blocker is refreshed with current evidence.
