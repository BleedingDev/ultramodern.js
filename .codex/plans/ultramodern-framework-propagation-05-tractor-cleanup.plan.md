---
name: ultramodern-framework-propagation-05-tractor-cleanup
overview: Update the standalone Tractor Store demo to latest UltraModern packages and remove framework-level local patches so the demo contains only product-specific UI, content, routes, data, Cloudflare names, and domain behavior.
todos:
  - id: update-demo-dependencies
    content: "Update Tractor demo dependencies and lockfile to the latest trusted-published UltraModern package versions after framework validation passes."
    status: pending
  - id: remove-demo-cloudflare-shims
    content: "Delete demo-local Cloudflare Worker shims and app-local bundler aliases once app-tools owns Worker SSR compatibility."
    status: pending
  - id: remove-demo-css-workarounds
    content: "Remove shellStylesheetPlugin, hardcoded remote CSS links, extra URL globals used only for CSS, and filenameHash=false when framework federated CSS covers SSR styling."
    status: pending
  - id: simplify-demo-i18n-runtime
    content: "Replace duplicated inline i18n resources with generated-style JSON resources and namespace setup while preserving Tractor translations."
    status: pending
  - id: reconcile-demo-contracts
    content: "Regenerate or update Tractor topology and UltraModern generated contracts so they match actual config, ports, SSR mode, public URL envs, and vertical metadata."
    status: pending
  - id: keep-domain-customizations-only
    content: "Verify remaining Tractor differences from a fresh scaffold are limited to UI, assets, product data, app routes, MF exposes/remotes, Worker names, website URL, and translation content."
    status: pending
  - id: validate-demo-runtime
    content: "Run Tractor checks, builds, SSR/no-JS browser proof, language switching, boundary toggling, recommendation links, Effect BFF routes, and Cloudflare deploy proof."
    status: pending
isProject: false
---

# ultramodern-framework-propagation-05-tractor-cleanup

## Execution Notes

Tractor should be a standalone demo repository on the BleedingDev profile, not pollution in the framework repo. It is allowed to be a custom app, but not to carry custom framework config. After backports, the comparison against a fresh scaffold should be boring: product code differs; framework config does not.

## Constraints

Do not add Oxlint overrides or rule disables. Do not use demo-local scripts to mask framework deploy gaps. Do not manually publish packages. Do not push anything to upstream Modern.js. Keep the demo public repository and stable website URL.

## Operator Guidance

This plan depends on generated scaffold validation. If a Tractor cleanup step breaks because the framework cannot support it, stop and backport the missing capability instead of restoring a local patch.
