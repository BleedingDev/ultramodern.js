---
'@modern-js/builder': patch
'@modern-js/server': patch
'@modern-js/utils': patch
---

Upgrade the vendored js-yaml implementation exposed by @modern-js/utils to
5.4.1, refresh the builder's Rsdoctor diagnostics tooling to 1.6.3, and remove
the unused Axios runtime dependency from @modern-js/server.
