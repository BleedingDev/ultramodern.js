---
'@modern-js/federation-runtime': patch
---

The server manifest-recovery runtime plugin now recovers a remote manifest that answered with a transient HTTP status such as 503. Module Federation parses the error body as JSON without checking the status, so the hook only saw a `SyntaxError` and never retried. Recovery now fetches again, retries retryable statuses within its bounded attempts, and stops after one check when a successful response really is malformed.
