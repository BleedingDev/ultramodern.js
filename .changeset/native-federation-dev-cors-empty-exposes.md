---
'@modern-js/ultramodern-app-tools': patch
---

Native Module Federation dev servers now send the configured `server.headers` and CORS headers on remote containers and chunks, so a host on another port can load them, and an empty `exposes: {}` is treated as a host-only app instead of failing dev with a missing container.
