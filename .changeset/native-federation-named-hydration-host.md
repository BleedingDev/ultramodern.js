---
'@modern-js/ultramodern-app-tools': patch
---

Pass each server entry its own hydration module and stop publishing a realm-global federation host, so the hydration module loads a remote through the host the server document names.
