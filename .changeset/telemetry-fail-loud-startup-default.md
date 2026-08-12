---
'@modern-js/app-tools': patch
---

`presetUltramodern`'s `telemetryFailLoudStartup` now defaults to `false`; set `server.telemetry.failLoudStartup=true` explicitly (or pass `telemetryFailLoudStartup: true` to the preset) to keep fail-loud startup behavior.
