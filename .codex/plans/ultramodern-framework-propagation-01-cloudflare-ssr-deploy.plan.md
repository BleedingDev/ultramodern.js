---
name: ultramodern-framework-propagation-01-cloudflare-ssr-deploy
overview: Move Cloudflare SSR deploy behavior and Worker runtime compatibility out of the Tractor demo and into UltraModern.js framework defaults so freshly scaffolded apps can build, deploy, and run SSR Effect BFF verticals without app-local shims.
todos:
  - id: audit-cloudflare-current-state
    content: "Re-audit app-tools Cloudflare deploy, Worker bundle generation, Effect BFF entry discovery, and generated package scripts against the working Tractor demo behavior."
    status: pending
  - id: design-cloudflare-deploy-contract
    content: "Define the framework-owned Cloudflare deploy contract: build output generation, Wrangler deployment command, required public URL envs, proof command, and trusted-publishing constraints."
    status: pending
  - id: move-worker-compatibility-into-app-tools
    content: "Implement Cloudflare Worker SSR compatibility in app-tools instead of generated app configs, covering loadable, path, fs/promises, and other Worker-only aliases or fallbacks with tests."
    status: pending
  - id: align-ssr-mode-default
    content: "Choose and implement the Cloudflare Module Federation SSR mode default, then make generated config, generated contract, and validators agree."
    status: pending
  - id: update-create-cloudflare-scripts
    content: "Update create-generated app and root Cloudflare scripts so deploy performs the validated build plus Wrangler deploy flow without demo-specific shell scripts."
    status: pending
  - id: test-cloudflare-ssr-effect-bff
    content: "Add or update unit/integration tests proving Cloudflare SSR route dispatch, static assets, Effect BFF readiness routes, and generated deploy scripts work from framework defaults."
    status: pending
isProject: false
---

# ultramodern-framework-propagation-01-cloudflare-ssr-deploy

## Execution Notes

The Tractor demo currently proves a working Cloudflare shape, but it carries too much of that behavior locally. Evidence from the research pass:

- Framework generator emits `cloudflare:deploy` as `MODERNJS_DEPLOY=cloudflare modern deploy`, while Tractor deploys through `pnpm run cloudflare:build && wrangler deploy --config .output/wrangler.json`.
- Tractor adds local Worker shims and `bundlerChain` aliases in every app config.
- App-tools already owns Cloudflare Worker environment construction in `packages/solutions/app-tools/src/builder/generator/getBuilderEnvironments.ts`, so runtime compatibility belongs there.
- Generator and generated contract say `server.ssr.mode: 'stream'`, while Tractor uses `string`; this mismatch must not survive.

## Constraints

Do not add demo-local deploy scripts, config overrides, or app-specific shims as the durable fix. Do not push or publish to upstream `origin`; default push/publish target is `bleedingdev`. Package publication must go through GitHub Actions trusted publishing, not manual `npm publish`.

Keep compatibility with non-Cloudflare deployment targets unless a change is explicitly guarded by `deploy.target === 'cloudflare'` or `MODERNJS_DEPLOY=cloudflare`.

## Operator Guidance

This lane can run in parallel with the CSS and i18n/boundary lanes. Treat it as blocking for generated scaffold validation and Tractor cleanup. Validation should include focused app-tools tests before a full freshly scaffolded app test.
