# MIGRATION-PLAYBOOK-0003: UltraModern 3.4.0-ultramodern.14

- Status: Accepted
- Date: 2026-06-27
- From: `3.4.0-ultramodern.12`
- To: `3.4.0-ultramodern.14`
- Related packages: `@bleedingdev/modern-js-create`,
  `@bleedingdev/modern-js-app-tools`, `@bleedingdev/modern-js-builder`

## 1. Purpose

`3.4.0-ultramodern.14` is the cleanup release for generated UltraModern.js
workspaces. It keeps the framework behavior in the framework package and keeps
generated apps focused on app-owned configuration and product code.

`3.4.0-ultramodern.14` supersedes `3.4.0-ultramodern.13`. The `.13` cohort
published the framework cleanup, but fresh generated workspaces could fail
`format:check` because generated source was not preformatted with the generated
workspace's own `oxfmt`/Ultracite config. Use `.14` as the migration target.

This release addresses the main issues found while consuming UltraModern.js
inside a larger repository:

1. nested parent-monorepo consumption is a generated bridge mode.
2. root validation and typecheck can be bridge-aware.
3. Module Federation DTS checks inspect real configs and real exposes.
4. Cloudflare Worker output accepts generic Wrangler-compatible config and
   artifact staging.
5. server-only app directories are kept out of public Worker assets.
6. generated MF dev CORS and splitChunks defaults are explicit.
7. server-only build warnings include better attribution.
8. `.modern-js` tool output and deterministic reports are ignored.
9. parent package test/build checks are delegated through explicit bridge gates.
10. generated checks can delegate to parent workspace gates.
11. deterministic diagnostic reports are not committed as source.
12. large generated `.modernjs` metadata is replaced by compact config.
13. copied framework scripts are replaced by CLI-backed wrappers.
14. Codex skills live under `.codex`, remain default-on, and can be disabled.

## 2. New Workspace Command

Use the exact cohort for release proof:

```bash
pnpm dlx @bleedingdev/modern-js-create@3.4.0-ultramodern.14 my-workspace \
  --ultramodern-package-source install \
  --ultramodern-package-version 3.4.0-ultramodern.14
```

Then validate from the generated workspace:

```bash
cd my-workspace
mise install
mise exec -- pnpm install
mise exec -- pnpm check
mise exec -- pnpm build
```

## 3. Existing Workspace Migration

Migrate one published cohort at a time.

1. Update every generated `@modern-js/*` dependency alias to the same
   `3.4.0-ultramodern.14` cohort.
2. Update `@modern-js/create` / `@bleedingdev/modern-js-create` references to
   `3.4.0-ultramodern.14`.
3. Replace generated validator/proof script bodies with the new wrapper form
   from a fresh `.14` workspace:

   ```js
   #!/usr/bin/env node
   import { spawnSync } from 'node:child_process';

   const result = spawnSync(
     'modern-js-create',
     ['ultramodern', '<command>', ...process.argv.slice(2)],
     {
       shell: process.platform === 'win32',
       stdio: 'inherit',
     },
   );

   if (result.error) {
     console.error(result.error.message);
     process.exit(1);
   }

   process.exit(result.status ?? 1);
   ```

   Keep app-specific scripts only when they own real app behavior.
4. Replace the generated metadata trio with `.modernjs/ultramodern.json`:

   - remove `.modernjs/ultramodern-generated-contract.json`.
   - remove `.modernjs/ultramodern-package-source.json`.
   - remove `.modernjs/ultramodern-workspace-template-manifest.json`.
   - keep app-authored topology files under `topology/*`.

5. Move generated Codex skills from `.agents/skills` to `.codex/skills`.
   Preserve unrelated existing `.codex/skills/*` entries in repositories that
   already have their own skills.
6. Add these ignores if they are missing:

   ```gitignore
   .codex/reports/
   apps/*/.modern-js/
   ```

7. Reinstall and validate:

   ```bash
   mise exec -- pnpm install --lockfile-only --ignore-scripts
   mise exec -- pnpm install --ignore-scripts
   mise exec -- pnpm check
   mise exec -- pnpm build
   ```

## 4. Bridge Mode For Parent Monorepos

Use bridge mode when a generated UltraModern workspace is nested inside a
larger repository and intentionally consumes parent packages.

Example:

