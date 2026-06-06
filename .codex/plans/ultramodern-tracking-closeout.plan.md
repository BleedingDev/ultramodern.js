---
name: ultramodern-tracking-closeout
overview: Close or update Beads that are now tracking stale state before starting the next implementation lane, especially xh9x and the Tractor umbrella.
todos:
  - id: audit-xh9x-evidence
    content: Audit existing docs and generated templates for the visible-attribute i18n explanation and subproject Oxlint/Ultracite policy required by modernjs-xh9x.
    status: pending
  - id: close-xh9x-or-file-delta
    content: Close modernjs-xh9x if the evidence is sufficient, or update it with one concrete missing delta that must be handled by the Oxlint AST rule lane.
    status: pending
  - id: audit-u3xw-umbrella
    content: Recheck modernjs-u3xw dependencies and latest Tractor proof, then close the umbrella if modernjs-41je and modernjs-u3xw.1 fully satisfy it.
    status: pending
isProject: false
---

# ultramodern-tracking-closeout

## Execution Notes

The user confirmed that `modernjs-xh9x` should be done. Treat that as direction to perform a short evidence audit, not as permission to blindly close it without recording why. Current likely evidence is `docs/super-app-rfc-adr/MIGRATION-PLAYBOOK-0002-ultramodern-shared-checks.md`, generated `AGENTS.md`, generated `oxlint.config.ts`, and generated dependency checks that retain Oxlint, oxfmt, and Ultracite.

`modernjs-u3xw` is an umbrella. Its listed dependencies are closed after the `.108` Tractor validation, so it should likely be closed after one last Beads and npm/Tractor status check.

## Constraints

Use Beads for tracker state. Do not create replacement markdown TODOs. Do not close an issue if its acceptance is only implied by chat history; record the evidence in the issue notes first.

## Operator Guidance

This is the first lane because it reduces noise before code work. It should be quick and can be handled by one agent. Run `bd show` before and after updates, then `bd dolt push`.
