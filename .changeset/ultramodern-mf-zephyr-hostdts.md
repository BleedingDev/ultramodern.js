---
'@modern-js/app-tools': minor
'@modern-js/ultramodern-create': patch
---

Ultramodern workspace: generated apps use the public `@modern-js/app-tools/config` build-environment API instead of direct process access or child-process fallbacks. They register `zephyr-rspack-plugin` directly through Modern.js's Rspack bridge and fail builds closed through Zephyr's native `ZE_FAIL_BUILD=true` behavior. Host-only/no-exposes generated apps (the shell, and any remote with no `exposes`) now emit a consume-only Module Federation `dts` config instead of generating types for a package that exposes nothing.

The framework resolver also handles Effect TS-Go native packages published
without Unix execute bits by materializing a process-private executable copy;
framework scripts and generated workspaces never chmod installed dependencies.
