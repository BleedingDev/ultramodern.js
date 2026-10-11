---
'@modern-js/ultramodern-app-tools': patch
'@modern-js/ultramodern-create': patch
---

Preserve native federation receiver failures before the compiler's finalization barrier publishes them. Public errors include bounded operation, path and error-code details while retaining the original errors and failed receiver state through bridge cleanup.

Expose the native DTS manager's API error callback so the receiver retains the original download exception and its error causes.

Retry API type downloads after a connection reset within the existing attempt limit, before parsing or writing files. Keep HTTP errors, exhausted attempts and materialization failures fatal.

Hold the receiver publication fence across identity resolution and metadata publication. Queue the next native receiver generation until those reads and writes finish, preserving lease validation and watch recovery.

Use the router-free React federation bridge entry in every module format, preserving the framework's lazy-loading CSS default and option forwarding.

Report the actual changed compiler inputs when React discovery and its first live build disagree, including bounded dependency and receiver differences. Keep the build identity validation strict.

Keep native receiver records in the same generation through private discovery and the first emitting build. Later public rebuilds continue to revoke prior generation records.
