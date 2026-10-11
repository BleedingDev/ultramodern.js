---
'@modern-js/server-runtime-extensions': patch
---

Production static serving now also publishes the Node container a remote's `mf-manifest.json` names for SSR (`ssrRemoteEntry` and the chunks its own manifest lists), while the app's other server bundles stay private.
