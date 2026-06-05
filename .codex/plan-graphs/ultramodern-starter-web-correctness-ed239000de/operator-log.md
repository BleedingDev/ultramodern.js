# UltraModern Starter Web Correctness Operator Log

## Handoff Bundle

- Plan selection: `/Users/satan/side/experiments/modernjs/.codex/plans/ultramodern-starter-web-correctness.plan.md`
- Explicit dependencies: none
- Resolved graph id: `ultramodern-starter-web-correctness-ed239000de`
- Selection hash: `ed239000de`
- Snapshot path: `/Users/satan/side/experiments/modernjs/.codex/plan-graphs/ultramodern-starter-web-correctness-ed239000de/snapshot.json`
- State dir: `/Users/satan/side/experiments/modernjs/.codex/plan-graphs/ultramodern-starter-web-correctness-ed239000de`
- Agent limits: `max_threads=50`, `max_depth=3`

## Launch Design

- Status: launch design prepared; no subagents launched yet.
- Critical path owner: primary agent owns `define-starter-correctness-contract` and `audit-template-metadata-ownership`.
- Wave 1 sidecars after the contract is stable:
  - `starter-assets`: write-capable, owns template asset files and icon/logo references only.
  - `starter-semantics-css`: write-capable, owns starter route markup and CSS only.
  - `starter-validation`: initially read-only, designs generated-output validator/test assertions, then becomes write-capable after implementation files settle.
- Merge point: primary agent integrates metadata ownership, assets, markup, CSS, i18n strings, validator checks, generated starter validation, and README updates.

## Conflict Map

- `packages/toolkit/create/template/src/routes/[lang]/page.tsx.handlebars`: single-owner during each phase; assets, metadata, and semantic markup all touch this file.
- `packages/toolkit/create/template/src/routes/index.css.handlebars`: single-owner for CSS lane.
- `packages/toolkit/create/template/scripts/validate-ultramodern.mjs.handlebars`: validation lane only.
- `packages/toolkit/create/template/tests/ultramodern.contract.test.ts.handlebars`: validation lane only.
- `packages/toolkit/create/template/README.md`: documentation lane after implementation.
- `packages/solutions/app-tools/src/config/default.ts`: primary-only, and only if template ownership cannot handle viewport safely.

## Scope Boundaries

- Do not add a broad `webSpec` profile.
- Do not add public-surface generation, route indexing policy, JSON-LD, or navigation warmup work.
- Do not enforce arbitrary accessibility rules against user-authored product UI.
- Do not edit unrelated untracked `.codex/plans/ultramodern-opinionated-defaults-*` files.
