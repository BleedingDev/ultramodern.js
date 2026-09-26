---
'@modern-js/app-tools-extensions': minor
'@modern-js/ultramodern-create': patch
---

Remove `withBuildConfigEnvironment` and its process-global environment lease registry from `@modern-js/app-tools-extensions/config`; `getBuildConfigEnvironment` stays. Generated deploys now set `ZE_FAIL_BUILD=true` in the deploy environment (`cloudflare:deploy` script and Zerops build `envVariables`), the generated Zephyr plugin registers `withZephyr()` directly, and a build with `ZE_CI_TOKEN` but without `ZE_FAIL_BUILD=true` fails with a message naming the fix.
