---
'@modern-js/app-tools': patch
'@modern-js/app-tools-extensions': patch
'@modern-js/ultramodern-app-tools': patch
'@modern-js/ultramodern-create': patch
'@modern-js/surface-resolution': patch
---

Add `--deploy-target <target>` to `modern build` and `modern deploy`. One resolver picks the target (`--deploy-target` > `deploy.target` > `MODERNJS_DEPLOY` > detected provider > `node`), rejects unknown values, and app-tools stores the result once in the app context as `deployTarget`. The deploy presets, the Cloudflare builder, the Node deploy-output plugins, the release envelope and the headless Cloudflare worker read that value instead of re-deriving it from config and the environment. `createUltramodernReleaseEnvelopePlugin()`, `createDeployOutputAliasesPlugin()`, `createDeployOutputPublicAssetsPlugin()` and `createCloudflareBuilderPlugin()` no longer take target or provider resolver arguments.

`@modern-js/app-tools-extensions/config` exports `resolveDeployTarget` for config files that branch on the target, and `createRemoteManifestUrl` uses it.

Generated workspaces drop `cross-env`, which reported a build that died from a signal as a plain exit 1. App scripts run `modern build --deploy-target node|cloudflare` and `modern deploy --skip-build --deploy-target …`, and generated configs call `resolveDeployTarget()` instead of reading `MODERNJS_DEPLOY`. `ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS` is gone, including from surface resolution (a production Cloudflare deploy without public URLs already fails closed): `cloudflare:deploy` passes `--require-public-origin` to public-surface generation and `--require-public-urls` to `cloudflare-output-verify`, which fails an app without `ULTRAMODERN_PUBLIC_URL_<APP_ID>`, `MODERN_PUBLIC_SITE_URL` or `ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN`. `cloudflare:deploy` no longer sets `ZE_FAIL_BUILD`; the deploy environment sets it next to `ZE_CI_TOKEN`, as the generated Zephyr plugin already requires.
