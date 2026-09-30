---
'@modern-js/ultramodern-create': patch
---

The `cloudflare-proof` command now expects the release build marker that a deploy build stamps into each Worker. A build from a clean checkout, or with `ULTRAMODERN_SOURCE_REVISION` set, derives that marker from the topology generation marker and the source revision, so the proof failed with a UI or API marker mismatch after every real deploy. The proof resolves the revision the same way the build does and checks the UI marker, the API readiness marker, the delivery-unit surface markers and the service-binding markers against it. A dirty checkout without a configured revision still expects the generation marker.
