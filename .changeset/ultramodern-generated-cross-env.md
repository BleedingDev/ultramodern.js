---
'@modern-js/ultramodern-create': patch
---

Make generated build, formatting, and Cloudflare deployment scripts portable across Windows and POSIX shells with an exact `cross-env` cohort pin and config-owned Oxfmt exclusions. Migration upgrades legacy environment prefixes, quoted formatter arguments, and pre-`--skip-build` commands without preserving a duplicate Wrangler deployment.
