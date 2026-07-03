---
'@modern-js/create': patch
---

Ultramodern workspace: the generated `zephyr-rspack-plugin` integration now warns and continues (instead of crashing dev/build) when the plugin throws synchronously or rejects asynchronously; set `ULTRAMODERN_ZEPHYR=false` to disable it entirely. Host-only/no-exposes generated apps (the shell, and any remote with no `exposes`) now emit a consume-only Module Federation `dts` config instead of generating types for a package that exposes nothing.
