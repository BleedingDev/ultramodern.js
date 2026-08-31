# MIGRATION-PLAYBOOK-0002: Modern.js Code Tools

- Status: Proposed
- Date: 2026-06-06
- Related Package: `@modern-js/code-tools`
- Related Gate: `pnpm i18n:boundaries`
- Related Playbook: `MIGRATION-PLAYBOOK-0001-existing-teams-to-mv.md`

## 1. Purpose

This playbook upgrades generated UltraModern.js repositories from copied source
guardrail scripts to shared Modern.js code tooling in `@modern-js/code-tools`.

The immediate trigger is the Tractor reference workspace. Its source already
passes the shared Oxlint-backed checks, but install-strategy repositories need
the matching `@bleedingdev/modern-js-code-tools` package from the same
UltraModern cohort as the rest of the Modern packages.

## 2. Preconditions

1. Do not copy the checker implementation into the app.
2. Do not add app-specific regex allowlists for TypeScript syntax.
3. Do not remove Oxlint, oxfmt, or Ultracite from subprojects.
4. Do not depend on `repos/` reference checkouts. They are agent reference
   material, not application source.
5. For install-strategy repositories, publish the code-tools package alias
   before changing `package.json`:
   `@bleedingdev/modern-js-code-tools@<cohort>`.
6. For workspace-strategy repositories generated from a local Modern.js
   monorepo, use `workspace:*`.

## 3. Tractor Evidence

The shared workspace source check must pass from Tractor after installing the
published code-tools package:

```bash
pnpm i18n:boundaries
```

This proves the Tractor source passes the AST-based shared rules and the small
workspace source checks. It does not prove installability until the code-tools
package alias is published.

## 4. Workspace Migration

Use this for Tractor-style SuperApp workspaces.

### Package Source

Add `@modern-js/code-tools` to
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
      "@modern-js/code-tools",
      "@modern-js/ultramodern-create"
    ],
    "specifier": "<cohort>",
    "aliases": {
      "@modern-js/code-tools": "@bleedingdev/modern-js-code-tools",
      "@modern-js/ultramodern-create": "@bleedingdev/modern-js-ultramodern-create"
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
    "@modern-js/code-tools": "npm:@bleedingdev/modern-js-code-tools@<cohort>",
    "@modern-js/ultramodern-create": "npm:@bleedingdev/modern-js-ultramodern-create@<cohort>"
  }
}
```

For workspace strategy:

```json
{
  "devDependencies": {
    "@modern-js/code-tools": "workspace:*",
    "@modern-js/ultramodern-create": "workspace:*"
  }
}
```

Add the workspace source gate and include it in `check` before the generated
contract validator:

```json
{
  "scripts": {
    "i18n:boundaries": "node ./scripts/check-ultramodern-i18n-boundaries.mts",
    "contract:check": "node ./scripts/validate-ultramodern-workspace.mts",
    "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm skills:check && pnpm i18n:boundaries && pnpm contract:check"
  }
}
```

### Wrapper Script

Create `scripts/check-ultramodern-i18n-boundaries.mts`:

```js
#!/usr/bin/env node
import { runWorkspaceSourceCheck } from '@modern-js/code-tools';

process.exitCode = runWorkspaceSourceCheck({ cwd: process.cwd() });
```

### Workspace Validator

Update `scripts/validate-ultramodern-workspace.mts` so the generated contract
requires:

1. `scripts/check-ultramodern-i18n-boundaries.mts` in `requiredPaths`.
2. `rootPackage.scripts['i18n:boundaries']` equals
   `node ./scripts/check-ultramodern-i18n-boundaries.mts`.
3. `rootPackage.devDependencies['@modern-js/code-tools']` equals
   `expectedModernPackageSpecifier('@modern-js/code-tools')`.
4. install-strategy package-source aliases include
   `@modern-js/code-tools`.

## 5. Single-App Migration

Use this for generated UltraModern single apps.

Add the package-source entry and root devDependency exactly as above, then
replace `scripts/check-i18n-strings.mjs` with:

```js
#!/usr/bin/env node
import { runSingleAppI18nCheck } from '@modern-js/code-tools';

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
pnpm i18n:boundaries
pnpm contract:check
pnpm check
```

For single apps, run:

```bash
pnpm install
pnpm i18n:check
pnpm check
```

If install fails because `@bleedingdev/modern-js-code-tools` is missing, stop
and publish the matching UltraModern cohort. Do not replace the dependency with
a local `file:` or `link:` dependency in a shared repository.

## 7. Rule Semantics

The code-tools package owns these generated source checks:

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

1. the generated app or workspace imports checks from `@modern-js/code-tools`.
2. no copied regex i18n scanner remains.
3. package-source metadata, root dependencies, wrapper scripts, and generated
   validators agree.
4. `pnpm check` passes without local dependency shims.
5. no app-specific allowlist contains implementation details such as
   `Effect.Effect`, `PromiseLike`, `AppEffect`, or `response.json()`.
