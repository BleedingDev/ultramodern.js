---
'@modern-js/runtime': patch
'@modern-js/runtime-utils': patch
'@modern-js/plugin-tanstack': patch
'@modern-js/types': patch
---

Stop forwarding the deprecated `hasErrorBoundary` flag into React Router route
objects and JSX route props.

Modern.js still keeps internal RSC payload boundary metadata, now inferred from
React Router error elements or boundaries, while the public route type marks the
legacy flag as deprecated for React Router 8 preparation.
