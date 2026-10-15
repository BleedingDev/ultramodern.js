---
'@modern-js/ultramodern-create': patch
---

The workerd SSR proof accepts a Shell that owns its own API backend (BFF) unless the Shell is declared `ui-only`, and requires that backend's worker modules to be bound. MicroVertical profiles still fix their API backend and backend federation exactly, and Shells never publish backend federation.
