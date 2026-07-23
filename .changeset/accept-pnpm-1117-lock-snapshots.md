---
'@modern-js/create': patch
---

Accept pnpm 11.17 lockfiles that keep base package metadata separate from
peer-context snapshots, including nested, patched, and hashed peer suffixes.
UltraModern migrations still fail closed for malformed or unresolved
dependency locators.
