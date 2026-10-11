---
'@modern-js/app-tools-extensions': patch
---

Carry configured route `responseHeaders` into the Cloudflare worker manifest and merge them into native Solid and Octane worker responses, appending CSP and cookies and unioning `Vary` as the Node host does.
