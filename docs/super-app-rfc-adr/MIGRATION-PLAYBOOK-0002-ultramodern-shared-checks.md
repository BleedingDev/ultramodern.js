# MIGRATION-PLAYBOOK-0002: UltraModern Shared Checks

- Status: Proposed
- Date: 2026-06-06
- Related Package: `@modern-js/ultramodern-checks`
- Related Gate: `pnpm ultramodern:i18n-boundaries`
- Related Playbook: `MIGRATION-PLAYBOOK-0001-existing-teams-to-mv.md`

## 1. Purpose

This playbook upgrades generated UltraModern.js repositories from copied source
guardrail scripts to the shared `@modern-js/ultramodern-checks` package.

The immediate trigger is the Tractor reference workspace. Its source already
passes the shared Oxlint-backed checks, but install-strategy repositories cannot
complete the dependency migration until the matching
`@bleedingdev/modern-js-ultramodern-checks` alias is published in the same
UltraModern cohort as the rest of the Modern packages.

## 2. Preconditions

1. Do not copy the checker implementation into the app.
2. Do not add app-specific regex allowlists for TypeScript syntax.
3. Do not remove Oxlint, oxfmt, or Ultracite from subprojects.
4. Do not depend on `repos/` reference checkouts. They are agent reference
   material, not application source.
5. For install-strategy repositories, publish the checks package alias before
   changing `package.json`:
   `@bleedingdev/modern-js-ultramodern-checks@<cohort>`.
6. For workspace-strategy repositories generated from a local Modern.js
   monorepo, use `workspace:*`.

## 3. Tractor Evidence

The shared workspace source check was run against both local Tractor workspace
copies:

```bash
node /Users/satan/side/experiments/modernjs/packages/toolkit/ultramodern-checks/dist/esm-node/cli/workspace-source-check.js
```

Run from:

1. `/Users/satan/side/experiments/tractor-store-vertical-demo-publish-clean`
2. `/Users/satan/side/experiments/tractor-store-vertical-demo`

Both runs exited `0`. This proves the Tractor source passes the AST-based shared
rules. It does not prove npm installability until the checks package alias is
published.

## 4. Workspace Migration

Use this for Tractor-style SuperApp workspaces.

### Package Source

Add `@modern-js/ultramodern-checks` to
`.modernjs/ultramodern-package-source.json`.

For install strategy:

```json
{
  "modernPackages": {
    "packages": [
      "@modern-js/app-tools",
      "@modern-js/plugin-bff",
      "@modern-js/plugin-i18n",
      "@modern-js/plugin-tanstack",
      "@modern-js/runtime",
      "@modern-js/ultramodern-checks"
    ],
    "specifier": "<cohort>",
    "aliases": {
      "@modern-js/ultramodern-checks": "@bleedingdev/modern-js-ultramodern-checks"
    }
  }
}
```

For workspace strategy, keep:

```json
{
  "modernPackages": {
    "specifier": "workspace:*"
  }
}
```

### Root Package

Add the root devDependency using the package source strategy:

```json
{
  "devDependencies": {
    "@modern-js/ultramodern-checks": "npm:@bleedingdev/modern-js-ultramodern-checks@<cohort>"
  }
}
```

For workspace strategy:

```json
{
  "devDependencies": {
    "@modern-js/ultramodern-checks": "workspace:*"
  }
}
```

Add the workspace source gate and include it in `check` before the generated
contract validator:

```json
{
  "scripts": {
    "ultramodern:i18n-boundaries": "node ./scripts/check-ultramodern-i18n-boundaries.mjs",
    "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm skills:check && pnpm ultramodern:i18n-boundaries && pnpm ultramodern:check"
  }
}
```

### Wrapper Script

Create `scripts/check-ultramodern-i18n-boundaries.mjs`:

```js
#!/usr/bin/env node
import { runWorkspaceSourceCheck } from '@modern-js/ultramodern-checks';

process.exitCode = runWorkspaceSourceCheck({ cwd: process.cwd() });
```

### Workspace Validator

Update `scripts/validate-ultramodern-workspace.mjs` so the generated contract
requires:

1. `scripts/check-ultramodern-i18n-boundaries.mjs` in `requiredPaths`.
2. `rootPackage.scripts['ultramodern:i18n-boundaries']` equals
   `node ./scripts/check-ultramodern-i18n-boundaries.mjs`.
3. `rootPackage.devDependencies['@modern-js/ultramodern-checks']` equals
   `expectedModernPackageSpecifier('@modern-js/ultramodern-checks')`.
4. install-strategy package-source aliases include
   `@modern-js/ultramodern-checks`.

## 5. Single-App Migration

Use this for generated UltraModern single apps.

Add the package-source entry and root devDependency exactly as above, then
replace `scripts/check-i18n-strings.mjs` with:

```js
#!/usr/bin/env node
import { runSingleAppI18nCheck } from '@modern-js/ultramodern-checks';

process.exitCode = runSingleAppI18nCheck({ cwd: process.cwd() });
```

Keep the public script contract:

```json
{
  "scripts": {
    "i18n:check": "node ./scripts/check-i18n-strings.mjs"
  }
}
```

Update `scripts/validate-ultramodern.mjs` to require the devDependency and to
verify it matches package-source metadata.

## 6. Validation

After editing a repository:

```bash
pnpm install
pnpm ultramodern:i18n-boundaries
pnpm ultramodern:check
pnpm check
```

For single apps, run:

```bash
pnpm install
pnpm i18n:check
pnpm ultramodern:check
```

If install fails because `@bleedingdev/modern-js-ultramodern-checks` is missing,
stop and publish the matching UltraModern cohort. Do not replace the dependency
with a local `file:` or `link:` dependency in a shared repository.

## 7. Rule Semantics

The shared package owns these generated source checks:

1. hardcoded visible JSX text and visible literal attributes.
2. legacy Module Federation source markers such as `data-mf-boundary`,
   `data-mf-remote`, and `data-mf-expose`.
3. hardcoded `language === 'cs' ? ... : ...` UI copy.
4. invalid plural locale resources.
5. missing runtime dynamic-resource wiring.

Visible attribute checks exist because attributes such as `aria-label`, `alt`,
`placeholder`, `title`, `aria-description`, `aria-roledescription`, and
`aria-valuetext` are user-facing copy. The rule should not inspect technical
attributes such as `name`, `type`, `autoComplete`, `data-testid`, or generated
boundary IDs.

## 8. Done State

A migrated repository is done when:

1. the generated app or workspace imports checks from
   `@modern-js/ultramodern-checks`.
2. no copied regex i18n scanner remains.
3. package-source metadata, root dependencies, wrapper scripts, and generated
   validators agree.
4. `pnpm check` passes without local dependency shims.
5. no app-specific allowlist contains implementation details such as
   `Effect.Effect`, `PromiseLike`, `AppEffect`, or `response.json()`.
