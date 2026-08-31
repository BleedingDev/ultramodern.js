---
'@modern-js/ultramodern-create': minor
'@modern-js/app-tools': minor
'@modern-js/builder': patch
---

Harden UltraModern generated workspaces and Cloudflare Worker output.

- Generated UltraModern workspaces now use compact `.modernjs/ultramodern.json` metadata plus `modern-js-create ultramodern` CLI-backed script wrappers instead of copying large framework-owned validator/proof scripts and metadata contracts into every app.
- Add bridge-aware nested parent workspace generation with explicit parent package patterns, dependencies, delegated gates, source test aliases, React singleton guidance, and bridge-preserving `add-vertical` behavior.
- Validate Module Federation DTS from real app configs and exposes, requiring non-empty `dist/@mf-types.zip` archives plus `compilerInstance: 'tsgo'` and the generated MF tsconfig path when exposes are present.
- Move default Codex skills into repository-owned `.codex/skills`, keep installation default-on, document opt-out, and preserve unrelated existing repository skills.
- Add generic Cloudflare Worker `deploy.worker.wrangler` and protected `deploy.worker.artifacts` support, including server-only public asset excludes without hardcoded Cloudflare service helpers.
- Improve builder diagnostics for server-only/RSC dependency warnings so warning attribution points at the graph that produced the warning.
