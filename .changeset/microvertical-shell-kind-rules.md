---
'@modern-js/code-tools': patch
'@modern-js/ultramodern-create': patch
---

The MicroVertical API boundary check now fails closed and keys Shell rules by `kind` instead of by the `apps/shell-super-app` path.

- Every topology entry and configured app must declare `kind` as `shell` or `vertical`.
- Relative imports resolve through real paths, so two spellings of one module are the same module.
- A client's composed module closure follows `import()` and the global `require()`, skips type-only imports, and reports a tool error for an unresolved, computed or escaping dependency or a closure past 128 levels or 2048 modules.
- Source rules get one module graph per source file.
- Every `kind: shell` app must not ship `src/api/vertical-clients.ts` or a `./api/clients` export, and no value its public source exports may expose another owner's API client. Generated Shells no longer emit that client registry; they keep their workspace dependencies on every API unit and import owner clients directly.
- The module graph gains `resolveReference` for one lexical occurrence and `isUnboundReference` for globals.
