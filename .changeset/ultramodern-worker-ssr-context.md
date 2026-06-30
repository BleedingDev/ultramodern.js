---
"@modern-js/runtime": patch
---

Split Modern's internal runtime React context from the public runtime context so
SSR router and helmet state is visible to framework plugins while public context
consumers still receive sanitized request data. Also honor explicit Module
Federation SSR configuration for Cloudflare worker SSR builds.
