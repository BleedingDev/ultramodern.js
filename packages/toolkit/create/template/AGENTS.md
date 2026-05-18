# UltraModern Agent Contract

This project is generated for Codex-first UltraModern.js work.

## Quality Gates

- `pnpm lint` runs Oxlint with the Ultracite preset.
- `pnpm format` runs oxfmt.
- `pnpm typecheck` runs effect-tsgo as the TypeScript checker.
- `pnpm ultramodern:check` verifies the generated contract.

## Private Skills

Private orchestration skills are not vendored into this template. If you are authorized for `TechsioCZ/skills`, run:

```bash
pnpm skills:install
```

The installer clones that private repository and copies only the allowlisted skills from `.agents/skills-lock.json`.
