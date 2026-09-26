---
'@modern-js/app-tools-extensions': patch
---

Dispatch percent-encoded spellings of a Cloudflare BFF or service binding prefix, such as `/%70resentations/...` or `/presentations%2F...`, to the owner of the prefix instead of letting them fall through to Worker Static Assets, which decode them and would serve files the owner gates. The Effect BFF receives the canonical pathname; backslash and undecodable spellings resolve to a path the owner rejects.
