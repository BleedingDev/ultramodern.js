---
'@modern-js/app-tools': patch
---

Make Cloudflare SSR deploy output more ESM-native by declaring the generated `.output` package as `"type": "module"` while preserving CommonJS semantics only inside the copied `worker/` bundle directory. Older repos should upgrade to this cohort instead of adding app-level `"type": "module"`, Module Federation output shims, or custom worker wrappers; generated MF app packages remain CJS-compatible because Module Federation application bundles must not be forced through unsupported ESM output.
