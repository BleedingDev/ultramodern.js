---
'@modern-js/ultramodern-create': patch
---

Harden `ultramodern migrate-strict-effect`: it now accepts `--dry-run` to print the planned filesystem changes without writing anything, and takes a shell-only fast path that skips the backend-federation and Zerops runtime stages when no app exposes a direct API. When the compact `.modernjs/ultramodern.json` is absent but legacy UltraModern 3.2 metadata is present, the compact config is synthesized from the retired generated-contract, package-source, and development-overlay files. Generated `.gitignore` rules now also cover `.output/` and `.modern-js/` (root and nested), pnpm-workspace `patchedDependencies` editing tolerates unquoted and double-quoted keys and dedupes repeated entries, and `oxfmt.config.ts` `ignorePatterns` are synced (with a safe no-op warning when the array is spread/dynamic).
