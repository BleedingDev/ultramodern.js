---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/ultramodern-create': patch
---

Preserve native federation receiver failures before the compiler's finalization barrier publishes them. Public errors include bounded operation, path and error-code details while retaining the original errors and failed receiver state through bridge cleanup.

Expose the native DTS manager's API error callback so the receiver retains the original download exception and its error causes.

Retry API type downloads after a connection reset within the existing attempt limit, before parsing or writing files. Keep HTTP errors, exhausted attempts and materialization failures fatal.

Use the router-free React federation bridge entry in every module format, preserving the framework's lazy-loading CSS default and option forwarding.