```bash
pnpm dlx @bleedingdev/modern-js-create@3.4.0-ultramodern.14 app-name \
  --ultramodern-package-source install \
  --ultramodern-package-version 3.4.0-ultramodern.14 \
  --bridge \
  --bridge-parent-root ../.. \
  --bridge-workspace-package ../../libs/ui \
  --bridge-workspace-package-name ../../libs/ui=@acme/ui \
  --bridge-workspace-package ../../libs/domain/* \
  --bridge-dependency @acme/ui,@acme/domain-core \
  --bridge-test-alias ../../libs/ui:@acme/ui=../../libs/ui/src \
  --bridge-lockfile-policy nested \
  --bridge-gate parent-check="pnpm -C ../.. check" \
  --bridge-react-singleton react,react-dom
```

Bridge mode requires explicit parent package coverage. Do not rely on stale
`dist` output for tests. Prefer source aliases and delegated parent gates.

## 5. RsTest, Rslib, And Vitest

The preferred generated test posture is RsTest-first.

Use RsTest for generated UltraModern workspace tests and bridge verification.
Use delegated bridge gates when the parent repository already owns a test
runner. Do not generate a Vitest/Rslib combo as the default bridge strategy.

Rslib remains appropriate for parent packages that are libraries and need
declaration/build output. It is a packaging/build concern, not the default test
runner decision. Vitest can stay in a parent repository that already uses it,
but the generated workspace should call it through an explicit bridge gate
rather than bake it into the UltraModern framework contract.

## 6. Cloudflare Worker Config

Use `deploy.worker.wrangler` for provider config that Wrangler understands.
UltraModern owns the Worker entrypoint, asset binding/directory/run mode, and
required compatibility flags. App config owns provider-specific bindings,
vars, observability, placement, and similar Wrangler keys.

```ts
import { defineConfig } from '@modern-js/app-tools';

export default defineConfig({
  deploy: {
    target: 'cloudflare',
    worker: {
      name: 'my-worker',
      compatibilityDate: '2026-06-02',
      wrangler: {
        observability: { enabled: true },
        placement: { mode: 'smart' },
        vars: {
          APP_ENV: 'production',
        },
      },
      artifacts: [
        {
          from: 'config/runtime-policy.json',
          to: 'config/runtime-policy.json',
        },
      ],
      publicAssetExcludes: ['api', 'shared'],
    },
  },
});
```

`deploy.worker.artifacts` is intentionally generic. It stages app-owned files
under `.output` and rejects writes into framework-owned output paths such as
`public/`, `server/`, `worker/`, `wrangler.json`, and `package.json`.

## 7. Module Federation DTS

Generated validation now inspects real `module-federation.config.ts` files. If
an app exposes modules, validation requires:

1. actual non-empty exposes.
2. a non-empty `dist/@mf-types.zip`.
3. `dts.generateTypes.compilerInstance: 'tsgo'`.
4. `dts.tsConfigPath: './tsconfig.mf-types.json'`.

If a generated app is host-only, make that explicit in the generated config
instead of allowing an assertion script to no-op.

## 8. Codex Skills

Codex skills are default-on. Generated workspaces write them under
`.codex/skills` and track pinned skill bodies with `.codex/skills-lock.json`.

Existing repositories with `.codex/skills` keep their unrelated skills. The
installer updates only the pinned generated skill directories.

To disable generated skill installation for a repository or CI run:

```bash
ULTRAMODERN_SKIP_CODEX_SKILLS=1 pnpm install
```

or:

```bash
ULTRAMODERN_CODEX_SKILLS=0 pnpm install
```

## 9. Validation Checklist

Run this before merging a migrated workspace:

```bash
pnpm check
pnpm build
pnpm mf:types
pnpm cloudflare:build
```

For bridge workspaces, also run the delegated parent gate recorded by the
generated `bridge:*` script.

For Worker output, inspect:

```bash
test -s apps/shell-super-app/dist/@mf-types.zip
test -f .output/wrangler.json
test ! -e .output/public/api
test ! -e .output/public/shared
```

Adjust paths for vertical app output when validating a multi-app workspace.

## 10. Remaining External Work

This release does not hide external warnings with generated app shims.

Known follow-ups:

1. the upstream Module Federation splitChunks warning may still appear even
   when generated defaults are already stream-SSR-compatible.
2. Alchemy should be evaluated separately as an optional Cloudflare
   infrastructure-as-code layer after the generic Wrangler-compatible config is
   stable. It should not become default generated framework plumbing unless it
   cleanly consumes prebuilt Worker output without duplicating deploy ownership.
