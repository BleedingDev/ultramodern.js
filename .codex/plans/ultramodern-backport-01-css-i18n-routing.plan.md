---
name: ultramodern-backport-01-css-i18n-routing
overview: Backport the reusable SSR, i18n, and Tailwind isolation fixes into UltraModern generated apps without source-content tests or demo-specific markup.
todos:
  - id: audit-generated-tailwind-v4-contract
    content: Audit generated shell and vertical apps for Tailwind v4 usage, prefix generation, content scanning, and remaining non-Tailwind CSS that is not strictly necessary.
    status: completed
  - id: enforce-native-prefix-isolation
    content: Implement or tighten the Tailwind-native prefix contract so each generated app emits stable prefixed utility classes without regex-transforming arbitrary class names.
    status: completed
  - id: remove-temporary-style-patches
    content: Remove any temporary shell-side font, size, or cascade patches that mask remote or vertical CSS problems instead of fixing isolation at the source.
    status: completed
  - id: harden-i18n-template-copy
    content: Fix generated i18n message templates so copy is complete per locale, does not split literal phrases incorrectly, and can be customized from one obvious place.
    status: completed
  - id: harden-ssr-localized-routing
    content: Verify and fix generated SSR routing for localized paths, canonical metadata, alternate locale links, and no-JS full-page rendering.
    status: completed
  - id: add-framework-level-regression-tests
    content: Add targeted generator/runtime tests that validate class prefix emission, i18n template output, localized route config, and SSR markup shape without checking product-demo source content.
    status: pending
isProject: false
---

# ultramodern-backport-01-css-i18n-routing

## Execution Notes

This lane owns the problems that are clearly reusable framework behavior: CSS collisions, Tailwind v4 configuration, localized route scaffolding, and i18n starter copy. The expected approach is Tailwind-native isolation first. Avoid magical class rewriting because it can catch non-Tailwind classes and makes generated TSX misleading for humans and agents.

Generated TSX should already contain the correct prefixed classes where the prefix contract requires them. The end user and their agent should see the same convention in source that the browser receives at runtime.

## Constraints

Do not add demo Tractor Store content. Avoid native CSS unless Tailwind cannot express the required behavior cleanly or the code is framework plumbing rather than application styling. Do not validate SSR by searching for product strings in source files; use generated artifacts and runtime/browser checks where behavior matters.

## Operator Guidance

Depends on `ultramodern-backport-00-scope-and-demo-split`. This lane can run in parallel with Cloudflare/package work and native boundaries after the scope gate is complete. Coordinate with the validation lane for browser proof on a freshly scaffolded app.
