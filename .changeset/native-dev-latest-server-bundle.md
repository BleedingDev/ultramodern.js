---
'@modern-js/ultramodern-app-tools': patch
---

Solid and Octane dev no longer copies each compile into checkpoint directories, claims the output with an owner lock file, or checks inodes. After each successful client and server compile, dev SSR imports the newest server bundle directly, with a cache-busting query for ESM and a cleared `require.cache` entry for CommonJS, and refreshes `.ultramodern-dev/renderer-build.json`. Saving a file during a compile just starts another compile. A dev session left over from an earlier run no longer blocks the next one.
