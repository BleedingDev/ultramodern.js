---
"@modern-js/ultramodern-create": patch
---

Extend the workerd SSR proof (`cloudflare-ssr-proof`):

- `ULTRAMODERN_WORKERD_ARTIFACT_ROOT` selects where built `.output` directories live. Topology paths cannot leave that root, and the release envelope is verified with the workspace app's own toolchain.
- Wrangler `kv_namespaces` are bound as Miniflare KV namespaces.
- `ULTRAMODERN_WORKERD_PROOF_FIXTURE` supplies KV seeds, approved HTTPS owner origins and explicit Shell API mounts (format documented on `validateWorkerdProofFixture`). Outbound fetches to an approved origin reach the owner's Worker; all other origins stay disabled.
- Shell API proofs compare status, content type and body, do not follow redirects, and report the phase, status, content type, digest and a problem summary when an API fails.
