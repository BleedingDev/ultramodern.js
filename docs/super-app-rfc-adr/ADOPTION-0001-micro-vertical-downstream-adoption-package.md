# ADOPTION-0001: Micro Vertical Downstream Adoption Package

- Status: Proposed
- Date: 2026-04-29
- Related Plan: `.codex/plans/ultramodern-full-micro-verticals-program.plan.md`
- Coordinates:
  - `WORKSPACE-0001-micro-vertical-workspace-scaffolding.md`
  - `GOVERNANCE-0001-micro-vertical-extraction-governance.md`
  - `OPERATIONS-0001-micro-vertical-certification-and-operations.md`

## 1. Purpose

This package is the downstream adoption index for teams building true Micro Verticals on top of the completed Ultramodern framework base.

The framework base already supplies one public preset, router seams, Module Federation SSR contracts, service-contract propagation, and release gates. This adoption package tells teams how to scaffold, extract, certify, operate, and migrate without inventing a bespoke process.

## 2. Milestone Order

Execute adoption in this order:

1. Workspace scaffolding.
2. Extraction governance.
3. Operations certification.

This order is intentional:

1. teams need a stable package topology before extraction review can be meaningful.
2. extraction governance needs ownership metadata before operations can certify blast radius.
3. operations certification needs the final shell, remote, service, and shared-package boundaries.

## 3. Adoption Map

| Team question | Canonical answer |
| --- | --- |
| What does the generated Tractor reference workspace contain? | `packages/document/docs/en/guides/get-started/ultramodern.mdx`, `packages/toolkit/ultramodern-create/template-workspace/README.md.handlebars`, and `packages/toolkit/ultramodern-create/src/ultramodern-workspace/` |
| How do we lay out the repo? | `WORKSPACE-0001-micro-vertical-workspace-scaffolding.md` |
| How do we scaffold shell, remote, and service packages? | `packages/toolkit/ultramodern-create/README.md`, `packages/toolkit/ultramodern-create/template-workspace/`, and `packages/toolkit/ultramodern-create/src/ultramodern-workspace/` |
| When should we extract a remote or service? | `GOVERNANCE-0001-micro-vertical-extraction-governance.md` |
| How do we migrate an existing app? | `MIGRATION-PLAYBOOK-0001-existing-teams-to-mv.md` |
| How do we migrate generated source checks? | `MIGRATION-PLAYBOOK-0002-ultramodern-shared-checks.md` |
| How do we certify production readiness? | `OPERATIONS-0001-micro-vertical-certification-and-operations.md` |
| Which contracts are machine-readable? | `docs/super-app-rfc-adr/contracts/` |
| Which gates prove the package still works? | `CI-GATES-0001-check-and-artifact-map.md` |
| How do we prove Cloudflare and Zephyr behavior? | `CLOUDFLARE-ZEPHYR-0001-ultramodern-worker-ssr.md` plus the generated workspace's own proof scripts (`scripts/ultramodern-cloudflare-proof.mjs`, `scripts/proof-cloudflare-version.mjs`; `pnpm cloudflare:proof`) |

## 4. Tractor Reference Architecture

The current downstream starter is the Tractor reference workspace:

| Boundary | Package | Owns |
| --- | --- | --- |
| Shell | `apps/shell-super-app` | route assembly, topology selection, MF host config, `zephyr:dependencies`, global fallback policy |
| Explore | `apps/remotes/remote-explore` | discovery routes, browser-safe MF exposes, `/explore-api/explore/*`, route-owned i18n, vertical CSS |
| Decide | `apps/remotes/remote-decide` | product selection routes, MF exposes, `/decide-api/decide/*`, route-owned i18n, vertical CSS |
| Checkout | `apps/remotes/remote-checkout` | cart and checkout routes, MF exposes, `/checkout-api/checkout/*`, route-owned i18n, vertical CSS |
| Shared tokens | `packages/shared-design-tokens` | shared CSS token layer and `./tokens.css` export |

The shell may orchestrate but must not take ownership of vertical-local route
behavior, Effect contracts, localized URL maps, dynamic locale JSON, or remote
CSS. Each vertical must be deployable as one full-stack package so Zephyr or
Cloudflare selection cannot drift UI and API versions apart.

### Decision Table

| Question | Keep code in existing vertical | Create a new package |
| --- | --- | --- |
| Same product owner, fallback behavior, Effect contract, and release train? | Yes | No |
| Needs independent route ownership, rollout, rollback, or incident routing? | No | New `remote` vertical |
| Needs cross-vertical strict trace/auth/locale/session propagation? | No | New Effect `service` |
| Shares tokens, primitives, generated clients, or domain-neutral utilities? | No | New `shared` package |
| Shares feature composites or workflow state? | No | Rework ownership before extraction |

## 5. Adoption Gates

Run these gates for a generated Tractor workspace:

```bash
pnpm install
pnpm i18n:boundaries
pnpm check
pnpm build
pnpm cloudflare:build
```

Use local Cloudflare validation for `.output` evidence and generated public URL
proof after deployment:

```bash
# Run from the generated workspace:
pnpm cloudflare:proof --require-public-urls

ULTRAMODERN_PUBLIC_URL_REMOTE_EXPLORE=https://remote-explore.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_DECIDE=https://remote-decide.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_REMOTE_CHECKOUT=https://remote-checkout.example.workers.dev \
ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP=https://shell-super-app.example.workers.dev \
pnpm cloudflare:proof --require-public-urls
```

Zephyr evidence is split into dry-run configuration proof and live public URL
proof. Live proof requires Zephyr credentials plus public shell and remote
manifest, runtime, and Effect readiness URLs.

## 6. Launch Checklist

Before a team starts a Micro Vertical:

1. choose Golden, Compat, or Experimental lane.
2. scaffold shell, remote, service, and shared packages using the workspace recipes.
3. assign owners for route, remote, service, and shared-package targets.
4. define topology IDs before wiring environment URLs.
5. document rollback controls before canary.
6. run contract gates before production promotion.

## 7. Done State

The downstream adoption story is complete when:

1. teams can scaffold a canonical workspace from existing create surfaces.
2. reviewers have a written extraction rubric and ownership metadata model.
3. operators have release, certification, incident, and rollback guidance.
4. all adoption guidance points back to existing repo fixtures, gates, schemas, and evidence packages.
