---
'@modern-js/runtime': patch
---

The Document child compiler now runs only in build environments that emit HTML. It used to run in the server compiler as well, and both compilers rewrote the same temporary entry file at the same time. When one compiler read the file while the other had truncated it, the build failed with "Document child compiler produced empty output". Each compiler now also writes its own temporary entry file, so two HTML environments cannot race over it either.
