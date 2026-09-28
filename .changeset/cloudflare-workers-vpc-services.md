---
'@modern-js/app-tools-extensions': minor
'@modern-js/app-tools': patch
---

Add `deploy.worker.vpcServices` for Workers VPC service bindings to private origins behind a Cloudflare Tunnel. Modern.js writes them to `wrangler.json` as `vpc_services`, at the top level and in every `wrangler.env.<name>`; a binding with `prefix` joins the Worker's prefix dispatch and is recorded in the worker manifest with its `vpcServiceId`. A VPC binding name may not reuse any other Worker binding (the assets binding, typed or raw services, D1, KV, Hyperdrive, Durable Objects or `vars`), a VPC prefix must be a decoded path starting with `/` without `.` or `..` segments and may not overlap (even as a percent-encoded alias) the Effect BFF prefix or another routed prefix, and the typed option excludes a raw `wrangler.vpc_services`.
