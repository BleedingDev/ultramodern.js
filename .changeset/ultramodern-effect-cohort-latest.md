---
'@modern-js/create': patch
'@modern-js/plugin-bff': patch
'@modern-js/app-tools': patch
'@modern-js/code-tools': patch
---

Update UltraModern to the latest compatible dependency cohort: generated
workspaces now pin `effect`/`@effect/vitest` to `4.0.0-beta.91`, use the latest
TypeScript native preview and oxfmt pins, and the framework runtime moves its
Effect/OpenTelemetry dependency pair to the same beta.91 cohort.

The repository dependency refresh also updates the Rsbuild/Rspack, Rslib,
Rspress, i18next, nock, antd, vue, mermaid, js-yaml, filesize, and prettier
patch/minor releases verified for this UltraModern release line.
